const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_FILE || path.join(__dirname, '..', 'artigos.db');
const [password, email = 'admin@admin.com'] = process.argv.slice(2);

if (!password) {
  console.log('Uso: node scripts/reset-admin-password.js "<nova senha>" [email]');
  console.log('Defina DB_FILE para apontar para outro banco.');
  process.exit(1);
}

if (password.length < 8) {
  console.log('A senha deve ter pelo menos 8 caracteres.');
  process.exit(1);
}

if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
  console.log('A senha deve conter maiúscula, minúscula e número.');
  process.exit(1);
}

const db = new Database(DB_PATH);
const result = db.prepare(
  "UPDATE users SET password = ?, password_changed = 1, updated_at = datetime('now', '-3 hours') WHERE LOWER(email) = LOWER(?)"
).run(bcrypt.hashSync(password, 10), email);
db.close();

if (result.changes === 1) {
  console.log(`Senha de ${email} redefinida com sucesso.`);
} else {
  console.log(`Nenhum usuário encontrado com o e-mail ${email}.`);
  process.exit(1);
}
