const express = require('express');
const router = express.Router();
const { db } = require('../db');
const bcrypt = require('bcryptjs');

function requireAuth(req, res, next) {
  if (!req.session.isAdmin) {
    return res.redirect('/login');
  }
  next();
}

function parseToggleValue(value) {
  return value === '1' || value === 1 || value === true || value === 'true' ? 1 : 0;
}

function sendToggleResponse(req, res, payload) {
  const acceptsJson = (req.get('accept') || '').includes('application/json');
  if (acceptsJson || req.xhr) {
    return res.json(payload);
  }
  return res.redirect('/admin/users');
}

router.get('/', requireAuth, (req, res) => {
  const users = db.prepare(`
    SELECT id, name, email, cpf, passport, country, institution, 
           is_admin, is_reviewer, is_public, password_changed, created_at
    FROM users ORDER BY name
  `).all();
  const currentUser = db.prepare('SELECT id, name, email FROM users WHERE id = ?').bind(req.session.userId).get();
  res.render('admin/users/list', { 
    users, currentUser,
    title: 'Usuários', 
    year: new Date().getFullYear(),
    success: req.query.success,
    error: req.query.error
  });
});

router.get('/new', requireAuth, (req, res) => {
  res.render('admin/users/form', {
    user: null,
    title: 'Novo Usuário',
    year: new Date().getFullYear()
  });
});

