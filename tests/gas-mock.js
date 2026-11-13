/**
 * Simulação mínima, em memória, dos serviços do Google Apps Script usados
 * pelo projeto, para rodar os testes localmente com Node (npm test).
 */
'use strict';
const crypto = require('crypto');

function criarAmbiente(opcoes) {
  opcoes = opcoes || {};
  const estado = {
    usuarioAtivo: opcoes.usuario || 'admin@orgao.gov.br',
    emails: [],
    planilhas: {},
    arquivos: {},
    props: {},
    cache: {}
  };
  let seq = 0;
  const novoId = (p) => p + '_' + String(++seq).padStart(28, '0');

  // ---------------------------------------------------------------- Sheets
  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = [];
        for (let j = 0; j < this.nc; j++) {
          const linha = this.sh.dados[this.r - 1 + i] || [];
          const v = linha[this.c - 1 + j];
          row.push(v === undefined ? '' : v);
        }
        out.push(row);
      }
      return out;
    }
    setValues(vals) {
      if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error('setValues: dimensões incompatíveis');
      for (let i = 0; i < this.nr; i++) {
        const idx = this.r - 1 + i;
        while (this.sh.dados.length <= idx) this.sh.dados.push([]);
        for (let j = 0; j < this.nc; j++) {
          const v = vals[i][j];
          if (typeof v !== 'string') throw new Error('Repositório deve gravar apenas texto; recebido ' + typeof v);
          this.sh.dados[idx][this.c - 1 + j] = v;
        }
      }
      return this;
    }
    setNumberFormat() { return this; }
    setFontWeight() { return this; }
    setBackground() { return this; }
  }
  class Sheet {
    constructor(nome) { this.nome = nome; this.dados = []; }
    getName() { return this.nome; }
    getLastRow() {
      for (let i = this.dados.length - 1; i >= 0; i--) {
        if ((this.dados[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1;
      }
      return 0;
    }
    getLastColumn() { return this.dados.reduce((m, l) => Math.max(m, (l || []).length), 0); }
    getMaxRows() { return Math.max(1000, this.dados.length); }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
    getDataRange() { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
    appendRow(row) { this.dados.splice(this.getLastRow(), 0, row.map(String)); }
    deleteRow(r) { this.dados.splice(r - 1, 1); }
    setFrozenRows() {}
  }
  class Spreadsheet {
    constructor(nome) { this.id = novoId('ss'); this.nome = nome; this.abas = [new Sheet('Sheet1')]; }
    getId() { return this.id; }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
    getSheetByName(n) { return this.abas.find((s) => s.nome === n) || null; }
    insertSheet(n) { const s = new Sheet(n); this.abas.push(s); return s; }
    getSheets() { return this.abas.slice(); }
    deleteSheet(s) { this.abas = this.abas.filter((x) => x !== s); }
  }
  const SpreadsheetApp = {
    create(nome) { const ss = new Spreadsheet(nome); estado.planilhas[ss.id] = ss; estado.arquivos[ss.id] = new Arquivo(ss.id, nome, 'sheet'); return ss; },
    openById(id) { const ss = estado.planilhas[id]; if (!ss) throw new Error('Planilha não encontrada'); return ss; }
  };

  // ---------------------------------------------------------------- Drive
  class Arquivo {
    constructor(id, nome, mime, pai) { Object.assign(this, { id, nome, mime, pai }); }
    getId() { return this.id; }
    getName() { return this.nome; }
    getUrl() { return 'https://drive.google.com/file/d/' + this.id; }
    getMimeType() { return this.mime; }
    getBlob() { return { getContentType: () => 'image/png', getBytes: () => [137, 80, 78, 71] }; }
    moveTo(pasta) { this.pai = pasta.id; return this; }
    makeCopy(nome, pasta) {
      const id = novoId('f');
      const a = new Arquivo(id, nome, this.mime, pasta.id);
      estado.arquivos[id] = a;
      if (estado.docs[this.id]) estado.docs[id] = new Documento(id, nome, estado.docs[this.id].texto);
      return a;
    }
  }
  class Pasta {
    constructor(nome, pai) { this.id = novoId('d'); this.nome = nome; this.pai = pai; estado.pastas[this.id] = this; }
    getId() { return this.id; }
    getName() { return this.nome; }
    getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; }
    createFolder(nome) { return new Pasta(nome, this.id); }
    createFile(blob) { const id = novoId('f'); const a = new Arquivo(id, blob.nome, blob.mime, this.id); estado.arquivos[id] = a; return a; }
    filhas() { return Object.values(estado.pastas).filter((p) => p.pai === this.id); }
  }
  estado.pastas = {};
  estado.docs = {};
  const DriveApp = {
    createFolder(nome) { return new Pasta(nome, null); },
    getFolderById(id) { const p = estado.pastas[id]; if (!p) throw new Error('Pasta não encontrada: ' + id); return p; },
    getFileById(id) { const a = estado.arquivos[id]; if (!a) throw new Error('Arquivo não encontrado: ' + id); return a; }
  };

  // ---------------------------------------------------------------- Docs
  class Corpo {
    constructor(doc) { this.doc = doc; }
    appendParagraph(t) { this.doc.texto += t + '\n'; return { setHeading() { return this; } }; }
    appendTable(linhas) { this.doc.texto += linhas.map((l) => l.join(' | ')).join('\n') + '\n'; return {}; }
    replaceText(padrao, valor) { this.doc.texto = this.doc.texto.replace(new RegExp(padrao, 'g'), valor); }
  }
  class Documento {
    constructor(id, nome, texto) { this.id = id; this.nome = nome; this.texto = texto || ''; }
    getId() { return this.id; }
    getBody() { return new Corpo(this); }
    getHeader() { return null; }
    getFooter() { return null; }
    saveAndClose() {}
  }
  const DocumentApp = {
    ParagraphHeading: { TITLE: 'TITLE', HEADING1: 'H1', HEADING2: 'H2' },
    create(nome) {
      const id = novoId('f');
      estado.arquivos[id] = new Arquivo(id, nome, 'application/vnd.google-apps.document', null);
      return (estado.docs[id] = new Documento(id, nome));
    },
    openById(id) { return estado.docs[id]; }
  };

  // ---------------------------------------------------------------- outros
  const tz = 'America/Fortaleza';
  const ctx = {
    console: { log() {}, warn() {}, error: (...a) => opcoes.verbose && console.error(...a) },
    SpreadsheetApp, DriveApp, DocumentApp,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in estado.props ? estado.props[k] : null),
        setProperty: (k, v) => { estado.props[k] = String(v); }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => estado.cache[k] || null,
        put: (k, v) => { estado.cache[k] = v; },
        remove: (k) => { delete estado.cache[k]; }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Session: {
      getActiveUser: () => ({ getEmail: () => estado.usuarioAtivo }),
      getEffectiveUser: () => ({ getEmail: () => 'admin@orgao.gov.br' }),
      getScriptTimeZone: () => tz
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate(d, zona, fmt) {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' })
          .formatToParts(d).map((x) => [x.type, x.value]));
        return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day);
      },
      base64Decode: (s) => Array.from(Buffer.from(s, 'base64')),
      base64Encode: (b) => Buffer.from(b).toString('base64'),
      newBlob: (bytes, mime, nome) => ({ bytes, mime, nome })
    },
    MailApp: { sendEmail: (m) => estado.emails.push(m) },
    HtmlService: {},
    ScriptApp: {}
  };
  return { ctx, estado };
}

module.exports = { criarAmbiente };
