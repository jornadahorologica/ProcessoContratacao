/**
 * Documentos do processo: geração a partir de modelos Google Docs, anexos
 * e controle de status (RASCUNHO / FINAL).
 *
 * Modelos: crie um Google Docs com marcadores {{chave}} e informe o ID na
 * coluna "modeloId" de cfg_DocumentosTipo. Chaves disponíveis: campos do
 * processo (numero, titulo, objeto, numeroSuite, setorDemandante,
 * valorEstimado...), todas as variáveis preenchidas nas etapas e "dataAtual".
 * Sem modelo, é gerado um documento-base com os dados do processo.
 */
var DocumentoService = {
  STATUS: { RASCUNHO: 'RASCUNHO', FINAL: 'FINAL' },

  listar: function (processoId) {
    var lista = repo('Documentos').onde({ processoId: processoId });
    lista.sort(function (a, b) { return a.criadoEm < b.criadoEm ? 1 : -1; });
    return lista;
  },

  _proximaVersao: function (processoId, tipoCodigo) {
    var v = 0;
    repo('Documentos').onde({ processoId: processoId, tipoCodigo: tipoCodigo }).forEach(function (d) {
      v = Math.max(v, d.versao || 0);
    });
    return v + 1;
  },

  _tipoValido: function (tipoCodigo) {
    var tipo = ConfigService.tipoDocumento(tipoCodigo);
    if (!tipo) throw Utils.erro('Tipo de documento inválido: ' + tipoCodigo);
    return tipo;
  },

  dadosSubstituicao: function (proc) {
    var dados = {};
    ['numero', 'titulo', 'objeto', 'numeroSuite', 'setorDemandante', 'responsavelEmail'].forEach(function (k) {
      dados[k] = proc[k] || '';
    });
    dados.valorEstimado = proc.valorEstimado !== null && proc.valorEstimado !== undefined
      ? Number(proc.valorEstimado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
    dados.dataAtual = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
    var vars = Variaveis.mapa(proc.id);
    Object.keys(vars).forEach(function (k) { if (k.indexOf('checklist.') !== 0) dados[k] = vars[k]; });
    return dados;
  },

  gerar: function (processoId, tipoCodigo, tarefaId) {
    var proc = repo('Processos').obterOuFalhar(processoId);
    var tipo = this._tipoValido(tipoCodigo);
    var pasta = DriveService.pastaDoTipo(proc, tipoCodigo);
    var versao = this._proximaVersao(proc.id, tipoCodigo);
    var nome = tipo.nome + ' - ' + proc.numero + (versao > 1 ? ' (v' + versao + ')' : '');
    var dados = this.dadosSubstituicao(proc);
    var fileId;

    if (tipo.modeloId) {
      var copia = DriveApp.getFileById(tipo.modeloId).makeCopy(nome, pasta);
      fileId = copia.getId();
      var doc = DocumentApp.openById(fileId);
      var partes = [doc.getBody()];
      if (doc.getHeader()) partes.push(doc.getHeader());
      if (doc.getFooter()) partes.push(doc.getFooter());
      Object.keys(dados).forEach(function (k) {
        var padrao = '\\{\\{' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\}\\}';
        partes.forEach(function (p) { p.replaceText(padrao, String(dados[k])); });
      });
      doc.saveAndClose();
    } else {
      var novo = DocumentApp.create(nome);
      var corpo = novo.getBody();
      corpo.appendParagraph(tipo.nome).setHeading(DocumentApp.ParagraphHeading.TITLE);
      corpo.appendParagraph('Processo ' + proc.numero + ' — ' + proc.titulo);
      corpo.appendParagraph('Objeto: ' + (proc.objeto || ''));
      corpo.appendParagraph('Dados registrados no sistema').setHeading(DocumentApp.ParagraphHeading.HEADING2);
      var linhas = Object.keys(dados).map(function (k) { return [k, String(dados[k])]; });
      if (linhas.length) corpo.appendTable(linhas);
      corpo.appendParagraph('(Documento-base gerado sem modelo. Cadastre um modelo em cfg_DocumentosTipo.)');
      novo.saveAndClose();
      fileId = novo.getId();
      DriveService.mover(fileId, pasta);
    }
    var arquivo = DriveApp.getFileById(fileId);
    var tarefa = tarefaId ? repo('Tarefas').obter(tarefaId) : null;
    var reg = repo('Documentos').inserir({
      processoId: proc.id,
      tarefaId: tarefaId || '',
      etapaCodigo: tarefa ? tarefa.etapaCodigo : '',
      tipoCodigo: tipoCodigo,
      nome: nome,
      fileId: fileId,
      url: arquivo.getUrl(),
      mimeType: 'application/vnd.google-apps.document',
      origem: 'GERADO',
      status: this.STATUS.RASCUNHO,
      versao: versao,
      criadoEm: Utils.agora(),
      criadoPor: Auth.email()
    });
    Historico.registrar(proc.id, tarefaId, 'DOCUMENTO_GERADO', nome);
    return reg;
  },

  /** arquivo = {nome, mimeType, base64} */
  anexar: function (processoId, tipoCodigo, tarefaId, arquivo) {
    if (!arquivo || !arquivo.base64) throw Utils.erro('Arquivo não informado.');
    var proc = repo('Processos').obterOuFalhar(processoId);
    this._tipoValido(tipoCodigo);
    var pasta = DriveService.pastaDoTipo(proc, tipoCodigo);
    var file = DriveService.salvarArquivo(pasta, arquivo.nome, arquivo.mimeType, arquivo.base64);
    var tarefa = tarefaId ? repo('Tarefas').obter(tarefaId) : null;
    var reg = repo('Documentos').inserir({
      processoId: proc.id,
      tarefaId: tarefaId || '',
      etapaCodigo: tarefa ? tarefa.etapaCodigo : '',
      tipoCodigo: tipoCodigo,
      nome: arquivo.nome,
      fileId: file.getId(),
      url: file.getUrl(),
      mimeType: arquivo.mimeType || '',
      origem: 'ANEXADO',
      status: this.STATUS.FINAL, // anexos normalmente são versões finais/assinadas
      versao: this._proximaVersao(proc.id, tipoCodigo),
      criadoEm: Utils.agora(),
      criadoPor: Auth.email()
    });
    Historico.registrar(proc.id, tarefaId, 'DOCUMENTO_ANEXADO', ConfigService.tipoDocumento(tipoCodigo).nome + ': ' + arquivo.nome);
    return reg;
  },

  /** Registra um arquivo que já existe no Drive (link ou ID), movendo-o para a pasta do tipo. */
  vincular: function (processoId, tipoCodigo, tarefaId, linkOuId, mover) {
    var m = String(linkOuId || '').match(/[-\w]{25,}/);
    if (!m) throw Utils.erro('Link ou ID do arquivo inválido.');
    var proc = repo('Processos').obterOuFalhar(processoId);
    this._tipoValido(tipoCodigo);
    var file = DriveApp.getFileById(m[0]);
    if (mover) file.moveTo(DriveService.pastaDoTipo(proc, tipoCodigo));
    var tarefa = tarefaId ? repo('Tarefas').obter(tarefaId) : null;
    var reg = repo('Documentos').inserir({
      processoId: proc.id, tarefaId: tarefaId || '', etapaCodigo: tarefa ? tarefa.etapaCodigo : '',
      tipoCodigo: tipoCodigo, nome: file.getName(), fileId: file.getId(), url: file.getUrl(),
      mimeType: file.getMimeType(), origem: 'VINCULADO', status: this.STATUS.FINAL,
      versao: this._proximaVersao(proc.id, tipoCodigo), criadoEm: Utils.agora(), criadoPor: Auth.email()
    });
    Historico.registrar(proc.id, tarefaId, 'DOCUMENTO_VINCULADO', file.getName());
    return reg;
  },

  alterarStatus: function (documentoId, status) {
    if (!this.STATUS[status]) throw Utils.erro('Status inválido.');
    var d = repo('Documentos').atualizar(documentoId, { status: status });
    Historico.registrar(d.processoId, d.tarefaId, 'DOCUMENTO_STATUS', d.nome + ' → ' + status);
    return d;
  }
};
