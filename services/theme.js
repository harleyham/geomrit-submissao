const { db } = require('../db');

const THEME_TOKENS = [
  'bg', 'surface', 'surface2', 'surfaceSubtle', 'surfaceHover', 'surfaceSelected',
  'surfaceElevated', 'surfaceInset', 'surfaceInput', 'overlay',
  'border', 'borderStrong', 'primaryBorder', 'focusRing',
  'textStrong', 'text', 'textMuted', 'textFaint',
  'primary', 'primaryHover', 'onPrimary', 'accent', 'link',
  'success', 'successHover', 'onSuccess',
  'danger', 'dangerHover', 'onDanger', 'warn'
];

const THEMES = {
  ligem: {
    id: 'ligem',
    name: 'Azul',
    tokens: {
      bg: '#0a0f1a', surface2: '#1e293b',
      surface: 'rgba(30,41,59,0.6)',
      surfaceInput: 'rgba(148,163,184,0.08)',
      surfaceSubtle: 'rgba(15,23,42,0.3)',
      surfaceHover: 'rgba(148,163,184,0.12)',
      surfaceSelected: 'rgba(59,130,246,0.14)',
      surfaceElevated: 'rgba(15,23,42,0.78)',
      surfaceInset: 'rgba(2,6,23,0.35)',
      overlay: 'rgba(2,6,23,0.72)',
      border: 'rgba(148,163,184,0.1)',
      borderStrong: 'rgba(148,163,184,0.25)',
      primaryBorder: 'rgba(96,165,250,0.4)',
      focusRing: 'rgba(59,130,246,0.2)',
      textStrong: '#f1f5f9',
      text: '#e2e8f0',
      textMuted: '#94a3b8',
      textFaint: '#475569',
      primary: '#3b82f6',
      primaryHover: '#2563eb',
      onPrimary: '#ffffff',
      accent: '#60a5fa',
      link: '#93c5fd',
      success: '#34d399',
      successHover: '#059669',
      onSuccess: '#ffffff',
      danger: '#f87171',
      dangerHover: '#dc2626',
      onDanger: '#ffffff',
      warn: '#fbbf24'
    }
  },
  sipam: {
    id: 'sipam',
    name: 'Verde',
    tokens: {
      bg: '#0c1210', surface2: '#163024',
      surface: 'rgba(16,45,30,0.6)',
      surfaceInput: 'rgba(128,194,218,0.08)',
      surfaceSubtle: 'rgba(35,103,59,0.22)',
      surfaceHover: 'rgba(65,150,85,0.18)',
      surfaceSelected: 'rgba(37,74,145,0.2)',
      surfaceElevated: 'rgba(16,45,30,0.9)',
      surfaceInset: 'rgba(7,22,14,0.5)',
      overlay: 'rgba(7,22,14,0.78)',
      border: 'rgba(65,150,85,0.25)',
      borderStrong: 'rgba(128,194,218,0.42)',
      primaryBorder: 'rgba(128,194,218,0.55)',
      focusRing: 'rgba(40,118,164,0.28)',
      textStrong: '#e8f5ec',
      text: '#d6e8dc',
      textMuted: '#8fb3a0',
      textFaint: '#4a6b58',
      primary: '#419655',
      primaryHover: '#23673b',
      onPrimary: '#ffffff',
      accent: '#2876a4',
      link: '#80c2da',
      success: '#429349',
      successHover: '#23673b',
      onSuccess: '#ffffff',
      danger: '#f87171',
      dangerHover: '#dc2626',
      onDanger: '#ffffff',
      warn: '#fbbf24'
    }
  },
  claro: {
    id: 'claro',
    name: 'Claro',
    tokens: {
      bg: '#f8fafc', surface2: '#ffffff',
      surface: '#ffffff',
      surfaceInput: '#f1f5f9',
      surfaceSubtle: '#f1f5f9',
      surfaceHover: '#e2e8f0',
      surfaceSelected: '#dbeafe',
      surfaceElevated: '#ffffff',
      surfaceInset: '#eef2f7',
      overlay: 'rgba(15,23,42,0.55)',
      border: '#e2e8f0',
      borderStrong: '#94a3b8',
      primaryBorder: '#3b82f6',
      focusRing: 'rgba(37,99,235,0.25)',
      textStrong: '#0f172a',
      text: '#1e293b',
      textMuted: '#475569',
      textFaint: '#64748b',
      primary: '#2563eb',
      primaryHover: '#1d4ed8',
      onPrimary: '#ffffff',
      accent: '#3b82f6',
      link: '#1d4ed8',
      success: '#059669',
      successHover: '#047857',
      onSuccess: '#ffffff',
      danger: '#dc2626',
      dangerHover: '#b91c1c',
      onDanger: '#ffffff',
      warn: '#d97706'
    }
  },
  contraste: {
    id: 'contraste',
    name: 'Alto Contraste',
    tokens: {
      bg: '#000000', surface2: '#0a0a0a',
      surface: '#0a0a0a',
      surfaceInput: '#111111',
      surfaceSubtle: '#111111',
      surfaceHover: '#2a2a2a',
      surfaceSelected: '#2a2a00',
      surfaceElevated: '#111111',
      surfaceInset: '#050505',
      overlay: 'rgba(0,0,0,0.85)',
      border: '#ffff00',
      borderStrong: '#ffff00',
      primaryBorder: '#ffff00',
      focusRing: 'rgba(255,255,0,0.45)',
      textStrong: '#ffffff',
      text: '#ffffff',
      textMuted: '#ffff00',
      textFaint: '#ffff00',
      primary: '#ffff00',
      primaryHover: '#cccc00',
      onPrimary: '#000000',
      accent: '#ffffff',
      link: '#ffff00',
      success: '#00ff00',
      successHover: '#00cc00',
      onSuccess: '#000000',
      danger: '#ff4444',
      dangerHover: '#ff0000',
      onDanger: '#000000',
      warn: '#ffff00'
    }
  }
};

let cachedThemeId = null;

function isValidThemeId(id) {
  return Object.prototype.hasOwnProperty.call(THEMES, id);
}

function getThemeId() {
  if (cachedThemeId) return cachedThemeId;
  const stored = typeof db.prepare === 'function'
    ? db.prepare('SELECT theme FROM system_settings WHERE id=1').get()
    : null;
  cachedThemeId = stored && isValidThemeId(stored.theme) ? stored.theme : 'ligem';
  return cachedThemeId;
}

function getTheme() {
  return THEMES[getThemeId()] || THEMES.ligem;
}

function invalidateCache() {
  cachedThemeId = null;
}

function setTheme(id) {
  if (!isValidThemeId(id)) {
    const err = new Error(`Tema desconhecido: ${id}`);
    err.status = 400;
    throw err;
  }
  db.prepare('UPDATE system_settings SET theme=?, updated_at=datetime(\'now\',\'-3 hours\') WHERE id=1').run(id);
  cachedThemeId = id;
}

function listThemes() {
  return Object.values(THEMES).map((t) => ({ id: t.id, name: t.name }));
}

module.exports = { THEMES, THEME_TOKENS, getTheme, getThemeId, setTheme, listThemes, invalidateCache, isValidThemeId };
