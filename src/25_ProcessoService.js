/**
 * Processos de contratação: abertura, consulta, painel e dados da área de
 * trabalho das etapas.
 */
var ProcessoService = {
  criar: function (d) {
    if (Utils.vazio(d.titulo)) throw Utils.erro('Informe o título do processo.');
    if (Utils.vazio(d.objeto)) throw Utils.erro('Informe o objeto da contratação.');
    var fluxoId = d.fluxoId || (ConfigService.fluxos()[0] || {}).id;
    ConfigService.fluxo(fluxoId);
    var u = Auth.usuario();

    var proc = (function () {
      var ano = new Date().getFullYear();
      var prefixo = APP.PREFIXO_NUMERO + '-' + ano + '-';
      var seq = 0;
      repo('Processos').todos().forEach(function (p) {
        if (String(p.numero).indexOf(prefixo) === 0) seq = Math.max(seq, Number(p.numero.substring(prefixo.length)) || 0);
      });
      return repo('Processos').inserir({
        numero: prefixo + ('00' + (seq + 1)).slice(-3),
        titulo: String(d.titulo).trim(),
        objeto: String(d.objeto).trim(),
        fluxoId: fluxoId,
        numeroSuite: d.numeroSuite || '',
        status: STATUS_PROCESSO.EM_ANDAMENTO,
        fase: '',
        setorDemandante: d.setorDemandante || '',
        responsavelEmail: String(d.responsavelEmail || u.email).toLowerCase(),
        responsavelTecnico: Utils.vazio(d.responsavelTecnico) ? APP.RESPONSAVEL_TECNICO_PADRAO : String(d.responsavelTecnico).trim(),
        valorEstimado: null,
        criadoEm: Utils.agora(),
        criadoPor: u.email,
        atualizadoEm: Utils.agora()
      });
    })();

    var pastas = DriveService.criarPastasProcesso(proc);
    proc = repo('Processos').atualizar(proc.id, pastas);
    DriveService.compartilhar([proc.pastaId], DriveService.emailsAtivos());
    Historico.registrar(proc.id, '', 'PROCESSO_CRIADO', proc.numero + ' — ' + proc.titulo);
    if (d.numeroSuite) Variaveis.definir(proc.id, 'numeroSuite', d.numeroSuite, 'ABRIR_SUITE');
    if (d.dataAberturaSuite) Variaveis.definir(proc.id, 'dataAberturaSuite', d.dataAberturaSuite, 'ABRIR_SUITE');
    Workflow.iniciar(proc);
    // NUP e data já informados: a etapa "Abrir processo SUITE" é concluída automaticamente
    if (d.numeroSuite && d.dataAberturaSuite) {
      var t = repo('Tarefas').filtrar(function (x) {
        return x.processoId === proc.id && x.etapaCodigo === 'ABRIR_SUITE' && x.status === STATUS_TAREFA.ABERTA;
      })[0];
      var etapa = t && ConfigService.etapa(proc.fluxoId, 'ABRIR_SUITE');
      if (t && !Workflow.pendencias(t, etapa, repo('Processos').obter(proc.id)).length) {
        Workflow.concluir(t.id, 'Concluída automaticamente: NUP e data de abertura informados na criação do processo.');
      }
    }
    return repo('Processos').obter(proc.id);
  },

  atualizar: function (id, d) {
    var permitidos = ['titulo', 'objeto', 'numeroSuite', 'setorDemandante', 'responsavelEmail', 'responsavelTecnico'];
    var alt = { atualizadoEm: Utils.agora() };
    permitidos.forEach(function (k) { if (d[k] !== undefined) alt[k] = d[k]; });
    var p = repo('Processos').atualizar(id, alt);
    if (d.numeroSuite !== undefined) Variaveis.definir(id, 'numeroSuite', d.numeroSuite, '');
    Historico.registrar(id, '', 'PROCESSO_ATUALIZADO', Object.keys(alt).join(', '));
    return p;
  },

  alterarStatus: function (id, status, motivo) {
    var p = repo('Processos').obterOuFalhar(id);
    var permitidas = {
      EM_ANDAMENTO: ['SUSPENSO', 'CANCELADO'],
      SUSPENSO: ['EM_ANDAMENTO', 'CANCELADO'],
      CONCLUIDO: [],
      CANCELADO: []
    };
    var alvo = status;
    if ((permitidas[p.status] || []).indexOf(alvo) < 0) throw Utils.erro('Mudança de status não permitida.');
    if (Utils.vazio(motivo)) throw Utils.erro('Informe o motivo.');
    repo('Processos').atualizar(id, { status: alvo, atualizadoEm: Utils.agora() });
    if (alvo === 'CANCELADO') {
      repo('Tarefas').filtrar(function (t) { return t.processoId === id && STATUS_TAREFA_ATIVOS.indexOf(t.status) >= 0; })
        .forEach(function (t) { repo('Tarefas').atualizar(t.id, { status: STATUS_TAREFA.CANCELADA, observacao: 'Processo cancelado' }); });
    }
    Historico.registrar(id, '', 'PROCESSO_' + alvo, motivo);
    return repo('Processos').obter(id);
  },

  /** Lista resumida para tabelas e kanban. */
  listar: function (filtro) {
    filtro = filtro || {};
    var tarefasAtivas = Utils.agrupar(repo('Tarefas').filtrar(function (t) {
      return t.status === STATUS_TAREFA.ABERTA || t.status === STATUS_TAREFA.AGUARDANDO_RETORNO;
    }), function (t) { return t.processoId; });
    var hoje = Utils.hoje();
    var texto = String(filtro.texto || '').toLowerCase();
    return repo('Processos').todos().filter(function (p) {
      if (filtro.status && p.status !== filtro.status) return false;
      if (texto && (p.numero + ' ' + p.titulo + ' ' + p.objeto + ' ' + p.numeroSuite).toLowerCase().indexOf(texto) < 0) return false;
      return true;
    }).map(function (p) {
      var ativas = tarefasAtivas[p.id] || [];
      return {
        id: p.id, numero: p.numero, titulo: p.titulo, status: p.status, fase: p.fase,
        numeroSuite: p.numeroSuite, responsavelEmail: p.responsavelEmail, responsavelTecnico: p.responsavelTecnico, valorEstimado: p.valorEstimado,
        atualizadoEm: p.atualizadoEm, pastaUrl: p.pastaUrl,
        etapasAtuais: ativas.map(function (t) { return { id: t.id, nome: t.nome, status: t.status, prazo: t.prazo }; }),
        atrasado: ativas.some(function (t) { return t.prazo && t.prazo < hoje; }),
        aguardandoRetorno: ativas.some(function (t) { return t.status === STATUS_TAREFA.AGUARDANDO_RETORNO; })
      };
    }).sort(function (a, b) { return a.numero < b.numero ? 1 : -1; });
  },

  painel: function () {
    var u = Auth.usuario();
    var hoje = Utils.hoje();
    var procs = {};
    repo('Processos').todos().forEach(function (p) { procs[p.id] = p; });
    var ativas = repo('Tarefas').filtrar(function (t) {
      var p = procs[t.processoId];
      return p && p.status === STATUS_PROCESSO.EM_ANDAMENTO &&
        (t.status === STATUS_TAREFA.ABERTA || t.status === STATUS_TAREFA.AGUARDANDO_RETORNO);
    });
    var resumo = function (t) {
      var p = procs[t.processoId];
      return {
        id: t.id, nome: t.nome, status: t.status, prazo: t.prazo, processoId: p.id, numero: p.numero,
        titulo: p.titulo, responsavelEmail: t.responsavelEmail, enviadoEm: t.enviadoEm,
        diasAguardando: t.enviadoEm ? Utils.diasEntre(t.enviadoEm, hoje) : null,
        atrasada: !!(t.prazo && t.prazo < hoje)
      };
    };
    var diligencias = repo('Diligencias').filtrar(function (d) {
      return d.status === 'ABERTA' && procs[d.processoId];
    }).map(function (d) {
      return { id: d.id, numeroDespacho: d.numeroDespacho, prazo: d.prazo, processoId: d.processoId,
        numero: procs[d.processoId].numero, atrasada: !!(d.prazo && d.prazo < hoje) };
    });
    var lista = this.listar({ status: STATUS_PROCESSO.EM_ANDAMENTO });
    return {
      indicadores: {
        emAndamento: lista.length,
        minhasTarefas: ativas.filter(function (t) { return t.responsavelEmail === u.email; }).length,
        aguardandoRetorno: ativas.filter(function (t) { return t.status === STATUS_TAREFA.AGUARDANDO_RETORNO; }).length,
        atrasadas: ativas.filter(function (t) { return t.prazo && t.prazo < hoje; }).length,
        diligenciasAbertas: diligencias.length
      },
      minhasTarefas: ativas.filter(function (t) { return t.responsavelEmail === u.email; }).map(resumo)
        .sort(function (a, b) { return (a.prazo || '9') < (b.prazo || '9') ? -1 : 1; }),
      aguardandoRetorno: ativas.filter(function (t) { return t.status === STATUS_TAREFA.AGUARDANDO_RETORNO; }).map(resumo)
        .sort(function (a, b) { return (b.diasAguardando || 0) - (a.diasAguardando || 0); }),
      diligencias: diligencias,
      processos: lista
    };
  },

  /** Tudo o que a tela de detalhe precisa, em uma única chamada. */
  /** Aceita o id interno ou o número do processo (ex.: CESOP-2026-001, usado nas URLs). */
  resolver: function (idOuNumero) {
    var r = repo('Processos');
    var p = r.obter(idOuNumero) || r.filtrar(function (x) {
      return String(x.numero).toUpperCase() === String(idOuNumero || '').toUpperCase();
    })[0];
    if (!p) throw Utils.erro('Processo não encontrado: ' + idOuNumero);
    return p;
  },

  detalhar: function (idOuNumero) {
    var p = this.resolver(idOuNumero);
    var id = p.id;
    var tarefas = repo('Tarefas').onde({ processoId: id });
    tarefas.sort(function (a, b) { return a.criadaEm < b.criadaEm ? -1 : 1; });
    var porEtapa = Utils.agrupar(tarefas, function (t) { return t.etapaCodigo; });
    var linhaDoTempo = ConfigService.etapas(p.fluxoId).filter(function (e) {
      return e.tipo === TIPO_ETAPA.TAREFA || e.tipo === TIPO_ETAPA.DECISAO;
    }).map(function (e) {
      var inst = porEtapa[e.codigo] || [];
      var ultima = inst[inst.length - 1] || null;
      return {
        codigo: e.codigo, nome: e.nome, fase: e.fase, setor: e.setor, ordem: e.ordem,
        status: ultima ? ultima.status : 'NAO_INICIADA',
        tarefaId: ultima ? ultima.id : '',
        prazo: ultima ? ultima.prazo : '',
        concluidaEm: ultima ? ultima.concluidaEm : '',
        instancias: inst.length
      };
    });
    return {
      processo: p,
      linhaDoTempo: linhaDoTempo,
      tarefas: tarefas,
      variaveis: Variaveis.mapa(id),
      documentos: DocumentoService.listar(id),
      assinaturas: AssinaturaService.listar(id),
      diligencias: DiligenciaService.listar(id),
      instrucao: Instrucao.verificar(p)
    };
  },

  /**
   * Tudo o que a tela do processo precisa numa única chamada: detalhe + área
   * de trabalho da etapa selecionada (op.tarefaId, op.etapa = código da etapa
   * vindo da URL, ou automaticamente a etapa atual).
   */
  tela: function (idOuNumero, op) {
    op = op || {};
    var det = this.detalhar(idOuNumero);
    var humanas = det.tarefas.filter(function (t) { return t.tipo === TIPO_ETAPA.TAREFA || t.tipo === TIPO_ETAPA.DECISAO; });
    var sel = null, auto = false, etapaNaoIniciada = '';
    if (op.tarefaId) sel = humanas.filter(function (t) { return t.id === op.tarefaId; })[0] || null;
    if (!sel && op.etapa) {
      sel = humanas.filter(function (t) { return t.etapaCodigo === op.etapa; }).slice(-1)[0] || null;
      if (!sel) etapaNaoIniciada = op.etapa;
    }
    if (!sel) {
      auto = true;
      sel = humanas.filter(function (t) { return t.status === STATUS_TAREFA.ABERTA || t.status === STATUS_TAREFA.AGUARDANDO_RETORNO; })[0] ||
        humanas.slice(-1)[0] || null;
    }
    return {
      detalhe: det,
      tarefaId: sel ? sel.id : null,
      tarefa: sel && (op.aba || 'fluxo') === 'fluxo' ? this.abrirTarefa(sel.id) : null,
      auto: auto,
      etapaNaoIniciada: etapaNaoIniciada
    };
  },

  historico: function (idOuNumero) {
    return Historico.listar(this.resolver(idOuNumero).id, 300);
  },

  /** Dados da área de trabalho de uma tarefa (blocos configurados). */
  abrirTarefa: function (tarefaId) {
    var t = repo('Tarefas').obterOuFalhar(tarefaId);
    var p = repo('Processos').obterOuFalhar(t.processoId);
    var etapa = ConfigService.etapa(p.fluxoId, t.etapaCodigo);
    var blocos = ConfigService.blocos(etapa);
    var vars = Variaveis.mapa(p.id);
    var r = {
      tarefa: t,
      etapa: etapa,
      blocos: blocos,
      processo: { id: p.id, numero: p.numero, titulo: p.titulo, status: p.status },
      campos: ConfigService.campos(p.fluxoId, etapa.codigo),
      checklist: ConfigService.checklist(p.fluxoId, etapa.codigo).map(function (i) {
        return { id: i.id, descricao: i.descricao, obrigatorio: i.obrigatorio, marcado: vars['checklist.' + i.id] === 'true' };
      }),
      valores: vars,
      documentos: repo('Documentos').filtrar(function (d) {
        return d.processoId === p.id && (d.tarefaId === t.id || (etapa.documentoTipo && d.tipoCodigo === etapa.documentoTipo));
      }),
      decisao: etapa.variavelDecisao ? { variavel: etapa.variavelDecisao, opcoes: Utils.csv(etapa.opcoesDecisao) } : null,
      ativa: STATUS_TAREFA_ATIVOS.indexOf(t.status) >= 0 && p.status === STATUS_PROCESSO.EM_ANDAMENTO,
      pendencias: [],
      destinosDevolucao: []
    };
    r.assinaturas = AssinaturaService.listar(p.id);
    r.sugestoes = r.ativa ? Campos.sugestoes(p, r.campos, vars) : {};
    if (r.ativa) {
      r.proximas = Workflow.proximas(p.fluxoId, etapa.codigo, vars);
      r.pendencias = Workflow.pendencias(t, etapa, p);
      r.destinosDevolucao = Workflow.destinosDevolucao(t, p);
    }
    if (blocos.indexOf('E') >= 0) {
      r.cotacoes = PesquisaPrecoService.listar(p.id);
      r.fontes = PesquisaPrecoService.FONTES;
      r.itensCotados = PesquisaPrecoService.itens(p.id);
    }
    if (blocos.indexOf('M') >= 0) {
      r.mapa = PesquisaPrecoService.calcularMapa(p.id, vars.metodoEstimativa);
      r.contratacaoDireta = vars.contratadaEtice === 'SIM';
    }
    if (blocos.indexOf('I') >= 0) r.instrucao = Instrucao.verificar(p);
    return r;
  },

  salvarCampos: function (tarefaId, valores) {
    var t = repo('Tarefas').obterOuFalhar(tarefaId);
    if (STATUS_TAREFA_ATIVOS.indexOf(t.status) < 0) throw Utils.erro('A tarefa não está ativa.');
    var p = repo('Processos').obterOuFalhar(t.processoId);
    var etapa = ConfigService.etapa(p.fluxoId, t.etapaCodigo);
    var permitidas = {};
    ConfigService.campos(p.fluxoId, etapa.codigo).forEach(function (c) {
      permitidas[c.chave] = c;
      if (Campos.permiteNsa(c)) permitidas[c.chave + Campos.SUFIXO_NSA] = { chave: c.chave + Campos.SUFIXO_NSA, tipo: 'nsa' };
    });
    if (etapa.variavelDecisao) permitidas[etapa.variavelDecisao] = { chave: etapa.variavelDecisao };
    var aceitos = {};
    Object.keys(valores || {}).forEach(function (k) {
      if (!permitidas[k]) return;
      var v = valores[k];
      if (permitidas[k].tipo === 'nsa') v = v === true || v === 'true' ? 'true' : 'false';
      if (permitidas[k].tipo === 'inteiro') {
        var bruto = String(v === null || v === undefined ? '' : v).replace(/[.\s]/g, '');
        if (bruto !== '' && !/^\d+$/.test(bruto)) throw Utils.erro('O campo "' + permitidas[k].rotulo + '" aceita somente números inteiros.');
        v = bruto === '' ? '' : Number(bruto);
      }
      if (permitidas[k].tipo === 'moeda' || permitidas[k].tipo === 'numero') {
        var n = daCelula_(v, 'n');
        v = n === null ? '' : n;
      }
      aceitos[k] = v;
    });
    Variaveis.definirVarias(p.id, aceitos, etapa.codigo);
    if (aceitos.numeroSuite !== undefined) repo('Processos').atualizar(p.id, { numeroSuite: aceitos.numeroSuite });
    // Valor estimado da solução (ETP) passa a ser o valor estimado do processo
    if (aceitos.valorEstimadoEtp !== undefined && aceitos.valorEstimadoEtp !== '') {
      repo('Processos').atualizar(p.id, { valorEstimado: aceitos.valorEstimadoEtp, atualizadoEm: Utils.agora() });
    }
    Historico.registrar(p.id, t.id, 'DADOS_SALVOS', etapa.nome + ': ' + Object.keys(aceitos).join(', '));
    return true;
  },

  marcarChecklist: function (tarefaId, itemId, marcado) {
    var t = repo('Tarefas').obterOuFalhar(tarefaId);
    if (STATUS_TAREFA_ATIVOS.indexOf(t.status) < 0) throw Utils.erro('A tarefa não está ativa.');
    Variaveis.definir(t.processoId, 'checklist.' + itemId, marcado ? 'true' : 'false', t.etapaCodigo);
    return true;
  }
};