router.post('/', requireAuth, (req, res) => {
  const { name, email, password, cpf, passport, country, institution, is_admin, is_reviewer } = req.body;

  if (!email || !password) {
    return res.render('admin/users/form', {
      user: { name, email, cpf, passport, country, institution, is_admin, is_reviewer },
      title: 'Novo Usuário',
      year: new Date().getFullYear(),
      error: 'E-mail e senha são obrigatórios.'
    });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').bind(email).get();
  if (existing) {
    return res.render('admin/users/form', {
      user: { name, email, cpf, passport, country, institution, is_admin, is_reviewer },
      title: 'Novo Usuário',
      year: new Date().getFullYear(),
      error: 'Já existe um usuário com o e-mail ' + email
    });
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO users (name, email, password, cpf, passport, country, institution,
      is_admin, is_reviewer, is_public, password_changed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, datetime('now'), datetime('now'))
  `).bind(
    name || email,
    email,
    hash,
    cpf || null,
    passport || null,
    country || null,
    institution || null,
    is_admin ? 1 : 0,
    is_reviewer ? 1 : 0
  ).run();

  res.redirect('/admin/users?success=Usuário criado com sucesso');
});

router.get('/:id/edit', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').bind(req.params.id).get();
  if (!user) return res.status(404).render('error', { title: 'Usuário não encontrado' });
  res.render('admin/users/form', {
    user,
    title: 'Editar Usuário',
    year: new Date().getFullYear()
  });
});

router.put('/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, email, password, cpf, passport, country, institution, is_admin, is_reviewer } = req.body;

  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(`
      UPDATE users SET name=?, email=?, password=?, cpf=?, passport=?, country=?, institution=?,
        is_admin=?, is_reviewer=?, password_changed=0, updated_at=datetime('now')
      WHERE id=?
    `).bind(
      name, email, hash,
      cpf || null, passport || null, country || null, institution || null,
      is_admin ? 1 : 0, is_reviewer ? 1 : 0, id
    ).run();
  } else {
    db.prepare(`
      UPDATE users SET name=?, email=?, cpf=?, passport=?, country=?, institution=?,
        is_admin=?, is_reviewer=?, updated_at=datetime('now')
      WHERE id=?
    `).bind(
      name, email,
      cpf || null, passport || null, country || null, institution || null,
      is_admin ? 1 : 0, is_reviewer ? 1 : 0, id
    ).run();
  }

  res.redirect('/admin/users?success=Usuário atualizado');
});

router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').bind(req.params.id).run();
  res.redirect('/admin/users?success=Usuário excluído');
});

// Alterar senha do admin logado
router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    return res.redirect('/admin/users?error=Todos os campos são obrigatórios');
  }

  if (new_password !== confirm_password) {
    return res.redirect('/admin/users?error=As senhas não conferem');
  }

  if (new_password.length < 6) {
    return res.redirect('/admin/users?error=A senha deve ter pelo menos 6 caracteres');
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').bind(req.session.userId).get();

  if (!user) {
    return res.redirect('/admin/users?error=Erro ao buscar usuário');
  }

  const valid = bcrypt.compareSync(current_password, user.password);
  if (!valid) {
    return res.redirect('/admin/users?error=Senha atual incorreta');
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(hash, req.session.userId).run();

  res.redirect('/admin/users?success=Senha alterada com sucesso');
});

// Resetar senha de usuário para padrão
router.post('/:id/reset-password', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const hash = bcrypt.hashSync('123456', 10);
  db.prepare('UPDATE users SET password = ?, password_changed = 0, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(hash, id).run();
  res.redirect('/admin/users?success=Senha resetada para 123456');
});

router.post('/:id/update-flags', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = db.prepare('SELECT id FROM users WHERE id = ?').bind(id).get();
  if (!user) {
    return res.redirect('/admin/users?error=Usuário não encontrado');
  }

  const is_admin = parseToggleValue(req.body.is_admin);
  const is_reviewer = parseToggleValue(req.body.is_reviewer);
  const is_public = parseToggleValue(req.body.is_public);

  db.prepare(`
    UPDATE users
    SET is_admin = ?, is_reviewer = ?, is_public = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(is_admin, is_reviewer, is_public, id).run();

  return res.redirect('/admin/users?success=Perfis do usuário atualizados');
});

router.post('/bulk-update-flags', requireAuth, (req, res) => {
  const userIds = Array.isArray(req.body.user_ids)
    ? req.body.user_ids
    : req.body.user_ids
      ? [req.body.user_ids]
      : [];

  const updateStmt = db.prepare(`
    UPDATE users
    SET is_admin = ?, is_reviewer = ?, is_public = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  const updateMany = db.transaction((ids) => {
    ids.forEach((rawId) => {
      const id = parseInt(rawId, 10);
      if (!Number.isInteger(id)) return;
      updateStmt.run(
        parseToggleValue(req.body[`is_admin_${id}`]),
        parseToggleValue(req.body[`is_reviewer_${id}`]),
        parseToggleValue(req.body[`is_public_${id}`]),
        id
      );
    });
  });

  updateMany(userIds);
  return res.redirect('/admin/users?success=Perfis dos usuários atualizados');
});

// Toggle is_admin
router.post('/:id/toggle-admin', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = db.prepare('SELECT id FROM users WHERE id = ?').bind(id).get();
  if (!user) {
    return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
  }
  const { is_admin } = req.body;
  db.prepare('UPDATE users SET is_admin = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(parseToggleValue(is_admin), id).run();
  return sendToggleResponse(req, res, { success: true, id, is_admin: parseToggleValue(is_admin) });
});

// Toggle is_reviewer
router.post('/:id/toggle-reviewer', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = db.prepare('SELECT id FROM users WHERE id = ?').bind(id).get();
  if (!user) {
    return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
  }
  const { is_reviewer } = req.body;
  db.prepare('UPDATE users SET is_reviewer = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(parseToggleValue(is_reviewer), id).run();
  return sendToggleResponse(req, res, { success: true, id, is_reviewer: parseToggleValue(is_reviewer) });
});

// Toggle is_public
router.post('/:id/toggle-public', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = db.prepare('SELECT id FROM users WHERE id = ?').bind(id).get();
  if (!user) {
    return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
  }
  const { is_public } = req.body;
  db.prepare('UPDATE users SET is_public = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(parseToggleValue(is_public), id).run();
  return sendToggleResponse(req, res, { success: true, id, is_public: parseToggleValue(is_public) });
});

module.exports = router;
