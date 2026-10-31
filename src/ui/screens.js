// Welcome, Codex and Journal screens, plus the Obsidian Markdown export.
import { h, md, toast } from './dom.js';
import { spriteCanvas, drawSprite, SPRITES } from './sprites.js';
import { codexCard, codexDetail } from './panels.js';
import { rankFor, today } from './save.js';

export function welcomeScreen({ onStart }) {
  const scene = h('canvas', { class: 'scene', width: 320, height: 140, 'aria-hidden': 'true' });
  const g = scene.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#16204a'; g.fillRect(0, 0, 320, 140);
  g.fillStyle = '#ffffff55';
  for (let i = 0; i < 40; i++) g.fillRect((i * 73) % 320, (i * 37) % 70, 1, 1);
  g.fillStyle = '#3f9e5a'; g.fillRect(0, 104, 320, 36);
  g.fillStyle = '#2f7a46'; for (let x = 0; x < 320; x += 6) g.fillRect(x, 104, 3, 2);
  g.fillStyle = '#0b0918'; g.fillRect(196, 62, 52, 42); g.fillStyle = '#62e6a4'; g.fillRect(200, 66, 44, 30);
  g.fillStyle = '#0b0918'; g.font = '8px monospace'; g.fillText('$ _', 204, 78);
  g.fillStyle = '#463b86'; g.fillRect(214, 104, 16, 4);
  drawSprite(g, SPRITES.recruit, 150, 72, 2);
  drawSprite(g, SPRITES.sage, 84, 72, 2);
  const name = h('input', { type: 'text', id: 'handle', maxlength: '20', value: '', placeholder: 'your hacker handle', 'aria-label': 'Your hacker handle', autocomplete: 'off' });
  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const v = name.value.trim().replace(/[^\w.-]/g, '') || 'recruit';
      onStart(v);
    },
  }, name, h('button', { class: 'btn btn-gold', type: 'submit' }, 'Begin the quest ▶'));
  return h('div', { class: 'welcome' },
    h('h1', {}, 'Linux Quest'),
    h('p', {}, 'Stage 1 · The Linux Lands. Learn the command line by playing it: a real-feeling terminal, a sage who teaches, quests that test you, and bosses that guard every zone.'),
    scene,
    h('p', { class: 'label' }, 'What should the realm call you?'),
    form,
    h('p', { style: { fontSize: '14px' } }, 'Two hours a day is plenty. Your progress saves automatically, and the Journal exports to Obsidian.'));
}

