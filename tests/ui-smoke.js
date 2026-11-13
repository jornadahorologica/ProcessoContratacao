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
  const { ctx, estado } = criarAmbiente();
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
  return (metodo, args) => {
    vm.runInContext('_repos = {}; ConfigService._memo = null; Auth._usuario = null; Db._ss = null; Db._sheets = {}; Workflow._cacheAlc = null;', ctx);
    return ctx.apiCall(metodo, args);
  };
}

function montarHtml() {
  const ler = (n) => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');
  const ponte = `<script>
    // Simula google.script.run / history / url do Apps Script
    window.google = { script: {
      run: (function mk(ok, fail) {
        return { withSuccessHandler: (f) => mk(f, fail), withFailureHandler: (f) => mk(ok, f),
          apiCall: (m, a) => window.__api(m, a).then(ok, fail) };
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => process.env.DEBUG && console.log('[browser]', m.text()));
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'teste' : undefined));
  await page.exposeFunction('__api', (m, a) => api(m, a));
  const html = montarHtml();
  await page.route('http://app.local/**', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://app.local/exec');
  const hash = () => page.evaluate(() => decodeURIComponent(location.hash));
  const esperarHash = (h) => page.waitForFunction((esp) => decodeURIComponent(location.hash) === esp, h);
  const foto = async (n) => saida && page.screenshot({ path: path.join(saida, n + '.png'), fullPage: true });
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
  await page.waitForSelector('.ok-box');
  await page.click('text=Concluir etapa');
  await page.waitForFunction(() => /Elaborar DFD/.test(document.querySelector('#area-trabalho h2')?.textContent || ''));
  await esperarCarregar();
  await foto('2-etapa-dfd');

  await esperarHash('#/processo/' + NUM + '/etapa/DFD');

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

  await browser.close();
  if (erros.length) {
    console.error('Erros de JavaScript na interface:\n' + erros.join('\n'));
    process.exit(1);
  }
  console.log('UI ok: telas percorridas sem erros de JavaScript.');
})().catch((e) => { console.error(e); process.exit(1); });
