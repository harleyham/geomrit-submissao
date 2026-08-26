#!/usr/bin/env node
'use strict';

// Checka o ambiente mínimo para a Gerência de Eventos rodar:
//   - Node >= 22 (exigido por módulos nativos e pela stack);
//   - dependências obrigatórias presentes e importáveis;
//   - presença do .env (o servidor NÃO o carrega sozinho — passe via
//     `node --env-file=.env server.js` ou exporte as variáveis no shell).
// Saída: exit != 0 em caso de falha, para ser usado em CI/CD ou antes de `npm start`.

const fs = require('fs');
const path = require('path');

const REQUIRED_DEPS = [
  'express',
  'better-sqlite3',
  'archiver',
  'bcryptjs',
  'ejs',
  'nodemailer'
];
const MIN_NODE = 22;
const root = path.join(__dirname, '..');

let problems = 0;
const fail = (label, detail) => {
  problems += 1;
  console.error(`  [X] ${label}${detail ? ' - ' + detail : ''}`);
};
const ok = (label) => console.log(`  [OK] ${label}`);

// 1) Versão do Node.
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (Number.isNaN(nodeMajor) || nodeMajor < MIN_NODE) {
  fail('versão do Node insuficiente',
    `detectado ${process.version}, mínimo exigido: ${MIN_NODE}. Instale um Node >= ${MIN_NODE} (conforme .nvmrc/.node-version).`);
} else {
  ok(`Node ${process.version} (>= ${MIN_NODE})`);
}

// 2) Diretório de trabalho.
try {
  fs.statSync(path.join(root, 'db.js'));
  ok('diretório raiz do projeto');
} catch {
  fail('diretório do projeto', 'execute `npm run verify-env` a partir da raiz do repositório.');
}

// 3) Dependências obrigatórias importáveis.
const nodeModules = path.join(root, 'node_modules');
for (const dep of REQUIRED_DEPS) {
  try {
    require(path.join(nodeModules, dep, 'package.json'));
    ok(`dependência: ${dep}`);
  } catch {
    fail(`dependência: ${dep}`, 'ausente ou incompleta em node_modules. Rode `npm install`.');
  }
}

// 4) Arquivo de ambiente.
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  ok('.env encontrado');
} else {
  fail('.env ausente',
    'configure PORT, SESSION_SECRET e SMTP antes de rodar (exporte no shell ou use `node --env-file=.env server.js`).');
}

console.log('');
if (problems > 0) {
  console.error(`[verify-env] ${problems} problema(s) encontrado(s). Corrija e execute: npm install`);
  process.exit(1);
} else {
  console.log('[verify-env] Ambiente OK. Execute: npm start');
  process.exit(0);
}
