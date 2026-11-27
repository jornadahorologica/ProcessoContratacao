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
  STATUS: { RASCUNHO: 'RASCUNHO', EM_ASSINATURA: 'EM_ASSINATURA', FINAL: 'FINAL' },

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
    ['numero', 'titulo', 'objeto', 'numeroSuite', 'setorDemandante', 'responsavelEmail', 'responsavelTecnico'].forEach(function (k) {
      dados[k] = proc[k] || '';
    });
    dados.valorEstimado = proc.valorEstimado !== null && proc.valorEstimado !== undefined
      ? Number(proc.valorEstimado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
    dados.dataAtual = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
    var vars = Variaveis.mapa(proc.id);
    Object.keys(vars).forEach(function (k) { if (k.indexOf('checklist.') !== 0) dados[k] = vars[k]; });
    // Campos formatados para documento ("Não se aplica", moeda, Sim/Não)
    (ConfigService.carregar().cfg_Campos || []).forEach(function (c) {
      if (c.fluxoId === proc.fluxoId && vars.hasOwnProperty(c.chave)) dados[c.chave] = Campos.textoDocumento(c, vars);
    });
    return dados;
  },

  /**
   * Gera o documento do tipo informado:
   *  - com modelo (cfg_DocumentosTipo.modeloId): copia o modelo e troca os marcadores {{campo}};
   *  - sem modelo: monta a estrutura a partir dos campos das etapas que produzem esse tipo
   *    (ex.: os 13 incisos do ETP), sobre o timbre de APP.MODELO_TIMBRADO_ID (se houver),
   *    e acrescenta o bloco de assinaturas configurado em cfg_Assinaturas.
   */
  gerar: function (processoId, tipoCodigo, tarefaId) {
    var proc = repo('Processos').obterOuFalhar(processoId);
    var tipo = this._tipoValido(tipoCodigo);
    var pasta = DriveService.pastaDoTipo(proc, tipoCodigo);
    var versao = this._proximaVersao(proc.id, tipoCodigo);
    var nome = tipo.nome + ' - ' + proc.numero + (versao > 1 ? ' (v' + versao + ')' : '');
    var dados = this.dadosSubstituicao(proc);
    var doc;

    if (tipo.modeloId) {
      doc = DocumentApp.openById(DriveApp.getFileById(tipo.modeloId).makeCopy(nome, pasta).getId());
      this._substituirMarcadores(doc, dados);
    } else {
      if (APP.MODELO_TIMBRADO_ID) {
        doc = DocumentApp.openById(DriveApp.getFileById(APP.MODELO_TIMBRADO_ID).makeCopy(nome, pasta).getId());
        doc.getBody().clear(); // mantém cabeçalho e rodapé (timbre)
      } else {
        doc = DocumentApp.create(nome);
        DriveService.mover(doc.getId(), pasta);
      }
      this._escreverEstrutura(doc.getBody(), proc, tipo);
    }
    var fileId = doc.getId();
    doc.saveAndClose();
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

  /** Estrutura padrão: título, identificação, seções (campos secaoLei), dados complementares e assinaturas. */
  _escreverEstrutura: function (corpo, proc, tipo) {
    var H = DocumentApp.ParagraphHeading;
    var vars = Variaveis.mapa(proc.id);
    var primeiro = corpo.getNumChildren && corpo.getNumChildren() === 1 && corpo.getChild(0).asParagraph
      ? corpo.getChild(0).asParagraph() : null;
    var titulo = primeiro && primeiro.getText() === '' ? primeiro.setText(tipo.nome.toUpperCase()) : corpo.appendParagraph(tipo.nome.toUpperCase());
    titulo.setHeading(H.HEADING1).setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    corpo.appendParagraph('Processo: ' + proc.numero + (proc.numeroSuite ? ' — SUITE nº ' + proc.numeroSuite : ''));
    corpo.appendParagraph('Objeto: ' + (proc.objeto || ''));

    var campos = this.camposDoDocumento(proc, tipo.codigo, vars);
    var secoes = campos.filter(function (c) { return c.tipo === 'secaoLei'; });
    var chavesSecoes = secoes.map(function (c) { return c.chave; });
    var outros = campos.filter(function (c) { return c.tipo !== 'secaoLei' && c.tipo !== 'tabela' && chavesSecoes.indexOf(c.secao) < 0; });
    var self = this;

    // Seções e tabelas na ordem configurada; os demais campos vão para "Informações complementares"
    campos.filter(function (c) { return c.tipo === 'secaoLei' || (c.tipo === 'tabela' && chavesSecoes.indexOf(c.secao) < 0); }).forEach(function (c) {
      corpo.appendParagraph(c.rotulo).setHeading(H.HEADING2);
      if (c.tipo === 'tabela') { self._escreverTabela(corpo, c, vars); return; }
      Campos.textoDocumento(c, vars).split(/\r?\n/).forEach(function (linha) {
        corpo.appendParagraph(linha).setAlignment(DocumentApp.HorizontalAlignment.JUSTIFY);
      });
      // Campos complementares desta seção (ex.: valor estimado, registro no PCA)
      campos.filter(function (x) { return x.secao === c.chave && !Utils.vazio(vars[x.chave]); }).forEach(function (x) {
        if (x.tipo === 'tabela') { self._escreverTabela(corpo, x, vars); return; }
        var p = corpo.appendParagraph(x.rotulo.replace(/\s*\*$/, '') + ': ' + Campos.textoDocumento(x, vars));
        p.editAsText().setBold(0, x.rotulo.length, true);
      });
    });

    var linhas = outros.filter(function (c) { return !Utils.vazio(vars[c.chave]); })
      .map(function (c) { return [c.rotulo, Campos.textoDocumento(c, vars)]; });
    if (linhas.length) {
      corpo.appendParagraph(secoes.length ? 'Informações complementares' : 'Dados').setHeading(H.HEADING2);
      corpo.appendTable(linhas);
    } else if (!secoes.length) {
      corpo.appendParagraph('(Nenhum campo configurado para este documento. Cadastre um modelo em cfg_DocumentosTipo.)');
    }

    var assinaturas = AssinaturaService.signatarios(proc, tipo.codigo);
    if (assinaturas.length) {
      corpo.appendParagraph('');
      corpo.appendParagraph('Fortaleza, data da assinatura eletrônica.').setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      assinaturas.forEach(function (a) {
        corpo.appendParagraph('');
        corpo.appendParagraph(a.signatario).setAlignment(DocumentApp.HorizontalAlignment.CENTER).editAsText().setBold(true);
        if (a.cargo) corpo.appendParagraph(a.cargo).setAlignment(DocumentApp.HorizontalAlignment.CENTER).editAsText().setBold(false);
      });
    }
  },

  /**
   * Campos que compõem o documento: os das etapas que o produzem, na ordem,
   * sem repetir a mesma chave e só os aplicáveis (condição verdadeira).
   */
  camposDoDocumento: function (proc, tipoCodigo, vars) {
    var vistos = {};
    var campos = [];
    ConfigService.etapasDoDocumento(proc.fluxoId, tipoCodigo).forEach(function (e) {
      ConfigService.campos(proc.fluxoId, e.codigo).forEach(function (c) {
        if (vistos[c.chave] || !Campos.aplicavel(c, vars)) return;
        vistos[c.chave] = true;
        campos.push(c);
      });
    });
    return campos;
  },

  /** Campo "tabela" (ex.: riscos, dotações) como tabela do Google Docs. */
  _escreverTabela: function (corpo, campo, vars) {
    var cols = Campos.colunas(campo);
    var linhas = Campos.linhas(campo, vars[campo.chave]);
    if (!linhas.length) { corpo.appendParagraph('—'); return; }
    var dados = [cols.map(function (c) { return c.rotulo; })].concat(linhas.map(function (l) {
      return cols.map(function (c) { return l[c.chave] || ''; });
    }));
    var t = corpo.appendTable(dados);
    if (t.getRow) t.getRow(0).editAsText().setBold(true);
  },

  /**
   * Ao concluir a etapa: gera o documento que será assinado no SUITE, se ainda
   * não houver um atualizado (ou anexado/assinado). Retorna o documento gerado ou null.
   */
  gerarAoConcluir: function (proc, etapa, tarefa) {
    var tipoCodigo = etapa.documentoTipo;
    if (!tipoCodigo || ConfigService.blocos(etapa).indexOf('B') < 0 || !AssinaturaService.exige(tipoCodigo)) return null;
    var tipo = ConfigService.tipoDocumento(tipoCodigo);
    if (!tipo) return null;
    var vars = Variaveis.mapa(proc.id);
    if (!Condicao.avaliar(tipo.condicao, vars)) return null;
    var docs = repo('Documentos').filtrar(function (d) { return d.processoId === proc.id && d.tipoCodigo === tipoCodigo; });
    if (docs.some(function (d) { return d.origem !== 'GERADO' || d.status !== this.STATUS.RASCUNHO; }, this)) return null;
    var rascunho = docs.sort(function (a, b) { return a.criadoEm < b.criadoEm ? 1 : -1; })[0];
    if (rascunho && !AssinaturaService.desatualizado(rascunho, AssinaturaService.etapasDoTipo(proc, tipoCodigo))) return null;
    return tipoCodigo === 'MAPA_PRECOS'
      ? PesquisaPrecoService.gerarMapa(proc.id, vars.metodoEstimativa, tarefa.id)
      : this.gerar(proc.id, tipoCodigo, tarefa.id);
  },

  /**
   * Diagnóstico (Administração): tenta criar um Google Docs e o PDF na pasta
   * raiz, abrir os modelos configurados e o timbre. Devolve cada passo com o erro exato.
   */
  testarGeracao: function () {
    var passos = [];
    var passo = function (nome, fn) {
      try { passos.push({ passo: nome, ok: true, detalhe: fn() || '' }); }
      catch (e) { passos.push({ passo: nome, ok: false, detalhe: e.message || String(e) }); }
    };
    var docId = null;
    passo('Pasta raiz do sistema no Drive', function () { return DriveService.raiz().getName(); });
    passo('Criar um Google Docs (DocumentApp)', function () {
      var d = DocumentApp.create('Teste de geração - pode excluir');
      d.getBody().appendParagraph('Teste de geração de documento.');
      docId = d.getId();
      d.saveAndClose();
      return 'ok';
    });
    if (docId) {
      passo('Mover para a pasta raiz', function () { DriveService.mover(docId, DriveService.raiz()); return 'ok'; });
      passo('Converter em PDF', function () { return DriveApp.getFileById(docId).getAs('application/pdf').getBytes().length + ' bytes'; });
      passo('Excluir o arquivo de teste', function () { DriveApp.getFileById(docId).setTrashed(true); return 'ok'; });
    }
    if (APP.MODELO_TIMBRADO_ID) {
      passo('Abrir o timbre (APP.MODELO_TIMBRADO_ID)', function () { return DriveApp.getFileById(APP.MODELO_TIMBRADO_ID).getName(); });
    } else {
      passos.push({ passo: 'Timbre (APP.MODELO_TIMBRADO_ID)', ok: true, detalhe: 'Não configurado: os documentos saem sem cabeçalho/rodapé.' });
    }
    ConfigService.tiposDocumento().forEach(function (t) {
      if (!t.modeloId) return;
      passo('Modelo de "' + t.nome + '"', function () { return DriveApp.getFileById(t.modeloId).getName(); });
    });
    if (!ConfigService.tiposDocumento().some(function (t) { return t.modeloId; })) {
      passos.push({ passo: 'Modelos (cfg_DocumentosTipo.modeloId)', ok: true,
        detalhe: 'Nenhum modelo cadastrado: os documentos são montados a partir dos campos das etapas.' });
    }
    return passos;
  },

  /**
   * Troca {{chave}} pelos valores. Um parágrafo que contém APENAS o marcador e
   * cujo valor tem várias linhas vira vários parágrafos (mantendo o estilo).
   */
  _substituirMarcadores: function (doc, dados) {
    var partes = [doc.getBody()];
    if (doc.getHeader()) partes.push(doc.getHeader());
    if (doc.getFooter()) partes.push(doc.getFooter());
    partes.forEach(function (parte) {
      parte.getParagraphs().forEach(function (par) {
        var m = par.getText().trim().match(/^\{\{([\w.]+)\}\}$/);
        if (!m || !dados.hasOwnProperty(m[1])) return;
        var linhas = String(dados[m[1]]).split(/\r?\n/);
        if (linhas.length < 2) return;
        par.setText(linhas[0]);
        var pai = par.getParent();
        var idx = pai.getChildIndex(par);
        for (var i = 1; i < linhas.length; i++) {
          var copia = par.copy();
          copia.setText(linhas[i]);
          pai.insertParagraph(idx + i, copia);
        }
      });
    });
    var self = this;
    Object.keys(dados).forEach(function (k) {
      var padrao = '\\{\\{' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\}\\}';
      var valor = String(dados[k]).replace(/\r?\n/g, ' ');
      partes.forEach(function (p) { self._trocarLiteral(p, padrao, valor); });
    });
  },

  /** Substituição literal (replaceText interpretaria "$" no valor, ex.: "R$ 1.000,00"). */
  _trocarLiteral: function (parte, padrao, valor) {
    var r = parte.findText(padrao);
    var limite = 500;
    while (r && limite--) {
      var t = r.getElement().asText();
      var ini = r.getStartOffset();
      t.deleteText(ini, r.getEndOffsetInclusive());
      if (valor) t.insertText(ini, valor);
      r = parte.findText(padrao);
    }
  },

  /**
   * arquivo = {nome, mimeType, base64}
   * assinaturas (opcional) = {data, ordens}: para tipos assinados no SUITE, quem já
   * assinou o PDF anexado. Com todos marcados o documento fica FINAL; senão, em assinatura.
   */
  anexar: function (processoId, tipoCodigo, tarefaId, arquivo, assinaturas) {
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
    return this._registrarAssinaturasDoAnexo(reg, proc, assinaturas);
  },

  /** Registra um arquivo que já existe no Drive (link ou ID), movendo-o para a pasta do tipo. */
  vincular: function (processoId, tipoCodigo, tarefaId, linkOuId, mover, assinaturas) {
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
    return this._registrarAssinaturasDoAnexo(reg, proc, assinaturas);
  },

  _registrarAssinaturasDoAnexo: function (reg, proc, assinaturas) {
    if (!assinaturas || !AssinaturaService.exige(reg.tipoCodigo)) return reg;
    if (Utils.vazio(assinaturas.data)) throw Utils.erro('Informe a data da assinatura.');
    var marcar = (assinaturas.ordens || []).map(Number);
    AssinaturaService.signatarios(proc, reg.tipoCodigo).forEach(function (s) {
      var assinou = marcar.indexOf(Number(s.ordem)) >= 0;
      repo('Assinaturas').inserir({
        processoId: proc.id, documentoId: reg.id, tipoDocumento: reg.tipoCodigo, ordem: s.ordem,
        signatario: s.signatario, cargo: s.cargo, status: assinou ? 'ASSINADO' : 'PENDENTE',
        assinadoEm: assinou ? assinaturas.data : '', registradoPor: assinou ? Auth.email() : '', registradoEm: assinou ? Utils.agora() : ''
      });
    });
    var faltam = AssinaturaService.doDocumento(reg.id).filter(function (a) { return a.status !== 'ASSINADO'; });
    if (!faltam.length) return reg;
    Historico.registrar(proc.id, reg.tarefaId, 'DOCUMENTO_STATUS', reg.nome + ' → em assinatura (faltam: ' +
      faltam.map(function (a) { return a.signatario; }).join(', ') + ')');
    return repo('Documentos').atualizar(reg.id, { status: this.STATUS.EM_ASSINATURA, pdfFileId: reg.fileId, pdfUrl: reg.url });
  },

  alterarStatus: function (documentoId, status) {
    if (status !== 'RASCUNHO' && status !== 'FINAL') throw Utils.erro('Status inválido.');
    var atual = repo('Documentos').obterOuFalhar(documentoId);
    if (status === 'FINAL' && atual.origem === 'GERADO' && AssinaturaService.exige(atual.tipoCodigo) &&
        !AssinaturaService.todasRegistradas(atual.id)) {
      throw Utils.erro('Este documento precisa ser assinado no SUITE: use "Enviar para assinatura" e registre as assinaturas, ' +
        'ou anexe o PDF já assinado.');
    }
    var d = repo('Documentos').atualizar(documentoId, { status: status });
    Historico.registrar(d.processoId, d.tarefaId, 'DOCUMENTO_STATUS', d.nome + ' → ' + status);
    return d;
  }
};
