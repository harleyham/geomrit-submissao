const { body, param, query, validationResult, field, oneOf } = require('express-validator');

function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (req.xhr || (req.get('accept') || '').includes('application/json')) {
      return res.status(400).json({ errors: errors.array().map((e) => e.msg) });
    }
    res.locals.validationErrors = errors.array().map((e) => e.msg);
    return next();
  }
  next();
}

function validateAndHandle(req, res, next, validators) {
  return Promise.all((Array.isArray(validators) ? validators : [validators]).map((v) => v.run(req))).then(() => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      if (req.xhr || (req.get('accept') || '').includes('application/json')) {
        return res.status(400).json({ errors: errors.array().map((e) => e.msg) });
      }
      res.locals.validationErrors = errors.array().map((e) => e.msg);
      return next();
    }
    next();
  });
}

function sanitizeString(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/[<>]/g, '').trim();
}

function sanitizeHtml(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}

const validators = {
  login: [
    body('email').trim().isEmail().withMessage('Informe um e-mail válido.').normalizeEmail(),
    body('password').notEmpty().withMessage('A senha é obrigatória.')
  ],
  changePassword: [
    body('new_password').isLength({ min: 8 }).withMessage('A nova senha deve ter pelo menos 8 caracteres.'),
    body('new_password').matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('A senha deve conter maiúscula, minúscula e número.'),
    body('confirm_password').custom((value, { req }) => {
      if (value !== req.body.new_password) {
        throw new Error('As senhas não conferem.');
      }
      return true;
    })
  ],
  registration: [
    body('name').trim().notEmpty().withMessage('O nome é obrigatório.').isLength({ max: 200 }),
    body('email').trim().isEmail().withMessage('Informe um e-mail válido.').normalizeEmail(),
    body('institution').optional().trim().isLength({ max: 200 }),
    body('student_lattes_id').optional().matches(/^\d{16}$/).withMessage('O ID Lattes deve ter 16 dígitos numéricos.')
  ],
  submit: [
    body('title').trim().notEmpty().withMessage('O título é obrigatório.').isLength({ max: 200 }),
    body('area').trim().notEmpty().withMessage('A área/trilha é obrigatória.'),
    body('abstract').trim().notEmpty().withMessage('O resumo é obrigatório.').isLength({ max: 2500 }),
    body('keywords').trim().notEmpty().withMessage('As palavras-chave são obrigatórias.'),
    body('email_submission').trim().isEmail().withMessage('Informe um e-mail de submissão válido.').normalizeEmail(),
    body('ethics_confirmed').equals('on').withMessage('É necessário aceitar a declaração de ética.'),
    body('publication_authorized').equals('on').withMessage('É necessário autorizar a publicação.')
  ],
  userForm: [
    body('email').trim().isEmail().withMessage('Informe um e-mail válido.').normalizeEmail(),
    body('password').optional().isLength({ min: 8 }).withMessage('A senha deve ter pelo menos 8 caracteres.'),
    body('name').optional().trim().isLength({ max: 200 }),
    body('cpf').optional().trim()
  ],
  eventForm: [
    body('name').trim().notEmpty().withMessage('O nome do evento é obrigatório.').isLength({ max: 200 }),
    body('area').optional().trim(),
    body('date_start').optional().isISO8601({ strict: true }).withMessage('Informe uma data de início válida.')
  ],
  participantForm: [
    body('name').trim().notEmpty().withMessage('O nome é obrigatório.').isLength({ max: 200 }),
    body('email').trim().isEmail().withMessage('Informe um e-mail válido.').normalizeEmail()
  ],
  reviewerForm: [
    body('recommendation').isIn(['approved', 'rejected', 'revision_requested']).withMessage('Recomendação inválida.'),
    body('review_notes').optional().trim().isLength({ max: 10000 })
  ],
  finalDecision: [
    body('final_status').isIn(['pending', 'in_review', 'approved', 'rejected']).withMessage('Status inválido.'),
    body('presentation_type').isIn(['oral', 'poster']).withMessage('Tipo de apresentação inválido.')
  ]
};

module.exports = { handleValidationErrors, validateAndHandle, sanitizeString, sanitizeHtml, validators };
