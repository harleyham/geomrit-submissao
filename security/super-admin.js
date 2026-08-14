function requireSuperAdmin(req, res, next) {
  if (!req.session || !req.session.userEmail || req.session.userEmail !== 'admin@admin.com') {
    return res.status(403).render('error', {
      title: 'Acesso negado',
      message: 'Esta funcionalidade é restrita ao administrador principal.'
    });
  }
  next();
}

module.exports = { requireSuperAdmin };
