/**
 * Integração com o Google Drive: estrutura de pastas por processo e gravação
 * de arquivos. Recomenda-se que a pasta raiz (ROOT_FOLDER_ID) esteja em um
 * Drive Compartilhado, para que os arquivos pertençam à unidade.
 */
var DriveService = {
  raiz: function () {
    var id = PropertiesService.getScriptProperties().getProperty(APP.PROP.ROOT_FOLDER_ID);
    if (!id) throw new Error('Pasta raiz não configurada. Execute setup().');
    return DriveApp.getFolderById(id);
  },

  /** Cria "<numero> - <titulo>" com as subpastas de cfg_Pastas. */
  criarPastasProcesso: function (proc) {
    var nome = (proc.numero + ' - ' + proc.titulo).replace(/[\\/:*?"<>|]/g, '-').substring(0, 200);
    var pasta = this.raiz().createFolder(nome);
    var mapa = {};
    ConfigService.pastas(proc.fluxoId).forEach(function (p) {
      mapa[p.nome] = pasta.createFolder(p.nome).getId();
    });
    return { pastaId: pasta.getId(), pastaUrl: pasta.getUrl(), pastas: mapa };
  },

  /** Pasta de destino de um tipo de documento (subpasta configurada ou raiz do processo). */
  pastaDoTipo: function (proc, tipoCodigo) {
    var tipo = ConfigService.tipoDocumento(tipoCodigo);
    var sub = tipo && tipo.pasta;
    var mapa = proc.pastas || {};
    if (sub) {
      if (mapa[sub]) return DriveApp.getFolderById(mapa[sub]);
      // Subpasta incluída na configuração depois da criação do processo
      var raizProc = DriveApp.getFolderById(proc.pastaId);
      var nova = raizProc.createFolder(sub);
      mapa[sub] = nova.getId();
      repo('Processos').atualizar(proc.id, { pastas: mapa });
      proc.pastas = mapa;
      return nova;
    }
    return DriveApp.getFolderById(proc.pastaId);
  },

  salvarArquivo: function (pasta, nome, mimeType, base64) {
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType || 'application/octet-stream', nome);
    return pasta.createFile(blob);
  },

  /**
   * Dá acesso de edição às pastas dos processos (os documentos herdam). A pasta
   * raiz NÃO é compartilhada, porque nela fica a planilha do banco de dados.
   * Retorna {ok, falhas[]} — falhas (ex.: e-mail de fora do domínio) não interrompem.
   */
  compartilhar: function (pastaIds, emails) {
    var falhas = [];
    var ok = 0;
    pastaIds.filter(Boolean).forEach(function (id) {
      var pasta;
      try { pasta = DriveApp.getFolderById(id); } catch (e) { falhas.push(id + ': pasta não encontrada'); return; }
      emails.filter(Boolean).forEach(function (email) {
        try { pasta.addEditor(email); ok++; } catch (e) { falhas.push(email + ': ' + e.message); }
      });
    });
    return { ok: ok, falhas: falhas };
  },

  /** Remove o acesso (usuário desativado). */
  descompartilhar: function (pastaIds, email) {
    pastaIds.filter(Boolean).forEach(function (id) {
      try { DriveApp.getFolderById(id).removeEditor(email); } catch (e) { /* já sem acesso */ }
    });
  },

  emailsAtivos: function () {
    return ConfigService.usuarios().filter(function (u) { return u.ativo; })
      .map(function (u) { return String(u.email).trim().toLowerCase(); });
  },

  pastasDosProcessos: function () {
    return repo('Processos').todos().map(function (p) { return p.pastaId; }).filter(Boolean);
  },

  mover: function (fileId, pasta) {
    DriveApp.getFileById(fileId).moveTo(pasta);
  },

  /** Imagem do Drive como data URI (com cache), para exibir sem exigir compartilhamento. */
  imagemDataUri: function (fileId) {
    if (!fileId) return '';
    var cache = CacheService.getScriptCache();
    var chave = 'img_' + fileId;
    var salvo = cache.get(chave);
    if (salvo) return salvo;
    try {
      var blob = DriveApp.getFileById(fileId).getBlob();
      var uri = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
      try { cache.put(chave, uri, 21600); } catch (e) { /* imagem maior que o limite do cache */ }
      return uri;
    } catch (e) {
      console.warn('Imagem não acessível (' + fileId + '): ' + e);
      return '';
    }
  }
};
