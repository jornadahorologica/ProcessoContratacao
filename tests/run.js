/**
 * Testes de ponta a ponta do back-end com os serviços do Google simulados.
 * Uso: npm test
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { criarAmbiente } = require('./gas-mock');

const SRC = path.join(__dirname, '..', 'src');

let MODO = {};
function carregar(opcoes) {
  const { ctx, estado } = criarAmbiente(Object.assign({}, MODO, opcoes));
  vm.createContext(ctx);
  const arquivos = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
  arquivos.forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f }));
  // Simula o início de uma nova execução do Apps Script (memória por execução zerada)
  const novaExecucao = () => vm.runInContext(
    'Db.gravar(); _repos = {}; ConfigService._memo = null; Auth._usuario = null; Db._ss = null; Db._sheets = {}; Db._id = null; Utils._props = null; Workflow._cacheAlc = null;', ctx);
  const chamar = (metodo, ...args) => {
    novaExecucao();
    return JSON.parse(ctx.apiCall(metodo, args));
  };
  const ok = (metodo, ...args) => {
    const r = chamar(metodo, ...args);
    if (!r.ok) throw new Error(metodo + ' falhou: ' + r.erro);
    return r.data;
  };
  const falha = (metodo, ...args) => {
    const r = chamar(metodo, ...args);
    assert.strictEqual(r.ok, false, metodo + ' deveria falhar');
    return r.erro;
  };
  return { ctx, estado, ok, falha, novaExecucao, comoUsuario: (e) => { estado.usuarioAtivo = e; } };
}

const testes = [];
const teste = (nome, fn) => testes.push({ nome, fn });

// ------------------------------------------------------------------ utilitários do fluxo
function tarefaAberta(env, procId, etapa) {
  const det = env.ok('detalharProcesso', procId);
  const t = det.tarefas.find((x) => x.etapaCodigo === etapa && (x.status === 'ABERTA' || x.status === 'AGUARDANDO_RETORNO'));
  assert.ok(t, 'esperava tarefa ativa em ' + etapa + '; ativas: ' +
    det.tarefas.filter((x) => ['ABERTA', 'AGUARDANDO_RETORNO', 'AGUARDANDO'].includes(x.status)).map((x) => x.etapaCodigo + ':' + x.status).join(', '));
  return t;
}
function ativas(env, procId) {
  return env.ok('detalharProcesso', procId).tarefas
    .filter((x) => x.status === 'ABERTA' || x.status === 'AGUARDANDO_RETORNO').map((x) => x.etapaCodigo).sort();
}
const arquivo = (nome) => ({ nome, mimeType: 'application/pdf', base64: Buffer.from('conteudo ' + nome).toString('base64') });

function concluirSimples(env, procId, etapa, campos, opcoes) {
  opcoes = opcoes || {};
  const t = tarefaAberta(env, procId, etapa);
  const w = env.ok('abrirTarefa', t.id);
  if (campos) env.ok('salvarCampos', t.id, campos);
  w.checklist.filter((i) => i.obrigatorio).forEach((i) => env.ok('marcarChecklist', t.id, i.id, true));
  if (w.blocos.includes('D')) {
    env.ok('registrarEnvio', t.id, 'Ofício 1', '2026-11-10');
    env.ok('registrarRetorno', t.id, 'Resposta 1', '2026-11-12');
  }
  if (w.etapa.documentoTipo && w.blocos.includes('B')) {
    if (opcoes.gerar) assinarTudo(env, env.ok('gerarDocumento', procId, w.etapa.documentoTipo, t.id));
    else env.ok('anexarDocumento', procId, w.etapa.documentoTipo, t.id, arquivo(etapa + '.pdf'));
  }
  env.ok('concluirTarefa', t.id, '');
  return t;
}

/** Se o tipo exige assinatura: envia para assinatura e registra todas (simula o SUITE). */
function assinarTudo(env, doc) {
  const exigidas = env.ok('contexto').assinaturasPorTipo[doc.tipoCodigo] || [];
  if (!exigidas.length) return doc;
  env.ok('enviarParaAssinatura', doc.id);
  env.ok('detalharProcesso', doc.processoId).assinaturas.filter((a) => a.documentoId === doc.id)
    .forEach((a) => env.ok('registrarAssinatura', a.id, '2026-11-13'));
  return doc;
}

/** Os 13 incisos do ETP preenchidos (XII marcado como "Não se aplica"). */
function camposEtp(extra) {
  return Object.assign({
    etpNecessidade: 'Necessidade', etpPrevisaoPca: 'Item 12 do PCA 2026', registradoPCA: 'SIM', itemPCA: '12',
    etpRequisitos: 'Requisitos', etpQuantidades: '1.000 UST', etpLevantamentoMercado: 'Mercado',
    contratadaEtice: 'NAO', valorEstimadoEtp: '1500', etpEstimativaValor: 'Média das propostas',
    etpSolucao: 'Solução', etpParcelamento: 'Não parcelada', etpResultados: 'Resultados', etpProvidencias: 'Nenhuma',
    etpCorrelatas: 'Nenhuma', etpImpactosAmbientais: 'Serviço de TI sem impacto ambiental relevante',
    etpImpactosAmbientais_nsa: true, etpPosicionamento: 'Contratação adequada'
  }, extra || {});
}

/** Leva um processo novo até a abertura das tarefas paralelas. */
function ateParalelo(env, titulo) {
  const p = env.ok('criarProcesso', { titulo, objeto: 'Serviços de TI' });
  concluirSimples(env, p.id, 'ABRIR_SUITE', { numeroSuite: '123/2026', dataAberturaSuite: '2026-11-10' });
  concluirSimples(env, p.id, 'DFD', { unidadeDemandante: 'CESOP', descricaoNecessidade: 'x', grauPrioridade: 'Alta', quantidadeDFD: 1, unidadeMedidaDFD: 'Serviço' }, { gerar: true });
  concluirSimples(env, p.id, 'CONSULTA_ETICE', { resultadoConsultaEtice: 'Favorável' });
  concluirSimples(env, p.id, 'ETP', camposEtp(), { gerar: true });
  return p;
}

// ------------------------------------------------------------------ testes
teste('Condicao: avaliador de expressões', () => {
  const { ctx } = carregar();
  const C = ctx.Condicao;
  assert.strictEqual(C.avaliar('', {}), true);
  assert.strictEqual(C.avaliar('a == SIM', { a: 'sim' }), true);
  assert.strictEqual(C.avaliar('a != SIM', { a: 'SIM' }), false);
  assert.strictEqual(C.avaliar('a == SIM && b == NAO', { a: 'SIM', b: 'NAO' }), true);
  assert.strictEqual(C.avaliar('a == SIM && b == NAO', { a: 'SIM', b: 'SIM' }), false);
  assert.strictEqual(C.avaliar('a == X || a == Y', { a: 'Y' }), true);
  assert.strictEqual(C.avaliar('a == "SIM"', { a: 'SIM' }), true);
  assert.throws(() => C.avaliar('a SIM', {}));
});

