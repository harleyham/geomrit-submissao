const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'artigos.db');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const ASSETS_FUNDOS_DIR = path.join(__dirname, '..', 'assets', 'Fundos');

function clearUploads() {
  if (!fs.existsSync(UPLOADS_DIR)) return;

  // Remover recursivamente todo o conteúdo de uploads/
  try {
    fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  } catch(e) {
    console.warn('Erro ao limpar uploads:', UPLOADS_DIR, e.message);
  }
}

function clearCertificateEmissions() {
  // Certificados emitidos em PDF ficam em uploads/certificates (se houver)
  // Esta função é redundante pois clearUploads() já limpou tudo,
  // mas mantemos para clareza de intenção
  const certsDir = path.join(UPLOADS_DIR, 'certificates');
  if (fs.existsSync(certsDir)) {
    try {
      fs.rmSync(certsDir, { recursive: true, force: true });
    } catch(e) {
      console.warn('Erro ao remover certificados:', certsDir, e.message);
    }
  }
}

const TABLES = [
  'activity_attendance_records',
  'activity_certificate_rules',
  'activity_evaluations',
  'activity_sessions',
  'admins',
  'admins_old',
  'article_submissions',
  'articles',
  'assignments',
  'attendance_records',
  'certificate_backgrounds',
  'certificate_emissions',
  'certificate_rules',
  'configs',
  'event_activities',
  'event_certificate_rules',
  'event_registrations',
  'event_qr_codes',
  'event_rooms',
  'event_user_roles',
  'events',
  'email_outbox',
  'email_settings_log',
  'import_batch_entries',
  'import_batches',
  'notifications',
  'participant_activity_enrollments',
  'participant_activity_interests',
  'participant_audit_logs',
  'payments',
  'reports',
  'reviewer_availability',
  'reviewers',
  'room_assignments',
  'sessions',
  'subsidy_documents',
  'subsidy_requests',
  'user_preferences',
  'user_setup_tokens',
  'system_settings',
  'users',
];

const ROOM_DDL = `
    CREATE TABLE IF NOT EXISTS event_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      size TEXT NOT NULL DEFAULT 'type1',
      capacity INTEGER,
      created_at DATETIME DEFAULT (datetime('now','-3 hours')),
      updated_at DATETIME DEFAULT (datetime('now','-3 hours')),
      UNIQUE(event_id,name),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS room_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      activity_id INTEGER,
      session_id INTEGER,
      date DATE NOT NULL,
      time_start TIME NOT NULL,
      time_end TIME NOT NULL,
      is_event_reservation INTEGER NOT NULL DEFAULT 0,
      assigned_by INTEGER,
      created_at DATETIME DEFAULT (datetime('now','-3 hours')),
      updated_at DATETIME DEFAULT (datetime('now','-3 hours')),
      CHECK ((activity_id IS NOT NULL) + (session_id IS NOT NULL) + (is_event_reservation = 1) <= 1),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(room_id) REFERENCES event_rooms(id) ON DELETE CASCADE,
      FOREIGN KEY(activity_id) REFERENCES event_activities(id) ON DELETE CASCADE,
      FOREIGN KEY(session_id) REFERENCES activity_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_room_assignments_room ON room_assignments(room_id,date);
    CREATE INDEX IF NOT EXISTS idx_room_assignments_event ON room_assignments(event_id,date);
`;

