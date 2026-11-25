/**
 * Camada de acesso a dados sobre o Google Sheets.
 *
 * Cada aba é tratada como uma tabela: a linha 1 contém os cabeçalhos e a
 * primeira coluna do esquema é a chave primária. As colunas são localizadas
 * pelo nome do cabeçalho, então a ordem na planilha pode ser alterada.
 *
 * DESEMPENHO — cada chamada à planilha custa ~0,1–0,5 s no Apps Script, então:
 *  - LEITURA: cada aba é lida uma única vez por execução; com o serviço
 *    avançado "Google Sheets API" ativado (identificador "Sheets"), várias abas
 *    são lidas numa única chamada (Db.precarregar).
 *  - ESCRITA: inclusões e alterações ficam em memória e são gravadas em lote
 *    no fim da operação (Db.gravar), poucas chamadas no total. Se a operação
 *    falhar no meio, nada é gravado (tudo ou nada).
 *
 * Todos os valores são gravados como TEXTO (colunas formatadas com "@" ou
 * gravação RAW pela API) e convertidos de/para o tipo do esquema aqui, o que
 * evita as conversões automáticas do Sheets (datas, zeros à esquerda etc.).
 */

var Db = {
  _ss: null,
  _sheets: {},
  _id: null,

  id: function () {
    if (!this._id) {
      this._id = PropertiesService.getScriptProperties().getProperty(APP.PROP.DB_ID);
      if (!this._id) throw new Error('Banco de dados não configurado. Execute a função setup() no editor do Apps Script.');
    }
    return this._id;
  },

  url: function () {
    return 'https://docs.google.com/spreadsheets/d/' + this.id() + '/edit';
  },

  planilha: function () {
    if (!this._ss) this._ss = SpreadsheetApp.openById(this.id());
    return this._ss;
  },

  aba: function (nome) {
    if (!this._sheets[nome]) {
      var sh = this.planilha().getSheetByName(nome);
      if (!sh) throw new Error('Aba "' + nome + '" não encontrada no banco de dados. Clique em Administração > Aplicar atualizações.');
      this._sheets[nome] = sh;
    }
    return this._sheets[nome];
  },

  /** Serviço avançado Google Sheets API disponível? (Editor > Serviços > Google Sheets API) */
  temApi: function () {
    try {
      return typeof Sheets !== 'undefined' && Sheets && Sheets.Spreadsheets && Sheets.Spreadsheets.Values ? true : false;
    } catch (e) {
      return false;
    }
  },

  /**
   * Lê várias abas numa única chamada (requer o serviço avançado). Sem o
   * serviço, não faz nada: cada aba é lida sob demanda.
   */
  precarregar: function (nomes) {
    if (!this.temApi()) return;
    var faltam = nomes.filter(function (n) { return !repo(n)._linhas; });
    if (!faltam.length) return;
    var resp = Sheets.Spreadsheets.Values.batchGet(this.id(), {
      ranges: faltam.map(function (n) { return "'" + n + "'"; })
    });
    (resp.valueRanges || []).forEach(function (vr, i) {
      repo(faltam[i])._preencher(vr.values || []);
    });
  },

  /** Grava em lote tudo o que ficou pendente nos repositórios desta execução. */
  gravar: function () {
    var self = this;
    var pendentes = Object.keys(_repos).map(function (k) { return _repos[k]; })
      .filter(function (r) { return r._novos.length || Object.keys(r._sujos).length; });
    if (!pendentes.length) return;

    if (this.temApi()) {
      // Inclusões: um "append" por aba; alterações: um único batchUpdate para todas as abas
      pendentes.forEach(function (r) { r._gravarInclusoesApi(); });
      var dados = [];
      pendentes.forEach(function (r) {
        r._intervalosAlterados().forEach(function (d) { dados.push({ range: d.range, values: d.values }); });
      });
      if (dados.length) {
        Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: dados }, self.id());
      }
      pendentes.forEach(function (r) { r._sujos = {}; });
    } else {
      pendentes.forEach(function (r) { r._gravarSpreadsheetApp(); });
    }
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
 * Tabelas em que só se acrescenta (auditoria): incluir não exige ler a aba
 * inteira. A ordem das colunas segue o SCHEMA (o setup só acrescenta colunas no fim).
 */
var TABELAS_SOMENTE_INCLUSAO = { Historico: true };

