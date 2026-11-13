/**
 * Camada de acesso a dados sobre o Google Sheets.
 *
 * Cada aba é tratada como uma tabela: a linha 1 contém os cabeçalhos e a
 * primeira coluna do esquema é a chave primária. As colunas são localizadas
 * pelo nome do cabeçalho, então a ordem na planilha pode ser alterada.
 *
 * Todos os valores são gravados como TEXTO (as colunas são formatadas com "@"
 * no setup) e convertidos de/para o tipo do esquema aqui, o que evita as
 * conversões automáticas do Sheets (datas, números com zero à esquerda etc.).
 */

var Db = {
  _ss: null,
  _sheets: {},

  planilha: function () {
    if (!this._ss) {
      var id = PropertiesService.getScriptProperties().getProperty(APP.PROP.DB_ID);
      if (!id) throw new Error('Banco de dados não configurado. Execute a função setup() no editor do Apps Script.');
      this._ss = SpreadsheetApp.openById(id);
    }
    return this._ss;
  },

  aba: function (nome) {
    if (!this._sheets[nome]) {
      var sh = this.planilha().getSheetByName(nome);
      if (!sh) throw new Error('Aba "' + nome + '" não encontrada no banco de dados. Execute setup().');
      this._sheets[nome] = sh;
    }
    return this._sheets[nome];
  }
};

/** Converte "nome:tipo" em {nome, tipo}. */
function parseColunas_(spec) {
  return spec.map(function (c) {
    var p = c.split(':');
    return { nome: p[0], tipo: p[1] || 's' };
  });
}

function paraCelula_(valor, tipo) {
  if (valor === null || valor === undefined) return '';
  if (tipo === 'j') return JSON.stringify(valor);
  if (tipo === 'b') return valor === true || valor === 'true' || valor === 'TRUE' ? 'TRUE' : 'FALSE';
  if (valor instanceof Date) return valor.toISOString();
  return String(valor);
}

function daCelula_(valor, tipo) {
  if (valor instanceof Date) {
    // Célula convertida em data pelo Sheets (ex.: edição manual da configuração)
    var meiaNoite = valor.getHours() === 0 && valor.getMinutes() === 0 && valor.getSeconds() === 0;
    valor = meiaNoite ? Utilities.formatDate(valor, Session.getScriptTimeZone(), 'yyyy-MM-dd') : valor.toISOString();
  }
  if (tipo === 'b') {
    if (valor === true) return true;
    return ['TRUE', 'VERDADEIRO', 'SIM', 'S', '1', 'X'].indexOf(String(valor).trim().toUpperCase()) >= 0;
  }
  if (valor === '' || valor === null || valor === undefined) return tipo === 's' ? '' : null;
  if (tipo === 'n') {
    if (typeof valor === 'number') return valor;
    var s = String(valor).trim();
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.'); // formato pt-BR
    var n = Number(s);
    return isNaN(n) ? null : n;
  }
  if (tipo === 'j') {
    try { return JSON.parse(valor); } catch (e) { return null; }
  }
  return String(valor);
}

/**
 * @param {string} nome nome da aba (chave em SCHEMA)
 */
function Repo(nome) {
  if (!SCHEMA[nome]) throw new Error('Tabela desconhecida: ' + nome);
  this.nome = nome;
  this.colunas = parseColunas_(SCHEMA[nome]);
  this.chave = this.colunas[0].nome;
  this._linhas = null;   // cache da execução: array de objetos
  this._indice = null;   // chave -> número da linha na planilha
  this._cabecalho = null;
}

Repo.prototype._carregar = function () {
  if (this._linhas) return;
  var sh = Db.aba(this.nome);
  var valores = sh.getDataRange().getValues();
  var cab = (valores[0] || []).map(function (h) { return String(h).trim(); });
  this._cabecalho = cab;
  var pos = {};
  cab.forEach(function (h, i) { pos[h] = i; });
  var self = this;
  this._linhas = [];
  this._indice = {};
  for (var r = 1; r < valores.length; r++) {
    var linha = valores[r];
    var obj = {};
    self.colunas.forEach(function (c) {
      var i = pos[c.nome];
      obj[c.nome] = daCelula_(i === undefined ? '' : linha[i], c.tipo);
    });
    var k = obj[self.chave];
    if (Utils.vazio(k)) continue;
    self._linhas.push(obj);
    self._indice[k] = r + 1;
  }
};

