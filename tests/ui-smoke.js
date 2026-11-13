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
  const { ctx } = criarAmbiente();
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
    window.google = { script: { run: (function mk(ok, fail) {
      return { withSuccessHandler: (f) => mk(f, fail), withFailureHandler: (f) => mk(ok, f),
        apiCall: (m, a) => window.__api(m, a).then(ok, fail) };
    })() } };
  </script>`;
  return ler('ui/Index')
    .replace("<?!= incluir('ui/Estilos') ?>", () => ler('ui/Estilos')) // função: evita a interpretação de $$ e $'
    .replace("<?!= incluir('ui/App') ?>", () => ponte + ler('ui/App'));
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
  await page.setContent(montarHtml());
  const foto = async (n) => saida && page.screenshot({ path: path.join(saida, n + '.png'), fullPage: true });
  const esperarCarregar = () => page.waitForFunction(() => !document.querySelector('.carregando') && document.querySelector('#ocupado').classList.contains('oculto'));

  await page.waitForSelector('.kpis');
  await page.click('text=+ Novo processo');
  await page.fill('[name=titulo]', 'Novo contrato SGS');
  await page.fill('[name=objeto]', 'Sustentação e evolução do SGS');
  await page.click('text=Criar processo');
  await page.waitForSelector('.timeline');
  await esperarCarregar();

  // Etapa 1: Abrir processo SUITE
  await page.fill('[name=numeroSuite]', '12345/2026');
  await page.fill('[name=dataAberturaSuite]', '2026-11-10');
  await page.click('text=Salvar dados');
  await page.waitForSelector('.ok-box');
  await page.click('text=Concluir etapa');
  await page.waitForFunction(() => /Elaborar DFD/.test(document.querySelector('#area-trabalho h2')?.textContent || ''));
  await esperarCarregar();
  await foto('2-etapa-dfd');

  // Abas
  for (const aba of ['documentos', 'diligencias', 'dados', 'historico', 'fluxo']) {
    await page.click(`[data-aba=${aba}]`);
    await esperarCarregar();
  }
  await page.click('text=Painel');
  await page.waitForSelector('.kanban .cartao');
  await foto('1-painel');
  await page.click('text=Processos');
  await page.waitForSelector('tr.clicavel');
  await page.click('text=Administração');
  await page.waitForSelector('#form-usu');

  await browser.close();
  if (erros.length) {
    console.error('Erros de JavaScript na interface:\n' + erros.join('\n'));
    process.exit(1);
  }
  console.log('UI ok: telas percorridas sem erros de JavaScript.');
})().catch((e) => { console.error(e); process.exit(1); });
