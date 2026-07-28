const express = require('express');
const router = express.Router();
const { db } = require('../db');
const bcrypt = require('bcryptjs');
const PROTECTED_ADMIN_EMAIL = 'admin@admin.com';

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

function getActiveAdminCount() {
  return db.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 1 AND is_public = 1').get().count;
}

function isRemovingLastActiveAdmin(currentUser, nextIsAdmin, nextIsPublic) {
  const currentlyActiveAdmin = currentUser.is_admin === 1 && currentUser.is_public === 1;
  const willRemainActiveAdmin = nextIsAdmin === 1 && nextIsPublic === 1;

  return currentlyActiveAdmin && !willRemainActiveAdmin && getActiveAdminCount() <= 1;
}

function getNextApprovalStatus(currentStatus, nextIsPublic) {
  if (currentStatus === 'pending' && nextIsPublic === 1) {
    return 'approved';
  }
  return currentStatus || 'approved';
}

function normalizeCPF(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidCPF(value) {
  const cpf = normalizeCPF(value);

  if (!cpf) return true;
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calcDigit = (base, factor) => {
    let total = 0;
    for (let index = 0; index < base.length; index += 1) {
      total += Number(base[index]) * (factor - index);
    }
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  const digit1 = calcDigit(cpf.slice(0, 9), 10);
  const digit2 = calcDigit(cpf.slice(0, 10), 11);

  return digit1 === Number(cpf[9]) && digit2 === Number(cpf[10]);
}

router.get('/', requireAuth, (req, res) => {
  const users = db.prepare(`
    SELECT id, name, email, cpf, passport, country, institution,
           is_admin, is_reviewer, is_public, approval_status, approved_at,
           password_changed, created_at
    FROM users
    ORDER BY CASE WHEN approval_status = 'pending' THEN 0 ELSE 1 END, name
  `).all();
  const pendingUsers = users.filter((user) => user.approval_status === 'pending');
  const approvedUsers = users.filter((user) => user.approval_status !== 'pending');
  const currentUser = db.prepare('SELECT id, name, email FROM users WHERE id = ?').bind(req.session.userId).get();
  res.render('admin/users/list', { 
    users, pendingUsers, approvedUsers, currentUser,
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

  if (!isValidCPF(cpf)) {
    return res.render('admin/users/form', {
      user: { name, email, cpf, passport, country, institution, is_admin, is_reviewer },
      title: 'Novo Usuário',
      year: new Date().getFullYear(),
      error: 'O CPF informado é inválido.'
    });
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO users (name, email, password, cpf, passport, country, institution,
      is_admin, is_reviewer, is_public, approval_status, approved_at, password_changed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'approved', datetime('now'), 0, datetime('now'), datetime('now'))
  `).bind(
    name || email,
    email,
    hash,
    normalizeCPF(cpf) || null,
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
  const user = db.prepare('SELECT id, is_admin, is_public, approval_status FROM users WHERE id = ?').bind(id).get();

  if (!user) {
    return res.redirect('/admin/users?error=Usuário não encontrado');
  }

  const nextIsAdmin = is_admin ? 1 : 0;
  if (isRemovingLastActiveAdmin(user, nextIsAdmin, user.is_public)) {
    return res.redirect('/admin/users?error=O sistema deve manter pelo menos um administrador ativo');
  }

  if (!isValidCPF(cpf)) {
    return res.render('admin/users/form', {
      user: { id, name, email, cpf, passport, country, institution, is_admin, is_reviewer },
      title: 'Editar Usuário',
      year: new Date().getFullYear(),
      error: 'O CPF informado é inválido.'
    });
  }

  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(`
      UPDATE users SET name=?, email=?, password=?, cpf=?, passport=?, country=?, institution=?,
        is_admin=?, is_reviewer=?, password_changed=0, updated_at=datetime('now')
      WHERE id=?
    `).bind(
      name, email, hash,
      normalizeCPF(cpf) || null, passport || null, country || null, institution || null,
      nextIsAdmin, is_reviewer ? 1 : 0, id
    ).run();
  } else {
    db.prepare(`
      UPDATE users SET name=?, email=?, cpf=?, passport=?, country=?, institution=?,
        is_admin=?, is_reviewer=?, updated_at=datetime('now')
      WHERE id=?
    `).bind(
      name, email,
      normalizeCPF(cpf) || null, passport || null, country || null, institution || null,
      nextIsAdmin, is_reviewer ? 1 : 0, id
    ).run();
  }

  res.redirect('/admin/users?success=Usuário atualizado');
});

router.delete('/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = db.prepare('SELECT id, email, is_admin, is_public FROM users WHERE id = ?').bind(id).get();
  if (!user) {
    return res.redirect('/admin/users?error=Usuário não encontrado');
  }

  if (user.email === PROTECTED_ADMIN_EMAIL) {
    return res.redirect('/admin/users?error=A conta administrativa padrão não pode ser excluída');
  }

  if (isRemovingLastActiveAdmin(user, 0, 0)) {
    return res.redirect('/admin/users?error=O sistema deve manter pelo menos um administrador ativo');
  }

  db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
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
  const user = db.prepare('SELECT id, is_admin, is_public, approval_status FROM users WHERE id = ?').bind(id).get();
  if (!user) {
    return res.redirect('/admin/users?error=Usuário não encontrado');
  }

  const is_admin = parseToggleValue(req.body.is_admin);
  const is_reviewer = parseToggleValue(req.body.is_reviewer);
  const is_public = parseToggleValue(req.body.is_public);
  const approvalStatus = getNextApprovalStatus(user.approval_status, is_public);

  if (isRemovingLastActiveAdmin(user, is_admin, is_public)) {
    return res.redirect('/admin/users?error=O sistema deve manter pelo menos um administrador ativo');
  }

  db.prepare(`
    UPDATE users
    SET is_admin = ?, is_reviewer = ?, is_public = ?, approval_status = ?,
        approved_at = CASE
          WHEN ? = 'approved' AND approved_at IS NULL THEN datetime('now')
          ELSE approved_at
        END,
        approved_by = CASE
          WHEN ? = 'approved' AND approved_by IS NULL THEN ?
          ELSE approved_by
        END,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(is_admin, is_reviewer, is_public, approvalStatus, approvalStatus, approvalStatus, req.session.userId, id).run();

  return res.redirect('/admin/users?success=Perfis do usuário atualizados');
});

router.post('/bulk-update-flags', requireAuth, (req, res) => {
  const userIds = Array.isArray(req.body.user_ids)
    ? req.body.user_ids
    : req.body.user_ids
      ? [req.body.user_ids]
      : [];

  const currentUsers = db.prepare(`
    SELECT id, is_admin, is_public, approval_status
    FROM users
    WHERE id IN (${userIds.map(() => '?').join(',') || 'NULL'})
  `).all(...userIds);

  const currentUsersById = new Map(currentUsers.map((user) => [user.id, user]));
  const activeAdminsAfterUpdate = db.prepare('SELECT id, is_admin, is_public FROM users').all().map((user) => {
    const pendingUser = currentUsersById.get(user.id);
    if (!pendingUser) {
      return user;
    }

    return {
      id: user.id,
      is_admin: parseToggleValue(req.body[`is_admin_${user.id}`]),
      is_public: parseToggleValue(req.body[`is_public_${user.id}`])
    };
  }).filter((user) => user.is_admin === 1 && user.is_public === 1);

  if (activeAdminsAfterUpdate.length === 0) {
    return res.redirect('/admin/users?error=O sistema deve manter pelo menos um administrador ativo');
  }

  const updateStmt = db.prepare(`
    UPDATE users
    SET is_admin = ?, is_reviewer = ?, is_public = ?, approval_status = ?,
        approved_at = CASE
          WHEN ? = 'approved' AND approved_at IS NULL THEN datetime('now')
          ELSE approved_at
        END,
        approved_by = CASE
          WHEN ? = 'approved' AND approved_by IS NULL THEN ?
          ELSE approved_by
        END,
        updated_at = datetime('now')
    WHERE id = ?
  `);

  const updateMany = db.transaction((ids) => {
    ids.forEach((rawId) => {
      const id = parseInt(rawId, 10);
      if (!Number.isInteger(id)) return;
      const currentUser = currentUsersById.get(id);
      const nextIsPublic = parseToggleValue(req.body[`is_public_${id}`]);
      const approvalStatus = getNextApprovalStatus(currentUser && currentUser.approval_status, nextIsPublic);
      updateStmt.run(
        parseToggleValue(req.body[`is_admin_${id}`]),
        parseToggleValue(req.body[`is_reviewer_${id}`]),
        nextIsPublic,
        approvalStatus,
        approvalStatus,
        approvalStatus,
        req.session.userId,
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
  const user = db.prepare('SELECT id, is_admin, is_public FROM users WHERE id = ?').bind(id).get();
  if (!user) {
    return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
  }
  const { is_admin } = req.body;
  const nextIsAdmin = parseToggleValue(is_admin);

  if (isRemovingLastActiveAdmin(user, nextIsAdmin, user.is_public)) {
    return sendToggleResponse(req, res, { success: false, error: 'O sistema deve manter pelo menos um administrador ativo.' });
  }

  db.prepare('UPDATE users SET is_admin = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(nextIsAdmin, id).run();
  return sendToggleResponse(req, res, { success: true, id, is_admin: nextIsAdmin });
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
  const user = db.prepare('SELECT id, is_admin, is_public, approval_status FROM users WHERE id = ?').bind(id).get();
  if (!user) {
    return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
  }
  const { is_public } = req.body;
  const nextIsPublic = parseToggleValue(is_public);

  if (isRemovingLastActiveAdmin(user, user.is_admin, nextIsPublic)) {
    return sendToggleResponse(req, res, { success: false, error: 'O sistema deve manter pelo menos um administrador ativo.' });
  }

  const approvalStatus = getNextApprovalStatus(user.approval_status, nextIsPublic);
  db.prepare(`
    UPDATE users
    SET is_public = ?, approval_status = ?,
        approved_at = CASE
          WHEN ? = 'approved' AND approved_at IS NULL THEN datetime('now')
          ELSE approved_at
        END,
        approved_by = CASE
          WHEN ? = 'approved' AND approved_by IS NULL THEN ?
          ELSE approved_by
        END,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(nextIsPublic, approvalStatus, approvalStatus, approvalStatus, req.session.userId, id).run();
  return sendToggleResponse(req, res, { success: true, id, is_public: nextIsPublic });
});

router.post('/:id/approve', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = db.prepare('SELECT id, approval_status FROM users WHERE id = ?').bind(id).get();
  if (!user) {
    return res.redirect('/admin/users?error=Usuário não encontrado');
  }

  if (user.approval_status === 'approved') {
    return res.redirect('/admin/users?success=Cadastro já estava aprovado');
  }

  db.prepare(`
    UPDATE users
    SET is_public = 1,
        approval_status = 'approved',
        approved_at = datetime('now'),
        approved_by = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(req.session.userId, id).run();

  return res.redirect('/admin/users?success=Cadastro aprovado com sucesso');
});

module.exports = router;
