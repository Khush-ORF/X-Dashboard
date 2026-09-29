const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DOCS_DIR = path.join(ROOT, 'docs');
const EXPORT_DIR = path.join(ROOT, 'exports');
const TIME_ZONE = 'Asia/Kolkata';
const MAX_RUN_DAYS = 10;
const EARLIEST_DATE = '2026-01-01';

function validateHandle(value) {
  const handle = String(value || '').replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error('Invalid X account handle.');
  return handle;
}

async function accountHandles() {
  const config = JSON.parse(await fs.readFile(path.join(ROOT, 'accounts.json'), 'utf8'));
  const handles = [...new Set((config.accounts || []).map(validateHandle))];
  if (handles.length < 1 || handles.length > 10) throw new Error('Configure between one and ten X accounts.');
  return handles;
}

function dateInZone(date = new Date(), timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function utcDateOffset(isoValue, days) {
  const value = new Date(isoValue);
  if (!Number.isFinite(value.getTime())) throw new Error('Invalid timestamp.');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function canonicalPostUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['x.com', 'www.x.com', 'twitter.com'].includes(url.hostname)) return null;
    const match = /^\/([A-Za-z0-9_]{1,15})\/status\/([0-9]+)(?:\/(?:photo|video)\/[0-9]+)?\/?$/.exec(url.pathname);
    return match ? `https://x.com/${match[1]}/status/${match[2]}` : null;
  } catch {
    return null;
  }
}

function postId(url) {
  const canonical = canonicalPostUrl(url);
  return canonical ? canonical.split('/').at(-1) : null;
}

function isExactInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\t\r-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""').replace(/[\r\n]/g, ' ')}"`;
}

module.exports = {
  ROOT,
  DATA_DIR,
  DOCS_DIR,
  EXPORT_DIR,
  TIME_ZONE,
  MAX_RUN_DAYS,
  EARLIEST_DATE,
  accountHandles,
  validateHandle,
  dateInZone,
  utcDateOffset,
  canonicalPostUrl,
  postId,
  isExactInteger,
  csvCell
};
