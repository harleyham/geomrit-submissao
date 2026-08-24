const { db } = require('../db');

// Autorização para operações críticas (reset de banco, backup/restauração,
// switch global de e-mails). Antes de aceitar, confirmamos no banco que a
// sessão corresponde ao super-admin real: conta ativa, aprovada, com a senha
// já trocada e marcada como super-admin — e não apenas ao valor de
// session.userEmail (que poderia ter sido obtido por fixation/steal de sessão).
function isRealSuperAdmin(req) {
  if (!req.session || !req.session.userId || !req.session.isAdmin) {
    return false;
  }
  const user = db
    .prepare('SELECT id, email, is_public, is_admin, approval_status, password_changed FROM users WHERE id = ?')
    .get(req.session.userId);
  if (!user) {
    return false;
  }
  const emailOk = user.email === 'admin@admin.com';
  const active = user.is_public === 1;
  const approved = user.approval_status !== 'pending';
  const passwordSet = user.password_changed === 1;
  return active && approved && passwordSet && user.is_admin === 1 && emailOk;
}

function requireSuperAdmin(req, res, next) {
  if (!isRealSuperAdmin(req)) {
    return res.status(403).render('error', {
      title: 'Acesso negado',
      message: 'Esta funcionalidade é restrita ao administrador principal.'
    });
  }
  next();
}

module.exports = { requireSuperAdmin };