teste('Setup cria abas, carrega configuração e administrador; é idempotente', () => {
  const env = carregar();
  env.ctx.setup();
  const ss = Object.values(env.estado.planilhas)[0];
  Object.keys(env.ctx.SCHEMA).forEach((n) => assert.ok(ss.getSheetByName(n), 'aba ' + n));
  assert.ok(!ss.getSheetByName('Sheet1'));
  assert.strictEqual(ss.getSheetByName('cfg_Etapas').getLastRow() - 1, env.ctx.Seed.etapas().length + 1, 'carga inicial + ENVIO_CECOC (migração 5)');
  const linhasAntes = ss.getSheetByName('cfg_Transicoes').getLastRow();
  env.novaExecucao();
  env.ctx.setup();
  assert.strictEqual(ss.getSheetByName('cfg_Transicoes').getLastRow(), linhasAntes, 'setup não deve duplicar');
  const ctxApi = env.ok('contexto');
  assert.strictEqual(ctxApi.usuario.papel, 'ADMIN');
});

teste('Configuração do fluxo é consistente (transições, etapas, documentos)', () => {
  const env = carregar();
  env.ctx.setup();
  env.novaExecucao();
  const S = env.ctx.Seed;
  const codigos = new Set(S.etapas().map((e) => e.codigo));
  S.transicoes().forEach((t) => {
    assert.ok(codigos.has(t.origem), 'origem ' + t.origem);
    assert.ok(codigos.has(t.destino), 'destino ' + t.destino);
  });
  const tipos = new Set(S.tiposDocumento().map((t) => t.codigo));
  S.etapas().filter((e) => e.documentoTipo).forEach((e) => assert.ok(tipos.has(e.documentoTipo), 'tipo ' + e.documentoTipo));
  S.campos().forEach((c) => assert.ok(codigos.has(c.etapaCodigo), 'campo ' + c.chave));
  const pastas = new Set(S.pastas().map((p) => p.nome));
  S.tiposDocumento().filter((t) => t.pasta).forEach((t) => assert.ok(pastas.has(t.pasta), 'pasta ' + t.pasta));
  // Toda etapa (exceto FIM) tem saída e toda etapa (exceto a inicial) tem entrada
  S.etapas().forEach((e) => {
    if (e.tipo !== 'FIM') assert.ok(S.transicoes().some((t) => t.origem === e.codigo), 'sem saída: ' + e.codigo);
    if (e.codigo !== 'ABRIR_SUITE') assert.ok(S.transicoes().some((t) => t.destino === e.codigo), 'sem entrada: ' + e.codigo);
  });
});

teste('Autorização: usuário não cadastrado e perfil de consulta', () => {
  const env = carregar();
  env.ctx.setup();
  env.ok('salvarUsuario', { email: 'leitor@orgao.gov.br', nome: 'Leitor', papel: 'CONSULTA' });
  env.comoUsuario('estranho@gmail.com');
  assert.match(env.falha('painel'), /não autorizado/);
  env.comoUsuario('leitor@orgao.gov.br');
  env.ok('painel');
  assert.match(env.falha('criarProcesso', { titulo: 'x', objeto: 'y' }), /permissão/);
  assert.match(env.falha('listarUsuarios'), /permissão/);
  assert.match(env.falha('metodoInexistente'), /inválida/);
});

teste('Criação do processo: número, pastas no Drive e primeira etapa', () => {
  const env = carregar();
  env.ctx.setup();
  const p1 = env.ok('criarProcesso', { titulo: 'Novo contrato SGS', objeto: 'Sustentação do SGS', numeroSuite: '' });
  const p2 = env.ok('criarProcesso', { titulo: 'Outro', objeto: 'Outro objeto' });
  const ano = new Date().getFullYear();
  assert.strictEqual(p1.numero, 'CESOP-' + ano + '-001');
  assert.strictEqual(p1.responsavelTecnico, 'Daniel Boyadijan', 'responsável técnico padrão');
  assert.strictEqual(env.ok('detalharProcesso', p1.numero).processo.id, p1.id, 'busca pelo número (URL)');
  assert.strictEqual(env.ok('detalharProcesso', p1.numero.toLowerCase()).processo.id, p1.id);
  assert.match(env.falha('detalharProcesso', 'CESOP-1900-999'), /não encontrado/);
  const p3 = env.ok('criarProcesso', { titulo: 'T', objeto: 'O', responsavelTecnico: 'Outra Pessoa' });
  assert.strictEqual(p3.responsavelTecnico, 'Outra Pessoa');
  assert.strictEqual(env.ok('atualizarProcesso', p3.id, { responsavelTecnico: 'Fulano' }).responsavelTecnico, 'Fulano');
  assert.strictEqual(p2.numero, 'CESOP-' + ano + '-002');
  const pasta = env.estado.pastas[p1.pastaId];
  assert.ok(pasta.nome.startsWith(p1.numero));
  assert.strictEqual(pasta.filhas().length, env.ctx.Seed.pastas().length);
  assert.deepStrictEqual(ativas(env, p1.id), ['ABRIR_SUITE']);
  assert.strictEqual(env.ok('detalharProcesso', p1.id).processo.fase, 'ABERTURA');
  assert.match(env.falha('criarProcesso', { titulo: '', objeto: 'x' }), /título/);
});

