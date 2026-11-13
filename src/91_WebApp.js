/**
 * Web App: serve a SPA (Index.html).
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(APP.NOME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Inclui um arquivo HTML dentro de outro: <?!= incluir('Estilos') ?> */
function incluir(arquivo) {
  return HtmlService.createHtmlOutputFromFile(arquivo).getContent();
}
