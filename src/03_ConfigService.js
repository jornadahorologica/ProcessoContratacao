/**
 * Leitura da configuração do fluxo (abas cfg_*) com cache.
 *
 * A configuração é lida uma vez, guardada no CacheService (10 min) e
 * memorizada durante a execução. Após editar as abas cfg_* use
 * "Recarregar configuração" na tela de Administração (ou ConfigService.limparCache()).
 */
var ConfigService = {
  _memo: null,
  CHAVE_CACHE: 'cfg_v3',

  carregar: function () {
    if (this._memo) return this._memo;
    var cache = CacheService.getScriptCache();
    try {
      var n = Number(cache.get(this.CHAVE_CACHE + '_n'));
      if (n > 0) {
        var chaves = [];
        for (var i = 0; i < n; i++) chaves.push(this.CHAVE_CACHE + '_' + i);
        var partes = cache.getAll(chaves);
        if (chaves.every(function (k) { return partes[k]; })) {
          this._memo = JSON.parse(chaves.map(function (k) { return partes[k]; }).join(''));
          return this._memo;
        }
      }
    } catch (e) { /* cache indisponível: lê da planilha */ }

    Db.precarregar(TABELAS_CONFIG); // uma única leitura para todas as abas cfg_* (com o serviço avançado)
    var cfg = {};
    TABELAS_CONFIG.forEach(function (t) { cfg[t] = repo(t).todos(); });
    try {
      // O CacheService aceita até 100 KB por chave: divide em partes de 90 mil caracteres
      var json = JSON.stringify(cfg);
      var mapa = {};
      var qtd = Math.ceil(json.length / 90000);
      for (var j = 0; j < qtd; j++) mapa[this.CHAVE_CACHE + '_' + j] = json.substr(j * 90000, 90000);
      mapa[this.CHAVE_CACHE + '_n'] = String(qtd);
      cache.putAll(mapa, APP.CACHE_TTL_SEG);
    } catch (e) { /* segue sem cache */ }
    this._memo = cfg;
    return cfg;
  },

  limparCache: function () {
    try { CacheService.getScriptCache().remove(this.CHAVE_CACHE + '_n'); } catch (e) { /* ignora */ }
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
  },

  /** Signatários configurados para um tipo de documento (ordem de assinatura). */
  assinaturas: function (tipoDocumento) {
    return this.ordenar_((this.carregar().cfg_Assinaturas || []).filter(function (a) {
      return a.tipoDocumento === tipoDocumento;
    }));
  },

  /** Etapas cujo documento é do tipo informado (usado para montar o documento a partir dos campos). */
  etapasDoDocumento: function (fluxoId, tipoDocumento) {
    return this.etapas(fluxoId).filter(function (e) { return e.documentoTipo === tipoDocumento; });
  }
};