teste('Pendências impedem concluir; campos e checklist liberam', () => {
  const env = carregar();
  env.ctx.setup();
  const p = env.ok('criarProcesso', { titulo: 'T', objeto: 'O' });
  const t = tarefaAberta(env, p.id, 'ABRIR_SUITE');
  assert.match(env.falha('concluirTarefa', t.id, ''), /Número do processo SUITE/);
  env.ok('salvarCampos', t.id, { numeroSuite: '999/2026', dataAberturaSuite: '2026-11-10', campoNaoPermitido: 'x' });
  const w = env.ok('abrirTarefa', t.id);
  assert.deepStrictEqual(w.pendencias, []);
  assert.strictEqual(w.valores.campoNaoPermitido, undefined, 'campos fora da etapa são ignorados');
  env.ok('concluirTarefa', t.id, 'ok');
  assert.strictEqual(env.ok('detalharProcesso', p.id).processo.numeroSuite, '999/2026');

  const dfd = tarefaAberta(env, p.id, 'DFD');
  env.ok('salvarCampos', dfd.id, { unidadeDemandante: 'CESOP', descricaoNecessidade: 'x', grauPrioridade: 'Alta' });
  const pend = env.ok('abrirTarefa', dfd.id).pendencias.join(' | ');
  assert.match(pend, /Documento assinado pelo Secretário da unidade demandante/);
  assert.match(pend, /Preencha o campo "Quantidade"/);
  assert.match(pend, /Preencha o campo "Unidade de medição"/);
  const w2 = env.ok('abrirTarefa', dfd.id);
  assert.strictEqual(w2.checklist.length, 1, 'checklist do DFD com um único item');
  assert.ok(!w2.campos.some((c) => c.chave === 'quantidadeEstimadaDFD'));
  assert.ok(w2.campos.find((c) => c.chave === 'unidadeMedidaDFD').opcoes.includes('UST'));
  assert.match(env.falha('salvarCampos', dfd.id, { quantidadeDFD: '10,5' }), /números inteiros/);
  assert.match(env.falha('salvarCampos', dfd.id, { quantidadeDFD: '-3' }), /números inteiros/);
  env.ok('salvarCampos', dfd.id, { quantidadeDFD: '12.000', unidadeMedidaDFD: 'Hora técnica' });
  assert.strictEqual(env.ok('detalharProcesso', p.id).variaveis.quantidadeDFD, '12000');
  assert.match(pend, /DFD - Documento/);
});

teste('Solicitação externa (consulta ETICE): envio → aguardando retorno → retorno', () => {
  const env = carregar();
  env.ctx.setup();
  const p = env.ok('criarProcesso', { titulo: 'T', objeto: 'O' });
  concluirSimples(env, p.id, 'ABRIR_SUITE', { numeroSuite: '1', dataAberturaSuite: '2026-11-10' });
  concluirSimples(env, p.id, 'DFD', { unidadeDemandante: 'CESOP', descricaoNecessidade: 'x', grauPrioridade: 'Alta', quantidadeDFD: 1, unidadeMedidaDFD: 'Serviço' });
  const t = tarefaAberta(env, p.id, 'CONSULTA_ETICE');
  env.ok('salvarCampos', t.id, { resultadoConsultaEtice: 'Favorável' });
  const docEtice = env.ok('gerarDocumento', p.id, 'CONSULTA_ETICE', t.id);
  assert.match(env.ok('abrirTarefa', t.id).pendencias.join(), /assinado no SUITE/);
  assinarTudo(env, docEtice);
  assert.match(env.ok('abrirTarefa', t.id).pendencias.join(), /envio e o retorno/);
  env.ok('registrarEnvio', t.id, 'Ofício 10/2026', '2026-11-01');
  assert.strictEqual(env.ok('painel').indicadores.aguardandoRetorno, 1);
  assert.match(env.falha('concluirTarefa', t.id, ''), /retorno/);
  env.ok('registrarRetorno', t.id, 'Parecer ETICE', '2026-11-05');
  env.ok('concluirTarefa', t.id, '');
  assert.deepStrictEqual(ativas(env, p.id), ['ETP']);
});

