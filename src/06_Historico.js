/**
 * Trilha de auditoria. Somente inclusão: nada é alterado ou apagado.
 */
var Historico = {
  registrar: function (processoId, tarefaId, acao, detalhe) {
    var usuario = '';
    try { usuario = Auth.usuario().email; } catch (e) { usuario = Auth.email() || 'sistema'; }
    return repo('Historico').inserir({
      processoId: processoId,
      tarefaId: tarefaId || '',
      dataHora: Utils.agora(),
      usuario: usuario,
      acao: acao,
      detalhe: typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe || '')
    });
  },

  listar: function (processoId, limite) {
    var lista = repo('Historico').onde({ processoId: processoId });
    lista.sort(function (a, b) { return a.dataHora < b.dataHora ? 1 : -1; });
    return limite ? lista.slice(0, limite) : lista;
  }
};
