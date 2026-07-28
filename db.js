const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'artigos.db');
const db = new Database(DB_PATH);

// Habilitar WAL mode para melhor performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
    is_admin INTEGER DEFAULT 0,
    is_reviewer INTEGER DEFAULT 0,
    is_public INTEGER DEFAULT 1,
    approval_status TEXT DEFAULT 'approved',
    approved_at DATETIME,
    approved_by INTEGER,
    password_changed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    status TEXT NOT NULL DEFAULT 'draft',
    submission_start DATE,
    submission_end DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    reviewer_id INTEGER,
    reviewer_name TEXT,
    reviewer_area TEXT,
    review_notes TEXT,
    rejection_reason TEXT,
    date_submitted DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL,
    reviewer_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL,
    score INTEGER CHECK(score BETWEEN 1 AND 5),
    report TEXT,
    recommendation TEXT CHECK(recommendation IN ('approved', 'rejected', 'revision_requested')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
  );
`);

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

// Seed default admin if not exists
const seedUser = db.prepare('SELECT id FROM users WHERE email = ?').bind('admin@admin.com').get();
if (!seedUser) {
  const hash = bcrypt.hashSync('123456', 10);
  db.prepare(`
    INSERT INTO users
    (name, email, password, is_admin, is_reviewer, is_public, approval_status, approved_at, password_changed)
    VALUES (?, ?, ?, 1, 0, 1, 'approved', datetime('now'), 0)
  `).bind('Administrador', 'admin@admin.com', hash).run();
  console.log('Seed admin criado: admin@admin.com / 123456');
}

// Exportar funções úteis
module.exports = {
  db,
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
    const pending = db.prepare('SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status = "pending"').bind(eventId).get().count;
    const in_review = db.prepare('SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status = "in_review"').bind(eventId).get().count;
    const approved = db.prepare('SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status = "approved"').bind(eventId).get().count;
    const rejected = db.prepare('SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status = "rejected"').bind(eventId).get().count;
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
      WHERE ass.reviewer_id = ? AND rp.id IS NULL AND ass.status = 'accepted'
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
  }
};