teste('Paralelo + decisão NÃO + junção + devolução + instrução + fim (BID = SIM)', () => {
  const env = carregar();
  env.ctx.setup();
  const p = ateParalelo(env, 'Fluxo completo');
  assert.deepStrictEqual(ativas(env, p.id), ['COD_ITEM', 'NATUREZA', 'PESQUISA_PRECO']);
  // Próximas etapas exibidas no pop-up de conclusão
  const natW = env.ok('abrirTarefa', tarefaAberta(env, p.id, 'NATUREZA').id);
  assert.deepStrictEqual(natW.proximas, [], 'decisão ainda não registrada');
  const ppW = env.ok('abrirTarefa', tarefaAberta(env, p.id, 'PESQUISA_PRECO').id);
  assert.deepStrictEqual(ppW.proximas.map((x) => x.nome), ['Elaborar Mapa Comparativo']);
  const ciW = env.ok('abrirTarefa', tarefaAberta(env, p.id, 'COD_ITEM').id);
  assert.ok(ciW.proximas[0].automatica, 'junção: continua após as paralelas');

  // Natureza contínua = NÃO -> vai direto para a junção, que fica aguardando
  const nat = tarefaAberta(env, p.id, 'NATUREZA');
  assert.match(env.falha('concluirTarefa', nat.id, ''), /decisão/);
  env.ok('salvarCampos', nat.id, { naturezaContinua: 'NAO' });
  env.ok('concluirTarefa', nat.id, '');
  let det = env.ok('detalharProcesso', p.id);
  assert.ok(det.tarefas.some((t) => t.etapaCodigo === 'JUNCAO_1' && t.status === 'AGUARDANDO'));
  assert.ok(!det.tarefas.some((t) => t.etapaCodigo === 'JUSTIFICATIVA'));

  concluirSimples(env, p.id, 'COD_ITEM', { codigoItem: '12345', catalogoItem: 'SEPLAG' });
  assert.deepStrictEqual(ativas(env, p.id), ['PESQUISA_PRECO']);

  // Pesquisa de preços
  const pp = tarefaAberta(env, p.id, 'PESQUISA_PRECO');
  assert.match(env.ok('abrirTarefa', pp.id).pendencias.join(), /cotação/);
  [['Fornecedor A', 100], ['Fornecedor B', '110,00'], ['Fornecedor C', 200]].forEach(([f, v]) =>
    env.ok('salvarCotacao', p.id, { item: 'UST', unidade: 'UST', quantidade: 1000, fornecedor: f, valorUnitario: v, fonte: 'Marketplace' }));
  env.ok('anexarDocumento', p.id, 'ORCAMENTO', pp.id, arquivo('cotacoes.pdf'));
  env.ok('concluirTarefa', pp.id, '');

  // Mapa comparativo
  const mapa = env.ok('calcularMapa', p.id, 'MEDIANA');
  assert.strictEqual(mapa.itens.length, 1);
  assert.strictEqual(mapa.itens[0].mediana, 110);
  assert.strictEqual(mapa.itens[0].menor, 100);
  assert.strictEqual(mapa.total, 110000);
  assert.deepStrictEqual(mapa.itens[0].cotacoes.filter((c) => c.destoante).map((c) => c.fornecedor), ['Fornecedor C']);
  assert.strictEqual(env.ok('calcularMapa', p.id, 'MENOR').total, 100000);
  const mt = tarefaAberta(env, p.id, 'MAPA_PRECOS');
  assinarTudo(env, env.ok('gerarMapa', p.id, 'MEDIANA', mt.id));
  assert.strictEqual(env.ok('detalharProcesso', p.id).processo.valorEstimado, 110000);
  env.ok('concluirTarefa', mt.id, '');

  // Devolução: MODALIDADE -> MAPA_PRECOS (NATUREZA/COD_ITEM não são destinos válidos)
  const mod = tarefaAberta(env, p.id, 'MODALIDADE');
  const destinos = env.ok('abrirTarefa', mod.id).destinosDevolucao.map((d) => d.codigo);
  assert.ok(destinos.includes('MAPA_PRECOS') && destinos.includes('ETP'));
  assert.ok(!destinos.includes('NATUREZA') && !destinos.includes('COD_ITEM'));
  assert.match(env.falha('devolverTarefa', mod.id, 'MAPA_PRECOS', ''), /motivo/);
  assert.match(env.falha('devolverTarefa', mod.id, 'COD_ITEM', 'x'), /inválido/);
  env.ok('devolverTarefa', mod.id, 'MAPA_PRECOS', 'Rever método');
  assert.deepStrictEqual(ativas(env, p.id), ['MAPA_PRECOS']);
  concluirSimples(env, p.id, 'MAPA_PRECOS');
  concluirSimples(env, p.id, 'MODALIDADE', { modalidadePesquisa: 'Combinação de parâmetros' });

  // A junção dispara e abre o TR
  det = env.ok('detalharProcesso', p.id);
  assert.deepStrictEqual(ativas(env, p.id), ['TR']);
  assert.ok(det.tarefas.some((t) => t.etapaCodigo === 'JUNCAO_1' && t.status === 'CONCLUIDA'));
  assert.strictEqual(det.processo.fase, 'ESPECIFICACAO');

  concluirSimples(env, p.id, 'TR', { especificacaoTecnica: 'x', vigenciaMeses: 12 }, { gerar: true });
  concluirSimples(env, p.id, 'DOTACAO', { programa: '412', valorDotacao: '110.000,00' });
  assert.strictEqual(env.ok('detalharProcesso', p.id).variaveis.valorDotacao, '110000');
  const bid = tarefaAberta(env, p.id, 'BID');
  env.ok('salvarCampos', bid.id, { bid: 'SIM' });
  env.ok('concluirTarefa', bid.id, '');
  concluirSimples(env, p.id, 'BID_TRAMITE');
  concluirSimples(env, p.id, 'PRE_RESERVA', { numeroPreReserva: 'PR-1' });

  // Instrução: documentos assinados (FINAL); não objeção BID exigida; ETICE e Justificativa não
  const ins = tarefaAberta(env, p.id, 'INSTRUCAO');
  let w = env.ok('abrirTarefa', ins.id);
  const faltando = w.instrucao.filter((i) => i.exigido && !i.ok).map((i) => i.codigo).sort();
  assert.deepStrictEqual(faltando, []);
  assert.ok(!w.instrucao.find((i) => i.codigo === 'JUSTIFICATIVA').exigido, 'Justificativa não exigida (NÃO contínua)');
  assert.ok(!w.instrucao.find((i) => i.codigo === 'ETICE_CND').exigido, 'docs ETICE não exigidos');
  assert.ok(!w.instrucao.find((i) => i.codigo === 'JUSTIFICATIVA_DIRETA').exigido, 'contratação direta não exigida');
  assert.ok(w.instrucao.find((i) => i.codigo === 'BID_NAO_OBJECAO').exigido);
  // Mapa gerado (RASCUNHO) não pode virar FINAL sem as assinaturas
  const mapaRascunho = env.ok('gerarMapa', p.id, 'MEDIA', '');
  assert.match(env.falha('alterarStatusDocumento', mapaRascunho.id, 'FINAL'), /assinado no SUITE/);
  env.ok('marcarChecklist', ins.id, w.checklist[0].id, true);
  w = env.ok('abrirTarefa', ins.id);
  assert.deepStrictEqual(w.pendencias, []);
  env.ok('concluirTarefa', ins.id, '');

  // Pregão (não é contratação direta): após a CECOC vêm a análise da proposta e o parecer
  const cecoc = env.ok('abrirTarefa', tarefaAberta(env, p.id, 'ENVIO_CECOC').id);
  assert.deepStrictEqual(cecoc.proximas.map((x) => x.nome), ['Analisar proposta técnica e financeira']);
  concluirSimples(env, p.id, 'ENVIO_CECOC');
  concluirSimples(env, p.id, 'ANALISE_PROPOSTA', { resultadoAnalise: 'Aprovada' });
  concluirSimples(env, p.id, 'PARECER', { conclusaoParecer: 'Favorável' }, { gerar: true });
  det = env.ok('detalharProcesso', p.id);
  assert.strictEqual(det.processo.status, 'CONCLUIDO');
  assert.strictEqual(det.processo.fase, 'CONCLUIDO');
  assert.deepStrictEqual(ativas(env, p.id), []);
  assert.strictEqual(det.historico, undefined, 'histórico é carregado sob demanda');
  const hist = env.ok('historicoProcesso', p.numero);
  assert.ok(hist.some((h) => h.acao === 'ETAPA_DEVOLVIDA'));
  assert.ok(hist.some((h) => h.acao === 'PROCESSO_CONCLUIDO'));
});

teste('Tela única: operação devolve o processo e a etapa atualizados na mesma chamada', () => {
  const env = carregar();
  env.ctx.setup();
  const p = env.ok('criarProcesso', { titulo: 'Tela', objeto: 'O' });
  // Abertura: escolhe a etapa atual automaticamente; pela URL, pela etapa
  let tela = env.ok('telaProcesso', p.numero, {});
  assert.strictEqual(tela.detalhe.processo.id, p.id);
  assert.strictEqual(tela.tarefa.etapa.codigo, 'ABRIR_SUITE');
  assert.strictEqual(tela.auto, true);
  assert.strictEqual(env.ok('telaProcesso', p.numero, { etapa: 'ETP' }).etapaNaoIniciada, 'ETP');
  assert.strictEqual(env.ok('telaProcesso', p.numero, { aba: 'documentos' }).tarefa, null, 'fora da aba Fluxo não monta a etapa');
  // Operação com "tela": resultado + tela na mesma resposta
  const chamar = (m, args, t) => JSON.parse(env.ctx.apiCall(m, args, t));
  env.novaExecucao();
  let r = chamar('salvarCampos', [tela.tarefaId, { numeroSuite: '42/2026', dataAberturaSuite: '2026-11-10' }],
    { processoId: p.id, tarefaId: tela.tarefaId });
  assert.ok(r.ok, r.erro);
  assert.strictEqual(r.data.resultado, true);
  assert.strictEqual(r.data.tela.detalhe.processo.numeroSuite, '42/2026');
  assert.deepStrictEqual(r.data.tela.tarefa.pendencias, []);
  // Concluir com seleção automática: a tela já vem na próxima etapa
  env.novaExecucao();
  r = chamar('concluirTarefa', [tela.tarefaId, ''], { processoId: p.id });
  assert.ok(r.ok, r.erro);
  assert.strictEqual(r.data.tela.tarefa.etapa.codigo, 'DFD');
  // Erro: nada é gravado (tudo ou nada) e a mensagem volta normalmente
  env.novaExecucao();
  const dfd = r.data.tela.tarefaId;
  r = chamar('salvarCampos', [dfd, { unidadeDemandante: 'NAO DEVE GRAVAR', quantidadeDFD: '1,5' }], { processoId: p.id, tarefaId: dfd });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(env.ok('detalharProcesso', p.id).variaveis.unidadeDemandante, undefined);
});

