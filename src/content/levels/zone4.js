// Zone 4: Pipe Works. Streams, pipes and the small tools that chain into machines.
const H = '/home/recruit';
const o = { owner: 'recruit' };

const rows = (t) => String(t || '').split('\n').filter((l) => l !== '');
const rot13 = (s) => s.replace(/[A-Za-z]/g, (ch) => {
  const base = ch <= 'Z' ? 65 : 97;
  return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
});
// The typed line printed exactly these lines (in order, or in any order with anyOrder).
const printed = (c, want, anyOrder = false) => {
  const got = rows(c.out).map((l) => l.trim());
  const exp = want.map((l) => String(l).trim());
  if (got.length !== exp.length) return false;
  if (anyOrder) return [...got].sort().join('\n') === [...exp].sort().join('\n');
  return got.every((l, i) => l === exp[i]);
};
const redirTo = (c, op, re, fd = 1) => c.redirs.some((r) => r.op === op && (r.fd ?? 1) === fd && re.test(r.target));
// One typed pipeline contained stages matching these tests, in this order (not necessarily next to each other).
const pipeSeq = (q, ...tests) => q.records().some((r) => r.pipelines.some((p) => {
  let i = 0;
  for (const st of p) {
    if (i < tests.length && (typeof tests[i] === 'function' ? tests[i](st.cmd) : tests[i].test(st.cmd))) i++;
  }
  return i === tests.length;
}));

// ---------- helpers for the boss: a believable sshd auth.log ----------
function buildAuthLog(w) {
  const r = () => w.rand();
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const used = new Set();
  const pubIp = () => {
    for (;;) {
      const ip = `${pick([45, 61, 91, 103, 112, 139, 159, 185, 193, 203, 218])}.${int(10, 250)}.${int(10, 250)}.${int(2, 250)}`;
      if (!used.has(ip)) { used.add(ip); return ip; }
    }
  };
  const invalidPool = ['admin', 'oracle', 'ubuntu', 'postgres', 'guest', 'test', 'user', 'pi', 'git', 'ftp', 'mysql', 'nagios', 'jenkins'];
  const ipA = pubIp();
  const d1 = pubIp();
  const d2 = pubIp();
  const top = pick(invalidPool);
  const S = pick(['deploy', 'backup', 'svc-web', 'webmaster']);
  const tok = w.token(12);
  const valid = new Set(['root', 'alice', 'bob', S]);
  const events = [];
  const add = (t, tag, msgs, pid) => events.push({ t, tag, msgs, pid });
  const fail = (t, ip, user) => {
    const port = int(30000, 65000);
    const msgs = [];
    if (valid.has(user)) {
      if (r() < 0.6) msgs.push(`pam_unix(sshd:auth): authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost=${ip}  user=${user}`);
      msgs.push(`Failed password for ${user} from ${ip} port ${port} ssh2`);
      if (r() < 0.3) msgs.push(`Connection closed by authenticating user ${user} ${ip} port ${port} [preauth]`);
    } else {
      msgs.push(`Invalid user ${user} from ${ip} port ${port}`);
      msgs.push(`Failed password for invalid user ${user} from ${ip} port ${port} ssh2`);
      if (r() < 0.3) msgs.push(`Connection closed by invalid user ${user} ${ip} port ${port} [preauth]`);
    }
    add(t, 'sshd', msgs);
  };
  const hms = (s) => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
  const at = (h, m) => h * 3600 + m * 60;

  // The attacker: a lot of root, even more "invalid user" names, then a login as S.
  const topN = int(48, 56);
  const rootN = topN - int(8, 12);
  const others = w.shuffle(invalidPool.filter((n) => n !== top)).slice(0, 4);
  const attackerUsers = [];
  for (let i = 0; i < topN; i++) attackerUsers.push(top);
  for (let i = 0; i < rootN; i++) attackerUsers.push('root');
  for (const n of others) for (let i = 0, k = int(6, 16); i < k; i++) attackerUsers.push(n);
  const fa = attackerUsers.length + 3;
  for (const u of attackerUsers) fail(int(at(2, 5), at(3, 40)), ipA, u);
  const tIn = at(3, 42) + int(0, 50);
  fail(tIn - 31, ipA, S);
  fail(tIn - 17, ipA, S);
  fail(tIn - 6, ipA, S);
  const port = int(30000, 65000);
  add(tIn, 'sshd', [`Accepted password for ${S} from ${ipA} port ${port} ssh2`, `pam_unix(sshd:session): session opened for user ${S}(uid=1002) by (uid=0)`]);
  add(tIn, 'systemd-logind', [`New session 41 of user ${S}.`], 612);
  add(tIn + 20, 'sudo', [`  ${S} : TTY=pts/1 ; PWD=/home/${S} ; USER=root ; COMMAND=/usr/bin/id`], 0);
  add(tIn + 47, 'sudo', [`  ${S} : TTY=pts/1 ; PWD=/home/${S} ; USER=root ; COMMAND=/usr/bin/curl -s http://${ipA}/${tok}`], 0);
  add(tIn + 300, 'sshd', [`Received disconnect from ${ipA} port ${port}:11: disconnected by user`, `pam_unix(sshd:session): session closed for user ${S}`]);

  // Decoys with nearly the same number of failures. They mostly try root.
  const decoy = (ip, n, rootShare, t0, t1) => {
    for (let i = 0; i < n; i++) fail(int(t0, t1), ip, r() < rootShare ? 'root' : pick(invalidPool));
  };
  decoy(d1, fa - int(4, 9), 0.7, at(0, 40), at(4, 30));
  decoy(d2, fa - int(12, 22), 0.6, at(0, 20), at(5, 10));
  // Small scanners.
  for (let k = 0; k < 12; k++) {
    const ip = pubIp();
    const n = int(1, 5);
    const t = int(at(0, 5), at(5, 50));
    for (let i = 0; i < n; i++) fail(t + i * int(2, 9), ip, r() < 0.4 ? 'root' : pick(invalidPool));
  }

  // Legitimate traffic from the office network: the busiest IP overall, but almost no failures.
  const login = (t, user, ip, len) => {
    const p = int(30000, 65000);
    add(t, 'sshd', [`Accepted password for ${user} from ${ip} port ${p} ssh2`, `pam_unix(sshd:session): session opened for user ${user}(uid=${user === 'alice' ? 1001 : 1003}) by (uid=0)`]);
    add(t + len, 'sshd', [`Received disconnect from ${ip} port ${p}:11: disconnected by user`, `pam_unix(sshd:session): session closed for user ${user}`]);
  };
  for (let i = 0; i < 18; i++) login(int(at(0, 5), at(5, 0)), 'alice', '10.0.0.23', int(60, 900));
  for (let i = 0; i < 8; i++) login(int(at(0, 30), at(5, 0)), 'bob', '10.0.0.31', int(60, 600));
  login(at(5, 12), 'alice', '10.0.0.23', 400);
  login(at(5, 41), 'bob', '10.0.0.31', 300);
  // A monitoring host logs in every two minutes all night: by far the busiest IP in the whole file.
  for (let m = 0; m < 360; m += 2) {
    const t = at(0, 0) + m * 60 + int(0, 30);
    const p = int(30000, 65000);
    add(t, 'sshd', [`Accepted publickey for monitor from 10.0.0.9 port ${p} ssh2: ED25519 SHA256:${w.token(43)}`, 'pam_unix(sshd:session): session opened for user monitor(uid=1004) by (uid=0)']);
    add(t + 2, 'sshd', [`Received disconnect from 10.0.0.9 port ${p}:11: disconnected by user`, `Disconnected from user monitor 10.0.0.9 port ${p}`, 'pam_unix(sshd:session): session closed for user monitor']);
  }
  for (let i = 0; i < 4; i++) fail(int(at(1, 0), at(4, 0)), '10.0.0.23', 'alice');
  for (let i = 0; i < 6; i++) add(int(at(0, 30), at(5, 0)), 'sshd', [`Failed publickey for bob from 10.0.0.31 port ${int(30000, 65000)} ssh2: RSA SHA256:${w.token(43)}`]);
  for (let i = 0; i < 5; i++) add(int(at(0, 10), at(5, 50)), 'sudo', ['  alice : TTY=pts/0 ; PWD=/home/alice ; USER=root ; COMMAND=/usr/bin/apt update'], 0);
  add(at(2, 30), 'sudo', ['  alice : TTY=pts/0 ; PWD=/home/alice ; USER=root ; COMMAND=/usr/bin/curl -s http://localhost/health'], 0);
  for (let m = 0; m < 360; m += 30) {
    add(at(0, 0) + m * 60 + 1, 'CRON', ['pam_unix(cron:session): session opened for user root(uid=0) by (uid=0)']);
    add(at(0, 0) + m * 60 + 2, 'CRON', ['pam_unix(cron:session): session closed for user root']);
  }

  events.sort((a, b) => a.t - b.t);
  let pid = 1500;
  let text = '';
  for (const e of events) {
    pid += int(1, 9);
    for (const m of e.msgs) {
      const who = e.tag === 'sudo' ? 'sudo:' : `${e.tag}[${e.pid ?? pid}]:`;
      text += `Oct 31 ${hms(e.t)} quest ${who} ${m}\n`;
    }
  }
  const lines = rows(text);
  const failed = lines.filter((l) => l.includes('Failed password')).length;
  return { text, failed, ipA, top, S, tok, fa };
}

