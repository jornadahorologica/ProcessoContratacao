/**
 * Funções utilitárias sem dependência de regra de negócio.
 */
var Utils = {
  uuid: function () {
    return Utilities.getUuid();
  },

  /** Data/hora atual em ISO-8601 (UTC). Datas são sempre gravadas como texto ISO. */
  agora: function () {
    return new Date().toISOString();
  },

  /** Data de hoje no formato AAAA-MM-DD no fuso do script. */
  hoje: function () {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  },

  /** Soma N dias úteis (seg–sex) a uma data e devolve AAAA-MM-DD. */
  somarDiasUteis: function (dataBase, dias) {
    var d = dataBase ? new Date(dataBase) : new Date();
    var restantes = Number(dias) || 0;
    while (restantes > 0) {
      d.setDate(d.getDate() + 1);
      var dow = d.getDay();
      if (dow !== 0 && dow !== 6) restantes--;
    }
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  },

  /** Diferença em dias corridos entre duas datas (b - a). */
  diasEntre: function (a, b) {
    var ms = new Date(b).getTime() - new Date(a).getTime();
    return Math.floor(ms / 86400000);
  },

  vazio: function (v) {
    return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  },

  /** Agrupa um array por uma função-chave. */
  agrupar: function (lista, fnChave) {
    var r = {};
    lista.forEach(function (x) {
      var k = fnChave(x);
      (r[k] = r[k] || []).push(x);
    });
    return r;
  },

  csv: function (texto) {
    if (Utils.vazio(texto)) return [];
    return String(texto).split(/[,;]/).map(function (s) { return s.trim(); }).filter(String);
  },

  /** Executa fn com o lock do script (evita gravações concorrentes). */
  comLock: function (fn) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      throw new Error('O sistema está ocupado processando outra operação. Tente novamente em instantes.');
    }
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  },

  erro: function (msg) {
    var e = new Error(msg);
    e.negocio = true;
    return e;
  }
};