teste('Desempenho: poucas chamadas à planilha por operação e abas com mais de 1000 linhas', () => {
  const env = carregar();
  env.ctx.setup();
  const p = env.ok('criarProcesso', { titulo: 'Perf', objeto: 'O' });
  concluirSimples(env, p.id, 'ABRIR_SUITE', { numeroSuite: '1', dataAberturaSuite: '2026-11-10' });
  concluirSimples(env, p.id, 'DFD', { unidadeDemandante: 'C', descricaoNecessidade: 'x', grauPrioridade: 'Alta', quantidadeDFD: 1, unidadeMedidaDFD: 'Lote' });
  concluirSimples(env, p.id, 'CONSULTA_ETICE', { resultadoConsultaEtice: 'Favorável' });
  const t = tarefaAberta(env, p.id, 'ETP');
  const medir = (m, ...a) => {
    env.novaExecucao();
    const c0 = Object.assign({}, env.estado.chamadas);
    const r = JSON.parse(env.ctx.apiCall(m, a));
    assert.ok(r.ok, r.erro);
    return Object.keys(c0).reduce((s, k) => s + env.estado.chamadas[k] - c0[k], 0);
  };
  const n = medir('salvarCampos', t.id, camposEtp());
  const limite = MODO.semSheetsApi ? 12 : 4;
  assert.ok(n <= limite, 'salvar o ETP (17 campos) fez ' + n + ' chamadas à planilha (limite ' + limite + ')');
  // Muitas linhas: o histórico passa de 1000 linhas sem erro de "fora da grade"
  for (let i = 0; i < 70; i++) env.ok('salvarCampos', t.id, { etpNecessidade: 'v' + i, etpRequisitos: 'r' + i, etpSolucao: 's' + i });
  env.novaExecucao();
  for (let i = 0; i < 1100; i++) env.ctx.Historico.registrar(p.id, '', 'TESTE', 'linha ' + i);
  env.novaExecucao();
  const ss = Object.values(env.estado.planilhas)[0];
  assert.ok(ss.getSheetByName('Historico').getLastRow() > 1100);
});

teste('Natureza contínua = SIM: junção espera a Justificativa', () => {
  const env = carregar();
  env.ctx.setup();
  const p = ateParalelo(env, 'Contínuo');
  const nat = tarefaAberta(env, p.id, 'NATUREZA');
  env.ok('salvarCampos', nat.id, { naturezaContinua: 'SIM' });
  env.ok('concluirTarefa', nat.id, '');
  assert.deepStrictEqual(ativas(env, p.id), ['COD_ITEM', 'JUSTIFICATIVA', 'PESQUISA_PRECO']);
  concluirSimples(env, p.id, 'COD_ITEM', { codigoItem: '1', catalogoItem: 'SEPLAG' });
  env.ok('salvarCotacao', p.id, { item: 'X', valorUnitario: 10 });
  concluirSimples(env, p.id, 'PESQUISA_PRECO');
  concluirSimples(env, p.id, 'MAPA_PRECOS');
  concluirSimples(env, p.id, 'MODALIDADE', { modalidadePesquisa: 'Notas fiscais (V)' });
  assert.deepStrictEqual(ativas(env, p.id), ['JUSTIFICATIVA'], 'TR não pode abrir antes da Justificativa');
  concluirSimples(env, p.id, 'JUSTIFICATIVA', { fundamentacaoContinuidade: 'serviço contínuo' });
  assert.deepStrictEqual(ativas(env, p.id), ['TR']);

  // Devolução do TR para o ETP cancela tudo e recomeça o paralelo
  const tr = tarefaAberta(env, p.id, 'TR');
  env.ok('devolverTarefa', tr.id, 'ETP', 'Rever quantidades');
  assert.deepStrictEqual(ativas(env, p.id), ['ETP']);
  concluirSimples(env, p.id, 'ETP', {});
  assert.deepStrictEqual(ativas(env, p.id), ['COD_ITEM', 'NATUREZA', 'PESQUISA_PRECO']);
});

teste('Diligências, cancelamento e documentos condicionais da ETICE', () => {
  const env = carregar();
  env.ctx.setup();
  const p = env.ok('criarProcesso', { titulo: 'D', objeto: 'O' });
  const d = env.ok('registrarDiligencia', p.id, { numeroDespacho: 'DESPACHO Nº 458/2026/CECOC', origem: 'CECOC', prazo: '2000-01-01' });
  assert.strictEqual(env.ok('painel').diligencias[0].atrasada, true);
  const doc = env.ok('anexarDocumento', p.id, 'RESPOSTA_DESPACHO', '', arquivo('resposta.pdf'));
  const pasta = env.estado.pastas[env.estado.arquivos[doc.fileId].pai];
  assert.strictEqual(pasta.nome, 'Diligências');
  env.ok('responderDiligencia', d.id, 'Respondido', doc.id);
  assert.strictEqual(env.ok('detalharProcesso', p.id).diligencias[0].status, 'RESPONDIDA');

  env.ok('salvarCampos', tarefaAberta(env, p.id, 'ABRIR_SUITE').id, { numeroSuite: '1' });
  env.novaExecucao();
  env.ctx.Variaveis.definir(p.id, 'contratadaEtice', 'SIM', 'ETP');
  env.novaExecucao();
  const ins = env.ctx.Instrucao.verificar(env.ctx.repo('Processos').obter(p.id));
  assert.ok(ins.find((i) => i.codigo === 'ETICE_CND').exigido);

  assert.match(env.falha('alterarStatusProcesso', p.id, 'CANCELADO', ''), /motivo/);
  env.ok('alterarStatusProcesso', p.id, 'CANCELADO', 'Desistência');
  assert.deepStrictEqual(ativas(env, p.id), []);
  assert.match(env.falha('alterarStatusProcesso', p.id, 'EM_ANDAMENTO', 'x'), /não permitida/);
});

