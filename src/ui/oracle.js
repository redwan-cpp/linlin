// The Oracle: a hint from Claude through the `sample` capability. It nudges; it never solves.
let samplePromise = null;

export function getSample() {
  if (!samplePromise) samplePromise = window.claude?.use ? window.claude.use('sample').catch(() => null) : Promise.resolve(null);
  return samplePromise;
}

function transcript(run, max = 12) {
  const recs = run.sh.log.slice(run.logStart).slice(-max);
  if (!recs.length) return '(nothing typed yet)';
  return recs.map((r) => `$ ${r.line}\n${r.out.length > 400 ? r.out.slice(0, 400) + '\n…(trimmed)' : r.out}`).join('\n');
}

export async function askOracle({ level, run, question, onText, signal }) {
  const sample = await getSample();
  if (!sample) throw { code: 'unavailable', message: 'The Oracle only speaks inside claude.ai.' };
  const objectives = level.objectives.map((o, i) => `${run.done[i] ? '[done]' : '[todo]'} ${o.text}`).join('\n');
  const lesson = level.teach.map((c) => `- ${c.title}: ${c.body.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
  const prompt = `You are the Oracle in "Linux Quest", a pixel RPG that teaches the Linux command line to a beginner who wants to become a hacker.

Rules you never break:
- Give a HINT, never the solution. Do not write the full command that completes an objective, and never reveal or guess a flag.
- Prefer a guiding question, or point to the concept, a flag name, or "try man <command>".
- At most 3 short sentences. Plain text. Wrap single command or flag names in backticks.
- Speak like a wise but friendly RPG oracle, but stay clear and practical.

Level: ${level.title} (Zone ${level.zone})
Lesson summary:
${lesson}

Objectives:
${objectives}

The player's recent terminal session:
${transcript(run)}

The player asks: ${question || "I'm stuck. Give me a nudge toward the next objective."}`;
  const r = await sample(prompt, { modelTier: 'quick', onText, signal, cache: false });
  return r.text;
}

export function oracleError(e) {
  switch (e?.code) {
    case 'not_granted': return 'The Oracle needs your permission to use Claude. Allow it when asked, or rely on the hints.';
    case 'rate_limited': return 'The Oracle is resting. Try again in a minute.';
    case 'cancelled': return 'Question withdrawn.';
    case 'unavailable': return 'The Oracle only speaks inside claude.ai. The built-in hints still work.';
    default: return 'The Oracle’s vision is cloudy right now. Use a hint or try again later.';
  }
}
