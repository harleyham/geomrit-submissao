const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const { getDb, initializeDbSchema } = require('./db-reset');

const DB_PATH = path.join(__dirname, '..', 'artigos.db');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const ASSETS_FUNDOS_DIR = path.join(ASSETS_DIR, 'Fundos');
const ASSETS_LOGO_PATH = path.join(ASSETS_DIR, 'Ligem.png');
// Imagens substituíveis pelo usuário dentro de assets/ (fundos de certificado e
// logo da plataforma) viajam no ZIP sob este prefixo; os demais arquivos de
// assets/ (CSVs de código) nunca são empacotados nem restaurados.
const USER_ASSETS_ZIP_PREFIX = 'assets-user';
const APP_VERSION = 'V' + require('../package.json').version.split('.').slice(0, 2).join('.');

// Proteção contra ZIP-bomb / ataque de descompressão: limitam o número de
// entradas, o tamaño comprimido e descomprimido, a relação entre eles e a
// profundidade/nome das entradas, impedindo que um ZIP pequeno expanda para
// gigabytes (esgotamento de disco, inodes ou memória durante a extração).
const MAX_ZIP_ENTRIES = 100000;
const MAX_ZIP_COMPRESSED_BYTES = 550 * 1024 * 1024;
const MAX_ZIP_DECOMPRESSED_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_ZIP_COMPRESSION_RATIO = 100;
const MAX_ENTRY_NAME_LENGTH = 4096;
const MAX_NESTING_DEPTH = 100;

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

// Valida um ZIP já aberto antes de extraí-lo, rejeitando padrões de
// ZIP-bomb/descompressão: muitas entradas, tamanho descomprimido excessivo,
// razão de compressão anômala, nomes excessivamente longos e diretórios
// profundamente aninhados (que poderiam estourar limites do sistema de
// arquivos ou esgotar recursos durante a extração).
function assertZipSafeForRestore(zip) {
  const entries = zip.getEntries();

  if (!entries.length) {
    throw new Error('O arquivo de backup está vazio.');
  }

  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(`Backup inválido: número de entradas excede o limite máximo (${MAX_ZIP_ENTRIES}).`);
  }

  let compressedBytes = 0;
  let uncompressedBytes = 0;
  for (const entry of entries) {
    // O adm-zip expõe os tamanhos em `entry.header` (central directory);
    // `entry.size`/`entry.compressedSize` não existem nesta versão.
    compressedBytes += (entry.header && entry.header.compressedSize) || 0;
    uncompressedBytes += (entry.header && entry.header.size) || 0;

    if (uncompressedBytes > MAX_ZIP_DECOMPRESSED_BYTES) {
      throw new Error('Backup inválido: tamaño descomprimido excede o limite permitido.');
    }
    if (String(entry.entryName).length > MAX_ENTRY_NAME_LENGTH) {
      throw new Error('Backup inválido: nome de entrada excede o limite de caracteres.');
    }
    const depth = entry.entryName.split(/[\\/]/).filter(Boolean).length - 1;
    if (depth > MAX_NESTING_DEPTH) {
      throw new Error('Backup inválido: profundidade de diretório excede o limite permitido.');
    }
  }

  // Defesa em profundidade: o `multer` da rota já recusa ZIPs acima de 500 MB,
  // mas a validação evita o uso direto desta função por outras vias.
  if (compressedBytes > MAX_ZIP_COMPRESSED_BYTES) {
    throw new Error('Backup inválido: tamaño comprimido excede o limite permitido.');
  }

  const ratio = compressedBytes > 0
    ? uncompressedBytes / compressedBytes
    : uncompressedBytes > 0
      ? Infinity
      : 0;
  if (ratio > MAX_ZIP_COMPRESSION_RATIO) {
    throw new Error('Backup inválido: razão de compressão excede o limite permitido (possível ZIP-bomb).');
  }
}

