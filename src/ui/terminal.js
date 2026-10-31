// The game terminal. Implements the engine's `term` interface (write/prompt/readStdin/sleep/overlay/clear)
// and drives a Shell: line editing, history, Tab completion, Ctrl keys, and full-screen overlays.
import { h, ansiNodes } from './dom.js';

const MAX_LINES = 1500;

export class Terminal {
  constructor({ onDone, onBusy } = {}) {
    this.onDone = onDone;
    this.onBusy = onBusy;
    this.sh = null;
    this.mode = 'idle';
    this.pending = null;
    this.histIdx = null;
    this.draft = '';
    this.lastTab = 0;
    this.resolver = null;
    this.stdinBuf = '';
    this.cols = 80;
    this.build();
  }

  build() {
    this.titleWho = h('span', { class: 'who' });
    this.body = h('div', { class: 'term-body', role: 'log', 'aria-label': 'Terminal output' });
    this.out = h('div', { class: 'term-out' });
    this.partial = h('div', { class: 'term-line' });
    this.promptEl = h('span', { class: 'term-prompt' });
    this.input = h('input', {
      class: 'term-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      'aria-label': 'Terminal input', enterkeyhint: 'send',
    });
    this.inputRow = h('div', { class: 'term-input-row' }, this.promptEl, this.input);
    this.body.append(this.out, this.partial, this.inputRow);
    this.hint = h('div', { class: 'term-hint' },
      h('span', {}, h('b', {}, 'Tab'), ' complete'), h('span', {}, h('b', {}, '↑ ↓'), ' history'),
      h('span', {}, h('b', {}, 'Ctrl+C'), ' cancel'), h('span', {}, h('b', {}, 'Ctrl+L'), ' clear'));
    this.el = h('div', { class: 'term box-term', tabindex: '-1' },
      h('div', { class: 'term-title' },
        h('i', { class: 'dot', style: { background: '#ff6f91' } }), h('i', { class: 'dot', style: { background: '#ffcc4d' } }),
        h('i', { class: 'dot', style: { background: '#62e6a4' } }), h('span', {}, 'bash'), this.titleWho),
      this.body);
    this.wrap = h('div', { class: 'term-wrap' }, this.el, this.hint);
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.el.addEventListener('keydown', (e) => { if (e.target === this.el) this.onKey(e); });
    this.body.addEventListener('click', () => {
      if (window.getSelection()?.toString()) return;
      this.focus();
    });
    this.measure = h('span', { style: { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre' } }, 'MMMMMMMMMM');
    this.el.append(this.measure);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(this.body);
  }

  resize() {
    const cw = this.measure.getBoundingClientRect().width / 10 || 9;
    const w = this.body.clientWidth - 12;
    if (w > 0) this.cols = Math.max(20, Math.floor(w / cw));
  }

  attach(sh) {
    this.sh = sh;
    sh.term = this;
    this.out.textContent = '';
    this.partial.textContent = '';
    this.mode = 'idle';
    this.pending = null;
    this.renderPrompt();
    setTimeout(() => this.resize(), 0);
  }

  focus() {
    if (this.overlayEl) { this.overlayEl.querySelector('[data-focus]')?.focus(); return; }
    if (this.mode === 'sleep' || this.mode === 'busy') this.el.focus({ preventScroll: true });
    else this.input.focus({ preventScroll: true });
  }

  // ---------- output ----------
  write(text, stream = 'out') {
    if (text.includes('\x1b[H\x1b[2J')) { this.clear(); text = text.split('\x1b[H\x1b[2J').pop(); }
    const cls = stream === 'err' ? 't-err' : stream === 'sys' ? 't-sys' : stream === 'ok' ? 't-ok' : '';
    const parts = text.split('\n');
    parts.forEach((p, i) => {
      if (p) this.partial.append(ansiNodes(p, cls));
      if (i < parts.length - 1) this.newline();
    });
    this.scroll();
  }

  newline() {
    const line = this.partial;
    line.className = 'term-line';
    this.out.append(line);
    this.partial = h('div', { class: 'term-line' });
    this.out.after(this.partial);
    while (this.out.childElementCount > MAX_LINES) this.out.firstChild.remove();
  }

  sys(text) { this.write(text + '\n', 'sys'); }

  clear() {
    this.out.textContent = '';
    this.partial.textContent = '';
  }

  scroll() { this.body.scrollTop = this.body.scrollHeight; }

  // ---------- prompt ----------
  promptNodes() {
    if (!this.sh) return [];
    const p = this.sh.promptInfo();
    return [
      h('span', { class: p.root ? 'p-root' : 'p-user' }, `${p.user}@${p.host}`), ':',
      h('span', { class: 'p-path' }, p.path), p.root ? '# ' : '$ ',
    ];
  }

  renderPrompt() {
    // ask/secret/stdin modes keep the question text that prompt() put in promptEl
    if (this.mode === 'idle' || this.mode === 'busy' || this.mode === 'sleep') this.promptEl.textContent = '';
    if (this.mode === 'idle') {
      if (this.pending !== null) this.promptEl.append('> ');
      else this.promptEl.append(...this.promptNodes());
      const p = this.sh?.promptInfo();
      if (p) this.titleWho.textContent = `${p.user}@${p.host}: ${p.path}`;
    }
    this.inputRow.hidden = this.mode === 'sleep' || this.mode === 'busy';
    this.input.classList.toggle('secret', this.mode === 'secret');
    this.input.style.color = this.mode === 'secret' ? 'transparent' : '';
    this.scroll();
  }

  echoLine(prefixNodes, text) {
    this.partial.append(...prefixNodes, text);
    this.newline();
  }

  // ---------- engine term interface ----------
  async prompt(text, { hidden = false } = {}) {
    // question text was not yet written: show it as the input prefix
    const lines = text.split('\n');
    const last = lines.pop();
    if (lines.length) this.write(lines.join('\n') + '\n');
    return new Promise((resolve) => {
      this.mode = hidden ? 'secret' : 'ask';
      this.promptEl.textContent = last;
      this.resolver = (v) => { this.resolver = null; this.mode = 'busy'; this.renderPrompt(); resolve(v); };
      this.renderPrompt();
      this.input.value = '';
      this.focus();
    });
  }

  async readStdin() {
    return new Promise((resolve) => {
      this.mode = 'stdin';
      this.stdinBuf = '';
      this.promptEl.textContent = '';
      this.resolver = (v) => { this.resolver = null; this.mode = 'busy'; this.renderPrompt(); resolve(v); };
      this.renderPrompt();
      this.input.value = '';
      this.focus();
    });
  }

  async sleep(ms) {
    return new Promise((resolve) => {
      this.mode = 'sleep';
      this.renderPrompt();
      this.el.focus({ preventScroll: true });
      const t = setTimeout(() => done('done'), Math.min(ms, 2 ** 31 - 1));
      const done = (v) => { clearTimeout(t); this.resolver = null; this.mode = 'busy'; this.renderPrompt(); resolve(v); };
      this.resolver = done;
    });
  }

  async overlay(spec) {
    return new Promise((resolve) => {
      const prevMode = this.mode;
      this.mode = 'overlay';
      const close = (v) => {
        clearInterval(this.ovTimer);
        this.overlayEl?.remove();
        this.overlayEl = null;
        this.mode = prevMode;
        this.renderPrompt();
        this.focus();
        resolve(v ?? null);
      };
      const el = spec.type === 'editor' ? this.editorOverlay(spec, close) : this.pagerOverlay(spec, close);
      this.overlayEl = el;
      this.el.append(el);
      el.querySelector('[data-focus]')?.focus();
    });
  }

  // ---------- overlays ----------
  pagerOverlay(spec, close) {
    const body = h('div', { class: 'ov-body', tabindex: '0', 'data-focus': '' });
    const status = h('div', { class: 'ov-status' });
    const setText = () => {
      const top = body.scrollTop;
      body.textContent = '';
      body.append(ansiNodes(spec.type === 'top' ? spec.render() : spec.text));
      body.scrollTop = top;
    };
    setText();
    const update = () => {
      if (spec.type === 'top') { status.textContent = 'top refreshes every second. Press q to quit.'; return; }
      const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 2;
      status.textContent = atEnd ? '(END)  press q to quit' : `${spec.title}  ${Math.round(((body.scrollTop + body.clientHeight) / body.scrollHeight) * 100)}%  (space: next page, b: back, /: search, q: quit)`;
    };
    if (spec.type === 'top') this.ovTimer = setInterval(setText, 1000);
    let searching = null;
    body.addEventListener('scroll', update);
    body.addEventListener('keydown', (e) => {
      if (searching !== null) return;
      const page = body.clientHeight - 24;
      const line = 21;
      const k = e.key;
      if (k === 'q' || k === 'Q' || (e.ctrlKey && k === 'c')) { e.preventDefault(); close(); return; }
      const moves = { ' ': page, PageDown: page, f: page, b: -page, PageUp: -page, j: line, ArrowDown: line, Enter: line, k: -line, ArrowUp: -line };
      if (k in moves) { e.preventDefault(); body.scrollTop += moves[k]; return; }
      if (k === 'g' || k === 'Home') { e.preventDefault(); body.scrollTop = 0; return; }
      if (k === 'G' || k === 'End') { e.preventDefault(); body.scrollTop = body.scrollHeight; return; }
      if (k === '/' && spec.type !== 'top') {
        e.preventDefault();
        const inp = h('input', { style: { background: 'transparent', border: 0, color: 'inherit', font: 'inherit', outline: 0, width: '70%' } });
        status.textContent = '/';
        status.append(inp);
        searching = inp;
        inp.focus();
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Escape') { searching = null; update(); body.focus(); return; }
          if (ev.key !== 'Enter') return;
          ev.preventDefault();
          const term = inp.value;
          searching = null;
          const idx = spec.text.toLowerCase().indexOf(term.toLowerCase(), 1);
          if (term && idx >= 0) {
            const before = spec.text.slice(0, idx).split('\n').length - 1;
            body.scrollTop = before * line;
            status.textContent = `found "${term}"`;
          } else status.textContent = 'Pattern not found  (press q to quit)';
          body.focus();
        });
      }
    });
    const foot = h('div', { class: 'ov-foot' },
      h('button', { type: 'button', onclick: () => close() }, h('kbd', {}, 'q'), ' quit'),
      h('button', { type: 'button', onclick: () => { body.scrollTop += body.clientHeight - 24; } }, h('kbd', {}, 'space'), ' next page'),
      h('button', { type: 'button', onclick: () => { body.scrollTop -= body.clientHeight - 24; } }, h('kbd', {}, 'b'), ' back'));
    const el = h('div', { class: 'term-overlay' }, h('div', { class: 'ov-head' }, h('span', {}, spec.type === 'top' ? 'top' : spec.title || 'less'), h('span', {}, spec.type === 'top' ? 'live' : 'less')), body, status, foot);
    setTimeout(update, 0);
    return el;
  }

  editorOverlay(spec, close) {
    let name = spec.path;
    let modified = false;
    let clip = '';
    const ta = h('textarea', { class: 'nano-text', spellcheck: 'false', 'data-focus': '', 'aria-label': `nano editing ${name || 'new buffer'}` });
    ta.value = spec.content;
    const fileLabel = h('span', {}, name ? name.split('/').pop() : 'New Buffer');
    const modLabel = h('span', {}, '');
    const status = h('div', { class: 'ov-status' }, spec.note ? `[ ${spec.note} ]` : '');
    const promptRow = h('div', { class: 'nano-prompt', hidden: true });
    let promptDone = null;
    const ask = (label, value = '') => new Promise((resolve) => {
      promptRow.textContent = '';
      const inp = h('input', { value, 'aria-label': label });
      promptRow.append(h('span', {}, label), inp);
      promptRow.hidden = false;
      promptDone = (v) => { promptRow.hidden = true; promptDone = null; ta.focus(); resolve(v); };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); promptDone(inp.value); }
        if (e.key === 'Escape' || (e.ctrlKey && e.key.toLowerCase() === 'c')) { e.preventDefault(); promptDone(null); status.textContent = '[ Cancelled ]'; }
        if (/^[yYnN]$/.test(e.key) && label.startsWith('Save modified')) { e.preventDefault(); promptDone(e.key.toLowerCase()); }
      });
      inp.focus();
    });
    const write = async () => {
      if (spec.readonly) { status.textContent = '[ This buffer cannot be saved ]'; return false; }
      const target = await ask('File Name to Write: ', name || '');
      if (target === null || target === '') return false;
      const r = spec.save(ta.value, target);
      status.textContent = `[ ${r.msg} ]`;
      if (r.ok) { name = target; fileLabel.textContent = target.split('/').pop(); modified = false; modLabel.textContent = ''; }
      return r.ok;
    };
    const exit = async () => {
      if (modified && !spec.readonly) {
        const ans = await ask('Save modified buffer?  Y Yes   N No   ^C Cancel  ');
        if (ans === null) return;
        if (ans === 'y' && !(await write())) return;
      }
      close();
    };
    ta.addEventListener('input', () => { modified = true; modLabel.textContent = 'Modified'; });
    ta.addEventListener('keydown', (e) => {
      if (!e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === 'o' || k === 's') { e.preventDefault(); write(); }
      else if (k === 'x') { e.preventDefault(); exit(); }
      else if (k === 'k') {
        e.preventDefault();
        const v = ta.value;
        const s = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
        let end = v.indexOf('\n', ta.selectionStart);
        end = end < 0 ? v.length : end + 1;
        clip = v.slice(s, end);
        ta.value = v.slice(0, s) + v.slice(end);
        ta.selectionStart = ta.selectionEnd = s;
        modified = true;
        modLabel.textContent = 'Modified';
      } else if (k === 'u') {
        e.preventDefault();
        const p = ta.selectionStart;
        ta.value = ta.value.slice(0, p) + clip + ta.value.slice(p);
        ta.selectionStart = ta.selectionEnd = p + clip.length;
        modified = true;
      } else if (k === 'g') { e.preventDefault(); status.textContent = '[ Type normally. ^O saves (Write Out), ^X exits, ^K cuts a line, ^U pastes it. ]'; }
    });
    const key = (k, label, fn) => h('button', { type: 'button', onclick: fn }, h('kbd', {}, k), ' ', label);
    const foot = h('div', { class: 'ov-foot' },
      key('^G', 'Help', () => { status.textContent = '[ ^O saves, ^X exits, ^K cuts a line, ^U pastes ]'; ta.focus(); }),
      key('^O', 'Write Out', () => write()), key('^X', 'Exit', () => exit()),
      key('^K', 'Cut', () => ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))),
      key('^U', 'Paste', () => ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', ctrlKey: true }))));
    return h('div', { class: 'term-overlay' },
      h('div', { class: 'ov-head' }, h('span', {}, '  GNU nano 8.4'), fileLabel, modLabel), ta, status, promptRow, foot);
  }

  // ---------- input ----------
  setBusy(b) {
    this.onBusy?.(b);
  }

  async submit(text) {
    const mode = this.mode;
    if (mode === 'ask' || mode === 'secret') {
      this.echoLine([this.promptEl.textContent], mode === 'secret' ? '' : text);
      this.input.value = '';
      this.resolver?.(text);
      return;
    }
    if (mode === 'stdin') {
      this.echoLine([], text);
      this.input.value = '';
      this.stdinBuf += text + '\n';
      return;
    }
    if (mode !== 'idle' || !this.sh) return;
    this.echoLine(this.pending !== null ? ['> '] : this.promptNodes(), text);
    const line = this.pending !== null ? this.pending + '\n' + text : text;
    this.input.value = '';
    this.histIdx = null;
    this.mode = 'busy';
    this.renderPrompt();
    this.setBusy(true);
    let r;
    try {
      r = await this.sh.run(line);
    } catch (e) {
      this.write(`[engine error] ${e?.message || e}\n`, 'err');
      r = { status: 1 };
      console.error(e);
    }
    this.mode = 'idle';
    if (r.incomplete) this.pending = line;
    else this.pending = null;
    this.renderPrompt();
    this.setBusy(false);
    this.focus();
    if (!r.incomplete) this.onDone?.(r);
  }

  typeAndRun(cmd) {
    if (this.mode !== 'idle') return false;
    this.input.value = cmd;
    this.submit(cmd);
    return true;
  }

  onKey(e) {
    const k = e.key;
    const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
    if (this.mode === 'overlay') return;
    if (ctrl && k.toLowerCase() === 'c') {
      if (this.mode === 'idle' && window.getSelection()?.toString()) return;
      e.preventDefault();
      if (this.mode === 'sleep') { this.write('^C\n'); this.resolver?.('int'); return; }
      if (this.mode === 'ask' || this.mode === 'secret') { this.echoLine([this.promptEl.textContent], '^C'); this.resolver?.(null); return; }
      if (this.mode === 'stdin') { this.echoLine([], this.input.value + '^C'); this.input.value = ''; this.resolver?.(null); return; }
      if (this.mode === 'idle') {
        this.echoLine(this.pending !== null ? ['> '] : this.promptNodes(), this.input.value + '^C');
        this.input.value = '';
        this.pending = null;
        this.renderPrompt();
      }
      return;
    }
    if (ctrl && k.toLowerCase() === 'z' && this.mode === 'sleep') { e.preventDefault(); this.write('^Z'); this.resolver?.('stop'); return; }
    if (ctrl && k.toLowerCase() === 'd') {
      e.preventDefault();
      if (this.mode === 'stdin') {
        if (this.input.value) { this.stdinBuf += this.input.value; this.echoLine([], this.input.value); this.input.value = ''; }
        this.resolver?.(this.stdinBuf);
        return;
      }
      if (this.mode === 'idle' && !this.input.value) this.submit('exit');
      return;
    }
    if (this.mode === 'sleep' || this.mode === 'busy') { e.preventDefault(); return; }
    if (ctrl && k.toLowerCase() === 'l') { e.preventDefault(); this.clear(); return; }
    if (ctrl && k.toLowerCase() === 'u') { e.preventDefault(); this.input.value = this.input.value.slice(this.input.selectionStart); this.input.setSelectionRange(0, 0); return; }
    if (ctrl && k.toLowerCase() === 'k') { e.preventDefault(); this.input.value = this.input.value.slice(0, this.input.selectionStart); return; }
    if (ctrl && k.toLowerCase() === 'a') { e.preventDefault(); this.input.setSelectionRange(0, 0); return; }
    if (ctrl && k.toLowerCase() === 'e') { e.preventDefault(); const n = this.input.value.length; this.input.setSelectionRange(n, n); return; }
    if (k === 'Enter') { e.preventDefault(); this.submit(this.input.value); return; }
    if (this.mode !== 'idle') return;
    if (k === 'Tab') { e.preventDefault(); this.complete(); return; }
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault();
      const hist = this.sh.history;
      if (!hist.length) return;
      if (this.histIdx === null) { this.draft = this.input.value; this.histIdx = hist.length; }
      this.histIdx = Math.max(0, Math.min(hist.length, this.histIdx + (k === 'ArrowUp' ? -1 : 1)));
      this.input.value = this.histIdx === hist.length ? this.draft : hist[this.histIdx];
      const n = this.input.value.length;
      this.input.setSelectionRange(n, n);
    }
  }

  complete() {
    const v = this.input.value.slice(0, this.input.selectionStart);
    const after = this.input.value.slice(this.input.selectionStart);
    const r = this.sh.complete(v);
    const now = Date.now();
    if (r.replacement) {
      const nv = v.slice(0, v.length - r.token.length) + r.replacement;
      this.input.value = nv + after;
      this.input.setSelectionRange(nv.length, nv.length);
      this.lastTab = 0;
      return;
    }
    if (r.options.length > 1 && now - this.lastTab < 600) {
      this.echoLine(this.promptNodes(), this.input.value);
      const labels = r.options.map((o) => o.label);
      const w = Math.max(...labels.map((l) => l.length)) + 2;
      const per = Math.max(1, Math.floor(this.cols / w));
      let s = '';
      labels.forEach((l, i) => { s += l.padEnd(w) + ((i + 1) % per === 0 ? '\n' : ''); });
      this.write(s.trimEnd() + '\n');
    }
    this.lastTab = now;
  }
}
