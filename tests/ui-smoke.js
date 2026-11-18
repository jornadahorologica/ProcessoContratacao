/**
 * Teste de fumaça da interface: abre a SPA no Chromium (Playwright) com
 * google.script.run ligado ao back-end simulado e percorre as telas
 * principais, falhando se houver erro de JavaScript.
 * Uso: node tests/ui-smoke.js [pasta-para-screenshots]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');
const { criarAmbiente } = require('./gas-mock');

const SRC = path.join(__dirname, '..', 'src');
const saida = process.argv[2];

function backend() {
  const { ctx, estado } = criarAmbiente({ semSheetsApi: !!process.env.SEM_SHEETS_API });
  // Logo simulado do SUITE (no Apps Script ele é lido do Drive)
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" rx="6" fill="#0b6e4f"/>' +
    '<text x="60" y="27" font-family="Arial" font-size="20" font-weight="bold" fill="#fff" text-anchor="middle">SUITE</text></svg>';
  estado.arquivos['1tCyDEoBOZ4DfYy654leem4ev7YgVKM_L'] = {
    getBlob: () => ({ getContentType: () => 'image/svg+xml', getBytes: () => Array.from(Buffer.from(svg)) })
  };
  vm.createContext(ctx);
  fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort()
    .forEach((f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f }));
  ctx.setup();
  const fn = (metodo, args, tela) => {
    vm.runInContext('Db.gravar(); _repos = {}; ConfigService._memo = null; Auth._usuario = null; Db._ss = null; Db._sheets = {}; Db._id = null; Utils._props = null; Workflow._cacheAlc = null;', ctx);
    return ctx.apiCall(metodo, args, tela);
  };
  fn.estado = estado;
  return fn;
}

function montarHtml() {
  const ler = (n) => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');
  const ponte = `<script>
    // Simula google.script.run / history / url do Apps Script
    window.google = { script: {
      run: (function mk(ok, fail) {
        return { withSuccessHandler: (f) => mk(f, fail), withFailureHandler: (f) => mk(ok, f),
          apiCall: (m, a, t) => window.__api(m, a, t || null).then(ok, fail) };
      })(),
      history: {
        push: (st, par, h) => history.pushState(null, '', '#' + h),
        replace: (st, par, h) => history.replaceState(null, '', '#' + h),
        setChangeHandler: (fn) => window.addEventListener('popstate', () => fn({ location: { hash: location.hash.slice(1) } }))
      },
      url: { getLocation: (cb) => setTimeout(() => cb({ hash: location.hash.slice(1), parameter: {} })) }
    } };
  </script>`;
  return ler('Index')
    .replace("<?!= incluir('Estilos') ?>", () => ler('Estilos')) // função: evita a interpretação de $$ e $'
    .replace("<?!= incluir('App') ?>", () => ponte + ler('App'));
}

(async () => {
  const api = backend();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: saida ? 2 : 1 });
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => process.env.DEBUG && console.log('[browser]', m.text()));
  // O sistema não deve usar os pop-ups nativos do navegador (alert/confirm/prompt)
  page.on('dialog', (d) => { erros.push('Pop-up nativo do navegador usado: ' + d.message()); d.dismiss(); });
  // Confirma o pop-up do sistema (botão principal = último)
  const confirmarPopup = async (nomeFoto) => {
    await page.waitForSelector('#dialogo .dlg');
    if (nomeFoto) await foto(nomeFoto);
    await page.click('#dialogo .pe .btn:last-child');
    await page.waitForSelector('#dialogo.oculto', { state: 'attached' });
  };
  await page.exposeFunction('__api', (m, a, t) => api(m, a, t));
  const html = montarHtml();
  await page.route('http://app.local/**', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://app.local/exec');
  const hash = () => page.evaluate(() => decodeURIComponent(location.hash));
  const esperarHash = (h) => page.waitForFunction((esp) => decodeURIComponent(location.hash) === esp, h);
  const foto = async (n) => saida && page.screenshot({ path: path.join(saida, n + '.png') });
  const esperarCarregar = () => page.waitForFunction(() => !document.querySelector('.carregando') && document.querySelector('#ocupado').classList.contains('oculto'));

  await page.waitForSelector('.kpis');
  await esperarHash('#/painel');
  await page.click('#menu a[data-view=novo]');
  await esperarHash('#/novo-processo');
  await page.fill('[name=titulo]', 'Novo contrato SGS');
  await page.fill('[name=objeto]', 'Sustentação e evolução do SGS');
  await page.waitForSelector('a.logo-externo[href="https://suite.ce.gov.br/"] img');
  if (await page.inputValue('[name=responsavelTecnico]') !== 'Daniel Boyadijan') throw new Error('Responsável técnico padrão ausente');
  await foto('0-novo-processo');
  await page.click('text=Criar processo');
  await page.waitForSelector('.timeline');
  await esperarCarregar();

  // URL do processo: número + etapa atual
  await esperarHash('#/processo/CESOP-' + new Date().getFullYear() + '-001/etapa/ABRIR_SUITE');
  const NUM = 'CESOP-' + new Date().getFullYear() + '-001';
  // Etapa 1: Abrir processo SUITE (logo do SUITE no canto superior direito)
  await page.waitForSelector('#area-trabalho a.logo-externo[target=_blank] img');
  await foto('1-abrir-suite');
  await page.fill('[name=numeroSuite]', '12345/2026');
  await page.fill('[name=dataAberturaSuite]', '2026-11-10');
  await page.click('text=Salvar dados');
  await page.waitForSelector('.ok-box', { timeout: 8000 }).catch(async (e) => {
    console.error('toast:', await page.textContent('#toasts'), 'erros:', erros);
    throw e;
  });
  await page.click('[data-acao=concluir]');
  await confirmarPopup('8-popup-concluir');
  await page.waitForFunction(() => /Elaborar DFD/.test(document.querySelector('#area-trabalho h2')?.textContent || ''));
  await esperarCarregar();
  await foto('2-etapa-dfd');

  await esperarHash('#/processo/' + NUM + '/etapa/DFD');
  await page.waitForSelector('#bloco-form .linha [name=quantidadeDFD]');
  const mesmaLinha = await page.evaluate(() => {
    const a = document.querySelector('[name=quantidadeDFD]').getBoundingClientRect();
    const b = document.querySelector('[name=unidadeMedidaDFD]').getBoundingClientRect();
    return Math.abs(a.top - b.top) < 5 && b.left > a.right;
  });
  if (!mesmaLinha) throw new Error('Quantidade e Unidade deveriam ficar na mesma linha');

  // Abas atualizam a URL
  for (const aba of ['documentos', 'diligencias', 'dados', 'historico']) {
    await page.click(`[data-aba=${aba}]`);
    await esperarCarregar();
    await esperarHash('#/processo/' + NUM + '/' + aba);
  }
  // Voltar do navegador retorna à aba anterior
  await page.goBack();
  await esperarHash('#/processo/' + NUM + '/dados');
  await page.waitForSelector('#form-dados');
  // Clique numa etapa concluída da linha do tempo
  await page.click('[data-aba=fluxo]');
  await esperarCarregar();
  await page.click('.timeline .item:has-text("Abrir processo SUITE")');
  await esperarHash('#/processo/' + NUM + '/etapa/ABRIR_SUITE');
  // Link direto (copiado/compartilhado) abre a etapa indicada
  await page.goto('http://app.local/exec#/processo/' + NUM + '/etapa/DFD');
  await page.reload();
  await page.waitForFunction(() => /Elaborar DFD/.test(document.querySelector('#area-trabalho h2')?.textContent || ''));
  await page.goto('http://app.local/exec#/processo/' + NUM + '/documentos');
  await page.reload();
  await page.waitForSelector('[data-aba=documentos].ativo');
  // ---------------- ETP (13 incisos) em um segundo processo, preparado via API
  const ok = (m, ...a) => { const r = JSON.parse(api(m, a)); if (!r.ok) throw new Error(m + ': ' + r.erro); return r.data; };
  const pdf = (n) => ({ nome: n, mimeType: 'application/pdf', base64: Buffer.from(n).toString('base64') });
  const p2 = ok('criarProcesso', { titulo: 'Sustentação SGS 2027', objeto: 'Sustentação e evolução do SGS' });
  const aberta = (cod) => ok('detalharProcesso', p2.id).tarefas.find((t) => t.etapaCodigo === cod && t.status === 'ABERTA');
  let t2 = aberta('ABRIR_SUITE');
  ok('salvarCampos', t2.id, { numeroSuite: '55555/2026', dataAberturaSuite: '2026-11-10' });
  ok('concluirTarefa', t2.id, '');
  t2 = aberta('DFD');
  ok('salvarCampos', t2.id, { unidadeDemandante: 'CESOP', grauPrioridade: 'Alta', quantidadeDFD: 12000, unidadeMedidaDFD: 'UST (Unidade de Serviço Técnico)',
    descricaoNecessidade: 'Garantir a continuidade da sustentação e evolução do SGS, sistema crítico para a gestão estadual.' });
  ok('abrirTarefa', t2.id).checklist.filter((i) => i.obrigatorio).forEach((i) => ok('marcarChecklist', t2.id, i.id, true));
  ok('anexarDocumento', p2.id, 'DFD', t2.id, pdf('DFD assinado.pdf'));
  ok('concluirTarefa', t2.id, '');
  t2 = aberta('CONSULTA_ETICE');
  ok('salvarCampos', t2.id, { resultadoConsultaEtice: 'Favorável' });
  ok('registrarEnvio', t2.id, 'Ofício 10/2026', '2026-11-01');
  ok('registrarRetorno', t2.id, 'Resposta ETICE', '2026-11-05');
  ok('anexarDocumento', p2.id, 'CONSULTA_ETICE', t2.id, pdf('Consulta ETICE.pdf'));
  ok('concluirTarefa', t2.id, '');
  ok('salvarCotacao', p2.id, { item: 'UST', quantidade: 12000, fornecedor: 'Empresa A', valorUnitario: 180 });
  ok('salvarCotacao', p2.id, { item: 'UST', quantidade: 12000, fornecedor: 'Empresa B', valorUnitario: 220 });

  await page.goto('http://app.local/exec#/processo/' + p2.numero + '/etapa/ETP');
  await page.reload();
  await page.waitForSelector('#bloco-form details.secao');
  if ((await page.$$('#bloco-form details.secao')).length !== 13) throw new Error('ETP deveria ter 13 seções');
  // Sugestão do DFD no inciso I
  await page.click('details[data-secao=etpNecessidade] [data-acao=usarSugestao]');
  if (!(await page.inputValue('[name=etpNecessidade]')).startsWith('Garantir a continuidade')) throw new Error('Sugestão não aplicada');
  // Não se aplica no inciso XII
  await page.check('[name=etpImpactosAmbientais_nsa]');
  await page.fill('[name=etpImpactosAmbientais]', 'Serviço de TI sem impacto ambiental relevante.');
  await page.selectOption('[name=contratadaEtice]', 'NAO');
  await page.click('text=Salvar dados');
  await esperarCarregar();
  await page.waitForSelector('details[data-secao=etpImpactosAmbientais] .tag');
  await page.click('div:has(> [name=valorEstimadoEtp]) [data-acao=usarSugestao]');
  if (await page.inputValue('[name=valorEstimadoEtp]') !== '2400000') throw new Error('Sugestão de valor (média) incorreta');
  const textos = { etpPrevisaoPca: 'Item 12 do PCA 2026.', etpRequisitos: 'Equipe com experiência em Java.', etpQuantidades: '12.000 UST/ano.',
    etpLevantamentoMercado: 'Foram avaliadas fábrica de software e alocação.', etpEstimativaValor: 'Média das propostas recebidas.',
    etpSolucao: 'Fábrica de software por UST.', etpParcelamento: 'Solução única, não parcelada.', etpResultados: 'Continuidade do SGS.',
    etpProvidencias: 'Designação de fiscais.', etpCorrelatas: 'Hospedagem do SGS.', etpPosicionamento: 'A contratação é adequada.' };
  await page.click('[data-acao=expandirSecoes]');
  for (const [k, v] of Object.entries(textos)) await page.fill('[name=' + k + ']', v);
  await page.selectOption('[name=registradoPCA]', 'SIM');
  await page.click('text=Salvar dados');
  await esperarCarregar();
  await page.click('label:has-text("ETP revisado") input');
  await esperarCarregar();
  await page.waitForFunction(() => /13 de 13/.test(document.querySelector('#bloco-form h3').textContent));
  await foto('4-etp-incisos');
  // Gera o ETP e controla as assinaturas no SUITE
  await page.click('[data-acao=gerarDoc]');
  await esperarCarregar();
  await page.click('[data-acao=enviarAssinatura]');
  await confirmarPopup();
  await esperarCarregar();
  await page.waitForSelector('.assinaturas .assinante');
  for (let i = 0; i < 3; i++) {
    await page.click('[data-acao=registrarAssinatura] >> nth=0');
    await confirmarPopup(i === 0 ? '9-popup-assinatura' : null);
    await esperarCarregar();
  }
  await page.waitForSelector('.ok-box');
  await foto('5-etp-assinado');
  await page.click('[data-acao=concluir]');
  await confirmarPopup();
  await esperarCarregar();
  await page.waitForFunction(() => document.querySelectorAll('.timeline .item .bola').length > 0 &&
    /Natureza contínua|Pesquisar Código|Pesquisa de Preço/.test(document.querySelector('#area-trabalho h2')?.textContent || ''));

  // Endereço inválido cai no painel
  await page.goto('http://app.local/exec#/rota/que/nao/existe');
  await page.reload();
  await page.waitForSelector('.kpis');
  await page.click('#menu a[data-view=painel]');
  await page.waitForSelector('.kanban .cartao');
  await foto('3-painel');
  await page.click('#menu a[data-view=processos]');
  await page.waitForSelector('tr.clicavel');
  await esperarHash('#/processos');
  await page.click('#menu a[data-view=admin]');
  await page.waitForSelector('#form-usu');
  await esperarHash('#/admin');
  void hash;

  // Atualização pendente da configuração: aviso + botão para o administrador
  api.estado.props.CFG_VERSAO = '2';
  await page.goto('http://app.local/exec#/admin');
  await page.reload();
  await page.waitForSelector('#aviso-config [data-acao=atualizarConfiguracao]');
  await foto('6-aviso-atualizacao');
  await page.click('#aviso-config [data-acao=atualizarConfiguracao]');
  await confirmarPopup();
  await page.waitForSelector('#log-config:not(.oculto)');
  if (await page.$('#aviso-config [data-acao=atualizarConfiguracao]')) throw new Error('Aviso deveria sumir após aplicar');
  await foto('7-atualizacao-aplicada');

  await browser.close();
  if (erros.length) {
    console.error('Erros de JavaScript na interface:\n' + erros.join('\n'));
    process.exit(1);
  }
  console.log('UI ok: telas percorridas sem erros de JavaScript.');
})().catch((e) => { console.error(e); process.exit(1); });
