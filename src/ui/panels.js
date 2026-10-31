// Right-hand visual panels: file-tree Map, permission Runes, Pipes flow, Procs + environment, Codex.
import { h, md } from './dom.js';
import { can, joinPath } from '../engine/vfs.js';
import { modeString } from '../engine/util.js';
import { spriteCanvas } from './sprites.js';

const TABS = [['map', 'Map'], ['runes', 'Runes'], ['pipes', 'Pipes'], ['procs', 'Procs'], ['codex', 'Codex']];

const ICON = {
  dir: 'linear-gradient(#72cbff,#72cbff) 0 0/45% 25% no-repeat, linear-gradient(#72cbff,#72cbff) 0 25%/100% 75% no-repeat',
  file: 'linear-gradient(#ece8ff,#ece8ff) 15% 0/70% 100% no-repeat',
  exe: 'linear-gradient(#62e6a4,#62e6a4) 15% 0/70% 100% no-repeat',
  link: 'linear-gradient(#5fe3e3,#5fe3e3) 0 40%/100% 25% no-repeat, linear-gradient(#5fe3e3,#5fe3e3) 70% 0/30% 100% no-repeat',
  lock: 'linear-gradient(#ffae57,#ffae57) 10% 45%/80% 55% no-repeat, linear-gradient(#ffae57,#ffae57) 30% 0/40% 45% no-repeat',
  dev: 'linear-gradient(#b38cff,#b38cff) 10% 10%/80% 80% no-repeat',
};

export class Panels {
  constructor({ docs, unlocked, onSelectCard }) {
    this.docs = docs;
    this.unlocked = unlocked;
    this.onSelectCard = onSelectCard;
    this.tab = 'map';
    this.run = null;
    this.expanded = new Set(['/']);
    this.selected = null;
    this.showHidden = false;
    this.flash = new Set();
    this.scratch = null;
    this.codexPick = null;
    this.tabBtns = {};
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([id, label]) => {
      const b = h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(id === this.tab), onclick: () => this.show(id) }, label);
      this.tabBtns[id] = b;
      return b;
    }));
    this.body = h('div', { class: 'panel-body box', role: 'tabpanel' });
    this.el = h('section', { class: 'panels', 'aria-label': 'Visual panels' }, tabs, this.body);
  }

  attach(run, level) {
    this.run = run;
    this.level = level;
    this.selected = null;
    this.scratch = null;
    this.expanded = new Set(['/']);
    this.flash.clear();
    run.world.events.on('procs', () => { if (this.tab === 'procs') this.render(); });
    this.watchFs(run.sh.s.machine);
    this.show(level.panel || 'map');
  }

  watchFs(machine) {
    if (this.watched === machine) return;
    this.watched = machine;
    machine.fs.events.on('change', ({ path }) => {
      if (this.run?.sh.s.machine !== machine) return;
      this.flash.add(path);
    });
  }

  show(tab) {
    this.tab = tab;
    for (const [id, b] of Object.entries(this.tabBtns)) b.setAttribute('aria-selected', String(id === tab));
    this.render();
  }

  refresh() {
    if (!this.run) return;
    this.watchFs(this.run.sh.s.machine);
    this.render();
    this.flash.clear();
  }

  select(path) {
    this.selected = path;
    this.scratch = null;
    this.render();
  }

  render() {
    if (!this.run) return;
    const top = this.body.scrollTop;
    this.body.textContent = '';
    const fn = { map: this.renderMap, runes: this.renderRunes, pipes: this.renderPipes, procs: this.renderProcs, codex: this.renderCodex }[this.tab];
    fn.call(this);
    this.body.scrollTop = top;
  }

  // ---------- Map ----------
  renderMap() {
    const sh = this.run.sh;
    const m = sh.s.machine;
    const cred = sh.cred(sh.s);
    const cwd = sh.s.cwd;
    const chain = [];
    let acc = '';
    for (const part of cwd.split('/').filter(Boolean)) { acc += '/' + part; chain.push(acc); }
    for (const c of chain) this.expanded.add(c);
    this.body.append(
      h('p', { class: 'panel-note' }, `Live view of ${m.hostname}. Gold = where you are. Click a file to read its permission runes.`),
      h('label', { class: 'check', style: { marginTop: 0, marginBottom: '8px' } },
        h('input', { type: 'checkbox', checked: this.showHidden, onchange: (e) => { this.showHidden = e.target.checked; this.render(); } }),
        'Show hidden (dot) files'));
    const tree = h('div', { class: 'tree', role: 'tree' });
    const row = (name, node, path, depth) => {
      const isDir = node.type === 'dir';
      const locked = isDir && (!can(node, cred, 'x') || !can(node, cred, 'r'));
      const kind = node.type === 'link' ? 'link' : node.type === 'char' ? 'dev' : isDir ? (locked ? 'lock' : 'dir') : node.mode & 0o111 ? 'exe' : 'file';
      const open = isDir && this.expanded.has(path) && !locked;
      const cls = ['tree-row'];
      if (path === cwd) cls.push('cwd');
      if (path === this.selected) cls.push('sel');
      if (name.startsWith('.')) cls.push('hidden');
      if ([...this.flash].some((f) => f === path)) cls.push('flash');
      const nmCls = `nm ${node.mode & 0o4000 && !isDir ? 'suid' : isDir ? 'dir' : node.type === 'link' ? 'link' : node.mode & 0o111 ? 'exe' : ''}`;
      const r = h('div', {
        class: cls.join(' '), role: 'treeitem', 'aria-expanded': isDir ? String(open) : null,
        style: { paddingLeft: `${depth * 14 + 4}px` },
        title: isDir ? `cd ${path}` : path,
        onclick: () => {
          if (isDir && !locked) { if (open) this.expanded.delete(path); else this.expanded.add(path); }
          this.selected = path;
          this.render();
        },
      },
      h('span', { style: { width: '10px', color: 'var(--dim)' } }, isDir ? (locked ? ' ' : open ? '▾' : '▸') : ' '),
      h('i', { class: 'ico', style: { background: ICON[kind] } }),
      h('span', { class: nmCls }, name + (isDir && path !== '/' ? '/' : '')),
      node.type === 'link' ? h('span', { class: 'meta' }, `→ ${node.target}`) : null,
      path === cwd ? h('span', { class: 'here-badge' }, 'YOU') : null);
      tree.append(r);
      if (open) {
        const kids = [...node.children].filter(([n]) => this.showHidden || !n.startsWith('.') || chain.includes(joinPath(path, n)));
        kids.sort((a, b) => ((b[1].type === 'dir') - (a[1].type === 'dir')) || a[0].localeCompare(b[0], 'en'));
        const shown = kids.slice(0, 60);
        for (const [n, c] of shown) row(n, c, joinPath(path, n), depth + 1);
        if (kids.length > shown.length) tree.append(h('div', { class: 'tree-row', style: { paddingLeft: `${(depth + 1) * 14 + 18}px`, color: 'var(--dim)' } }, `… ${kids.length - shown.length} more`));
      }
    };
    row('/', m.fs.root, '/', 0);
    this.body.append(tree);
  }

  // ---------- Runes ----------
  renderRunes() {
    const sh = this.run.sh;
    const m = sh.s.machine;
    const path = this.selected || sh.s.cwd;
    const node = m.fs.tryGet(path, { follow: false });
    if (!node) {
      this.body.append(h('p', { class: 'panel-note' }, `${path} no longer exists. Pick a file on the Map tab.`));
      return;
    }
    const real = node.mode & 0o7777;
    if (this.scratch === null) this.scratch = real;
    const s = this.scratch;
    const cred = sh.cred(sh.s);
    const who = cred.uid === 0 ? 'root (bypasses most checks)' : node.uid === cred.uid ? 'owner' : cred.gids.includes(node.gid) ? 'group' : 'others';
    const yes = (p) => (can(node, cred, p) ? 'yes' : 'no');
    const isDir = node.type === 'dir';
    const grid = h('div', { class: 'rune-grid', role: 'group', 'aria-label': 'Permission switches' },
      h('span', {}), ...['read r', 'write w', isDir ? 'enter x' : 'exec x'].map((t) => h('span', { class: 'hd' }, t)));
    [['owner u', 6], ['group g', 3], ['others o', 0]].forEach(([label, shift]) => {
      grid.append(h('span', { class: 'who' }, label));
      [[4, 'r'], [2, 'w'], [1, 'x']].forEach(([bit, ch]) => {
        const mask = bit << shift;
        const on = (s & mask) !== 0;
        grid.append(h('button', {
          type: 'button', class: `rune${on ? ' on' : ''}`, 'aria-pressed': String(on), 'aria-label': `${label} ${ch}`,
          onclick: () => { this.scratch = s ^ mask; this.render(); },
        }, on ? ch : '-'));
      });
    });
    const special = h('div', { class: 'rune-grid' }, h('span', { class: 'who' }, 'special'),
      ...[[0o4000, 'setuid s'], [0o2000, 'setgid s'], [0o1000, 'sticky t']].map(([bit, label]) => h('button', {
        type: 'button', class: `rune${s & bit ? ' on' : ''}`, 'aria-pressed': String(!!(s & bit)), style: { fontSize: '11px' },
        onclick: () => { this.scratch = s ^ bit; this.render(); },
      }, label)));
    const name = path.split('/').pop() || '/';
    const sym = (shift) => { const b = (s >> shift) & 7; return (b & 4 ? 'r' : '') + (b & 2 ? 'w' : '') + (b & 1 ? 'x' : ''); };
    this.body.append(h('div', { class: 'runes' },
      h('div', { class: 'rune-file' }, h('span', { class: 'label' }, 'Selected '), path),
      h('dl', { class: 'rune-out' },
        h('dt', {}, 'ls -l shows'), h('dd', {}, `${modeString(node.type, s)}  ${m.uidName(node.uid)} ${m.gidName(node.gid)}`),
        h('dt', {}, 'octal'), h('dd', {}, s.toString(8).padStart(s > 0o777 ? 4 : 3, '0')),
        h('dt', {}, 'you are'), h('dd', {}, `${who} → read ${yes('r')}, write ${yes('w')}, ${isDir ? 'enter' : 'run'} ${yes('x')}`)),
      grid, special,
      s !== real
        ? md(`To make it like this for real:\n\`chmod ${s.toString(8).padStart(3, '0')} ${name}\`\nor \`chmod u=${sym(6)},g=${sym(3)},o=${sym(0)} ${name}\`\n\nThe switches are a practice board. Only \`chmod\` in the terminal changes the file.`)
        : h('p', { class: 'rune-say' }, 'Flip the switches to see the chmod command for any permission set.'),
      s !== real ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { this.scratch = null; this.render(); } }, 'Reset to real permissions') : null));
  }

  // ---------- Pipes ----------
  renderPipes() {
    const recs = this.run.sh.log;
    let last = null;
    for (let i = recs.length - 1; i >= 0 && !last; i--) {
      const r = recs[i];
      if (r.pipelines?.length || r.cmds?.some((c) => c.redirs.length)) last = r;
    }
    if (!last) {
      this.body.append(md('Data flows here. Run a pipeline like `ls -l /etc | grep conf | wc -l`, or redirect output with `>`, and watch each stage pass its output to the next.'));
      return;
    }
    this.body.append(h('p', { class: 'panel-note' }, h('code', {}, last.line)));
    const box = h('div', { class: 'pipes' });
    const pipe = last.pipelines?.[last.pipelines.length - 1];
    if (pipe) {
      pipe.forEach((st, i) => {
        if (i) box.append(h('div', { class: 'pipe-link', 'aria-hidden': 'true' }));
        const lines = st.out.split('\n').filter((l, j, a) => l || j < a.length - 1);
        box.append(h('div', { class: 'pipe-stage' },
          h('div', { class: 'cmd' }, `${i + 1}. ${st.cmd}`),
          h('pre', {}, lines.slice(0, 6).join('\n') + (lines.length > 6 ? `\n… ${lines.length - 6} more lines` : '') || '(no output)')));
      });
    }
    const redirs = last.cmds.flatMap((c) => c.redirs);
    for (const r of redirs) {
      const fd = r.fd ?? (r.op.startsWith('<') ? 0 : 1);
      const what = r.op === '&>' || r.op === '&>>' ? 'stdout + stderr' : fd === 2 ? 'stderr (errors)' : fd === 0 ? 'stdin' : 'stdout';
      const arrow = fd === 0 ? '←' : '→';
      const note = r.target === '/dev/null' ? ' (discarded)' : r.op.endsWith('>>') ? ' (appended)' : r.op === '>&' && r.target === '1' ? ' (merged into stdout)' : '';
      box.append(h('div', { class: 'redir' }, `${what} ${arrow} ${r.target}${note}`));
    }
    this.body.append(box);
  }

  // ---------- Procs ----------
  renderProcs() {
    const sh = this.run.sh;
    const m = sh.s.machine;
    const me = sh.s.user;
    const t = h('table', { class: 'procs' }, h('thead', {}, h('tr', {}, ...['PID', 'USER', '%CPU', 'STAT', 'COMMAND'].map((c) => h('th', {}, c)))));
    const tb = h('tbody');
    for (const p of m.procs.slice().sort((a, b) => a.pid - b.pid)) {
      const cls = p.stat.startsWith('T') ? 'stopped' : (p.cpu || 0) > 50 ? 'hot' : p.user === me ? 'mine' : '';
      tb.append(h('tr', { class: cls }, h('td', {}, p.pid), h('td', {}, p.user), h('td', {}, (p.cpu || 0).toFixed(1)), h('td', {}, p.stat), h('td', { title: p.cmd }, p.cmd)));
    }
    t.append(tb);
    this.body.append(h('p', { class: 'panel-note' }, 'Every running program is a process. Green = yours, red = hungry for CPU, amber = stopped.'), t);
    if (sh.jobs.length) {
      this.body.append(h('h4', { class: 'label', style: { margin: '14px 0 6px' } }, 'Your jobs'),
        ...sh.jobs.map((j) => h('div', { style: { font: '13px var(--font-mono)' } }, `[${j.id}] ${j.state.padEnd(8)} ${j.pid}  ${j.cmd}`)));
    }
    const keys = ['USER', 'HOME', 'PWD', 'SHELL', 'PATH'];
    const extra = [...sh.s.exported].filter((k) => !keys.includes(k) && !['TERM', 'LANG', 'LOGNAME', 'OLDPWD'].includes(k));
    const env = h('dl', { class: 'env-list' });
    for (const k of [...keys, ...extra]) {
      const v = sh.getVar(sh.s, k);
      if (v === undefined) continue;
      env.append(h('dt', {}, `$${k}`), h('dd', {}, v));
    }
    this.body.append(h('h4', { class: 'label', style: { margin: '14px 0 6px' } }, 'Environment'), env);
    if (sh.s.aliases.size) {
      this.body.append(h('h4', { class: 'label', style: { margin: '10px 0 6px' } }, 'Aliases'),
        h('dl', { class: 'env-list' }, ...[...sh.s.aliases].flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));
    }
  }

  // ---------- Codex ----------
  renderCodex() {
    const names = [...new Set([...(this.level.codex || []), ...this.unlocked()])];
    if (this.codexPick && this.docs[this.codexPick]) {
      this.body.append(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { this.codexPick = null; this.render(); } }, '← All cards'),
        codexDetail(this.codexPick, this.docs[this.codexPick]));
      return;
    }
    const mine = new Set(this.unlocked());
    this.body.append(h('p', { class: 'panel-note' }, `This level teaches: ${(this.level.codex || []).join(', ') || '—'}. Finish it to collect the cards.`));
    const grid = h('div', { class: 'codex-grid' });
    for (const n of names) {
      const doc = this.docs[n];
      if (!doc) continue;
      const have = mine.has(n);
      grid.append(codexCard(n, doc, { locked: !have && !(this.level.codex || []).includes(n), learning: !have, onClick: () => { this.codexPick = n; this.render(); } }));
    }
    this.body.append(grid);
  }
}

const TIER_TINT = ['#ffe08a', '#72cbff', '#62e6a4', '#ffae57', '#b38cff', '#ff6f91', '#5fe3e3', '#ffcc4d'];

export function codexCard(name, doc, { locked = false, learning = false, onClick, fresh = false } = {}) {
  return h('button', { type: 'button', class: `card${locked ? ' locked' : ''}${fresh ? ' new' : ''}`, onclick: locked ? null : onClick, 'aria-label': locked ? 'Locked card' : `${name}: ${doc.summary}` },
    h('span', { class: 'tier' }, learning && !locked ? 'NEW' : `Z${doc.zone || 1}`),
    spriteCanvas(locked ? 'lock' : 'scroll', { scale: 3, tint: locked ? null : TIER_TINT[(doc.zone || 1) - 1] }),
    h('span', { class: 'cname' }, locked ? '???' : name),
    h('span', { class: 'csum' }, locked ? 'Keep questing' : doc.summary));
}

export function codexDetail(name, doc) {
  return h('div', { class: 'codex-detail' },
    h('h3', {}, name),
    h('div', { class: 'syn' }, doc.synopsis || name),
    md(doc.desc || doc.summary),
    doc.flags?.length ? h('table', { class: 'flags' }, h('tbody', {}, ...doc.flags.map(([f, d]) => h('tr', {}, h('td', {}, f), h('td', {}, d))))) : null,
    doc.examples?.length ? h('div', {}, h('div', { class: 'label', style: { margin: '10px 0 4px' } }, 'Examples'),
      ...doc.examples.map(([c, d]) => h('div', { style: { marginBottom: '6px' } }, h('code', { style: { color: 'var(--mint)' } }, c), h('div', { style: { fontSize: '14px', color: 'var(--muted)' } }, d)))) : null,
    doc.hacker ? h('div', { class: 'hacker' }, h('strong', {}, 'Hacker’s note: '), doc.hacker) : null);
}

