/**
 * Pesquisa de preços (cotações) e Mapa Comparativo.
 *
 * Fontes conforme Lei 14.133/2021, art. 23, §1º (painel de preços,
 * contratações similares, mídia especializada/sítios, fornecedores, notas
 * fiscais) e as do fluxo da CESOP (contratos equivalentes, cotação
 * eletrônica, marketplace).
 *
 * Regras do mapa:
 *  - as cotações são agrupadas por ITEM (nome sem diferença de maiúsculas e
 *    espaços); todas as cotações de um item têm a mesma unidade e quantidade;
 *  - preços com variação maior que LIMITE_DESVIO_MAPA (padrão 25%) em relação
 *    à mediana são sinalizados como destoantes; descartar um preço exige
 *    justificativa (fica registrada na planilha e no histórico);
 *  - o mapa é gerado como PLANILHA (Google Sheets) com as abas "Mapa" e "Cotações";
 *  - na contratação direta (ETICE) o total do mapa NÃO substitui o valor
 *    estimado do processo (que é o da proposta da ETICE).
 */
var PesquisaPrecoService = {
  FONTES: ['Contrato equivalente', 'Painel de Preços / Compras.gov', 'Cotação eletrônica', 'Marketplace',
    'Fornecedor (cotação direta)', 'Mídia especializada / sítio eletrônico', 'Nota fiscal', 'Outra'],
  METODOS: { MEDIA: 'Média', MEDIANA: 'Mediana', MENOR: 'Menor preço' },
  MIME_PLANILHA: 'application/vnd.google-apps.spreadsheet',

  listar: function (processoId) {
    return repo('PesquisaPrecos').onde({ processoId: processoId });
  },

  /** Chave de agrupamento do item: sem diferença de maiúsculas e de espaços repetidos. */
  chaveItem: function (nome) {
    return String(nome || '').trim().replace(/\s+/g, ' ').toUpperCase();
  },

  /** Itens já cadastrados no processo: {chave: {item, unidade, quantidade, descricao}} */
  itens: function (processoId, ignorarId) {
    var self = this;
    var r = {};
    this.listar(processoId).forEach(function (c) {
      if (c.id === ignorarId) return;
      var k = self.chaveItem(c.item);
      if (!r[k]) r[k] = { item: c.item, unidade: c.unidade, quantidade: c.quantidade, descricao: c.descricao };
    });
    return r;
  },

  salvar: function (processoId, c) {
    if (Utils.vazio(c.item)) throw Utils.erro('Informe o item.');
    var valor = daCelula_(c.valorUnitario, 'n');
    if (valor === null || valor < 0) throw Utils.erro('Valor unitário inválido.');
    var item = String(c.item).trim().replace(/\s+/g, ' ');
    var unidade = String(c.unidade || '').trim();
    var quantidade = daCelula_(c.quantidade, 'n');

    // Mesmo item => mesmo nome, unidade e quantidade das cotações já registradas
    var existente = this.itens(processoId, c.id)[this.chaveItem(item)];
    if (existente) {
      item = existente.item;
      if (!unidade) unidade = existente.unidade;
      if (quantidade === null) quantidade = existente.quantidade;
      if (this.chaveItem(unidade) !== this.chaveItem(existente.unidade)) {
        throw Utils.erro('O item "' + item + '" já está registrado com a unidade "' + (existente.unidade || '—') +
          '". Use a mesma unidade em todas as cotações do item.');
      }
      if (Number(quantidade) !== Number(existente.quantidade)) {
        throw Utils.erro('O item "' + item + '" já está registrado com a quantidade ' + existente.quantidade +
          '. Use a mesma quantidade em todas as cotações do item.');
      }
    }
    var dados = {
      item: item,
      descricao: c.descricao || (existente ? existente.descricao : ''),
      unidade: unidade,
      quantidade: quantidade === null ? 1 : quantidade,
      fonte: c.fonte || '',
      fornecedor: c.fornecedor || '',
      cnpj: c.cnpj || '',
      valorUnitario: valor,
      dataCotacao: c.dataCotacao || '',
      referencia: c.referencia || '',
      observacao: c.observacao || ''
    };
    var r = repo('PesquisaPrecos');
    var reg;
    if (c.id) {
      reg = r.atualizar(c.id, dados);
    } else {
      dados.processoId = processoId;
      dados.considerado = true;
      dados.criadoEm = Utils.agora();
      dados.criadoPor = Auth.email();
      reg = r.inserir(dados);
    }
    Variaveis.definir(processoId, 'cotacoesAlteradasEm', Utils.agora(), '');
    Historico.registrar(processoId, '', c.id ? 'COTACAO_ALTERADA' : 'COTACAO_REGISTRADA',
      dados.item + ' — ' + dados.fornecedor + ' — R$ ' + valor);
    return reg;
  },

  /** Considera ou descarta uma cotação no cálculo do mapa. Descartar exige justificativa. */
  considerar: function (id, considerado, motivo) {
    var c = repo('PesquisaPrecos').obterOuFalhar(id);
    considerado = considerado === true || considerado === 'true';
    if (!considerado && Utils.vazio(motivo)) throw Utils.erro('Informe o motivo do descarte da cotação.');
    var reg = repo('PesquisaPrecos').atualizar(id, { considerado: considerado, motivoDescarte: considerado ? '' : String(motivo).trim() });
    Variaveis.definir(c.processoId, 'cotacoesAlteradasEm', Utils.agora(), '');
    Historico.registrar(c.processoId, '', considerado ? 'COTACAO_CONSIDERADA' : 'COTACAO_DESCARTADA',
      c.item + ' — ' + c.fornecedor + ' — R$ ' + c.valorUnitario + (considerado ? '' : ' — Motivo: ' + motivo));
    return reg;
  },

  remover: function (id) {
    var c = repo('PesquisaPrecos').obterOuFalhar(id);
    repo('PesquisaPrecos').remover(id);
    Variaveis.definir(c.processoId, 'cotacoesAlteradasEm', Utils.agora(), '');
    Historico.registrar(c.processoId, '', 'COTACAO_REMOVIDA', c.item + ' — ' + c.fornecedor);
  },

  /**
   * Estatísticas por item. Valores fora de ±limite em relação à mediana são
   * sinalizados como "destoantes" para análise crítica (não são descartados
   * automaticamente: o analista decide e justifica).
   */
  calcularMapa: function (processoId, metodo) {
    metodo = this.METODOS[metodo] ? metodo : 'MEDIA'; // padrão: média das propostas
    var limite = Number(Utils.prop(APP.PROP.LIMITE_DESVIO_MAPA)) || 0.25;
    var self = this;
    var grupos = Utils.agrupar(this.listar(processoId), function (c) { return self.chaveItem(c.item); });
    var itens = Object.keys(grupos).sort().map(function (chave) {
      var todas = grupos[chave];
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
        item: todas[0].item,
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
            id: c.id, fornecedor: c.fornecedor, fonte: c.fonte, valorUnitario: c.valorUnitario, cnpj: c.cnpj,
            considerado: c.considerado, motivoDescarte: c.motivoDescarte || '', dataCotacao: c.dataCotacao, referencia: c.referencia,
            destoante: mediana > 0 && Math.abs(c.valorUnitario - mediana) / mediana > limite
          };
        })
      };
    });
    var total = itens.reduce(function (a, i) { return a + i.valorTotalEstimado; }, 0);
    return { metodo: metodo, metodoNome: this.METODOS[metodo], limiteDesvio: limite, itens: itens, total: total };
  },

  /**
   * Gera o Mapa Comparativo como planilha (Google Sheets) na pasta do tipo
   * MAPA_PRECOS: aba "Mapa" (resumo por item + matriz itens × fornecedores)
   * e aba "Cotações" (todas, com consideradas/descartadas e motivo).
   */
  gerarMapa: function (processoId, metodo, tarefaId) {
    var proc = repo('Processos').obterOuFalhar(processoId);
    var mapa = this.calcularMapa(processoId, metodo);
    if (!mapa.itens.length) throw Utils.erro('Não há cotações registradas.');
    var versao = DocumentoService._proximaVersao(proc.id, 'MAPA_PRECOS');
    var nome = 'Mapa Comparativo de Preços - ' + proc.numero + (versao > 1 ? ' (v' + versao + ')' : '');
    var ss = SpreadsheetApp.create(nome);
    this._escreverPlanilha(ss, proc, mapa);
    DriveService.mover(ss.getId(), DriveService.pastaDoTipo(proc, 'MAPA_PRECOS'));

    var tarefa = tarefaId ? repo('Tarefas').obter(tarefaId) : null;
    var reg = repo('Documentos').inserir({
      processoId: proc.id, tarefaId: tarefaId || '', etapaCodigo: tarefa ? tarefa.etapaCodigo : '',
      tipoCodigo: 'MAPA_PRECOS', nome: nome, fileId: ss.getId(), url: ss.getUrl(),
      mimeType: this.MIME_PLANILHA, origem: 'GERADO', status: 'RASCUNHO', versao: versao,
      criadoEm: Utils.agora(), criadoPor: Auth.email()
    });
    var total = Math.round(mapa.total * 100) / 100;
    var etapa = tarefa ? tarefa.etapaCodigo : '';
    Variaveis.definir(proc.id, 'metodoEstimativa', mapa.metodo, etapa);
    Variaveis.definir(proc.id, 'valorMapa', total, etapa);
    // Contratação direta: o valor da contratação é o da proposta da ETICE, não o do mapa
    var direta = Variaveis.mapa(proc.id).contratadaEtice === 'SIM';
    if (!direta) repo('Processos').atualizar(proc.id, { valorEstimado: total, atualizadoEm: Utils.agora() });
    var brl = function (v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); };
    Historico.registrar(proc.id, tarefaId, 'MAPA_GERADO', nome + ' — total ' + brl(total) +
      (direta ? ' (contratação direta: valor estimado do processo mantido)' : ''));
    return reg;
  },

  _escreverPlanilha: function (ss, proc, mapa) {
    var MOEDA = '"R$" #,##0.00';
    var abaMapa = ss.getSheets()[0].setName('Mapa');
    var abaCot = ss.insertSheet('Cotações');
    var limitePct = Math.round(mapa.limiteDesvio * 100);

    // ---------------- Aba Mapa: cabeçalho
    var linhas = [
      ['MAPA COMPARATIVO DE PREÇOS'],
      ['Processo ' + proc.numero + (proc.numeroSuite ? ' — SUITE ' + proc.numeroSuite : '') + ' — ' + proc.titulo],
      ['Método de estimativa: ' + mapa.metodoNome + '. Preços com variação acima de ' + limitePct +
        '% da mediana estão destacados; preços descartados não entram no cálculo (ver aba "Cotações").'],
      ['']
    ];
    linhas.forEach(function (l, i) { abaMapa.getRange(i + 1, 1, 1, 1).setValues([l]); });
    abaMapa.getRange(1, 1, 1, 1).setFontWeight('bold').setFontSize(14);

    // Resumo por item
    var cab = ['Item', 'Descrição', 'Unidade', 'Quantidade', 'Nº cotações', 'Menor', 'Maior', 'Média', 'Mediana',
      'Coef. variação', 'Valor unitário estimado', 'Valor total estimado'];
    var l0 = 5;
    var dados = mapa.itens.map(function (i) {
      return [i.item, i.descricao || '', i.unidade || '', i.quantidade, i.n, i.menor, i.maior, i.media, i.mediana,
        i.coefVariacao, i.valorUnitarioEstimado, i.valorTotalEstimado];
    });
    abaMapa.getRange(l0, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#0b2540').setFontColor('#ffffff');
    abaMapa.getRange(l0 + 1, 1, dados.length, cab.length).setValues(dados);
    abaMapa.getRange(l0 + 1, 6, dados.length, 4).setNumberFormat(MOEDA);
    abaMapa.getRange(l0 + 1, 10, dados.length, 1).setNumberFormat('0.0%');
    abaMapa.getRange(l0 + 1, 11, dados.length, 2).setNumberFormat(MOEDA);
    var lTotal = l0 + 1 + dados.length;
    abaMapa.getRange(lTotal, 1, 1, cab.length)
      .setValues([['VALOR TOTAL ESTIMADO', '', '', '', '', '', '', '', '', '', '', mapa.total]])
      .setFontWeight('bold').setBackground('#e7f7f0');
    abaMapa.getRange(lTotal, 12, 1, 1).setNumberFormat(MOEDA);

    // Matriz itens × fornecedores (fonte)
    var colunas = [];
    mapa.itens.forEach(function (i) {
      i.cotacoes.forEach(function (c) {
        var k = (c.fornecedor || 'Sem fornecedor') + (c.fonte ? ' (' + c.fonte + ')' : '');
        if (colunas.indexOf(k) < 0) colunas.push(k);
      });
    });
    var lm = lTotal + 3;
    abaMapa.getRange(lm - 1, 1, 1, 1).setValues([['Comparativo por fornecedor / fonte (valor unitário)']]).setFontWeight('bold');
    abaMapa.getRange(lm, 1, 1, colunas.length + 1).setValues([['Item'].concat(colunas)])
      .setFontWeight('bold').setBackground('#0b2540').setFontColor('#ffffff');
    mapa.itens.forEach(function (i, r) {
      var linha = [i.item].concat(colunas.map(function () { return ''; }));
      i.cotacoes.forEach(function (c) {
        var k = (c.fornecedor || 'Sem fornecedor') + (c.fonte ? ' (' + c.fonte + ')' : '');
        linha[colunas.indexOf(k) + 1] = c.valorUnitario;
      });
      abaMapa.getRange(lm + 1 + r, 1, 1, linha.length).setValues([linha]);
      abaMapa.getRange(lm + 1 + r, 2, 1, colunas.length).setNumberFormat(MOEDA);
      i.cotacoes.forEach(function (c) {
        var k = (c.fornecedor || 'Sem fornecedor') + (c.fonte ? ' (' + c.fonte + ')' : '');
        var cel = abaMapa.getRange(lm + 1 + r, colunas.indexOf(k) + 2, 1, 1);
        if (!c.considerado) cel.setBackground('#e5e7eb').setFontColor('#6b7280');
        else if (c.destoante) cel.setBackground('#fde2e2').setFontColor('#b91c1c');
      });
    });
    abaMapa.getRange(lm + 2 + mapa.itens.length, 1, 1, 1)
      .setValues([['Legenda: vermelho = destoante (considerado); cinza = descartado (não entra no cálculo).']]);
    var justif = Variaveis.mapa(proc.id).justificativaMenos3Cotacoes;
    if (justif) {
      abaMapa.getRange(lm + 4 + mapa.itens.length, 1, 1, 1).setValues([['Justificativa para menos de 3 cotações: ' + justif]]);
    }
    abaMapa.setFrozenRows(0);

    // ---------------- Aba Cotações
    var cabC = ['Item', 'Descrição', 'Unidade', 'Quantidade', 'Fornecedor', 'CNPJ', 'Fonte', 'Data', 'Referência',
      'Valor unitário', 'Considerada', 'Destoante', 'Motivo do descarte'];
    var linhasC = [];
    mapa.itens.forEach(function (i) {
      i.cotacoes.forEach(function (c) {
        linhasC.push([i.item, i.descricao || '', i.unidade || '', i.quantidade, c.fornecedor || '', c.cnpj || '', c.fonte || '',
          c.dataCotacao || '', c.referencia || '', c.valorUnitario, c.considerado ? 'Sim' : 'Não', c.destoante ? 'Sim' : 'Não',
          c.motivoDescarte || '']);
      });
    });
    abaCot.getRange(1, 1, 1, cabC.length).setValues([cabC]).setFontWeight('bold').setBackground('#0b2540').setFontColor('#ffffff');
    if (linhasC.length) {
      abaCot.getRange(2, 1, linhasC.length, cabC.length).setValues(linhasC);
      abaCot.getRange(2, 10, linhasC.length, 1).setNumberFormat(MOEDA);
    }
    abaCot.setFrozenRows(1);
  }
};