/** Letra da coluna (1 -> A, 27 -> AA). */
function letraColuna_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * @param {string} nome nome da aba (chave em SCHEMA)
 */
function Repo(nome) {
  if (!SCHEMA[nome]) throw new Error('Tabela desconhecida: ' + nome);
  this.nome = nome;
  this.colunas = parseColunas_(SCHEMA[nome]);
  this.chave = this.colunas[0].nome;
  this._linhas = null;   // cache da execução: array de objetos (na ordem da planilha)
  this._indice = null;   // chave -> número da linha na planilha
  this._porChave = null; // chave -> objeto
  this._cabecalho = null;
  this._ultimaLinha = 1; // última linha ocupada na planilha
  this._novos = [];      // inclusões pendentes
  this._sujos = {};      // chave -> true (alterações pendentes)
}

/** Monta o cache a partir de uma matriz de valores (linha 1 = cabeçalho). */
Repo.prototype._preencher = function (valores) {
  var cab = (valores[0] || []).map(function (h) { return String(h).trim(); });
  this._cabecalho = cab;
  var pos = {};
  cab.forEach(function (h, i) { pos[h] = i; });
  var self = this;
  this._linhas = [];
  this._indice = {};
  this._porChave = {};
  this._ultimaLinha = Math.max(valores.length, 1);
  if (!cab.length) this._cabecalho = this.colunas.map(function (c) { return c.nome; });
  for (var r = 1; r < valores.length; r++) {
    var linha = valores[r] || [];
    var obj = {};
    self.colunas.forEach(function (c) {
      var i = pos[c.nome];
      obj[c.nome] = daCelula_(i === undefined || linha[i] === undefined ? '' : linha[i], c.tipo);
    });
    var k = obj[self.chave];
    if (Utils.vazio(k)) continue;
    self._linhas.push(obj);
    self._indice[k] = r + 1;
    self._porChave[k] = obj;
  }
  // Inclusões feitas antes da leitura (tabelas somente-inclusão) continuam pendentes
  this._novos.forEach(function (o) { self._linhas.push(o); self._porChave[o[self.chave]] = o; });
};

