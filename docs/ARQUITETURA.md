# Arquitetura

## Visão geral

```
┌──────────────────────────────────────────────────────────┐
│ UI – Web App (HtmlService, SPA em JS puro)  Index/App      │
└───────────────▲──────────────────────────────────────────┘
                │ google.script.run → apiCall(metodo, args)
┌───────────────┴──────────────────────────────────────────┐
│ API (90_Api.js): lista branca, permissão, lock, erros    │
├──────────────────────────────────────────────────────────┤
│ Serviços: Workflow · Processo · Documento · Drive ·      │
│ PesquisaPreco · Diligencia · Notificacao · Historico     │
├──────────────────────────────────────────────────────────┤
│ Repositório (02_Repository.js) + ConfigService (cache)   │
└───────────────▲───────────────────────▲──────────────────┘
        Google Sheets (dados)     Google Drive / Docs (arquivos)
```

**Princípios**

1. **O fluxo fica na configuração, não no código.** O motor (`10_Workflow.js`) é genérico e lê `cfg_Etapas` e `cfg_Transicoes`. Para mudar o processo, edita-se a planilha.
2. **O Sheets guarda dados e o Drive guarda arquivos.** A planilha registra apenas `fileId` e URL.
3. **Tudo é gravado como texto.** As colunas são formatadas com `@` e os tipos (número, booleano, JSON) são convertidos no repositório, para evitar as conversões automáticas do Sheets.
4. **Há uma única porta de entrada:** `apiCall`. Ela concentra autorização (`L`/`E`/`G`/`A`), o `LockService` nas escritas e o tratamento de erros.
5. **A auditoria só aceita inclusões.** Toda ação relevante gera uma linha em `Historico`.

## Motor de fluxo

| Tipo | Comportamento |
|---|---|
| `TAREFA` | Cria uma tarefa humana. Ao concluir, segue **todas** as transições cuja condição for verdadeira. |
| `DECISAO` | Tarefa humana que preenche `variavelDecisao` e segue **apenas a primeira** transição verdadeira. |
| `PARALELO` | Automático. Ativa todas as saídas ao mesmo tempo. |
| `JUNCAO` | Automático. Avança quando **nenhuma tarefa ativa do processo ainda pode alcançá-la** pelo grafo. Funciona com ramos condicionais (Natureza contínua = NÃO pula a Justificativa) e com devoluções, sem precisar configurar quantos ramos há. |
| `FIM` | Encerra o processo. |

**Pendências para concluir uma etapa**, calculadas pelos blocos da etapa:

- campos obrigatórios preenchidos;
- itens obrigatórios do checklist marcados;
- documento do tipo esperado existente;
- retorno registrado (bloco D);
- decisão registrada (bloco F);
- ao menos uma cotação considerada (bloco E);
- documentos da instrução marcados como FINAL (bloco I).

**Devolução:** só é permitido devolver para etapas já concluídas que levam à etapa atual pelo grafo. As tarefas ativas que serão refeitas a partir do destino são canceladas e o motivo é obrigatório.

## Modelo de dados

| Aba | Conteúdo |
|---|---|
| `cfg_*` | configuração (fluxo, campos, checklist, tipos de documento, pastas, fases, usuários) |
| `Processos` | um registro por processo (número `CESOP-AAAA-NNN`, status, fase, pasta no Drive) |
| `Tarefas` | instâncias das etapas (status, responsável, prazo, envio/retorno) |
| `Variaveis` | dados chave-valor das etapas e marcações de checklist |
| `Documentos` | arquivos do processo (tipo, versão, RASCUNHO/FINAL, origem) |
| `PesquisaPrecos` | cotações |
| `Diligencias` | despachos recebidos e respostas |
| `Historico` | auditoria |

## Fluxo da CESOP (carga inicial em `80_Seed.js`)

```
ABRIR_SUITE → DFD → CONSULTA_ETICE → ETP → PARALELO_1
   ├─ NATUREZA ─(SIM)→ JUSTIFICATIVA ─┐
   │           └(NÃO)─────────────────┤
   ├─ COD_ITEM ───────────────────────┤
   └─ PESQUISA_PRECO → MAPA_PRECOS → MODALIDADE ─┤
                                     JUNCAO_1 → TR → DOTACAO → BID
   BID ─(SIM)→ BID_TRAMITE ─┐
       └(NÃO)───────────────┴→ PRE_RESERVA → INSTRUCAO → ANALISE_PROPOSTA → PARECER → FIM
```

## Pontos a validar com a área

- **Ramo BID = SIM:** não aparece no fluxograma. Foi modelado como "Tramitação BID (não objeção)" antes da pré-reserva.
- **Outras raias (ETICE, CECOC, Orçamento):** hoje entram como *solicitações externas* (bloco D). Se esses setores forem usar o sistema, as etapas deles passam a ser tarefas com `setor` próprio.
- **Prazos e setores** de cada etapa: os valores iniciais são estimativas e devem ser ajustados em `cfg_Etapas`.
- **Modelos Google Docs** de DFD, ETP, TR, Justificativa e demais: cadastrar em `cfg_DocumentosTipo.modeloId`.
- **SUITE:** não há integração. O número SUITE é informado manualmente.

## Limites do Apps Script considerados

- **Tempo de execução:** 6 min por chamada. As operações são curtas e há um único carregamento da aba por execução.
- **Concorrência:** escritas serializadas com `LockService`.
- **Configuração:** fica no `CacheService` (10 min). O botão "Recarregar configuração" invalida esse cache.
- **Uploads:** até cerca de 40 MB por arquivo via `google.script.run`. Para arquivos maiores, use a opção "vincular arquivo do Drive".
- **Volume:** dezenas ou centenas de processos por ano cabem com folga no limite de 10 milhões de células.
