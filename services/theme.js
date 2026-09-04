const { db } = require('../db');

const THEME_TOKENS = [
  'bg', 'surface', 'surfaceInput', 'border',
  'textStrong', 'text', 'textMuted', 'textFaint',
  'primary', 'primaryHover', 'accent', 'link',
  'success', 'danger', 'warn'
];

const THEMES = {
  ligem: {
    id: 'ligem',
    name: 'LIGEM (padrão)',
    tokens: {
      bg: '#0a0f1a',
      surface: 'rgba(30,41,59,0.6)',
      surfaceInput: 'rgba(148,163,184,0.08)',
      border: 'rgba(148,163,184,0.1)',
      textStrong: '#f1f5f9',
      text: '#e2e8f0',
      textMuted: '#94a3b8',
      textFaint: '#475569',
      primary: '#3b82f6',
      primaryHover: '#2563eb',
      accent: '#60a5fa',
      link: '#93c5fd',
      success: '#34d399',
      danger: '#f87171',
      warn: '#fbbf24'
    }
  },
  sipam: {
    id: 'sipam',
    name: 'SIPAM / Censipam',
    tokens: {
      bg: '#0c1210',
      surface: 'rgba(16,45,30,0.6)',
      surfaceInput: 'rgba(128,194,218,0.08)',
      border: 'rgba(65,150,85,0.25)',
      textStrong: '#e8f5ec',
      text: '#d6e8dc',
      textMuted: '#8fb3a0',
      textFaint: '#4a6b58',
      primary: '#254a91',
      primaryHover: '#1d3a73',
      accent: '#419655',
      link: '#80c2da',
      success: '#429349',
      danger: '#f87171',
      warn: '#fbbf24'
    }
  },
  claro: {
    id: 'claro',
    name: 'Claro',
    tokens: {
      bg: '#f8fafc',
      surface: '#ffffff',
      surfaceInput: '#f1f5f9',
      border: '#1e293b',
      textStrong: '#0f172a',
      text: '#1e293b',
      textMuted: '#475569',
      textFaint: '#64748b',
      primary: '#2563eb',
      primaryHover: '#1d4ed8',
      accent: '#3b82f6',
      link: '#1d4ed8',
      success: '#059669',
      danger: '#dc2626',
      warn: '#d97706'
    }
  },
  contraste: {
    id: 'contraste',
    name: 'Alto Contraste',
    tokens: {
      bg: '#000000',
      surface: '#0a0a0a',
      surfaceInput: '#111111',
      border: '#ffff00',
      textStrong: '#ffffff',
      text: '#ffffff',
      textMuted: '#ffff00',
      textFaint: '#ffff00',
      primary: '#ffff00',
      primaryHover: '#cccc00',
      accent: '#ffffff',
      link: '#ffff00',
      success: '#00ff00',
      danger: '#ff4444',
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