// Verifica a integridade de cada arquivo do ZIP antes de extraí-lo, comparando
// o tamanho descomprimido informado no cabeçalho central com os bytes
// realmente obtidos e, quando disponível, o CRC32. Um ZIP baixado/copiado de
// forma incompleta (ou com uma entrada truncada) é rejeitado aqui — com erro
// claro — em vez de restaurar imagens quebradas/truncadas silenciosamente.
function assertZipIntegrityForRestore(zip) {
  const hasCrc32 = typeof zlib.crc32 === 'function';
  const problems = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const expectedSize = entry.header ? entry.header.size : undefined;
    if (typeof expectedSize !== 'number') continue;

    let data;
    try {
      data = entry.getData();
    } catch (err) {
      problems.push(`"${entry.entryName}" (falha ao descomprimir: ${err.message})`);
      continue;
    }
    if (data.length !== expectedSize) {
      problems.push(`"${entry.entryName}" (esperado ${expectedSize} bytes, obtido ${data.length} — arquivo truncado)`);
      continue;
    }
    if (hasCrc32 && entry.header.crc) {
      const expectedCrc = entry.header.crc >>> 0;
      const actualCrc = zlib.crc32(data) >>> 0;
      if (actualCrc !== expectedCrc) {
        problems.push(`"${entry.entryName}" (CRC32 divergente — dados corrompidos)`);
      }
    }
    if (problems.length >= 20) break;
  }
  if (problems.length) {
    throw new Error(`Backup incompleto ou corrompido (${problems.length} arquivo(s) verificados com problema): ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ' …' : ''}. Gere um novo backup e tente novamente.`);
  }
}