function initializeDbSchema(db) {
  const hadParticipantActivityEnrollments = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='participant_activity_enrollments'").get());

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
      is_staff INTEGER DEFAULT 0,
      is_public INTEGER DEFAULT 1,
      approval_status TEXT DEFAULT 'approved',
      approved_at DATETIME,
      approved_by INTEGER,
      password_changed INTEGER DEFAULT 0,
      profile_completed INTEGER DEFAULT 1,
      phone TEXT DEFAULT '',
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
      public_registration INTEGER DEFAULT 1,
      registration_approval_mode TEXT NOT NULL DEFAULT 'automatic',
      email_enabled INTEGER NOT NULL DEFAULT 0,
      email_platform_name TEXT,
      email_sender_name TEXT,
      email_signature TEXT,
      email_contact TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      registration_start DATE,
      registration_end DATE,
      submission_start DATE,
      submission_end DATE,
      review_start DATE,
      review_end DATE,
      certificates_start DATE,
      certificates_end DATE,
      logo_path TEXT,
      logo_original_name TEXT,
      content_pdf_path TEXT,
      content_pdf_original_name TEXT,
      created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
      updated_at DATETIME DEFAULT (datetime('now', '-3 hours'))
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      email_enabled INTEGER NOT NULL DEFAULT 0,
      updated_by INTEGER,
      updated_at DATETIME DEFAULT (datetime('now', '-3 hours')),
      FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE SET NULL
    );
    INSERT OR IGNORE INTO system_settings (id,email_enabled) VALUES (1,0);

    CREATE TABLE IF NOT EXISTS email_settings_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enabled INTEGER NOT NULL,
      changed_by INTEGER,
      cancelled_count INTEGER NOT NULL DEFAULT 0,
      scope TEXT NOT NULL DEFAULT 'system',
      event_id INTEGER,
      created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
      FOREIGN KEY(changed_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_setup_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      revoked_at DATETIME,
      created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_type TEXT NOT NULL,
      event_id INTEGER,
      imported_by INTEGER,
      email_authorized_at DATETIME,
      email_authorized_by INTEGER,
      created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(imported_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(email_authorized_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS import_batch_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      user_id INTEGER,
      registration_id INTEGER,
      recipient_name TEXT,
      recipient_email TEXT,
      outcome TEXT NOT NULL,
      email_kind TEXT,
      email_status TEXT NOT NULL DEFAULT 'not_applicable',
      created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
      FOREIGN KEY(batch_id) REFERENCES import_batches(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(registration_id) REFERENCES event_registrations(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS email_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER,
      user_id INTEGER,
      setup_token_id INTEGER,
      recipient_email TEXT NOT NULL,
      recipient_name TEXT,
      message_type TEXT NOT NULL,
      template_name TEXT NOT NULL,
      subject TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      from_name TEXT,
      reply_to TEXT,
      logo_path TEXT,
      group_key TEXT,
      dedupe_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at DATETIME DEFAULT (datetime('now', '-3 hours')),
      next_attempt_at DATETIME,
      last_error TEXT,
      sent_at DATETIME,
      cancelled_at DATETIME,
      created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
      updated_at DATETIME DEFAULT (datetime('now', '-3 hours')),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(setup_token_id) REFERENCES user_setup_tokens(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_email_outbox_worker ON email_outbox(status,available_at,next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_email_outbox_event ON email_outbox(event_id,status);
    CREATE INDEX IF NOT EXISTS idx_import_batch_entries_batch ON import_batch_entries(batch_id,email_kind);

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
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      institution TEXT DEFAULT '',
      registration_type TEXT NOT NULL DEFAULT 'listener',
      registration_status TEXT NOT NULL DEFAULT 'approved',
      requested_activity_ids TEXT DEFAULT '[]',
      rejected_activity_ids TEXT DEFAULT '[]',
      registration_review_notes TEXT DEFAULT '',
      registration_reviewed_at DATETIME,
      registration_reviewed_by INTEGER,
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
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
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
      role TEXT NOT NULL CHECK(role IN ('admin', 'staff', 'participant', 'reviewer', 'speaker', 'teacher', 'oral_presenter', 'poster_presenter')),
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
      min_attendance INTEGER NOT NULL DEFAULT 75 CHECK(min_attendance >= 0 AND min_attendance <= 100),
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

    CREATE TABLE IF NOT EXISTS event_activities (id INTEGER PRIMARY KEY AUTOINCREMENT,event_id INTEGER NOT NULL,name TEXT NOT NULL,activity_type TEXT NOT NULL DEFAULT 'other',description TEXT DEFAULT '',activity_date DATE,date_start DATE,date_end DATE,time_start TIME,time_end TIME,workload_hours REAL DEFAULT 0,certificate_enabled INTEGER DEFAULT 1,eligible_roles TEXT DEFAULT 'participant',certificate_role TEXT DEFAULT 'participant',video_url TEXT,has_video INTEGER DEFAULT 0,max_participants INTEGER,requires_approval INTEGER DEFAULT 0,created_at DATETIME DEFAULT (datetime('now','-3 hours')),FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS activity_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT,activity_id INTEGER NOT NULL,name TEXT NOT NULL,sequence_no INTEGER NOT NULL DEFAULT 1,session_date DATE,time_start TIME,time_end TIME,workload_hours REAL DEFAULT 0,description TEXT DEFAULT '',video_url TEXT,has_video INTEGER DEFAULT 0,created_at DATETIME DEFAULT (datetime('now','-3 hours')),FOREIGN KEY(activity_id) REFERENCES event_activities(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS activity_evaluations (id INTEGER PRIMARY KEY AUTOINCREMENT,event_id INTEGER NOT NULL,activity_id INTEGER NOT NULL,user_id INTEGER NOT NULL,evaluation TEXT NOT NULL,created_at DATETIME DEFAULT (datetime('now','-3 hours')),updated_at DATETIME DEFAULT (datetime('now','-3 hours')),UNIQUE(activity_id,user_id),FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,FOREIGN KEY(activity_id) REFERENCES event_activities(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
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
    CREATE TABLE IF NOT EXISTS participant_activity_interests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      activity_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      registration_id INTEGER,
      created_at DATETIME DEFAULT (datetime('now','-3 hours')),
      UNIQUE(activity_id,user_id),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(activity_id) REFERENCES event_activities(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(registration_id) REFERENCES event_registrations(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS activity_attendance_records (id INTEGER PRIMARY KEY AUTOINCREMENT,activity_id INTEGER NOT NULL,registration_id INTEGER,user_id INTEGER,marked_by INTEGER,attended_at DATETIME DEFAULT (datetime('now','-3 hours')),UNIQUE(activity_id,registration_id),FOREIGN KEY(activity_id) REFERENCES event_activities(id) ON DELETE CASCADE,FOREIGN KEY(registration_id) REFERENCES event_registrations(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS activity_certificate_rules (activity_id INTEGER PRIMARY KEY,min_attendance INTEGER NOT NULL DEFAULT 1,background_id INTEGER,FOREIGN KEY(activity_id) REFERENCES event_activities(id) ON DELETE CASCADE,FOREIGN KEY(background_id) REFERENCES certificate_backgrounds(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS event_qr_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL,
      created_at DATETIME DEFAULT (datetime('now', '-3 hours')),
      UNIQUE(event_id, user_id),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_event_qr_codes_token ON event_qr_codes(token);
    ${ROOM_DDL}
  `);

  if (!hadParticipantActivityEnrollments) {
    db.exec(`INSERT OR IGNORE INTO participant_activity_enrollments (activity_id,registration_id,user_id)
      SELECT ea.id,er.id,er.user_id
      FROM event_registrations er JOIN event_activities ea ON ea.event_id=er.event_id
      WHERE er.user_id IS NOT NULL
        AND instr(',' || replace(COALESCE(ea.eligible_roles,''),' ','') || ',', ',participant,') > 0`);
  }

  try { const cols=db.prepare("PRAGMA table_info(certificate_emissions)").all().map(c=>c.name); if(!cols.includes('activity_id')) db.exec('ALTER TABLE certificate_emissions ADD COLUMN activity_id INTEGER'); } catch(e){}
  try {
    const emissionCols = db.prepare("PRAGMA table_info(certificate_emissions)").all().map(c => c.name);
    if (!emissionCols.includes('activities_attended')) db.exec('ALTER TABLE certificate_emissions ADD COLUMN activities_attended INTEGER DEFAULT 0');
    if (!emissionCols.includes('total_workload_hours')) db.exec('ALTER TABLE certificate_emissions ADD COLUMN total_workload_hours REAL DEFAULT 0');
    if (!emissionCols.includes('activities_summary')) db.exec("ALTER TABLE certificate_emissions ADD COLUMN activities_summary TEXT DEFAULT ''");
    if (!emissionCols.includes('text_color')) db.exec('ALTER TABLE certificate_emissions ADD COLUMN text_color TEXT DEFAULT "#0f172a"');
  } catch(e) {}
  try {
    const ruleCols = db.prepare('PRAGMA table_info(certificate_rules)').all().map(c => c.name);
    if (!ruleCols.includes('text_color')) db.exec('ALTER TABLE certificate_rules ADD COLUMN text_color TEXT DEFAULT "#0f172a"');
  } catch(e) {}
  try {
    db.exec(`
      UPDATE event_rooms SET size='type1', capacity=COALESCE(capacity,10)  WHERE size='small';
      UPDATE event_rooms SET size='type2', capacity=COALESCE(capacity,50)  WHERE size='medium';
      UPDATE event_rooms SET size='type3', capacity=COALESCE(capacity,100) WHERE size='large';
    `);
  } catch(e) {}
  try {
    const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
    for (const column of ['is_participant', 'is_speaker', 'is_teacher', 'is_oral_presenter', 'is_poster_presenter', 'is_staff']) {
      if (!userColumns.includes(column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} INTEGER DEFAULT 0`);
    }
    db.exec(`UPDATE users SET is_participant = 1 WHERE id IN (SELECT user_id FROM event_registrations WHERE user_id IS NOT NULL)`);
  } catch (e) {}
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
  } catch (e) {}
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
    db.exec(`INSERT OR IGNORE INTO event_user_roles (event_id,user_id,role,assigned_by)
      SELECT e.id,u.id,'admin',u.id FROM events e JOIN users u ON u.is_admin=1`);
  } catch (e) { try { db.pragma('foreign_keys = ON'); } catch (_) {} }
  try {
    const rolesSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='event_user_roles'").get()?.sql || '';
    if (rolesSql.includes('event_user_roles') && !rolesSql.includes("'staff'")) {
      db.pragma('foreign_keys = OFF');
      db.transaction(() => {
        db.exec(`CREATE TABLE event_user_roles_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,event_id INTEGER NOT NULL,user_id INTEGER NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('admin','staff','participant','reviewer','speaker','teacher','oral_presenter','poster_presenter')),
          article_id INTEGER,assigned_by INTEGER,created_at DATETIME DEFAULT (datetime('now','-3 hours')),
          UNIQUE(event_id,user_id,role),FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE SET NULL,
          FOREIGN KEY(assigned_by) REFERENCES users(id) ON DELETE SET NULL);
          INSERT INTO event_user_roles_new SELECT * FROM event_user_roles;
          DROP TABLE event_user_roles; ALTER TABLE event_user_roles_new RENAME TO event_user_roles;`);
      })();
      db.pragma('foreign_keys = ON');
    }
  } catch (e) { try { db.pragma('foreign_keys = ON'); } catch (_) {} }
  try {
    const activityColumns = db.prepare('PRAGMA table_info(event_activities)').all().map((column) => column.name);
    if (!activityColumns.includes('description')) db.exec("ALTER TABLE event_activities ADD COLUMN description TEXT DEFAULT ''");
    if (!activityColumns.includes('eligible_roles')) db.exec("ALTER TABLE event_activities ADD COLUMN eligible_roles TEXT DEFAULT 'participant'");
    if (!activityColumns.includes('certificate_role')) db.exec("ALTER TABLE event_activities ADD COLUMN certificate_role TEXT DEFAULT 'participant'");
    const activityAttendanceColumns = db.prepare('PRAGMA table_info(activity_attendance_records)').all().map((column) => column.name);
    if (!activityAttendanceColumns.includes('user_id')) db.exec('ALTER TABLE activity_attendance_records ADD COLUMN user_id INTEGER');
    db.exec('UPDATE activity_attendance_records SET user_id=(SELECT user_id FROM event_registrations er WHERE er.id=activity_attendance_records.registration_id) WHERE user_id IS NULL');
    if (!activityAttendanceColumns.includes('session_id')) db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_activity_attendance_user ON activity_attendance_records(activity_id,user_id) WHERE user_id IS NOT NULL');
  } catch (e) {}
  try {
    const aaColumns = db.prepare('PRAGMA table_info(activity_attendance_records)').all().map((c) => c.name);
    if (!aaColumns.includes('role')) {
      db.exec("ALTER TABLE activity_attendance_records ADD COLUMN role TEXT DEFAULT 'participant'");
      db.prepare("UPDATE activity_attendance_records SET role = 'participant' WHERE role IS NULL").run();
    }
  } catch (e) {}
  try {
    const activityDateColumns = db.prepare('PRAGMA table_info(event_activities)').all().map((column) => column.name);
    if (!activityDateColumns.includes('date_start')) db.exec('ALTER TABLE event_activities ADD COLUMN date_start DATE');
    if (!activityDateColumns.includes('date_end')) db.exec('ALTER TABLE event_activities ADD COLUMN date_end DATE');
    if (!activityDateColumns.includes('video_url')) db.exec('ALTER TABLE event_activities ADD COLUMN video_url TEXT');
    if (!activityDateColumns.includes('has_video')) db.exec('ALTER TABLE event_activities ADD COLUMN has_video INTEGER DEFAULT 0');
    if (!activityDateColumns.includes('max_participants')) db.exec('ALTER TABLE event_activities ADD COLUMN max_participants INTEGER');
    if (!activityDateColumns.includes('requires_approval')) db.exec('ALTER TABLE event_activities ADD COLUMN requires_approval INTEGER DEFAULT 0');
    const sessionVideoColumns = db.prepare('PRAGMA table_info(activity_sessions)').all().map((column) => column.name);
    if (!sessionVideoColumns.includes('video_url')) db.exec('ALTER TABLE activity_sessions ADD COLUMN video_url TEXT');
    if (!sessionVideoColumns.includes('has_video')) db.exec('ALTER TABLE activity_sessions ADD COLUMN has_video INTEGER DEFAULT 0');
    if (!sessionVideoColumns.includes('description')) db.exec("ALTER TABLE activity_sessions ADD COLUMN description TEXT DEFAULT ''");
    db.exec('UPDATE event_activities SET date_start=activity_date WHERE date_start IS NULL AND activity_date IS NOT NULL');
  } catch (e) {}
  try {
    const activityTimeColumns = db.prepare('PRAGMA table_info(event_activities)').all().map((column) => column.name);
    if (!activityTimeColumns.includes('time_start')) db.exec('ALTER TABLE event_activities ADD COLUMN time_start TIME');
    if (!activityTimeColumns.includes('time_end')) db.exec('ALTER TABLE event_activities ADD COLUMN time_end TIME');
    const sessionTimeColumns = db.prepare('PRAGMA table_info(activity_sessions)').all().map((column) => column.name);
    if (!sessionTimeColumns.includes('time_start')) db.exec('ALTER TABLE activity_sessions ADD COLUMN time_start TIME');
    if (!sessionTimeColumns.includes('time_end')) db.exec('ALTER TABLE activity_sessions ADD COLUMN time_end TIME');
    db.exec(ROOM_DDL);
  } catch (e) {}
  try {
    const sessionColumns = db.prepare('PRAGMA table_info(activity_attendance_records)').all().map((c) => c.name);
    if (!sessionColumns.includes('session_id')) {
      db.pragma('foreign_keys = OFF');
      db.transaction(() => {
        db.exec(`CREATE TABLE activity_attendance_records_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          activity_id INTEGER NOT NULL,
          registration_id INTEGER,
          marked_by INTEGER,
          attended_at DATETIME DEFAULT (datetime('now','-3 hours')),
          user_id INTEGER,
          role TEXT DEFAULT 'participant',
          session_id INTEGER,
          FOREIGN KEY(activity_id) REFERENCES event_activities(id) ON DELETE CASCADE,
          FOREIGN KEY(registration_id) REFERENCES event_registrations(id) ON DELETE SET NULL,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(session_id) REFERENCES activity_sessions(id) ON DELETE CASCADE
        )`);
        db.exec(`INSERT INTO activity_attendance_records_new (id,activity_id,registration_id,marked_by,attended_at,user_id,role)
          SELECT id,activity_id,registration_id,marked_by,attended_at,user_id,COALESCE(role,'participant') FROM activity_attendance_records`);
        db.exec('DROP TABLE activity_attendance_records');
        db.exec('ALTER TABLE activity_attendance_records_new RENAME TO activity_attendance_records');
      })();
      db.pragma('foreign_keys = ON');
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_activity_attendance_no_session ON activity_attendance_records(activity_id,user_id) WHERE user_id IS NOT NULL AND session_id IS NULL');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_activity_attendance_session_user ON activity_attendance_records(activity_id,session_id,user_id) WHERE user_id IS NOT NULL AND session_id IS NOT NULL');
  } catch (e) { try { db.pragma('foreign_keys = ON'); } catch (_) {} }
  try {
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
  } catch (e) {}
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
  } catch (e) { try { db.pragma('foreign_keys = ON'); } catch (_) {} }
  try {
    db.prepare(`INSERT OR IGNORE INTO event_certificate_rules
      (event_id,certificate_role,min_attendance,background_id,text_color,updated_by,created_at,updated_at)
      SELECT event_id,'participant',min_attendance,background_id,COALESCE(text_color,'#0f172a'),updated_by,created_at,updated_at FROM certificate_rules`).run();
  } catch (e) {}

  try {
    const backgroundCols = db.prepare('PRAGMA table_info(certificate_backgrounds)').all().map((column) => column.name);
    if (!backgroundCols.includes('event_id')) db.exec('ALTER TABLE certificate_backgrounds ADD COLUMN event_id INTEGER REFERENCES events(id) ON DELETE CASCADE');
    db.exec('CREATE INDEX IF NOT EXISTS idx_certificate_backgrounds_event ON certificate_backgrounds(event_id)');
    const unownedUploads = db.prepare(`
      SELECT id FROM certificate_backgrounds
      WHERE event_id IS NULL AND substr(file_path,1,7) = 'uploads'
    `).all();
    const referencingEvents = db.prepare('SELECT DISTINCT event_id FROM event_certificate_rules WHERE background_id = ? ORDER BY event_id');
    const ownershipRules = [
      { table: 'event_certificate_rules', key: 'event_id' },
      { table: 'certificate_rules', key: 'event_id' }
    ];
    for (const background of unownedUploads) {
      const owners = referencingEvents.all(background.id);
      owners.forEach((owner, index) => {
        if (index === 0) {
          db.prepare('UPDATE certificate_backgrounds SET event_id = ? WHERE id = ?').run(owner.event_id, background.id);
          return;
        }
        const source = db.prepare('SELECT name,file_path,original_name,mime_type,created_by,created_at FROM certificate_backgrounds WHERE id = ?').get(background.id);
        const copy = db.prepare(`INSERT INTO certificate_backgrounds (name,file_path,original_name,mime_type,created_by,created_at,event_id)
          VALUES (?,?,?,?,?,?,?)`)
          .run(source.name, source.file_path, source.original_name, source.mime_type, source.created_by, source.created_at, owner.event_id);
        for (const rule of ownershipRules) {
          try {
            db.prepare(`UPDATE ${rule.table} SET background_id = ? WHERE ${rule.key} = ? AND background_id = ?`)
              .run(copy.lastInsertRowid, owner.event_id, background.id);
          } catch (e) {}
        }
      });
    }
  } catch (e) {}

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
    CREATE INDEX IF NOT EXISTS idx_participant_activity_interests_user_event ON participant_activity_interests(user_id, event_id);
    CREATE INDEX IF NOT EXISTS idx_activity_evaluations_event ON activity_evaluations(event_id, activity_id);
    CREATE INDEX IF NOT EXISTS idx_activity_evaluations_user ON activity_evaluations(user_id);
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

    DROP TRIGGER IF EXISTS trg_sync_user_to_event_registration;

    CREATE TRIGGER IF NOT EXISTS trg_sync_user_to_event_registration
    AFTER UPDATE OF name, phone, institution ON users
    WHEN OLD.name != NEW.name OR OLD.phone != NEW.phone OR OLD.institution != NEW.institution
    BEGIN
      UPDATE event_registrations
      SET name=NEW.name, phone=NEW.phone, institution=NEW.institution,
          updated_at=datetime('now','-3 hours')
      WHERE user_id=NEW.id;
    END;
  `);

  // Register default backgrounds
  const defaultBackgroundDir = path.join(__dirname, '..', 'assets', 'Fundos');
  if (fs.existsSync(defaultBackgroundDir)) {
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

  // Migrate legacy reviewers/admins
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map(t => t.name);
    if (tableNames.includes('admins')) {
      db.pragma('foreign_keys = OFF');
      const reviewerMap = {};
      const reviewerRows = db.prepare('SELECT id, name, email, password, is_active FROM reviewers').all();
      reviewerRows.forEach(r => {
        const existing = db.prepare('SELECT id FROM users WHERE email = ?').bind(r.email).get();
        const userId = existing ? existing.id : null;
        reviewerMap[r.id] = userId;
        if (!existing) {
          const newId = db.prepare('INSERT INTO users (name, email, password, is_reviewer, is_public, password_changed) VALUES (?, ?, ?, 1, 1, 0)').bind(r.name, r.email, bcrypt.hashSync(r.password, 10)).get().insertId;
          reviewerMap[r.id] = newId;
        }
      });
      const adminRows = db.prepare('SELECT id, username, password FROM admins').all();
      adminRows.forEach(a => {
        const existing = db.prepare('SELECT id FROM users WHERE email = ?').bind(a.username).get();
        if (!existing) {
          db.prepare('INSERT INTO users (name, email, password, is_admin, password_changed) VALUES (?, ?, ?, 1, 0)').bind(a.username, a.username, bcrypt.hashSync(a.password, 10)).run();
        }
      });
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
  } catch(e) { console.warn('Migration warning:', e.message); }

  // Migrate users columns
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
  } catch(e) {}

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
  } catch(e) {}

  try {
    const deprecatedArticleColumns = ['reviewer_id', 'reviewer_name', 'reviewer_area', 'review_notes', 'rejection_reason'];
    const articleColumns = db.prepare("PRAGMA table_info(articles)").all().map(c => c.name);
    deprecatedArticleColumns
      .filter((column) => articleColumns.includes(column))
      .forEach((column) => db.exec(`ALTER TABLE articles DROP COLUMN ${column}`));
  } catch(e) {}

  try {
    const eventColumns = db.prepare("PRAGMA table_info(events)").all().map(c => c.name);
    if (!eventColumns.includes('has_article_submission')) db.exec('ALTER TABLE events ADD COLUMN has_article_submission INTEGER DEFAULT 0');
    if (!eventColumns.includes('offers_subsidy')) db.exec('ALTER TABLE events ADD COLUMN offers_subsidy INTEGER DEFAULT 0');
    if (!eventColumns.includes('public_registration')) db.exec('ALTER TABLE events ADD COLUMN public_registration INTEGER DEFAULT 1');
    if (!eventColumns.includes('registration_approval_mode')) db.exec("ALTER TABLE events ADD COLUMN registration_approval_mode TEXT NOT NULL DEFAULT 'automatic'");
    if (!eventColumns.includes('email_enabled')) db.exec('ALTER TABLE events ADD COLUMN email_enabled INTEGER NOT NULL DEFAULT 0');
    if (!eventColumns.includes('email_platform_name')) db.exec('ALTER TABLE events ADD COLUMN email_platform_name TEXT');
    if (!eventColumns.includes('email_sender_name')) db.exec('ALTER TABLE events ADD COLUMN email_sender_name TEXT');
    if (!eventColumns.includes('email_signature')) db.exec('ALTER TABLE events ADD COLUMN email_signature TEXT');
    if (!eventColumns.includes('email_contact')) db.exec('ALTER TABLE events ADD COLUMN email_contact TEXT');
    if (!eventColumns.includes('institution')) db.exec('ALTER TABLE events ADD COLUMN institution TEXT');
    if (!eventColumns.includes('language')) db.exec('ALTER TABLE events ADD COLUMN language TEXT');
    if (!eventColumns.includes('registration_start')) db.exec('ALTER TABLE events ADD COLUMN registration_start DATE');
    if (!eventColumns.includes('registration_end')) db.exec('ALTER TABLE events ADD COLUMN registration_end DATE');
    if (!eventColumns.includes('review_start')) db.exec('ALTER TABLE events ADD COLUMN review_start DATE');
    if (!eventColumns.includes('review_end')) db.exec('ALTER TABLE events ADD COLUMN review_end DATE');
    if (!eventColumns.includes('certificates_start')) db.exec('ALTER TABLE events ADD COLUMN certificates_start DATE');
    if (!eventColumns.includes('certificates_end')) db.exec('ALTER TABLE events ADD COLUMN certificates_end DATE');
    if (!eventColumns.includes('logo_path')) db.exec('ALTER TABLE events ADD COLUMN logo_path TEXT');
    if (!eventColumns.includes('logo_original_name')) db.exec('ALTER TABLE events ADD COLUMN logo_original_name TEXT');
    if (!eventColumns.includes('content_pdf_path')) db.exec('ALTER TABLE events ADD COLUMN content_pdf_path TEXT');
    if (!eventColumns.includes('content_pdf_original_name')) db.exec('ALTER TABLE events ADD COLUMN content_pdf_original_name TEXT');
    db.prepare(`
      UPDATE events
      SET has_article_submission = CASE
        WHEN COALESCE(submission_start, submission_end, review_start, review_end) IS NOT NULL THEN 1
        ELSE 0
      END
      WHERE has_article_submission IS NULL
         OR (has_article_submission = 0 AND COALESCE(submission_start, submission_end, review_start, review_end) IS NOT NULL)
    `).run();
  } catch(e) {}

  try {
    const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!userColumns.includes('formacao_area')) db.exec("ALTER TABLE users ADD COLUMN formacao_area TEXT");
    if (!userColumns.includes('formacao_curso')) db.exec("ALTER TABLE users ADD COLUMN formacao_curso TEXT");
    if (!userColumns.includes('formacao_titulacao')) db.exec("ALTER TABLE users ADD COLUMN formacao_titulacao TEXT");
    if (!userColumns.includes('formacao_status')) db.exec("ALTER TABLE users ADD COLUMN formacao_status TEXT");
    if (!userColumns.includes('profile_completed')) db.exec("ALTER TABLE users ADD COLUMN profile_completed INTEGER DEFAULT 1");
  } catch(e) {}

  try {
    const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!userColumns.includes('phone')) db.exec("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''");

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
    if (!registrationColumns.includes('phone')) db.exec("ALTER TABLE event_registrations ADD COLUMN phone TEXT DEFAULT ''");
    if (!registrationColumns.includes('registration_status')) db.exec("ALTER TABLE event_registrations ADD COLUMN registration_status TEXT NOT NULL DEFAULT 'approved'");
    if (!registrationColumns.includes('requested_activity_ids')) db.exec("ALTER TABLE event_registrations ADD COLUMN requested_activity_ids TEXT DEFAULT '[]'");
    if (!registrationColumns.includes('rejected_activity_ids')) db.exec("ALTER TABLE event_registrations ADD COLUMN rejected_activity_ids TEXT DEFAULT '[]'");
    if (!registrationColumns.includes('registration_review_notes')) db.exec("ALTER TABLE event_registrations ADD COLUMN registration_review_notes TEXT DEFAULT ''");
    if (!registrationColumns.includes('registration_reviewed_at')) db.exec('ALTER TABLE event_registrations ADD COLUMN registration_reviewed_at DATETIME');
    if (!registrationColumns.includes('registration_reviewed_by')) db.exec('ALTER TABLE event_registrations ADD COLUMN registration_reviewed_by INTEGER');
    db.prepare(`
      UPDATE event_registrations
      SET subsidy_status = CASE
        WHEN subsidy_requested = 1 THEN 'pending'
        ELSE 'not_requested'
      END
      WHERE subsidy_status IS NULL OR TRIM(subsidy_status) = ''
    `).run();
  } catch(e) {}

  try {
    const authorRegistrations = db.prepare(`
      SELECT event_id, submitter_user_id, contributor, email_submission, affiliation
      FROM articles WHERE status != 'draft' AND email_submission IS NOT NULL AND TRIM(email_submission) != ''
      GROUP BY event_id, LOWER(TRIM(email_submission)), COALESCE(submitter_user_id, 0)
    `).all();

    const findEventRegistration = db.prepare(`
      SELECT id, registration_type FROM event_registrations
      WHERE event_id = ? AND ((user_id IS NOT NULL AND user_id = ?) OR LOWER(TRIM(email)) = LOWER(TRIM(?)))
      ORDER BY id LIMIT 1
    `);

    const updateEventRegistration = db.prepare(`
      UPDATE event_registrations
      SET user_id = ?, name = ?, email = ?, institution = ?, registration_type = 'author', updated_at = datetime('now', '-3 hours')
      WHERE id = ?
    `);

    const insertEventRegistration = db.prepare(`
      INSERT INTO event_registrations (event_id, user_id, name, email, institution, registration_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'author', datetime('now', '-3 hours'), datetime('now', '-3 hours'))
    `);

    const findUserByEmailForArticle = db.prepare('SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1');

    authorRegistrations.forEach((registration) => {
      const userByEmail = findUserByEmailForArticle.get(registration.email_submission);
      const userId = registration.submitter_user_id || (userByEmail ? userByEmail.id : null);
      if (!userId) return; // artigo legado sem autor identificável: não criar inscrição sem conta
      const existing = findEventRegistration.get(registration.event_id, userId, registration.email_submission);
      if (existing) {
        updateEventRegistration.run(userId, registration.contributor || registration.email_submission, registration.email_submission, registration.affiliation || '', existing.id);
      } else {
        insertEventRegistration.run(registration.event_id, userId, registration.contributor || registration.email_submission, registration.email_submission, registration.affiliation || '');
      }
    });
  } catch(e) {}

  try {
    const regColumns = db.prepare('PRAGMA table_info(event_registrations)').all();
    const userIdColumn = regColumns.find((column) => column.name === 'user_id');
    if (userIdColumn && !userIdColumn.notnull) {
      const findUserByEmail = db.prepare('SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1');
      const linkRegistrationUser = db.prepare("UPDATE event_registrations SET user_id = ?, updated_at = datetime('now', '-3 hours') WHERE id = ?");
      const insertOrphanUser = db.prepare(`
        INSERT INTO users (name, email, password, institution, phone, is_public, approval_status, approved_at, password_changed, profile_completed, is_participant, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 'approved', datetime('now', '-3 hours'), 0, 0, 1, datetime('now', '-3 hours'), datetime('now', '-3 hours'))
      `);
      const orphans = db.prepare('SELECT * FROM event_registrations WHERE user_id IS NULL').all();
      const autoCreated = [];
      for (const orphan of orphans) {
        const match = orphan.email ? findUserByEmail.get(orphan.email) : null;
        let userId = match ? match.id : null;
        if (!userId) {
          userId = insertOrphanUser.run(
            orphan.name || 'Participante sem conta',
            orphan.email || `sem-email-${orphan.event_id}-${orphan.id}@sem-email.invalid`,
            bcrypt.hashSync(crypto.randomBytes(24).toString('base64url'), 10),
            orphan.institution || null,
            orphan.phone || null
          ).lastInsertRowid;
          autoCreated.push({ registrationId: orphan.id, userId });
        }
        linkRegistrationUser.run(userId, orphan.id);
      }
      if (orphans.length) {
        console.log(`[migração] ${orphans.length} inscrição(ões) sem conta vinculada foram vinculadas (${orphans.length - autoCreated.length} por e-mail, ${autoCreated.length} com conta criada) antes de impor user_id NOT NULL em event_registrations.`);
      }
      if (autoCreated.length) {
        console.log('[migração] Contas criadas sem senha conhecida (use "Resetar Senha" em /admin/users para enviar link de definição):', autoCreated.map((item) => `inscrição ${item.registrationId} -> conta ${item.userId}`).join(', '));
      }
      db.pragma('foreign_keys = OFF');
      db.exec('DROP TRIGGER IF EXISTS trg_sync_event_registration_activity_user; DROP TRIGGER IF EXISTS trg_sync_user_to_event_registration;');
      db.transaction(() => {
        const currentSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='event_registrations'").get().sql;
        const rebuiltSql = currentSql
          .replace(/\buser_id\s+INTEGER\b/, 'user_id INTEGER NOT NULL')
          .replace(/FOREIGN KEY\s*\(\s*user_id\s*\)\s*REFERENCES\s+users\s*\(\s*id\s*\)\s*ON DELETE SET NULL/i, 'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE')
          .replace('CREATE TABLE event_registrations', 'CREATE TABLE event_registrations_new');
        db.exec(rebuiltSql);
        const columnNames = regColumns.map((column) => column.name).join(',');
        db.exec(`INSERT INTO event_registrations_new (${columnNames}) SELECT ${columnNames} FROM event_registrations`);
        db.exec('DROP TABLE event_registrations');
        db.exec('ALTER TABLE event_registrations_new RENAME TO event_registrations');
      })();
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_event_registrations_event_id ON event_registrations(event_id);
        CREATE INDEX IF NOT EXISTS idx_event_registrations_user_id ON event_registrations(user_id);
        CREATE INDEX IF NOT EXISTS idx_event_registrations_email ON event_registrations(email);
        CREATE INDEX IF NOT EXISTS idx_event_registrations_type ON event_registrations(registration_type);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_event_registration_email ON event_registrations(event_id, LOWER(TRIM(email))) WHERE TRIM(email) != '';
        CREATE UNIQUE INDEX IF NOT EXISTS uq_event_registration_user ON event_registrations(event_id, user_id) WHERE user_id IS NOT NULL;
      `);
      db.exec(`
        DROP TRIGGER IF EXISTS trg_sync_event_registration_activity_user;
        CREATE TRIGGER IF NOT EXISTS trg_sync_event_registration_activity_user
        AFTER UPDATE OF user_id ON event_registrations
        WHEN NEW.user_id IS NOT NULL
        BEGIN
          UPDATE participant_activity_enrollments SET user_id=NEW.user_id,updated_at=datetime('now','-3 hours')
          WHERE registration_id=NEW.id;
        END;
        DROP TRIGGER IF EXISTS trg_sync_user_to_event_registration;
        CREATE TRIGGER IF NOT EXISTS trg_sync_user_to_event_registration
        AFTER UPDATE OF name, phone, institution ON users
        WHEN OLD.name != NEW.name OR OLD.phone != NEW.phone OR OLD.institution != NEW.institution
        BEGIN
          UPDATE event_registrations
          SET name=NEW.name, phone=NEW.phone, institution=NEW.institution,
              updated_at=datetime('now','-3 hours')
          WHERE user_id=NEW.id;
        END;
      `);
      db.pragma('foreign_keys = ON');
      console.log('[migração] event_registrations.user_id passou a NOT NULL (FK ON DELETE CASCADE).');
    }
  } catch (e) {
    try { db.pragma('foreign_keys = ON'); } catch (_) {}
    console.error('[migração] Falha ao impor user_id NOT NULL em event_registrations:', e.message);
  }

  // Limpeza de integridade: remove filhos órfãos (inscrições/interesses em
  // atividades sem pai válido), que inflariam contadores de inscritos.
  try {
    const orphanEnrollments = db.prepare(`
      DELETE FROM participant_activity_enrollments
      WHERE activity_id NOT IN (SELECT id FROM event_activities)
         OR registration_id NOT IN (SELECT id FROM event_registrations)
         OR user_id NOT IN (SELECT id FROM users)
    `).run();
    const orphanInterests = db.prepare(`
      DELETE FROM participant_activity_interests
      WHERE activity_id NOT IN (SELECT id FROM event_activities)
         OR user_id NOT IN (SELECT id FROM users)
         OR (registration_id IS NOT NULL AND registration_id NOT IN (SELECT id FROM event_registrations))
    `).run();
    if (orphanEnrollments.changes || orphanInterests.changes) {
      console.log(`[migração] Removidos ${orphanEnrollments.changes} inscrição(ões) e ${orphanInterests.changes} interesse(s) em atividade sem pai válido.`);
    }
  } catch (e) { console.warn('[migração] Limpeza de integridade falhou:', e.message); }

  // Seed admin
  const seedUser = db.prepare('SELECT id FROM users WHERE email = ?').bind('admin@admin.com').get();
  if (!seedUser) {
    const hash = bcrypt.hashSync('123456', 10);
    db.prepare(`
      INSERT INTO users (name, email, password, is_admin, is_reviewer, is_public, approval_status, approved_at, password_changed)
      VALUES (?, ?, ?, 1, 0, 1, 'approved', datetime('now', '-3 hours'), 0)
    `).bind('Administrador', 'admin@admin.com', hash).run();
    console.log('Seed admin criado; troque a senha no primeiro acesso (/login/change-password).');
  }
}

function resetDatabase() {
  // 1. Clear all uploaded files first
  clearUploads();
  clearCertificateEmissions();

  // 2. Close ALL existing database connections WITHOUT deleting cache
  // We need to find all modules that have a db property and close it
  Object.values(require.cache).forEach(mod => {
    if (mod.exports && mod.exports.db && typeof mod.exports.db.close === 'function') {
      try { mod.exports.db.close(); } catch(e) {}
    }
  });

  // 3. Delete database files
  try { fs.unlinkSync(DB_PATH); } catch(e) {}
  try { fs.unlinkSync(DB_PATH + '-shm'); } catch(e) {}
  try { fs.unlinkSync(DB_PATH + '-wal'); } catch(e) {}

  // 4. Create fresh database connection
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);

  // 5. Initialize schema
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initializeDbSchema(db);

  // 6. Point the stable db proxy (db.js) to the new connection.
  // Modules that captured `const { db } = require('../db')` at load time
  // keep working because the proxy always forwards to the current connection.
  require('../db').setDb(db);
}

function getDb() {
  return require.cache[require.resolve('../db')]?.exports?.db;
}

module.exports = { initializeDbSchema, resetDatabase, getDb };
