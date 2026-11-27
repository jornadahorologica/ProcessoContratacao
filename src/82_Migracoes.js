/**
 * Migrações da configuração (abas cfg_*).
 *
 * A carga inicial (80_Seed.js) corresponde à versão 1. Cada evolução do fluxo
 * entra aqui como uma migração numerada, aplicada pelo setup() sobre a
 * planilha existente SEM apagar dados nem processos. A versão aplicada fica
 * na propriedade do script CFG_VERSAO.
 *
 * As migrações só incluem/atualizam registros pelas suas chaves, então é
 * seguro executar o setup() mais de uma vez.
 */
var Migracoes = {
  PROP: 'CFG_VERSAO',

  versaoAtual: function () {
    return Number(PropertiesService.getScriptProperties().getProperty(this.PROP)) || 1;
  },

  ultimaVersao: function () {
    return this.lista.reduce(function (m, x) { return Math.max(m, x.versao); }, 1);
  },

  /** Situação para a tela de Administração. */
  situacao: function () {
    var atual = this.versaoAtual();
    return {
      versao: atual,
      ultima: this.ultimaVersao(),
      pendentes: this.lista.filter(function (m) { return m.versao > atual; })
        .map(function (m) { return { versao: m.versao, descricao: m.descricao }; })
    };
  },

  executar: function () {
    var self = this;
    var log = [];
    var atual = this.versaoAtual();
    this.lista.filter(function (m) { return m.versao > atual; }).forEach(function (m) {
      m.aplicar(self);
      Db.gravar();
      PropertiesService.getScriptProperties().setProperty(self.PROP, String(m.versao));
      log.push('Migração ' + m.versao + ' aplicada: ' + m.descricao);
    });
    if (!log.length) log.push('Configuração já está na versão ' + atual + '.');
    ConfigService.limparCache();
    return log;
  },

  // ---------------------------------------------------------------- utilitários
  /** Insere ou atualiza pelo valor da chave primária. */
  upsert: function (tabela, obj) {
    var r = repo(tabela);
    var chave = obj[r.chave];
    return r.obter(chave) ? r.atualizar(chave, obj) : r.inserir(obj);
  },

  remover: function (tabela, pred) {
    var r = repo(tabela);
    r.filtrar(pred).forEach(function (o) { r.remover(o[r.chave]); });
  },

  /** Atualiza o campo (fluxo + etapa + chave) se existir. */
  ajustarCampo: function (fluxoId, etapa, chave, alteracoes) {
    var c = repo('cfg_Campos').filtrar(function (x) {
      return x.fluxoId === fluxoId && x.etapaCodigo === etapa && x.chave === chave;
    })[0];
    if (c) repo('cfg_Campos').atualizar(c.id, alteracoes);
  },

  // ---------------------------------------------------------------- migrações
  lista: [
    {
      versao: 2,
      descricao: 'ETP com os 13 incisos do art. 18 da Lei 14.133/2021, valor da solução e assinaturas no SUITE',
      aplicar: function (M) {
        var F = 'CONTRATACAO';
        var NSA = 'NSA';

        // --- Etapa ETP
        if (repo('cfg_Etapas').obter(F + '.ETP')) {
          repo('cfg_Etapas').atualizar(F + '.ETP', {
            descricao: 'Estudo Técnico Preliminar — art. 18, §1º, da Lei 14.133/2021. Incisos I, IV, VI, VIII e XIII são ' +
              'obrigatórios; os demais podem ser marcados como "Não se aplica", com justificativa (art. 18, §2º).'
          });
        }

        // --- Campos antigos substituídos pelos incisos IV e V
        M.remover('cfg_Campos', function (c) {
          return c.fluxoId === F && c.etapaCodigo === 'ETP' &&
            (c.chave === 'quantidadesEstimadas' || c.chave === 'pesquisaMercadologica');
        });

        // --- Incisos (ordem da lei). [nº, chave, rótulo, permite NSA, ajuda, valorPadrao]
        var incisos = [
          ['I', 'etpNecessidade', 'DESCRIÇÃO DA NECESSIDADE DA CONTRATAÇÃO', false,
            'Problema a ser resolvido sob a perspectiva do interesse público.', '{{descricaoNecessidade}}'],
          ['II', 'etpPrevisaoPca', 'DEMONSTRATIVO DA PREVISÃO DA CONTRATAÇÃO NO PLANO DE CONTRATAÇÕES ANUAL', true,
            'Demonstração da previsão no PCA, de modo a indicar o seu alinhamento com o planejamento da Administração.', ''],
          ['III', 'etpRequisitos', 'DESCRIÇÃO DOS REQUISITOS DA CONTRATAÇÃO NECESSÁRIOS E SUFICIENTES À ESCOLHA DA SOLUÇÃO', true, '', ''],
          ['IV', 'etpQuantidades', 'ESTIMATIVA DAS QUANTIDADES A SEREM CONTRATADAS', false,
            'Acompanhada das memórias de cálculo e dos documentos que lhe dão suporte.', '{{quantidadeEstimadaDFD}}'],
          ['V', 'etpLevantamentoMercado', 'LEVANTAMENTO DE MERCADO', true,
            'Análise das alternativas possíveis e justificativa técnica e econômica da escolha do tipo de solução.', ''],
          ['VI', 'etpEstimativaValor', 'ESTIMATIVA DO VALOR DA CONTRATAÇÃO', false,
            'Memória de cálculo e documentos de suporte. ETICE: valor da proposta da ETICE. Licitação: média das propostas recebidas.', ''],
          ['VII', 'etpSolucao', 'DESCRIÇÃO DA SOLUÇÃO COMO UM TODO', true,
            'Inclusive das exigências relacionadas à manutenção e à assistência técnica, quando for o caso.', ''],
          ['VIII', 'etpParcelamento', 'JUSTIFICATIVAS PARA O PARCELAMENTO OU NÃO DA SOLUÇÃO', false, '', ''],
          ['IX', 'etpResultados', 'DEMONSTRATIVO DOS RESULTADOS PRETENDIDOS', true,
            'Em termos de economicidade e de melhor aproveitamento dos recursos humanos, materiais e financeiros.', ''],
          ['X', 'etpProvidencias', 'PROVIDÊNCIAS A SEREM ADOTADAS PREVIAMENTE À CELEBRAÇÃO DO CONTRATO', true,
            'Inclusive capacitação de servidores ou empregados para fiscalização e gestão contratual.', ''],
          ['XI', 'etpCorrelatas', 'CONTRATAÇÕES CORRELATAS E/OU INTERDEPENDENTES', true, '', ''],
          ['XII', 'etpImpactosAmbientais', 'DESCRIÇÃO DE POSSÍVEIS IMPACTOS AMBIENTAIS E RESPECTIVAS MEDIDAS MITIGADORAS', true,
            'Incluídos requisitos de baixo consumo de energia e de outros recursos, bem como logística reversa, quando aplicável.', ''],
          ['XIII', 'etpPosicionamento', 'POSICIONAMENTO CONCLUSIVO SOBRE A ADEQUAÇÃO DA CONTRATAÇÃO PARA O ATENDIMENTO DA NECESSIDADE A QUE SE DESTINA', false, '', '']
        ];
        var ordem = 300;
        var campo = function (id, chave, rotulo, tipo, obrig, opcoes, ajuda, valorPadrao) {
          M.upsert('cfg_Campos', {
            id: F + '.ETP.' + id, fluxoId: F, etapaCodigo: 'ETP', chave: chave, rotulo: rotulo, tipo: tipo,
            obrigatorio: obrig, opcoes: opcoes || '', ajuda: ajuda || '', ordem: ordem++, valorPadrao: valorPadrao || ''
          });
        };
        incisos.forEach(function (i) {
          campo(i[0], i[1], i[0] + ' – ' + i[2], 'secaoLei', true, i[3] ? NSA : '', i[4], i[5]);
          if (i[0] === 'II') {
            // campos estruturados (filtros/relatórios) junto ao inciso II
            M.ajustarCampo(F, 'ETP', 'registradoPCA', { ordem: ordem++ });
            M.ajustarCampo(F, 'ETP', 'itemPCA', { ordem: ordem++ });
          }
          if (i[0] === 'V') {
            M.ajustarCampo(F, 'ETP', 'contratadaEtice', {
              ordem: ordem++, rotulo: 'Solução escolhida: contratação direta com a ETICE?',
              ajuda: 'SIM = contratação direta com a ETICE (valor = proposta da ETICE; a instrução exige os documentos da ETICE). ' +
                'NÃO = licitação (valor = média das propostas recebidas).'
            });
            campo('VALOR', 'valorEstimadoEtp', 'Valor estimado da contratação (R$)', 'moeda', true, '',
              'Valor da solução escolhida. O sistema sugere o valor a partir das propostas registradas na pesquisa de preços.',
              '[VALOR_SOLUCAO]');
          }
        });

        // --- Novo tipo de documento
        M.upsert('cfg_DocumentosTipo', {
          codigo: 'JUSTIFICATIVA_DIRETA', nome: 'Justificativa para contratação direta', pasta: 'Justificativa',
          modeloId: '', exigidoInstrucao: true, condicao: 'contratadaEtice == SIM', ordem: 6
        });

        // --- Assinaturas no SUITE (ajuste nomes e cargos na aba cfg_Assinaturas)
        var RT = ['{{responsavelTecnico}}', 'Responsável Técnico – CESOP'];
        var TH = ['Thiago', 'COTIC'];
        var SE = ['Secretário(a)', 'SECEX-PGI'];
        var mapa = {
          DFD: [SE],
          ETP: [RT, TH, SE],
          TR: [RT, TH, SE],
          MAPA_PRECOS: [TH, SE],
          PRE_RESERVA: [TH, SE],
          JUSTIFICATIVA_DIRETA: [RT, TH, SE],
          JUSTIFICATIVA: [RT],
          MODALIDADE_PESQUISA: [RT],
          CONSULTA_ETICE: [RT],
          ANALISE_PROPOSTA: [RT],
          PARECER: [RT]
        };
        Object.keys(mapa).forEach(function (tipo) {
          mapa[tipo].forEach(function (s, i) {
            M.upsert('cfg_Assinaturas', { id: tipo + '.' + (i + 1), tipoDocumento: tipo, ordem: i + 1, signatario: s[0], cargo: s[1] });
          });
        });
      }
    },
    {
      versao: 3,
      descricao: 'DFD: checklist com um único item e quantidade dividida em Quantidade (inteiro) + Unidade de medição (lista)',
      aplicar: function (M) {
        var F = 'CONTRATACAO';

        if (repo('cfg_Etapas').obter(F + '.DFD')) {
          repo('cfg_Etapas').atualizar(F + '.DFD', {
            descricao: 'Documento de Formalização da Demanda, assinado pelo Secretário da unidade demandante.'
          });
        }

        // --- Checklist do DFD: um único item obrigatório
        var itens = repo('cfg_ChecklistItens').filtrar(function (i) { return i.fluxoId === F && i.etapaCodigo === 'DFD'; })
          .sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); });
        var ordemItem = itens.length ? itens[0].ordem : 1;
        itens.forEach(function (i) { repo('cfg_ChecklistItens').remover(i.id); });
        M.upsert('cfg_ChecklistItens', {
          id: F + '.DFD.ASSINADO', fluxoId: F, etapaCodigo: 'DFD',
          descricao: 'Documento assinado pelo Secretário da unidade demandante', obrigatorio: true, ordem: ordemItem
        });

        // --- Quantidade estimada -> Quantidade + Unidade de medição
        var antigo = repo('cfg_Campos').filtrar(function (c) {
          return c.fluxoId === F && c.etapaCodigo === 'DFD' && c.chave === 'quantidadeEstimadaDFD';
        })[0];
        var ordem = antigo ? antigo.ordem : 4;
        if (antigo) repo('cfg_Campos').remover(antigo.id);
        M.upsert('cfg_Campos', {
          id: F + '.DFD.QTD', fluxoId: F, etapaCodigo: 'DFD', chave: 'quantidadeDFD', rotulo: 'Quantidade',
          tipo: 'inteiro', obrigatorio: true, opcoes: '', ajuda: 'Somente números inteiros.', ordem: ordem, valorPadrao: ''
        });
        M.upsert('cfg_Campos', {
          id: F + '.DFD.UNIDADE', fluxoId: F, etapaCodigo: 'DFD', chave: 'unidadeMedidaDFD', rotulo: 'Unidade de medição',
          tipo: 'selecao', obrigatorio: true,
          opcoes: 'UST (Unidade de Serviço Técnico);Ponto de Função;Hora técnica;Unidade;Licença;Usuário;Assinatura;' +
            'Serviço;Mês;Ano;Lote',
          ajuda: 'Lista mantida na aba cfg_Campos (coluna opcoes, separadas por ponto e vírgula).',
          ordem: ordem + 0.5, valorPadrao: ''
        });

        // --- Sugestão do inciso IV do ETP passa a usar os novos campos
        M.ajustarCampo(F, 'ETP', 'etpQuantidades', { valorPadrao: '{{quantidadeDFD}} {{unidadeMedidaDFD}}' });
      }
    },
    {
      versao: 4,
      descricao: 'DFD: Quantidade e Unidade de medição na mesma linha',
      aplicar: function (M) {
        M.ajustarCampo('CONTRATACAO', 'DFD', 'quantidadeDFD', { linha: 'DFD_QTD' });
        M.ajustarCampo('CONTRATACAO', 'DFD', 'unidadeMedidaDFD', { linha: 'DFD_QTD' });
      }
    },
    {
      versao: 5,
      descricao: 'Encaminhar à CECOC após a instrução; análise da proposta e parecer só no pregão (não na contratação direta)',
      aplicar: function (M) {
        var F = 'CONTRATACAO';
        M.upsert('cfg_Etapas', {
          id: F + '.ENVIO_CECOC', fluxoId: F, codigo: 'ENVIO_CECOC', ordem: 185, nome: 'Encaminhar à CECOC',
          fase: 'INSTRUCAO', tipo: 'TAREFA', setor: 'CESOP', prazoDias: 30, blocos: 'D', documentoTipo: '',
          variavelDecisao: '', opcoesDecisao: '',
          descricao: 'Encaminhar o processo instruído à CECOC e registrar o retorno. Pregão: o retorno traz as propostas ' +
            'técnicas e financeiras para análise. Contratação direta: o processo é encerrado no sistema.'
        });
        // Instrução passa a seguir para o encaminhamento à CECOC
        repo('cfg_Transicoes').filtrar(function (t) {
          return t.fluxoId === F && t.origem === 'INSTRUCAO' && t.destino === 'ANALISE_PROPOSTA';
        }).forEach(function (t) { repo('cfg_Transicoes').atualizar(t.id, { destino: 'ENVIO_CECOC' }); });
        M.upsert('cfg_Transicoes', {
          id: F + '.T_CECOC_PREGAO', fluxoId: F, origem: 'ENVIO_CECOC', destino: 'ANALISE_PROPOSTA',
          condicao: 'contratadaEtice != SIM', ordem: 100, rotulo: 'Pregão'
        });
        M.upsert('cfg_Transicoes', {
          id: F + '.T_CECOC_DIRETA', fluxoId: F, origem: 'ENVIO_CECOC', destino: 'FIM',
          condicao: 'contratadaEtice == SIM', ordem: 101, rotulo: 'Contratação direta'
        });
        if (repo('cfg_Etapas').obter(F + '.ANALISE_PROPOSTA')) {
          repo('cfg_Etapas').atualizar(F + '.ANALISE_PROPOSTA', {
            descricao: 'Somente no pregão: analisar as propostas técnicas e financeiras recebidas no retorno da CECOC.'
          });
        }
        if (repo('cfg_Etapas').obter(F + '.PARECER')) {
          repo('cfg_Etapas').atualizar(F + '.PARECER', { descricao: 'Somente no pregão: parecer técnico sobre as propostas analisadas.' });
        }
      }
    },
    {
      versao: 6,
      descricao: 'Mapa comparativo em planilha (Google Sheets), descarte de preços com justificativa e itens padronizados',
      aplicar: function (M) {
        // A coluna PesquisaPrecos.motivoDescarte é criada pela verificação de estrutura (antes das migrações).
        if (repo('cfg_Etapas').obter('CONTRATACAO.MAPA_PRECOS')) {
          repo('cfg_Etapas').atualizar('CONTRATACAO.MAPA_PRECOS', {
            descricao: 'Mapa comparativo gerado em planilha (Google Sheets) a partir das cotações. Preços destoantes ' +
              'podem ser descartados aqui, com justificativa.'
          });
        }
      }
    },
    {
      versao: 7,
      descricao: 'Etapa 1: campo renomeado para "NUP (Número do Processo no SUITE)"',
      aplicar: function (M) {
        M.ajustarCampo('CONTRATACAO', 'ABRIR_SUITE', 'numeroSuite', { rotulo: 'NUP (Número do Processo no SUITE)' });
      }
    },
    {
      versao: 8,
      descricao: 'Ajustes do PO: ETP na numeração 1 a 13 (todos obrigatórios), campos dentro das seções, sugestões corrigidas, ' +
        'DFD sem data pretendida, Código do item só SEPLAG e justificativa para menos de 3 cotações',
      aplicar: function (M) {
        var F = 'CONTRATACAO';
        var remover = function (etapa, chaves) {
          M.remover('cfg_Campos', function (c) { return c.fluxoId === F && c.etapaCodigo === etapa && chaves.indexOf(c.chave) >= 0; });
        };
        var etapa = function (cod, alt) { if (repo('cfg_Etapas').obter(F + '.' + cod)) repo('cfg_Etapas').atualizar(F + '.' + cod, alt); };

        // --- DFD: sem "Data pretendida para a contratação"
        remover('DFD', ['previsaoInicio']);

        // --- ETP: ordem e numeração do documento da CESOP (1 a 13); todos obrigatórios
        //     "Não se aplica" (com justificativa) só onde a Lei permite dispensar (art. 18, §2º)
        var itens = [
          ['etpNecessidade', 'DESCRIÇÃO DA NECESSIDADE DA CONTRATAÇÃO', false],
          ['etpRequisitos', 'DESCRIÇÃO DOS REQUISITOS DA CONTRATAÇÃO NECESSÁRIOS E SUFICIENTES À ESCOLHA DA SOLUÇÃO', true],
          ['etpLevantamentoMercado', 'LEVANTAMENTO DE MERCADO', true],
          ['etpSolucao', 'DESCRIÇÃO DA SOLUÇÃO COMO UM TODO', true],
          ['etpQuantidades', 'ESTIMATIVA DAS QUANTIDADES A SEREM CONTRATADAS', false],
          ['etpEstimativaValor', 'ESTIMATIVA DO VALOR DA CONTRATAÇÃO', false],
          ['etpParcelamento', 'JUSTIFICATIVAS PARA O PARCELAMENTO OU NÃO DA SOLUÇÃO', false],
          ['etpCorrelatas', 'CONTRATAÇÕES CORRELATAS E/OU INTERDEPENDENTES', true],
          ['etpPrevisaoPca', 'DEMONSTRATIVO DA PREVISÃO DA CONTRATAÇÃO', true],
          ['etpResultados', 'DEMONSTRATIVO DOS RESULTADOS PRETENDIDOS', true],
          ['etpProvidencias', 'PROVIDÊNCIAS A SEREM ADOTADAS PREVIAMENTE À CELEBRAÇÃO DO CONTRATO', true],
          ['etpImpactosAmbientais', 'DESCRIÇÃO DE POSSÍVEIS IMPACTOS AMBIENTAIS E RESPECTIVAS MEDIDAS MITIGADORAS', true],
          ['etpPosicionamento', 'POSICIONAMENTO CONCLUSIVO SOBRE A ADEQUAÇÃO DA CONTRATAÇÃO PARA O ATENDIMENTO DA NECESSIDADE A QUE SE DESTINA', false]
        ];
        // Campos complementares que passam a ficar DENTRO de uma seção
        var dentro = {
          etpSolucao: ['contratadaEtice'],
          etpEstimativaValor: ['valorEstimadoEtp'],
          etpPrevisaoPca: ['registradoPCA', 'itemPCA']
        };
        var ordem = 400;
        itens.forEach(function (it, n) {
          M.ajustarCampo(F, 'ETP', it[0], { rotulo: (n + 1) + ') ' + it[1], obrigatorio: true, opcoes: it[2] ? 'NSA' : '', ordem: ordem++ });
          (dentro[it[0]] || []).forEach(function (chave) { M.ajustarCampo(F, 'ETP', chave, { secao: it[0], ordem: ordem++ }); });
        });
        M.ajustarCampo(F, 'ETP', 'etpQuantidades', { valorPadrao: '{{quantidadeDFD|milhar}} {{unidadeMedidaDFD|sigla}}' });
        M.ajustarCampo(F, 'ETP', 'valorEstimadoEtp', { valorPadrao: '[VALOR_SOLUCAO]' }); // sem "=" (o Sheets tratava como fórmula)
        etapa('ETP', {
          descricao: 'Estudo Técnico Preliminar (Lei 14.133/2021, art. 18). Todos os itens devem ser preenchidos. Nos itens ' +
            'dispensáveis é possível marcar "Não se aplica", com justificativa; os itens 1, 5, 6, 7 e 13 são sempre obrigatórios.'
        });

        // --- Código do item: somente o Catálogo SEPLAG; vários itens (um por linha)
        remover('COD_ITEM', ['catalogoItem', 'descricaoItem']);
        M.ajustarCampo(F, 'COD_ITEM', 'codigoItem', {
          rotulo: 'Itens e códigos no Catálogo SEPLAG', tipo: 'textoLongo',
          ajuda: 'Um item por linha, no formato "código – descrição". Anexe o registro (PDF) do catálogo com o código de cada item.'
        });
        etapa('COD_ITEM', { descricao: 'Pesquisar cada item da contratação no Catálogo de itens da SEPLAG e registrar o código.' });

        // --- Pesquisa de preço e Mapa: justificativa para menos de 3 cotações
        M.remover('cfg_ChecklistItens', function (i) {
          return i.fluxoId === F && i.etapaCodigo === 'PESQUISA_PRECO' && /3 cotações/.test(i.descricao);
        });
        var justif = function (cod, id) {
          M.upsert('cfg_Campos', {
            id: F + '.' + cod + '.' + id, fluxoId: F, etapaCodigo: cod, chave: 'justificativaMenos3Cotacoes',
            rotulo: 'Justificativa para menos de 3 cotações', tipo: 'textoLongo', obrigatorio: false, opcoes: '',
            ajuda: 'Obrigatória quando algum item tiver menos de 3 cotações consideradas. Vai para a planilha do mapa.',
            ordem: 500, valorPadrao: '', linha: '', secao: ''
          });
        };
        justif('PESQUISA_PRECO', 'JUSTIF3');
        justif('MAPA_PRECOS', 'JUSTIF3');
        etapa('PESQUISA_PRECO', { blocos: 'E,A,B,C' });
        etapa('MAPA_PRECOS', { blocos: 'M,A,B' });
      }
    },
    {
      versao: 9,
      descricao: 'Ajustes do PO: justificativa da natureza continuada em texto único (com modelo), mapa assinado só pelo Thiago, ' +
        'modalidade com vários parâmetros',
      aplicar: function (M) {
        var F = 'CONTRATACAO';
        var etapa = function (cod, alt) { if (repo('cfg_Etapas').obter(F + '.' + cod)) repo('cfg_Etapas').atualizar(F + '.' + cod, alt); };

        // --- 12) Justificativa: um único texto = documento completo (com modelo sugerido)
        M.ajustarCampo(F, 'JUSTIFICATIVA', 'fundamentacaoContinuidade', {
          rotulo: 'JUSTIFICATIVA DA NATUREZA CONTINUADA', tipo: 'secaoLei', opcoes: '', obrigatorio: true,
          ajuda: 'Texto completo da justificativa. Use o modelo sugerido e complemente com a jurisprudência ou o entendimento aplicável.',
          valorPadrao: 'Trata-se da contratação de {{objeto}}, cuja necessidade é permanente e contínua para a Administração, ' +
            'de modo que a sua interrupção comprometeria a continuidade das atividades da unidade demandante.\n\n' +
            'Nos termos do art. 6º, inciso XV, da Lei nº 14.133/2021, consideram-se serviços e fornecimentos contínuos aqueles ' +
            'contratados pela Administração para a manutenção da atividade administrativa, decorrentes de necessidades permanentes ' +
            'ou prolongadas. O art. 106 da mesma Lei admite a celebração de contratos com prazo de até 5 (cinco) anos nessas hipóteses.\n\n' +
            '[Complementar com a jurisprudência ou o entendimento aplicável.]'
        });
        etapa('JUSTIFICATIVA', { descricao: 'Escreva o texto da justificativa; o documento é gerado a partir dele e assinado no SUITE ' +
          '(botão "Assinar no SUITE"). Não é preciso anexar arquivo.' });

        // --- 13) Mapa: gerado automaticamente a partir das cotações; assinatura só do Thiago (COTIC)
        M.remover('cfg_Assinaturas', function (a) { return a.tipoDocumento === 'MAPA_PRECOS' && /secret/i.test(a.signatario); });
        etapa('MAPA_PRECOS', { descricao: 'A planilha do mapa é gerada automaticamente com as cotações da pesquisa de preços ' +
          '(e refeita se elas mudarem). Preços destoantes podem ser descartados aqui, com justificativa. Assinatura: COTIC.' });

        // --- 14) Modalidade: vários parâmetros (art. 23, §1º)
        M.ajustarCampo(F, 'MODALIDADE', 'modalidadePesquisa', {
          rotulo: 'Parâmetros utilizados na pesquisa de preços', tipo: 'multipla',
          opcoes: 'I – Painel de preços / banco de preços (ex.: Painel de Preços – Compras.gov);' +
            'II – Contratações similares da Administração (ex.: Portal de Compras do Ceará, Portal da Transparência);' +
            'III – Mídia especializada, tabela de referência ou sítios eletrônicos (ex.: Banco de Preços);' +
            'IV – Pesquisa direta com fornecedores (e-mails às empresas);' +
            'V – Base nacional de notas fiscais eletrônicas',
          ajuda: 'Marque todos os parâmetros utilizados (Lei 14.133/2021, art. 23, §1º).'
        });
      }
    },
    {
      versao: 10,
      descricao: 'Ajustes do PO: documentos gerados ao concluir (assinaturas cobradas na instrução), DFD preenchido com os dados ' +
        'do processo, ETP sem "Não se aplica", natureza contínua e justificativa na mesma tela, TR em seções com mapa de riscos, ' +
        'pré-reserva com dotações (Tesouro/BID), CECOC só com envio e "Documento com foto do assinante"',
      aplicar: function (M) {
        var F = 'CONTRATACAO';
        var etapa = function (cod, alt) { if (repo('cfg_Etapas').obter(F + '.' + cod)) repo('cfg_Etapas').atualizar(F + '.' + cod, alt); };
        var campo = function (etapaCod, id, o) {
          M.upsert('cfg_Campos', Object.assign({
            id: F + '.' + etapaCod + '.' + id, fluxoId: F, etapaCodigo: etapaCod, tipo: 'secaoLei', obrigatorio: true,
            opcoes: '', ajuda: '', valorPadrao: '', linha: '', secao: '', condicao: ''
          }, o));
        };

        // --- DFD: unidade demandante e necessidade vêm do "Novo processo" (editáveis)
        M.ajustarCampo(F, 'DFD', 'unidadeDemandante', { valorPadrao: '[AUTO]{{setorDemandante}}' });
        M.ajustarCampo(F, 'DFD', 'descricaoNecessidade', { valorPadrao: '[AUTO]{{objeto}}' });

        // --- ETP: todos os itens obrigatórios, sem "Não se aplica"
        repo('cfg_Campos').filtrar(function (c) { return c.fluxoId === F && c.etapaCodigo === 'ETP' && c.tipo === 'secaoLei'; })
          .forEach(function (c) { repo('cfg_Campos').atualizar(c.id, { opcoes: '', obrigatorio: true }); });
        M.ajustarCampo(F, 'ETP', 'contratadaEtice', {
          ajuda: 'SIM = contratação direta com a ETICE (valor = proposta da ETICE; a instrução exige proposta, estatuto, CND, CRC, ' +
            'documento com foto do assinante do contrato e comprovante de endereço). NÃO = licitação (valor = média das propostas recebidas).'
        });
        etapa('ETP', { descricao: 'Estudo Técnico Preliminar (Lei 14.133/2021, art. 18). Todos os itens são obrigatórios: quando um item ' +
          'não se aplicar, escreva a justificativa no próprio texto. Ao concluir, o documento é gerado automaticamente.' });

        // --- Natureza contínua + justificativa na mesma tela
        var justif = repo('cfg_Campos').filtrar(function (c) {
          return c.fluxoId === F && c.etapaCodigo === 'JUSTIFICATIVA' && c.chave === 'fundamentacaoContinuidade';
        })[0] || {};
        campo('NATUREZA', 'JUSTIF', {
          chave: 'fundamentacaoContinuidade', rotulo: justif.rotulo || 'JUSTIFICATIVA DA NATUREZA CONTINUADA',
          ajuda: justif.ajuda || '', valorPadrao: justif.valorPadrao || '', ordem: 10, condicao: 'naturezaContinua == SIM'
        });
        etapa('NATUREZA', {
          nome: 'Natureza contínua e justificativa', blocos: 'F,A,B', documentoTipo: 'JUSTIFICATIVA',
          descricao: 'O serviço/fornecimento é de natureza continuada? Se SIM, escreva a justificativa logo abaixo: o documento é ' +
            'gerado ao concluir a etapa e assinado no SUITE.'
        });
        repo('cfg_Transicoes').filtrar(function (t) { return t.fluxoId === F && t.origem === 'NATUREZA'; }).forEach(function (t) {
          if (t.destino === 'JUSTIFICATIVA') repo('cfg_Transicoes').remover(t.id);
          else repo('cfg_Transicoes').atualizar(t.id, { condicao: '', rotulo: '' });
        });
        etapa('JUSTIFICATIVA', { descricao: 'Etapa incorporada à "Natureza contínua e justificativa" (mantida só para processos antigos).' });

        // --- TR: seções do Termo de Referência da CESOP + anexos
        var secoesTr = [
          ['trObjeto', '1) DO OBJETO', '{{objeto}}'],
          ['trEspecificacoes', '2) DAS ESPECIFICAÇÕES, QUANTITATIVOS E ESTIMATIVA DO VALOR DA CONTRATAÇÃO', '{{etpQuantidades}}'],
          ['trVigencia', '3) DO PRAZO DE VIGÊNCIA E PRORROGAÇÃO', ''],
          ['trNecessidade', '4) DA DESCRIÇÃO DA NECESSIDADE DA CONTRATAÇÃO', '{{etpNecessidade}}'],
          ['trSolucao', '5) DESCRIÇÃO DA SOLUÇÃO COMO UM TODO CONSIDERANDO TODO O CICLO DE VIDA DO OBJETO', '{{etpSolucao}}'],
          ['trExecucao', '6) DA EXECUÇÃO DO OBJETO', ''],
          ['trGestao', '7) MODELO DE GESTÃO DO CONTRATO', ''],
          ['trRecebimentoPagamento', '8) CONDIÇÕES DE RECEBIMENTO E DE PAGAMENTO', ''],
          ['trObrigacoesContratante', '9) DAS OBRIGAÇÕES DO CONTRATANTE', ''],
          ['trObrigacoesContratado', '10) DAS OBRIGAÇÕES DO CONTRATADO', ''],
          ['trAdequacaoOrcamentaria', '11) DA ADEQUAÇÃO ORÇAMENTÁRIA', '']
        ];
        var ordem = 600;
        secoesTr.forEach(function (x) {
          campo('TR', x[0], { chave: x[0], rotulo: x[1], valorPadrao: x[2], ordem: ordem++ });
          if (x[0] === 'trVigencia') {
            M.ajustarCampo(F, 'TR', 'vigenciaMeses', { rotulo: 'Vigência (meses)', tipo: 'inteiro', secao: 'trVigencia', ordem: ordem++ });
          }
        });
        M.ajustarCampo(F, 'TR', 'especificacaoTecnica', {
          rotulo: '12) ANEXO I – ESPECIFICAÇÃO TÉCNICA DO OBJETO', tipo: 'secaoLei', obrigatorio: true, ordem: ordem++, ajuda: ''
        });
        campo('TR', 'RISCOS', {
          chave: 'trRiscos', rotulo: '12) ANEXO II – LEVANTAMENTO E ANÁLISE DE RISCOS', tipo: 'tabela', ordem: ordem++,
          opcoes: 'risco|Risco|textoLongo;probabilidade|Probabilidade|selecao|Baixa,Média,Alta;impacto|Impacto|selecao|Baixo,Médio,Alto;' +
            'preventiva|Ação preventiva|textoLongo;contingencia|Ação de contingência|textoLongo;responsavel|Responsável|texto',
          ajuda: 'Inclua quantos riscos forem necessários (ao menos um).'
        });
        M.ajustarCampo(F, 'TR', 'sla', {
          rotulo: '12) ANEXO III – ACORDO DE NÍVEIS DE SERVIÇO (ANS)', tipo: 'secaoLei', obrigatorio: false, ordem: ordem++, ajuda: ''
        });
        M.remover('cfg_ChecklistItens', function (i) { return i.fluxoId === F && i.etapaCodigo === 'TR'; });
        etapa('TR', { blocos: 'A,B', descricao: 'Termo de Referência em seções (Lei 14.133/2021, art. 6º, XXIII). O ETP é o anexo IV ' +
          '(já juntado ao processo). Ao concluir, o documento é gerado automaticamente.' });

        // --- Pré-reserva: uma ou mais dotações, com a fonte (Tesouro / BID)
        M.remover('cfg_Campos', function (c) { return c.fluxoId === F && c.etapaCodigo === 'PRE_RESERVA' && c.chave === 'numeroPreReserva'; });
        campo('PRE_RESERVA', 'DOTACOES', {
          chave: 'dotacoes', rotulo: 'Código(s) da(s) Dotação(ões) Orçamentária(s)', tipo: 'tabela', ordem: 1,
          opcoes: 'codigo|Código da dotação orçamentária|texto;fonte|Fonte|selecao|Tesouro,BID',
          ajuda: 'Uma linha por dotação.'
        });

        // --- Instrução: documento de identificação
        if (repo('cfg_DocumentosTipo').obter('ETICE_CNH')) {
          repo('cfg_DocumentosTipo').atualizar('ETICE_CNH', { nome: 'Documento com foto do assinante do contrato' });
        }

        // --- CECOC: basta registrar o envio (se estiver OK, segue para a ASJUR e não volta)
        etapa('ENVIO_CECOC', {
          blocos: 'N,B', descricao: 'Registrar o envio do processo instruído à CECOC. Não é preciso aguardar retorno: pendências da ' +
            'CECOC entram na aba Diligências. Pregão: segue para a análise das propostas recebidas. Contratação direta: o processo é encerrado no sistema.'
        });
      }
    }
  ]
};
