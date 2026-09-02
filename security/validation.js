const { body, param, query, validationResult, field, oneOf } = require('express-validator');
const fs = require('fs');

function removeRejectedUploads(req) {
  const files = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);
  else if (req.files && typeof req.files === 'object') Object.values(req.files).forEach((items) => files.push(...items));
  files.forEach((file) => {
    if (!file || !file.path) return;
    try { fs.unlinkSync(file.path); } catch (error) {
      if (error.code !== 'ENOENT') console.error('Falha ao remover upload rejeitado:', error.message);
    }
  });
}

function sendValidationErrors(req, res, errors, onHtmlError) {
  const messages = errors.array().map((error) => error.msg);
  removeRejectedUploads(req);
  if (req.xhr || req.is('application/json') || (req.get('accept') || '').includes('application/json')) {
    return res.status(400).json({ errors: messages });
  }
  if (typeof onHtmlError === 'function') return onHtmlError(req, res, messages);
  return res.status(400).render('error', {
    title: 'Dados inválidos',
    message: messages.join(' ')
  });
}

function handleValidationErrors(req, res, next, onHtmlError) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return sendValidationErrors(req, res, errors, onHtmlError);
  }
  return next();
}

function validateAndHandle(req, res, next, validators, onHtmlError) {
  return Promise.all((Array.isArray(validators) ? validators : [validators]).map((v) => v.run(req)))
    .then(() => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return sendValidationErrors(req, res, errors, onHtmlError);
      }
      return next();
    })
    .catch((err) => {
      console.error('validateAndHandle error:', err);
      return res.status(500).json({ errors: ['Erro interno de validação.'] });
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

function sanitizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

const validators = {
  login: [
    body('email').customSanitizer(sanitizeEmail).isEmail().withMessage('Informe um e-mail válido.'),
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
    body('email').customSanitizer(sanitizeEmail).isEmail().withMessage('Informe um e-mail válido.'),
    body('institution').optional().trim().isLength({ max: 200 }),
    body('student_lattes_id').optional({ values: 'falsy' }).matches(/^\d{16}$/).withMessage('O ID Lattes deve ter 16 dígitos numéricos.')
  ],
  submit: [
    body('title').trim().notEmpty().withMessage('O título é obrigatório.').isLength({ max: 200 }),
    body('area').trim().notEmpty().withMessage('A área/trilha é obrigatória.'),
    body('abstract').trim().notEmpty().withMessage('O resumo é obrigatório.').isLength({ max: 2500 }),
    body('keywords').trim().notEmpty().withMessage('As palavras-chave são obrigatórias.'),
    body('email_submission').customSanitizer(sanitizeEmail).isEmail().withMessage('Informe um e-mail de submissão válido.'),
    body('ethics_confirmed').isIn(['on', '1']).withMessage('É necessário aceitar a declaração de ética.'),
    body('publication_authorized').isIn(['on', '1']).withMessage('É necessário autorizar a publicação.')
  ],
  userForm: [
    body('email').customSanitizer(sanitizeEmail).isEmail().withMessage('Informe um e-mail válido.'),
    body('password').optional({ values: 'falsy' }).isLength({ min: 8 }).withMessage('A senha deve ter pelo menos 8 caracteres.'),
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
    body('date_start').optional({ values: 'falsy' }).isISO8601({ strict: true }).withMessage('Informe uma data de início válida.')
  ],
  participantForm: [
    body('name').trim().notEmpty().withMessage('O nome é obrigatório.').isLength({ max: 200 }),
    body('email').customSanitizer(sanitizeEmail).isEmail().withMessage('Informe um e-mail válido.')
  ],
  reviewerForm: [
    body('recommendation').isIn(['approved', 'rejected', 'revision_requested']).withMessage('Recomendação inválida.'),
    body('review_notes').optional().trim().isLength({ max: 10000 })
  ],
  finalDecision: [
    body('final_status').isIn(['pending', 'in_review', 'approved', 'rejected']).withMessage('Status inválido.'),
    body('presentation_type').isIn(['oral', 'poster']).withMessage('Tipo de apresentação inválido.')
  ],
  reportDecision: [
    body('final_status').isIn(['pending', 'in_review', 'approved', 'rejected']).withMessage('Status inválido.')
  ],
  eventFormFull: [
    body('name').trim().notEmpty().withMessage('O nome do evento é obrigatório.').isLength({ max: 200 }),
    body('area').optional().trim(),
    body('date_start').optional({ values: 'falsy' }).isISO8601({ strict: true }).withMessage('Informe uma data de início válida.'),
    body('institution').optional().trim().isLength({ max: 200 }),
    body('language').optional().trim().isLength({ max: 50 }),
    body('location').optional().trim().isLength({ max: 200 }),
    body('url').optional({ values: 'falsy' }).isURL().withMessage('URL inválida.'),
    body('description').optional().trim().isLength({ max: 5000 }),
    body('short_name').optional().trim().isLength({ max: 100 }),
    body('registration_start').optional({ values: 'falsy' }).isISO8601({ strict: true }).withMessage('Data inválida.'),
    body('registration_end').optional({ values: 'falsy' }).isISO8601({ strict: true }).withMessage('Data inválida.'),
    body('submission_start').optional({ values: 'falsy' }).isISO8601({ strict: true }).withMessage('Data inválida.'),
    body('submission_end').optional({ values: 'falsy' }).isISO8601({ strict: true }).withMessage('Data inválida.'),
    body('review_start').optional({ values: 'falsy' }).isISO8601({ strict: true }).withMessage('Data inválida.'),
    body('review_end').optional({ values: 'falsy' }).isISO8601({ strict: true }).withMessage('Data inválida.'),
    body('certificates_start').optional({ values: 'falsy' }).isISO8601({ strict: true }).withMessage('Data inválida.'),
    body('certificates_end').optional({ values: 'falsy' }).isISO8601({ strict: true }).withMessage('Data inválida.')
  ],
  activityForm: [
    body('name').trim().notEmpty().withMessage('O nome da atividade é obrigatório.'),
    body('activity_type').optional().isIn(['lecture', 'seminar', 'roundtable', 'course', 'oral_presentation', 'poster_presentation', 'breakfast', 'coffee_break', 'brunch', 'lunch', 'dinner', 'other']).withMessage('Tipo de atividade inválido.'),
    body('description').optional().trim().isLength({ max: 2000 }).withMessage('A descrição ou ementa deve ter no máximo 2000 caracteres.'),
    body('workload_hours').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Carga horária inválida.'),
    body('max_participants').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('O número máximo de participantes deve ser um inteiro maior que zero.'),
    body('video_url').optional({ values: 'falsy' }).isLength({ max: 500 }).withMessage('Link da transmissão de vídeo inválido.'),
    body('eligible_roles').custom((value) => (Array.isArray(value) ? value : [value]).filter(Boolean).length > 0).withMessage('Selecione ao menos um papel elegível.'),
    body('eligible_roles').custom((value) => (Array.isArray(value) ? value : [value]).every((role) => ['participant', 'reviewer', 'speaker', 'teacher', 'oral_presenter', 'poster_presenter'].includes(role))).withMessage('Papel inválido.')
  ],
  certificateRule: [
    body('certificate_role').isIn(['participant', 'reviewer', 'speaker', 'teacher', 'oral_presenter', 'poster_presenter']).withMessage('Papel de certificado inválido.'),
    body('min_attendance').optional({ values: 'falsy' }).isInt({ min: 0, max: 100 }).withMessage('Presença mínima deve ser um inteiro entre 0 e 100.'),
    body('background_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Fundo inválido.'),
    body('text_color').optional().matches(/^#[0-9a-fA-F]{6}$/).withMessage('Cor inválida.'),
    body('title').optional().trim().isLength({ max: 160 }),
    body('body_text').optional().trim().isLength({ max: 500 })
  ],
  assignReviewer: [
    body('reviewer_id').optional().isInt({ min: 1 }).withMessage('Revisor inválido.'),
    body('action').optional().isIn(['assign', 'unassign']).withMessage('Ação inválida.')
  ],
  subsidyDecision: [
    body('subsidy_status').isIn(['approved', 'rejected']).withMessage('Status inválido.'),
    body('subsidy_review_notes').optional().trim().isLength({ max: 5000 })
  ],
  articleUpdate: [
    body('status').isIn(['pending', 'in_review', 'approved', 'rejected', 'revision_requested', 'withdrawn']).withMessage('Status inválido.')
  ],
  publication: [],
  roleAssignment: [
    body('role').isIn(['admin', 'staff', 'reviewer', 'speaker', 'teacher', 'oral_presenter', 'poster_presenter']).withMessage('Papel inválido.'),
    body('user_id').isInt({ min: 1 }).withMessage('Usuário inválido.'),
    body('article_id').optional({ values: 'falsy' }).isInt({ min: 1 }).withMessage('Artigo inválido.')
  ],
  attendanceAction: [
    body('action').isIn(['mark', 'update', 'remove', 'present', 'absent']).withMessage('Ação inválida.'),
    body('role').optional({ values: 'falsy' }).isIn(['participant', 'speaker', 'teacher', 'oral_presenter', 'poster_presenter']).withMessage('Papel inválido.')
  ],
  attendanceBulk: [
    body('bulk_action').isIn(['mark_all_present', 'unmark_all_present']).withMessage('Ação em lote inválida.'),
    body('action').optional().isIn(['mark', 'remove']).withMessage('Ação em lote inválida.')
  ],
  eventRegistration: [
    body('name').trim().notEmpty().withMessage('O nome é obrigatório.').isLength({ max: 200 }),
    body('email').customSanitizer(sanitizeEmail).isEmail().withMessage('Informe um e-mail válido.'),
    body('institution').optional().trim().isLength({ max: 200 }),
    body('phone').optional().trim().isLength({ max: 30 }),
    body('registration_type').optional().isIn(['listener', 'author']).withMessage('Tipo de participação inválido.')
  ],
  participantProfile: [
    body('name').optional().trim().isLength({ max: 200 }),
    body('email').optional({ values: 'falsy' }).customSanitizer(sanitizeEmail).isEmail().withMessage('Informe um e-mail válido.'),
    body('institution').optional().trim().isLength({ max: 200 }),
    body('cpf').optional().trim(),
    body('passport').optional().trim().isLength({ max: 50 }),
    body('country').optional().trim(),
    body('phone').optional().trim().isLength({ max: 30 }),
    body('formacao_area').optional().trim().isLength({ max: 10 }),
    body('formacao_curso').optional().trim().isLength({ max: 200 }),
    body('formacao_titulacao').optional().trim().isLength({ max: 100 }),
    body('formacao_status').optional().trim().isLength({ max: 100 }),
    body('new_password').optional({ values: 'falsy' }).isLength({ min: 8 }).withMessage('A nova senha deve ter pelo menos 8 caracteres.').matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('A senha deve conter maiúscula, minúscula e número.'),
    body('confirm_password').optional({ values: 'falsy' }).custom((value, { req }) => {
      if (req.body.new_password && value !== req.body.new_password) {
        throw new Error('As senhas não conferem.');
      }
      return true;
    })
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
