/**
 * Carga inicial da configuração: o fluxo de contratação da CESOP conforme o
 * fluxograma (raia CESOP). Depois da carga, o fluxo é mantido diretamente
 * nas abas cfg_* da planilha; este arquivo serve apenas para o setup inicial.
 *
 * Pontos a confirmar com a área (ver docs/ARQUITETURA.md):
 *  - ramo "BID = SIM" (não aparece no fluxograma): modelado como a etapa
 *    BID_TRAMITE (aguardar não objeção) antes da pré-reserva;
 *  - setores e prazos de cada etapa (valores iniciais estimados).
 */
var Seed = {
  FLUXO: 'CONTRATACAO',

  fases: function () {
    return [
      ['ABERTURA', 'Abertura', 1],
      ['PLANEJAMENTO', 'Planejamento (DFD/ETICE/ETP)', 2],
      ['PESQUISA', 'Pesquisa e justificativas', 3],
      ['ESPECIFICACAO', 'Termo de Referência', 4],
      ['ORCAMENTO', 'Orçamento e pré-reserva', 5],
      ['INSTRUCAO', 'Instrução processual', 6],
      ['ANALISE', 'Análise e parecer', 7],
      ['CONCLUIDO', 'Concluído', 99]
    ].map(function (f) { return { codigo: f[0], nome: f[1], ordem: f[2] }; });
  },

  etapas: function () {
    // codigo, ordem, nome, fase, tipo, setor, prazoDias, blocos, documentoTipo, variavelDecisao, opcoesDecisao, descricao
    return [
      ['ABRIR_SUITE', 10, 'Abrir processo SUITE', 'ABERTURA', 'TAREFA', 'CESOP', 2, 'A', '', '', '', 'Registrar a abertura do processo no SUITE.'],
      ['DFD', 20, 'Elaborar DFD', 'PLANEJAMENTO', 'TAREFA', 'CESOP', 5, 'A,B,C', 'DFD', '', '', 'Documento de Formalização da Demanda + requerimento do secretário.'],
      ['CONSULTA_ETICE', 30, 'Realizar consulta prévia ETICE', 'PLANEJAMENTO', 'TAREFA', 'CESOP', 10, 'D,A,B', 'CONSULTA_ETICE', '', '', 'Enviar consulta à ETICE e registrar o retorno.'],
      ['ETP', 40, 'Elaborar ETP', 'PLANEJAMENTO', 'TAREFA', 'CESOP', 10, 'A,B,C', 'ETP', '', '', 'Quantidades estimadas, pesquisa mercadológica, registro no PCA.'],
      ['PARALELO_1', 50, 'Início das atividades paralelas', 'PESQUISA', 'PARALELO', '', 0, '', '', '', '', ''],
      ['NATUREZA', 60, 'Natureza contínua?', 'PESQUISA', 'DECISAO', 'CESOP', 2, 'F', '', 'naturezaContinua', 'SIM,NAO', 'O serviço/fornecimento é de natureza continuada?'],
      ['JUSTIFICATIVA', 70, 'Elaborar Justificativa', 'PESQUISA', 'TAREFA', 'CESOP', 5, 'A,B', 'JUSTIFICATIVA', '', '', 'Justificativa da natureza continuada.'],
      ['COD_ITEM', 80, 'Pesquisar Código do Item', 'PESQUISA', 'TAREFA', 'CESOP', 3, 'A,B', 'COD_ITEM', '', '', 'Código do item no catálogo (SEPLAG/CATMAT/CATSER).'],
      ['PESQUISA_PRECO', 90, 'Realizar Pesquisa de Preço', 'PESQUISA', 'TAREFA', 'CESOP', 10, 'E,B,C', 'ORCAMENTO', '', '', 'Contratos equivalentes, cotação eletrônica, marketplace.'],
      ['MAPA_PRECOS', 100, 'Elaborar Mapa Comparativo', 'PESQUISA', 'TAREFA', 'CESOP', 3, 'M,B', 'MAPA_PRECOS', '', '', 'Mapa comparativo gerado a partir das cotações.'],
      ['MODALIDADE', 110, 'Elaborar Modalidade de Pesquisa de Preços', 'PESQUISA', 'TAREFA', 'CESOP', 3, 'A,B', 'MODALIDADE_PESQUISA', '', '', 'Metodologia/parâmetros da pesquisa de preços.'],
      ['JUNCAO_1', 120, 'Fim das atividades paralelas', 'PESQUISA', 'JUNCAO', '', 0, '', '', '', '', ''],
      ['TR', 130, 'Elaborar TR', 'ESPECIFICACAO', 'TAREFA', 'CESOP', 10, 'A,B,C', 'TR', '', '', 'Especificação técnica, vigências, SLA, mapa de riscos.'],
      ['DOTACAO', 140, 'Solicitar Dotação Orçamentária', 'ORCAMENTO', 'TAREFA', 'CESOP', 5, 'D,A,B', 'DOTACAO', '', '', 'Enviar ETP + TR e registrar a dotação.'],
      ['BID', 150, 'Contratação BID?', 'ORCAMENTO', 'DECISAO', 'CESOP', 1, 'F', '', 'bid', 'SIM,NAO', 'A contratação é financiada pelo BID?'],
      ['BID_TRAMITE', 160, 'Tramitação BID (não objeção)', 'ORCAMENTO', 'TAREFA', 'CESOP', 15, 'D,B', 'BID_NAO_OBJECAO', '', '', 'Ramo BID — a detalhar com a área.'],
      ['PRE_RESERVA', 170, 'Elaborar Formulário Pré-Reserva', 'ORCAMENTO', 'TAREFA', 'CESOP', 3, 'A,B', 'PRE_RESERVA', '', '', ''],
      ['INSTRUCAO', 180, 'Concluir instrução processual', 'INSTRUCAO', 'TAREFA', 'CESOP', 3, 'I,B,C', '', '', '', 'Conferência dos documentos obrigatórios.'],
      ['ANALISE_PROPOSTA', 190, 'Analisar proposta técnica e financeira', 'ANALISE', 'TAREFA', 'CESOP', 5, 'A,B', 'ANALISE_PROPOSTA', '', '', ''],
      ['PARECER', 200, 'Emitir Parecer Técnico', 'ANALISE', 'TAREFA', 'CESOP', 3, 'A,B', 'PARECER', '', '', ''],
      ['FIM', 999, 'Fim', 'CONCLUIDO', 'FIM', '', 0, '', '', '', '', '']
    ].map(function (e) {
      return {
        id: Seed.FLUXO + '.' + e[0], fluxoId: Seed.FLUXO, codigo: e[0], ordem: e[1], nome: e[2], fase: e[3],
        tipo: e[4], setor: e[5], prazoDias: e[6], blocos: e[7], documentoTipo: e[8], variavelDecisao: e[9],
        opcoesDecisao: e[10], descricao: e[11]
      };
    });
  },

  transicoes: function () {
    // origem, destino, condicao, rotulo
    return [
      ['ABRIR_SUITE', 'DFD', '', ''],
      ['DFD', 'CONSULTA_ETICE', '', ''],
      ['CONSULTA_ETICE', 'ETP', '', ''],
      ['ETP', 'PARALELO_1', '', ''],
      ['PARALELO_1', 'NATUREZA', '', ''],
      ['PARALELO_1', 'COD_ITEM', '', ''],
      ['PARALELO_1', 'PESQUISA_PRECO', '', ''],
      ['NATUREZA', 'JUSTIFICATIVA', 'naturezaContinua == SIM', 'Sim'],
      ['NATUREZA', 'JUNCAO_1', 'naturezaContinua == NAO', 'Não'],
      ['JUSTIFICATIVA', 'JUNCAO_1', '', ''],
      ['COD_ITEM', 'JUNCAO_1', '', ''],
      ['PESQUISA_PRECO', 'MAPA_PRECOS', '', ''],
      ['MAPA_PRECOS', 'MODALIDADE', '', ''],
      ['MODALIDADE', 'JUNCAO_1', '', ''],
      ['JUNCAO_1', 'TR', '', ''],
      ['TR', 'DOTACAO', '', ''],
      ['DOTACAO', 'BID', '', ''],
      ['BID', 'BID_TRAMITE', 'bid == SIM', 'Sim'],
      ['BID', 'PRE_RESERVA', 'bid == NAO', 'Não'],
      ['BID_TRAMITE', 'PRE_RESERVA', '', ''],
      ['PRE_RESERVA', 'INSTRUCAO', '', ''],
      ['INSTRUCAO', 'ANALISE_PROPOSTA', '', ''],
      ['ANALISE_PROPOSTA', 'PARECER', '', ''],
      ['PARECER', 'FIM', '', '']
    ].map(function (t, i) {
      return { id: Seed.FLUXO + '.T' + (i + 1), fluxoId: Seed.FLUXO, origem: t[0], destino: t[1], condicao: t[2], ordem: i + 1, rotulo: t[3] };
    });
  },

  campos: function () {
    // etapa, chave, rotulo, tipo, obrigatorio, opcoes, ajuda
    var MODALIDADES = 'Painel de Preços/Compras.gov (art. 23, §1º, I);Contratações similares (II);' +
      'Mídia especializada / sítios eletrônicos (III);Cotação direta com fornecedores (IV);' +
      'Notas fiscais (V);Combinação de parâmetros';
    return [
      ['ABRIR_SUITE', 'numeroSuite', 'Número do processo SUITE', 'texto', true, '', ''],
      ['ABRIR_SUITE', 'dataAberturaSuite', 'Data de abertura no SUITE', 'data', true, '', ''],

      ['DFD', 'unidadeDemandante', 'Unidade demandante', 'texto', true, '', ''],
      ['DFD', 'descricaoNecessidade', 'Descrição da necessidade', 'textoLongo', true, '', ''],
      ['DFD', 'quantidadeEstimadaDFD', 'Quantidade estimada', 'textoLongo', false, '', ''],
      ['DFD', 'previsaoInicio', 'Data pretendida para a contratação', 'data', false, '', ''],
      ['DFD', 'grauPrioridade', 'Grau de prioridade', 'selecao', true, 'Alta;Média;Baixa', ''],

      ['CONSULTA_ETICE', 'resultadoConsultaEtice', 'Resultado da consulta', 'selecao', true,
        'Favorável;Favorável com ressalvas;Desfavorável', ''],
      ['CONSULTA_ETICE', 'observacaoEtice', 'Observações da ETICE', 'textoLongo', false, '', ''],

      ['ETP', 'quantidadesEstimadas', 'Quantidades estimadas', 'textoLongo', true, '', ''],
      ['ETP', 'pesquisaMercadologica', 'Pesquisa mercadológica (resumo)', 'textoLongo', true, '', ''],
      ['ETP', 'registradoPCA', 'Registrado no PCA?', 'simNao', true, '', 'Plano de Contratações Anual'],
      ['ETP', 'itemPCA', 'Item / referência no PCA', 'texto', false, '', ''],
      ['ETP', 'contratadaEtice', 'Contratação direta com a ETICE?', 'simNao', true, '',
        'Se SIM, a instrução exige proposta, estatuto, CND, CRC, CNH e comprovante de endereço.'],

      ['JUSTIFICATIVA', 'fundamentacaoContinuidade', 'Fundamentação da natureza continuada', 'textoLongo', true, '', ''],

      ['COD_ITEM', 'codigoItem', 'Código do item', 'texto', true, '', ''],
      ['COD_ITEM', 'catalogoItem', 'Catálogo', 'selecao', true, 'SEPLAG;CATMAT;CATSER', ''],
      ['COD_ITEM', 'descricaoItem', 'Descrição do item no catálogo', 'texto', false, '', ''],

      ['MODALIDADE', 'modalidadePesquisa', 'Parâmetro(s) da pesquisa de preços', 'selecao', true, MODALIDADES, 'Lei 14.133/2021, art. 23'],
      ['MODALIDADE', 'justificativaMetodologia', 'Justificativa da metodologia', 'textoLongo', false, '', ''],

      ['TR', 'especificacaoTecnica', 'Especificação técnica (resumo)', 'textoLongo', true, '', ''],
      ['TR', 'vigenciaMeses', 'Vigência (meses)', 'numero', true, '', ''],
      ['TR', 'sla', 'Níveis de serviço (SLA)', 'textoLongo', false, '', ''],

      ['DOTACAO', 'programa', 'Programa', 'texto', true, '', 'Ex.: 412'],
      ['DOTACAO', 'acao', 'Ação / projeto-atividade', 'texto', false, '', ''],
      ['DOTACAO', 'fonteRecurso', 'Fonte de recurso', 'texto', false, '', ''],
      ['DOTACAO', 'valorDotacao', 'Valor da dotação', 'moeda', true, '', ''],

      ['PRE_RESERVA', 'numeroPreReserva', 'Número da pré-reserva', 'texto', true, '', ''],

      ['ANALISE_PROPOSTA', 'resultadoAnalise', 'Resultado da análise', 'selecao', true,
        'Aprovada;Aprovada com ressalvas;Reprovada', ''],
      ['ANALISE_PROPOSTA', 'valorProposta', 'Valor da proposta', 'moeda', false, '', ''],

      ['PARECER', 'conclusaoParecer', 'Conclusão do parecer', 'selecao', true, 'Favorável;Favorável com ressalvas;Desfavorável', '']
    ].map(function (c, i) {
      return {
        id: Seed.FLUXO + '.C' + (i + 1), fluxoId: Seed.FLUXO, etapaCodigo: c[0], chave: c[1], rotulo: c[2],
        tipo: c[3], obrigatorio: c[4], opcoes: c[5], ajuda: c[6], ordem: i + 1
      };
    });
  },

  checklist: function () {
    return [
      ['DFD', 'Requerimento do secretário assinado e anexado', true],
      ['DFD', 'DFD assinado pela unidade demandante', false],
      ['ETP', 'ETP revisado pela equipe de planejamento', false],
      ['PESQUISA_PRECO', 'Mínimo de 3 cotações por item (ou justificativa registrada)', false],
      ['TR', 'Mapa de riscos elaborado', true],
      ['TR', 'Vigência e SLA definidos', true],
      ['INSTRUCAO', 'Documentos juntados ao processo SUITE', true]
    ].map(function (c, i) {
      return { id: Seed.FLUXO + '.K' + (i + 1), fluxoId: Seed.FLUXO, etapaCodigo: c[0], descricao: c[1], obrigatorio: c[2], ordem: i + 1 };
    });
  },

  tiposDocumento: function () {
    var ETICE = 'contratadaEtice == SIM';
    // codigo, nome, pasta, exigidoInstrucao, condicao
    return [
      ['DFD', 'DFD - Documento de Formalização da Demanda', '', true, ''],
      ['REQUERIMENTO', 'Requerimento do Secretário', 'Documentos auxiliares', false, ''],
      ['CONSULTA_ETICE', 'Consulta prévia ETICE', 'Consulta Prévia', true, ''],
      ['ETP', 'ETP - Estudo Técnico Preliminar', 'ETP e TR', true, ''],
      ['JUSTIFICATIVA', 'Justificativa (natureza continuada)', 'Justificativa', true, 'naturezaContinua == SIM'],
      ['COD_ITEM', 'Código do item', '', true, ''],
      ['ORCAMENTO', 'Orçamento / cotação', 'Orçamento', true, ''],
      ['MAPA_PRECOS', 'Mapa comparativo de preços', 'Orçamento', true, ''],
      ['MODALIDADE_PESQUISA', 'Modalidade de pesquisa de preços', 'Orçamento', true, ''],
      ['TR', 'TR - Termo de Referência', 'ETP e TR', true, ''],
      ['DOTACAO', 'Dotação orçamentária', '', true, ''],
      ['BID_NAO_OBJECAO', 'Não objeção BID', 'Documentos auxiliares', true, 'bid == SIM'],
      ['PRE_RESERVA', 'Formulário de pré-reserva', '', true, ''],
      ['ETICE_PROPOSTA', 'Proposta ETICE', 'Propostas', true, ETICE],
      ['ETICE_ESTATUTO', 'Estatuto ETICE', 'Documentos auxiliares', true, ETICE],
      ['ETICE_CND', 'CND (Certidão Negativa de Débitos)', 'Documentos auxiliares', true, ETICE],
      ['ETICE_CRC', 'CRC (Certificado de Registro Cadastral)', 'Documentos auxiliares', true, ETICE],
      ['ETICE_CNH', 'CNH do representante legal', 'Documentos auxiliares', true, ETICE],
      ['ETICE_ENDERECO', 'Comprovante de endereço', 'Documentos auxiliares', true, ETICE],
      ['PROPOSTA', 'Proposta técnica e financeira', 'Propostas', false, ''],
      ['ANALISE_PROPOSTA', 'Análise da proposta técnica e financeira', 'Propostas', false, ''],
      ['PARECER', 'Parecer técnico', '', false, ''],
      ['RESPOSTA_DESPACHO', 'Resposta a despacho / diligência', 'Diligências', false, ''],
      ['OUTRO', 'Outro documento', 'Documentos auxiliares', false, '']
    ].map(function (d, i) {
      return { codigo: d[0], nome: d[1], pasta: d[2], modeloId: '', exigidoInstrucao: d[3], condicao: d[4], ordem: i + 1 };
    });
  },

  pastas: function () {
    return ['Consulta Prévia', 'Documentos auxiliares', 'ETP e TR', 'Justificativa', 'Orçamento', 'Propostas', 'Diligências']
      .map(function (n, i) { return { id: Seed.FLUXO + '.P' + (i + 1), fluxoId: Seed.FLUXO, nome: n, ordem: i + 1 }; });
  },

  fluxos: function () {
    return [{ id: Seed.FLUXO, nome: 'Contratação (CESOP)', descricao: 'Fluxo de contratação conforme fluxograma da CESOP',
      etapaInicial: 'ABRIR_SUITE', ativo: true }];
  },

  /** Carrega todas as tabelas de configuração que estiverem vazias. */
  carregar: function () {
    var cargas = {
      cfg_Fluxos: this.fluxos(), cfg_Etapas: this.etapas(), cfg_Transicoes: this.transicoes(),
      cfg_Campos: this.campos(), cfg_ChecklistItens: this.checklist(), cfg_DocumentosTipo: this.tiposDocumento(),
      cfg_Pastas: this.pastas(), cfg_Fases: this.fases()
    };
    var resumo = [];
    Object.keys(cargas).forEach(function (t) {
      var r = repo(t);
      if (r.todos().length) { resumo.push(t + ': já possui dados (mantido)'); return; }
      var sh = Db.aba(t);
      var linhas = cargas[t].map(function (o) { r._carregar(); return r._linhaPlanilha(o); });
      if (linhas.length) {
        sh.getRange(2, 1, linhas.length, linhas[0].length).setNumberFormat('@').setValues(linhas);
      }
      r._linhas = null;
      resumo.push(t + ': ' + linhas.length + ' registros');
    });
    return resumo;
  }
};
