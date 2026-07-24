const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'artigos.db');
const db = new Database(DB_PATH);

// Habilitar WAL mode para melhor performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Criar tabelas com schema unificado
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reviewers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT,
    area TEXT NOT NULL,
    institution TEXT,
    bio TEXT,
    is_active INTEGER DEFAULT 1,
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
    abstract TEXT,
    keywords TEXT DEFAULT '',
    pdf_path TEXT,
    contributor TEXT DEFAULT '',
    affiliation TEXT DEFAULT '',
    city TEXT DEFAULT '',
    email_submission TEXT DEFAULT '',
    access_code TEXT,
    type TEXT DEFAULT 'oral',
    status TEXT NOT NULL DEFAULT 'pending',
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
    FOREIGN KEY (reviewer_id) REFERENCES reviewers(id) ON DELETE CASCADE
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

// Inserir admin padrão se não existir (senha vem de variável de ambiente ou padrão)
const adminExists = db.prepare('SELECT id FROM admins WHERE username = ?').get('admin');
if (!adminExists) {
  const defaultPassword = process.env.ADMIN_PASSWORD || 'admin2027';
  const hash = bcrypt.hashSync(defaultPassword, 10);
  db.prepare('INSERT INTO admins (username, password) VALUES (?, ?)').run('admin', hash);
}

// Exportar funções úteis
module.exports = {
  db,
  getArticlesByEvent: (eventId) => {
    return db.prepare(`
      SELECT a.*, 
        COUNT(DISTINCT r.id) as report_count,
        GROUP_CONCAT(DISTINCT re.name) as assigned_reviewers
      FROM articles a
      LEFT JOIN assignments ass ON ass.article_id = a.id
      LEFT JOIN reviewers re ON re.id = ass.reviewer_id
      LEFT JOIN reports r ON r.assignment_id = ass.id
      WHERE a.event_id = ?
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `).all(eventId);
  },
  getStatsByEvent: (eventId) => {
    const total = db.prepare('SELECT COUNT(*) as count FROM articles WHERE event_id = ?').get(eventId).count;
    const pending = db.prepare('SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status = "pending"').get(eventId).count;
    const in_review = db.prepare('SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status = "in_review"').get(eventId).count;
    const approved = db.prepare('SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status = "approved"').get(eventId).count;
    const rejected = db.prepare('SELECT COUNT(*) as count FROM articles WHERE event_id = ? AND status = "rejected"').get(eventId).count;
    return { total, pending, in_review, approved, rejected };
  },
  getUnassignedArticles: (eventId) => {
    return db.prepare(`
      SELECT a.* FROM articles a
      WHERE a.event_id = ?
        AND a.id NOT IN (SELECT DISTINCT article_id FROM assignments)
      ORDER BY a.created_at DESC
    `).all(eventId);
  },
  getArticleById: (articleId) => {
    return db.prepare(`
      SELECT a.*, e.name as event_name, e.area
      FROM articles a
      JOIN events e ON e.id = a.event_id
      WHERE a.id = ?
    `).get(articleId);
  },
  getAssignmentsByEvent: (eventId) => {
    return db.prepare(`
      SELECT a.id, a.title, a.authors, a.type, a.status,
        ass.id as assignment_id, ass.status as assignment_status,
        r.id as reviewer_id, r.name as reviewer_name, r.area as reviewer_area,
        rp.id as report_id, rp.score, rp.recommendation
      FROM articles a
      LEFT JOIN assignments ass ON ass.article_id = a.id
      LEFT JOIN reviewers r ON r.id = ass.reviewer_id
      LEFT JOIN reports rp ON rp.assignment_id = ass.id
      WHERE a.event_id = ?
      ORDER BY a.created_at DESC
    `).all(eventId);
  },
  getPendingReviews: (reviewerId) => {
    return db.prepare(`
      SELECT a.id, a.title, a.authors, a.abstract, a.type,
        ass.id as assignment_id, e.name as event_name
      FROM assignments ass
      JOIN articles a ON a.id = ass.article_id
      JOIN events e ON e.id = a.event_id
      LEFT JOIN reports rp ON rp.assignment_id = ass.id
      WHERE ass.reviewer_id = ? AND rp.id IS NULL AND ass.status = 'accepted'
      ORDER BY a.date_submitted DESC
    `).all(reviewerId);
  },
  getReviewedArticles: (reviewerId) => {
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
    `).all(reviewerId);
  }
};