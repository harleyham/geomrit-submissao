const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'artigos.db');
const db = new Database(DB_PATH);

// Habilitar WAL mode para melhor performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
const hadParticipantActivityEnrollments = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='participant_activity_enrollments'").get());

// Criar novas tabelas com schema unificado de users
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    cpf TEXT,
    passport TEXT,
    country TEXT,
    institution TEXT,
    reviewer_areas TEXT,
    is_admin INTEGER DEFAULT 0,
    is_reviewer INTEGER DEFAULT 0,
    is_participant INTEGER DEFAULT 0,
    is_speaker INTEGER DEFAULT 0,
    is_teacher INTEGER DEFAULT 0,
    is_oral_presenter INTEGER DEFAULT 0,
    is_poster_presenter INTEGER DEFAULT 0,
    is_public INTEGER DEFAULT 1,
    approval_status TEXT DEFAULT 'approved',
    approved_at DATETIME,
    approved_by INTEGER,
    password_changed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '-3 hours'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    short_name TEXT,
    description TEXT,
    date_start DATE NOT NULL,
    date_end DATE,
    location TEXT,
    url TEXT,
    area TEXT NOT NULL,
    institution TEXT,
    language TEXT,
    has_article_submission INTEGER DEFAULT 0,
    offers_subsidy INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    registration_start DATE,
    registration_end DATE,
    submission_start DATE,
    submission_end DATE,
    review_start DATE,
    review_end DATE,
    certificates_start DATE,
    certificates_end DATE,
    created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '-3 hours'))
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    title_en TEXT DEFAULT '',
    area TEXT DEFAULT 'Outra',
    authors TEXT NOT NULL,
    authors_json TEXT,
    abstract TEXT,
    keywords TEXT DEFAULT '',
    pdf_path TEXT,
    file_original_name TEXT,
    contributor TEXT DEFAULT '',
    affiliation TEXT DEFAULT '',
    city TEXT DEFAULT '',
    email_submission TEXT DEFAULT '',
    submitter_user_id INTEGER,
    access_code TEXT,
    type TEXT DEFAULT 'oral',
    status TEXT NOT NULL DEFAULT 'pending',
    funding TEXT DEFAULT '',
    blind_review_confirmed INTEGER DEFAULT 0,
    ethics_confirmed INTEGER DEFAULT 0,
    publication_authorized INTEGER DEFAULT 0,
    presentation_needs TEXT DEFAULT '',
    date_submitted DATETIME,
    created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL,
    reviewer_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL,
    score INTEGER CHECK(score BETWEEN 1 AND 5),
    report TEXT,
    recommendation TEXT CHECK(recommendation IN ('approved', 'rejected', 'revision_requested')),
    created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS event_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    user_id INTEGER,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    institution TEXT DEFAULT '',
    registration_type TEXT NOT NULL DEFAULT 'listener',
    subsidy_requested INTEGER DEFAULT 0,
    student_level TEXT DEFAULT '',
    student_course TEXT DEFAULT '',
    student_institution_name TEXT DEFAULT '',
    student_institution_state TEXT DEFAULT '',
    student_lattes_id TEXT DEFAULT '',
    subsidy_status TEXT DEFAULT 'not_requested',
    subsidy_review_notes TEXT DEFAULT '',
    subsidy_reviewed_at DATETIME,
    subsidy_reviewed_by INTEGER,
    academic_history_pdf_path TEXT DEFAULT '',
    academic_history_original_name TEXT DEFAULT '',
    motivation_letter_pdf_path TEXT DEFAULT '',
    motivation_letter_original_name TEXT DEFAULT '',
    recommendation_letter_pdf_path TEXT DEFAULT '',
    recommendation_letter_original_name TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS participant_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    registration_id INTEGER,
    actor_user_id INTEGER,
    action TEXT NOT NULL,
    details TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    registration_id INTEGER,
    user_id INTEGER,
    marked_by INTEGER,
    attended_at DATETIME NOT NULL DEFAULT (datetime('now', '-3 hours')),
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (registration_id) REFERENCES event_registrations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (marked_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(event_id, registration_id)
  );

  CREATE TABLE IF NOT EXISTS certificate_backgrounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    created_by INTEGER,
    created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS certificate_rules (
    event_id INTEGER PRIMARY KEY,
    min_attendance INTEGER NOT NULL DEFAULT 1 CHECK(min_attendance >= 1),
    background_id INTEGER,
    updated_by INTEGER,
    created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (background_id) REFERENCES certificate_backgrounds(id) ON DELETE SET NULL,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS certificate_emissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    registration_id INTEGER,
    user_id INTEGER,
    certificate_role TEXT NOT NULL DEFAULT 'participant',
    background_id INTEGER,
    certificate_code TEXT NOT NULL UNIQUE,
    version INTEGER NOT NULL DEFAULT 1,
    attendance_count INTEGER NOT NULL,
    participant_name TEXT NOT NULL,
    event_name TEXT NOT NULL,
    event_date_start DATE,
    event_date_end DATE,
    status TEXT NOT NULL DEFAULT 'issued',
    issued_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    issued_by INTEGER,
    reissued_from_id INTEGER,
    activity_id INTEGER,
    activities_attended INTEGER DEFAULT 0,
    total_workload_hours REAL DEFAULT 0,
    activities_summary TEXT DEFAULT '',
    text_color TEXT DEFAULT '#0f172a',
    certificate_title TEXT,
    certificate_body TEXT,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (registration_id) REFERENCES event_registrations(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (background_id) REFERENCES certificate_backgrounds(id) ON DELETE SET NULL,
    FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (reissued_from_id) REFERENCES certificate_emissions(id) ON DELETE SET NULL,
    UNIQUE(event_id, user_id, certificate_role, version)
  );

  CREATE TABLE IF NOT EXISTS event_user_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'participant', 'reviewer', 'speaker', 'teacher', 'oral_presenter', 'poster_presenter')),
    article_id INTEGER,
    assigned_by INTEGER,
    created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    UNIQUE(event_id, user_id, role),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL,
    FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS event_certificate_rules (
    event_id INTEGER NOT NULL,
    certificate_role TEXT NOT NULL CHECK(certificate_role IN ('reviewer', 'participant', 'speaker', 'teacher', 'oral_presenter', 'poster_presenter')),
    min_attendance INTEGER NOT NULL DEFAULT 1 CHECK(min_attendance >= 0),
    background_id INTEGER,
    text_color TEXT DEFAULT '#0f172a',
    title TEXT,
    body_text TEXT,
    updated_by INTEGER,
    created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    updated_at DATETIME DEFAULT (datetime('now', '-3 hours')),
    PRIMARY KEY (event_id, certificate_role),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (background_id) REFERENCES certificate_backgrounds(id) ON DELETE SET NULL,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS event_activities (id INTEGER PRIMARY KEY AUTOINCREMENT,event_id INTEGER NOT NULL,name TEXT NOT NULL,activity_type TEXT NOT NULL DEFAULT 'other',activity_date DATE,workload_hours REAL DEFAULT 0,certificate_enabled INTEGER DEFAULT 1,eligible_roles TEXT DEFAULT 'participant',certificate_role TEXT DEFAULT 'participant',created_at DATETIME DEFAULT (datetime('now','-3 hours')),FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS participant_activity_enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL,
    registration_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    enrolled_by INTEGER,
    created_at DATETIME DEFAULT (datetime('now','-3 hours')),
    updated_at DATETIME DEFAULT (datetime('now','-3 hours')),
    UNIQUE(activity_id,user_id),
    FOREIGN KEY(activity_id) REFERENCES event_activities(id) ON DELETE CASCADE,
    FOREIGN KEY(registration_id) REFERENCES event_registrations(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(enrolled_by) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS activity_attendance_records (id INTEGER PRIMARY KEY AUTOINCREMENT,activity_id INTEGER NOT NULL,registration_id INTEGER,user_id INTEGER,marked_by INTEGER,attended_at DATETIME DEFAULT (datetime('now','-3 hours')),UNIQUE(activity_id,registration_id),FOREIGN KEY(activity_id) REFERENCES event_activities(id) ON DELETE CASCADE,FOREIGN KEY(registration_id) REFERENCES event_registrations(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS activity_certificate_rules (activity_id INTEGER PRIMARY KEY,min_attendance INTEGER NOT NULL DEFAULT 1,background_id INTEGER,FOREIGN KEY(activity_id) REFERENCES event_activities(id) ON DELETE CASCADE,FOREIGN KEY(background_id) REFERENCES certificate_backgrounds(id) ON DELETE SET NULL);
`);

// Bases anteriores não possuíam inscrição por atividade. Na primeira migração,
// preserva-se o comportamento existente vinculando cada participante às
// atividades em que o papel de participante é elegível.
if (!hadParticipantActivityEnrollments) {
  db.exec(`INSERT OR IGNORE INTO participant_activity_enrollments (activity_id,registration_id,user_id)
    SELECT ea.id,er.id,er.user_id
    FROM event_registrations er JOIN event_activities ea ON ea.event_id=er.event_id
    WHERE er.user_id IS NOT NULL
      AND instr(',' || replace(COALESCE(ea.eligible_roles,''),' ','') || ',', ',participant,') > 0`);
}

try { const cols=db.prepare("PRAGMA table_info(certificate_emissions)").all().map(c=>c.name); if(!cols.includes('activity_id')) db.exec('ALTER TABLE certificate_emissions ADD COLUMN activity_id INTEGER'); } catch(e){ console.warn('Migration certificates:',e.message); }
try {
  const emissionCols = db.prepare("PRAGMA table_info(certificate_emissions)").all().map(c => c.name);
  if (!emissionCols.includes('activities_attended')) db.exec('ALTER TABLE certificate_emissions ADD COLUMN activities_attended INTEGER DEFAULT 0');
  if (!emissionCols.includes('total_workload_hours')) db.exec('ALTER TABLE certificate_emissions ADD COLUMN total_workload_hours REAL DEFAULT 0');
  if (!emissionCols.includes('activities_summary')) db.exec("ALTER TABLE certificate_emissions ADD COLUMN activities_summary TEXT DEFAULT ''");
  if (!emissionCols.includes('text_color')) db.exec('ALTER TABLE certificate_emissions ADD COLUMN text_color TEXT DEFAULT "#0f172a"');
} catch(e) { console.warn('Migration emissions text_color:', e.message); }
try {
  const ruleCols = db.prepare("PRAGMA table_info(certificate_rules)").all().map(c => c.name);
  if (!ruleCols.includes('text_color')) db.exec('ALTER TABLE certificate_rules ADD COLUMN text_color TEXT DEFAULT "#0f172a"');
} catch(e) { console.warn('Migration certificate_rules text_color:', e.message); }
try {
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  for (const column of ['is_participant', 'is_speaker', 'is_teacher', 'is_oral_presenter', 'is_poster_presenter']) {
    if (!userColumns.includes(column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} INTEGER DEFAULT 0`);
  }
  db.exec(`UPDATE users SET is_participant = 1 WHERE id IN (SELECT user_id FROM event_registrations WHERE user_id IS NOT NULL)`);
} catch (e) { console.warn('Migration user certificate profiles:', e.message); }
try {
  const attendanceInfo = db.prepare('PRAGMA table_info(attendance_records)').all();
  const attendanceColumns = attendanceInfo.map((column) => column.name);
  if (!attendanceColumns.includes('user_id')) db.exec('ALTER TABLE attendance_records ADD COLUMN user_id INTEGER');
  db.exec(`UPDATE attendance_records SET user_id=(SELECT user_id FROM event_registrations er WHERE er.id=attendance_records.registration_id)
    WHERE user_id IS NULL AND registration_id IS NOT NULL`);
  if (attendanceInfo.find((column) => column.name === 'registration_id')?.notnull) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`CREATE TABLE attendance_records_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, registration_id INTEGER, user_id INTEGER,
        marked_by INTEGER, attended_at DATETIME NOT NULL DEFAULT (datetime('now','-3 hours')), notes TEXT DEFAULT '',
        created_at DATETIME DEFAULT (datetime('now','-3 hours')), updated_at DATETIME DEFAULT (datetime('now','-3 hours')),
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY(registration_id) REFERENCES event_registrations(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(marked_by) REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE(event_id, registration_id)
      );
      INSERT INTO attendance_records_new (id,event_id,registration_id,user_id,marked_by,attended_at,notes,created_at,updated_at)
      SELECT id,event_id,registration_id,user_id,marked_by,attended_at,notes,created_at,updated_at FROM attendance_records;`);
      db.exec('DROP TABLE attendance_records');
      db.exec('ALTER TABLE attendance_records_new RENAME TO attendance_records');
    })();
    db.pragma('foreign_keys = ON');
  }
} catch (e) { console.warn('Migration attendance by user:', e.message); }
try {
  const rolesSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='event_user_roles'").get()?.sql || '';
  if (!rolesSql.includes("'admin'")) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`CREATE TABLE event_user_roles_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,event_id INTEGER NOT NULL,user_id INTEGER NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','participant','reviewer','speaker','teacher','oral_presenter','poster_presenter')),
        article_id INTEGER,assigned_by INTEGER,created_at DATETIME DEFAULT (datetime('now','-3 hours')),
        UNIQUE(event_id,user_id,role),FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE SET NULL,
        FOREIGN KEY(assigned_by) REFERENCES users(id) ON DELETE SET NULL);
        INSERT INTO event_user_roles_new SELECT * FROM event_user_roles;
        DROP TABLE event_user_roles; ALTER TABLE event_user_roles_new RENAME TO event_user_roles;`);
    })();
    db.pragma('foreign_keys = ON');
  }
  // Administradores legados continuam com acesso aos eventos já existentes.
  db.exec(`INSERT OR IGNORE INTO event_user_roles (event_id,user_id,role,assigned_by)
    SELECT e.id,u.id,'admin',u.id FROM events e JOIN users u ON u.is_admin=1`);
} catch (e) { console.warn('Migration event roles:', e.message); try { db.pragma('foreign_keys = ON'); } catch (_) {} }
try {
  const activityColumns = db.prepare('PRAGMA table_info(event_activities)').all().map((column) => column.name);
  if (!activityColumns.includes('eligible_roles')) db.exec("ALTER TABLE event_activities ADD COLUMN eligible_roles TEXT DEFAULT 'participant'");
  if (!activityColumns.includes('certificate_role')) db.exec("ALTER TABLE event_activities ADD COLUMN certificate_role TEXT DEFAULT 'participant'");
  const activityAttendanceColumns = db.prepare('PRAGMA table_info(activity_attendance_records)').all().map((column) => column.name);
  if (!activityAttendanceColumns.includes('user_id')) db.exec('ALTER TABLE activity_attendance_records ADD COLUMN user_id INTEGER');
  db.exec('UPDATE activity_attendance_records SET user_id=(SELECT user_id FROM event_registrations er WHERE er.id=activity_attendance_records.registration_id) WHERE user_id IS NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_activity_attendance_user ON activity_attendance_records(activity_id,user_id) WHERE user_id IS NOT NULL');
} catch (e) { console.warn('Migration activity attendance by user:', e.message); }
try {
  const aaColumns = db.prepare('PRAGMA table_info(activity_attendance_records)').all().map((c) => c.name);
  if (!aaColumns.includes('role')) {
    db.exec("ALTER TABLE activity_attendance_records ADD COLUMN role TEXT DEFAULT 'participant'");
    db.prepare("UPDATE activity_attendance_records SET role = 'participant' WHERE role IS NULL").run();
  }
} catch (e) { console.warn('Migration activity attendance role:', e.message); }
try {
  // Torna registration_id opcional para atividades sem inscrição (ex: palestrante sem registro)
  const aaCols = db.prepare('PRAGMA table_info(activity_attendance_records)').all();
  const regCol = aaCols.find((c) => c.name === 'registration_id');
  if (regCol && regCol.notnull) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`CREATE TABLE activity_attendance_records_backup AS SELECT * FROM activity_attendance_records`);
      db.exec(`DROP TABLE activity_attendance_records`);
      db.exec(`CREATE TABLE activity_attendance_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activity_id INTEGER NOT NULL,
        registration_id INTEGER,
        marked_by INTEGER,
        attended_at DATETIME DEFAULT (datetime('now','-3 hours')),
        user_id INTEGER,
        role TEXT DEFAULT 'participant',
        UNIQUE(activity_id,registration_id),
        FOREIGN KEY(activity_id) REFERENCES event_activities(id) ON DELETE CASCADE,
        FOREIGN KEY(registration_id) REFERENCES event_registrations(id) ON DELETE SET NULL
      )`);
      db.exec(`INSERT INTO activity_attendance_records(id, activity_id, registration_id, marked_by, attended_at, user_id, role)
        SELECT id, activity_id, registration_id, marked_by, attended_at, user_id, role FROM activity_attendance_records_backup`);
      db.exec(`DROP TABLE activity_attendance_records_backup`);
    })();
    db.pragma('foreign_keys = ON');
  }
} catch (e) { console.warn('Migration activity attendance registration optional:', e.message); }