Repo.prototype._linhaPlanilha = function (obj) {
  var tipos = {};
  this.colunas.forEach(function (c) { tipos[c.nome] = c.tipo; });
  return this._cabecalho.map(function (h) {
    return tipos[h] ? paraCelula_(obj[h], tipos[h]) : '';
  });
};

Repo.prototype._copia = function (o) {
  return JSON.parse(JSON.stringify(o));
};

/** Todas as linhas (cópias). */
Repo.prototype.todos = function () {
  this._carregar();
  return this._linhas.map(this._copia);
};

Repo.prototype.filtrar = function (pred) {
  return this.todos().filter(pred);
};

/** Filtra por igualdade de campos: repo.onde({processoId: 'x'}) */
Repo.prototype.onde = function (criterios) {
  return this.filtrar(function (o) {
    for (var k in criterios) if (o[k] !== criterios[k]) return false;
    return true;
  });
};

Repo.prototype.obter = function (chave) {
  this._carregar();
  for (var i = 0; i < this._linhas.length; i++) {
    if (this._linhas[i][this.chave] === chave) return this._copia(this._linhas[i]);
  }
  return null;
};

Repo.prototype.obterOuFalhar = function (chave) {
  var o = this.obter(chave);
  if (!o) throw Utils.erro('Registro não encontrado em ' + this.nome + ': ' + chave);
  return o;
};

Repo.prototype.inserir = function (obj) {
  this._carregar();
  var novo = {};
  this.colunas.forEach(function (c) { novo[c.nome] = obj[c.nome] === undefined ? (c.tipo === 's' ? '' : null) : obj[c.nome]; });
  if (Utils.vazio(novo[this.chave])) novo[this.chave] = Utils.uuid();
  if (this._indice[novo[this.chave]]) throw new Error('Chave duplicada em ' + this.nome + ': ' + novo[this.chave]);
  var sh = Db.aba(this.nome);
  var linha = sh.getLastRow() + 1;
  // Formata a linha como texto antes de gravar, para o Sheets não converter valores.
  // As gravações são serializadas pelo lock do dispatcher da API (90_Api.js).
  sh.getRange(linha, 1, 1, this._cabecalho.length).setNumberFormat('@').setValues([this._linhaPlanilha(novo)]);
  this._linhas.push(novo);
  this._indice[novo[this.chave]] = linha;
  return this._copia(novo);
};

Repo.prototype.atualizar = function (chave, alteracoes) {
  this._carregar();
  var linha = this._indice[chave];
  if (!linha) throw Utils.erro('Registro não encontrado em ' + this.nome + ': ' + chave);
  var atual = null;
  for (var i = 0; i < this._linhas.length; i++) {
    if (this._linhas[i][this.chave] === chave) { atual = this._linhas[i]; break; }
  }
  var self = this;
  Object.keys(alteracoes).forEach(function (k) {
    if (k !== self.chave && atual.hasOwnProperty(k)) atual[k] = alteracoes[k];
  });
  Db.aba(this.nome).getRange(linha, 1, 1, this._cabecalho.length).setValues([this._linhaPlanilha(atual)]);
  return this._copia(atual);
};

Repo.prototype.remover = function (chave) {
  this._carregar();
  var linha = this._indice[chave];
  if (!linha) return false;
  Db.aba(this.nome).deleteRow(linha);
  // Recarrega na próxima leitura (os números de linha mudaram)
  this._linhas = null;
  this._indice = null;
  return true;
};

/** Repositórios por execução (no Apps Script o escopo global é recriado a cada chamada). */
var _repos = {};
function repo(nome) {
  if (!_repos[nome]) _repos[nome] = new Repo(nome);
  return _repos[nome];
}
