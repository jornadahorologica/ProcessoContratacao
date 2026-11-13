/**
 * Configurações globais, enumerações e esquema das tabelas (abas da planilha).
 *
 * O esquema é a fonte da verdade da estrutura do banco de dados: o setup()
 * cria/atualiza as abas a partir dele. Formato de cada coluna: "nome" ou
 * "nome:tipo", onde tipo é s (texto, padrão), n (número), b (booleano) ou
 * j (JSON).
 */

var APP = {
  NOME: 'Processos de Contratação – CESOP',
  VERSAO: '0.1.0',
  NOME_PLANILHA_BD: 'CESOP - Processos de Contratação (Banco de Dados)',
  NOME_PASTA_RAIZ: '_Processos de CONTRATAÇÃO (Sistema)',
  PREFIXO_NUMERO: 'CESOP',
  CACHE_TTL_SEG: 600,
  // Propriedades do script (Projeto > Configurações > Propriedades do script)
  PROP: {
    DB_ID: 'DB_SPREADSHEET_ID',
    ROOT_FOLDER_ID: 'ROOT_FOLDER_ID',
    NOTIFICAR: 'NOTIFICAR_EMAIL',
    APP_URL: 'APP_URL',
    LIMITE_DESVIO_MAPA: 'LIMITE_DESVIO_MAPA'
  }
};

var STATUS_PROCESSO = {
  EM_ANDAMENTO: 'EM_ANDAMENTO',
  SUSPENSO: 'SUSPENSO',
  CONCLUIDO: 'CONCLUIDO',
  CANCELADO: 'CANCELADO'
};

var STATUS_TAREFA = {
  ABERTA: 'ABERTA',
  AGUARDANDO_RETORNO: 'AGUARDANDO_RETORNO', // solicitação enviada a outro setor
  AGUARDANDO: 'AGUARDANDO',                 // junção esperando os ramos paralelos
  CONCLUIDA: 'CONCLUIDA',
  DEVOLVIDA: 'DEVOLVIDA',
  CANCELADA: 'CANCELADA'
};

/** Status que representam trabalho em aberto. */
var STATUS_TAREFA_ATIVOS = ['ABERTA', 'AGUARDANDO_RETORNO', 'AGUARDANDO'];

var TIPO_ETAPA = {
  TAREFA: 'TAREFA',     // trabalho humano
  DECISAO: 'DECISAO',   // trabalho humano que escolhe UM caminho (gateway exclusivo)
  PARALELO: 'PARALELO', // automático: ativa TODOS os caminhos de saída
  JUNCAO: 'JUNCAO',     // automático: espera até que nenhum ramo ativo ainda possa chegar a ela
  FIM: 'FIM'            // automático: encerra o processo
};

/**
 * Blocos que compõem a área de trabalho de uma etapa (coluna "blocos" de cfg_Etapas).
 */
var BLOCOS = {
  A: 'Formulário de dados',
  B: 'Documentos',
  C: 'Checklist',
  D: 'Solicitação externa (envio/retorno)',
  E: 'Cotações (pesquisa de preços)',
  F: 'Decisão',
  I: 'Instrução processual (checklist de documentos)',
  M: 'Mapa comparativo de preços'
};

var PAPEIS = {
  ADMIN: 'ADMIN',       // tudo, inclusive administração
  GESTOR: 'GESTOR',     // opera qualquer processo, cancela/suspende
  ANALISTA: 'ANALISTA', // opera processos e tarefas
  CONSULTA: 'CONSULTA'  // somente leitura
};

var SCHEMA = {
  // ---------------------------------------------------------------- Configuração
  cfg_Fluxos: ['id', 'nome', 'descricao', 'etapaInicial', 'ativo:b'],
  cfg_Etapas: ['id', 'fluxoId', 'codigo', 'ordem:n', 'nome', 'fase', 'tipo', 'setor', 'prazoDias:n',
    'blocos', 'documentoTipo', 'variavelDecisao', 'opcoesDecisao', 'descricao'],
  cfg_Transicoes: ['id', 'fluxoId', 'origem', 'destino', 'condicao', 'ordem:n', 'rotulo'],
  cfg_Campos: ['id', 'fluxoId', 'etapaCodigo', 'chave', 'rotulo', 'tipo', 'obrigatorio:b', 'opcoes', 'ajuda', 'ordem:n'],
  cfg_ChecklistItens: ['id', 'fluxoId', 'etapaCodigo', 'descricao', 'obrigatorio:b', 'ordem:n'],
  cfg_DocumentosTipo: ['codigo', 'nome', 'pasta', 'modeloId', 'exigidoInstrucao:b', 'condicao', 'ordem:n'],
  cfg_Pastas: ['id', 'fluxoId', 'nome', 'ordem:n'],
  cfg_Fases: ['codigo', 'nome', 'ordem:n'],
  cfg_Usuarios: ['email', 'nome', 'setor', 'papel', 'ativo:b'],

  // ---------------------------------------------------------------- Operação
  Processos: ['id', 'numero', 'titulo', 'objeto', 'fluxoId', 'numeroSuite', 'status', 'fase',
    'setorDemandante', 'responsavelEmail', 'valorEstimado:n', 'pastaId', 'pastaUrl', 'pastas:j',
    'criadoEm', 'criadoPor', 'atualizadoEm', 'concluidoEm'],
  Tarefas: ['id', 'processoId', 'etapaCodigo', 'nome', 'tipo', 'fase', 'status', 'responsavelEmail',
    'setor', 'criadaEm', 'prazo', 'concluidaEm', 'concluidaPor', 'chegadas:n', 'origemTarefaId',
    'enviadoEm', 'referenciaEnvio', 'retornoEm', 'referenciaRetorno', 'observacao'],
  Variaveis: ['id', 'processoId', 'chave', 'valor', 'etapaCodigo', 'atualizadoEm', 'atualizadoPor'],
  Documentos: ['id', 'processoId', 'tarefaId', 'etapaCodigo', 'tipoCodigo', 'nome', 'fileId', 'url',
    'mimeType', 'origem', 'status', 'versao:n', 'criadoEm', 'criadoPor'],
  PesquisaPrecos: ['id', 'processoId', 'item', 'descricao', 'unidade', 'quantidade:n', 'fonte',
    'fornecedor', 'cnpj', 'valorUnitario:n', 'dataCotacao', 'referencia', 'considerado:b',
    'observacao', 'criadoEm', 'criadoPor'],
  Diligencias: ['id', 'processoId', 'numeroDespacho', 'origem', 'assunto', 'recebidoEm', 'prazo',
    'status', 'respondidoEm', 'documentoId', 'resposta', 'criadoEm', 'criadoPor'],
  Historico: ['id', 'processoId', 'tarefaId', 'dataHora', 'usuario', 'acao', 'detalhe']
};

/** Abas de configuração (lidas em bloco e guardadas em cache). */
var TABELAS_CONFIG = ['cfg_Fluxos', 'cfg_Etapas', 'cfg_Transicoes', 'cfg_Campos',
  'cfg_ChecklistItens', 'cfg_DocumentosTipo', 'cfg_Pastas', 'cfg_Fases', 'cfg_Usuarios'];
