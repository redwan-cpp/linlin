// Headless terminal for tests: captures output, answers prompts from a queue, auto-closes overlays.
import { createWorld, createShell } from '../src/engine/setup.js';

export function makeTerm({ cols = 80, answers = [], edit = null, sleepResult = 'done' } = {}) {
  const term = {
    cols,
    edit,
    buf: '',
    overlays: [],
    answers,
    write(t) { term.buf += t; },
    async prompt(text) { term.buf += text; return term.answers.length ? term.answers.shift() : null; },
    async readStdin() { return ''; },
    async sleep() { return typeof sleepResult === 'function' ? sleepResult() : sleepResult; },
    async overlay(spec) {
      term.overlays.push(spec);
      if (spec.type === 'editor' && term.edit) spec.result = spec.save(term.edit(spec.content, spec), spec.path);
      return null;
    },
    clear() { term.buf = ''; },
  };
  return term;
}

export function setup(opts = {}) {
  const world = opts.world || createWorld({ seed: 42, clock: opts.clock });
  const term = makeTerm(opts);
  const sh = createShell(world, { term, docs: opts.docs });
  const run = async (line, answers) => {
    term.buf = '';
    if (answers) term.answers.push(...answers);
    await sh.run(line);
    return term.buf.replace(/\x1b\[[0-9;]*[mK]/g, '');
  };
  return { world, sh, term, run, m: world.machine('quest') };
}
