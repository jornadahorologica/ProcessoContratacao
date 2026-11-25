/**
 * Regras dos campos de formulário das etapas (cfg_Campos):
 *  - tipo "secaoLei": seção de texto de um documento (ex.: inciso do ETP).
 *    Com opcoes = "NSA" o usuário pode marcar "Não se aplica"; nesse caso o
 *    texto passa a ser a justificativa (obrigatória). A marcação é gravada
 *    na variável "<chave>_nsa" = "true".
 *  - valorPadrao: sugestão exibida ao usuário (ele decide se usa):
 *      "{{variavel}}"   copia uma variável já preenchida (ex.: do DFD);
 *      "[VALOR_SOLUCAO]" valor da solução escolhida (proposta da ETICE ou
 *                       média das propostas recebidas);
 *      filtros: {{quantidadeDFD|milhar}} (1.000) e {{unidadeMedidaDFD|sigla}}
 *      (texto antes do parêntese, ex.: "UST").
 */
var Campos = {
  SUFIXO_NSA: '_nsa',

  permiteNsa: function (campo) {
    return campo.tipo === 'secaoLei' && Utils.csv(campo.opcoes).map(function (o) { return o.toUpperCase(); }).indexOf('NSA') >= 0;
  },

  naoSeAplica: function (campo, vars) {
    return this.permiteNsa(campo) && vars[campo.chave + this.SUFIXO_NSA] === 'true';
  },

  /** Texto do campo para documentos (trata "Não se aplica"). */
  textoDocumento: function (campo, vars) {
    var v = vars[campo.chave];
    if (v === undefined || v === null) v = '';
    if (this.naoSeAplica(campo, vars)) return 'Não se aplica.' + (Utils.vazio(v) ? '' : ' Justificativa: ' + v);
    if (campo.tipo === 'moeda' && !Utils.vazio(v)) {
      return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }
    if (campo.tipo === 'simNao') return v === 'SIM' ? 'Sim' : v === 'NAO' ? 'Não' : v;
    if (campo.tipo === 'inteiro' && !Utils.vazio(v)) return Number(v).toLocaleString('pt-BR');
    return String(v);
  },

  /** Pendências de preenchimento dos campos de uma etapa. */
  pendencias: function (campos, vars) {
    var self = this;
    var p = [];
    campos.forEach(function (c) {
      if (!c.obrigatorio || !Utils.vazio(vars[c.chave])) return;
      if (self.naoSeAplica(c, vars)) p.push('Justifique o "Não se aplica" em: ' + c.rotulo);
      else p.push((c.tipo === 'secaoLei' ? 'Preencha a seção "' : 'Preencha o campo "') + c.rotulo + '"' +
        (self.permiteNsa(c) ? ' (ou marque "Não se aplica" e justifique)' : ''));
    });
    return p;
  },

  /** Sugestões de preenchimento: { chave: {valor, origem} } */
  sugestoes: function (proc, campos, vars) {
    var r = {};
    campos.forEach(function (c) {
      if (Utils.vazio(c.valorPadrao)) return;
      var modelo = String(c.valorPadrao).trim();
      if (/^#/.test(modelo)) return; // célula com erro de planilha (ex.: #NAME?)
      var s = /^(\[VALOR_SOLUCAO\]|=VALOR_SOLUCAO)$/.test(modelo)
        ? Campos.valorSolucao(proc, vars)
        : Campos.interpolar(modelo, proc, vars);
      if (!s || Utils.vazio(s.valor)) return;
      if ((c.tipo === 'moeda' || c.tipo === 'numero' || c.tipo === 'inteiro') && isNaN(Number(s.valor))) return;
      r[c.chave] = s;
    });
    return r;
  },

  interpolar: function (modelo, proc, vars) {
    var faltou = false;
    var origens = [];
    var valor = String(modelo).replace(/\{\{([\w.]+)(?:\|(\w+))?\}\}/g, function (_, k, filtro) {
      var v = vars[k] !== undefined ? vars[k] : proc[k];
      if (Utils.vazio(v)) { faltou = true; return ''; }
      origens.push(k);
      v = String(v);
      if (filtro === 'milhar' && !isNaN(Number(v))) v = Number(v).toLocaleString('pt-BR');
      if (filtro === 'sigla') v = v.split(' (')[0].trim();
      return v;
    });
    if (faltou || !origens.length) return null; // sem dados de etapas anteriores, não há sugestão
    var textoFixo = String(modelo).replace(/\{\{[^}]+\}\}/g, '').trim();
    return { valor: valor, origem: textoFixo.length > 20 ? 'Modelo sugerido' : 'Preenchido anteriormente' };
  },

  /**
   * Valor estimado da solução escolhida:
   *  - contratação direta com a ETICE: soma das cotações consideradas cujo fornecedor contém "ETICE";
   *  - licitação: média das propostas (cotações consideradas) — total do mapa pelo método MÉDIA.
   */
  valorSolucao: function (proc, vars) {
    var cot = PesquisaPrecoService.listar(proc.id).filter(function (c) { return c.considerado; });
    if (vars.contratadaEtice === 'SIM') {
      var etice = cot.filter(function (c) { return /ETICE/i.test(c.fornecedor || ''); });
      if (!etice.length) return null;
      var total = etice.reduce(function (a, c) { return a + c.valorUnitario * (c.quantidade || 1); }, 0);
      return { valor: Math.round(total * 100) / 100, origem: 'Proposta da ETICE registrada na pesquisa de preços' };
    }
    if (!cot.length) return null;
    var mapa = PesquisaPrecoService.calcularMapa(proc.id, 'MEDIA');
    return { valor: Math.round(mapa.total * 100) / 100, origem: 'Média das ' + cot.length + ' proposta(s) registrada(s) na pesquisa de preços' };
  }
};
