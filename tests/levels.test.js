import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONES } from '../src/content/zones.js';
import { DOCS } from '../src/content/codex.js';
import { LevelRun, solutionSteps } from '../src/engine/level.js';
import { makeTerm } from './harness.js';
import { checkLevel } from './zonecheck.mjs';

const levels = ZONES.flatMap((z) => z.levels.map((l) => ({ ...l, zone: z.id })));

test('level ids are unique', () => {
  const ids = levels.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
});

for (const level of levels) {
  test(`${level.id} ${level.title}: well formed`, () => {
    assert.ok(level.teach.length >= 1, 'has teaching cards');
    assert.ok(level.objectives.length >= 1, 'has objectives');
    assert.equal(level.hints.length, 3, 'three hint tiers');
    assert.ok(level.xp > 0);
    for (const c of level.teach) {
      assert.ok(c.title && c.body, 'card has title and body');
      if (c.quiz) assert.ok(c.quiz.answer >= 0 && c.quiz.answer < c.quiz.options.length, `quiz answer in range: ${c.quiz.q}`);
    }
    for (const name of level.codex || []) assert.ok(DOCS[name], `codex card exists: ${name}`);
  });

  for (const seed of [1, 99]) {
    test(`${level.id} ${level.title}: solvable (seed ${seed})`, () => checkLevel(level, seed));
  }

  if (level.boss) {
    test(`${level.id}: a wrong flag costs a heart`, async () => {
      const term = makeTerm();
      const run = new LevelRun(level, { term, seed: 5 });
      await run.sh.run('submit WRONG-FLAG');
      assert.equal(run.state.hearts, 2);
      assert.match(term.buf, /hearts? left/);
    });
  }
}
