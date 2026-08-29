const fs = require('fs');
const path = require('path');
const VIEWS = path.join(__dirname, '..', 'views');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'emails' || e.name === 'partials') continue;
      walk(p, out);
    } else if (e.name.endsWith('.ejs')) out.push(p);
  }
  return out;
}

const files = walk(VIEWS);
const report = { includes: [], wrapped: [], minmax: [], skipped: [] };

const wrapSet = new Set([
  'admin\\dashboard.ejs',
  'admin\\articles\\list.ejs',
  'admin\\events\\activity-sessions.ejs',
  'admin\\events\\import-users-result.ejs',
  'admin\\events\\roles.ejs',
  'admin\\events\\rooms-agenda.ejs',
  'admin\\events\\rooms-occupancy.ejs',
  'admin\\events\\rooms.ejs',
  'admin\\reports\\list.ejs',
  'admin\\users\\import-users-result.ejs',
  'admin\\users\\list.ejs',
  'public\\author-dashboard.ejs',
  'reviewer\\dashboard.ejs',
]);

for (const f of files) {
  let t = fs.readFileSync(f, 'utf8');
  const rel = path.relative(VIEWS, f);
  let changed = false;

  if (wrapSet.has(rel)) {
    const before = t;
    t = t.replace(/([ \t]*)(<table\b[\s\S]*?<\/table>)/g, (m, indent, tbl) => {
      return indent + '<div class="table-scroll">' + tbl.trimEnd() + '</div>';
    });
    if (t !== before) { report.wrapped.push(rel); changed = true; }
  }

  t = t.replace(/minmax\((\d{3,})px,/g, (m, n) => {
    if (Number(n) < 200) return m;
    report.minmax.push(`${rel} (${n}px)`);
    return `minmax(min(100%,${n}px),`;
  });

  const hasHead = /<\/head>/i.test(t);
  if (!t.includes('mobile-fixes')) {
    if (hasHead) {
      let relDir = path.relative(path.dirname(f), path.join(VIEWS, 'partials')).replace(/\\/g, '/');
      t = t.replace(/<\/head>/i, `  <%- include('${relDir}/mobile-fixes') %>\n</head>`);
      report.includes.push(rel);
      changed = true;
    } else {
      report.skipped.push(rel);
    }
  }

  if (changed) fs.writeFileSync(f, t, 'utf8');
}

console.log('INCLUDES (' + report.includes.length + '):\n' + report.includes.join('\n'));
console.log('\nWRAPPED (' + report.wrapped.length + '):\n' + report.wrapped.join('\n'));
console.log('\nMINMAX (' + report.minmax.length + '):\n' + report.minmax.join('\n'));
if (report.skipped.length) console.log('\nSEM </head>, ignorados:\n' + report.skipped.join('\n'));