Repo.prototype._carregar = function () {
  if (this._linhas) return;
  this._preencher(Db.aba(this.nome).getDataRange().getValues());
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

/** Filtra e devolve cópias apenas dos registros encontrados (o predicado não deve alterar o objeto). */
Repo.prototype.filtrar = function (pred) {
  this._carregar();
  return this._linhas.filter(pred).map(this._copia);
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
  var o = this._porChave[chave];
  return o ? this._copia(o) : null;
};

Repo.prototype.obterOuFalhar = function (chave) {
  var o = this.obter(chave);
  if (!o) throw Utils.erro('Registro não encontrado em ' + this.nome + ': ' + chave);
  return o;
};

Repo.prototype.inserir = function (obj) {
  var novo = {};
  this.colunas.forEach(function (c) { novo[c.nome] = obj[c.nome] === undefined ? (c.tipo === 's' ? '' : null) : obj[c.nome]; });
  if (Utils.vazio(novo[this.chave])) novo[this.chave] = Utils.uuid();
  if (!this._linhas && TABELAS_SOMENTE_INCLUSAO[this.nome]) {
    // Sem ler a aba: a chave é um UUID novo e o cabeçalho segue o SCHEMA
    if (!this._cabecalho) this._cabecalho = this.colunas.map(function (c) { return c.nome; });
    this._novos.push(novo);
    return this._copia(novo);
  }
  this._carregar();
  if (this._porChave[novo[this.chave]]) throw new Error('Chave duplicada em ' + this.nome + ': ' + novo[this.chave]);
  this._linhas.push(novo);
  this._porChave[novo[this.chave]] = novo;
  this._novos.push(novo);
  return this._copia(novo);
};

Repo.prototype.atualizar = function (chave, alteracoes) {
  this._carregar();
  var atual = this._porChave[chave];
  if (!atual) throw Utils.erro('Registro não encontrado em ' + this.nome + ': ' + chave);
  var self = this;
  Object.keys(alteracoes).forEach(function (k) {
    if (k !== self.chave && atual.hasOwnProperty(k)) atual[k] = alteracoes[k];
  });
  if (this._indice[chave]) this._sujos[chave] = true; // registros ainda não gravados saem na inclusão
  return this._copia(atual);
};

Repo.prototype.remover = function (chave) {
  this._carregar();
  if (!this._porChave[chave]) return false;
  Db.gravar(); // grava pendências antes de deslocar as linhas
  var linha = this._indice[chave];
  Db.aba(this.nome).deleteRow(linha);
  // Recarrega na próxima leitura (os números de linha mudaram)
  this._linhas = null;
  this._indice = null;
  this._porChave = null;
  return true;
};

// ------------------------------------------------------------------ gravação em lote
/** Intervalos A1 com as linhas alteradas (agrupa linhas próximas num só intervalo). */
Repo.prototype._intervalosAlterados = function () {
  var self = this;
  var linhas = Object.keys(this._sujos).map(function (k) { return self._indice[k]; })
    .filter(Boolean).sort(function (a, b) { return a - b; });
  if (!linhas.length) return [];
  var porLinha = {};
  this._linhas.forEach(function (o) { var l = self._indice[o[self.chave]]; if (l) porLinha[l] = o; });
  // Junta linhas próximas (até 10 de distância) num só intervalo, desde que todas as
  // linhas do meio sejam registros conhecidos (são regravadas com o mesmo conteúdo).
  var completo = function (de, ate) {
    for (var l = de; l <= ate; l++) if (!porLinha[l]) return false;
    return true;
  };
  var grupos = [];
  var atual = [linhas[0], linhas[0]];
  for (var i = 1; i < linhas.length; i++) {
    if (linhas[i] - atual[1] <= 10 && completo(atual[1], linhas[i])) atual[1] = linhas[i];
    else { grupos.push(atual); atual = [linhas[i], linhas[i]]; }
  }
  grupos.push(atual);
  var ultimaCol = letraColuna_(this._cabecalho.length);
  return grupos.map(function (g) {
    var valores = [];
    for (var l = g[0]; l <= g[1]; l++) valores.push(self._linhaPlanilha(porLinha[l]));
    return { range: "'" + self.nome + "'!A" + g[0] + ':' + ultimaCol + g[1], values: valores, inicio: g[0], fim: g[1] };
  });
};

Repo.prototype._gravarInclusoesApi = function () {
  if (!this._novos.length) return;
  var self = this;
  var valores = this._novos.map(function (o) { return self._linhaPlanilha(o); });
  var resp = Sheets.Spreadsheets.Values.append({ values: valores }, Db.id(), "'" + this.nome + "'!A1",
    { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' });
  var m = String((resp.updates && resp.updates.updatedRange) || '').match(/![A-Z]+(\d+)/);
  var inicio = m ? Number(m[1]) : this._ultimaLinha + 1;
  if (this._indice) this._novos.forEach(function (o, i) { self._indice[o[self.chave]] = inicio + i; });
  this._ultimaLinha = Math.max(this._ultimaLinha, inicio + this._novos.length - 1);
  this._novos = [];
};

/** Caminho sem o serviço avançado: um bloco para as inclusões e um por grupo de alterações. */
/** Pelo SpreadsheetApp, texto começando com "=" vira fórmula: o apóstrofo força texto (não é gravado). */
function textoSeguro_(linha) {
  return linha.map(function (v) { return typeof v === 'string' && /^[=+]/.test(v) ? "'" + v : v; });
}

Repo.prototype._gravarSpreadsheetApp = function () {
  var self = this;
  var sh = Db.aba(this.nome);
  var n = this._cabecalho.length;
  if (this._novos.length) {
    var inicio = sh.getLastRow() + 1;
    var precisa = inicio + this._novos.length - 1 - sh.getMaxRows();
    if (precisa > 0) sh.insertRowsAfter(sh.getMaxRows(), precisa);
    sh.getRange(inicio, 1, this._novos.length, n).setNumberFormat('@')
      .setValues(this._novos.map(function (o) { return textoSeguro_(self._linhaPlanilha(o)); }));
    if (this._indice) this._novos.forEach(function (o, i) { self._indice[o[self.chave]] = inicio + i; });
    this._ultimaLinha = inicio + this._novos.length - 1;
    this._novos = [];
  }
  this._intervalosAlterados().forEach(function (d) {
    sh.getRange(d.inicio, 1, d.fim - d.inicio + 1, n).setValues(d.values.map(textoSeguro_));
  });
  this._sujos = {};
};

/** Repositórios por execução (no Apps Script o escopo global é recriado a cada chamada). */
var _repos = {};
function repo(nome) {
  if (!_repos[nome]) _repos[nome] = new Repo(nome);
  return _repos[nome];
}
