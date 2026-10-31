# Writing Linux Quest levels

Levels are plain data in `src/content/levels/zoneN.js` (`export default [ ...levels ]`). Zone 1 and Zone 2 are the reference: match their tone, depth and structure.

Check a zone with: `node tests/zonecheck.mjs N` (runs every level's solution against a fresh world with two seeds, plus schema checks).

## Level shape

```js
{
  id: 'z3-1',                 // zN-K for quests, zN-boss for the boss (always last)
  title: 'The Seeker\'s Eye',
  xp: 60,                     // quests 50–90, boss 150–200
  panel: 'map',               // default visual tab: map | runes | pipes | procs | codex
  story: 'One or two sentences, Old Root the Sysadmin Sage speaking. Warm, a little playful.',
  teach: [                    // 3–5 cards. Each teaches ONE idea. Plain, short sentences.
    {
      title: 'find walks the tree',
      body: 'Markdown-lite: **bold**, `code`, - lists, ```blocks```, blank line = paragraph.',
      try: 'find ~ -name "*.txt"',            // string or array: "Run it" buttons (run in the level world)
      visual: 'map',                            // optional: switch the right panel when shown
      after: 'Optional text shown after the try buttons (e.g. a **Hacker\'s note:**).',
      quiz: {                                   // optional; at least 2 per level
        q: 'Question?',
        options: ['a', 'b', 'c'],
        answer: 1,                              // index of the right option
        explain: 'Why the right answer is right.',
        why: { 0: 'Why a is wrong.', 2: 'Why c is wrong.' },
      },
    },
  ],
  brief: 'One line shown above the objectives.',
  setup(w) { /* build the world, see below */ },
  start: { cwd: '/home/recruit', user: 'recruit', host: 'quest', env: { FOO: 'bar' } }, // all optional
  objectives: [ { text: 'Imperative, specific', check: (q) => q.ran('find', { flags: 'n' }) } ],
  hints: ['nudge', 'stronger nudge', 'near-solution'],   // exactly 3
  codex: ['find'],            // commands this level teaches (must exist in src/content/codex.js)
  realWorld: { text: 'What to do on the real Kali terminal.', bandit: [5, 6] }, // bandit = page numbers: bandit5.html = Level 4→5
  journal: 'A reflection question.',
  boss: { name: 'Bandit Chief', taunt: '"..." line' },   // boss levels only
  cron: { every: 15 },        // only if the level needs cron to tick (seconds, in the browser)
  solution: ['cmd', 'cmd'],   // or (state, run) => [...] when flags are random
}
```

Solution steps can also be objects: `{ cmd: 'ssh bandit0@host -p 2220', answers: ['yes', 'bandit0'] }` (answers to prompts in order: ssh fingerprint, passwords, sudo), `{ cmd: 'nano f.txt', edit: (old) => 'new content\n' }` (what nano saves), `{ cron: true }` (advance cron one tick instead of running a command).

## setup(w)

- `w.m` is the local machine "quest" (Kali-like, user `recruit`, password `quest`, home `/home/recruit`).
- Files: `w.m.file(path, content, { owner, group, mode, mtime, fakeSize })`. New parent folders get the same owner. Content is a byte string (chars 0–255).
- Folders: `w.m.dir(path, { owner, group, mode })` (also re-owns an existing folder). Links: `w.m.link(path, target)`. Remove: `w.m.remove(path)`.
- Users/groups: `w.m.addGroup(name, gid)`, `w.m.addUser(name, { uid, password, groups: ['g'], shell, home })`. `w.m.user(name).authorizedKeys.push(keyId)`.
- sudo rules: `w.m.sudoers.push({ who: 'recruit' | '%group', runas: 'root' | 'ALL', cmds: ['/usr/bin/find'] | ['ALL'], nopasswd: true })`.
- Programs: `w.m.binary(name, { dir, mode, impl })` creates an executable that runs engine command `impl` (e.g. a setuid copy of find: `{ dir: '/usr/local/bin', mode: 0o4755, impl: 'find' }`). Or change modes: `w.m.fs.tryGet('/usr/bin/find').mode = 0o4755`. Scripts are just files with `#!/bin/bash` and mode 0o755.
- Processes: `w.m.spawn({ user, cmd, cpu, mem, stat, ppid, onTerm: 'ignore', respawnBy: parentPid })`. `onTerm: 'ignore'` survives SIGTERM (needs -9). `respawnBy` restarts the process while that parent is alive.
- Remote machines for ssh: `const r = w.remote({ hostname, ip, sshPort, banner, motd })` then `r.addUser(...)`, `r.file(...)`.
- Cron: put lines in `/etc/cron.d/<name>` (`* * * * * user command`) or `w.m.crontabs.set(user, text)`.
- Flags: `w.flag(len)` makes a random token and registers it as a valid flag (or push to `w.state.flags`). `w.token(len)` makes a random token that is NOT a flag (decoys). `w.rand()`, `w.pick(arr)`, `w.shuffle(arr)`, `w.daysAgo(n)` (a timestamp for mtimes).
- Archives: import `{ gzipData, bzipData, tarPack }` from `../../engine/commands/archive.js`. Keys: `{ makeKeyPair }` from `../../engine/commands/net.js` gives `{ priv, pub }` for an id.

Flags must be random per run (so answers cannot be copied) and every level must stay solvable for any seed.

## Objective checks: the `q` API

- `q.ran(name | [names], opts)` → the player ran that command successfully. opts: `flags: 'la'` (all these short flags; with `long: { a: '--all' }` alternatives), `noFlags`, `arg: path-or-word` (positional arg; paths compare after resolving relative to where it ran), `argMatch: /re/`, `argv: (argv) => bool`, `piped`, `pipedInto`, `redirect: '>' | '>>' | '2>'`, `user`, `host`, `via: 'sudo'`, `output: str|re`, `anyStatus: true` (count failures too), `any: true` (include commands run inside scripts).
- `q.any((c) => ...)` → any command record. c has `name, argv, line (raw typed line), cwd, user, host, status, piped, stage, stages, redirs, via, out`.
- `q.line(re)` typed line matches · `q.output(str|re)` any output · `q.pipeline('sort', 'uniq')` one pipeline used all of these.
- Places: `q.cwd()`, `q.cwdIs(p)`, `q.visited(p)`, `q.user()`, `q.euid()`, `q.host()`.
- Files (optionally on another host): `q.exists(p)`, `q.isDir`, `q.isFile`, `q.isLink`, `q.read(p)`, `q.node(p)`, `q.mode(p)` (number, e.g. 0o600), `q.owner(p)`, `q.group(p)`, `q.list(dir)`.
- State: `q.submitted()` (any flag accepted), `q.got(i)` (flag number i accepted), `q.env(name)`, `q.alias(name)`, `q.proc(test | substring)`, `q.jobs()`, `q.history()`, `q.crontab(user)`.

Some commands report "failure" on purpose: `diff` exits 1 when files differ, `grep` exits 1 when nothing matches, and `find /` exits 1 after any "Permission denied" (even with `2>/dev/null`). `q.ran` ignores failed runs unless you pass `anyStatus: true`, so use it for those.

Objectives latch once true. An objective must NOT be true before the player acts (the checker fails the level if it is). Glob patterns are expanded before commands run, so to require a pattern check `c.line` (the raw text), not `c.argv`.

## What the engine supports

Bash: quotes, escapes, `$VAR ${VAR:-x} ${#VAR} $(cmd) $((math))`, globs `* ? [..]`, braces `{a,b} {1..5}`, pipes, `> >> < 2> 2>&1 &> <<<`, `&& || ; &`, `( )`, `{ ;}`, `if/elif/else`, `for`, `while/until`, `break/continue`, `[ ]`/`test`, `read`, functions NOT supported, `case` NOT supported, heredoc `<<` NOT supported.
Commands: run `ls src/engine/commands/` and see `src/content/codex.js` for the list (≈100). Interactive: `less/more/man` (pager), `nano` (editor), `top` (live), `sudo/su/ssh/ssh-keygen` prompts, `sleep` (Ctrl+C / Ctrl+Z), `jobs/fg/bg/kill %1`.

If a level needs something the engine lacks, do not edit the engine: design around it, or report exactly what is missing.

## Voice and teaching rules

- Teach before testing: every command an objective needs is shown on a card first, with a Try-it.
- Use real GNU behaviour and real error messages; mention the OverTheWire Bandit level a skill maps to.
- Add a **Hacker's note** where a skill matters for offense or defense.
- Plain, direct sentences. No filler. The player is a beginner who wants to become a hacker.
