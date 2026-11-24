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
    // Contadores de chamadas à planilha (cada uma custa ~0,1–0,5 s no Apps Script real)
    chamadas: { leituras: 0, escritas: 0, formatos: 0 },
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
      estado.chamadas.leituras++;
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
      estado.chamadas.escritas++;
      if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error('setValues: dimensões incompatíveis');
      for (let i = 0; i < this.nr; i++) {
        const idx = this.r - 1 + i;
        while (this.sh.dados.length <= idx) this.sh.dados.push([]);
        for (let j = 0; j < this.nc; j++) {
          const v = vals[i][j];
          if (typeof v !== 'string' && this.sh.ss.id === estado.props.DB_SPREADSHEET_ID) throw new Error('Repositório deve gravar apenas texto; recebido ' + typeof v);
          this.sh.dados[idx][this.c - 1 + j] = v;
        }
      }
      return this;
    }
    setNumberFormat() { estado.chamadas.formatos++; return this; }
    setFontWeight() { return this; }
    setBackground() { return this; }
    setFontSize() { return this; }
    setFontColor() { return this; }
  }
  class Sheet {
    constructor(nome, ss) { this.nome = nome; this.dados = []; this.ss = ss; }
    setName(n) { this.nome = n; return this; }
    getName() { return this.nome; }
    getLastRow() {
      for (let i = this.dados.length - 1; i >= 0; i--) {
        if ((this.dados[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1;
      }
      return 0;
    }
    getLastColumn() { return this.dados.reduce((m, l) => Math.max(m, (l || []).length), 0); }
    getMaxRows() { return Math.max(this.maxRows || 1000, this.dados.length); }
    insertRowsAfter(apos, n) { this.maxRows = this.getMaxRows() + n; }
    getRange(r, c, nr, nc) {
      if (r + (nr || 1) - 1 > this.getMaxRows()) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      return new Range(this, r, c, nr || 1, nc || 1);
    }
    getDataRange() { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
    appendRow(row) { this.dados.splice(this.getLastRow(), 0, row.map(String)); }
    deleteRow(r) { estado.chamadas.escritas++; this.dados.splice(r - 1, 1); }
    setFrozenRows() {}
  }
  class Spreadsheet {
    constructor(nome) { this.id = novoId('ss'); this.nome = nome; this.abas = [new Sheet('Sheet1', this)]; }
    getId() { return this.id; }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
    getSheetByName(n) { return this.abas.find((s) => s.nome === n) || null; }
    insertSheet(n) { const s = new Sheet(n, this); this.abas.push(s); return s; }
    getSheets() { return this.abas.slice(); }
    deleteSheet(s) { this.abas = this.abas.filter((x) => x !== s); }
  }
  const SpreadsheetApp = {
    create(nome) { const ss = new Spreadsheet(nome); estado.planilhas[ss.id] = ss; estado.arquivos[ss.id] = new Arquivo(ss.id, nome, 'application/vnd.google-apps.spreadsheet'); return ss; },
    openById(id) { const ss = estado.planilhas[id]; if (!ss) throw new Error('Planilha não encontrada'); return ss; }
  };

  // ---------------------------------------------------------------- Drive
  class Arquivo {
    constructor(id, nome, mime, pai) { Object.assign(this, { id, nome, mime, pai }); }
    getId() { return this.id; }
    getName() { return this.nome; }
    getUrl() { return 'https://drive.google.com/file/d/' + this.id; }
    getMimeType() { return this.mime; }
    getAs(mime) { const b = { mime, nome: this.nome, setName(n) { this.nome = n; return this; } }; return b; }
    getBlob() { return { getContentType: () => 'image/png', getBytes: () => [137, 80, 78, 71] }; }
    moveTo(pasta) { this.pai = pasta.id; return this; }
    makeCopy(nome, pasta) {
      const id = novoId('f');
      const a = new Arquivo(id, nome, this.mime, pasta.id);
      estado.arquivos[id] = a;
      const orig = estado.docs[this.id];
      if (orig) {
        estado.docs[id] = new Documento(id, nome, orig.paragrafos.map((p) => Object.assign({}, p)),
          orig.cabecalho ? orig.cabecalho.lista.map((p) => Object.assign({}, p)) : null);
      }
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
  // Documento = lista de parágrafos {texto, heading, alinhamento, negrito}; tabelas viram parágrafos "a | b".
  class Paragrafo {
    constructor(corpo, dados) { this.corpo = corpo; this.d = dados; }
    getText() { return this.d.texto; }
    setText(t) { this.d.texto = String(t); return this; }
    setHeading(h) { this.d.heading = h; return this; }
    setAlignment(a) { this.d.alinhamento = a; return this; }
    asParagraph() { return this; }
    asText() { return this.editAsText(); }
    editAsText() {
      const d = this.d;
      return {
        setBold(b) { d.negrito = b; return this; },
        deleteText(i, f) { d.texto = d.texto.slice(0, i) + d.texto.slice(f + 1); return this; },
        insertText(i, t) { d.texto = d.texto.slice(0, i) + t + d.texto.slice(i); return this; }
      };
    }
    copy() { return new Paragrafo(null, Object.assign({}, this.d)); }
    getParent() { return this.corpo; }
  }
  class Corpo {
    constructor(lista) { this.lista = lista; }
    _p(d) { return new Paragrafo(this, d); }
    clear() { this.lista.splice(0, this.lista.length, { texto: '' }); return this; }
    getNumChildren() { return this.lista.length; }
    getChild(i) { return this._p(this.lista[i]); }
    getParagraphs() { return this.lista.map((d) => this._p(d)); }
    getChildIndex(par) { return this.lista.indexOf(par.d); }
    insertParagraph(i, par) { this.lista.splice(i, 0, par.d); return this._p(par.d); }
    appendParagraph(t) { const d = { texto: String(t) }; this.lista.push(d); return this._p(d); }
    appendTable(linhas) { linhas.forEach((l) => this.lista.push({ texto: l.join(' | '), tabela: true })); return {}; }
    findText(padrao) {
      const re = new RegExp(padrao);
      for (const d of this.lista) {
        const m = re.exec(d.texto);
        if (m) {
          const p = this._p(d);
          return { getElement: () => p, getStartOffset: () => m.index, getEndOffsetInclusive: () => m.index + m[0].length - 1 };
        }
      }
      return null;
    }
  }
  class Documento {
    constructor(id, nome, paragrafos, cabecalho) {
      this.id = id; this.nome = nome;
      this.paragrafos = paragrafos || [{ texto: '' }];
      this.cabecalho = cabecalho ? new Corpo(cabecalho) : null;
    }
    get texto() { return this.paragrafos.map((p) => p.texto).join('\n'); }
    getId() { return this.id; }
    getBody() { return new Corpo(this.paragrafos); }
    getHeader() { return this.cabecalho; }
    getFooter() { return null; }
    saveAndClose() {}
  }
  const DocumentApp = {
    ParagraphHeading: { TITLE: 'TITLE', HEADING1: 'H1', HEADING2: 'H2' },
    HorizontalAlignment: { LEFT: 'L', CENTER: 'C', RIGHT: 'R', JUSTIFY: 'J' },
    create(nome) {
      const id = novoId('f');
      estado.arquivos[id] = new Arquivo(id, nome, 'application/vnd.google-apps.document', null);
      return (estado.docs[id] = new Documento(id, nome));
    },
    openById(id) { return estado.docs[id]; }
  };
  /** Cria um Google Docs simulado (ex.: modelo timbrado ou modelo com marcadores). */
  estado.criarDoc = (nome, linhas, cabecalho) => {
    const d = DocumentApp.create(nome);
    d.paragrafos = linhas.map((t) => ({ texto: t }));
    if (cabecalho) d.cabecalho = new Corpo(cabecalho.map((t) => ({ texto: t })));
    return d;
  };

  // ---------------------------------------------------------------- outros
  const tz = 'America/Fortaleza';
  const ctx = {
    console: { log() {}, warn() {}, error: (...a) => opcoes.verbose && console.error(...a) },
    SpreadsheetApp, DriveApp, DocumentApp,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in estado.props ? estado.props[k] : null),
        getProperties: () => Object.assign({}, estado.props),
        setProperty: (k, v) => { estado.props[k] = String(v); }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => estado.cache[k] || null,
        put: (k, v) => { estado.cache[k] = v; },
        getAll: (ks) => { const r = {}; ks.forEach((k) => { if (k in estado.cache) r[k] = estado.cache[k]; }); return r; },
        putAll: (m) => { Object.assign(estado.cache, m); },
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
    // Serviço avançado "Google Sheets API" (opcional no projeto real)
    Sheets: opcoes.semSheetsApi ? undefined : {
      Spreadsheets: {
        Values: {
          batchGet(id, req) {
            estado.chamadas.leituras++;
            const ss = SpreadsheetApp.openById(id);
            return {
              valueRanges: req.ranges.map((r) => {
                const sh = ss.getSheetByName(r.replace(/^'|'$/g, '').split("'!")[0]);
                const ult = sh.getLastRow();
                const values = sh.dados.slice(0, ult).map((l) => {
                  const c = (l || []).map((v) => (v === undefined ? '' : String(v)));
                  while (c.length && c[c.length - 1] === '') c.pop();
                  return c;
                });
                return { range: r, values };
              })
            };
          },
          append(body, id, range, opts) {
            estado.chamadas.escritas++;
            if (opts.valueInputOption !== 'RAW') throw new Error('esperado RAW');
            const sh = SpreadsheetApp.openById(id).getSheetByName(range.split("'!")[0].replace(/^'/, ''));
            const inicio = sh.getLastRow() + 1;
            body.values.forEach((l, i) => {
              l.forEach((v) => { if (typeof v !== 'string') throw new Error('append: valor não texto'); });
              sh.dados[inicio - 1 + i] = l.slice();
            });
            return { updates: { updatedRange: "'" + sh.nome + "'!A" + inicio + ':Z' + (inicio + body.values.length - 1) } };
          },
          batchUpdate(body, id) {
            estado.chamadas.escritas++;
            if (body.valueInputOption !== 'RAW') throw new Error('esperado RAW');
            body.data.forEach((d) => {
              Object.keys(d).forEach((k) => { if (['range', 'values'].indexOf(k) < 0) throw new Error('campo inválido na API: ' + k); });
              const m = d.range.match(/^'(.+)'!A(\d+):[A-Z]+(\d+)$/);
              const sh = SpreadsheetApp.openById(id).getSheetByName(m[1]);
              d.values.forEach((l, i) => { sh.dados[Number(m[2]) - 1 + i] = l.slice(); });
            });
            return {};
          }
        }
      }
    },
    HtmlService: {},
    ScriptApp: {}
  };
  return { ctx, estado };
}

module.exports = { criarAmbiente };
