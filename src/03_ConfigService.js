/**
 * Leitura da configuração do fluxo (abas cfg_*) com cache.
 *
 * A configuração é lida uma vez, guardada no CacheService (10 min) e
 * memorizada durante a execução. Após editar as abas cfg_* use
 * "Recarregar configuração" na tela de Administração (ou ConfigService.limparCache()).
 */
var ConfigService = {
  _memo: null,
  CHAVE_CACHE: 'cfg_v1',

  carregar: function () {
    if (this._memo) return this._memo;
    var cache = CacheService.getScriptCache();
    var bruto = null;
    try { bruto = cache.get(this.CHAVE_CACHE); } catch (e) { bruto = null; }
    if (bruto) {
      this._memo = JSON.parse(bruto);
      return this._memo;
    }
    var cfg = {};
    TABELAS_CONFIG.forEach(function (t) { cfg[t] = repo(t).todos(); });
    try {
      cache.put(this.CHAVE_CACHE, JSON.stringify(cfg), APP.CACHE_TTL_SEG);
    } catch (e) {
      // Configuração maior que o limite do cache (100 KB): segue sem cache.
    }
    this._memo = cfg;
    return cfg;
  },

  limparCache: function () {
    CacheService.getScriptCache().remove(this.CHAVE_CACHE);
    this._memo = null;
  },

  ordenar_: function (lista) {
    return lista.slice().sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); });
  },

  fluxos: function () {
    return this.carregar().cfg_Fluxos.filter(function (f) { return f.ativo; });
  },

  fluxo: function (fluxoId) {
    var f = this.carregar().cfg_Fluxos.filter(function (x) { return x.id === fluxoId; })[0];
    if (!f) throw Utils.erro('Fluxo não encontrado: ' + fluxoId);
    return f;
  },

  etapas: function (fluxoId) {
    return this.ordenar_(this.carregar().cfg_Etapas.filter(function (e) { return e.fluxoId === fluxoId; }));
  },

  etapa: function (fluxoId, codigo) {
    var e = this.carregar().cfg_Etapas.filter(function (x) {
      return x.fluxoId === fluxoId && x.codigo === codigo;
    })[0];
    if (!e) throw Utils.erro('Etapa "' + codigo + '" não encontrada no fluxo ' + fluxoId);
    return e;
  },

  blocos: function (etapa) {
    return Utils.csv(etapa.blocos).map(function (b) { return b.toUpperCase(); });
  },

  transicoesDe: function (fluxoId, codigo) {
    return this.ordenar_(this.carregar().cfg_Transicoes.filter(function (t) {
      return t.fluxoId === fluxoId && t.origem === codigo;
    }));
  },

  campos: function (fluxoId, etapaCodigo) {
    return this.ordenar_(this.carregar().cfg_Campos.filter(function (c) {
      return c.fluxoId === fluxoId && c.etapaCodigo === etapaCodigo;
    }));
  },

  checklist: function (fluxoId, etapaCodigo) {
    return this.ordenar_(this.carregar().cfg_ChecklistItens.filter(function (c) {
      return c.fluxoId === fluxoId && c.etapaCodigo === etapaCodigo;
    }));
  },

  tiposDocumento: function () {
    return this.ordenar_(this.carregar().cfg_DocumentosTipo);
  },

  tipoDocumento: function (codigo) {
    return this.carregar().cfg_DocumentosTipo.filter(function (t) { return t.codigo === codigo; })[0] || null;
  },

  pastas: function (fluxoId) {
    return this.ordenar_(this.carregar().cfg_Pastas.filter(function (p) { return p.fluxoId === fluxoId; }));
  },

  fases: function () {
    return this.ordenar_(this.carregar().cfg_Fases);
  },

  usuarios: function () {
    return this.carregar().cfg_Usuarios;
  }
};
