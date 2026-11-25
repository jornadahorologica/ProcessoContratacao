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

    var campos = [];
    ConfigService.etapasDoDocumento(proc.fluxoId, tipo.codigo).forEach(function (e) {
      campos = campos.concat(ConfigService.campos(proc.fluxoId, e.codigo));
    });
    var secoes = campos.filter(function (c) { return c.tipo === 'secaoLei'; });
    var chavesSecoes = secoes.map(function (c) { return c.chave; });
    var outros = campos.filter(function (c) { return c.tipo !== 'secaoLei' && chavesSecoes.indexOf(c.secao) < 0; });

    secoes.forEach(function (c) {
      corpo.appendParagraph(c.rotulo).setHeading(H.HEADING2);
      Campos.textoDocumento(c, vars).split(/\r?\n/).forEach(function (linha) {
        corpo.appendParagraph(linha).setAlignment(DocumentApp.HorizontalAlignment.JUSTIFY);
      });
      // Campos complementares desta seção (ex.: valor estimado, registro no PCA)
      campos.filter(function (x) { return x.secao === c.chave && !Utils.vazio(vars[x.chave]); }).forEach(function (x) {
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