export function codexScreen({ docs, zones, save }) {
  const have = new Set(save.data.codex);
  const all = Object.keys(docs).filter((n) => !docs[n].hidden);
  const detail = h('div', { class: 'box', style: { marginTop: '16px' }, hidden: true });
  const show = (n) => {
    detail.hidden = false;
    detail.textContent = '';
    detail.append(codexDetail(n, docs[n]));
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const sections = zones.map((z) => {
    const names = all.filter((n) => (docs[n].zone || 1) === z.id).sort();
    if (!names.length) return null;
    const got = names.filter((n) => have.has(n)).length;
    return h('section', { style: { marginBottom: '18px' } },
      h('h3', { style: { font: '700 20px var(--font-display)', margin: '0 0 8px', color: z.color } }, `${z.name} `, h('span', { class: 'label' }, `${got}/${names.length}`)),
      h('div', { class: 'codex-grid' }, names.map((n) => codexCard(n, docs[n], { locked: !have.has(n), onClick: () => show(n) }))));
  });
  return h('div', {},
    h('h2', { style: { font: '700 30px var(--font-display)', margin: '0 0 4px' } }, 'The Codex'),
    h('p', { style: { color: 'var(--muted)', margin: '0 0 16px' } }, `${have.size} of ${all.length} command cards collected. Finish quests to unlock more. Every card is also a man page inside the game: type man NAME.`),
    ...sections, detail);
}

function fmtDate(ms) { return today(new Date(ms)); }

export function journalMarkdown({ save, zones }) {
  const d = save.data;
  const rank = rankFor(d.xp);
  const levels = zones.flatMap((z) => z.levels);
  const done = levels.filter((l) => d.completed[l.id]).length;
  const totalMin = Object.values(d.days).reduce((a, b) => a + b, 0);
  let s = `---\ntags:\n  - linux-quest\n  - cybersecurity\n  - journal\nplayer: ${d.name}\nrank: ${rank.name}\nxp: ${d.xp}\nquests_done: ${done}\nupdated: ${today()}\n---\n\n`;
  s += `# Linux Quest Journal\n\n> Stage 1, The Linux Lands. ${done}/${levels.length} quests · ${rank.name} · ${d.xp} XP · streak ${save.streak()} day${save.streak() === 1 ? '' : 's'} · ${Math.round(totalMin / 6) / 10} h played\n\n`;
  for (const z of zones) {
    if (!z.levels.length) continue;
    s += `## Zone ${z.id}: ${z.name}\n\n`;
    for (const l of z.levels) {
      const c = d.completed[l.id];
      s += `### ${c ? '✅' : '⬜'} ${l.boss ? 'Boss: ' : ''}${l.title}${c ? ` (${fmtDate(c.at)})` : ''}\n`;
      if (!c) { s += '\n'; continue; }
      s += `- XP: ${c.xp} · Time: ${Math.max(1, Math.round(c.ms / 60000))} min · Hints: ${c.hints} · Oracle: ${c.oracle}\n`;
      s += `- Commands learned: ${(l.codex || []).map((x) => `\`${x}\``).join(', ')}\n`;
      s += `- [${d.realWorld[l.id] ? 'x' : ' '}] Did it for real on Kali\n`;
      for (const j of d.journal.filter((e) => e.levelId === l.id)) s += `\n> ${j.text.replace(/\n/g, '\n> ')}\n> — ${fmtDate(j.at)}\n`;
      s += '\n';
    }
  }
  s += `## Codex (${d.codex.length})\n\n${d.codex.sort().map((c) => `\`${c}\``).join(' ')}\n`;
  return s;
}

async function exportJournal(save, zones) {
  const text = journalMarkdown({ save, zones });
  const dl = window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
  if (dl) {
    try {
      await dl.save({ filename: 'Linux Quest Journal.md', data: text });
      toast('Saved. Drop it into your Obsidian vault.');
      return;
    } catch (e) {
      if (e?.code === 'declined') { toast('Export cancelled.'); return; }
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Journal copied as Markdown. Paste it into a new Obsidian note.');
  } catch {
    const ta = document.getElementById('journal-md');
    if (ta) { ta.hidden = false; ta.value = text; ta.select(); toast('Select-all is done. Copy it with Ctrl+C / Cmd+C.'); }
  }
}

export function journalScreen({ save, zones, onOpen }) {
  const d = save.data;
  const rank = rankFor(d.xp);
  const levels = zones.flatMap((z) => z.levels);
  const done = levels.filter((l) => d.completed[l.id]).length;
  const totalMin = Object.values(d.days).reduce((a, b) => a + b, 0);
  const stats = h('aside', { class: 'jstats box' },
    h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, spriteCanvas('recruit', { scale: 3 }), h('div', {}, h('div', { style: { font: '700 20px var(--font-display)' } }, d.name), h('div', { class: 'label' }, rank.name))),
    h('div', { class: 'jstat' }, h('span', {}, 'XP'), h('b', {}, d.xp)),
    h('div', { class: 'jstat' }, h('span', {}, 'Quests'), h('b', {}, `${done}/${levels.length}`)),
    h('div', { class: 'jstat' }, h('span', {}, 'Streak'), h('b', {}, `${save.streak()}d`)),
    h('div', { class: 'jstat' }, h('span', {}, 'Time played'), h('b', {}, `${Math.round(totalMin / 6) / 10}h`)),
    h('div', { class: 'jstat' }, h('span', {}, 'Codex'), h('b', {}, d.codex.length)),
    h('button', { class: 'btn btn-gold', type: 'button', onclick: () => exportJournal(save, zones) }, 'Export to Obsidian (.md)'),
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(journalMarkdown({ save, zones })); toast('Copied as Markdown.'); } catch {
        const ta = document.getElementById('journal-md'); ta.hidden = false; ta.value = journalMarkdown({ save, zones }); ta.select();
      }
    } }, 'Copy Markdown'),
    h('textarea', { id: 'journal-md', hidden: true, readonly: true, 'aria-label': 'Journal Markdown', style: { width: '100%', minHeight: '140px', font: '12px var(--font-mono)', background: 'var(--term)', color: 'var(--text)' } }));
  const main = h('div', {});
  if (!done) {
    main.append(h('div', { class: 'empty box' }, md('Your journal is empty. Finish your first quest and write a line about what you learned. **Explaining it in your own words is how it sticks.**')));
  }
  for (const z of zones) {
    const entries = z.levels.filter((l) => d.completed[l.id]);
    if (!entries.length) continue;
    const sec = h('section', { class: 'jzone' }, h('h3', { style: { color: z.color } }, `Zone ${z.id}: ${z.name}`));
    for (const l of entries) {
      const c = d.completed[l.id];
      const notes = d.journal.filter((j) => j.levelId === l.id);
      const ta = h('textarea', { placeholder: 'Add a note…', 'aria-label': `Note for ${l.title}` });
      const irl = h('input', { type: 'checkbox', checked: !!d.realWorld[l.id], onchange: () => save.update((x) => { if (irl.checked) x.realWorld[l.id] = true; else delete x.realWorld[l.id]; }) });
      sec.append(h('article', { class: 'entry box' },
        h('div', { class: 'entry-head' }, h('b', {}, `${l.boss ? 'Boss · ' : ''}${l.title}`), h('span', { class: 'entry-meta' }, `${fmtDate(c.at)} · +${c.xp} XP · ${Math.max(1, Math.round(c.ms / 60000))} min · ${c.hints} hints`)),
        h('div', { style: { fontSize: '14px', color: 'var(--muted)', marginTop: '4px' } }, 'Learned: ', ...(l.codex || []).flatMap((x, i) => [i ? ', ' : '', h('code', {}, x)])),
        ...notes.map((n) => h('blockquote', {}, n.text)),
        ta,
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '6px' } },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => {
            const t = ta.value.trim();
            if (!t) return;
            save.update((x) => { x.journal.push({ id: `${l.id}-${Date.now()}`, levelId: l.id, at: Date.now(), text: t }); });
            ta.value = '';
            toast('Note saved.');
            main.replaceWith(journalScreen({ save, zones, onOpen }).querySelector('div:last-child'));
          } }, 'Save note'),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => onOpen(l.id) }, 'Replay'),
          h('label', { class: 'check', style: { marginTop: 0 } }, irl, 'Did it for real on Kali'))));
    }
    main.append(sec);
  }
  return h('div', { class: 'journal' }, stats, main);
}
