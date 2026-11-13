/**
 * Variáveis do processo (dados chave-valor preenchidos nos formulários das
 * etapas). Alimentam as decisões do fluxo e os modelos de documentos.
 * Itens de checklist são gravados como "checklist.<idDoItem>".
 */
var Variaveis = {
  mapa: function (processoId) {
    var r = {};
    repo('Variaveis').onde({ processoId: processoId }).forEach(function (v) { r[v.chave] = v.valor; });
    return r;
  },

  definir: function (processoId, chave, valor, etapaCodigo) {
    var r = repo('Variaveis');
    var existente = r.filtrar(function (v) { return v.processoId === processoId && v.chave === chave; })[0];
    var dados = {
      valor: valor === null || valor === undefined ? '' : String(valor),
      etapaCodigo: etapaCodigo || '',
      atualizadoEm: Utils.agora(),
      atualizadoPor: Auth.email()
    };
    if (existente) {
      if (existente.valor === dados.valor) return existente;
      return r.atualizar(existente.id, dados);
    }
    dados.processoId = processoId;
    dados.chave = chave;
    return r.inserir(dados);
  },

  definirVarias: function (processoId, valores, etapaCodigo) {
    var self = this;
    Object.keys(valores || {}).forEach(function (k) {
      self.definir(processoId, k, valores[k], etapaCodigo);
    });
  }
};