// A emissão antiga era limitada a uma inscrição por versão. A nova estrutura
// permite diversos certificados para a mesma pessoa no mesmo evento, um por papel.
try {
  const emissionColumns = db.prepare('PRAGMA table_info(certificate_emissions)').all().map((column) => column.name);
  if (!emissionColumns.includes('certificate_role') || !emissionColumns.includes('user_id')) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`CREATE TABLE certificate_emissions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, registration_id INTEGER,
        user_id INTEGER, certificate_role TEXT NOT NULL DEFAULT 'participant', background_id INTEGER,
        certificate_code TEXT NOT NULL UNIQUE, version INTEGER NOT NULL DEFAULT 1, attendance_count INTEGER NOT NULL,
        participant_name TEXT NOT NULL, event_name TEXT NOT NULL, event_date_start DATE, event_date_end DATE,
        status TEXT NOT NULL DEFAULT 'issued', issued_at DATETIME, issued_by INTEGER, reissued_from_id INTEGER,
        activity_id INTEGER, activities_attended INTEGER DEFAULT 0, total_workload_hours REAL DEFAULT 0,
        activities_summary TEXT DEFAULT '', text_color TEXT DEFAULT '#0f172a', certificate_title TEXT, certificate_body TEXT,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (registration_id) REFERENCES event_registrations(id) ON DELETE SET NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (background_id) REFERENCES certificate_backgrounds(id) ON DELETE SET NULL,
        FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (reissued_from_id) REFERENCES certificate_emissions_new(id) ON DELETE SET NULL,
        UNIQUE(event_id, user_id, certificate_role, version)
      );`);
      db.exec(`INSERT INTO certificate_emissions_new
        (id,event_id,registration_id,user_id,certificate_role,background_id,certificate_code,version,attendance_count,participant_name,event_name,event_date_start,event_date_end,status,issued_at,issued_by,reissued_from_id,activity_id,activities_attended,total_workload_hours,activities_summary,text_color)
        SELECT ce.id,ce.event_id,ce.registration_id,er.user_id,'participant',ce.background_id,ce.certificate_code,ce.version,ce.attendance_count,ce.participant_name,ce.event_name,ce.event_date_start,ce.event_date_end,ce.status,ce.issued_at,ce.issued_by,ce.reissued_from_id,ce.activity_id,COALESCE(ce.activities_attended,0),COALESCE(ce.total_workload_hours,0),COALESCE(ce.activities_summary,''),COALESCE(ce.text_color,'#0f172a')
        FROM certificate_emissions ce LEFT JOIN event_registrations er ON er.id=ce.registration_id;`);
      db.exec('DROP TABLE certificate_emissions');
      db.exec('ALTER TABLE certificate_emissions_new RENAME TO certificate_emissions');
    })();
    db.pragma('foreign_keys = ON');
  }
} catch (e) { console.warn('Migration certificate emissions by role:', e.message); try { db.pragma('foreign_keys = ON'); } catch (_) {} }

