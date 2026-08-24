const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const { getDb, initializeDbSchema } = require('./db-reset');

const DB_PATH = path.join(__dirname, '..', 'artigos.db');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

function brNow() {
  return new Date(Date.now() - 3 * 3600 * 1000);
}

function backupTimestamp() {
  const d = brNow();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}_${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}`;
}

function backupFileName() {
  return `artigos-backup-${backupTimestamp()}.zip`;
}

function countFilesRecursive(dir) {
  let count = 0;
  if (!fs.existsSync(dir)) return count;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countFilesRecursive(path.join(dir, entry.name));
    else count += 1;
  }
  return count;
}

// Cria um snapshot consistente do banco (VACUUM INTO) e empacota
// banco + uploads + metadados em um ZIP.
async function createBackupZip(destPath) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artigos-backup-'));
  const snapshotPath = path.join(workDir, 'artigos.db');
  try {
    const db = getDb();
    if (!db) throw new Error('Conexão com o banco de dados indisponível.');
    db.prepare('VACUUM INTO ?').run(snapshotPath);

    const meta = {
      app: 'artigos-ligem',
      version: 'V0.2',
      created_at: brNow().toISOString().replace('Z', '-03:00'),
      node: process.version,
      platform: process.platform,
      db_size_bytes: fs.statSync(snapshotPath).size,
      uploads_file_count: countFilesRecursive(UPLOADS_DIR)
    };

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(destPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', () => resolve());
      archive.on('warning', (err) => console.warn('Backup zip warning:', err.message));
      archive.on('error', (err) => {
        try { fs.unlinkSync(destPath); } catch (e) {}
        reject(err);
      });
      archive.pipe(output);
      archive.append(fs.createReadStream(snapshotPath), { name: 'artigos.db' });
      archive.append(JSON.stringify(meta, null, 2), { name: 'BACKUP_META.json' });
      if (fs.existsSync(UPLOADS_DIR)) {
        archive.directory(UPLOADS_DIR, 'uploads');
      }
      archive.finalize();
    });

    return {
      meta,
      dbSize: meta.db_size_bytes,
      uploadsFileCount: meta.uploads_file_count,
      size: fs.statSync(destPath).size
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

// Restaura banco + uploads a partir de um ZIP gerado por createBackupZip.
// Inclui cópia de segurança do banco atual e rollback em caso de falha.
function restoreFromZip(zipPath) {
  let zip;
  try {
    zip = new AdmZip(zipPath);
  } catch (err) {
    throw new Error('O arquivo enviado não é um ZIP válido.');
  }

  const entries = zip.getEntries();
  if (!entries.length) throw new Error('O arquivo de backup está vazio.');

  const pathsSafe = entries.every((entry) => {
    const normalized = path.normalize(entry.entryName);
    return !path.isAbsolute(normalized) && !normalized.startsWith('..') && normalized !== '.';
  });
  if (!pathsSafe) throw new Error('Backup inválido: contém caminhos não permitidos.');

  const dbEntry = entries.find((e) => !e.isDirectory && e.entryName === 'artigos.db')
    || entries.find((e) => !e.isDirectory && !e.entryName.includes('/') && e.entryName.toLowerCase().endsWith('.db'));
  if (!dbEntry) throw new Error('O backup não contém o arquivo do banco de dados (artigos.db).');

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artigos-restore-'));
  let preRestoreMain = null;
  let preRestoreWal = null;
  let newDb = null;
  let swapped = false;

  try {
    zip.extractAllTo(workDir, true);
    const candidateDb = path.join(workDir, path.basename(dbEntry.entryName));
    if (!fs.existsSync(candidateDb)) throw new Error('Arquivo do banco não encontrado após a extração.');

    const Database = require('better-sqlite3');
    const check = new Database(candidateDb, { readonly: true });
    try {
      const integrity = check.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error('Falha no integrity_check do banco do backup.');
      const tables = check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      if (!tables.includes('users') || !tables.includes('events')) {
        throw new Error('O banco do backup não contém as tabelas principais (users, events).');
      }
    } finally {
      check.close();
    }

    // Checkpoint do WAL para a cópia de segurança ser completa
    const liveDb = getDb();
    if (liveDb) {
      try { liveDb.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) {}
    }

    // Fecha todas as conexões em cache
    Object.values(require.cache).forEach((mod) => {
      if (mod.exports && mod.exports.db && typeof mod.exports.db.close === 'function') {
        try { mod.exports.db.close(); } catch (e) {}
      }
    });

    // Cópia de segurança do banco atual (rollback)
    if (fs.existsSync(DB_PATH)) {
      preRestoreMain = DB_PATH + '.pre-restore';
      fs.copyFileSync(DB_PATH, preRestoreMain);
    }
    if (fs.existsSync(DB_PATH + '-wal')) {
      preRestoreWal = DB_PATH + '-wal.pre-restore';
      fs.copyFileSync(DB_PATH + '-wal', preRestoreWal);
    }

    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(DB_PATH + suffix); } catch (e) {}
    }
    fs.copyFileSync(candidateDb, DB_PATH);
    swapped = true;

    newDb = new Database(DB_PATH);
    newDb.pragma('journal_mode = WAL');
    newDb.pragma('foreign_keys = ON');
    initializeDbSchema(newDb);

    let uploadsRestored = false;
    const extractedUploads = path.join(workDir, 'uploads');
    if (fs.existsSync(extractedUploads) && fs.statSync(extractedUploads).isDirectory()) {
      fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      fs.cpSync(extractedUploads, UPLOADS_DIR, { recursive: true });
      uploadsRestored = true;
    }

    require('../db').setDb(newDb);
    newDb = null;

    return {
      uploadsRestored,
      dbSize: fs.statSync(DB_PATH).size,
      uploadsFileCount: countFilesRecursive(UPLOADS_DIR)
    };
  } catch (err) {
    if (newDb) { try { newDb.close(); } catch (e) {} }
    if (swapped) {
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.unlinkSync(DB_PATH + suffix); } catch (e) {}
      }
      if (preRestoreMain && fs.existsSync(preRestoreMain)) {
        fs.copyFileSync(preRestoreMain, DB_PATH);
      }
      if (preRestoreWal && fs.existsSync(preRestoreWal)) {
        fs.copyFileSync(preRestoreWal, DB_PATH + '-wal');
      }
      try {
        const Database = require('better-sqlite3');
        const restored = new Database(DB_PATH);
        restored.pragma('journal_mode = WAL');
        restored.pragma('foreign_keys = ON');
        require('../db').setDb(restored);
      } catch (e) {
        console.error('Falha ao reabrir conexão após rollback do restore:', e.message);
      }
    }
    throw err;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
    for (const p of [preRestoreMain, preRestoreWal]) {
      if (p) { try { fs.unlinkSync(p); } catch (e) {} }
    }
  }
}

module.exports = { createBackupZip, restoreFromZip, backupFileName, DB_PATH, UPLOADS_DIR };
