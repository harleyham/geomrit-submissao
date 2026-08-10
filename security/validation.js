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
    body('cpf').optional().trim(),
    body('formacao_area').optional().trim().isLength({ max: 10 }),
    body('formacao_curso').optional().trim().isLength({ max: 200 }),
    body('formacao_titulacao').optional().trim().isLength({ max: 100 }),
    body('formacao_status').optional().trim().isLength({ max: 100 })
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
  ],
  eventFormFull: [
    body('name').trim().notEmpty().withMessage('O nome do evento é obrigatório.').isLength({ max: 200 }),
    body('area').optional().trim(),
    body('date_start').optional().isISO8601({ strict: true }).withMessage('Informe uma data de início válida.'),
    body('institution').optional().trim().isLength({ max: 200 }),
    body('language').optional().trim().isLength({ max: 50 }),
    body('location').optional().trim().isLength({ max: 200 }),
    body('url').optional().isURL().withMessage('URL inválida.'),
    body('description').optional().trim().isLength({ max: 5000 }),
    body('short_name').optional().trim().isLength({ max: 100 }),
    body('registration_start').optional().isISO8601({ strict: true }).withMessage('Data inválida.'),
    body('registration_end').optional().isISO8601({ strict: true }).withMessage('Data inválida.'),
    body('submission_start').optional().isISO8601({ strict: true }).withMessage('Data inválida.'),
    body('submission_end').optional().isISO8601({ strict: true }).withMessage('Data inválida.'),
    body('review_start').optional().isISO8601({ strict: true }).withMessage('Data inválida.'),
    body('review_end').optional().isISO8601({ strict: true }).withMessage('Data inválida.'),
    body('certificates_start').optional().isISO8601({ strict: true }).withMessage('Data inválida.'),
    body('certificates_end').optional().isISO8601({ strict: true }).withMessage('Data inválida.')
  ],
  activityForm: [
    body('name').trim().notEmpty().withMessage('O nome da atividade é obrigatório.'),
    body('activity_type').optional().isIn(['lecture', 'seminar', 'roundtable', 'course', 'oral_presentation', 'poster_presentation', 'other']).withMessage('Tipo de atividade inválido.'),
    body('workload_hours').optional().isFloat({ min: 0 }).withMessage('Carga horária inválida.'),
    body('eligible_roles').isArray({ min: 1 }).withMessage('Selecione ao menos um papel elegível.'),
    body('eligible_roles.*').isIn(['participant', 'speaker', 'teacher', 'oral_presenter', 'poster_presenter']).withMessage('Papel inválido.')
  ],
  certificateRule: [
    body('certificate_role').isIn(['participant', 'reviewer', 'speaker', 'teacher', 'oral_presenter', 'poster_presenter']).withMessage('Papel de certificado inválido.'),
    body('min_attendance').optional().isInt({ min: 0 }).withMessage('Mínimo de presenças inválido.'),
    body('background_id').optional().isInt({ min: 1 }).withMessage('Fundo inválido.'),
    body('text_color').optional().matches(/^#[0-9a-fA-F]{6}$/).withMessage('Cor inválida.'),
    body('title').optional().trim().isLength({ max: 160 }),
    body('body_text').optional().trim().isLength({ max: 500 })
  ],
  assignReviewer: [
    body('reviewer_id').optional().isInt({ min: 1 }).withMessage('Revisor inválido.'),
    body('action').optional().isIn(['assign', 'remove']).withMessage('Ação inválida.')
  ],
  subsidyDecision: [
    body('subsidy_status').isIn(['approved', 'rejected']).withMessage('Status inválido.'),
    body('subsidy_review_notes').optional().trim().isLength({ max: 5000 })
  ],
  articleUpdate: [
    body('status').isIn(['pending', 'in_review', 'approved', 'rejected', 'revision_requested', 'withdrawn']).withMessage('Status inválido.')
  ],
  publication: [
    body('status').isIn(['published', 'draft', 'archived']).withMessage('Status inválido.')
  ],
  attendanceAction: [
    body('action').isIn(['mark', 'update', 'remove']).withMessage('Ação inválida.'),
    body('role').optional().isIn(['participant', 'speaker', 'teacher', 'oral_presenter', 'poster_presenter']).withMessage('Papel inválido.')
  ],
  eventRegistration: [
    body('name').trim().notEmpty().withMessage('O nome é obrigatório.').isLength({ max: 200 }),
    body('email').trim().isEmail().withMessage('Informe um e-mail válido.').normalizeEmail(),
    body('institution').optional().trim().isLength({ max: 200 }),
    body('phone').optional().trim().isLength({ max: 30 }),
    body('registration_type').optional().isIn(['listener', 'author']).withMessage('Tipo de participação inválido.')
  ],
  participantProfile: [
    body('name').optional().trim().isLength({ max: 200 }),
    body('email').optional().trim().isEmail().withMessage('Informe um e-mail válido.').normalizeEmail(),
    body('institution').optional().trim().isLength({ max: 200 }),
    body('cpf').optional().trim(),
    body('passport').optional().trim().isLength({ max: 50 }),
    body('country').optional().trim(),
    body('phone').optional().trim().isLength({ max: 30 })
  ],
  completeProfile: [
    body('name').trim().notEmpty().withMessage('O nome é obrigatório.').isLength({ max: 200 }),
    body('institution').trim().notEmpty().withMessage('A instituição é obrigatória.').isLength({ max: 200 }),
    body('phone').trim().notEmpty().withMessage('O telefone é obrigatório.').isLength({ max: 30 }),
    body('cpf').optional().trim(),
    body('passport').optional().trim().isLength({ max: 50 }),
    body('country').trim().notEmpty().withMessage('O país é obrigatório.').isLength({ max: 100 }),
    body('formacao_area').trim().notEmpty().withMessage('A área de formação é obrigatória.').isLength({ max: 10 }),
    body('formacao_curso').trim().notEmpty().withMessage('O curso é obrigatório.').isLength({ max: 200 }),
    body('formacao_titulacao').isIn(['Graduado', 'Mestre', 'Doutor']).withMessage('Titulação inválida.'),
    body('formacao_status').isIn(['Formado', 'Cursando']).withMessage('Status da formação inválido.')
  ],
  certificateCode: [
    body('certificate_code').trim().notEmpty().withMessage('Informe o código do certificado.')
  ],
  articleCode: [
    body('access_code').trim().notEmpty().withMessage('Informe o código de acesso.')
  ],
  bulkUserFlags: [
    body('user_ids').isArray({ min: 1 }).withMessage('Selecione ao menos um usuário.'),
    body('user_ids.*').isInt({ min: 1 }).withMessage('ID de usuário inválido.')
  ]
};

module.exports = { handleValidationErrors, validateAndHandle, sanitizeString, sanitizeHtml, validators };