// Cria um snapshot consistente do banco (VACUUM INTO) e empacota
// banco + uploads + metadados em um ZIP.
async function createBackupZip(destPath) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artigos-backup-'));
  const snapshotPath = path.join(workDir, 'artigos.db');
  try {
    const db = getDb();
    if (!db) throw new Error('Conexão com o banco de datos indisponível.');
    // SQLite não aceita bind params em `VACUUM INTO`; o caminho vem de mkdtempSync
    // (tmpdir do sistema, não controlável) e tem aspas simples escapadas.
    db.prepare(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`).run();

    const meta = {
      app: 'gerencia-de-eventos',
      version: APP_VERSION,
      created_at: brNow().toISOString().replace('Z', '-03:00'),
      node: process.version,
      platform: process.platform,
      db_size_bytes: fs.statSync(snapshotPath).size,
      uploads_file_count: countFilesRecursive(UPLOADS_DIR),
      user_assets_file_count: (fs.existsSync(ASSETS_FUNDOS_DIR) ? countFilesRecursive(ASSETS_FUNDOS_DIR) : 0) + (fs.existsSync(ASSETS_LOGO_PATH) ? 1 : 0)
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
      // Imagens substituíveis pelo usuário dentro de assets/ (fundos padrão de
      // certificado e logo da plataforma): viajam no ZIP e são re-aplicadas no
      // restore, sem tocar nos demais arquivos de assets/ (CSVs de código).
      if (fs.existsSync(ASSETS_FUNDOS_DIR)) {
        archive.directory(ASSETS_FUNDOS_DIR, `${USER_ASSETS_ZIP_PREFIX}/Fundos`);
      }
      if (fs.existsSync(ASSETS_LOGO_PATH)) {
        archive.file(ASSETS_LOGO_PATH, { name: `${USER_ASSETS_ZIP_PREFIX}/Ligem.png` });
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

  // Exige o ZIP válido e o valida contra padrões de ZIP-bomb/descompressão.
  assertZipSafeForRestore(zip);
  // Rejeita ZIP incompleto/corrompido (entradas truncadas ou CRC divergente)
  // antes de extrair — evita restaurar imagens quebradas silenciosamente.
  assertZipIntegrityForRestore(zip);

  const entries = zip.getEntries();

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
  let uploadsBackupPath = null;

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

    // Troca o DB em uso. O arquivo validado (integridade + tabelas, válidas
    // logo acima) é copiado sobre o atual em local. A cópia sobrescreve em
    // vez de renomear porque o `renameSync` sobre um destino removido falha
    // com EPERM/ENOENT em alguns ambientes Windows; assim o caminho do banco
    // permanece presente em todo o instante.
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
      try {
        if (fs.existsSync(UPLOADS_DIR)) {
          // Backup dos uploads antes de qualquer alteração, permitindo rollback
          // caso a cópia de volta falhe (disco cheio, permissão, arquivo
          // corrompido ou interrupção) — o banco tem rollback, mas os uploads não.
          uploadsBackupPath = path.join(workDir, 'uploads-pre-restore');
          fs.rmSync(uploadsBackupPath, { recursive: true, force: true });
          fs.cpSync(UPLOADS_DIR, uploadsBackupPath, { recursive: true });
        }
        fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        fs.cpSync(extractedUploads, UPLOADS_DIR, { recursive: true });
        uploadsRestored = true;
      } catch (err) {
        if (uploadsBackupPath && fs.existsSync(uploadsBackupPath)) {
          try {
            fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
            fs.mkdirSync(UPLOADS_DIR, { recursive: true });
            fs.cpSync(uploadsBackupPath, UPLOADS_DIR, { recursive: true });
          } catch (restoreErr) {
            console.error('Falha ao restaurar uploads após erro no restore:', restoreErr.message);
          }
        }
        throw err;
      }
    }

    require('../db').setDb(newDb);
    newDb = null;

    // Re-aplica as imagens de usuário que viajam no ZIP sob assets-user/:
    // fundos de certificado (assets/Fundos) e logo da plataforma
    // (assets/Ligem.png). Backups antigos (sem esse prefixo) simplesmente
    // pulam esta etapa e não alteram os assets do destino.
    const extractedUserAssets = path.join(workDir, USER_ASSETS_ZIP_PREFIX);
    const extractedFundos = path.join(extractedUserAssets, 'Fundos');
    const extractedLogo = path.join(extractedUserAssets, 'Ligem.png');
    let userAssetsRestored = false;
    if (fs.existsSync(extractedFundos) || fs.existsSync(extractedLogo)) {
      const fundosBackup = path.join(workDir, 'fundos-pre-restore');
      const logoBackup = path.join(workDir, 'ligem-pre-restore.png');
      try {
        if (fs.existsSync(extractedFundos)) {
          if (fs.existsSync(ASSETS_FUNDOS_DIR)) fs.cpSync(ASSETS_FUNDOS_DIR, fundosBackup, { recursive: true });
          fs.rmSync(ASSETS_FUNDOS_DIR, { recursive: true, force: true });
          fs.mkdirSync(ASSETS_FUNDOS_DIR, { recursive: true });
          fs.cpSync(extractedFundos, ASSETS_FUNDOS_DIR, { recursive: true });
        }
        if (fs.existsSync(extractedLogo)) {
          if (fs.existsSync(ASSETS_LOGO_PATH)) fs.copyFileSync(ASSETS_LOGO_PATH, logoBackup);
          fs.copyFileSync(extractedLogo, ASSETS_LOGO_PATH);
        }
        userAssetsRestored = true;
      } catch (err) {
        // Rollback dos assets ao estado anterior (o catch externo devolve o banco).
        try {
          if (fs.existsSync(fundosBackup)) {
            fs.rmSync(ASSETS_FUNDOS_DIR, { recursive: true, force: true });
            fs.mkdirSync(ASSETS_FUNDOS_DIR, { recursive: true });
            fs.cpSync(fundosBackup, ASSETS_FUNDOS_DIR, { recursive: true });
          }
          if (fs.existsSync(logoBackup)) fs.copyFileSync(logoBackup, ASSETS_LOGO_PATH);
        } catch (rollbackErr) {
          console.error('Falha ao reverter assets após erro no restore:', rollbackErr.message);
        }
        throw err;
      }
    }

    return {
      uploadsRestored,
      userAssetsRestored,
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
    for (const p of [preRestoreMain, preRestoreWal, uploadsBackupPath]) {
      if (p) { try { fs.unlinkSync(p); } catch (e) {} }
    }
  }
}

module.exports = { createBackupZip, restoreFromZip, assertZipSafeForRestore, assertZipIntegrityForRestore, backupFileName, DB_PATH, UPLOADS_DIR };
