/**
 * Controle das assinaturas feitas no SUITE.
 *
 * O sistema não assina: ele gera o PDF para ser juntado ao SUITE, controla
 * quem já assinou (registro manual) e libera o documento como FINAL quando
 * todas as assinaturas configuradas em cfg_Assinaturas forem registradas.
 * Um PDF já assinado, anexado ao sistema, é considerado FINAL diretamente.
 *
 * Documento: RASCUNHO → EM_ASSINATURA → FINAL
 */
var AssinaturaService = {
  exige: function (tipoDocumento) {
    return ConfigService.assinaturas(tipoDocumento).length > 0;
  },

  /** Signatários do tipo com os marcadores resolvidos para o processo. */
  signatarios: function (proc, tipoDocumento) {
    return ConfigService.assinaturas(tipoDocumento).map(function (a) {
      var nome = String(a.signatario || '').replace(/\{\{([\w.]+)\}\}/g, function (_, k) { return proc[k] || ''; });
      return { ordem: a.ordem, signatario: nome || a.signatario, cargo: a.cargo || '' };
    });
  },

  listar: function (processoId) {
    var l = repo('Assinaturas').onde({ processoId: processoId });
    l.sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); });
    return l;
  },

  doDocumento: function (documentoId) {
    return repo('Assinaturas').onde({ documentoId: documentoId })
      .sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); });
  },

  /** Gera o PDF e abre o controle de assinaturas do documento. */
  enviar: function (documentoId) {
    var d = repo('Documentos').obterOuFalhar(documentoId);
    if (d.status === 'FINAL') throw Utils.erro('O documento já está FINAL.');
    if (!this.exige(d.tipoCodigo)) throw Utils.erro('Este tipo de documento não tem assinaturas configuradas (cfg_Assinaturas).');
    var proc = repo('Processos').obterOuFalhar(d.processoId);

    var pdfFileId = d.pdfFileId, pdfUrl = d.pdfUrl;
    if (d.mimeType === 'application/vnd.google-apps.document' || d.mimeType === 'application/vnd.google-apps.spreadsheet') {
      var blob = DriveApp.getFileById(d.fileId).getAs('application/pdf').setName(d.nome + '.pdf');
      var pdf = DriveService.pastaDoTipo(proc, d.tipoCodigo).createFile(blob);
      pdfFileId = pdf.getId();
      pdfUrl = pdf.getUrl();
    }
    // Reenvio: recomeça o controle
    this.doDocumento(d.id).forEach(function (a) { repo('Assinaturas').remover(a.id); });
    this.signatarios(proc, d.tipoCodigo).forEach(function (s) {
      repo('Assinaturas').inserir({
        processoId: proc.id, documentoId: d.id, tipoDocumento: d.tipoCodigo, ordem: s.ordem,
        signatario: s.signatario, cargo: s.cargo, status: 'PENDENTE'
      });
    });
    var reg = repo('Documentos').atualizar(d.id, { status: 'EM_ASSINATURA', pdfFileId: pdfFileId || '', pdfUrl: pdfUrl || '' });
    Historico.registrar(proc.id, d.tarefaId, 'ASSINATURA_ENVIADA', d.nome + ' — enviado para assinatura no SUITE');
    return reg;
  },

  /** Registra que um signatário assinou no SUITE. Quando todos assinam, o documento vira FINAL. */
  registrar: function (assinaturaId, data) {
    var a = repo('Assinaturas').obterOuFalhar(assinaturaId);
    var d = repo('Documentos').obterOuFalhar(a.documentoId);
    if (d.status !== 'EM_ASSINATURA') throw Utils.erro('O documento não está em assinatura.');
    repo('Assinaturas').atualizar(a.id, {
      status: 'ASSINADO', assinadoEm: data || Utils.hoje(), registradoPor: Auth.email(), registradoEm: Utils.agora()
    });
    Historico.registrar(a.processoId, d.tarefaId, 'ASSINATURA_REGISTRADA', d.nome + ' — ' + a.signatario);
    var pendentes = this.doDocumento(d.id).filter(function (x) { return x.status !== 'ASSINADO'; });
    if (!pendentes.length) {
      repo('Documentos').atualizar(d.id, { status: 'FINAL' });
      Historico.registrar(a.processoId, d.tarefaId, 'DOCUMENTO_STATUS', d.nome + ' → FINAL (todas as assinaturas registradas)');
    }
    return true;
  },

  /**
   * O documento gerado (rascunho) ficou desatualizado? Isto é: os dados da etapa
   * (ou, no mapa, as cotações) mudaram depois que ele foi gerado.
   */
  desatualizado: function (doc, etapaCodigo) {
    if (!doc || doc.status !== 'RASCUNHO' || doc.origem !== 'GERADO') return false;
    var ignorar = { valorMapa: true, metodoEstimativa: true, cotacoesAlteradasEm: true };
    var ultima = '';
    repo('Variaveis').onde({ processoId: doc.processoId }).forEach(function (v) {
      if (v.chave === 'cotacoesAlteradasEm' && doc.tipoCodigo === 'MAPA_PRECOS') { if (v.valor > ultima) ultima = v.valor; return; }
      if (ignorar[v.chave] || /^checklist\./.test(v.chave) || !etapaCodigo || v.etapaCodigo !== etapaCodigo) return;
      if (v.atualizadoEm > ultima) ultima = v.atualizadoEm;
    });
    return !!ultima && ultima > doc.criadoEm;
  },

  /**
   * "Assinar no SUITE" em um passo: gera o documento da etapa se ainda não existir
   * (ou se os dados mudaram), gera o PDF e registra as assinaturas marcadas.
   * ordens = ordem dos signatários (cfg_Assinaturas) que assinaram; vazio = todos.
   */
  assinarNoSuite: function (processoId, tipoCodigo, tarefaId, data, ordens) {
    if (!this.exige(tipoCodigo)) throw Utils.erro('Este tipo de documento não tem assinaturas configuradas.');
    if (Utils.vazio(data)) throw Utils.erro('Informe a data da assinatura.');
    var proc = repo('Processos').obterOuFalhar(processoId);
    var tarefa = tarefaId ? repo('Tarefas').obter(tarefaId) : null;
    var etapaCodigo = tarefa ? tarefa.etapaCodigo : '';
    var doc = repo('Documentos').filtrar(function (d) {
      return d.processoId === proc.id && d.tipoCodigo === tipoCodigo && d.origem === 'GERADO' && d.status !== 'FINAL';
    }).sort(function (a, b) { return a.criadoEm < b.criadoEm ? 1 : -1; })[0];
    if (!doc || this.desatualizado(doc, etapaCodigo)) {
      doc = tipoCodigo === 'MAPA_PRECOS'
        ? PesquisaPrecoService.gerarMapa(proc.id, Variaveis.mapa(proc.id).metodoEstimativa, tarefaId)
        : DocumentoService.gerar(proc.id, tipoCodigo, tarefaId);
    }
    if (doc.status === 'RASCUNHO') this.enviar(doc.id);
    var marcar = (ordens || []).map(Number);
    var self = this;
    var registradas = 0;
    this.doDocumento(doc.id).forEach(function (a) {
      if (a.status === 'ASSINADO' || (marcar.length && marcar.indexOf(Number(a.ordem)) < 0)) return;
      self.registrar(a.id, data);
      registradas++;
    });
    if (!registradas && !this.todasRegistradas(doc.id)) throw Utils.erro('Marque ao menos um signatário.');
    return repo('Documentos').obter(doc.id);
  },

  /** Usado ao marcar FINAL manualmente: documentos gerados com assinatura exigem todas registradas. */
  todasRegistradas: function (documentoId) {
    var l = this.doDocumento(documentoId);
    return l.length > 0 && l.every(function (x) { return x.status === 'ASSINADO'; });
  }
};