// Preserva a configuração atual como a regra do certificado de participante.
try {
  db.prepare(`INSERT OR IGNORE INTO event_certificate_rules
    (event_id,certificate_role,min_attendance,background_id,text_color,updated_by,created_at,updated_at)
    SELECT event_id,'participant',min_attendance,background_id,COALESCE(text_color,'#0f172a'),updated_by,created_at,updated_at FROM certificate_rules`).run();
} catch (e) { console.warn('Migration participant certificate rule:', e.message); }

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_event_registrations_event_id ON event_registrations(event_id);
  CREATE INDEX IF NOT EXISTS idx_event_registrations_user_id ON event_registrations(user_id);
  CREATE INDEX IF NOT EXISTS idx_event_registrations_email ON event_registrations(email);
  CREATE INDEX IF NOT EXISTS idx_event_registrations_type ON event_registrations(registration_type);
  CREATE INDEX IF NOT EXISTS idx_participant_audit_event_id ON participant_audit_logs(event_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_participant_audit_registration_id ON participant_audit_logs(registration_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_attendance_records_event_id ON attendance_records(event_id, attended_at DESC);
  CREATE INDEX IF NOT EXISTS idx_attendance_records_registration_id ON attendance_records(registration_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_event_user ON attendance_records(event_id, user_id) WHERE user_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_certificate_emissions_registration_id ON certificate_emissions(registration_id, status);
  CREATE INDEX IF NOT EXISTS idx_certificate_emissions_user_role ON certificate_emissions(event_id, user_id, certificate_role, status);
  CREATE INDEX IF NOT EXISTS idx_event_user_roles_event ON event_user_roles(event_id, role);
  CREATE INDEX IF NOT EXISTS idx_participant_activity_registration ON participant_activity_enrollments(registration_id, activity_id);
  CREATE INDEX IF NOT EXISTS idx_participant_activity_user ON participant_activity_enrollments(user_id, activity_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_event_registration_email
    ON event_registrations(event_id, LOWER(TRIM(email)))
    WHERE TRIM(email) != '';
  CREATE UNIQUE INDEX IF NOT EXISTS uq_event_registration_user
    ON event_registrations(event_id, user_id)
    WHERE user_id IS NOT NULL;

  DROP TRIGGER IF EXISTS trg_enroll_new_event_registration_activities;

  CREATE TRIGGER IF NOT EXISTS trg_sync_event_registration_activity_user
  AFTER UPDATE OF user_id ON event_registrations
  WHEN NEW.user_id IS NOT NULL
  BEGIN
    UPDATE participant_activity_enrollments SET user_id=NEW.user_id,updated_at=datetime('now','-3 hours')
    WHERE registration_id=NEW.id;
  END;
`);

// Fundos distribuídos com o sistema permanecem em assets/Fundos. Eles são
// registrados automaticamente na biblioteca para que possam ser selecionados
// como qualquer outro fundo, sem misturá-los aos uploads administrativos.
function registerDefaultCertificateBackgrounds() {
  const defaultBackgroundDir = path.join(__dirname, 'assets', 'Fundos');
  if (!fs.existsSync(defaultBackgroundDir)) return;

  const insertBackground = db.prepare(`
    INSERT INTO certificate_backgrounds (name, file_path, original_name, mime_type, created_at)
    VALUES (?, ?, ?, ?, datetime('now', '-3 hours'))
  `);
  const findBackground = db.prepare('SELECT id FROM certificate_backgrounds WHERE file_path = ?');
  const supportedExtensions = new Map([
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg']
  ]);

  fs.readdirSync(defaultBackgroundDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .forEach((entry) => {
      const extension = path.extname(entry.name).toLowerCase();
      const mimeType = supportedExtensions.get(extension);
      if (!mimeType) return;

      const relativePath = path.posix.join('assets', 'Fundos', entry.name);
      if (findBackground.get(relativePath)) return;

      insertBackground.run(
        path.basename(entry.name, extension).replace(/[_-]+/g, ' '),
        relativePath,
        entry.name,
        mimeType
      );
    });
}

registerDefaultCertificateBackgrounds();

// Migrate existing data: drop admins, merge reviewers into users
try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const tableNames = tables.map(t => t.name);

  if (tableNames.includes('admins')) {
    db.pragma('foreign_keys = OFF');
    
    // Map old reviewer.id → new user id (by email)
    const reviewerMap = {};
    const reviewerRows = db.prepare('SELECT id, name, email, password, is_active FROM reviewers').all();
    reviewerRows.forEach(r => {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').bind(r.email).get();
      const userId = existing ? existing.id : null;
      reviewerMap[r.id] = userId;
      if (!existing) {
        const newId = db.prepare('INSERT INTO users (name, email, password, is_reviewer, is_public, password_changed) VALUES (?, ?, ?, 1, 1, 0)').bind(r.name, r.email, r.password).get().insertId;
        reviewerMap[r.id] = newId;
      }
    });
    
    // Migrate admins to users
    const adminRows = db.prepare('SELECT id, username, password FROM admins').all();
    adminRows.forEach(a => {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').bind(a.username).get();
      if (!existing) {
        db.prepare('INSERT INTO users (name, email, password, is_admin, password_changed) VALUES (?, ?, ?, 1, 0)').bind(a.username, a.username, a.password).run();
      }
    });
    
    // Update assignments to use new user ids
    if (Object.keys(reviewerMap).length > 0) {
      const oldIds = Object.keys(reviewerMap);
      oldIds.forEach(oldId => {
        const newId = reviewerMap[oldId];
        if (newId) {
          db.prepare('UPDATE assignments SET reviewer_id = ? WHERE reviewer_id = ?').bind(newId, oldId).run();
        }
      });
    }
    
    db.prepare('DROP TABLE IF EXISTS reviewers').run();
    db.prepare('DROP TABLE IF EXISTS admins').run();
    
    db.pragma('foreign_keys = ON');
  }
} catch(e) {
  console.warn('Migration warning:', e.message);
}

// Migrar colunas novas: cpf, passport, country, institution
try {
  const columns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!columns.includes('cpf')) db.exec('ALTER TABLE users ADD COLUMN cpf TEXT');
  if (!columns.includes('passport')) db.exec('ALTER TABLE users ADD COLUMN passport TEXT');
  if (!columns.includes('country')) db.exec('ALTER TABLE users ADD COLUMN country TEXT');
  if (!columns.includes('institution')) db.exec('ALTER TABLE users ADD COLUMN institution TEXT');
  if (!columns.includes('reviewer_areas')) db.exec('ALTER TABLE users ADD COLUMN reviewer_areas TEXT');
  if (!columns.includes('approval_status')) db.exec("ALTER TABLE users ADD COLUMN approval_status TEXT DEFAULT 'approved'");
  if (!columns.includes('approved_at')) db.exec('ALTER TABLE users ADD COLUMN approved_at DATETIME');
  if (!columns.includes('approved_by')) db.exec('ALTER TABLE users ADD COLUMN approved_by INTEGER');
  db.prepare("UPDATE users SET approval_status = 'approved' WHERE approval_status IS NULL OR approval_status = ''").run();
} catch(e) {
  console.warn('Migration users columns:', e.message);
}

try {
  const articleColumns = db.prepare("PRAGMA table_info(articles)").all().map(c => c.name);
  if (!articleColumns.includes('authors_json')) db.exec('ALTER TABLE articles ADD COLUMN authors_json TEXT');
  if (!articleColumns.includes('file_original_name')) db.exec('ALTER TABLE articles ADD COLUMN file_original_name TEXT');
  if (!articleColumns.includes('submitter_user_id')) db.exec('ALTER TABLE articles ADD COLUMN submitter_user_id INTEGER');
  if (!articleColumns.includes('funding')) db.exec("ALTER TABLE articles ADD COLUMN funding TEXT DEFAULT ''");
  if (!articleColumns.includes('blind_review_confirmed')) db.exec('ALTER TABLE articles ADD COLUMN blind_review_confirmed INTEGER DEFAULT 0');
  if (!articleColumns.includes('ethics_confirmed')) db.exec('ALTER TABLE articles ADD COLUMN ethics_confirmed INTEGER DEFAULT 0');
  if (!articleColumns.includes('publication_authorized')) db.exec('ALTER TABLE articles ADD COLUMN publication_authorized INTEGER DEFAULT 0');
  if (!articleColumns.includes('presentation_needs')) db.exec("ALTER TABLE articles ADD COLUMN presentation_needs TEXT DEFAULT ''");
} catch(e) {
  console.warn('Migration articles columns:', e.message);
}

// A revisão agora é integralmente normalizada em assignments e reports. As
// colunas antigas em articles não possuem mais consumidores na aplicação.
try {
  const deprecatedArticleColumns = ['reviewer_id', 'reviewer_name', 'reviewer_area', 'review_notes', 'rejection_reason'];
  const articleColumns = db.prepare("PRAGMA table_info(articles)").all().map(c => c.name);
  deprecatedArticleColumns
    .filter((column) => articleColumns.includes(column))
    .forEach((column) => db.exec(`ALTER TABLE articles DROP COLUMN ${column}`));
} catch(e) {
  console.warn('Cleanup legacy article columns:', e.message);
}

try {
  const eventColumns = db.prepare("PRAGMA table_info(events)").all().map(c => c.name);
  if (!eventColumns.includes('has_article_submission')) db.exec('ALTER TABLE events ADD COLUMN has_article_submission INTEGER DEFAULT 0');
  if (!eventColumns.includes('offers_subsidy')) db.exec('ALTER TABLE events ADD COLUMN offers_subsidy INTEGER DEFAULT 0');
  if (!eventColumns.includes('institution')) db.exec('ALTER TABLE events ADD COLUMN institution TEXT');
  if (!eventColumns.includes('language')) db.exec('ALTER TABLE events ADD COLUMN language TEXT');
  if (!eventColumns.includes('registration_start')) db.exec('ALTER TABLE events ADD COLUMN registration_start DATE');
  if (!eventColumns.includes('registration_end')) db.exec('ALTER TABLE events ADD COLUMN registration_end DATE');
  if (!eventColumns.includes('review_start')) db.exec('ALTER TABLE events ADD COLUMN review_start DATE');
  if (!eventColumns.includes('review_end')) db.exec('ALTER TABLE events ADD COLUMN review_end DATE');
  if (!eventColumns.includes('certificates_start')) db.exec('ALTER TABLE events ADD COLUMN certificates_start DATE');
  if (!eventColumns.includes('certificates_end')) db.exec('ALTER TABLE events ADD COLUMN certificates_end DATE');
  db.prepare(`
    UPDATE events
    SET has_article_submission = CASE
      WHEN COALESCE(submission_start, submission_end, review_start, review_end) IS NOT NULL THEN 1
      ELSE 0
    END
    WHERE has_article_submission IS NULL
       OR (has_article_submission = 0 AND COALESCE(submission_start, submission_end, review_start, review_end) IS NOT NULL)
  `).run();
} catch(e) {
  console.warn('Migration events columns:', e.message);
}

try {
  const registrationColumns = db.prepare("PRAGMA table_info(event_registrations)").all().map(c => c.name);
  if (!registrationColumns.includes('subsidy_requested')) db.exec('ALTER TABLE event_registrations ADD COLUMN subsidy_requested INTEGER DEFAULT 0');
  if (!registrationColumns.includes('student_level')) db.exec("ALTER TABLE event_registrations ADD COLUMN student_level TEXT DEFAULT ''");
  if (!registrationColumns.includes('student_course')) db.exec("ALTER TABLE event_registrations ADD COLUMN student_course TEXT DEFAULT ''");
  if (!registrationColumns.includes('student_institution_name')) db.exec("ALTER TABLE event_registrations ADD COLUMN student_institution_name TEXT DEFAULT ''");
  if (!registrationColumns.includes('student_institution_state')) db.exec("ALTER TABLE event_registrations ADD COLUMN student_institution_state TEXT DEFAULT ''");
  if (!registrationColumns.includes('student_lattes_id')) db.exec("ALTER TABLE event_registrations ADD COLUMN student_lattes_id TEXT DEFAULT ''");
  if (!registrationColumns.includes('subsidy_status')) db.exec("ALTER TABLE event_registrations ADD COLUMN subsidy_status TEXT DEFAULT 'not_requested'");
  if (!registrationColumns.includes('subsidy_review_notes')) db.exec("ALTER TABLE event_registrations ADD COLUMN subsidy_review_notes TEXT DEFAULT ''");
  if (!registrationColumns.includes('subsidy_reviewed_at')) db.exec("ALTER TABLE event_registrations ADD COLUMN subsidy_reviewed_at DATETIME");
  if (!registrationColumns.includes('subsidy_reviewed_by')) db.exec("ALTER TABLE event_registrations ADD COLUMN subsidy_reviewed_by INTEGER");
  if (!registrationColumns.includes('academic_history_pdf_path')) db.exec("ALTER TABLE event_registrations ADD COLUMN academic_history_pdf_path TEXT DEFAULT ''");
  if (!registrationColumns.includes('academic_history_original_name')) db.exec("ALTER TABLE event_registrations ADD COLUMN academic_history_original_name TEXT DEFAULT ''");
  if (!registrationColumns.includes('motivation_letter_pdf_path')) db.exec("ALTER TABLE event_registrations ADD COLUMN motivation_letter_pdf_path TEXT DEFAULT ''");
  if (!registrationColumns.includes('motivation_letter_original_name')) db.exec("ALTER TABLE event_registrations ADD COLUMN motivation_letter_original_name TEXT DEFAULT ''");
  if (!registrationColumns.includes('recommendation_letter_pdf_path')) db.exec("ALTER TABLE event_registrations ADD COLUMN recommendation_letter_pdf_path TEXT DEFAULT ''");
  if (!registrationColumns.includes('recommendation_letter_original_name')) db.exec("ALTER TABLE event_registrations ADD COLUMN recommendation_letter_original_name TEXT DEFAULT ''");
  db.prepare(`
    UPDATE event_registrations
    SET subsidy_status = CASE
      WHEN subsidy_requested = 1 THEN 'pending'
      ELSE 'not_requested'
    END
    WHERE subsidy_status IS NULL OR TRIM(subsidy_status) = ''
  `).run();
} catch(e) {
  console.warn('Migration event registrations columns:', e.message);
}

try {
  const authorRegistrations = db.prepare(`
    SELECT
      event_id,
      submitter_user_id,
      contributor,
      email_submission,
      affiliation
    FROM articles
    WHERE status != 'draft'
      AND email_submission IS NOT NULL
      AND TRIM(email_submission) != ''
    GROUP BY event_id, LOWER(TRIM(email_submission)), COALESCE(submitter_user_id, 0)
  `).all();

  const findEventRegistration = db.prepare(`
    SELECT id, registration_type
    FROM event_registrations
    WHERE event_id = ?
      AND (
        (user_id IS NOT NULL AND user_id = ?)
        OR LOWER(TRIM(email)) = LOWER(TRIM(?))
      )
    ORDER BY id
    LIMIT 1
  `);

  const updateEventRegistration = db.prepare(`
    UPDATE event_registrations
    SET user_id = ?, name = ?, email = ?, institution = ?, registration_type = 'author', updated_at = datetime('now', '-3 hours')
    WHERE id = ?
  `);

  const insertEventRegistration = db.prepare(`
    INSERT INTO event_registrations (
      event_id, user_id, name, email, institution, registration_type, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 'author', datetime('now', '-3 hours'), datetime('now', '-3 hours'))
  `);

  authorRegistrations.forEach((registration) => {
    const existing = findEventRegistration.get(
      registration.event_id,
      registration.submitter_user_id || null,
      registration.email_submission
    );

    if (existing) {
      updateEventRegistration.run(
        registration.submitter_user_id || null,
        registration.contributor || registration.email_submission,
        registration.email_submission,
        registration.affiliation || '',
        existing.id
      );
      return;
    }

    insertEventRegistration.run(
      registration.event_id,
      registration.submitter_user_id || null,
      registration.contributor || registration.email_submission,
      registration.email_submission,
      registration.affiliation || ''
    );
  });
} catch(e) {
  console.warn('Migration event registrations backfill:', e.message);
}

// Seed default admin if not exists
const seedUser = db.prepare('SELECT id FROM users WHERE email = ?').bind('admin@admin.com').get();
if (!seedUser) {
  const hash = bcrypt.hashSync('123456', 10);
  db.prepare(`
    INSERT INTO users
    (name, email, password, is_admin, is_reviewer, is_public, approval_status, approved_at, password_changed)
    VALUES (?, ?, ?, 1, 0, 1, 'approved', datetime('now', '-3 hours'), 0)
  `).bind('Administrador', 'admin@admin.com', hash).run();
  console.log('Seed admin criado: admin@admin.com / 123456');
}

// Exportar funções úteis
module.exports = {
  db,
  recordParticipantAudit: ({ eventId, registrationId = null, actorUserId = null, action, details = {} }) => {
    db.prepare(`
      INSERT INTO participant_audit_logs (event_id, registration_id, actor_user_id, action, details, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', '-3 hours'))
    `).run(
      eventId,
      registrationId,
      actorUserId,
      action,
      JSON.stringify(details)
    );
  },
  getArticlesByEvent: (eventId) => {
    return db.prepare(`
      SELECT a.*, 
        COUNT(DISTINCT r.id) as report_count,
        GROUP_CONCAT(DISTINCT u.name) as assigned_reviewers
      FROM articles a
      LEFT JOIN assignments ass ON ass.article_id = a.id
      LEFT JOIN users u ON u.id = ass.reviewer_id
      LEFT JOIN reports r ON r.assignment_id = ass.id
      WHERE a.event_id = ?
        AND a.status != 'draft'
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `).bind(eventId).all();
  },
  getStatsByEvent: (eventId) => {
    const total = db.prepare("SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status != 'draft'").bind(eventId).get().count;
    const pending = db.prepare("SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status = 'pending'").bind(eventId).get().count;
    const in_review = db.prepare("SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status = 'in_review'").bind(eventId).get().count;
    const approved = db.prepare("SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status = 'approved'").bind(eventId).get().count;
    const rejected = db.prepare("SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status = 'rejected'").bind(eventId).get().count;
    return { total, pending, in_review, approved, rejected };
  },
  getUnassignedArticles: (eventId) => {
    return db.prepare(`
      SELECT a.* FROM articles a
      WHERE a.event_id = ?
        AND a.status != 'draft'
        AND a.id NOT IN (SELECT DISTINCT article_id FROM assignments)
      ORDER BY a.created_at DESC
    `).bind(eventId).all();
  },
  getArticleById: (articleId) => {
    return db.prepare(`
      SELECT a.*, e.name as event_name, e.area
      FROM articles a
      JOIN events e ON e.id = a.event_id
      WHERE a.id = ?
    `).bind(articleId).get();
  },
  getAssignmentsByEvent: (eventId) => {
    return db.prepare(`
      SELECT 
        a.id as article_id, a.title, a.authors, a.type, a.status,
        ass.id as assignment_id, ass.status as assignment_status,
        u.id as reviewer_id, u.name as reviewer_name,
        rp.id as report_id, rp.score, rp.recommendation
      FROM articles a
      LEFT JOIN assignments ass ON ass.article_id = a.id
      LEFT JOIN users u ON u.id = ass.reviewer_id
      LEFT JOIN reports rp ON rp.assignment_id = ass.id
      WHERE a.event_id = ?
        AND a.status != 'draft'
      ORDER BY a.created_at DESC
    `).bind(eventId).all();
  },
  getPendingReviews: (reviewerUserId) => {
    return db.prepare(`
      SELECT a.id, a.title, a.authors, a.abstract, a.type,
        ass.id as assignment_id, e.name as event_name
      FROM assignments ass
      JOIN articles a ON a.id = ass.article_id
      JOIN events e ON e.id = a.event_id
      LEFT JOIN reports rp ON rp.assignment_id = ass.id
      WHERE ass.reviewer_id = ? AND rp.id IS NULL AND ass.status != 'declined'
      ORDER BY a.date_submitted DESC
    `).bind(reviewerUserId).all();
  },
  getReviewedArticles: (reviewerUserId) => {
    return db.prepare(`
      SELECT a.id, a.title, a.authors, a.type,
        ass.id as assignment_id, rp.id as report_id, rp.score, rp.recommendation, rp.report,
        e.name as event_name
      FROM assignments ass
      JOIN articles a ON a.id = ass.article_id
      JOIN events e ON e.id = a.event_id
      JOIN reports rp ON rp.assignment_id = ass.id
      WHERE ass.reviewer_id = ?
      ORDER BY a.date_submitted DESC
    `).bind(reviewerUserId).all();
  },

  getWorkloadSummaryByEvent: (eventId) => {
    return db.prepare(`
      SELECT
        er.id AS registration_id,
        COUNT(aar.id) AS activities_attended,
        COALESCE(SUM(ea.workload_hours), 0) AS total_workload_hours
      FROM event_registrations er
      LEFT JOIN activity_attendance_records aar
        ON aar.registration_id = er.id
        AND aar.activity_id IN (SELECT id FROM event_activities WHERE event_id = ? AND certificate_enabled = 1)
      LEFT JOIN event_activities ea
        ON ea.id = aar.activity_id
      WHERE er.event_id = ?
      GROUP BY er.id
      ORDER BY er.name COLLATE NOCASE
    `).bind(eventId, eventId).all();
  },

  getActivityAttendanceSummary: (activityId, eventId) => {
    return db.prepare(`
      SELECT
        er.id,
        er.name,
        er.email,
        er.institution,
        er.registration_type,
        CASE WHEN aar.id IS NULL THEN 0 ELSE 1 END AS present,
        COALESCE(SUM(ea.workload_hours) FILTER (WHERE aar.id IS NOT NULL), 0) AS workload
      FROM event_registrations er
      LEFT JOIN activity_attendance_records aar
        ON aar.registration_id = er.id
        AND aar.activity_id = ?
      LEFT JOIN event_activities ea
        ON ea.id = ?
      WHERE er.event_id = ?
      GROUP BY er.id
      ORDER BY er.name COLLATE NOCASE
    `).bind(activityId, activityId, eventId).all();
  },

  getActivitiesByEvent: (eventId) => {
    return db.prepare(`
      SELECT ea.*,
        COUNT(aar.id) AS attendees_count,
        COALESCE(SUM(ea.workload_hours * 1), 0) AS workload_hours
      FROM event_activities ea
      LEFT JOIN activity_attendance_records aar
        ON aar.activity_id = ea.id
      WHERE ea.event_id = ?
      GROUP BY ea.id
      ORDER BY ea.activity_date, ea.name
    `).bind(eventId).all();
  },

  getActivityCertificateRules: (activityId) => {
    return db.prepare(`
      SELECT acr.*, cb.file_path AS background_path, cb.name AS background_name
      FROM activity_certificate_rules acr
      LEFT JOIN certificate_backgrounds cb ON cb.id = acr.background_id
      WHERE acr.activity_id = ?
    `).bind(activityId).get();
  }
};
