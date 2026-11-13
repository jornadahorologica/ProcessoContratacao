/**
 * Avaliador de condições usado nas transições e nos documentos condicionais.
 *
 * Sintaxe (sem eval, para segurança):
 *   vazio                         -> sempre verdadeiro
 *   naturezaContinua == SIM
 *   bid != SIM
 *   contratadaEtice == SIM && bid == NAO
 *   modalidade == A || modalidade == B
 * Comparação sem diferenciar maiúsculas/minúsculas, espaços e aspas.
 */
var Condicao = {
  avaliar: function (expr, vars) {
    if (Utils.vazio(expr)) return true;
    var normalizar = function (v) {
      return String(v === null || v === undefined ? '' : v).trim().replace(/^["']|["']$/g, '').toUpperCase();
    };
    return String(expr).split('||').some(function (ou) {
      return ou.split('&&').every(function (termo) {
        var m = termo.trim().match(/^([\w.]+)\s*(==|!=)\s*(.*)$/);
        if (!m) throw Utils.erro('Condição inválida: "' + termo.trim() + '"');
        var atual = normalizar(vars[m[1]]);
        var esperado = normalizar(m[3]);
        return m[2] === '==' ? atual === esperado : atual !== esperado;
      });
    });
  }
};
