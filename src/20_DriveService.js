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

  mover: function (fileId, pasta) {
    DriveApp.getFileById(fileId).moveTo(pasta);
  }
};