export default [
  // ------------------------------------------------------------------ 1
  {
    id: 'z4-1',
    title: 'Streams',
    xp: 60,
    panel: 'pipes',
    story: 'You step into the Pipe Works: a roaring hall of brass pipes, valves and gauges. Old Root taps a pipe with his cable-staff. "Everything in Linux flows," he says. "Every program takes data in and pushes data out. Learn where the water goes and you can steer it anywhere."',
    start: { cwd: `${H}/pumproom` },
    setup(w) {
      w.m.file(`${H}/pumproom/valves.txt`, 'valve-1 open\nvalve-2 closed\nvalve-3 open\nvalve-4 closed\n', o);
      w.m.file('/etc/pump.conf', 'pressure=high\nmode=auto\n');
      w.m.file('/etc/valves.conf', 'count=4\n');
      w.m.file('/usr/share/pipeworks/flow.conf', 'rate=12\n');
    },
    teach: [
      {
        title: 'Every program has three streams',
        body: `Every program is born with three data channels, called **streams**:\n\n- **stdin** (number 0): where it reads input. Normally your keyboard.\n- **stdout** (number 1): where it writes normal results. Normally your screen.\n- **stderr** (number 2): where it writes error messages. Also your screen, by default.\n\nStdout and stderr look the same on screen, but they are two separate roads. That difference explains most of this zone.`,
        try: 'ls valves.txt nowhere',
        visual: 'pipes',
        after: 'You just saw both streams at once: `valves.txt` came down stdout, and the complaint about `nowhere` came down stderr.',
        quiz: {
          q: 'Which stream carries error messages?',
          options: ['stdin (0)', 'stdout (1)', 'stderr (2)'],
          answer: 2,
          explain: 'stderr is stream number 2. It is a separate road from normal output, even though both end up on your screen.',
          why: { 0: 'stdin is for input going INTO a program.', 1: 'stdout carries normal results. Errors have their own stream.' },
        },
      },
      {
        title: 'Arrows: >, >> and <',
        body: `Arrows move streams to and from files:\n\n- \`cmd > file\` sends stdout into a file, **replacing** what was there\n- \`cmd >> file\` **adds** stdout to the end of the file\n- \`cmd < file\` feeds the file into stdin\n\nWatch the Pipes panel after each command.\n\nNotice the difference between \`wc -l demo.txt\` and \`wc -l < demo.txt\`: with \`<\`, wc only sees a stream of text, so it cannot print the file name.`,
        try: ['echo hello > demo.txt', 'echo again >> demo.txt', 'wc -l < demo.txt', 'wc -l demo.txt'],
        after: `**Hacker's note:** \`> /var/log/auth.log\` empties a log file in one keystroke. It is a classic way to cover tracks, and the reason defenders copy logs to another machine.`,
        quiz: {
          q: 'A new, empty log.txt. You run echo ping >> log.txt three times. How many lines does it hold?',
          options: ['1', '3', '0'],
          answer: 1,
          explain: '>> adds a line each time, so three runs give three lines. With a single > you would end with just one.',
          why: { 0: 'That is what > would give you, because it replaces the file every time.', 2: 'The file is not emptied. >> only ever adds.' },
        },
      },
      {
        title: 'printf: write exactly what you mean',
        body: `\`echo\` always adds one newline. \`printf\` adds nothing you did not ask for, and \`\\n\` means a new line. So one printf can write many lines:\n\n\`\`\`\nprintf 'red\\ngreen\\nblue\\n' > colors.txt\n\`\`\`\n\nPut the final \`\\n\` yourself, or the last line will have no line ending. Quote the format with single quotes so the shell leaves the backslashes alone.`,
        try: ["printf 'red\\ngreen\\nblue\\n' > colors.txt", 'cat colors.txt'],
      },
      {
        title: 'Errors travel on their own road',
        body: `Redirecting stdout does not touch stderr. This still shows the error on screen:\n\n\`\`\`\nls valves.txt nowhere > out.txt\n\`\`\`\n\n\`valves.txt\` went into out.txt, but the error went down the other road. To catch errors, use their number:\n\n- \`2> file\` sends **stderr** to a file\n- \`2>&1\` means "send stderr to wherever stdout is going"\n- \`&> file\` sends both to one file\n\nOrder matters: write \`> file 2>&1\`, not \`2>&1 > file\`.`,
        try: ['ls valves.txt nowhere > out.txt', 'ls nowhere 2> err.txt', 'ls valves.txt nowhere > mix.txt 2>&1', 'cat mix.txt'],
        quiz: {
          q: 'You run: ls valves.txt nowhere > out.txt  What appears on screen?',
          options: ['Nothing at all', 'Only the error message', 'The file listing and the error message'],
          answer: 1,
          explain: 'The listing went into out.txt. The error travels on stderr, which > does not catch, so it still prints.',
          why: { 0: 'The error is not redirected, so it does print.', 2: 'The listing (stdout) was redirected into the file. Only the error remains on screen.' },
        },
      },
      {
        title: '/dev/null: the black hole',
        body: `\`/dev/null\` is a special file that swallows everything written to it. Perfect for silencing noise:\n\n\`\`\`\nfind / -name "*.conf" 2>/dev/null\n\`\`\`\n\nWithout \`2>/dev/null\`, find fills your screen with "Permission denied" for every folder you may not enter. With it, you see only real results. Compare the two.`,
        try: ['find / -name "*.conf"', 'find / -name "*.conf" 2>/dev/null'],
        after: `**Hacker's note:** \`find / ... 2>/dev/null\` is in nearly every CTF and every privilege-escalation checklist. OverTheWire Bandit level 6 is exactly this. But do not hide errors blindly: when a command fails mysteriously, drop the redirect and read the message.`,
        quiz: {
          q: 'What does  find / -name "*.conf" 2>/dev/null  do?',
          options: ['Deletes /dev/null', 'Throws away the error messages, keeps the results', 'Throws away the results, keeps the errors'],
          answer: 1,
          explain: '2> redirects stderr, and /dev/null swallows it. The normal results (stdout) still print.',
          why: { 0: '/dev/null is only the destination. Nothing is deleted.', 2: 'It is the other way round: 2> only touches the error stream.' },
        },
      },
    ],
    brief: 'The pump room needs a status board. Fill it in with redirection.',
    objectives: [
      {
        text: 'Write the word online into pump-status.txt with echo and >',
        check: (q) => q.any((c) => ['echo', 'printf'].includes(c.name) && redirTo(c, '>', /pump-status\.txt$/)) && /online/.test(q.read(`${H}/pumproom/pump-status.txt`) || ''),
      },
      {
        text: 'Add the line pressure normal to the end of pump-status.txt with >> (keep the first line)',
        check: (q) => {
          const t = rows(q.read(`${H}/pumproom/pump-status.txt`));
          return q.any((c) => ['echo', 'printf'].includes(c.name) && redirTo(c, '>>', /pump-status\.txt$/)) && t.length >= 2 && /online/.test(t[0]) && t.some((l) => l.trim() === 'pressure normal');
        },
      },
      {
        text: 'Use ONE printf command to write the three lines low, mid and high into levels.txt',
        check: (q) => q.any((c) => c.name === 'printf' && redirTo(c, '>', /levels\.txt$/)) && rows(q.read(`${H}/pumproom/levels.txt`)).join(',') === 'low,mid,high',
      },
      {
        text: 'Count the lines of /etc/passwd by feeding the file into wc -l with <',
        check: (q) => q.any((c) => c.name === 'wc' && c.argv.some((a) => /^-\w*l/.test(a)) && c.redirs.some((r) => r.op === '<' && /passwd$/.test(r.target))),
      },
      {
        text: 'Run ls on /nowhere and send only its error message into errors.txt with 2>',
        check: (q) => q.any((c) => c.name === 'ls' && redirTo(c, '>', /errors\.txt$/, 2)) && /No such file/.test(q.read(`${H}/pumproom/errors.txt`) || ''),
      },
      {
        text: 'Run ls on valves.txt and /nowhere so that BOTH the listing and the error land in both.txt',
        check: (q) => {
          const t = q.read(`${H}/pumproom/both.txt`) || '';
          const merged = (c) => c.redirs.some((r) => r.op === '&>') || (c.redirs.some((r) => r.op === '>') && c.redirs.some((r) => r.op === '>&' && r.fd === 2 && r.target === '1'));
          return q.any((c) => c.name === 'ls' && merged(c)) && /valves\.txt/.test(t) && /No such file/.test(t);
        },
      },
      {
        text: 'Search the whole machine for .conf files with find / and hide the permission errors with 2>/dev/null',
        check: (q) => q.any((c) => c.name === 'find' && c.argv.includes('/') && redirTo(c, '>', /^\/dev\/null$/, 2) && /\.conf/.test(c.out) && !/Permission denied/.test(c.out)),
      },
    ],
    hints: [
      '> replaces a file, >> appends, < feeds a file in, and 2> catches errors. printf can write several lines at once with \\n.',
      'Start with `echo online > pump-status.txt`, then `echo "pressure normal" >> pump-status.txt`. For errors: `ls /nowhere 2> errors.txt`.',
      'Both streams: `ls valves.txt /nowhere > both.txt 2>&1`. Quiet search: `find / -name "*.conf" 2>/dev/null`. Three lines: `printf "low\\nmid\\nhigh\\n" > levels.txt`.',
    ],
    codex: ['printf'],
    realWorld: { text: 'On Kali, run `ls /etc /nowhere > out.txt` and watch the error still appear. Then `ls /etc /nowhere > out.txt 2> err.txt` and `cat` both files. Finish with `find / -name "*.conf" 2>/dev/null | head`.', bandit: [7] },
    journal: 'Why does an error message still show on screen when you run a command with > file?',
    solution: [
      'echo online > pump-status.txt',
      'echo "pressure normal" >> pump-status.txt',
      "printf 'low\\nmid\\nhigh\\n' > levels.txt",
      'wc -l < /etc/passwd',
      'ls /nowhere 2> errors.txt',
      'ls valves.txt /nowhere > both.txt 2>&1',
      'find / -name "*.conf" 2>/dev/null',
    ],
  },

  // ------------------------------------------------------------------ 2
  {
    id: 'z4-2',
    title: 'The First Pipe',
    xp: 60,
    panel: 'pipes',
    story: 'Crates roll past on a conveyor belt, one after another. "One tool, one job," says Old Root. "The pipe is how you hand the result of one job to the next worker."',
    start: { cwd: `${H}/belt` },
    setup(w) {
      const items = ['bolts', 'gaskets', 'valves', 'washers', 'couplings', 'flanges', 'seals', 'pistons', 'nozzles', 'gauges'];
      const states = ['ok', 'ok', 'ok', 'late', 'urgent'];
      const code = w.flag(14);
      let urgent = 0;
      let txt = '';
      for (let i = 1; i <= 40; i++) {
        const n = String(i).padStart(3, '0');
        if (i === 12) { txt += `${n} ACCESS CODE: ${code}\n`; continue; }
        let st = states[Math.floor(w.rand() * states.length)];
        if ([5, 19, 33].includes(i)) st = 'urgent';
        if (st === 'urgent') urgent++;
        txt += `${n} ${items[Math.floor(w.rand() * items.length)]} ${st}\n`;
      }
      w.m.file(`${H}/belt/ledger.txt`, txt, o);
      w.state.flags.push(String(urgent));
    },
    teach: [
      {
        title: 'The pipe: |',
        body: `The pipe symbol \`|\` connects two commands. The **stdout** of the left one becomes the **stdin** of the right one. No temporary file needed.\n\n\`\`\`\nls /etc | head -n 5\n\`\`\`\n\nHere \`ls\` lists /etc. \`head\` receives that list instead of a file and keeps only the first five lines. The Pipes panel shows the data at every stage.`,
        try: 'ls /etc | head -n 5',
        visual: 'pipes',
        quiz: {
          q: 'In  ls /etc | head -n 5  where does head get its input?',
          options: ['From a file called /etc', 'From the output of ls', 'From the keyboard'],
          answer: 1,
          explain: 'The pipe hands the output of the left command to the right command as its input.',
          why: { 0: '/etc is an argument to ls, not to head.', 2: 'With a pipe, head reads the pipe, not the keyboard.' },
        },
      },
      {
        title: 'head and tail inside a pipe',
        body: `Both read a pipe just like a file:\n\n- \`head -n 3\` keeps the first 3 lines\n- \`tail -n 3\` keeps the last 3 lines\n- \`tail -n +3\` keeps everything **from** line 3 on\n\nTo get one exact line, take the first N lines, then the last one of those:\n\n\`\`\`\nhead -n 4 /etc/passwd | tail -n 1\n\`\`\`\n\nThat prints line 4 and nothing else.`,
        try: ['head -n 4 /etc/passwd | tail -n 1', 'ls /etc | tail -n +10'],
        quiz: {
          q: 'Which command prints ONLY line 7 of notes.txt?',
          options: ['head -n 7 notes.txt | tail -n 1', 'tail -n 7 notes.txt | head -n 1', 'head -n 1 notes.txt | tail -n 7'],
          answer: 0,
          explain: 'head -n 7 keeps lines 1 to 7, and tail -n 1 keeps the last of those: line 7.',
          why: { 1: 'tail -n 7 keeps the last seven lines of the file, so head -n 1 gives the 7th line from the END.', 2: 'head -n 1 leaves only line 1, and tail -n 7 of a single line is still line 1.' },
        },
      },
      {
        title: 'wc -l counts lines',
        body: `\`wc\` counts. \`wc -l\` counts lines, \`wc -w\` words, \`wc -c\` bytes.\n\nMany commands print one item per line, so \`wc -l\` at the end of a pipe counts how many things came out:\n\n\`\`\`\nls /usr/bin | wc -l\ngrep root /etc/passwd | wc -l\n\`\`\``,
        try: ['ls /usr/bin | wc -l', 'grep root /etc/passwd | wc -l'],
        quiz: {
          q: 'In a folder, ls | wc -l prints 12. What does 12 mean?',
          options: ['12 bytes of data', '12 visible names (files and folders) in the folder', '12 words in the first file'],
          answer: 1,
          explain: 'ls prints one name per line when piped, and wc -l counts the lines. Hidden files are not shown by ls, so they are not counted.',
          why: { 0: 'Bytes would need wc -c.', 2: 'wc counted the lines that ls printed, not words inside files.' },
        },
      },
      {
        title: 'Pipes carry stdout only',
        body: `Remember the two roads? A pipe only takes **stdout**. Errors skip the pipe and go straight to your screen:\n\n\`\`\`\nls /nowhere | wc -l\n\`\`\`\n\nYou see the error AND a count of 0. To send errors down the pipe as well, merge them into stdout first:\n\n\`\`\`\nls /nowhere 2>&1 | wc -l\n\`\`\``,
        try: ['ls /nowhere | wc -l', 'ls /nowhere 2>&1 | wc -l'],
        quiz: {
          q: 'What does  ls /nowhere | wc -l  show?',
          options: ['Only the number 1', 'The error message on screen, then the number 0', 'Nothing'],
          answer: 1,
          explain: 'The error travels on stderr and never enters the pipe. wc sees an empty stdin and counts 0 lines.',
          why: { 0: 'That would happen with 2>&1, which sends the error line through the pipe.', 2: 'The error still reaches your screen.' },
        },
      },
      {
        title: 'tee: save it and keep going',
        body: `\`tee\` is a T-junction in the pipe. It copies its input into a file **and** passes it on to the next stage.\n\n\`\`\`\nls /etc | tee etc-list.txt | wc -l\n\`\`\`\n\nYou get the count, and \`etc-list.txt\` keeps the full list. \`tee -a\` appends to the file instead of replacing it.`,
        try: ['ls /etc | tee etc-list.txt | wc -l', 'echo "one more" | tee -a etc-list.txt'],
        after: `**Hacker's note:** \`sudo echo hi > /root/file\` fails, because your shell opens the file, not sudo. \`echo hi | sudo tee /root/file\` works, because tee itself runs as root.`,
        quiz: {
          q: 'What does tee do?',
          options: ['Sorts the lines it receives', 'Writes its input to a file and also passes it along', 'Deletes the input after reading it'],
          answer: 1,
          explain: 'tee splits the flow: one copy goes to the file, one copy continues down the pipe.',
          why: { 0: 'Sorting is the job of sort.', 2: 'tee never deletes anything. It copies.' },
        },
      },
    ],
    brief: 'The belt manager keeps a ledger of 40 shipments. Answer his questions with pipes.',
    objectives: [
      { text: 'Count the programs in /usr/bin: pipe ls into wc -l', check: (q) => pipeSeq(q, /^ls\b.*\/usr\/bin/, /^wc\b.*-\w*l/) },
      { text: 'Show only the first 5 names in /etc: pipe ls into head', check: (q) => pipeSeq(q, /^ls\b.*\/etc/, /^head\b.*(-n ?5|-5)( |$)/) },
      { text: 'Print only line 12 of ledger.txt with head and tail in one pipeline, then submit the access code on that line', check: (q) => q.got(0) && pipeSeq(q, /^head\b/, /^tail\b/) },
      { text: 'Count the ledger lines marked urgent with grep and wc -l, then submit that number', check: (q) => q.got(1) && pipeSeq(q, /^grep\b/, /^wc\b/) },
      { text: 'List /usr/bin through tee into bins.txt while wc -l counts it', check: (q) => q.isFile(`${H}/belt/bins.txt`) && pipeSeq(q, /^ls\b.*\/usr\/bin/, /^tee\b.*bins\.txt/, /^wc\b/) },
      {
        text: 'Add the line end of list to the bottom of bins.txt with echo piped into tee -a',
        check: (q) => q.any((c) => c.name === 'tee' && c.piped && c.argv.includes('-a') && c.argv.some((a) => /bins\.txt$/.test(a))) && /end of list/.test(q.read(`${H}/belt/bins.txt`) || ''),
      },
    ],
    hints: [
      'Join commands with |. `wc -l` counts lines, `head` and `tail` cut slices.',
      '`ls /usr/bin | wc -l`. For line 12: `head -n 12 ledger.txt | tail -n 1`. For urgent entries: `grep urgent ledger.txt | wc -l`, then `submit` the number.',
      '`ls /usr/bin | tee bins.txt | wc -l`, then `echo "end of list" | tee -a bins.txt`. Submit the code after ACCESS CODE: and the urgent count.',
    ],
    codex: ['tee'],
    realWorld: { text: 'On Kali: `ls /usr/bin | wc -l` (how many tools do you have?), `head -n 12 /etc/passwd | tail -n 1`, and `ls /etc | tee ~/etc-list.txt | wc -l`.' },
    journal: 'Explain in your own words what a pipe passes from one command to the next, and what it does not pass.',
    solution: (s) => [
      'ls /usr/bin | wc -l',
      'ls /etc | head -n 5',
      'head -n 12 ledger.txt | tail -n 1',
      `submit ${s.flags[0]}`,
      'grep urgent ledger.txt | wc -l',
      `submit ${s.flags[1]}`,
      'ls /usr/bin | tee bins.txt | wc -l',
      'echo "end of list" | tee -a bins.txt',
    ],
  },

  // ------------------------------------------------------------------ 3
  {
    id: 'z4-3',
    title: 'Sort the Loot',
    xp: 70,
    panel: 'pipes',
    story: 'The sorting hall is chaos: crates, coins and scribbled lists everywhere. "A thief who sorts first sees the pattern," says Old Root. "After that, it is only counting."',
    start: { cwd: `${H}/loot` },
    setup(w) {
      const D = `${H}/loot`;
      const names = ['torch', 'rope', 'dagger', 'potion', 'scroll', 'lantern', 'shield', 'arrow', 'coin'];
      const lone = w.flag(20);
      const top = w.pick(names);
      w.state.flags.push(top);
      const inv = [];
      for (const n of names) {
        const k = n === top ? 18 + Math.floor(w.rand() * 7) : 3 + Math.floor(w.rand() * 11);
        for (let i = 0; i < k; i++) inv.push(n);
      }
      w.m.file(`${D}/inventory.txt`, w.shuffle(inv).join('\n') + '\n', o);
      const sc = new Set();
      while (sc.size < 14) sc.add(1 + Math.floor(w.rand() * 950));
      w.m.file(`${D}/scores.txt`, [...sc].join('\n') + '\n', o);
      w.m.file(`${D}/guests.txt`, w.shuffle(['Ada', 'Ada', 'Ada', 'Bram', 'Cora', 'Cora', 'Dax', 'Elin', 'Elin', 'Fitz', 'Gwen', 'Hugo']).join('\n') + '\n', o);
      w.m.file(`${D}/numbers.txt`, '10\n9\n100\n25\n1\n', o);
      const data = [lone];
      for (let d = 0; d < 30; d++) {
        const t = w.token(20);
        for (let i = 0, k = 4 + Math.floor(w.rand() * 6); i < k; i++) data.push(t);
      }
      w.m.file(`${D}/data.txt`, w.shuffle(data).join('\n') + '\n', o);
    },
    teach: [
      {
        title: 'sort puts lines in order',
        body: `\`sort\` reads lines and prints them in order. By default it sorts like a dictionary, **character by character**.\n\n- \`sort -r\` reverses the order\n- \`sort -n\` sorts as **numbers**\n- \`sort -u\` drops duplicate lines\n\nThe file numbers.txt holds 10, 9, 100, 25 and 1. Try plain sort, then -n, then -nr.`,
        try: ['sort numbers.txt', 'sort -n numbers.txt', 'sort -nr numbers.txt'],
        quiz: {
          q: 'Plain sort puts 100 before 25. Why?',
          options: ['It compares character by character, and 1 comes before 2', 'It sorts by file size', 'It is a bug: sort only works on words'],
          answer: 0,
          explain: 'Text order looks at the first character first: "1" is smaller than "2", so 100 comes before 25. Add -n to sort by value.',
          why: { 1: 'sort looks at the content of the lines, not at sizes.', 2: 'sort handles any text. You just have to ask for numeric order with -n.' },
        },
      },
      {
        title: 'Sort by column: -t and -k',
        body: `Lines often have columns. \`-t\` sets the separator and \`-k N\` picks which column to sort by:\n\n\`\`\`\nsort -t: -k3 -n /etc/passwd\n\`\`\`\n\nThis sorts the accounts by their third field, the user ID, as numbers. Without -t, columns are separated by blanks. \`-k2 -nr\` means: column 2, numeric, biggest first.`,
        try: ['sort -t: -k3 -n /etc/passwd', 'sort -t: -k1 -r /etc/passwd'],
        quiz: {
          q: 'Which command sorts a comma-separated file by its 2nd column, as numbers?',
          options: ['sort -t, -k2 -n file', 'sort -d, -f2 file', 'sort -c2 -n file'],
          answer: 0,
          explain: '-t sets the separator, -k picks the column and -n makes it numeric.',
          why: { 1: '-d and -f are options of cut, not of sort.', 2: 'sort has no -c column option. -c would check whether the file is sorted.' },
        },
      },
      {
        title: 'uniq collapses neighbours',
        body: `\`uniq\` removes **neighbouring** duplicate lines. Only neighbours! So sort first, and equal lines become neighbours:\n\n\`\`\`\nsort guests.txt | uniq\n\`\`\`\n\n- \`uniq -c\` puts the count in front of each line\n- \`uniq -d\` shows only lines that repeat\n- \`uniq -u\` shows only lines that never repeat`,
        try: ['uniq guests.txt', 'sort guests.txt | uniq', 'sort guests.txt | uniq -c'],
        quiz: {
          q: 'Why must you sort before uniq?',
          options: ['uniq only compares neighbouring lines', 'uniq crashes on unsorted input', 'sort makes the file smaller'],
          answer: 0,
          explain: 'uniq has no memory of lines it saw earlier. Sorting puts equal lines side by side.',
          why: { 1: 'uniq runs fine on unsorted input, it just misses duplicates that are not neighbours.', 2: 'sort only reorders lines.' },
        },
      },
      {
        title: 'The frequency table',
        body: `Put the pieces together and you can count anything:\n\n\`\`\`\nsort guests.txt | uniq -c | sort -rn | head -n 3\n\`\`\`\n\n1. \`sort\` groups equal lines\n2. \`uniq -c\` counts each group\n3. \`sort -rn\` puts the biggest count first\n4. \`head\` keeps the top few\n\nThis one pattern answers: which IP attacked most? Which user failed most? You will need it for the boss.`,
        try: 'sort guests.txt | uniq -c | sort -rn | head -n 3',
        quiz: {
          q: 'Which order builds a frequency table, most frequent first?',
          options: ['sort | uniq -c | sort -rn', 'uniq -c | sort | sort -rn', 'sort -rn | uniq -c'],
          answer: 0,
          explain: 'First sort so equal lines touch, then count them with uniq -c, then sort the counts as numbers, biggest first.',
          why: { 1: 'uniq -c on unsorted lines counts neighbours only, so the counts are wrong.', 2: 'Sorting numerically first does nothing useful for text lines, and the counts come out wrong.' },
        },
      },
      {
        title: 'The lone line (Bandit 8)',
        body: `OverTheWire Bandit level 8: the password is the **only line in data.txt that occurs exactly once**. Every other line appears several times. Your eyes cannot find it in hundreds of lines, but two commands can:\n\n\`\`\`\nsort data.txt | uniq -u\n\`\`\`\n\n\`uniq -u\` prints only the lines that never repeat. Test the idea on guests.txt first: which guests came only once?`,
        try: 'sort guests.txt | uniq -u',
        after: `**Hacker's note:** in a log with a million normal lines, the line that appears once is often the intruder. Sorting and counting is how analysts hunt for anomalies.`,
        quiz: {
          q: 'data.txt has hundreds of lines. Every line appears several times except one. Which command prints that one?',
          options: ['uniq -u data.txt', 'sort data.txt | uniq -d', 'sort data.txt | uniq -u'],
          answer: 2,
          explain: 'Sort so equal lines touch, then uniq -u prints only the line that has no twin.',
          why: { 0: 'Without sort, no line has an identical neighbour, so uniq -u would print almost everything.', 1: '-d prints the lines that DO repeat, the opposite of what you want.' },
        },
      },
    ],
    brief: 'Sort the hall: inventory, scores and one very repetitive data file.',
    objectives: [
      { text: 'Sort inventory.txt alphabetically with sort', check: (q) => q.ran('sort', { arg: `${H}/loot/inventory.txt`, noFlags: 'nr' }) },
      { text: 'Sort scores.txt from the biggest number to the smallest (-n and -r)', check: (q) => q.ran('sort', { flags: 'nr', arg: `${H}/loot/scores.txt` }) },
      {
        text: 'Sort /etc/passwd by user ID: separator : and column 3, as numbers',
        check: (q) => {
          const want = rows(q.read('/etc/passwd')).sort((a, b) => Number(a.split(':')[2]) - Number(b.split(':')[2]));
          return q.any((c) => c.name === 'sort' && printed(c, want));
        },
      },
      {
        text: 'Build a frequency table of inventory.txt (sort, uniq -c, sort -rn), then submit the item that appears most often',
        check: (q) => q.got(1) && pipeSeq(q, /^sort\b/, /^uniq\b.*-\w*c/, (s) => /^sort\b/.test(s) && /-\w*r/.test(s) && /-\w*n/.test(s)),
      },
      {
        text: 'List the guests who appear more than once in guests.txt (sort, then uniq -d)',
        check: (q) => {
          const seen = {};
          for (const g of rows(q.read(`${H}/loot/guests.txt`))) seen[g] = (seen[g] || 0) + 1;
          const dup = Object.keys(seen).filter((g) => seen[g] > 1);
          return q.any((c) => c.name === 'uniq' && c.argv.some((a) => /^-\w*d/.test(a)) && printed(c, dup, true));
        },
      },
      { text: 'Bandit 8: find the only line in data.txt that occurs exactly once, and submit it', check: (q) => q.got(0) },
    ],
    hints: [
      'sort -n is numeric, -r reverses. uniq only sees neighbours, so sort first.',
      '`sort -t: -k3 -n /etc/passwd`. Frequency table: `sort inventory.txt | uniq -c | sort -rn`. Duplicates: `sort guests.txt | uniq -d`.',
      '`sort data.txt | uniq -u` prints the one line that occurs once. Submit it, and submit the top item from the frequency table.',
    ],
    codex: ['sort', 'uniq'],
    realWorld: { text: 'On Kali: `sort -t: -k3 -n /etc/passwd`, then `ls /usr/bin | sort -r | head`. For Bandit 8, test the trick yourself: `printf "a\\nb\\na\\nc\\nb\\n" | sort | uniq -u` prints only c.', bandit: [9] },
    journal: 'Why does sort | uniq -c | sort -rn work as a counting machine? Walk through what each stage does.',
    solution: (s) => [
      'sort inventory.txt',
      'sort -nr scores.txt',
      'sort -t: -k3 -n /etc/passwd',
      'sort inventory.txt | uniq -c | sort -rn',
      `submit ${s.flags[1]}`,
      'sort guests.txt | uniq -d',
      'sort data.txt | uniq -u',
      `submit ${s.flags[0]}`,
    ],
  },

  // ------------------------------------------------------------------ 4
  {
    id: 'z4-4',
    title: 'Slice and Swap',
    xp: 70,
    panel: 'pipes',
    story: 'The workshop bench is covered in raw material: columns of data, scrambled letters, odd scrolls. "A good tool does one small thing perfectly," says Old Root. "Then you chain them."',
    start: { cwd: `${H}/workshop` },
    setup(w) {
      const D = `${H}/workshop`;
      w.m.file(`${D}/crew.csv`, 'name,role,city,badge\nMira,welder,Lyon,B-104\nTobi,welder,Oslo,B-221\nInes,fitter,Lyon,B-087\nKasper,pilot,Oslo,B-310\nDana,fitter,Porto,B-145\nYuri,welder,Porto,B-063\nLena,pilot,Lyon,B-272\nOmar,fitter,Oslo,B-198\n', o);
      w.m.file(`${D}/message.txt`, 'all quiet at the works\n', o);
      const two = () => String(10 + Math.floor(w.rand() * 90));
      w.m.file(`${D}/serial.txt`, `${two()}-${two()}-${two()}-${two()}\n`, o);
      w.m.file(`${D}/spaces.txt`, 'too     many      spaces      here\n', o);
      w.m.file(`${D}/mirror.txt`, [...'the pipes run backwards'].reverse().join('') + '\n', o);
      const tok = w.flag(14);
      w.m.file(`${D}/scroll.txt`, `${rot13('Beware. This scroll is ancient and written in a simple cipher.')}\n${rot13('The password for the next gate is ' + tok)}\n`, o);
    },
    teach: [
      {
        title: 'cut slices columns',
        body: `\`cut\` keeps only the columns you ask for.\n\n- \`-d\` sets the **delimiter**, the character between columns\n- \`-f\` picks the **fields** (columns): \`-f1\`, \`-f1,3\`, \`-f2-4\`\n- \`-c\` picks **characters** by position: \`-c1-3\`\n\nThe default delimiter is a Tab, so a file separated by commas or colons needs \`-d\`:\n\n\`\`\`\ncut -d, -f1 crew.csv\ncut -d: -f1,7 /etc/passwd\n\`\`\``,
        try: ['cut -d, -f1 crew.csv', 'cut -d: -f1,7 /etc/passwd', 'cut -c1-3 crew.csv'],
        quiz: {
          q: 'What does the -d, in  cut -d, -f2  tell cut?',
          options: ['Delete all commas', 'Columns are separated by commas', 'Display only the first column'],
          answer: 1,
          explain: '-d names the delimiter, the character that separates the columns. Here it is a comma.',
          why: { 0: 'cut never edits text. It only selects parts.', 2: 'The column is chosen by -f, not by -d.' },
        },
      },
      {
        title: 'tr swaps characters',
        body: `\`tr SET1 SET2\` replaces each character from SET1 with the matching one from SET2. Ranges such as \`a-z\` work.\n\n\`\`\`\necho hello | tr a-z A-Z\n\`\`\`\n\nprints HELLO.\n\n**Important:** tr has no file argument. It only reads **stdin**. Feed it with a pipe or with \`<\`:\n\n\`\`\`\ncat message.txt | tr a-z A-Z\ntr a-z A-Z < message.txt\n\`\`\``,
        try: 'echo hello | tr a-z A-Z',
        quiz: {
          q: 'How do you run tr on the file notes.txt?',
          options: ['tr a-z A-Z notes.txt', 'tr a-z A-Z < notes.txt', 'tr notes.txt a-z A-Z'],
          answer: 1,
          explain: 'tr never takes a file name. It only reads stdin, so feed the file in with < or a pipe.',
          why: { 0: 'A file name is not allowed there. tr only reads stdin.', 2: 'The two character sets always come first.' },
        },
      },
      {
        title: 'tr -d and tr -s',
        body: `Two more tricks:\n\n- \`tr -d SET\` **deletes** every character in SET\n- \`tr -s SET\` **squeezes** a run of the same character into one\n\n\`\`\`\necho "a-b-c" | tr -d '-'\necho "so    many   gaps" | tr -s ' '\n\`\`\`\n\nThe first prints abc. The second prints "so many gaps".`,
        try: ['echo "a-b-c" | tr -d "-"', 'echo "so    many   gaps" | tr -s " "', 'echo "linux quest" | tr -d "aeiou"'],
        quiz: {
          q: 'What does  echo sooon | tr -s o  print?',
          options: ['sn', 'son', 'sooon'],
          answer: 1,
          explain: '-s squeezes the run ooo into a single o, so sooon becomes son.',
          why: { 0: 'That is what -d would do: delete every o.', 2: 'The squeeze changes it: repeated o characters become one.' },
        },
      },
      {
        title: 'ROT13 (Bandit 11)',
        body: `ROT13 shifts every letter 13 places: A becomes N, B becomes O, and so on. The alphabet has 26 letters, so shifting twice returns the original. It is a disguise, not encryption.\n\nWith tr, build the mapping from two ranges:\n\n\`\`\`\ntr 'A-Za-z' 'N-ZA-Mn-za-m'\n\`\`\`\n\nA-M becomes N-Z, N-Z becomes A-M, same for lower case. Numbers and punctuation stay as they are.`,
        try: `echo 'Uryyb, Jbeyq' | tr 'A-Za-z' 'N-ZA-Mn-za-m'`,
        after: `**Hacker's note:** shift ciphers are the "hello world" of CTF crypto. If a text has normal word lengths but nonsense words, try ROT13 first. Bandit level 11 is exactly this.`,
        quiz: {
          q: 'You decode a ROT13 text, then run the same tr command on the result. What do you get?',
          options: ['Garbage', 'The original coded text again', 'An error'],
          answer: 1,
          explain: 'ROT13 is its own inverse: 13 + 13 = 26 places, a full lap around the alphabet.',
          why: { 0: 'It is perfectly reversible, so you get the text you started with.', 2: 'tr has no problem running twice.' },
        },
      },
      {
        title: 'rev mirrors each line',
        body: `\`rev\` reverses every line, character by character:\n\n\`\`\`\necho stressed | rev\n\`\`\`\n\nprints desserts. A neat trick for the **last** column when you do not know how many columns there are: flip the line, cut the first column, flip back.\n\n\`\`\`\necho /usr/share/doc/readme.txt | rev | cut -d/ -f1 | rev\n\`\`\``,
        try: ['echo stressed | rev', 'echo /usr/share/doc/readme.txt | rev | cut -d/ -f1 | rev'],
        quiz: {
          q: 'Why does  rev | cut -d/ -f1 | rev  give the last part of a path?',
          options: ['rev puts the last part first so cut can grab it, then rev restores it', 'cut counts fields from the end', 'rev sorts the parts of the path'],
          answer: 0,
          explain: 'After the first rev, the last part of the path is the first field. cut takes it, and the second rev un-mirrors it.',
          why: { 1: 'cut always counts from the left. That is why we flip the line.', 2: 'rev never sorts. It only mirrors the characters.' },
        },
      },
    ],
    brief: 'The bench holds eight jobs. Pick the right tool for each.',
    objectives: [
      {
        text: 'Print the home folder column (field 6) of every account in /etc/passwd with cut',
        check: (q) => {
          const want = rows(q.read('/etc/passwd')).map((l) => l.split(':')[5]);
          return q.any((c) => c.name === 'cut' && printed(c, want));
        },
      },
      {
        text: 'Print only the role and city columns of crew.csv (fields 2 and 3)',
        check: (q) => {
          const want = rows(q.read(`${H}/workshop/crew.csv`)).map((l) => l.split(',').slice(1, 3).join(','));
          return q.any((c) => c.name === 'cut' && printed(c, want));
        },
      },
      { text: 'Count the crew by role: cut the role column of crew.csv, then sort and uniq -c', check: (q) => pipeSeq(q, /^cut\b.*crew\.csv/, /^sort\b/, /^uniq\b.*-\w*c/) },
      { text: 'Turn message.txt into capital letters with tr', check: (q) => q.any((c) => c.name === 'tr' && /ALL QUIET AT THE WORKS/.test(c.out)) },
      {
        text: 'Remove the dashes from serial.txt with tr -d',
        check: (q) => {
          const digits = rows(q.read(`${H}/workshop/serial.txt`)).join('').replace(/-/g, '');
          return digits.length > 0 && q.any((c) => c.name === 'tr' && c.argv.some((a) => /^-\w*d/.test(a)) && c.out.trim() === digits);
        },
      },
      { text: 'Squeeze the repeated spaces in spaces.txt into single spaces with tr -s', check: (q) => q.any((c) => c.name === 'tr' && c.argv.some((a) => /^-\w*s/.test(a)) && c.out.trim() === 'too many spaces here') },
      { text: 'Bandit 11: decode scroll.txt with ROT13 using tr, and submit the password', check: (q) => q.got(0) && q.ran('tr') },
      { text: 'Reverse the line in mirror.txt with rev', check: (q) => q.any((c) => c.name === 'rev' && /the pipes run backwards/.test(c.out)) },
    ],
    hints: [
      'cut picks columns (-d separator, -f fields). tr only reads stdin: use `<` or a pipe. rev mirrors lines.',
      "`cut -d: -f6 /etc/passwd`, `cut -d, -f2,3 crew.csv`, `tr a-z A-Z < message.txt`, `tr -d '-' < serial.txt`, `tr -s ' ' < spaces.txt`, `rev mirror.txt`.",
      "ROT13: `cat scroll.txt | tr 'A-Za-z' 'N-ZA-Mn-za-m'`, then submit the password at the end. Roles: `cut -d, -f2 crew.csv | sort | uniq -c`.",
    ],
    codex: ['cut', 'tr', 'rev'],
    realWorld: { text: `On Kali: \`cut -d: -f1,7 /etc/passwd\`, then \`echo 'Uryyb' | tr 'A-Za-z' 'N-ZA-Mn-za-m'\`, and \`echo /usr/bin/nmap | rev | cut -d/ -f1 | rev\`.`, bandit: [12] },
    journal: 'ROT13 hides text from a glance but not from a hacker. What makes it a disguise and not real encryption?',
    solution: (s) => [
      'cut -d: -f6 /etc/passwd',
      'cut -d, -f2,3 crew.csv',
      'cut -d, -f2 crew.csv | sort | uniq -c',
      'tr a-z A-Z < message.txt',
      "tr -d '-' < serial.txt",
      "tr -s ' ' < spaces.txt",
      "cat scroll.txt | tr 'A-Za-z' 'N-ZA-Mn-za-m'",
      `submit ${s.flags[0]}`,
      'rev mirror.txt',
    ],
  },

  // ------------------------------------------------------------------ 5
  {
    id: 'z4-5',
    title: 'Awk and Sed Scrolls',
    xp: 80,
    panel: 'pipes',
    story: 'In the archive hang long scrolls of numbers and names. "cut and tr handle simple jobs," says Old Root. "When you need arithmetic or a rewrite on the fly, call the two old wizards: awk and sed."',
    start: { cwd: `${H}/scrolls` },
    setup(w) {
      const D = `${H}/scrolls`;
      const names = ['Mira', 'Tobi', 'Ines', 'Kasper', 'Dana', 'Yuri', 'Lena', 'Omar'];
      const depts = ['forge', 'pipes', 'vault', 'mess'];
      let txt = '';
      let total = 0;
      for (let i = 0; i < 45; i++) {
        const hrs = 4 + Math.floor(w.rand() * 9);
        total += hrs;
        txt += `${w.pick(names)} ${w.pick(depts)} ${hrs} ${15 + Math.floor(w.rand() * 46)}\n`;
      }
      w.m.file(`${D}/payroll.txt`, txt, o);
      w.state.flags.push(String(total));
      w.m.file(`${D}/manifest.txt`, 'cargo: 12 crates of bolts\ncargo: 4 barrels of oil\nhold: empty\ncargo: 7 sacks of grain\n', o);
      w.m.file(`${D}/notes.txt`, 'status: draft\nowner: Mira\nversion: draft 3\n', o);
      w.m.file(`${D}/practice.txt`, 'hold: empty\nhold: full\n', o);
    },
    teach: [
      {
        title: 'awk: columns by number',
        body: `\`awk\` reads text line by line and splits each line into **fields** on whitespace: \`$1\` is the first field, \`$2\` the second, \`$0\` the whole line. \`NF\` is the number of fields, so \`$NF\` is the last field and \`$(NF-1)\` the one before it.\n\nA payroll line looks like \`Mira forge 8 42\`: name, department, hours, hourly rate.\n\n\`\`\`\nawk '{print $1}' payroll.txt\nawk '{print $1, $NF}' payroll.txt\n\`\`\`\n\nThe program goes in single quotes. The \`{ ... }\` is the action awk runs on every line.`,
        try: ['head -n 3 payroll.txt', "echo alpha beta gamma | awk '{print $NF, $1}'", "head -n 4 payroll.txt | awk '{print $2}'"],
        quiz: {
          q: "What does  echo alpha beta gamma | awk '{print $2}'  print?",
          options: ['alpha', 'beta', 'gamma'],
          answer: 1,
          explain: '$2 is the second whitespace-separated field: beta.',
          why: { 0: 'alpha is $1. awk counts fields from 1.', 2: 'gamma is $3, or $NF.' },
        },
      },
      {
        title: 'awk: separators and conditions',
        body: `\`-F\` sets the field separator, like cut's -d:\n\n\`\`\`\nawk -F: '{print $1, $7}' /etc/passwd\n\`\`\`\n\nPut a **condition** before the action and awk only acts on lines where it is true:\n\n\`\`\`\nawk -F: '$3 >= 1000 {print $1}' /etc/passwd\nawk '$2 == "forge"' payroll.txt\nawk '/pipes/' payroll.txt\n\`\`\`\n\nA condition with no action prints the whole line. \`/text/\` matches lines containing text.`,
        try: ["awk -F: '{print $1, $7}' /etc/passwd", `awk '$2 == "pipes"' payroll.txt | head -n 3`],
        quiz: {
          q: "What does  awk -F: '$3 >= 1000 {print $1}' /etc/passwd  print?",
          options: ['Every line of the file', 'The names of accounts whose user ID is 1000 or more', 'The third field of an account called 1000'],
          answer: 1,
          explain: 'The separator is a colon, field 3 is the user ID, and the action prints field 1: the user name.',
          why: { 0: 'The condition filters the lines first.', 2: 'The condition tests the third field. The action prints the first.' },
        },
      },
      {
        title: 'awk: NR, END and arithmetic',
        body: `\`NR\` is the number of the current line. \`END { ... }\` runs once, **after** the last line. Variables keep running totals:\n\n\`\`\`\nawk 'NR == 3' payroll.txt\nawk '{s += $3} END {print s}' payroll.txt\nawk 'END {print NR}' payroll.txt\n\`\`\`\n\nThe first prints only line 3, the second adds up column 3, the third counts the lines. awk can even count by group with an array:\n\n\`\`\`\nawk '{n[$2]++} END {for (k in n) print k, n[k]}' payroll.txt\n\`\`\``,
        try: ["awk 'NR == 3' payroll.txt", "head -n 5 payroll.txt | awk '{s += $3} END {print s}'", "awk '{n[$2]++} END {for (k in n) print k, n[k]}' payroll.txt"],
        quiz: {
          q: 'When does the END block run?',
          options: ['Before the first line', 'After the last line has been read', 'On every line'],
          answer: 1,
          explain: 'END runs once, when the input is finished. That is why it is the place to print totals.',
          why: { 0: 'That is BEGIN.', 2: 'The plain { } action runs on every line. END runs once, at the end.' },
        },
      },
      {
        title: 'sed: find and replace',
        body: `\`sed\` edits a **stream** of text. Its classic job is substitution:\n\n\`\`\`\nsed 's/old/new/' file\n\`\`\`\n\n\`s\` means substitute, then /pattern/replacement/. Without the \`g\` flag only the **first** match on each line changes. Add \`g\` to change **every** match.\n\n\`\`\`\nsed 's/cargo/freight/g' manifest.txt\n\`\`\`\n\nsed prints the changed text and leaves the file alone. Keep the result with \`> newfile\`.`,
        try: ["sed 's/cargo/freight/' manifest.txt", "echo aaa | sed 's/a/b/'", "echo aaa | sed 's/a/b/g'"],
        quiz: {
          q: "What does  echo banana | sed 's/a/o/'  print?",
          options: ['bonono', 'bonana', 'banana'],
          answer: 1,
          explain: 'Without g, sed replaces only the first match on the line: the first a becomes o.',
          why: { 0: 'That needs the g flag: s/a/o/g.', 2: 'The first a is replaced, so the line does change.' },
        },
      },
      {
        title: 'sed: pick lines, edit in place',
        body: `- \`sed -n '5p'\` prints only line 5 (\`-n\` silences the automatic printing, \`p\` prints)\n- \`sed -n '2,4p'\` prints lines 2 to 4\n- \`sed '3d'\` prints everything except line 3\n- \`sed -i 's/old/new/' file\` edits the file **in place**: no copy and no undo\n\nTip: \`sed -i.bak ...\` keeps a backup named file.bak.`,
        try: ["sed -n '2,4p' payroll.txt", "sed '1d' practice.txt", "sed -i 's/hold/cabin/' practice.txt", 'cat practice.txt'],
        after: `**Hacker's note:** \`sed -i\` silently rewrites config files. It is how admins patch servers and how attackers change settings such as sshd_config. Test with plain sed first, or use -i.bak.`,
        quiz: {
          q: 'Which command prints ONLY line 7 of a file?',
          options: ["sed -n '7p' file", "sed '7p' file", "sed '7d' file"],
          answer: 0,
          explain: '-n stops the automatic printing, and 7p prints just line 7.',
          why: { 1: 'Without -n, sed prints every line and then line 7 a second time.', 2: '7d deletes line 7, the opposite of what you want.' },
        },
      },
    ],
    brief: 'The payroll, a cargo manifest and a draft note need fixing. Use awk to read, sed to rewrite.',
    objectives: [
      {
        text: 'Print each person\'s name and hourly rate (the first and last column) of payroll.txt with awk',
        check: (q) => {
          const want = rows(q.read(`${H}/scrolls/payroll.txt`)).map((l) => { const f = l.split(/\s+/); return `${f[0]} ${f[3]}`; });
          return q.any((c) => c.name === 'awk' && printed(c, want));
        },
      },
      {
        text: 'List the human accounts in /etc/passwd (user ID 1000 or more) with awk -F:',
        check: (q) => {
          const want = rows(q.read('/etc/passwd')).map((l) => l.split(':')).filter((f) => Number(f[2]) >= 1000).map((f) => f[0]);
          return q.any((c) => c.name === 'awk' && printed(c, want));
        },
      },
      { text: 'Print only line 2 of payroll.txt using NR in awk', check: (q) => q.any((c) => c.name === 'awk' && /NR/.test(c.line) && printed(c, [rows(q.read(`${H}/scrolls/payroll.txt`))[1]])) },
      {
        text: 'List the names of everyone paid more than 40 per hour (a condition on column 4)',
        check: (q) => {
          const want = rows(q.read(`${H}/scrolls/payroll.txt`)).map((l) => l.split(/\s+/)).filter((f) => Number(f[3]) > 40).map((f) => f[0]);
          return q.any((c) => c.name === 'awk' && printed(c, want));
        },
      },
      { text: 'Add up all the hours (column 3) with awk and END, then submit the total', check: (q) => q.got(0) && q.ran('awk') },
      { text: 'Print only line 5 of payroll.txt with sed -n', check: (q) => q.any((c) => c.name === 'sed' && c.argv.some((a) => /^-\w*n/.test(a)) && printed(c, [rows(q.read(`${H}/scrolls/payroll.txt`))[4]])) },
      {
        text: 'Replace every cargo with freight in manifest.txt and save the result as manifest-new.txt',
        check: (q) => {
          const t = q.read(`${H}/scrolls/manifest-new.txt`) || '';
          return q.any((c) => c.name === 'sed' && redirTo(c, '>', /manifest-new\.txt$/)) && /freight/.test(t) && !/cargo/.test(t) && rows(t).length === 4;
        },
      },
      {
        text: 'Edit notes.txt in place with sed -i so that every draft becomes final',
        check: (q) => {
          const t = q.read(`${H}/scrolls/notes.txt`) || '';
          return q.any((c) => c.name === 'sed' && c.argv.some((a) => /^-i/.test(a))) && /final/.test(t) && !/draft/.test(t);
        },
      },
    ],
    hints: [
      'payroll.txt columns: $1 name, $2 department, $3 hours, $4 rate. NR is the line number and END runs after the last line.',
      "`awk '{print $1, $NF}' payroll.txt`, `awk -F: '$3 >= 1000 {print $1}' /etc/passwd`, `awk 'NR == 2' payroll.txt`, `awk '$4 > 40 {print $1}' payroll.txt`, `awk '{s += $3} END {print s}' payroll.txt`.",
      "`sed -n '5p' payroll.txt`, `sed 's/cargo/freight/g' manifest.txt > manifest-new.txt`, `sed -i 's/draft/final/' notes.txt`.",
    ],
    codex: ['awk', 'sed'],
    realWorld: { text: `On Kali: \`awk -F: '$3 >= 1000 {print $1}' /etc/passwd\`, \`sed -n '1,5p' /etc/passwd\` and \`awk '{print $1}' /etc/services | head\`. Never run \`sed -i\` on a real system file without \`-i.bak\` first.` },
    journal: 'When would you reach for awk instead of cut, and for sed instead of tr?',
    solution: (s) => [
      "awk '{print $1, $NF}' payroll.txt",
      "awk -F: '$3 >= 1000 {print $1}' /etc/passwd",
      "awk 'NR == 2' payroll.txt",
      "awk '$4 > 40 {print $1}' payroll.txt",
      "awk '{s += $3} END {print s}' payroll.txt",
      `submit ${s.flags[0]}`,
      "sed -n '5p' payroll.txt",
      "sed 's/cargo/freight/g' manifest.txt > manifest-new.txt",
      "sed -i 's/draft/final/' notes.txt",
    ],
  },

  // ------------------------------------------------------------------ 6
  {
    id: 'z4-6',
    title: 'Chain Reactions',
    xp: 90,
    panel: 'pipes',
    story: 'At the far end of the works, machines trigger machines. "One command can feed another, and a third can wait on the result," says Old Root. "This is how you automate."',
    start: { cwd: `${H}/chain` },
    setup(w) {
      const D = `${H}/chain`;
      const diffTok = w.flag(24);
      const code = w.flag(10);
      for (const f of ['a1.tmp', 'a2.tmp', 'b.log', 'deep/c1.tmp', 'deep/c2.tmp', 'deep/keep.txt', 'deep/deeper/d1.tmp']) w.m.file(`${D}/crates/${f}`, `${f}\n`, o);
      w.m.file(`${D}/crates/deep/deeper/manifest.txt`, `Shipment code: ${code}\n`, o);
      const steps = w.shuffle(['open the loading door', 'check the gauge reading', 'log the pressure in the book', 'close the loading door', 'sweep the floor', 'oil the hinges', 'lock the office']);
      const at = 2 + Math.floor(w.rand() * 5);
      steps.splice(at, 0, 'turn the valve one quarter');
      w.m.file(`${D}/recipe.txt`, steps.join('\n') + '\n', o);
      w.state.flags.push(String(at + 1));
      const oldL = [];
      for (let i = 0; i < 100; i++) oldL.push(w.token(24));
      const newL = oldL.slice();
      const k = 15 + Math.floor(w.rand() * 70);
      newL[k] = diffTok;
      w.m.file(`${D}/passwords.old`, oldL.join('\n') + '\n', o);
      w.m.file(`${D}/passwords.new`, newL.join('\n') + '\n', o);
      w.m.file(`${D}/old.txt`, 'alpha\nbravo\ncharlie\ndelta\necho\n', o);
      w.m.file(`${D}/new.txt`, 'alpha\nbravo\nCHARLIE\ndelta\necho\n', o);
    },
    teach: [
      {
        title: '$( ): a command inside a command',
        body: `\`$(command)\` runs the command first and pastes its output into the line, like a variable that was just computed.\n\n\`\`\`\necho "Today is $(date +%F)"\nls -l $(which ls)\nmkdir "report-$(date +%F)"\n\`\`\`\n\nUse double quotes around it when the result may contain spaces. Inside single quotes nothing expands: \`echo '$(whoami)'\` prints the text as is.`,
        try: ['echo "Today is $(date +%F)"', 'ls -l $(which ls)', 'echo "There are $(ls /etc | wc -l) names in /etc"'],
        quiz: {
          q: 'What does  echo $(whoami)  print?',
          options: ['The text $(whoami)', 'The output of whoami: your user name', 'Nothing'],
          answer: 1,
          explain: 'The shell runs whoami first, then echo prints what whoami printed.',
          why: { 0: 'That only happens inside single quotes, where nothing is expanded.', 2: 'The substitution produces your user name, so echo has something to print.' },
        },
      },
      {
        title: 'xargs: lines become arguments',
        body: `Some commands (rm, ls, cat) take file names as **arguments**, not from stdin. \`xargs\` bridges the gap: it reads lines from stdin and puts them after a command.\n\n\`\`\`\nfind crates -name '*.tmp' | xargs ls -l\n\`\`\`\n\nThat runs \`ls -l crates/a1.tmp crates/a2.tmp ...\`. Swap \`ls -l\` for \`rm\` and it deletes them all. Look first, delete second!\n\n\`xargs -n 1\` runs the command once per item.`,
        try: ["find crates -name '*.tmp' | xargs ls -l", 'echo one two three | xargs -n 1'],
        after: `**Hacker's note:** names with spaces break plain xargs; the safe pair is \`find ... -print0 | xargs -0 ...\`. And \`find / -name "*.conf" 2>/dev/null | xargs grep -l password\` is a real credential hunt.`,
        quiz: {
          q: "Why does  find . -name '*.tmp' | rm  not work?",
          options: ['rm reads names from its arguments, not stdin, so xargs is needed', 'find cannot print file names', 'rm only works on folders'],
          answer: 0,
          explain: 'rm ignores stdin. xargs turns the lines find printed into arguments: find ... | xargs rm.',
          why: { 1: 'find prints names just fine. The problem is on the receiving side.', 2: 'rm removes files. -r is needed only for folders.' },
        },
      },
      {
        title: 'seq and xargs -I{}',
        body: `\`xargs -I{} cmd {}\` runs the command **once per input line**, putting the line wherever \`{}\` appears. \`seq\` makes numbers on demand:\n\n\`\`\`\nseq 5\nseq 2 2 10\nseq 3 | xargs -I{} echo "round {}"\n\`\`\`\n\n\`seq FIRST STEP LAST\`, so \`seq 2 2 10\` prints 2 4 6 8 10. Together, seq and xargs can create, test or scan dozens of things with one line.`,
        try: ['seq 5', 'seq 2 2 10', 'seq 3 | xargs -I{} echo "round {}"'],
        quiz: {
          q: 'What does  seq 3 | xargs -I{} echo n={}  print?',
          options: ['n=1, n=2 and n=3 on three lines', 'n={} once', 'n=3 only'],
          answer: 0,
          explain: 'xargs runs echo once per input line and replaces {} with that line.',
          why: { 1: 'xargs replaces {} with each input line before running echo.', 2: 'seq 3 prints 1, 2 and 3, and every one gets its own echo.' },
        },
      },
      {
        title: 'nl numbers the lines',
        body: `\`nl\` puts a line number in front of every line it receives. Combine it with grep to learn the line **number** of a match:\n\n\`\`\`\nnl recipe.txt | grep gauge\n\`\`\`\n\nSame idea as \`grep -n\`, but it works on anything you can pipe in.`,
        try: ['nl recipe.txt', 'nl recipe.txt | grep gauge'],
        quiz: {
          q: 'What does  seq 3 | nl  print?',
          options: ['The numbers 1 2 3, each with a line number in front', 'Only the number 3', 'An error, because seq is not a file'],
          answer: 0,
          explain: 'nl reads stdin like any filter. Each of seq\'s lines gets a number in front.',
          why: { 1: 'nl prints every line it receives.', 2: 'nl reads from the pipe when no file is given.' },
        },
      },
      {
        title: 'diff: spot the change (Bandit 17)',
        body: `\`diff A B\` prints what differs between two files. \`3c3\` means line 3 of A **c**hanged into line 3 of B. Lines starting with \`<\` come from the FIRST file, lines starting with \`>\` from the second:\n\n\`\`\`\n3c3\n< charlie\n---\n> CHARLIE\n\`\`\`\n\nOverTheWire Bandit level 17: passwords.old and passwords.new differ in exactly ONE line, and the password is the changed line in passwords.new. Run diff, then read the line that starts with \`>\`.`,
        try: 'diff old.txt new.txt',
        quiz: {
          q: 'In diff output, a line that starts with > comes from...',
          options: ['the first file', 'the second file', 'neither: it is a comment'],
          answer: 1,
          explain: '< marks lines from the first file, > marks lines from the second.',
          why: { 0: 'The first file is marked with <.', 2: 'Every < or > line is real content from one of the two files.' },
        },
      },
    ],
    brief: 'Wire the reactions: backups, cleanup, numbered rounds, a hidden manifest and a doctored password list.',
    objectives: [
      {
        text: 'Create a folder named backup-DATE here using $(date +%F) inside the mkdir command',
        check: (q) => q.any((c) => c.name === 'mkdir' && /\$\(\s*date|`\s*date/.test(c.line)) && q.list(`${H}/chain`).some((n) => /^backup-\d{4}-\d{2}-\d{2}$/.test(n)),
      },
      { text: 'Use nl and grep together to find the step number that mentions the valve in recipe.txt, then submit that number', check: (q) => q.got(2) && pipeSeq(q, /^nl\b/, /^grep\b/) },
      {
        text: 'Delete every .tmp file under crates with find piped into xargs rm (keep the other files)',
        check: (q) => ['a1.tmp', 'a2.tmp', 'deep/c1.tmp', 'deep/c2.tmp', 'deep/deeper/d1.tmp'].every((f) => !q.exists(`${H}/chain/crates/${f}`))
          && ['b.log', 'deep/keep.txt', 'deep/deeper/manifest.txt'].every((f) => q.isFile(`${H}/chain/crates/${f}`))
          && pipeSeq(q, /^find\b/, /^xargs\b.*\brm\b/),
      },
      {
        text: 'Create round1.txt to round5.txt with seq piped into xargs -I{} touch',
        check: (q) => [1, 2, 3, 4, 5].every((i) => q.isFile(`${H}/chain/round${i}.txt`)) && pipeSeq(q, /^seq\b/, /^xargs\b.*-I/),
      },
      {
        text: 'Somewhere under crates hides manifest.txt. Read it with cat and $(find ...), then submit the shipment code',
        check: (q) => q.got(1) && q.any((c) => c.name === 'cat' && /(\$\(|`)\s*find\b/.test(c.line)),
      },
      { text: 'Bandit 17: use diff on passwords.old and passwords.new, and submit the changed line from passwords.new', check: (q) => q.got(0) && q.ran('diff', { anyStatus: true }) },
    ],
    hints: [
      '$(cmd) pastes a command\'s output into the line. xargs turns lines into arguments. diff shows < (first file) and > (second file).',
      "`mkdir \"backup-$(date +%F)\"`, `nl recipe.txt | grep valve`, `find crates -name '*.tmp' | xargs rm`, `seq 5 | xargs -I{} touch round{}.txt`.",
      '`cat $(find crates -name manifest.txt)` gives the shipment code. `diff passwords.old passwords.new`: submit the part after > .',
    ],
    codex: ['xargs', 'diff', 'seq', 'nl'],
    realWorld: { text: 'On Kali: `echo "Backup $(date +%F)"`, `diff /etc/passwd /etc/passwd-`, and `find /etc -name "*.conf" 2>/dev/null | xargs grep -l ssh`. Then try Bandit 17 for real.', bandit: [18] },
    journal: 'Describe a chore you do by hand that find | xargs or seq | xargs could do for you.',
    solution: (s) => [
      'mkdir "backup-$(date +%F)"',
      'nl recipe.txt | grep valve',
      `submit ${s.flags[2]}`,
      "find crates -name '*.tmp' | xargs rm",
      'seq 5 | xargs -I{} touch round{}.txt',
      'cat $(find crates -name manifest.txt)',
      `submit ${s.flags[1]}`,
      'diff passwords.old passwords.new',
      `submit ${s.flags[0]}`,
    ],
  },

  // ------------------------------------------------------------------ boss
  {
    id: 'z4-boss',
    title: 'The Log Golem',
    xp: 180,
    panel: 'pipes',
    boss: { name: 'Log Golem', taunt: '"I am a thousand lines of noise," the Golem grumbles. "Find one thief in me."' },
    story: 'In the deepest hall sleeps the Log Golem, a hulking heap of auth.log lines. Someone has been hammering this machine\'s SSH door all night. Read the Golem\'s body, /var/log/auth.log, and find out who, how hard, and whether they got in. Old Root added you to the adm group so you may read it. Beware: a wrong answer costs a heart.',
    setup(w) {
      const log = buildAuthLog(w);
      w.m.groups.get('adm').members.add('recruit');
      w.m.file('/var/log/auth.log', log.text, { mode: 0o640, group: 'adm' });
      w.state.flags.push(String(log.failed), log.ipA, log.top, log.S, log.tok);
    },
    teach: [
      {
        title: 'Scout before you strike',
        body: `Read a few lines first. Every sshd line has the same shape:\n\n\`\`\`\nOct 31 03:12:45 quest sshd[2411]: Failed password for root from 1.2.3.4 port 51234 ssh2\n\`\`\`\n\nTwo traps wait in this log:\n\n- Some lines say \`Failed publickey\` or \`Invalid user\`. Match the exact words you are asked about.\n- When the account does not exist, the line reads \`Failed password for invalid user admin from ...\`, two words longer. Counting fields from the left shifts. Counting from the right does not: the IP is always \`$(NF-3)\` and the user name always \`$(NF-5)\`.`,
        try: ['ls -l /var/log/auth.log', 'wc -l /var/log/auth.log', 'tail -n 4 /var/log/auth.log'],
        quiz: {
          q: "On a line  Failed password for invalid user admin from 1.2.3.4 port 5 ssh2  why does awk '{print $9}' print \"invalid\" instead of the user?",
          options: ['awk counts from zero', 'The words invalid user push the name to field 11', 'awk skips lines that say invalid'],
          answer: 1,
          explain: 'For a normal account the name is field 9. "invalid user" adds two words, so the name moves to field 11. $(NF-5) finds it either way.',
          why: { 0: 'awk fields start at 1, with $0 as the whole line.', 2: 'awk reads every line. The field simply is not where you expected.' },
        },
      },
      {
        title: 'The counting recipe',
        body: `The pattern from Sort the Loot answers most log questions:\n\n\`\`\`\ngrep WORDS file | awk '{print COLUMN}' | sort | uniq -c | sort -rn | head -n 3\n\`\`\`\n\n1. \`grep\` keeps only the lines about your question\n2. \`awk\` or \`cut\` extracts the one column that matters\n3. \`sort | uniq -c | sort -rn\` counts and ranks\n\nFilter first, then count. Counting an IP across the whole log also counts its harmless lines. The same recipe on another column shows how busy each hour was.`,
        try: ["awk '{print $3}' /var/log/auth.log | cut -d: -f1 | sort | uniq -c | head -n 6"],
        quiz: {
          q: 'To rank values by how often they appear, most frequent first, which order is right?',
          options: ['uniq -c | sort -rn | sort', 'sort | uniq -c | sort -rn', 'sort -rn | uniq -c'],
          answer: 1,
          explain: 'Sort so equal lines touch, count them with uniq -c, then sort the counts as numbers, biggest first.',
          why: { 0: 'uniq -c needs sorted input before it can count correctly.', 2: 'Sorting numerically first does not group equal text lines.' },
        },
      },
    ],
    brief: 'Questions about /var/log/auth.log. Each correct answer hits the Golem. A wrong flag costs a heart.',
    objectives: [
      { text: 'Count the failed password attempts: the lines of auth.log that contain Failed password. Submit the number', check: (q) => q.got(0) },
      { text: 'Find the attacker: the IP address with the most failed password attempts. Submit it', check: (q) => q.got(1) },
      {
        text: 'Save every failed password line from the attacker\'s IP into evidence.txt in your home folder (grep and >)',
        check: (q) => {
          const ip = q.state.flags[1];
          const want = rows(q.read('/var/log/auth.log')).filter((l) => l.includes('Failed password') && l.includes(` from ${ip} `));
          const got = rows(q.read(`${H}/evidence.txt`));
          return want.length > 0 && got.length === want.length && got.every((l) => want.includes(l));
        },
      },
      { text: 'Find the user name the attacker tried most often (mind the invalid user lines). Submit it', check: (q) => q.got(2) },
      { text: 'Did the attacker get in? Submit the user name of their successful login (an Accepted line from the attacker\'s IP)', check: (q) => q.got(3) },
      { text: 'Right after logging in, the intruder used sudo to curl a URL. Submit the 12-character code at the end of that URL', check: (q) => q.got(4) },
    ],
    hints: [
      'Scout with `tail -n 5 /var/log/auth.log` and `grep -c "Failed password" /var/log/auth.log`. Match the exact words: Failed publickey is a different event.',
      'Recipe: `grep "Failed password" /var/log/auth.log | awk \'{print $(NF-3)}\' | sort | uniq -c | sort -rn | head`. The user name is `$(NF-5)` once you filter to the attacker\'s IP.',
      '`grep "Failed password" /var/log/auth.log | grep IP > evidence.txt`. Login: `grep Accepted /var/log/auth.log | grep IP`. Code: `grep sudo /var/log/auth.log | grep USER`, then take the last word and cut the code out of the URL.',
    ],
    codex: [],
    realWorld: { text: 'On a real server the same pipeline runs against /var/log/auth.log: `sudo grep "Failed password" /var/log/auth.log | awk \'{print $(NF-3)}\' | sort | uniq -c | sort -rn | head`. Systems that log with journald use `journalctl -u ssh` instead of the file. Real attackers do this to every public server, all night.', bandit: [9, 12, 18] },
    journal: 'Which stage of your pipeline mattered most for getting a correct answer, and what went wrong when you skipped the grep?',
    solution: (s) => [
      'tail -n 4 /var/log/auth.log',
      'grep -c "Failed password" /var/log/auth.log',
      `submit ${s.flags[0]}`,
      `grep "Failed password" /var/log/auth.log | awk '{print $(NF-3)}' | sort | uniq -c | sort -rn | head -n 3`,
      `submit ${s.flags[1]}`,
      `grep "Failed password" /var/log/auth.log | grep ${s.flags[1]} > evidence.txt`,
      `awk '{print $(NF-5)}' evidence.txt | sort | uniq -c | sort -rn | head -n 3`,
      `submit ${s.flags[2]}`,
      `grep Accepted /var/log/auth.log | grep ${s.flags[1]}`,
      `submit ${s.flags[3]}`,
      `grep sudo /var/log/auth.log | grep ${s.flags[3]} | grep curl | awk '{print $NF}' | cut -d/ -f4`,
      `submit ${s.flags[4]}`,
    ],
  },
];
