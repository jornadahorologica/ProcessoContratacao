/**
 * API exposta ao front-end. O cliente chama apenas apiCall(metodo, args)
 * via google.script.run; aqui ficam a lista de métodos permitidos, o nível
 * de permissão de cada um, o lock de escrita e o tratamento de erros.
 *
 * Nível: L = leitura, E = edição, G = gestão, A = administração.
 */
var API = {
  contexto: ['L', function () {
    var u = Auth.usuario();
    return {
      app: APP.NOME, versao: APP.VERSAO, usuario: u,
      fluxos: ConfigService.fluxos().map(function (f) { return { id: f.id, nome: f.nome }; }),
      fases: ConfigService.fases(),
      tiposDocumento: ConfigService.tiposDocumento().map(function (t) { return { codigo: t.codigo, nome: t.nome }; }),
      usuarios: ConfigService.usuarios().filter(function (x) { return x.ativo; })
        .map(function (x) { return { email: x.email, nome: x.nome, setor: x.setor }; }),
      metodosMapa: PesquisaPrecoService.METODOS,
      responsavelTecnicoPadrao: APP.RESPONSAVEL_TECNICO_PADRAO,
      configuracao: u.papel === PAPEIS.ADMIN ? Migracoes.situacao() : null,
      assinaturasPorTipo: (ConfigService.carregar().cfg_Assinaturas || []).reduce(function (m, a) {
        (m[a.tipoDocumento] = m[a.tipoDocumento] || []).push({ ordem: a.ordem, signatario: a.signatario, cargo: a.cargo });
        return m;
      }, {}),
      dbUrl: u.papel === PAPEIS.ADMIN ? Db.planilha().getUrl() : '',
      pastaRaizUrl: u.papel === PAPEIS.ADMIN ? DriveService.raiz().getUrl() : '',
      sistemasExternos: Object.keys(APP.SISTEMAS_EXTERNOS).map(function (k) {
        var s = APP.SISTEMAS_EXTERNOS[k];
        return { nome: s.nome, url: s.url, etapas: s.etapas, logo: DriveService.imagemDataUri(s.logoFileId) };
      })
    };
  }],

  painel: ['L', function () { return ProcessoService.painel(); }],
  listarProcessos: ['L', function (filtro) { return ProcessoService.listar(filtro); }],
  detalharProcesso: ['L', function (id) { return ProcessoService.detalhar(id); }],
  criarProcesso: ['E', function (dados) { return ProcessoService.criar(dados); }],
  atualizarProcesso: ['E', function (id, dados) { return ProcessoService.atualizar(id, dados); }],
  alterarStatusProcesso: ['G', function (id, status, motivo) { return ProcessoService.alterarStatus(id, status, motivo); }],

  abrirTarefa: ['L', function (id) { return ProcessoService.abrirTarefa(id); }],
  salvarCampos: ['E', function (id, valores) { return ProcessoService.salvarCampos(id, valores); }],
  marcarChecklist: ['E', function (id, itemId, marcado) { return ProcessoService.marcarChecklist(id, itemId, marcado); }],
  registrarEnvio: ['E', function (id, ref, data) { Workflow.registrarEnvio(id, ref, data); return true; }],
  registrarRetorno: ['E', function (id, ref, data) { Workflow.registrarRetorno(id, ref, data); return true; }],
  concluirTarefa: ['E', function (id, obs) { Workflow.concluir(id, obs); return true; }],
  devolverTarefa: ['E', function (id, destino, motivo) { Workflow.devolver(id, destino, motivo); return true; }],
  atribuirTarefa: ['E', function (id, email) { Workflow.atribuir(id, email); return true; }],

  gerarDocumento: ['E', function (processoId, tipo, tarefaId) { return DocumentoService.gerar(processoId, tipo, tarefaId); }],
  anexarDocumento: ['E', function (processoId, tipo, tarefaId, arquivo) { return DocumentoService.anexar(processoId, tipo, tarefaId, arquivo); }],
  vincularDocumento: ['E', function (processoId, tipo, tarefaId, link, mover) { return DocumentoService.vincular(processoId, tipo, tarefaId, link, mover); }],
  alterarStatusDocumento: ['E', function (id, status) { return DocumentoService.alterarStatus(id, status); }],
  enviarParaAssinatura: ['E', function (documentoId) { return AssinaturaService.enviar(documentoId); }],
  registrarAssinatura: ['E', function (assinaturaId, data) { return AssinaturaService.registrar(assinaturaId, data); }],

  salvarCotacao: ['E', function (processoId, c) { return PesquisaPrecoService.salvar(processoId, c); }],
  removerCotacao: ['E', function (id) { PesquisaPrecoService.remover(id); return true; }],
  calcularMapa: ['L', function (processoId, metodo) { return PesquisaPrecoService.calcularMapa(processoId, metodo); }],
  gerarMapa: ['E', function (processoId, metodo, tarefaId) { return PesquisaPrecoService.gerarMapa(processoId, metodo, tarefaId); }],

  registrarDiligencia: ['E', function (processoId, d) { return DiligenciaService.registrar(processoId, d); }],
  responderDiligencia: ['E', function (id, resposta, documentoId) { return DiligenciaService.responder(id, resposta, documentoId); }],

  listarUsuarios: ['A', function () { return repo('cfg_Usuarios').todos(); }],
  salvarUsuario: ['A', function (u) {
    var email = String(u.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw Utils.erro('E-mail inválido.');
    if (!PAPEIS[u.papel]) throw Utils.erro('Papel inválido.');
    var dados = { nome: u.nome || '', setor: u.setor || '', papel: u.papel, ativo: u.ativo !== false };
    var r = repo('cfg_Usuarios');
    var reg = r.obter(email) ? r.atualizar(email, dados) : r.inserir(Object.assign({ email: email }, dados));
    ConfigService.limparCache();
    return reg;
  }],
  recarregarConfig: ['A', function () { ConfigService.limparCache(); return true; }],
  situacaoConfiguracao: ['A', function () { return Migracoes.situacao(); }],
  atualizarConfiguracao: ['A', function () { return atualizarConfiguracao_(); }]
};

var NIVEIS_ESCRITA = { E: true, G: true, A: true };

/**
 * Ponto de entrada único do front-end. Retorna JSON (string) no formato
 * {ok: true, data} ou {ok: false, erro}.
 */
function apiCall(metodo, args) {
  try {
    var def = API[metodo];
    if (!def) throw Utils.erro('Operação inválida: ' + metodo);
    var nivel = def[0];
    if (nivel === 'L') Auth.exigirLeitura();
    else if (nivel === 'E') Auth.exigirEdicao();
    else if (nivel === 'G') Auth.exigirGestao();
    else if (nivel === 'A') Auth.exigirAdmin();
    var exec = function () { return def[1].apply(null, args || []); };
    var dados = NIVEIS_ESCRITA[nivel] ? Utils.comLock(exec) : exec();
    return JSON.stringify({ ok: true, data: dados === undefined ? null : dados });
  } catch (e) {
    if (!e.negocio) console.error('apiCall(' + metodo + '): ' + (e.stack || e));
    return JSON.stringify({ ok: false, erro: e.message || String(e) });
  }
}
