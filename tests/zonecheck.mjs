// Check one zone's levels in isolation: node tests/zonecheck.mjs 3
import assert from 'node:assert/strict';
import { DOCS } from '../src/content/codex.js';
import { LevelRun, solutionSteps } from '../src/engine/level.js';
import { cronTick } from '../src/engine/cron.js';
import { COMMANDS } from '../src/engine/commands/index.js';
import { makeTerm } from './harness.js';

export async function checkLevel(level, seed) {
  const term = makeTerm();
  const run = new LevelRun(level, { term, seed, docs: DOCS });
  run.logStart = run.sh.log.length;
  const early = run.check();
  assert.equal(early.complete, false, `${level.id}: complete before playing`);
  assert.deepEqual(early.newly, [], `${level.id}: objectives already true before playing: ${early.newly.map((i) => level.objectives[i].text).join(' | ')}`);
  for (const step of solutionSteps(level, run)) {
    if (step.cron) { await cronTick(run.world, COMMANDS, DOCS); run.check(); continue; }
    term.edit = step.edit || null;
    if (step.answers.length) term.answers.push(...step.answers);
    await run.sh.run(step.cmd);
    run.check();
  }
  const missing = level.objectives.filter((_, i) => !run.done[i]).map((o) => o.text);
  assert.deepEqual(missing, [], `${level.id} (seed ${seed}) objectives left: ${missing.join(' | ')}\n--- terminal tail ---\n${term.buf.slice(-3000)}`);
}

export function checkShape(level) {
  assert.ok(/^z\d-(\d+|boss)$/.test(level.id), `bad id ${level.id}`);
  assert.ok(level.teach?.length >= 1, `${level.id}: teach cards`);
  assert.ok(level.objectives?.length >= 1, `${level.id}: objectives`);
  assert.equal(level.hints?.length, 3, `${level.id}: exactly 3 hints`);
  assert.ok(level.xp > 0, `${level.id}: xp`);
  for (const c of level.teach) {
    assert.ok(c.title && c.body, `${level.id}: card title/body`);
    if (c.quiz) assert.ok(c.quiz.answer >= 0 && c.quiz.answer < c.quiz.options.length, `${level.id}: quiz answer index`);
  }
  for (const n of level.codex || []) assert.ok(DOCS[n], `${level.id}: codex card "${n}" missing from codex.js`);
  if (level.id.endsWith('boss')) assert.ok(level.boss?.name, `${level.id}: boss needs boss.name`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = Number(process.argv[2]);
  const { default: levels } = await import(`../src/content/levels/zone${n}.js`);
  let failed = 0;
  for (const level of levels) {
    for (const [label, fn] of [['shape', () => checkShape(level)], ['seed 1', () => checkLevel(level, 1)], ['seed 99', () => checkLevel(level, 99)]]) {
      try {
        await fn();
        console.log(`ok   ${level.id} ${label}`);
      } catch (e) {
        failed++;
        console.log(`FAIL ${level.id} ${label}\n${e.message}\n`);
      }
    }
  }
  console.log(failed ? `\n${failed} check(s) failed` : `\nZone ${n}: all ${levels.length} levels pass`);
  process.exit(failed ? 1 : 0);
}
