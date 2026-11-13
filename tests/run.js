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

function carregar(opcoes) {
  const { ctx, estado } = criarAmbiente(opcoes);
  vm.createContext(ctx);
  const arquivos = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
  arquivos.forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f }));
  // Simula o início de uma nova execução do Apps Script (memória por execução zerada)
  const novaExecucao = () => vm.runInContext(
    '_repos = {}; ConfigService._memo = null; Auth._usuario = null; Db._ss = null; Db._sheets = {}; Workflow._cacheAlc = null;', ctx);
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
    if (opcoes.gerar) env.ok('gerarDocumento', procId, w.etapa.documentoTipo, t.id);
    else env.ok('anexarDocumento', procId, w.etapa.documentoTipo, t.id, arquivo(etapa + '.pdf'));
  }
  env.ok('concluirTarefa', t.id, '');
  return t;
}

/** Leva um processo novo até a abertura das tarefas paralelas. */
function ateParalelo(env, titulo) {
  const p = env.ok('criarProcesso', { titulo, objeto: 'Serviços de TI' });
  concluirSimples(env, p.id, 'ABRIR_SUITE', { numeroSuite: '123/2026', dataAberturaSuite: '2026-11-10' });
  concluirSimples(env, p.id, 'DFD', { unidadeDemandante: 'CESOP', descricaoNecessidade: 'x', grauPrioridade: 'Alta' }, { gerar: true });
  concluirSimples(env, p.id, 'CONSULTA_ETICE', { resultadoConsultaEtice: 'Favorável' });
  concluirSimples(env, p.id, 'ETP', { quantidadesEstimadas: '10', pesquisaMercadologica: 'ok', registradoPCA: 'SIM', contratadaEtice: 'NAO' });
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
  assert.strictEqual(ss.getSheetByName('cfg_Etapas').getLastRow() - 1, env.ctx.Seed.etapas().length);
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
  assert.match(pend, /Requerimento do secretário/);
  assert.match(pend, /DFD - Documento/);
});

teste('Solicitação externa (consulta ETICE): envio → aguardando retorno → retorno', () => {
  const env = carregar();
  env.ctx.setup();
  const p = env.ok('criarProcesso', { titulo: 'T', objeto: 'O' });
  concluirSimples(env, p.id, 'ABRIR_SUITE', { numeroSuite: '1', dataAberturaSuite: '2026-11-10' });
  concluirSimples(env, p.id, 'DFD', { unidadeDemandante: 'CESOP', descricaoNecessidade: 'x', grauPrioridade: 'Alta' });
  const t = tarefaAberta(env, p.id, 'CONSULTA_ETICE');
  env.ok('salvarCampos', t.id, { resultadoConsultaEtice: 'Favorável' });
  env.ok('gerarDocumento', p.id, 'CONSULTA_ETICE', t.id);
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
  env.ok('gerarMapa', p.id, 'MEDIANA', mt.id);
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

  // Instrução: documentos gerados ainda em RASCUNHO e não objeção BID exigida
  const ins = tarefaAberta(env, p.id, 'INSTRUCAO');
  let w = env.ok('abrirTarefa', ins.id);
  const faltando = w.instrucao.filter((i) => i.exigido && !i.ok).map((i) => i.codigo).sort();
  assert.deepStrictEqual(faltando, ['DFD', 'TR']); // gerados (RASCUNHO); o Mapa refeito foi anexado (FINAL)
  assert.ok(!w.instrucao.find((i) => i.codigo === 'JUSTIFICATIVA').exigido, 'Justificativa não exigida (NÃO contínua)');
  assert.ok(!w.instrucao.find((i) => i.codigo === 'ETICE_CND').exigido, 'docs ETICE não exigidos');
  assert.ok(w.instrucao.find((i) => i.codigo === 'BID_NAO_OBJECAO').exigido);
  env.ok('detalharProcesso', p.id).documentos.filter((d) => d.status === 'RASCUNHO')
    .forEach((d) => env.ok('alterarStatusDocumento', d.id, 'FINAL'));
  env.ok('marcarChecklist', ins.id, w.checklist[0].id, true);
  w = env.ok('abrirTarefa', ins.id);
  assert.deepStrictEqual(w.pendencias, []);
  env.ok('concluirTarefa', ins.id, '');

  concluirSimples(env, p.id, 'ANALISE_PROPOSTA', { resultadoAnalise: 'Aprovada' });
  concluirSimples(env, p.id, 'PARECER', { conclusaoParecer: 'Favorável' }, { gerar: true });
  det = env.ok('detalharProcesso', p.id);
  assert.strictEqual(det.processo.status, 'CONCLUIDO');
  assert.strictEqual(det.processo.fase, 'CONCLUIDO');
  assert.deepStrictEqual(ativas(env, p.id), []);
  assert.ok(det.historico.some((h) => h.acao === 'ETAPA_DEVOLVIDA'));
  assert.ok(det.historico.some((h) => h.acao === 'PROCESSO_CONCLUIDO'));
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
  const c = env.ok('salvarCotacao', p.id, { item: 'I', valorUnitario: '1.234,56', considerado: 'false' });
  assert.strictEqual(c.valorUnitario, 1234.56);
  assert.strictEqual(c.considerado, false);
  env.ok('removerCotacao', c.id);
  env.novaExecucao();
  assert.strictEqual(env.ctx.repo('PesquisaPrecos').todos().length, 0);
});

// ------------------------------------------------------------------ execução
let falhas = 0;
testes.forEach(({ nome, fn }) => {
  try {
    fn();
    console.log('  ✔ ' + nome);
  } catch (e) {
    falhas++;
    console.log('  ✘ ' + nome + '\n    ' + (e.stack || e).split('\n').slice(0, 6).join('\n    '));
  }
});
console.log('\n' + (testes.length - falhas) + '/' + testes.length + ' testes passaram.');
process.exit(falhas ? 1 : 0);
