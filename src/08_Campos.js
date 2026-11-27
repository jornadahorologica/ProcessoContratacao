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
 *      Com o prefixo "[AUTO]" (ex.: "[AUTO]{{objeto}}") o valor é gravado
 *      automaticamente quando a etapa começa (continua editável).
 *  - condicao: o campo só aparece e só é exigido quando a condição for
 *    verdadeira (mesma sintaxe das transições, ex.: "naturezaContinua == SIM").
 *  - tipo "tabela": várias linhas (ex.: riscos, dotações). As colunas ficam em
 *    "opcoes": "chave|Rótulo|tipo|op1,op2;chave2|Rótulo 2" (tipo: texto,
 *    textoLongo ou selecao). O valor é gravado como JSON (lista de linhas).
 */
var Campos = {
  SUFIXO_NSA: '_nsa',

  permiteNsa: function (campo) {
    return campo.tipo === 'secaoLei' && Utils.csv(campo.opcoes).map(function (o) { return o.toUpperCase(); }).indexOf('NSA') >= 0;
  },

  naoSeAplica: function (campo, vars) {
    return this.permiteNsa(campo) && vars[campo.chave + this.SUFIXO_NSA] === 'true';
  },

  PREFIXO_AUTO: '[AUTO]',

  /** O campo se aplica (condição verdadeira ou sem condição)? */
  aplicavel: function (campo, vars) {
    return Utils.vazio(campo.condicao) || Condicao.avaliar(campo.condicao, vars);
  },

  /** Colunas de um campo "tabela": [{chave, rotulo, tipo, opcoes[]}] */
  colunas: function (campo) {
    return String(campo.opcoes || '').split(';').map(function (x) { return x.trim(); }).filter(String).map(function (def) {
      var p = def.split('|').map(function (x) { return x.trim(); });
      return { chave: p[0], rotulo: p[1] || p[0], tipo: p[2] || 'texto',
        opcoes: p[3] ? p[3].split(',').map(function (o) { return o.trim(); }).filter(String) : [] };
    });
  },

  /** Linhas de um campo "tabela" (aceita lista ou JSON); só as colunas configuradas e sem linhas vazias. */
  linhas: function (campo, valor) {
    var lista = valor;
    if (typeof lista === 'string') {
      try { lista = lista.trim() ? JSON.parse(lista) : []; } catch (e) { lista = []; }
    }
    if (!Array.isArray(lista)) return [];
    var cols = this.colunas(campo);
    return lista.map(function (l) {
      var o = {};
      cols.forEach(function (c) { o[c.chave] = l && l[c.chave] !== undefined && l[c.chave] !== null ? String(l[c.chave]).trim() : ''; });
      return o;
    }).filter(function (o) { return cols.some(function (c) { return o[c.chave] !== ''; }); });
  },

  /** Texto do campo para documentos (trata "Não se aplica"). */
  textoDocumento: function (campo, vars) {
    var v = vars[campo.chave];
    if (v === undefined || v === null) v = '';
    if (campo.tipo === 'tabela') {
      var cols = this.colunas(campo);
      return this.linhas(campo, v).map(function (l, i) {
        return (i + 1) + ') ' + cols.filter(function (c) { return l[c.chave] !== ''; })
          .map(function (c) { return c.rotulo + ': ' + l[c.chave]; }).join(' — ');
      }).join('\n');
    }
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
      if (!c.obrigatorio || !self.aplicavel(c, vars)) return;
      if (c.tipo === 'tabela') {
        if (!self.linhas(c, vars[c.chave]).length) p.push('Preencha o campo "' + c.rotulo + '" (ao menos uma linha)');
        return;
      }
      if (!Utils.vazio(vars[c.chave])) return;
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
      if (modelo.indexOf(Campos.PREFIXO_AUTO) === 0) modelo = modelo.slice(Campos.PREFIXO_AUTO.length).trim();
      if (/^#/.test(modelo) || c.tipo === 'tabela') return; // célula com erro de planilha (ex.: #NAME?)
      var s = /^(\[VALOR_SOLUCAO\]|=VALOR_SOLUCAO)$/.test(modelo)
        ? Campos.valorSolucao(proc, vars)
        : Campos.interpolar(modelo, proc, vars);
      if (!s || Utils.vazio(s.valor)) return;
      if ((c.tipo === 'moeda' || c.tipo === 'numero' || c.tipo === 'inteiro') && isNaN(Number(s.valor))) return;
      r[c.chave] = s;
    });
    return r;
  },

  /**
   * Campos com valorPadrao "[AUTO]…": grava o valor quando a etapa começa
   * (ex.: DFD recebe o setor demandante e o objeto informados no novo processo).
   */
  preencherAutomaticos: function (proc, etapaCodigo) {
    var vars = Variaveis.mapa(proc.id);
    var alt = {};
    var self = this;
    ConfigService.campos(proc.fluxoId, etapaCodigo).forEach(function (c) {
      var m = String(c.valorPadrao || '').trim();
      if (m.indexOf(self.PREFIXO_AUTO) !== 0 || !Utils.vazio(vars[c.chave])) return;
      var s = self.interpolar(m.slice(self.PREFIXO_AUTO.length).trim(), proc, vars);
      if (s && !Utils.vazio(s.valor)) alt[c.chave] = s.valor;
    });
    if (Object.keys(alt).length) Variaveis.definirVarias(proc.id, alt, etapaCodigo);
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
