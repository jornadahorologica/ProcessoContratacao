/**
 * Autenticação e autorização.
 *
 * O Web App é publicado como "Executar como: eu" (conta institucional dona
 * da planilha e da pasta raiz). O usuário é identificado pelo e-mail
 * (Session.getActiveUser) e precisa estar ativo na aba cfg_Usuarios.
 * Assim os usuários não precisam de acesso direto à planilha do banco.
 */
var Auth = {
  _usuario: null,

  email: function () {
    var e = '';
    try { e = Session.getActiveUser().getEmail(); } catch (err) { e = ''; }
    return String(e || '').trim().toLowerCase();
  },

  usuario: function () {
    if (this._usuario) return this._usuario;
    var email = this.email();
    if (!email) {
      throw Utils.erro('Não foi possível identificar seu e-mail. Acesse com sua conta institucional.');
    }
    var u = ConfigService.usuarios().filter(function (x) {
      return String(x.email).trim().toLowerCase() === email && x.ativo;
    })[0];
    if (!u) throw Utils.erro('Acesso não autorizado para ' + email + '. Solicite cadastro ao administrador.');
    this._usuario = { email: email, nome: u.nome || email, setor: u.setor, papel: u.papel || PAPEIS.CONSULTA };
    return this._usuario;
  },

  exigir: function (papeis) {
    var u = this.usuario();
    if (papeis.indexOf(u.papel) < 0) throw Utils.erro('Você não tem permissão para esta operação.');
    return u;
  },

  exigirLeitura: function () {
    return this.usuario();
  },

  exigirEdicao: function () {
    return this.exigir([PAPEIS.ADMIN, PAPEIS.GESTOR, PAPEIS.ANALISTA]);
  },

  exigirGestao: function () {
    return this.exigir([PAPEIS.ADMIN, PAPEIS.GESTOR]);
  },

  exigirAdmin: function () {
    return this.exigir([PAPEIS.ADMIN]);
  }
};
