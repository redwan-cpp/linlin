// Shared helpers: byte strings, seeded randomness, dates, padding.
// File contents are "byte strings": every char code is one byte (0–255).

export function toBytes(str) {
  return unescape(encodeURIComponent(str));
}

export function fromBytes(bytes) {
  try { return decodeURIComponent(escape(bytes)); } catch { return bytes; }
}

export function byteLen(bytes) { return bytes.length; }

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function randToken(rand, len = 32) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALNUM[Math.floor(rand() * ALNUM.length)];
  return s;
}

export function pick(rand, arr) { return arr[Math.floor(rand() * arr.length)]; }

export function shuffle(rand, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const padL = (s, n, c = ' ') => String(s).padStart(n, c);
export const padR = (s, n, c = ' ') => String(s).padEnd(n, c);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ls -l style: "Oct 31 14:02" for recent files, "Mar  3  2025" for old ones.
export function lsDate(ms, nowMs) {
  const d = new Date(ms);
  const day = padL(d.getUTCDate(), 2);
  const recent = Math.abs(nowMs - ms) < 182 * 86400e3;
  const tail = recent
    ? `${padL(d.getUTCHours(), 2, '0')}:${padL(d.getUTCMinutes(), 2, '0')}`
    : ` ${d.getUTCFullYear()}`;
  return `${MON[d.getUTCMonth()]} ${day} ${tail}`;
}

export function isoStamp(ms) {
  const d = new Date(ms);
  const p = (n) => padL(n, 2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.000000000 +0000`;
}

export function dateString(ms, fmt) {
  const d = new Date(ms);
  const p = (n) => padL(n, 2, '0');
  if (!fmt) {
    return `${DAY[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${padL(d.getUTCDate(), 2)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC ${d.getUTCFullYear()}`;
  }
  const map = {
    Y: d.getUTCFullYear(), m: p(d.getUTCMonth() + 1), d: p(d.getUTCDate()), H: p(d.getUTCHours()),
    M: p(d.getUTCMinutes()), S: p(d.getUTCSeconds()), a: DAY[d.getUTCDay()], b: MON[d.getUTCMonth()],
    s: Math.floor(ms / 1000), F: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    T: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`, '%': '%', n: '\n',
  };
  return fmt.replace(/%(.)/g, (m, c) => (c in map ? String(map[c]) : m));
}

export function humanSize(n) {
  if (n < 1024) return String(n);
  const units = ['K', 'M', 'G', 'T'];
  let v = n;
  let i = -1;
  do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
  return (v < 10 ? Math.ceil(v * 10) / 10 : Math.ceil(v)).toString() + units[i];
}

// Sort the way ls does under en_US.UTF-8: ignore leading dots and case.
export function lsCompare(a, b) {
  const ka = a.replace(/^\.+/, '').toLowerCase();
  const kb = b.replace(/^\.+/, '').toLowerCase();
  if (ka < kb) return -1;
  if (ka > kb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function modeString(type, mode) {
  const t = { dir: 'd', link: 'l', char: 'c', file: '-' }[type] || '-';
  const r = (bit, ch) => (mode & bit ? ch : '-');
  let s = t
    + r(0o400, 'r') + r(0o200, 'w') + r(0o100, 'x')
    + r(0o040, 'r') + r(0o020, 'w') + r(0o010, 'x')
    + r(0o004, 'r') + r(0o002, 'w') + r(0o001, 'x');
  const a = s.split('');
  if (mode & 0o4000) a[3] = mode & 0o100 ? 's' : 'S';
  if (mode & 0o2000) a[6] = mode & 0o010 ? 's' : 'S';
  if (mode & 0o1000) a[9] = mode & 0o001 ? 't' : 'T';
  return a.join('');
}

export const octal = (mode, width = 4) => mode.toString(8).padStart(width, '0');

export class Emitter {
  constructor() { this.handlers = {}; }
  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this.handlers[ev] = (this.handlers[ev] || []).filter((f) => f !== fn); }
  emit(ev, data) { for (const fn of this.handlers[ev] || []) fn(data); }
}

export function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }
