// The level screen: Scroll (teach) → Quest (do) → Debrief (reflect). Terminal center, panels right.
import { h, md, modal, toast } from './dom.js';
import { Terminal } from './terminal.js';
import { Panels, codexCard } from './panels.js';
import { LevelRun } from '../engine/level.js';
import { cronTick } from '../engine/cron.js';
import { COMMANDS } from '../engine/commands/index.js';
import { spriteCanvas } from './sprites.js';
import { sfx } from './sound.js';
import { askOracle, getSample, oracleError } from './oracle.js';
import { rankFor } from './save.js';

export function levelScreen({ level, zone, index, docs, save, onExit, onNext, hasNext }) {
  const state = {
    phase: 'teach', card: 0, quizRight: 0, quizTried: {}, hints: 0, oracle: 0, t0: Date.now(), viewingLesson: false,
    wrongSeen: 0, finished: false,
  };
  const timers = [];
  let run;
  let oracleOk = null;
  let oracleCtl = null;

  const side = h('div', { class: 'side' });
  const term = new Terminal({ onDone: () => afterCommand() });
  const panels = new Panels({ docs, unlocked: () => save.data.codex });
  const total = zone.levels.length;
  const head = h('div', { class: 'level-head' },
    h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { dispose(); onExit(); } }, '← Map'),
    h('div', {}, h('div', { class: 'crumb' }, `Zone ${zone.id} · ${zone.name} · ${level.boss ? 'Boss' : `Quest ${index + 1}/${total}`}`), h('h2', {}, level.title)),
    h('button', { class: 'btn btn-sm btn-ghost', type: 'button', style: { marginLeft: 'auto' }, onclick: () => { boot(); toast('Fresh world loaded.'); } }, 'Restart world'));
  const root = h('div', { class: 'level-grid' }, head, side, term.wrap, panels.el);

  function boot() {
    run = new LevelRun(level, { term, docs });
    term.attach(run.sh);
    state.wrongSeen = 0;
    term.sys(`— ${zone.name} · ${level.title} —`);
    if (state.phase === 'teach') term.sys('This terminal is live. Try the commands from the scroll as you read. Nothing you do here can break your real computer.');
    if (state.phase === 'quest') { run.logStart = run.sh.log.length; }
    panels.attach(run, level);
    run.sh.events.on('session', () => panels.refresh());
    if (state.phase === 'quest') renderQuest();
  }

  function afterCommand() {
    panels.refresh();
    if (state.phase !== 'quest' || state.finished) return;
    if (run.state.wrong > state.wrongSeen) {
      state.wrongSeen = run.state.wrong;
      sfx(level.boss ? 'hit' : 'wrong');
    }
    const res = run.check();
    if (res.newly.length) {
      sfx('objective');
      renderQuest(res.newly);
      if (level.boss) side.querySelector('.boss')?.classList.add('hit');
    } else if (level.boss) renderQuest();
    if (res.complete) { finish(); return; }
    if (res.failed) {
      toast(`The ${level.boss.name} resets the arena. Fresh world, full hearts.`, 3200);
      boot();
    }
  }

  // ---------- Scroll ----------
  function renderScroll() {
    side.textContent = '';
    const c = level.teach[state.card];
    const box = h('section', { class: 'scroll box-parch', 'aria-label': 'Lesson scroll' });
    if (state.card === 0 && level.story) {
      box.append(h('div', { class: 'npc' }, spriteCanvas('sage', { scale: 3 }),
        h('div', {}, h('div', { class: 'name' }, level.npc || 'Old Root, the Sysadmin Sage'), h('div', { class: 'story' }, md(level.story)))));
    }
    box.append(h('h3', {}, c.title), md(c.body));
    for (const cmd of [].concat(c.try || [])) {
      box.append(h('div', { class: 'try' }, h('code', {}, `$ ${cmd}`),
        h('button', { class: 'btn btn-sm btn-mint', type: 'button', style: { marginLeft: 'auto' }, onclick: () => { term.typeAndRun(cmd); } }, 'Run it')));
    }
    if (c.after) box.append(md(c.after));
    if (c.visual) panels.show(c.visual);
    const key = `${level.id}:${state.card}`;
    let canGo = !c.quiz || save.data.quiz[key] === true || state.quizTried[key] === 'right';
    if (c.quiz) {
      const explain = h('div', { class: 'quiz-explain' });
      const opts = h('div', { class: 'quiz-opts' });
      c.quiz.options.forEach((o, i) => {
        const b = h('button', {
          type: 'button', class: 'quiz-opt', onclick: () => {
            if (i === c.quiz.answer) {
              b.classList.add('right');
              for (const x of opts.children) x.disabled = true;
              explain.textContent = '';
              explain.append(md(`**Correct.** ${c.quiz.explain || ''}`));
              if (!state.quizTried[key]) state.quizRight++;
              state.quizTried[key] = 'right';
              save.update((d) => { d.quiz[key] = true; });
              sfx('quiz');
              next.disabled = false;
            } else {
              b.classList.add('wrong');
              b.disabled = true;
              state.quizTried[key] = state.quizTried[key] || 'wrong';
              explain.textContent = '';
              explain.append(md(c.quiz.why?.[i] ? `Not quite. ${c.quiz.why[i]}` : 'Not quite. Read the card again and try another answer.'));
              sfx('wrong');
            }
          },
        }, o);
        if (canGo && i === c.quiz.answer && save.data.quiz[key]) { b.classList.add('right'); }
        opts.append(b);
      });
      if (canGo) for (const x of opts.children) x.disabled = true;
      box.append(h('div', { class: 'quiz' }, h('div', { class: 'q' }, c.quiz.q), opts, explain));
    }
    const last = state.card === level.teach.length - 1;
    const next = h('button', {
      class: `btn btn-sm ${last ? 'btn-gold' : ''}`, type: 'button', disabled: !canGo,
      onclick: () => {
        sfx('click');
        if (!last) { state.card++; renderScroll(); return; }
        if (state.phase === 'quest') { state.viewingLesson = false; renderQuest(); return; }
        startQuest();
      },
    }, last ? (state.phase === 'quest' ? 'Back to quest ▶' : 'Start the quest ▶') : 'Next ▶');
    box.append(h('div', { class: 'pager' },
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', disabled: state.card === 0, style: { color: 'var(--parch-ink)' }, onclick: () => { state.card--; renderScroll(); } }, '◀ Back'),
      h('div', { class: 'dots', 'aria-label': `Card ${state.card + 1} of ${level.teach.length}` }, level.teach.map((_, i) => h('i', { class: i <= state.card ? 'on' : '' }))),
      next));
    if (state.phase === 'quest') box.append(h('button', { class: 'btn btn-sm', type: 'button', style: { marginTop: '10px' }, onclick: () => { state.viewingLesson = false; renderQuest(); } }, 'Back to quest'));
    side.append(box);
  }

  // The quest gets a fresh world, so nothing tried on the teaching cards counts or lingers.
  function startQuest() {
    state.phase = 'quest';
    state.t0 = Date.now();
    boot();
    term.sys(level.boss ? `⚔  ${level.boss.name} appears! ${level.boss.taunt || ''}` : '★ Quest started in a fresh world. Objectives are on the left.');
    term.focus();
  }

  // ---------- Quest ----------
  function renderQuest(newly = []) {
    if (state.viewingLesson) return;
    side.textContent = '';
    const doneCount = run.done.filter(Boolean).length;
    if (level.boss) {
      const hp = 1 - doneCount / level.objectives.length;
      const hearts = h('div', { class: 'hearts', 'aria-label': `${run.state.hearts} hearts left` });
      for (let i = 0; i < 3; i++) hearts.append(spriteCanvas('heart', { scale: 3, cls: 'heart', tint: i < run.state.hearts ? null : '#3a3460' }));
      side.append(h('section', { class: `boss box${newly.length ? ' hit' : ''}` },
        spriteCanvas(zone.boss, { scale: 4 }),
        h('div', {}, h('div', { class: 'boss-name' }, level.boss.name), h('div', { class: 'hpbar', role: 'meter', 'aria-valuenow': Math.round(hp * 100), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Boss health' }, h('i', { style: { width: `${hp * 100}%` } })), hearts)));
    }
    const ol = h('ul', { class: 'objectives' });
    level.objectives.forEach((o, i) => ol.append(h('li', { class: `${run.done[i] ? 'done' : ''}${newly.includes(i) ? ' just' : ''}` }, o.text)));
    const hintBox = h('div', { class: 'hints' });
    level.hints.slice(0, state.hints).forEach((t, i) => hintBox.append(h('div', { class: 'hint' }, h('strong', {}, `Hint ${i + 1}: `), md(t))));
    if (state.hints < level.hints.length) {
      hintBox.append(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { state.hints++; sfx('click'); renderQuest(); } },
        `Reveal hint ${state.hints + 1}/${level.hints.length} (−10% XP)`));
    }
    const quest = h('section', { class: 'quest box' },
      h('h3', {}, level.boss ? 'Boss fight' : 'Quest'),
      level.brief ? md(level.brief) : null,
      h('div', { class: 'label', style: { marginTop: '8px' } }, `Objectives ${doneCount}/${level.objectives.length}`),
      ol,
      h('div', { class: 'label', style: { margin: '6px 0' } }, 'Stuck?'),
      hintBox,
      oracleBox(),
      h('button', { class: 'btn btn-sm btn-ghost', type: 'button', style: { marginTop: '12px' }, onclick: () => { state.viewingLesson = true; state.card = 0; renderScroll(); } }, 'Re-read the lesson'));
    side.append(quest);
  }

  function oracleBox() {
    const box = h('div', { style: { marginTop: '12px', display: 'grid', gap: '8px' } });
    if (oracleOk === false) {
      box.append(h('p', { class: 'panel-note', style: { margin: 0 } }, 'The Oracle (Claude) answers when you play on claude.ai.'));
      return box;
    }
    const out = h('div', { class: 'oracle-out', hidden: true, 'aria-live': 'polite' });
    const q = h('input', { type: 'text', placeholder: 'Ask the Oracle (optional question)', 'aria-label': 'Question for the Oracle' });
    const ask = h('button', { class: 'btn btn-sm', type: 'button', style: { background: 'var(--violet)', color: '#1a0e3a' } }, 'Ask the Oracle');
    ask.addEventListener('click', async () => {
      if (oracleCtl) { oracleCtl.abort(); return; }
      oracleCtl = new AbortController();
      out.hidden = false;
      out.textContent = 'The Oracle gazes into your terminal…';
      ask.textContent = 'Stop';
      sfx('oracle');
      try {
        await askOracle({ level, run, question: q.value.trim(), signal: oracleCtl.signal, onText: ({ text }) => { out.textContent = text; } });
        state.oracle++;
      } catch (e) {
        out.textContent = oracleError(e);
      }
      oracleCtl = null;
      ask.textContent = 'Ask the Oracle';
    });
    box.append(h('div', { class: 'oracle-row' }, q, ask), out, h('div', { class: 'panel-note', style: { margin: 0, fontSize: '12px' } }, 'The Oracle gives nudges, never answers. Each question costs 5% XP.'));
    return box;
  }

  // ---------- Debrief ----------
  function finish() {
    if (state.finished) return;
    state.finished = true;
    const ms = Date.now() - state.t0;
    const first = !save.data.completed[level.id];
    const hintPen = Math.min(0.5, state.hints * 0.1);
    const oraclePen = Math.min(0.2, state.oracle * 0.05);
    const base = Math.round(level.xp * (1 - hintPen - oraclePen));
    const heartBonus = level.boss ? run.state.hearts * 20 : 0;
    const quizBonus = state.quizRight * 5;
    const xp = first ? base + heartBonus + quizBonus : 0;
    const before = new Set(save.data.codex);
    const fresh = (level.codex || []).filter((c) => !before.has(c));
    const rankBefore = rankFor(save.data.xp).name;
    save.update((d) => {
      d.xp += xp;
      if (first) d.completed[level.id] = { at: Date.now(), xp, hints: state.hints, oracle: state.oracle, ms, cmds: run.sh.history.length };
      d.codex = [...new Set([...d.codex, ...(level.codex || [])])];
      save.markPlayed(Math.max(1, Math.round(ms / 60000)));
    });
    sfx('complete');
    if (fresh.length) setTimeout(() => sfx('unlock'), 700);
    const rank = rankFor(save.data.xp);
    const rows = first ? [
      ['Quest reward', level.xp],
      state.hints ? [`Hints used (${state.hints})`, -Math.round(level.xp * hintPen)] : null,
      state.oracle ? [`Oracle questions (${state.oracle})`, -Math.round(level.xp * oraclePen)] : null,
      quizBonus ? [`Quiz answered first try (${state.quizRight})`, quizBonus] : null,
      heartBonus ? [`Hearts left (${run.state.hearts})`, heartBonus] : null,
    ].filter(Boolean) : [];
    const journal = h('textarea', { placeholder: 'Write one or two lines in your own words…', 'aria-label': level.journal || 'Journal entry' });
    const irlCheck = h('input', { type: 'checkbox', checked: !!save.data.realWorld[level.id] });
    const bandit = (level.realWorld?.bandit || []).map((n) => h('a', { href: `https://overthewire.org/wargames/bandit/bandit${n}.html`, target: '_blank', rel: 'noopener' }, `Bandit page ${n}`));
    const commit = () => {
      const text = journal.value.trim();
      const firstNote = text && !save.data.journal.some((j) => j.levelId === level.id);
      save.update((d) => {
        if (text) d.journal.push({ id: `${level.id}-${Date.now()}`, levelId: level.id, at: Date.now(), text });
        if (firstNote) d.xp += 10;
        if (irlCheck.checked) d.realWorld[level.id] = true; else delete d.realWorld[level.id];
      });
      if (firstNote) toast('+10 XP for your journal entry');
    };
    const content = h('div', { class: 'debrief' },
      h('div', { class: 'banner' }, level.boss ? 'BOSS DEFEATED' : 'QUEST COMPLETE'),
      h('div', { style: { display: 'flex', justifyContent: 'center' } }, spriteCanvas(level.boss ? zone.boss : 'recruit', { scale: 5, tint: level.boss ? '#7a7398' : null })),
      first ? h('div', { class: 'xp-gain' }, ...rows.map(([k, v]) => h('div', { class: 'row' }, h('span', {}, k), h('span', {}, `${v > 0 ? '+' : ''}${v} XP`))),
        h('div', { class: 'row total' }, h('span', {}, 'Total'), h('span', {}, `+${xp} XP`)))
        : h('p', { class: 'panel-note' }, 'Replay complete. XP was earned on your first clear, and practice makes it stick.'),
      h('p', { style: { textAlign: 'center', margin: '4px 0 10px' } }, rank.name !== rankBefore ? h('strong', { style: { color: 'var(--gold)' } }, `RANK UP! You are now ${rank.name}.`) : `Rank: ${rank.name}${rank.next ? ` · ${rank.next - save.data.xp} XP to ${rankFor(rank.next).name}` : ''}`),
      fresh.length ? h('div', {}, h('div', { class: 'label' }, 'Codex cards collected'), h('div', { class: 'unlocks' }, fresh.map((c) => (docs[c] ? codexCard(c, docs[c], { fresh: true, onClick: () => {} }) : null)))) : null,
      level.realWorld ? h('div', { class: 'irl' }, h('strong', {}, 'Do it for real: '), md(level.realWorld.text), bandit.length ? h('div', {}, 'OverTheWire: ', ...bandit.flatMap((a, i) => (i ? [' · ', a] : [a]))) : null,
        h('label', { class: 'check' }, irlCheck, 'I did this on my real Kali or Mac terminal')) : null,
      h('div', { class: 'label', style: { marginTop: '10px' } }, 'Journal'),
      h('div', { style: { fontSize: '15px' } }, level.journal || 'What did you learn, in your own words?'),
      journal,
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { commit(); dlg.close(); } }, 'Stay here'),
        h('button', { class: 'btn', type: 'button', onclick: () => { commit(); dlg.close(); dispose(); onExit(); } }, 'Back to map'),
        hasNext ? h('button', { class: 'btn btn-gold', type: 'button', onclick: () => { commit(); dlg.close(); dispose(); onNext(); } }, 'Next quest ▶') : null));
    const dlg = modal(content);
    renderQuest();
  }

  function dispose() {
    for (const t of timers) clearInterval(t);
    oracleCtl?.abort();
  }

  boot();
  renderScroll();
  getSample().then((s) => { oracleOk = !!s; if (state.phase === 'quest' && !state.viewingLesson) renderQuest(); });
  if (level.cron) {
    timers.push(setInterval(async () => {
      if (!root.isConnected) { dispose(); return; }
      await cronTick(run.world, COMMANDS, docs);
      afterCommand();
    }, (level.cron.every || 15) * 1000));
  }
  setTimeout(() => term.focus(), 50);
  return { el: root, dispose, snapshot: () => ({ phase: state.phase, card: state.card }) };
}
