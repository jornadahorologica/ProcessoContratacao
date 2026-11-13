/**
 * Notificações por e-mail. Desligadas por padrão: defina a propriedade do
 * script NOTIFICAR_EMAIL = true para ativar. APP_URL deve conter a URL do
 * Web App publicado (para o link no e-mail).
 */
var Notificacao = {
  ativa: function () {
    return String(PropertiesService.getScriptProperties().getProperty(APP.PROP.NOTIFICAR)).toLowerCase() === 'true';
  },

  link: function () {
    return PropertiesService.getScriptProperties().getProperty(APP.PROP.APP_URL) || '';
  },

  tarefaCriada: function (proc, tarefa) {
    if (!this.ativa() || !tarefa.responsavelEmail) return;
    MailApp.sendEmail({
      to: tarefa.responsavelEmail,
      subject: '[' + proc.numero + '] Nova etapa: ' + tarefa.nome,
      htmlBody: '<p>O processo <b>' + proc.numero + ' — ' + proc.titulo + '</b> chegou à etapa <b>' +
        tarefa.nome + '</b>' + (tarefa.prazo ? ' (prazo: ' + tarefa.prazo + ')' : '') + '.</p>' +
        (this.link() ? '<p><a href="' + this.link() + '">Abrir o sistema</a></p>' : '')
    });
  },

  /** Resumo diário de tarefas e diligências vencidas ou que vencem em até 2 dias. Use com gatilho diário. */
  resumoDiario: function () {
    if (!this.ativa()) return;
    var hoje = Utils.hoje();
    var limite = Utils.somarDiasUteis(null, 2);
    var porPessoa = {};
    var add = function (email, linha) { if (email) (porPessoa[email] = porPessoa[email] || []).push(linha); };
    var procs = {};
    repo('Processos').todos().forEach(function (p) { procs[p.id] = p; });

    repo('Tarefas').filtrar(function (t) {
      return (t.status === STATUS_TAREFA.ABERTA || t.status === STATUS_TAREFA.AGUARDANDO_RETORNO) &&
        t.prazo && t.prazo <= limite;
    }).forEach(function (t) {
      var p = procs[t.processoId];
      if (!p || p.status !== STATUS_PROCESSO.EM_ANDAMENTO) return;
      add(t.responsavelEmail, (t.prazo < hoje ? '🔴 VENCIDA' : '🟡 vence') + ' ' + t.prazo + ' — ' + p.numero + ' — ' + t.nome);
    });
    repo('Diligencias').filtrar(function (d) { return d.status === 'ABERTA' && d.prazo && d.prazo <= limite; })
      .forEach(function (d) {
        var p = procs[d.processoId];
        if (p) add(p.responsavelEmail, '📄 Diligência ' + d.numeroDespacho + ' — prazo ' + d.prazo + ' — ' + p.numero);
      });

    var link = this.link();
    Object.keys(porPessoa).forEach(function (email) {
      MailApp.sendEmail({
        to: email,
        subject: 'Processos de contratação — prazos (' + hoje + ')',
        htmlBody: '<p>Itens com prazo vencido ou próximo:</p><ul><li>' + porPessoa[email].join('</li><li>') +
          '</li></ul>' + (link ? '<p><a href="' + link + '">Abrir o sistema</a></p>' : '')
      });
    });
  }
};

/** Função para o gatilho diário (criada por instalarGatilhos()). */
function rotinaDiaria() {
  Notificacao.resumoDiario();
}
