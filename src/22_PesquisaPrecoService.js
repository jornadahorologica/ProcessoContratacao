/**
 * Pesquisa de preços (cotações) e Mapa Comparativo.
 *
 * Fontes conforme Lei 14.133/2021, art. 23, §1º (painel de preços,
 * contratações similares, mídia especializada/sítios, fornecedores, notas
 * fiscais) e as do fluxo da CESOP (contratos equivalentes, cotação
 * eletrônica, marketplace).
 */
var PesquisaPrecoService = {
  FONTES: ['Contrato equivalente', 'Painel de Preços / Compras.gov', 'Cotação eletrônica', 'Marketplace',
    'Fornecedor (cotação direta)', 'Mídia especializada / sítio eletrônico', 'Nota fiscal', 'Outra'],
  METODOS: { MEDIA: 'Média', MEDIANA: 'Mediana', MENOR: 'Menor preço' },

  listar: function (processoId) {
    return repo('PesquisaPrecos').onde({ processoId: processoId });
  },

  salvar: function (processoId, c) {
    if (Utils.vazio(c.item)) throw Utils.erro('Informe o item.');
    var valor = daCelula_(c.valorUnitario, 'n');
    if (valor === null || valor < 0) throw Utils.erro('Valor unitário inválido.');
    var dados = {
      item: String(c.item).trim(),
      descricao: c.descricao || '',
      unidade: c.unidade || '',
      quantidade: daCelula_(c.quantidade, 'n') || 1,
      fonte: c.fonte || '',
      fornecedor: c.fornecedor || '',
      cnpj: c.cnpj || '',
      valorUnitario: valor,
      dataCotacao: c.dataCotacao || '',
      referencia: c.referencia || '',
      considerado: c.considerado === undefined ? true : (c.considerado === true || c.considerado === 'true'),
      observacao: c.observacao || ''
    };
    var r = repo('PesquisaPrecos');
    var reg;
    if (c.id) {
      reg = r.atualizar(c.id, dados);
    } else {
      dados.processoId = processoId;
      dados.criadoEm = Utils.agora();
      dados.criadoPor = Auth.email();
      reg = r.inserir(dados);
    }
    Historico.registrar(processoId, '', c.id ? 'COTACAO_ALTERADA' : 'COTACAO_REGISTRADA',
      dados.item + ' — ' + dados.fornecedor + ' — R$ ' + valor);
    return reg;
  },

  remover: function (id) {
    var c = repo('PesquisaPrecos').obterOuFalhar(id);
    repo('PesquisaPrecos').remover(id);
    Historico.registrar(c.processoId, '', 'COTACAO_REMOVIDA', c.item + ' — ' + c.fornecedor);
  },

  /**
   * Estatísticas por item. Valores fora de ±limite em relação à mediana são
   * sinalizados como "destoantes" para análise crítica (não são descartados
   * automaticamente: o analista decide desmarcando "considerado").
   */
  calcularMapa: function (processoId, metodo) {
    metodo = this.METODOS[metodo] ? metodo : 'MEDIA'; // padrão: média das propostas
    var limite = Number(PropertiesService.getScriptProperties().getProperty(APP.PROP.LIMITE_DESVIO_MAPA)) || 0.25;
    var grupos = Utils.agrupar(this.listar(processoId), function (c) { return c.item; });
    var itens = Object.keys(grupos).sort().map(function (nome) {
      var todas = grupos[nome];
      var cons = todas.filter(function (c) { return c.considerado; });
      var v = cons.map(function (c) { return c.valorUnitario; }).sort(function (a, b) { return a - b; });
      var n = v.length;
      var soma = v.reduce(function (a, b) { return a + b; }, 0);
      var media = n ? soma / n : 0;
      var mediana = !n ? 0 : (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2);
      var dp = n > 1 ? Math.sqrt(v.reduce(function (a, x) { return a + Math.pow(x - media, 2); }, 0) / (n - 1)) : 0;
      var estimado = metodo === 'MEDIA' ? media : metodo === 'MENOR' ? (n ? v[0] : 0) : mediana;
      var qtd = todas[0].quantidade || 1;
      return {
        item: nome,
        descricao: todas[0].descricao,
        unidade: todas[0].unidade,
        quantidade: qtd,
        n: n,
        menor: n ? v[0] : 0,
        maior: n ? v[n - 1] : 0,
        media: media,
        mediana: mediana,
        desvioPadrao: dp,
        coefVariacao: media ? dp / media : 0,
        valorUnitarioEstimado: estimado,
        valorTotalEstimado: estimado * qtd,
        cotacoes: todas.map(function (c) {
          return {
            id: c.id, fornecedor: c.fornecedor, fonte: c.fonte, valorUnitario: c.valorUnitario,
            considerado: c.considerado, dataCotacao: c.dataCotacao,
            destoante: mediana > 0 && Math.abs(c.valorUnitario - mediana) / mediana > limite
          };
        })
      };
    });
    var total = itens.reduce(function (a, i) { return a + i.valorTotalEstimado; }, 0);
    return { metodo: metodo, metodoNome: this.METODOS[metodo], limiteDesvio: limite, itens: itens, total: total };
  },

  /** Gera o Mapa Comparativo (Google Docs) na pasta do tipo MAPA_PRECOS e atualiza o valor estimado. */
  gerarMapa: function (processoId, metodo, tarefaId) {
    var proc = repo('Processos').obterOuFalhar(processoId);
    var mapa = this.calcularMapa(processoId, metodo);
    if (!mapa.itens.length) throw Utils.erro('Não há cotações registradas.');
    var brl = function (v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); };
    var versao = DocumentoService._proximaVersao(proc.id, 'MAPA_PRECOS');
    var nome = 'Mapa Comparativo de Preços - ' + proc.numero + (versao > 1 ? ' (v' + versao + ')' : '');
    var doc = DocumentApp.create(nome);
    var b = doc.getBody();
    b.appendParagraph('Mapa Comparativo de Preços').setHeading(DocumentApp.ParagraphHeading.TITLE);
    b.appendParagraph('Processo ' + proc.numero + ' — ' + proc.titulo);
    b.appendParagraph('Método de estimativa: ' + mapa.metodoNome +
      '. Valores com variação superior a ' + Math.round(mapa.limiteDesvio * 100) + '% da mediana estão sinalizados (*).');
    mapa.itens.forEach(function (i) {
      b.appendParagraph(i.item + (i.descricao ? ' — ' + i.descricao : '')).setHeading(DocumentApp.ParagraphHeading.HEADING2);
      var linhas = [['Fornecedor', 'Fonte', 'Data', 'Valor unitário', 'Considerado']];
      i.cotacoes.forEach(function (c) {
        linhas.push([c.fornecedor || '-', c.fonte || '-', c.dataCotacao || '-',
          brl(c.valorUnitario) + (c.destoante ? ' *' : ''), c.considerado ? 'Sim' : 'Não']);
      });
      b.appendTable(linhas);
      b.appendParagraph('Cotações consideradas: ' + i.n + ' | Menor: ' + brl(i.menor) + ' | Média: ' + brl(i.media) +
        ' | Mediana: ' + brl(i.mediana) + ' | CV: ' + (i.coefVariacao * 100).toFixed(1) + '%');
      b.appendParagraph('Valor unitário estimado: ' + brl(i.valorUnitarioEstimado) + ' × ' + i.quantidade +
        ' ' + (i.unidade || '') + ' = ' + brl(i.valorTotalEstimado));
    });
    b.appendParagraph('VALOR TOTAL ESTIMADO: ' + brl(mapa.total)).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    doc.saveAndClose();
    DriveService.mover(doc.getId(), DriveService.pastaDoTipo(proc, 'MAPA_PRECOS'));
    var tarefa = tarefaId ? repo('Tarefas').obter(tarefaId) : null;
    var reg = repo('Documentos').inserir({
      processoId: proc.id, tarefaId: tarefaId || '', etapaCodigo: tarefa ? tarefa.etapaCodigo : '',
      tipoCodigo: 'MAPA_PRECOS', nome: nome, fileId: doc.getId(), url: DriveApp.getFileById(doc.getId()).getUrl(),
      mimeType: 'application/vnd.google-apps.document', origem: 'GERADO', status: 'RASCUNHO', versao: versao,
      criadoEm: Utils.agora(), criadoPor: Auth.email()
    });
    repo('Processos').atualizar(proc.id, { valorEstimado: Math.round(mapa.total * 100) / 100, atualizadoEm: Utils.agora() });
    Variaveis.definir(proc.id, 'metodoEstimativa', mapa.metodo, tarefa ? tarefa.etapaCodigo : '');
    Historico.registrar(proc.id, tarefaId, 'MAPA_GERADO', nome + ' — total ' + brl(mapa.total));
    return reg;
  }
};
