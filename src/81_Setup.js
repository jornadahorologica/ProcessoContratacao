/**
 * Instalação / atualização do sistema. Execute setup() no editor do Apps Script.
 *
 * - cria a planilha do banco de dados (ou usa DB_SPREADSHEET_ID, se definido);
 * - cria/atualiza as abas conforme SCHEMA (colunas novas são acrescentadas);
 * - cria a pasta raiz (ou usa ROOT_FOLDER_ID, se definido — recomendado:
 *   uma pasta em Drive Compartilhado);
 * - carrega a configuração do fluxo da CESOP nas abas cfg_* vazias;
 * - cadastra quem executou como ADMIN.
 *
 * É seguro executar novamente: nada é apagado.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var log = [];

  var ss;
  var dbId = props.getProperty(APP.PROP.DB_ID);
  if (dbId) {
    ss = SpreadsheetApp.openById(dbId);
    log.push('Banco de dados existente: ' + ss.getUrl());
  } else {
    ss = SpreadsheetApp.create(APP.NOME_PLANILHA_BD);
    props.setProperty(APP.PROP.DB_ID, ss.getId());
    log.push('Banco de dados criado: ' + ss.getUrl());
  }
  Db._ss = ss;

  Object.keys(SCHEMA).forEach(function (nome) { log.push(garantirAba_(ss, nome)); });
  ['Sheet1', 'Página1', 'Planilha1'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });

  var rootId = props.getProperty(APP.PROP.ROOT_FOLDER_ID);
  if (!rootId) {
    var pasta = DriveApp.createFolder(APP.NOME_PASTA_RAIZ);
    props.setProperty(APP.PROP.ROOT_FOLDER_ID, pasta.getId());
    try { DriveApp.getFileById(ss.getId()).moveTo(pasta); } catch (e) { /* opcional */ }
    log.push('Pasta raiz criada: ' + pasta.getUrl());
  } else {
    log.push('Pasta raiz existente: ' + DriveApp.getFolderById(rootId).getUrl());
  }

  log = log.concat(Seed.carregar());

  var email = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (email && !repo('cfg_Usuarios').obter(email)) {
    repo('cfg_Usuarios').inserir({ email: email, nome: email.split('@')[0], setor: 'CESOP', papel: PAPEIS.ADMIN, ativo: true });
    log.push('Administrador cadastrado: ' + email);
  }
  ConfigService.limparCache();
  log.push('Setup concluído. Publique o Web App em Implantar > Nova implantação > Aplicativo da Web.');
  console.log(log.join('\n'));
  return log;
}

/** Cria a aba (se necessário), acrescenta colunas que faltam e formata como texto. */
function garantirAba_(ss, nome) {
  var sh = ss.getSheetByName(nome);
  var criada = false;
  if (!sh) { sh = ss.insertSheet(nome); criada = true; }
  var esperadas = parseColunas_(SCHEMA[nome]).map(function (c) { return c.nome; });
  var atuais = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  var faltando = esperadas.filter(function (c) { return atuais.indexOf(c) < 0; });
  if (faltando.length) {
    sh.getRange(1, atuais.length + 1, 1, faltando.length).setValues([faltando]);
  }
  var nCols = atuais.length + faltando.length;
  sh.getRange(1, 1, sh.getMaxRows(), nCols).setNumberFormat('@');
  sh.getRange(1, 1, 1, nCols).setFontWeight('bold').setBackground(nome.indexOf('cfg_') === 0 ? '#fff2cc' : '#d9e8fb');
  sh.setFrozenRows(1);
  return nome + (criada ? ': criada' : '') + (faltando.length ? ' (+' + faltando.join(', ') + ')' : ': ok');
}

/** Cria o gatilho diário de notificações de prazo (07h). */
function instalarGatilhos() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'rotinaDiaria') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('rotinaDiaria').timeBased().everyDays(1).atHour(7).create();
  return 'Gatilho diário instalado.';
}
