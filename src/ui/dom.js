// Tiny DOM helpers: element builder, markdown-lite renderer, ANSI colour parser, storage.

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

// Markdown-lite: paragraphs, "- " lists, ``` code blocks, `code`, **bold**, _italic_, [links](https://…).
export function md(text) {
  const out = [];
  const blocks = String(text || '').replace(/\r/g, '').split(/\n{2,}/);
  for (const b of blocks) {
    if (b.startsWith('```')) {
      out.push(`<pre>${esc(b.replace(/^```\w*\n?/, '').replace(/\n?```$/, ''))}</pre>`);
      continue;
    }
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*[-*] /.test(l))) {
      out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`).join('')}</ul>`);
      continue;
    }
    out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
  }
  return h('div', { class: 'md', html: out.join('') });
}

// Turn text with ANSI SGR codes into spans.
export function ansiNodes(text, baseClass = '') {
  const frag = document.createDocumentFragment();
  let cls = [];
  const re = /\x1b\[([0-9;]*)m|\x1b\[K/g;
  let last = 0;
  let m;
  const push = (s) => {
    if (!s) return;
    const all = [baseClass, ...cls].filter(Boolean).join(' ');
    if (all) frag.append(h('span', { class: all }, s));
    else frag.append(document.createTextNode(s));
  };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    last = re.lastIndex;
    if (m[1] === undefined) continue;
    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
    for (const c of codes) {
      if (c === 0) cls = [];
      else if (c === 1) cls.push('ansi-b');
      else if (c >= 30 && c <= 37) cls = cls.filter((x) => !/^c3/.test(x)).concat(`c${c}`);
      else if (c >= 40 && c <= 47) cls = cls.filter((x) => !/^b4/.test(x)).concat(`b${c}`);
    }
  }
  push(text.slice(last));
  return frag;
}

export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: the db copy still saves */ }
  },
};

export function toast(text, ms = 2400) {
  const t = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

export function modal(content, { onClose } = {}) {
  const back = h('div', { class: 'modal-back', role: 'dialog', 'aria-modal': 'true' });
  const box = h('div', { class: 'modal box' }, content);
  back.append(box);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  setTimeout(() => box.querySelector('button, textarea, input')?.focus(), 30);
  return { close, box };
}
