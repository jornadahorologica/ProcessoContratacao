/**
 * Diligências / despachos recebidos (ex.: "DESPACHO Nº 458/2026/CECOC").
 * Podem surgir em qualquer fase e não alteram o fluxo: são controladas à
 * parte, com prazo e documento de resposta.
 */
var DiligenciaService = {
  listar: function (processoId) {
    var l = repo('Diligencias').onde({ processoId: processoId });
    l.sort(function (a, b) { return a.recebidoEm < b.recebidoEm ? 1 : -1; });
    return l;
  },

  registrar: function (processoId, d) {
    repo('Processos').obterOuFalhar(processoId);
    if (Utils.vazio(d.numeroDespacho)) throw Utils.erro('Informe o número do despacho.');
    var reg = repo('Diligencias').inserir({
      processoId: processoId,
      numeroDespacho: d.numeroDespacho,
      origem: d.origem || '',
      assunto: d.assunto || '',
      recebidoEm: d.recebidoEm || Utils.hoje(),
      prazo: d.prazo || '',
      status: 'ABERTA',
      criadoEm: Utils.agora(),
      criadoPor: Auth.email()
    });
    Historico.registrar(processoId, '', 'DILIGENCIA_REGISTRADA', d.numeroDespacho + (d.origem ? ' (' + d.origem + ')' : ''));
    return reg;
  },

  responder: function (diligenciaId, resposta, documentoId) {
    var d = repo('Diligencias').obterOuFalhar(diligenciaId);
    var reg = repo('Diligencias').atualizar(d.id, {
      status: 'RESPONDIDA',
      respondidoEm: Utils.hoje(),
      resposta: resposta || '',
      documentoId: documentoId || d.documentoId
    });
    Historico.registrar(d.processoId, '', 'DILIGENCIA_RESPONDIDA', d.numeroDespacho);
    return reg;
  }
};
