/**
 * Motor de fluxo (máquina de estados).
 *
 * Lê o modelo de cfg_Etapas / cfg_Transicoes e cria as instâncias em Tarefas.
 *
 *  - TAREFA   : cria tarefa humana. Ao concluir, segue TODAS as transições
 *               cuja condição for verdadeira.
 *  - DECISAO  : tarefa humana que preenche "variavelDecisao". Ao concluir,
 *               segue APENAS a primeira transição verdadeira (gateway exclusivo).
 *  - PARALELO : automático; ativa todas as transições verdadeiras ao mesmo tempo.
 *  - JUNCAO   : automático; cria uma instância "AGUARDANDO" e só avança quando
 *               nenhuma tarefa ativa do processo ainda pode chegar a ela pelo
 *               grafo. Isso funciona com ramos condicionais (ex.: Natureza
 *               contínua = NÃO pula a Justificativa) e com devoluções.
 *  - FIM      : encerra o processo.
 *
 * Devolução: reabre uma etapa anterior (que já foi concluída e que leva à etapa
 * atual pelo grafo) e cancela as tarefas ativas que serão refeitas a partir dela.
 */
var Workflow = {
  LIMITE_PASSOS: 200,

  // ------------------------------------------------------------------ início
  iniciar: function (processo) {
    var fluxo = ConfigService.fluxo(processo.fluxoId);
    this._passos = 0;
    this._ativar(processo, fluxo.etapaInicial, '');
    this.atualizarFase(processo.id);
  },

  // ------------------------------------------------------------------ ações humanas
  /**
   * Conclui a tarefa. Se a etapa produz um documento que é assinado no SUITE,
   * ele é gerado automaticamente a partir dos dados (as assinaturas são
   * cobradas só na instrução processual). Retorna {aviso} se a geração falhar
   * (a etapa é concluída mesmo assim).
   */
  concluir: function (tarefaId, observacao) {
    var t = repo('Tarefas').obterOuFalhar(tarefaId);
    var proc = repo('Processos').obterOuFalhar(t.processoId);
    var etapa = ConfigService.etapa(proc.fluxoId, t.etapaCodigo);
    var soEnvio = ConfigService.blocos(etapa).indexOf('N') >= 0;
    if (t.status === STATUS_TAREFA.AGUARDANDO_RETORNO && !soEnvio) {
      throw Utils.erro('Registre o retorno da solicitação antes de concluir a etapa.');
    }
    if (STATUS_TAREFA_ATIVOS.indexOf(t.status) < 0) throw Utils.erro('Esta tarefa não está aberta (status: ' + t.status + ').');
    this._exigirProcessoAtivo(proc);
    var pend = this.pendencias(t, etapa, proc);
    if (pend.length) throw Utils.erro('Há pendências para concluir a etapa:\n• ' + pend.join('\n• '));

    var aviso = null;
    try {
      DocumentoService.gerarAoConcluir(proc, etapa, t);
    } catch (e) {
      console.error('Geração automática do documento (' + etapa.codigo + '): ' + (e.stack || e));
      aviso = 'A etapa foi concluída, mas o documento não pôde ser gerado automaticamente: ' + (e.message || e) +
        '. Gere-o depois pela aba Documentos ou anexe o PDF.';
      Historico.registrar(proc.id, t.id, 'DOCUMENTO_FALHA', aviso);
    }

    var u = Auth.usuario();
    repo('Tarefas').atualizar(t.id, {
      status: STATUS_TAREFA.CONCLUIDA,
      concluidaEm: Utils.agora(),
      concluidaPor: u.email,
      observacao: observacao || t.observacao
    });
    Historico.registrar(proc.id, t.id, 'ETAPA_CONCLUIDA', t.nome + (observacao ? ' — ' + observacao : ''));
    this._passos = 0;
    this._seguir(proc, t, etapa);
    this.atualizarFase(proc.id);
    return { aviso: aviso };
  },

  devolver: function (tarefaId, destinoCodigo, motivo) {
    if (Utils.vazio(motivo)) throw Utils.erro('Informe o motivo da devolução.');
    var t = repo('Tarefas').obterOuFalhar(tarefaId);
    if (STATUS_TAREFA_ATIVOS.indexOf(t.status) < 0) throw Utils.erro('Só é possível devolver tarefas ativas.');
    var proc = repo('Processos').obterOuFalhar(t.processoId);
    this._exigirProcessoAtivo(proc);
    var permitidos = this.destinosDevolucao(t, proc).map(function (d) { return d.codigo; });
    if (permitidos.indexOf(destinoCodigo) < 0) throw Utils.erro('Destino de devolução inválido para esta etapa.');

    var self = this;
    var refazer = this._alcancaveis(proc.fluxoId, destinoCodigo);
    repo('Tarefas').atualizar(t.id, {
      status: STATUS_TAREFA.DEVOLVIDA, concluidaEm: Utils.agora(),
      concluidaPor: Auth.usuario().email, observacao: motivo
    });
    // Cancela tarefas ativas que serão refeitas a partir do destino
    repo('Tarefas').filtrar(function (x) {
      return x.processoId === proc.id && x.id !== t.id &&
        STATUS_TAREFA_ATIVOS.indexOf(x.status) >= 0 && refazer[x.etapaCodigo];
    }).forEach(function (x) {
      repo('Tarefas').atualizar(x.id, { status: STATUS_TAREFA.CANCELADA, concluidaEm: Utils.agora(), observacao: 'Cancelada por devolução' });
    });
    Historico.registrar(proc.id, t.id, 'ETAPA_DEVOLVIDA',
      t.nome + ' → ' + ConfigService.etapa(proc.fluxoId, destinoCodigo).nome + ' — Motivo: ' + motivo);
    self._passos = 0;
    self._ativar(proc, destinoCodigo, t.id);
    self.atualizarFase(proc.id);
  },

  /** Etapas para as quais a tarefa pode ser devolvida. */
  destinosDevolucao: function (tarefa, proc) {
    var self = this;
    var concluidas = {};
    repo('Tarefas').onde({ processoId: proc.id }).forEach(function (x) {
      if (x.status === STATUS_TAREFA.CONCLUIDA) concluidas[x.etapaCodigo] = true;
    });
    return ConfigService.etapas(proc.fluxoId).filter(function (e) {
      return (e.tipo === TIPO_ETAPA.TAREFA || e.tipo === TIPO_ETAPA.DECISAO) &&
        e.codigo !== tarefa.etapaCodigo && concluidas[e.codigo] &&
        self._alcancaveis(proc.fluxoId, e.codigo)[tarefa.etapaCodigo];
    }).map(function (e) { return { codigo: e.codigo, nome: e.nome }; });
  },

  registrarEnvio: function (tarefaId, referencia, data) {
    var t = repo('Tarefas').obterOuFalhar(tarefaId);
    if (t.status !== STATUS_TAREFA.ABERTA) throw Utils.erro('A tarefa precisa estar aberta para registrar o envio.');
    var proc = repo('Processos').obterOuFalhar(t.processoId);
    // Bloco "N" = somente envio (ex.: CECOC): não fica aguardando retorno
    var soEnvio = ConfigService.blocos(ConfigService.etapa(proc.fluxoId, t.etapaCodigo)).indexOf('N') >= 0;
    repo('Tarefas').atualizar(t.id, {
      status: soEnvio ? STATUS_TAREFA.ABERTA : STATUS_TAREFA.AGUARDANDO_RETORNO,
      enviadoEm: data || Utils.hoje(), referenciaEnvio: referencia || '',
      retornoEm: '', referenciaRetorno: ''
    });
    Historico.registrar(t.processoId, t.id, 'SOLICITACAO_ENVIADA', t.nome + (referencia ? ' — ' + referencia : ''));
  },

  registrarRetorno: function (tarefaId, referencia, data) {
    var t = repo('Tarefas').obterOuFalhar(tarefaId);
    if (t.status !== STATUS_TAREFA.AGUARDANDO_RETORNO) throw Utils.erro('Não há solicitação aguardando retorno nesta tarefa.');
    repo('Tarefas').atualizar(t.id, {
      status: STATUS_TAREFA.ABERTA,
      retornoEm: data || Utils.hoje(), referenciaRetorno: referencia || ''
    });
    Historico.registrar(t.processoId, t.id, 'RETORNO_REGISTRADO', t.nome + (referencia ? ' — ' + referencia : ''));
  },

  atribuir: function (tarefaId, email) {
    var t = repo('Tarefas').obterOuFalhar(tarefaId);
    repo('Tarefas').atualizar(t.id, { responsavelEmail: String(email || '').toLowerCase() });
    Historico.registrar(t.processoId, t.id, 'TAREFA_ATRIBUIDA', t.nome + ' → ' + email);
  },

  // ------------------------------------------------------------------ validações
  /** Lista de pendências (texto) que impedem concluir a tarefa. */
  pendencias: function (tarefa, etapa, proc) {
    var p = [];
    var blocos = ConfigService.blocos(etapa);
    var vars = Variaveis.mapa(proc.id);

    if (blocos.indexOf('A') >= 0) {
      p = p.concat(Campos.pendencias(ConfigService.campos(proc.fluxoId, etapa.codigo), vars));
    }
    if (blocos.indexOf('F') >= 0 && etapa.variavelDecisao && Utils.vazio(vars[etapa.variavelDecisao])) {
      p.push('Registre a decisão: ' + etapa.nome);
    }
    if (blocos.indexOf('C') >= 0) {
      ConfigService.checklist(proc.fluxoId, etapa.codigo).forEach(function (i) {
        if (i.obrigatorio && vars['checklist.' + i.id] !== 'true') p.push('Marque o item do checklist: ' + i.descricao);
      });
    }
    // Documento da etapa: os assinados no SUITE são gerados automaticamente ao concluir
    // (as assinaturas são cobradas na instrução); os demais precisam ser gerados ou anexados.
    if (blocos.indexOf('B') >= 0 && etapa.documentoTipo && !AssinaturaService.exige(etapa.documentoTipo)) {
      var tipo = ConfigService.tipoDocumento(etapa.documentoTipo);
      var aplicavel = !tipo || Condicao.avaliar(tipo.condicao, vars);
      var temDoc = repo('Documentos').filtrar(function (d) {
        return d.processoId === proc.id && d.tipoCodigo === etapa.documentoTipo;
      }).length > 0;
      if (aplicavel && !temDoc) p.push('Gere ou anexe o documento: ' + (tipo ? tipo.nome : etapa.documentoTipo));
    }
    if (blocos.indexOf('D') >= 0 && Utils.vazio(tarefa.retornoEm)) {
      p.push('Registre o envio e o retorno da solicitação');
    }
    if (blocos.indexOf('N') >= 0 && Utils.vazio(tarefa.enviadoEm)) {
      p.push('Registre o envio da solicitação');
    }
    if (blocos.indexOf('E') >= 0) {
      var n = repo('PesquisaPrecos').filtrar(function (c) { return c.processoId === proc.id && c.considerado; }).length;
      if (!n) p.push('Registre ao menos uma cotação considerada na pesquisa de preços');
    }
    if ((blocos.indexOf('E') >= 0 || blocos.indexOf('M') >= 0) && Utils.vazio(vars.justificativaMenos3Cotacoes)) {
      var poucos = PesquisaPrecoService.calcularMapa(proc.id).itens.filter(function (i) { return i.n > 0 && i.n < 3; });
      if (poucos.length) {
        p.push('Preencha o campo "Justificativa para menos de 3 cotações" (itens: ' +
          poucos.map(function (i) { return i.item + ' — ' + i.n; }).join('; ') + ')');
      }
    }
    if (blocos.indexOf('I') >= 0) {
      Instrucao.verificar(proc).forEach(function (i) {
        if (!i.exigido || i.ok) return;
        p.push('Documento obrigatório da instrução: ' + i.nome + (i.assinatura
          ? ' (registre as assinaturas: ' + i.signatarios + ' — botão "Assinar no SUITE" ou anexe o PDF assinado)'
          : i.qtd ? ' (marque como FINAL)' : ''));
      });
    }
    return p;
  },

  /**
   * Próximas etapas que serão abertas ao concluir a etapa (para exibir ao usuário).
   * Atravessa as etapas automáticas (paralelo/junção) e respeita as decisões já registradas.
   */
  proximas: function (fluxoId, codigo, vars) {
    var resultado = [];
    var vistos = {};
    var visitar = function (cod, prof) {
      if (prof > 10) return;
      var e = ConfigService.etapa(fluxoId, cod);
      var validas = ConfigService.transicoesDe(fluxoId, cod).filter(function (t) { return Condicao.avaliar(t.condicao, vars); });
      if (e.tipo === TIPO_ETAPA.DECISAO) validas = validas.slice(0, 1);
      validas.forEach(function (t) {
        var d = ConfigService.etapa(fluxoId, t.destino);
        if (vistos[d.codigo]) return;
        vistos[d.codigo] = true;
        if (d.tipo === TIPO_ETAPA.PARALELO) visitar(d.codigo, prof + 1);
        else if (d.tipo === TIPO_ETAPA.JUNCAO) resultado.push({ codigo: d.codigo, nome: 'Continua após as demais atividades em paralelo', automatica: true });
        else if (d.tipo === TIPO_ETAPA.FIM) resultado.push({ codigo: d.codigo, nome: 'Encerramento do processo', automatica: true });
        else resultado.push({ codigo: d.codigo, nome: d.nome });
      });
    };
    visitar(codigo, 0);
    return resultado;
  },

  // ------------------------------------------------------------------ fase
  atualizarFase: function (processoId) {
    var proc = repo('Processos').obterOuFalhar(processoId);
    var ativas = repo('Tarefas').filtrar(function (t) {
      return t.processoId === processoId &&
        (t.status === STATUS_TAREFA.ABERTA || t.status === STATUS_TAREFA.AGUARDANDO_RETORNO);
    });
    var fase = proc.fase;
    if (proc.status === STATUS_PROCESSO.CONCLUIDO) {
      fase = 'CONCLUIDO';
    } else if (ativas.length) {
      var etapas = ativas.map(function (t) { return ConfigService.etapa(proc.fluxoId, t.etapaCodigo); });
      etapas.sort(function (a, b) { return a.ordem - b.ordem; });
      fase = etapas[0].fase;
    }
    if (fase !== proc.fase) repo('Processos').atualizar(processoId, { fase: fase, atualizadoEm: Utils.agora() });
    else repo('Processos').atualizar(processoId, { atualizadoEm: Utils.agora() });
  },

  // ------------------------------------------------------------------ internos
  _exigirProcessoAtivo: function (proc) {
    if (proc.status !== STATUS_PROCESSO.EM_ANDAMENTO) {
      throw Utils.erro('O processo não está em andamento (status: ' + proc.status + ').');
    }
  },

  _contar: function () {
    this._passos = (this._passos || 0) + 1;
    if (this._passos > this.LIMITE_PASSOS) throw new Error('Laço infinito detectado na configuração do fluxo.');
  },

  _ativar: function (proc, codigo, origemTarefaId) {
    this._contar();
    var et = ConfigService.etapa(proc.fluxoId, codigo);
    switch (et.tipo) {
      case TIPO_ETAPA.TAREFA:
      case TIPO_ETAPA.DECISAO: {
        var t = this._criarTarefa(proc, et, STATUS_TAREFA.ABERTA, origemTarefaId);
        Historico.registrar(proc.id, t.id, 'ETAPA_INICIADA', et.nome);
        Campos.preencherAutomaticos(proc, et.codigo);
        try { Notificacao.tarefaCriada(proc, t); } catch (e) { console.warn('Falha ao notificar: ' + e); }
        return;
      }
      case TIPO_ETAPA.PARALELO: {
        var t2 = this._criarTarefa(proc, et, STATUS_TAREFA.CONCLUIDA, origemTarefaId);
        this._seguir(proc, t2, et);
        return;
      }
      case TIPO_ETAPA.JUNCAO:
        this._chegarJuncao(proc, et, origemTarefaId);
        return;
      case TIPO_ETAPA.FIM: {
        var t3 = this._criarTarefa(proc, et, STATUS_TAREFA.CONCLUIDA, origemTarefaId);
        repo('Processos').atualizar(proc.id, {
          status: STATUS_PROCESSO.CONCLUIDO, concluidoEm: Utils.agora(), fase: 'CONCLUIDO'
        });
        proc.status = STATUS_PROCESSO.CONCLUIDO;
        Historico.registrar(proc.id, t3.id, 'PROCESSO_CONCLUIDO', 'Fluxo encerrado');
        return;
      }
      default:
        throw new Error('Tipo de etapa desconhecido: ' + et.tipo + ' (' + codigo + ')');
    }
  },

  _seguir: function (proc, tarefa, et) {
    var vars = Variaveis.mapa(proc.id);
    var trans = ConfigService.transicoesDe(proc.fluxoId, et.codigo);
    var validas = trans.filter(function (tr) { return Condicao.avaliar(tr.condicao, vars); });
    if (et.tipo === TIPO_ETAPA.DECISAO) validas = validas.slice(0, 1);
    if (!validas.length) {
      throw new Error('Nenhuma transição válida a partir da etapa "' + et.nome + '". Verifique cfg_Transicoes.');
    }
    // Junções por último, para que todos os ramos já existam quando ela for avaliada
    var self = this;
    var tipoDe = function (tr) { return ConfigService.etapa(proc.fluxoId, tr.destino).tipo; };
    validas.sort(function (a, b) {
      return (tipoDe(a) === TIPO_ETAPA.JUNCAO ? 1 : 0) - (tipoDe(b) === TIPO_ETAPA.JUNCAO ? 1 : 0);
    });
    validas.forEach(function (tr) { self._ativar(proc, tr.destino, tarefa.id); });
  },

  _chegarJuncao: function (proc, et, origemTarefaId) {
    var r = repo('Tarefas');
    var inst = r.filtrar(function (t) {
      return t.processoId === proc.id && t.etapaCodigo === et.codigo && t.status === STATUS_TAREFA.AGUARDANDO;
    })[0];
    if (!inst) inst = this._criarTarefa(proc, et, STATUS_TAREFA.AGUARDANDO, origemTarefaId);
    inst = r.atualizar(inst.id, { chegadas: (inst.chegadas || 0) + 1 });

    var self = this;
    var pendentes = r.filtrar(function (t) {
      return t.processoId === proc.id && t.id !== inst.id &&
        STATUS_TAREFA_ATIVOS.indexOf(t.status) >= 0 &&
        self._alcancaveis(proc.fluxoId, t.etapaCodigo)[et.codigo];
    });
    if (pendentes.length) return;
    r.atualizar(inst.id, { status: STATUS_TAREFA.CONCLUIDA, concluidaEm: Utils.agora(), concluidaPor: 'sistema' });
    this._seguir(proc, inst, et);
  },

  _criarTarefa: function (proc, et, status, origemTarefaId) {
    var humana = et.tipo === TIPO_ETAPA.TAREFA || et.tipo === TIPO_ETAPA.DECISAO;
    return repo('Tarefas').inserir({
      processoId: proc.id,
      etapaCodigo: et.codigo,
      nome: et.nome,
      tipo: et.tipo,
      fase: et.fase,
      status: status,
      responsavelEmail: humana ? (proc.responsavelEmail || '') : '',
      setor: et.setor || '',
      criadaEm: Utils.agora(),
      prazo: humana && et.prazoDias ? Utils.somarDiasUteis(null, et.prazoDias) : '',
      concluidaEm: status === STATUS_TAREFA.CONCLUIDA ? Utils.agora() : '',
      concluidaPor: status === STATUS_TAREFA.CONCLUIDA ? 'sistema' : '',
      chegadas: 0,
      origemTarefaId: origemTarefaId || ''
    });
  },

  /** Conjunto (mapa) de etapas alcançáveis a partir de "codigo" (exclusive). */
  _alcancaveis: function (fluxoId, codigo) {
    this._cacheAlc = this._cacheAlc || {};
    var k = fluxoId + '|' + codigo;
    if (this._cacheAlc[k]) return this._cacheAlc[k];
    var visit = {};
    var fila = [codigo];
    while (fila.length) {
      var atual = fila.shift();
      ConfigService.transicoesDe(fluxoId, atual).forEach(function (tr) {
        if (!visit[tr.destino]) { visit[tr.destino] = true; fila.push(tr.destino); }
      });
    }
    this._cacheAlc[k] = visit;
    return visit;
  }
};

/**
 * Checklist da instrução processual: calculado a partir de cfg_DocumentosTipo
 * (exigidoInstrucao + condicao) e dos documentos FINAIS registrados.
 */
var Instrucao = {
  verificar: function (proc) {
    var vars = Variaveis.mapa(proc.id);
    var docs = repo('Documentos').onde({ processoId: proc.id });
    return ConfigService.tiposDocumento().filter(function (t) { return t.exigidoInstrucao; }).map(function (t) {
      var aplicavel = Condicao.avaliar(t.condicao, vars);
      var doTipo = docs.filter(function (d) { return d.tipoCodigo === t.codigo; });
      var finais = doTipo.filter(function (d) { return d.status === 'FINAL'; });
      var assinatura = AssinaturaService.exige(t.codigo);
      return {
        assinatura: assinatura,
        signatarios: assinatura ? AssinaturaService.signatarios(proc, t.codigo).map(function (s) { return s.signatario; }).join(', ') : '',
        codigo: t.codigo,
        nome: t.nome,
        exigido: aplicavel,
        condicao: t.condicao || '',
        qtd: doTipo.length,
        ok: !aplicavel || finais.length > 0
      };
    });
  }
};