teste('Repositório: tipos (número pt-BR, booleano, JSON) e remoção', () => {
  const env = carregar();
  env.ctx.setup();
  env.novaExecucao();
  const p = env.ok('criarProcesso', { titulo: 'R', objeto: 'O' });
  assert.strictEqual(typeof p.pastas, 'object');
  let c = env.ok('salvarCotacao', p.id, { item: 'I', valorUnitario: '1.234,56' });
  c = env.ok('considerarCotacao', c.id, false, 'teste');
  assert.strictEqual(c.valorUnitario, 1234.56);
  assert.strictEqual(c.considerado, false);
  env.ok('removerCotacao', c.id);
  env.novaExecucao();
  assert.strictEqual(env.ctx.repo('PesquisaPrecos').todos().length, 0);
});

teste('ETP: 13 incisos, "Não se aplica", sugestões, valor da solução, documento e assinaturas', () => {
  const env = carregar();
  env.ctx.setup();
  const p = env.ok('criarProcesso', { titulo: 'ETP', objeto: 'Sustentação do SGS' });
  concluirSimples(env, p.id, 'ABRIR_SUITE', { numeroSuite: '777/2026', dataAberturaSuite: '2026-11-10' });
  concluirSimples(env, p.id, 'DFD', { unidadeDemandante: 'CESOP', descricaoNecessidade: 'Necessidade vinda do DFD',
    quantidadeDFD: 1000, unidadeMedidaDFD: 'UST (Unidade de Serviço Técnico)', grauPrioridade: 'Alta' }, { gerar: true });
  concluirSimples(env, p.id, 'CONSULTA_ETICE', { resultadoConsultaEtice: 'Favorável' });
  const t = tarefaAberta(env, p.id, 'ETP');
  let w = env.ok('abrirTarefa', t.id);

  const secoes = w.campos.filter((c) => c.tipo === 'secaoLei');
  assert.strictEqual(secoes.length, 13);
  assert.deepStrictEqual(secoes.map((c) => c.rotulo.split(' – ')[0]),
    ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII']);
  const obrigSemNsa = secoes.filter((c) => !/NSA/.test(c.opcoes)).map((c) => c.rotulo.split(' – ')[0]);
  assert.deepStrictEqual(obrigSemNsa, ['I', 'IV', 'VI', 'VIII', 'XIII'], 'art. 18, §2º');
  assert.ok(!w.campos.some((c) => c.chave === 'quantidadesEstimadas'), 'campo antigo removido pela migração');

  // Sugestões vindas do DFD
  assert.strictEqual(w.sugestoes.etpNecessidade.valor, 'Necessidade vinda do DFD');
  assert.strictEqual(w.sugestoes.etpQuantidades.valor, '1000 UST (Unidade de Serviço Técnico)');
  assert.ok(!w.sugestoes.valorEstimadoEtp, 'sem propostas ainda, sem sugestão de valor');

  // Valor da solução: licitação = média das propostas; ETICE = proposta da ETICE
  env.ok('salvarCotacao', p.id, { item: 'UST', quantidade: 10, fornecedor: 'Empresa A', valorUnitario: 100 });
  env.ok('salvarCotacao', p.id, { item: 'UST', quantidade: 10, fornecedor: 'Empresa B', valorUnitario: 200 });
  env.ok('salvarCampos', t.id, { contratadaEtice: 'NAO' });
  w = env.ok('abrirTarefa', t.id);
  assert.strictEqual(w.sugestoes.valorEstimadoEtp.valor, 1500);
  assert.match(w.sugestoes.valorEstimadoEtp.origem, /Média das 2/);
  env.ok('salvarCotacao', p.id, { item: 'UST', quantidade: 10, fornecedor: 'ETICE', valorUnitario: 120 });
  env.ok('salvarCampos', t.id, { contratadaEtice: 'SIM' });
  assert.strictEqual(env.ok('abrirTarefa', t.id).sugestoes.valorEstimadoEtp.valor, 1200);

  // "Não se aplica": só nos incisos que permitem, e exige justificativa
  env.ok('salvarCampos', t.id, { etpImpactosAmbientais_nsa: true, etpNecessidade_nsa: true });
  let det = env.ok('detalharProcesso', p.id);
  assert.strictEqual(det.variaveis.etpImpactosAmbientais_nsa, 'true');
  assert.strictEqual(det.variaveis.etpNecessidade_nsa, undefined, 'inciso I é obrigatório: não aceita NSA');
  const pend = env.ok('abrirTarefa', t.id).pendencias.join(' | ');
  assert.match(pend, /Justifique o "Não se aplica" em: XII/);
  assert.match(pend, /Preencha a seção "I – DESCRIÇÃO DA NECESSIDADE/);

  // Preenche tudo e gera o documento
  env.ok('salvarCampos', t.id, camposEtp({ contratadaEtice: 'NAO', valorEstimadoEtp: '1.500,00' }));
  assert.strictEqual(env.ok('detalharProcesso', p.id).processo.valorEstimado, 1500, 'valor do ETP no processo');
  env.ok('marcarChecklist', t.id, env.ok('abrirTarefa', t.id).checklist[0].id, true);
  const doc = env.ok('gerarDocumento', p.id, 'ETP', t.id);
  const texto = env.estado.docs[doc.fileId].texto;
  ['ESTUDO TÉCNICO PRELIMINAR', 'I – DESCRIÇÃO DA NECESSIDADE DA CONTRATAÇÃO', 'XIII – POSICIONAMENTO CONCLUSIVO',
    'Não se aplica. Justificativa: Serviço de TI sem impacto ambiental relevante', 'R$', 'Daniel Boyadijan', 'Thiago', 'SECEX-PGI',
    'SUITE nº 777/2026'].forEach((trecho) => assert.ok(texto.includes(trecho), 'documento deveria conter: ' + trecho));
  assert.ok(texto.indexOf('I – DESCRIÇÃO') < texto.indexOf('II – DEMONSTRATIVO'), 'ordem dos incisos');

  // Assinaturas no SUITE
  assert.match(env.falha('concluirTarefa', t.id, ''), /assinado no SUITE/);
  assert.match(env.falha('alterarStatusDocumento', doc.id, 'FINAL'), /assinado no SUITE/);
  env.ok('enviarParaAssinatura', doc.id);
  det = env.ok('detalharProcesso', p.id);
  const d2 = det.documentos.find((d) => d.id === doc.id);
  assert.strictEqual(d2.status, 'EM_ASSINATURA');
  assert.ok(d2.pdfUrl, 'PDF gerado para o SUITE');
  const ass = det.assinaturas.filter((a) => a.documentoId === doc.id);
  assert.deepStrictEqual(ass.map((a) => a.signatario), ['Daniel Boyadijan', 'Thiago', 'Secretário(a)']);
  env.ok('registrarAssinatura', ass[0].id, '2026-11-13');
  env.ok('registrarAssinatura', ass[1].id, '2026-11-13');
  assert.strictEqual(env.ok('detalharProcesso', p.id).documentos.find((d) => d.id === doc.id).status, 'EM_ASSINATURA');
  env.ok('registrarAssinatura', ass[2].id, '2026-11-13');
  assert.strictEqual(env.ok('detalharProcesso', p.id).documentos.find((d) => d.id === doc.id).status, 'FINAL');
  env.ok('concluirTarefa', t.id, '');
  assert.deepStrictEqual(ativas(env, p.id), ['COD_ITEM', 'NATUREZA', 'PESQUISA_PRECO']);
});

teste('Documentos: timbre (cabeçalho), modelo com marcadores e PDF assinado anexado', () => {
  const env = carregar();
  env.ctx.setup();
  const p = env.ok('criarProcesso', { titulo: 'Doc', objeto: 'Objeto' });
  env.novaExecucao();
  env.ctx.Variaveis.definir(p.id, 'descricaoNecessidade', 'Linha 1\nLinha 2', 'DFD');
  env.ctx.Variaveis.definir(p.id, 'valorEstimadoEtp', '1234.5', 'ETP');

  // Timbre: cabeçalho do documento de referência é mantido e o corpo é substituído
  const timbre = env.estado.criarDoc('Doc SGS', ['conteúdo antigo'], ['GOVERNO DO ESTADO DO CEARÁ']);
  env.ctx.APP.MODELO_TIMBRADO_ID = timbre.getId();
  const d1 = env.ok('gerarDocumento', p.id, 'DFD', '');
  const g1 = env.estado.docs[d1.fileId];
  assert.strictEqual(g1.cabecalho.lista[0].texto, 'GOVERNO DO ESTADO DO CEARÁ');
  assert.ok(!g1.texto.includes('conteúdo antigo'));
  assert.ok(g1.texto.startsWith('DFD - DOCUMENTO DE FORMALIZAÇÃO DA DEMANDA'));

  // Modelo com marcadores: várias linhas viram parágrafos; "R$" preservado
  const modelo = env.estado.criarDoc('Modelo', ['Necessidade:', '{{descricaoNecessidade}}', 'Valor: {{valorEstimadoEtp}} — {{numero}}']);
  env.novaExecucao();
  env.ctx.repo('cfg_DocumentosTipo').atualizar('JUSTIFICATIVA_DIRETA', { modeloId: modelo.getId() });
  env.ctx.ConfigService.limparCache();
  const d2 = env.ok('gerarDocumento', p.id, 'JUSTIFICATIVA_DIRETA', '');
  const linhas = env.estado.docs[d2.fileId].paragrafos.map((x) => x.texto);
  assert.deepStrictEqual(linhas.slice(0, 3), ['Necessidade:', 'Linha 1', 'Linha 2']);
  assert.match(linhas[3], /^Valor: R\$\s?1\.234,50 — CESOP-\d{4}-001$/);

  // PDF assinado anexado = FINAL (dispensa o controle de assinaturas)
  const d3 = env.ok('anexarDocumento', p.id, 'ETP', '', arquivo('ETP assinado.pdf'));
  assert.strictEqual(d3.status, 'FINAL');
});

teste('Migração da configuração: aplicada uma vez, sem duplicar', () => {
  const env = carregar();
  env.ctx.setup();
  assert.strictEqual(env.estado.props.CFG_VERSAO, '6');
  const ss = Object.values(env.estado.planilhas)[0];
  const linhas = (n) => ss.getSheetByName(n).getLastRow();
  const antes = ['cfg_Campos', 'cfg_Assinaturas', 'cfg_DocumentosTipo'].map(linhas);
  // Simula uma instalação antiga (versão 1) que roda o setup de novo
  delete env.estado.props.CFG_VERSAO;
  env.novaExecucao();
  env.ctx.setup();
  assert.deepStrictEqual(['cfg_Campos', 'cfg_Assinaturas', 'cfg_DocumentosTipo'].map(linhas), antes);
  env.novaExecucao();
  env.ctx.setup();
  assert.deepStrictEqual(['cfg_Campos', 'cfg_Assinaturas', 'cfg_DocumentosTipo'].map(linhas), antes);
});

teste('Administração: aplica atualizações pendentes pela tela (sem executar o setup)', () => {
  const env = carregar();
  env.ctx.setup();
  // Simula uma planilha que ficou na versão 2 (checklist antigo do DFD)
  env.estado.props.CFG_VERSAO = '2';
  env.novaExecucao();
  env.ctx.repo('cfg_ChecklistItens').inserir({ id: 'X', fluxoId: 'CONTRATACAO', etapaCodigo: 'DFD', descricao: 'Item antigo', obrigatorio: true, ordem: 99 });
  env.ctx.ConfigService.limparCache();
  let ctx = env.ok('contexto');
  assert.deepStrictEqual(ctx.configuracao.pendentes.map((m) => m.versao), [3, 4, 5, 6]);
  const log = env.ok('atualizarConfiguracao');
  assert.ok(log.some((l) => /Migração 3 aplicada/.test(l)), log.join('\n'));
  ctx = env.ok('contexto');
  assert.strictEqual(ctx.configuracao.versao, 6);
  assert.deepStrictEqual(ctx.configuracao.pendentes, []);
  const p = env.ok('criarProcesso', { titulo: 'T', objeto: 'O' });
  concluirSimples(env, p.id, 'ABRIR_SUITE', { numeroSuite: '1', dataAberturaSuite: '2026-11-10' });
  const w = env.ok('abrirTarefa', tarefaAberta(env, p.id, 'DFD').id);
  assert.deepStrictEqual(w.checklist.map((i) => i.descricao), ['Documento assinado pelo Secretário da unidade demandante']);
  assert.deepStrictEqual(w.campos.filter((c) => c.linha === 'DFD_QTD').map((c) => c.chave), ['quantidadeDFD', 'unidadeMedidaDFD']);
  // Outros papéis não podem
  env.ok('salvarUsuario', { email: 'ana@orgao.gov.br', nome: 'Ana', papel: 'ANALISTA' });
  env.comoUsuario('ana@orgao.gov.br');
  assert.match(env.falha('atualizarConfiguracao'), /permissão/);
  assert.strictEqual(env.ok('contexto').configuracao, null);
});

teste('Encaminhar à CECOC: contratação direta encerra; pregão segue para análise e parecer', () => {
  const env = carregar();
  env.ctx.setup();
  env.novaExecucao();
  const prox = (vars) => JSON.parse(JSON.stringify(env.ctx.Workflow.proximas('CONTRATACAO', 'ENVIO_CECOC', vars).map((x) => x.codigo)));
  assert.deepStrictEqual(prox({ contratadaEtice: 'SIM' }), ['FIM']);
  assert.deepStrictEqual(prox({ contratadaEtice: 'NAO' }), ['ANALISE_PROPOSTA']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(env.ctx.Workflow.proximas('CONTRATACAO', 'INSTRUCAO', {}).map((x) => x.codigo))), ['ENVIO_CECOC']);

  // Contratação direta: processo chega ao encaminhamento e, com o retorno, é encerrado
  const p = env.ok('criarProcesso', { titulo: 'Direta', objeto: 'ETICE' });
  env.novaExecucao();
  env.ctx.Variaveis.definir(p.id, 'contratadaEtice', 'SIM', 'ETP');
  env.ctx.Workflow._ativar(env.ctx.repo('Processos').obter(p.id), 'ENVIO_CECOC', '');
  env.novaExecucao();
  const t = tarefaAberta(env, p.id, 'ENVIO_CECOC');
  assert.match(env.falha('concluirTarefa', t.id, ''), /envio e o retorno/);
  env.ok('registrarEnvio', t.id, 'Despacho CESOP', '2026-11-20');
  env.ok('registrarRetorno', t.id, 'Retorno CECOC', '2026-11-24');
  env.ok('concluirTarefa', t.id, '');
  const det = env.ok('detalharProcesso', p.id);
  assert.strictEqual(det.processo.status, 'CONCLUIDO');
  assert.ok(!det.tarefas.some((x) => x.etapaCodigo === 'ANALISE_PROPOSTA'), 'sem análise na contratação direta');
});

teste('Mapa comparativo: planilha, itens padronizados, descarte com motivo e contratação direta', () => {
  const env = carregar();
  env.ctx.setup();
  const p = env.ok('criarProcesso', { titulo: 'Mapa', objeto: 'Licenças' });
  const cot = (f, v, extra) => env.ok('salvarCotacao', p.id, Object.assign({ item: 'Licença Office', unidade: 'Licença', quantidade: 100, fornecedor: f, fonte: 'Marketplace', valorUnitario: v }, extra || {}));
  const a = cot('Empresa A', 100);
  // Mesmo item com outra grafia: agrupado; unidade e quantidade herdadas quando não informadas
  const b = env.ok('salvarCotacao', p.id, { item: '  licença   office ', fornecedor: 'Empresa B', valorUnitario: 110, quantidade: '' });
  assert.strictEqual(b.item, 'Licença Office');
  assert.strictEqual(b.unidade, 'Licença');
  assert.strictEqual(b.quantidade, 100);
  // Unidade ou quantidade diferentes para o mesmo item: recusado
  assert.match(env.falha('salvarCotacao', p.id, { item: 'Licença Office', unidade: 'Mês', quantidade: 100, valorUnitario: 1 }), /mesma unidade/);
  assert.match(env.falha('salvarCotacao', p.id, { item: 'Licença Office', unidade: 'Licença', quantidade: 50, valorUnitario: 1 }), /mesma quantidade/);
  const c = cot('Empresa C', 300);
  cot('Suporte', 50, { item: 'Suporte técnico', unidade: 'Mês', quantidade: 12 });

  let m = env.ok('calcularMapa', p.id, 'MEDIA');
  const lic = m.itens.find((i) => i.item === 'Licença Office');
  assert.strictEqual(lic.n, 3);
  assert.ok(lic.cotacoes.find((x) => x.id === c.id).destoante, '300 destoa da mediana 110');
  // Descartar exige motivo; descartado sai do cálculo
  assert.match(env.falha('considerarCotacao', c.id, false, ''), /motivo/);
  env.ok('considerarCotacao', c.id, false, 'Preço fora da realidade de mercado');
  m = env.ok('calcularMapa', p.id, 'MEDIA');
  assert.strictEqual(m.itens.find((i) => i.item === 'Licença Office').media, 105);
  assert.strictEqual(m.total, 105 * 100 + 50 * 12);
  assert.ok(env.ok('historicoProcesso', p.id).some((h) => h.acao === 'COTACAO_DESCARTADA' && /fora da realidade/.test(h.detalhe)));

  // Planilha gerada com as abas Mapa e Cotações
  const doc = env.ok('gerarMapa', p.id, 'MEDIA', '');
  assert.strictEqual(doc.mimeType, 'application/vnd.google-apps.spreadsheet');
  const ss = env.estado.planilhas[doc.fileId];
  assert.deepStrictEqual(ss.getSheets().map((x) => x.nome), ['Mapa', 'Cotações']);
  const mapaTxt = ss.getSheetByName('Mapa').dados.map((l) => (l || []).join('|')).join('\n');
  assert.ok(mapaTxt.includes('VALOR TOTAL ESTIMADO|||||||||||11100'), mapaTxt);
  assert.ok(mapaTxt.includes('Empresa C (Marketplace)'));
  const cotTxt = ss.getSheetByName('Cotações').dados.map((l) => (l || []).join('|')).join('\n');
  assert.ok(cotTxt.includes('Empresa C') && cotTxt.includes('Não|Sim|Preço fora da realidade de mercado'), cotTxt);
  assert.strictEqual(env.ok('detalharProcesso', p.id).processo.valorEstimado, 11100, 'pregão: valor do processo = mapa');
  // Assinatura: o PDF é gerado também a partir da planilha
  env.ok('enviarParaAssinatura', doc.id);
  assert.ok(env.ok('detalharProcesso', p.id).documentos.find((d) => d.id === doc.id).pdfUrl);

  // Contratação direta: o mapa não substitui o valor estimado do processo
  env.novaExecucao();
  env.ctx.Variaveis.definir(p.id, 'contratadaEtice', 'SIM', 'ETP');
  env.ctx.repo('Processos').atualizar(p.id, { valorEstimado: 9999 });
  env.novaExecucao();
  env.ok('considerarCotacao', c.id, true, '');
  env.ok('gerarMapa', p.id, 'MEDIA', '');
  const det = env.ok('detalharProcesso', p.id);
  assert.strictEqual(det.processo.valorEstimado, 9999);
  assert.strictEqual(Number(det.variaveis.valorMapa), (100 + 110 + 300) / 3 * 100 + 600);
  void a; void b;
});

// ------------------------------------------------------------------ execução
let falhas = 0;
let total = 0;
[{ rotulo: 'com o serviço avançado Google Sheets API', modo: {} },
  { rotulo: 'sem o serviço avançado (SpreadsheetApp)', modo: { semSheetsApi: true } }].forEach(({ rotulo, modo }) => {
  MODO = modo;
  console.log('\n' + rotulo + ':');
  testes.forEach(({ nome, fn }) => {
    total++;
    try {
      fn();
      console.log('  ✔ ' + nome);
    } catch (e) {
      falhas++;
      console.log('  ✘ ' + nome + '\n    ' + (e.stack || e).split('\n').slice(0, 6).join('\n    '));
    }
  });
});
console.log('\n' + (total - falhas) + '/' + total + ' testes passaram.');
process.exit(falhas ? 1 : 0);
