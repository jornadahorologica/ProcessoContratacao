# Processos de Contratação — CESOP

Sistema em **Google Apps Script** para conduzir os processos de contratação da CESOP, do pedido ao parecer técnico, seguindo o fluxograma da área. Os dados ficam no **Google Sheets** e os documentos no **Google Drive**.

- Cada processo percorre um **fluxo configurável**: etapas, decisões, atividades em paralelo e devoluções.
- A **estrutura de pastas no Drive** é criada automaticamente para cada processo.
- Cada etapa tem uma **área de trabalho** com formulário, documentos, checklist, solicitação a outro setor, decisão, cotações, mapa de preços e instrução processual.
- **Documentos podem ser gerados a partir de modelos** Google Docs com marcadores `{{campo}}`.
- A **pesquisa de preços** gera o **Mapa Comparativo** (média, mediana, menor preço, coeficiente de variação e sinalização de valores destoantes).
- O **checklist da instrução processual** é calculado a partir dos documentos FINAIS do processo.
- **Diligências** e despachos têm controle próprio de prazo e resposta.
- Há **painel** com kanban por fase, "minhas tarefas", "aguardando outro setor" e atrasos, além de **histórico/auditoria** completo.

A arquitetura está descrita em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Estrutura

```
src/
  appsscript.json          manifesto (fuso, escopos, Web App)
  00_Config.js             constantes e ESQUEMA das tabelas (abas)
  01_Utils.js              utilitários
  02_Repository.js         acesso a dados sobre o Sheets (Repo genérico)
  03_ConfigService.js      leitura da configuração cfg_* (com cache)
  04_Auth.js               usuários e permissões
  05_Condicao.js           avaliador de condições (sem eval)
  06_Historico.js          trilha de auditoria
  07_Variaveis.js          dados chave-valor preenchidos nas etapas
  10_Workflow.js           MOTOR DE FLUXO + checklist da instrução
  20_DriveService.js       pastas e arquivos
  21_DocumentoService.js   geração/anexo de documentos
  22_PesquisaPrecoService.js  cotações e mapa comparativo
  23_DiligenciaService.js  diligências/despachos
  24_Notificacao.js        e-mails (opcional) e rotina diária
  25_ProcessoService.js    processos, painel, área de trabalho
  80_Seed.js               configuração inicial do fluxo CESOP
  81_Setup.js              instalação (setup) e gatilhos
  90_Api.js                API única do front-end (permissões + lock)
  91_WebApp.js             doGet
  Index.html, Estilos.html, App.html   interface (SPA em JS puro)
tests/                     testes locais com os serviços Google simulados
```

## Instalação

Pré-requisitos: Node.js e [clasp](https://github.com/google/clasp) (`npm i -g @google/clasp`). Também é preciso ativar a "Google Apps Script API" em https://script.google.com/home/usersettings.

1. Faça login com a **conta institucional** que será dona do sistema:

   ```bash
   clasp login
   ```

2. Crie o projeto Apps Script (isso gera o `.clasp.json`):

   ```bash
   clasp create --type standalone --title "Processos de Contratação - CESOP" --rootDir src
   ```

   Se o projeto já existir, copie `.clasp.json.example` para `.clasp.json` e preencha o `scriptId`.

3. Envie o código:

   ```bash
   clasp push
   ```

4. *(Recomendado)* Use uma pasta de **Drive Compartilhado** como raiz. No editor (`clasp open`), em **Configurações do projeto → Propriedades do script**, crie `ROOT_FOLDER_ID` com o ID dessa pasta. Se não for definida, o setup cria uma pasta no Meu Drive.
5. No editor, execute a função **`setup`** e autorize os escopos. Ela cria a planilha do banco de dados e as abas, carrega o fluxo da CESOP e cadastra você como ADMIN. O log mostra os links da planilha e da pasta.
6. Publique em **Implantar → Nova implantação → Aplicativo da Web**:
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa do domínio**
7. *(Opcional)* Notificações por e-mail: crie as propriedades `NOTIFICAR_EMAIL = true` e `APP_URL = <url do Web App>` e execute `instalarGatilhos` para receber o resumo diário de prazos.
8. Cadastre os usuários em **Administração** no próprio sistema, ou direto na aba `cfg_Usuarios`.

**Instalação manual (sem clasp):** crie no editor um arquivo de script para cada `.js` de `src/` e um arquivo HTML para cada `.html`, usando **exatamente** os nomes `Index`, `Estilos` e `App`. Ative "Mostrar arquivo de manifesto appsscript.json" nas configurações do projeto e cole o conteúdo de `src/appsscript.json`. Depois siga a partir do passo 4.

Papéis disponíveis: `ADMIN` (tudo), `GESTOR` (opera e suspende/cancela processos), `ANALISTA` (opera processos) e `CONSULTA` (somente leitura).

## Configurando o fluxo (sem programar)

Tudo fica nas abas `cfg_*` da planilha. Depois de editar, clique em **Administração → Recarregar configuração**.

| Aba | Para quê |
|---|---|
| `cfg_Etapas` | etapas: tipo (`TAREFA`, `DECISAO`, `PARALELO`, `JUNCAO`, `FIM`), fase, setor, prazo em dias úteis, **blocos** da tela, documento esperado |
| `cfg_Transicoes` | ligações entre etapas, com condição opcional (ex.: `naturezaContinua == SIM`) |
| `cfg_Campos` | campos do formulário de cada etapa (`texto`, `textoLongo`, `numero`, `moeda`, `data`, `selecao`, `simNao`, `email`) |
| `cfg_ChecklistItens` | itens de checklist por etapa (obrigatórios ou não) |
| `cfg_DocumentosTipo` | tipos de documento, subpasta de destino, **ID do modelo Google Docs**, se é exigido na instrução e condição |
| `cfg_Pastas` | subpastas criadas para cada processo |
| `cfg_Fases` | colunas do kanban |
| `cfg_Usuarios` | usuários e papéis |

Blocos da área de trabalho (coluna `blocos`, separados por vírgula):

| Bloco | Conteúdo |
|---|---|
| `A` | formulário de dados |
| `B` | documentos |
| `C` | checklist |
| `D` | solicitação externa (envio/retorno) |
| `E` | cotações |
| `F` | decisão |
| `I` | instrução processual |
| `M` | mapa comparativo |

**Modelos de documento:** crie um Google Docs com marcadores como `{{numero}}`, `{{titulo}}`, `{{objeto}}`, `{{numeroSuite}}`, `{{valorEstimado}}`, `{{dataAtual}}` ou qualquer campo das etapas (ex.: `{{descricaoNecessidade}}`, `{{vigenciaMeses}}`). Depois coloque o ID do arquivo em `cfg_DocumentosTipo.modeloId`.

## Testes

```bash
npm test
```

Esse comando roda os testes de ponta a ponta do back-end (fluxo completo, ramos paralelos, decisões, devoluções, instrução, permissões) com os serviços do Google simulados.

```bash
NODE_PATH=$(npm root -g) node tests/ui-smoke.js
```

Esse é o teste de fumaça da interface no Chromium. Ele exige o Playwright instalado globalmente.
