// Zone 7: Remote Reaches. Scripts, ssh, keys, archives and cron. The road to OverTheWire Bandit.
import { gzipData, bzipData, tarPack } from '../../engine/commands/archive.js';
import { makeKeyPair } from '../../engine/commands/net.js';
import { md5 } from '../../engine/hash.js';

const H = '/home/recruit';
const o = { owner: 'recruit' };
const GATE_HOST = 'bandit.labs.overthewire.org';
const GATE_BANNER = '\n  Linux Quest practice gateway. It copies the look of the real OverTheWire Bandit server.\n  Players only. Be kind to the machine.\n\n';
const GATE_MOTD = '\n  Welcome, player. Read before you run, and the password will find you.\n\n';
const READERS = ['cat', 'less', 'more', 'head', 'tail', 'nano', 'vi', 'vim', 'strings'];

// Did the player read a file whose typed name matches `re` (optionally on one host)?
const reads = (q, re, host) => q.any((c) => READERS.includes(c.name) && c.status === 0 && (!host || c.host === host) && c.argv.slice(1).some((a) => re.test(a)));

// Did the player run a script with at least `nargs` arguments (directly or through bash/sh)?
const ranScript = (q, name, nargs) => q.ran(name, { argv: (a) => a.length > nargs })
  || q.ran(['bash', 'sh'], { argMatch: new RegExp(`${name.replace('.', '\\.')}$`), argv: (a) => a.length > nargs + 1 });

// Active crontab lines: five time fields and a command, comments ignored.
const cronJobs = (text) => (text || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && /^(\S+\s+){5}\S/.test(l));

// Has the player's public key been appended to their own authorized_keys?
const keyInstalled = (q) => {
  const pub = q.read('~/.ssh/id_ed25519.pub');
  const ak = q.read('~/.ssh/authorized_keys');
  return !!(pub && ak && ak.includes(pub.trim().split(' ')[1]));
};

// The practice copy of the Bandit gateway: same host name, same port, same look.
function gateway(w) {
  const g = w.remote({ hostname: 'bandit', ip: '10.7.0.20', sshPort: 2220, banner: GATE_BANNER, motd: GATE_MOTD });
  g.aliases.push(GATE_HOST);
  w.world.addMachine(g);
  return g;
}

// xxd-style hexdump of a byte string, so `xxd -r` can turn it back.
function hexdump(d) {
  let out = '';
  for (let i = 0; i < d.length; i += 16) {
    const c = d.slice(i, i + 16);
    let hex = '';
    for (let j = 0; j < c.length; j++) hex += c.charCodeAt(j).toString(16).padStart(2, '0') + (j % 2 === 1 && j < 15 ? ' ' : '');
    out += `${i.toString(16).padStart(8, '0')}: ${hex.padEnd(39)}  ${c.replace(/[^\x20-\x7e]/g, '.')}\n`;
  }
  return out;
}

// Wrapped from the inside out: text > gzip > tar > bzip2 > tar > tar > bzip2 > gzip.
function onion(w, flag) {
  const t = w.now();
  const entry = (name, data) => ({ name, type: '0', data, mode: 0o644, uid: 0, gid: 0, mtime: t, uname: 'root', gname: 'root' });
  let d = `The password for bandit13 is ${flag}\n`;
  d = gzipData(d, 'data8.bin', t);
  d = tarPack([entry('data8.bin', d)]);
  d = bzipData(d);
  d = tarPack([entry('data6.bin', d)]);
  d = tarPack([entry('data5.bin', d)]);
  d = bzipData(d);
  return gzipData(d, 'data2.bin', t);
}

export default [
  {
    id: 'z7-1',
    title: 'Shell Scripts',
    xp: 70,
    panel: 'map',
    story: 'You reach the Remote Reaches, a country of servers too far to walk to. "Before you travel," says Old Root, "learn to write spells that cast themselves. A shell script is a list of commands saved in a file. Cast it once or a thousand times."',
    setup(w) {
      const m = w.m;
      m.file(`${H}/spells/sample.sh`, '#!/bin/bash\n# sample.sh: my very first spell\necho "The spell is cast."\ndate\n', o);
      m.file(`${H}/spells/greet.sh`, '#!/bin/bash\n# greet.sh NAME: greets whoever you name\necho "Hello, $1!"\necho "You gave me $# argument(s): $@"\n', { ...o, mode: 0o755 });
      m.file(`${H}/spells/count.sh`, '#!/bin/bash\n# count.sh N: counts from 1 to N\nfor i in $(seq 1 $1); do\n  echo "step $i"\ndone\n', { ...o, mode: 0o755 });
      m.file(`${H}/spells/check.sh`, '#!/bin/bash\n# check.sh FILE: does it exist?\nif [ -f "$1" ]; then\n  echo "$1 is here"\nelse\n  echo "$1 is missing"\nfi\n', { ...o, mode: 0o755 });
      m.dir(`${H}/spells`, o);
    },
    teach: [
      {
        title: 'A script is commands in a file',
        body: 'Anything you type in the terminal can be saved in a file and run later. That file is a **shell script**.\n\nIts first line is the **shebang**:\n\n```\n#!/bin/bash\necho "The spell is cast."\n```\n\n`#!/bin/bash` tells Linux which program should read the rest of the file. Any later line that starts with `#` is a comment, and bash ignores it.\n\nYou can run a script right away by handing it to bash: `bash sample.sh`. `sh script.sh` works too.',
        try: ['cat spells/sample.sh', 'bash spells/sample.sh'],
        quiz: {
          q: 'What does the first line, #!/bin/bash, do?',
          options: ['It is an ordinary comment', 'It names the program that should run the script', 'It makes the file executable'],
          answer: 1,
          explain: 'On the very first line, #! is special: it points at the interpreter that will read the file.',
          why: { 0: 'It starts with #, but #! on line one is special. Later # lines really are comments.', 2: 'Permissions are set with chmod, not inside the file.' },
        },
      },
      {
        title: 'Make it executable, then run it',
        body: 'A new file is not executable. Two steps fix that:\n\n```\nchmod +x hello.sh\n./hello.sh\n```\n\nWhy `./`? The shell only looks for commands in the folders listed in `$PATH`, and your current folder is not one of them. `./` means "the file called hello.sh right here".\n\nWithout `chmod +x` you get `Permission denied`. Write scripts with `nano hello.sh` (Ctrl+O, Enter, Ctrl+X to save and leave).\n\nBelow, `printf` writes a two-line script for you to practise on.',
        try: ["printf '#!/bin/bash\\necho practice spell\\n' > practice.sh", './practice.sh', 'chmod +x practice.sh', './practice.sh'],
        quiz: {
          q: 'You wrote spell.sh and ./spell.sh answers "Permission denied". What fixes it?',
          options: ['chmod +x spell.sh', 'rm spell.sh', 'Add a second #! line'],
          answer: 0,
          explain: 'The file has no execute bit yet. chmod +x adds it.',
          why: { 1: 'Deleting the script does not help, and it destroys your work.', 2: 'The shebang is fine. The problem is the file permissions.' },
        },
      },
      {
        title: 'Variables and arguments',
        body: 'A variable stores text. No spaces around the `=`, and use `$` to read it:\n\n```\nname="Scout"\necho "Hello, $name"\n```\n\nA script also receives the **arguments** you type after its name:\n\n- `$1`, `$2`, ... the first, second ... argument\n- `$#` how many arguments there are\n- `$@` all of them\n- `$0` the script\'s own name\n\nRun `./greet.sh Ada` and inside the script `$1` is `Ada` and `$#` is `1`. Keep variables in double quotes so names with spaces survive.',
        try: ['./spells/greet.sh Ada', './spells/greet.sh one two three'],
        quiz: {
          q: 'A script runs as ./tool.sh alpha beta gamma. What are $# and $2?',
          options: ['3 and beta', '2 and alpha', '3 and gamma'],
          answer: 0,
          explain: 'Three arguments were given, and $2 is the second one: beta.',
          why: { 1: 'Counting starts at $1, which is alpha. $2 is beta, and there are 3 arguments.', 2: '$3 is gamma. The second argument, $2, is beta.' },
        },
      },
      {
        title: 'Decisions and loops',
        body: 'A **for loop** repeats work for every item:\n\n```\nfor f in "$@"; do\n  echo "checking $f"\ndone\n```\n\nAn **if** chooses between two paths:\n\n```\nif [ -f "$1" ]; then\n  echo "it is a file"\nelse\n  echo "no such file"\nfi\n```\n\n`[ ... ]` is really the `test` command. Handy checks: `-f` is a regular file, `-d` a directory, `-z` an empty string, `=` equal strings, `-eq -lt -gt` compare numbers. The spaces inside the brackets are required.\n\nLoops can also count: `for i in 1 2 3` or `for i in $(seq 1 5)`, or walk files: `for f in *.txt`.',
        try: ['bash spells/check.sh /etc/passwd', 'bash spells/check.sh /nope', 'bash spells/count.sh 3'],
        quiz: {
          q: 'Which test is written correctly?',
          options: ['[ -f "$1" ]', '[-f "$1"]', '[ -f"$1" ]'],
          answer: 0,
          explain: '[ is a command, so it needs a space after it, and the closing ] needs a space before it.',
          why: { 1: 'Without the space bash hunts for a command called [-f and fails.', 2: '-f and "$1" are separate words and need a space between them.' },
        },
        after: '**Hacker\'s note:** recon tools like linPEAS are just very long bash scripts. Bandit levels 24 and 25 ask you to write a loop that tries every PIN. Learn to script and you stop doing things by hand.',
      },
      {
        title: 'read: ask a question',
        body: '`read` stops the script and waits for a line of input:\n\n```\nread -p "Your name? " who\necho "Welcome, $who"\n```\n\n`-p` shows a prompt. You can also loop over the lines of a file: `while read line; do echo "$line"; done < names.txt`.',
        try: 'read -p "Your name? " who; echo "Welcome, $who"',
      },
    ],
    brief: 'Write three spells in your home folder: hello.sh, greet.sh and report.sh. Old Root will cast each one.',
    objectives: [
      { text: 'Write hello.sh with nano: a #!/bin/bash line and an echo', check: (q) => { const s = q.read(`${H}/hello.sh`) || ''; return /^#!\/bin\/bash/.test(s) && /echo/.test(s); } },
      { text: 'Run hello.sh through bash (it is not executable yet)', check: (q) => q.ran('bash', { argMatch: /hello\.sh$/ }) },
      { text: 'Make hello.sh executable', check: (q) => Boolean((q.mode(`${H}/hello.sh`) || 0) & 0o111) },
      { text: 'Run it directly with ./hello.sh', check: (q) => q.ran('hello.sh') },
      { text: 'Write greet.sh using $1 and $#, then run it with a name', check: (q) => { const s = q.read(`${H}/greet.sh`) || ''; return s.includes('$1') && s.includes('$#') && ranScript(q, 'greet.sh', 1); } },
      { text: 'Write report.sh with a for loop over "$@" and an if [ -f ... ] test, then run it with two names (one real file, one that does not exist)', check: (q) => { const s = q.read(`${H}/report.sh`) || ''; return /\bfor\b/.test(s) && /\bdone\b/.test(s) && /\bif\b\s*\[/.test(s) && /\bfi\b/.test(s) && ranScript(q, 'report.sh', 2); } },
    ],
    hints: [
      '`nano hello.sh`, type `#!/bin/bash` on line one and `echo "Hello"` on line two, then Ctrl+O, Enter, Ctrl+X. After that: `bash hello.sh`, `chmod +x hello.sh`, `./hello.sh`.',
      'greet.sh needs `echo "Hello, $1! You gave $# argument(s)."`, then `chmod +x greet.sh` and `./greet.sh Ada`. report.sh loops with `for f in "$@"; do ... done` and tests each name with `if [ -f "$f" ]; then ... else ... fi`.',
      'report.sh: line 1 `#!/bin/bash`, then `for f in "$@"; do`, `if [ -f "$f" ]; then echo "found $f"; else echo "missing $f"; fi`, `done`. Run it: `chmod +x report.sh` then `./report.sh /etc/passwd /nope`.',
    ],
    codex: ['bash', 'sh', 'test', 'read'],
    realWorld: { text: 'On Kali, make ~/lab/zone7, write hello.sh with nano, run it with `bash` first, then `chmod +x` and `./hello.sh`. Then write a script that takes a folder name and prints how many files it holds (hint: `ls "$1" | wc -l`). Bandit levels 24 and 25 expect loops and scripts.', bandit: [24, 25] },
    journal: 'In your own words: why does ./script.sh need chmod +x, but bash script.sh does not?',
    solution: [
      { cmd: 'nano hello.sh', edit: () => '#!/bin/bash\necho "Hello from my first script"\n' },
      'bash hello.sh',
      'chmod +x hello.sh',
      './hello.sh',
      { cmd: 'nano greet.sh', edit: () => '#!/bin/bash\nname="$1"\necho "Hello, $name! You gave $# argument(s)."\n' },
      'chmod +x greet.sh',
      './greet.sh Ada',
      { cmd: 'nano report.sh', edit: () => '#!/bin/bash\nfor f in "$@"; do\n  if [ -f "$f" ]; then\n    echo "found $f"\n  else\n    echo "missing $f"\n  fi\ndone\n' },
      'chmod +x report.sh',
      './report.sh /etc/passwd /nope',
    ],
  },

  {
    id: 'z7-2',
    title: 'The Gateway',
    xp: 80,
    panel: 'map',
    story: '"The real training ground lies across the wire," Old Root says, pointing at a lit window in the distance. "The OverTheWire Bandit servers. Every hacker passes through that gateway. Today you knock for the first time."',
    setup(w) {
      const flag = w.flag(32);
      const g = gateway(w);
      g.addUser('bandit0', { uid: 11000, password: 'bandit0' });
      g.addUser('bandit1', { uid: 11001, password: flag });
      g.file('/home/bandit0/readme', `Well done, player. Your first login worked.\nThe password for bandit1 is: ${flag}\n`, { owner: 'bandit1', group: 'bandit0', mode: 0o640 });
      const p = w.remote({ hostname: 'practice', ip: '10.7.0.5', sshPort: 2200, motd: '\n  Practice server. Nothing here can hurt you. Type exit to leave.\n\n' });
      p.addUser('trainee', { uid: 2000, password: 'training' });
    },
    teach: [
      {
        title: 'ssh: a shell on another machine',
        body: '`ssh` (secure shell) opens a shell on **another computer** over the network, and everything is encrypted.\n\n```\nssh USER@HOST -p PORT\n```\n\n- `USER` is the account on the remote machine\n- `HOST` is a name or an IP address\n- `-p PORT` picks the port. Normal ssh uses 22, but OverTheWire Bandit listens on **2220**\n\nThe real Bandit 0 login is exactly this:\n\n```\nssh bandit0@bandit.labs.overthewire.org -p 2220\n```\n\nIn this realm the same command reaches a practice copy of the gateway (user `bandit0`, password `bandit0`, just like the real page). First warm up on the practice server: user `trainee`, port 2200, password `training`.',
        try: 'ssh trainee@practice -p 2200',
        after: 'Answer the questions as they come. Type `yes` at the fingerprint question, then the password. Typing a password shows nothing on screen, which is normal. When you are done, type `exit`.',
        quiz: {
          q: 'You run ssh bandit0@bandit.labs.overthewire.org and get "Connection refused". What did you forget?',
          options: ['The password', 'The port: -p 2220', 'The username'],
          answer: 1,
          explain: 'Plain ssh knocks on port 22. Bandit listens on 2220, so nobody answers on 22.',
          why: { 0: 'The password is only asked after the connection works. Refused means nobody answered the knock.', 2: 'The username is already in bandit0@... The refusal comes from the port.' },
        },
      },
      {
        title: 'The fingerprint question',
        body: 'The first time you connect to a machine, ssh shows a **fingerprint** of its host key and asks you to confirm it:\n\n```\nThe authenticity of host \'[practice]:2200 (...)\' can\'t be established.\nED25519 key fingerprint is SHA256:...\nAre you sure you want to continue connecting (yes/no/[fingerprint])?\n```\n\nType the whole word `yes`. ssh remembers the machine in the file `~/.ssh/known_hosts`, so it only asks once. (That file lives on **your** machine. If your prompt still shows trainee@practice, type `exit` before you read it.)\n\nIf the key ever changes, ssh stops you with a big warning: either the server was rebuilt, or someone is pretending to be it.',
        try: 'cat ~/.ssh/known_hosts',
        quiz: {
          q: 'What is ~/.ssh/known_hosts for?',
          options: ['It remembers servers you trusted, so a fake one is noticed', 'It stores your passwords', 'It lists who may log in to your machine'],
          answer: 0,
          explain: 'ssh compares the server\'s key with the saved one. A mismatch means something changed, or someone is impersonating the server.',
          why: { 1: 'ssh never stores your passwords there.', 2: 'The list of who may log in is authorized_keys, on the server. You meet it in the next quest.' },
        },
        after: '**Hacker\'s note:** that question is your protection against a man-in-the-middle. Most people type yes without thinking. When it matters, compare the fingerprint with one you got from a safe channel.',
      },
      {
        title: 'Inside the remote shell',
        body: 'After the password you see the banner and welcome message, and your prompt changes to show the new user and machine, for example `bandit0@bandit:~$`. From now on **every command runs on the remote machine**.\n\n- `whoami` and `hostname` confirm who and where you are\n- `ls`, `cat`, `pwd`: the same tools, another computer\n- `exit` (or Ctrl+D) closes the connection and brings you home:\n\n```\nlogout\nConnection to bandit closed.\n```',
        try: ['whoami', 'hostname', 'exit'],
        quiz: {
          q: 'Your prompt says bandit0@bandit:~$ and you type ls. Where does ls run?',
          options: ['On your own computer', 'On the remote machine, bandit', 'On both machines'],
          answer: 1,
          explain: 'The prompt shows where you are. Every command goes to the remote shell until you exit.',
          why: { 0: 'Your own computer only hears from you again after exit.', 2: 'One shell, one machine at a time.' },
        },
      },
      {
        title: 'How a Bandit level works',
        body: 'Every Bandit level is a login. The password for the next account is hidden on the machine. You find it, read it, and log in as the next user.\n\nIn this quest the hidden password sits in the file `readme` in the home folder of `bandit0`. Here you hand it in with `submit`. On the real server you would log in as bandit1 with it.\n\nOne more trick: `ssh user@host -p PORT COMMAND` runs a single command remotely and returns at once. Never type a password on a command line, because it lands in your shell history.',
        try: 'ssh trainee@practice -p 2200 hostname',
        after: '**Hacker\'s note:** ssh is also how attackers hop from machine to machine once they hold a password. Defenders watch /var/log/auth.log for logins from places that should never log in.',
      },
    ],
    brief: 'Knock on the gateway: user bandit0, password bandit0, port 2220.',
    objectives: [
      { text: 'Log in to bandit.labs.overthewire.org as bandit0 on port 2220', check: (q) => q.ran('ssh', { argMatch: /^bandit0@/ }) },
      { text: 'Run whoami and hostname on the remote machine', check: (q) => q.ran('whoami', { host: 'bandit' }) && q.ran('hostname', { host: 'bandit' }) },
      { text: 'Read the file readme in the home folder of bandit0', check: (q) => q.ran('cat', { host: 'bandit', argMatch: /readme$/ }) },
      { text: 'Submit the password for bandit1 (submit PASSWORD)', check: (q) => q.submitted() },
      { text: 'Leave the gateway with exit and land back on quest', check: (q) => q.ran('exit', { host: 'bandit' }) && q.host() === 'quest' },
      { text: 'Read your known_hosts file and find the gateway\'s saved fingerprint', check: (q) => q.ran('cat', { host: 'quest', argMatch: /known_hosts$/, output: 'overthewire' }) },
    ],
    hints: [
      'The command has the shape `ssh USER@HOST -p PORT`. The user is bandit0, the host is bandit.labs.overthewire.org, the port is 2220.',
      'Type `yes` at the fingerprint question, then the password `bandit0`. Once inside: `whoami`, `hostname`, `ls`, `cat readme`, then `submit` followed by the password, then `exit`.',
      '`ssh bandit0@bandit.labs.overthewire.org -p 2220`, then `cat readme`, `submit PASSWORD`, `exit`, and finally `cat ~/.ssh/known_hosts` back home.',
    ],
    codex: ['ssh', 'exit'],
    realWorld: { text: 'On your Kali terminal run `ssh bandit0@bandit.labs.overthewire.org -p 2220` (password bandit0), then `cat readme`. That is the real Bandit level 0. Save the password you find in a notes file for level 1.', bandit: [0, 1] },
    journal: 'What does ssh ask you the first time you connect to a machine, and why does it ask?',
    solution: (s) => [
      { cmd: 'ssh bandit0@bandit.labs.overthewire.org -p 2220', answers: ['yes', 'bandit0'] },
      'whoami', 'hostname', 'cat readme', `submit ${s.flags[0]}`, 'exit', 'cat ~/.ssh/known_hosts',
    ],
  },

  {
    id: 'z7-3',
    title: 'Keys to the Kingdom',
    xp: 90,
    panel: 'map',
    story: '"Passwords can be guessed, shouted, or copied off a sticky note," Old Root says. "A key pair cannot. This is how real servers decide whom to trust."',
    setup(w) {
      const pw13 = w.token(32);
      const flag = w.flag(32);
      const g = gateway(w);
      const id = w.token(16);
      const { priv } = makeKeyPair(id, 'bandit14@bandit');
      g.addUser('bandit13', { uid: 11013, password: pw13 });
      g.addUser('bandit14', { uid: 11014, password: flag });
      g.user('bandit14').authorizedKeys.push(id);
      g.file('/home/bandit13/sshkey.private', priv, { owner: 'bandit13', mode: 0o644 });
      g.file('/etc/bandit_pass/bandit14', `${flag}\n`, { owner: 'bandit14', mode: 0o400 });
      w.m.dir(`${H}/.ssh`, { owner: 'recruit', mode: 0o700 });
      w.m.file(`${H}/bandit13.txt`, `Old Root's note\n\nbandit13 password: ${pw13}\nLogin: ssh bandit13@${GATE_HOST} -p 2220\n\nSomeone left a private key lying around in that home folder. It belongs to bandit14.\n`, o);
      w.state.pw13 = pw13;
    },
    teach: [
      {
        title: 'Two keys, one lock',
        body: 'An ssh **key pair** is two files that fit together:\n\n- the **public key** is a lock. You may give it to anyone and put it on any server\n- the **private key** opens that lock. It never leaves your machine\n\nA server keeps the public keys it trusts in `~/.ssh/authorized_keys`. When you connect, ssh proves you hold the matching private key, and you walk in with no password.\n\nSomeone who steals your private key **is you**. Treat it like a password that cannot be changed.',
        quiz: {
          q: 'Which file may you copy to a server so it will let you in?',
          options: ['id_ed25519 (the private key)', 'id_ed25519.pub (the public key)', 'Your login password'],
          answer: 1,
          explain: 'The .pub file is the public half. It is safe to share, and useless without the private half.',
          why: { 0: 'Never copy the private key anywhere. Whoever holds it can log in as you.', 2: 'The idea of keys is to stop sending the password at all.' },
        },
      },
      {
        title: 'ssh-keygen makes the pair',
        body: '`ssh-keygen -t ed25519` creates a modern key pair. It asks where to save it (press Enter for `~/.ssh/id_ed25519`) and for a passphrase (empty means none; on a real machine use one).\n\nYou get two files:\n\n- `id_ed25519`: the private key, mode `600`\n- `id_ed25519.pub`: the public key, mode `644`\n\nFor scripts, skip the questions: `ssh-keygen -f ./key -N ""`. Below, practise with a throwaway pair.',
        try: ['ssh-keygen -f ~/practice_key -N ""', 'ls -l ~/practice_key ~/practice_key.pub', 'cat ~/practice_key.pub'],
        quiz: {
          q: 'ls -l shows -rw------- for the private key and -rw-r--r-- for the .pub file. Why?',
          options: ['Only the owner should be able to read the private key', 'The .pub file is encrypted', 'Both modes are random'],
          answer: 0,
          explain: 'Mode 600 means owner read and write, nobody else. ssh insists on it for private keys.',
          why: { 1: 'The public key is plain text. It is meant to be shared.', 2: 'ssh-keygen sets them on purpose.' },
        },
      },
      {
        title: 'authorized_keys is the guest list',
        body: 'To be allowed in without a password, append your **public** key to the server\'s `~/.ssh/authorized_keys`:\n\n```\ncat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys\n```\n\nUse `>>` so you add to the list instead of replacing it.\n\nThis machine runs an ssh server too, so you can test the whole idea on yourself: install your public key, then `ssh recruit@localhost`. No password. Type `exit` to come back.',
        try: 'ls -la ~/.ssh',
        quiz: {
          q: 'Which command adds your public key to the guest list?',
          options: ['cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys', 'cat ~/.ssh/id_ed25519 >> ~/.ssh/authorized_keys', 'cat ~/.ssh/id_ed25519.pub > ~/.ssh/authorized_keys'],
          answer: 0,
          explain: 'The .pub file goes in, and >> appends so other keys stay on the list.',
          why: { 1: 'That is the private key. It must never be copied around.', 2: 'A single > replaces the file and erases every key that was allowed before.' },
        },
        after: '**Hacker\'s note:** adding your own public key to someone\'s authorized_keys is a classic persistence trick. Defenders audit those files regularly.',
      },
      {
        title: 'ssh -i and the 600 rule',
        body: '`ssh -i FILE user@host -p PORT` logs in with a specific private key.\n\nssh refuses a private key that other people can read:\n\n```\n@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @\nPermissions 0644 for \'sshkey.private\' are too open.\nThis private key will be ignored.\n```\n\nIt then falls back to asking for a password you do not have. Press Ctrl+C, run `chmod 600 sshkey.private` and try again.\n\nThis is Bandit 13 to 14. A private key for the next user lies in your home folder. From the gateway you log in to **the same machine** with it, so the host is `localhost`:\n\n```\nssh -i sshkey.private bandit14@localhost -p 2220\n```',
        try: ['chmod 600 ~/practice_key', 'ls -l ~/practice_key'],
        quiz: {
          q: 'ssh -i key prints UNPROTECTED PRIVATE KEY FILE and asks for a password. What do you do first?',
          options: ['Type random passwords until one works', 'chmod 600 on the key, then try again', 'Delete the key and make a new one for the server'],
          answer: 1,
          explain: 'The key is fine, its permissions are too open. chmod 600 fixes it in one second.',
          why: { 0: 'You do not have the password. The key was supposed to replace it.', 2: 'A new key would not be on the server\'s guest list.' },
        },
      },
    ],
    brief: 'First make a key pair and try it on your own machine. Then read Old Root\'s note (bandit13.txt in your home) and use the key you find on the gateway to become bandit14.',
    objectives: [
      { text: 'Create your own ed25519 key pair at the default place (~/.ssh/id_ed25519)', check: (q) => q.exists('~/.ssh/id_ed25519') && q.exists('~/.ssh/id_ed25519.pub') },
      { text: 'Add your public key to ~/.ssh/authorized_keys', check: (q) => keyInstalled(q) },
      { text: 'Log in to localhost with your key (no password needed)', check: (q) => keyInstalled(q) && q.ran('ssh', { host: 'quest', argMatch: /(^|@)localhost$/ }) },
      { text: 'Log in to the gateway as bandit13 with the password from Old Root\'s note (port 2220)', check: (q) => q.ran('ssh', { host: 'quest', argMatch: /^bandit13@/ }) },
      { text: 'Fix the permissions of sshkey.private so ssh accepts it (mode 600)', check: (q) => q.mode('/home/bandit13/sshkey.private', 'bandit') === 0o600 },
      { text: 'Use the key to log in as bandit14 from inside the gateway', check: (q) => q.ran('ssh', { host: 'bandit', argv: (a) => a.includes('-i') && a.some((x) => /^bandit14@/.test(x)) }) },
      { text: 'Read bandit14\'s password in /etc/bandit_pass/bandit14 and submit it', check: (q) => q.submitted() },
    ],
    hints: [
      '`ssh-keygen -t ed25519` and press Enter three times. Then `cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys` and `ssh recruit@localhost` (type yes once). `exit` brings you back.',
      '`cat bandit13.txt` for the password, then `ssh bandit13@bandit.labs.overthewire.org -p 2220`. `ls` shows sshkey.private. Try `ssh -i sshkey.private bandit14@localhost -p 2220` and read the warning.',
      'Press Ctrl+C at the password prompt, run `chmod 600 sshkey.private`, repeat the ssh -i command, then `cat /etc/bandit_pass/bandit14` and `submit` what it prints.',
    ],
    codex: ['ssh-keygen'],
    realWorld: { text: 'On Kali, make a key with `ssh-keygen -t ed25519`, look at both files in ~/.ssh and check their modes with `ls -l`. Then play the real Bandit level 13 to 14 with `ssh -i sshkey.private bandit14@localhost -p 2220`.', bandit: [14] },
    journal: 'Explain the public key and the private key as if to a friend who has never heard of ssh.',
    solution: (s) => [
      { cmd: 'ssh-keygen -t ed25519', answers: ['', '', ''] },
      'cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys',
      { cmd: 'ssh recruit@localhost', answers: ['yes'] },
      'exit',
      'cat bandit13.txt',
      { cmd: 'ssh bandit13@bandit.labs.overthewire.org -p 2220', answers: ['yes', s.pw13] },
      'ls',
      { cmd: 'ssh -i sshkey.private bandit14@localhost -p 2220', answers: ['yes'] },
      'chmod 600 sshkey.private',
      'ssh -i sshkey.private bandit14@localhost -p 2220',
      'cat /etc/bandit_pass/bandit14',
      `submit ${s.flags[0]}`,
    ],
  },

  {
    id: 'z7-4',
    title: 'Peeling the Onion',
    xp: 90,
    panel: 'map',
    story: '"Some secrets are wrapped in layer after layer," Old Root says, turning an onion in his hands. "Never trust the label on the outside. Look at what is really inside, one layer at a time."',
    start: { host: 'bandit', user: 'bandit12', cwd: '/home/bandit12' },
    setup(w) {
      const flag = w.flag(32);
      const g = gateway(w);
      g.addUser('bandit12', { uid: 11012, password: w.token(16) });
      g.addUser('bandit13', { uid: 11013, password: flag });
      g.dir('/home/bandit12', { owner: 'root', group: 'bandit12', mode: 0o755 });
      g.file('/home/bandit12/data.txt', hexdump(onion(w, flag)), { owner: 'bandit13', group: 'bandit12', mode: 0o640 });
    },
    teach: [
      {
        title: 'xxd -r: from hexdump back to bytes',
        body: 'A **hexdump** shows every byte of a file as two hex digits. `xxd` makes one, and `xxd -r` (reverse) turns it back into the real bytes:\n\n```\nxxd -r data.txt > data.bin\n```\n\nThe first bytes of a file, its **magic bytes**, tell what it is: `1f8b` is gzip, `425a68` ("BZh") is bzip2.\n\nYou are already logged in on the gateway as `bandit12` (this is Bandit 12). The file `data.txt` in your home folder is a hexdump of something that was compressed again and again.',
        try: ['echo "Hi there" | xxd', 'echo "Hi there" | xxd | xxd -r'],
        quiz: {
          q: 'What does xxd -r data.txt > data.bin do?',
          options: ['Turns the hexdump text back into the original bytes', 'Makes a hexdump of data.txt', 'Compresses data.txt'],
          answer: 0,
          explain: '-r means reverse: from hex text back to the binary file.',
          why: { 1: 'That is plain xxd data.txt. With -r the direction flips.', 2: 'xxd never compresses. That is gzip or bzip2.' },
        },
      },
      {
        title: 'file never lies',
        body: 'A file called `data.bin` or `data5.txt` may contain anything. `file` reads the bytes, not the name:\n\n- `gzip compressed data` means gunzip it\n- `bzip2 compressed data` means bunzip2 it\n- `POSIX tar archive` means tar -xf it\n- `ASCII text` means you have reached the core\n\nThe ritual is: **file, rename, unpack, repeat**.',
        try: ['file /etc/passwd', 'file /bin/ls', 'file /home/bandit12/data.txt'],
        quiz: {
          q: 'A file is named backup.txt but file says "gzip compressed data". What is it?',
          options: ['A text file', 'A gzip archive with a misleading name', 'A broken file'],
          answer: 1,
          explain: 'file looks at the bytes inside. Names and extensions can be anything.',
          why: { 0: 'Text files do not start with the gzip magic bytes. The name lies.', 2: 'file would say "data" for a broken file. It recognised gzip.' },
        },
      },
      {
        title: 'gzip, bzip2 and tar',
        body: 'Three tools wrap files:\n\n- `gzip` makes `.gz`. `gunzip file.gz` undoes it, but **needs the .gz suffix**. A file without it: `mv data data.gz` first\n- `bzip2` makes `.bz2`. `bunzip2 file.bz2` undoes it. With no suffix it still works and writes `file.out`\n- `tar -xf archive` unpacks a tar archive into the current folder. `tar -tf archive` lists it first\n\n`zcat` and `bzcat` print the contents without unpacking. Practise on a tiny one:',
        try: ['mkdir /tmp/demo', 'echo "core of the onion" > /tmp/demo/core.txt', 'gzip /tmp/demo/core.txt', 'file /tmp/demo/core.txt.gz', 'gunzip /tmp/demo/core.txt.gz', 'cat /tmp/demo/core.txt'],
        quiz: {
          q: 'gunzip data answers "unknown suffix -- ignored". What now?',
          options: ['mv data data.gz, then gunzip data.gz', 'Delete the file', 'Run bunzip2 on it'],
          answer: 0,
          explain: 'gunzip insists on .gz. Rename the file, then unpack it.',
          why: { 1: 'The suffix is just a naming problem. Rename it.', 2: 'file said gzip, so bunzip2 would fail. Always follow what file says.' },
        },
      },
      {
        title: 'Work in your own /tmp folder',
        body: 'Your home folder here is read-only: unpacking next to `data.txt` fails with "Permission denied". The standard escape is /tmp, which anyone may write to. Make a folder with a name nobody else will use (not demo, that one is taken):\n\n```\nmkdir /tmp/yourname\ncp data.txt /tmp/yourname\ncd /tmp/yourname\n```\n\nThen peel, one layer at a time. Each layer leaves a new file. Check it with `file` before touching it.',
        after: '**Hacker\'s note:** /tmp is where attackers drop their tools, because every user can write there. Defenders check it for files they do not recognise.',
      },
    ],
    brief: 'You are bandit12 on the gateway. data.txt in your home folder is a hexdump of a file that was compressed over and over. Peel it layer by layer, in a folder of your own under /tmp, until you reach plain text.',
    objectives: [
      { text: 'Make your own folder under /tmp and work from inside it', check: (q) => q.any((c) => c.name === 'mkdir' && c.status === 0 && (c.cwd === '/tmp' || c.argv.slice(1).some((a) => a.startsWith('/tmp/')))) && q.any((c) => c.cwd.startsWith('/tmp/')) },
      { text: 'Turn the hexdump back into real bytes with xxd -r', check: (q) => q.ran('xxd', { flags: 'r' }) },
      { text: 'Identify the layers with file (at least four times)', check: (q) => q.count('file') >= 4 },
      { text: 'Rename a layer to the suffix its tool expects (.gz or .bz2) with mv', check: (q) => q.ran('mv', { argv: (a) => a.some((x) => /\.(gz|bz2)$/.test(x)) }) },
      { text: 'Unpack a gzip layer', check: (q) => q.ran('gunzip') || q.ran('gzip', { flags: 'd' }) || q.ran('zcat') },
      { text: 'Unpack a bzip2 layer', check: (q) => q.ran('bunzip2') || q.ran('bzip2', { flags: 'd' }) || q.ran('bzcat') },
      { text: 'Unpack a tar archive with tar -xf', check: (q) => q.ran('tar', { flags: 'x' }) },
      { text: 'Reach the plain text and submit the password for bandit13', check: (q) => q.submitted() },
    ],
    hints: [
      'Start with `mkdir /tmp/myonion`, `cp data.txt /tmp/myonion`, `cd /tmp/myonion`, then `xxd -r data.txt data.bin`. After every step run `file` on the newest file.',
      'gzip: `mv data.bin data.gz` then `gunzip data.gz`. bzip2: `bunzip2 data` makes `data.out`. tar: `tar -xf data.out`. The names change each time, so read what file and ls tell you.',
      'There are eight layers: gzip, bzip2, tar, tar, bzip2, tar, gzip, text. When file finally says "ASCII text", `cat` it and submit the part after "is".',
    ],
    codex: ['tar', 'gzip', 'gunzip', 'bzip2', 'bunzip2', 'zcat', 'bzcat'],
    realWorld: { text: 'This is the real Bandit level 12 to 13. Do it on the OverTheWire server, in a folder from `mktemp -d`. Then redo it on Kali with a small onion you build yourself: `gzip`, `bzip2` and `tar -cf` a text file a few times and peel it with `file`.', bandit: [13] },
    journal: 'Describe your peeling loop in four short steps. How do you know which tool to use next?',
    solution: (s) => [
      'mkdir /tmp/onion', 'cp data.txt /tmp/onion', 'cd /tmp/onion',
      'xxd -r data.txt data.bin', 'file data.bin',
      'mv data.bin data.gz', 'gunzip data.gz', 'file data',
      'bunzip2 data', 'file data.out',
      'tar -xf data.out', 'file data5.bin',
      'tar -xf data5.bin', 'file data6.bin',
      'bunzip2 data6.bin', 'file data6.bin.out',
      'tar -xf data6.bin.out', 'file data8.bin',
      'mv data8.bin data8.gz', 'gunzip data8.gz', 'file data8', 'cat data8',
      `submit ${s.flags[0]}`,
    ],
  },

  {
    id: 'z7-5',
    title: 'Clockwork',
    xp: 80,
    panel: 'map',
    cron: { every: 15 },
    story: '"Machines do chores on their own," says Old Root, pointing at a clock tower that rings every minute. "The tireless clerk behind it is called cron. Learn its schedule and you learn what a machine does while nobody is watching."',
    setup(w) {
      const m = w.m;
      const flag0 = w.flag(32);
      const flag1 = w.flag(32);
      const dest = `/tmp/gear_${w.token(8)}`;
      m.addUser('tinker', { uid: 2001, password: w.token(12) });
      m.addUser('scribe', { uid: 2002, password: w.token(12) });
      m.file('/etc/tinker_secret', `${flag0}\n`, { owner: 'tinker', mode: 0o400 });
      m.file('/etc/scribe_secret', `${flag1}\n`, { owner: 'scribe', mode: 0o400 });
      m.file('/usr/local/bin/cronjob_tinker.sh', `#!/bin/bash\n# Leaves the tinker's secret where the clock keeper can fetch it\ncat /etc/tinker_secret > ${dest}\n`, { mode: 0o755 });
      m.file('/etc/cron.d/cronjob_tinker', '# The tinker winds the clock every minute\n* * * * * tinker /usr/local/bin/cronjob_tinker.sh &> /dev/null\n');
      m.file('/usr/local/bin/cronjob_scribe.sh', "#!/bin/bash\nmyname=$(whoami)\nmytarget=$(echo I am user $myname | md5sum | cut -d ' ' -f 1)\necho \"Copying the secret of $myname to /tmp/$mytarget\"\ncat /etc/scribe_secret > /tmp/$mytarget\n", { mode: 0o755 });
      m.file('/etc/cron.d/cronjob_scribe', '# The scribe copies his secret every minute\n* * * * * scribe /usr/local/bin/cronjob_scribe.sh &> /dev/null\n');
      w.state.dest = dest;
      w.state.hash = md5('I am user scribe\n');
    },
    teach: [
      {
        title: 'cron: the tireless clock',
        body: '**cron** wakes up every minute and runs whatever is due. A job is one line with five time fields and a command:\n\n```\nm   h   dom mon dow  command\n30  2   *   *   *    /home/me/backup.sh\n```\n\n- minute (0-59), hour (0-23), day of month, month, day of week (0-6, Sunday is 0)\n- `*` means every, `*/5` every fifth, `1,15` a list, `9-17` a range\n\nSo `30 2 * * *` runs every day at 02:30, and `* * * * *` runs every minute. In this realm one cron tick takes about 15 seconds and counts as one minute.',
        try: 'cat /etc/crontab',
        quiz: {
          q: 'When does the line */10 * * * * run?',
          options: ['Every 10 minutes', 'Once an hour, at minute 10', 'Every 10 hours'],
          answer: 0,
          explain: '*/10 in the minute field means every 10th minute: 0, 10, 20, 30, 40, 50.',
          why: { 1: 'That would be 10 * * * *, a fixed minute. The slash means "every Nth".', 2: 'The first field is minutes, not hours.' },
        },
      },
      {
        title: 'Your own crontab',
        body: 'Every user has a private crontab:\n\n- `crontab -l` lists your jobs\n- `crontab -e` edits them in nano (save with Ctrl+O, leave with Ctrl+X)\n- `crontab -r` deletes them all, with no question asked\n\nA user crontab has **no user field**, because the job runs as you:\n\n```\n*/5 * * * * date >> /home/recruit/clock.log\n```\n\nCron runs with a bare PATH, so use full paths in scripts and jobs.',
        try: 'crontab -l',
        quiz: {
          q: 'Which line runs a job every 5 minutes?',
          options: ['*/5 * * * * /home/me/job.sh', '5 * * * * /home/me/job.sh', '* * 5 * * /home/me/job.sh'],
          answer: 0,
          explain: '*/5 in the first field means every 5 minutes.',
          why: { 1: 'That runs once an hour, at minute 5.', 2: 'That runs every minute, but only on the 5th day of the month.' },
        },
      },
      {
        title: 'System jobs in /etc/cron.d',
        body: 'System jobs live in `/etc/crontab` and in files under `/etc/cron.d/`. They have **one extra field, the user** the job runs as:\n\n```\n* * * * * scribe /usr/local/bin/cronjob_scribe.sh\n```\n\nTo understand a job, read its line, then read the script it runs. Scripts often leave something behind, such as a file in /tmp.\n\n`&> /dev/null` at the end throws away the job\'s output.',
        try: 'ls /etc/cron.d',
        after: '**Hacker\'s note:** a root cron job that runs a script you can edit is a way to become root. `cat /etc/cron.d/*` is on every privilege-escalation checklist.',
        quiz: {
          q: 'How does a line in /etc/cron.d differ from one in crontab -e?',
          options: ['It has an extra field naming the user', 'It runs only once a day', 'It cannot use *'],
          answer: 0,
          explain: 'System files add the user after the five time fields. Personal crontabs run as their owner.',
          why: { 1: 'The time fields work the same way. Nothing limits it to once a day.', 2: 'The * works everywhere in cron.' },
        },
      },
      {
        title: 'Computing a file name',
        body: 'Scripts often build a file name with a command. This is Bandit 22 to 23:\n\n```\nmyname=$(whoami)\nmytarget=$(echo I am user $myname | md5sum | cut -d \' \' -f 1)\ncat /etc/secret > /tmp/$mytarget\n```\n\n`md5sum` turns text into a 32-character hash, and `cut -d \' \' -f 1` keeps only the hash. The trick: `whoami` is evaluated **when cron runs it**, as the job\'s user. To find the file, run the same recipe yourself with that user\'s name, not yours.',
        try: "echo I am user nobody | md5sum | cut -d ' ' -f 1",
        quiz: {
          q: 'The script runs from cron as scribe and uses $(whoami). You try the recipe as recruit. What happens?',
          options: ['You get the same hash', 'You get a different hash, so the wrong file name', 'The hash is always the same for everybody'],
          answer: 1,
          explain: 'The text "I am user recruit" hashes differently from "I am user scribe". Type the name the job runs as.',
          why: { 0: 'Different text means a different hash.', 2: 'A hash depends completely on the text you feed it.' },
        },
      },
    ],
    brief: 'Two clockwork clerks, the tinker and the scribe, leave their secrets in /tmp every tick. Work out where, and set a job of your own.',
    objectives: [
      { text: 'Read the tinker\'s job in /etc/cron.d and the script it runs', check: (q) => reads(q, /cronjob_tinker$/) && reads(q, /cronjob_tinker\.sh$/) },
      { text: 'Wait for the clock to tick, read the file the tinker\'s script leaves in /tmp, and submit its secret', check: (q) => q.got(0) },
      { text: 'Read the scribe\'s job and the script it runs', check: (q) => reads(q, /cronjob_scribe$/) && reads(q, /cronjob_scribe\.sh$/) },
      { text: 'Work out the scribe\'s file name with echo, md5sum and cut', check: (q) => q.pipeline('md5sum', 'cut') },
      { text: 'Read the scribe\'s file in /tmp and submit its secret', check: (q) => q.got(1) },
      { text: 'Use crontab -e to schedule a job that writes into ~/clock.log every minute, then list it with crontab -l', check: (q) => cronJobs(q.crontab('recruit')).some((l) => l.includes('clock.log')) && q.ran('crontab', { flags: 'l' }) },
      { text: 'Wait for your job to fire and read ~/clock.log', check: (q) => q.ran('cat', { argMatch: /clock\.log$/ }) },
    ],
    hints: [
      '`ls /etc/cron.d`, then `cat` each job file and the script named at the end of its line. The tinker\'s script shows the exact /tmp file it writes. Cron ticks about every 15 seconds.',
      'The scribe\'s script builds its file name from `whoami`. Run `echo I am user scribe | md5sum | cut -d \' \' -f 1` and `cat /tmp/` followed by that hash. For your own job use `crontab -e` and a line like `* * * * * date >> /home/recruit/clock.log`.',
      'After saving the crontab, check it with `crontab -l`, wait a few seconds for the next tick, then `cat ~/clock.log`. Submit each secret with `submit`.',
    ],
    codex: ['crontab'],
    realWorld: { text: 'On Kali, run `crontab -e`, add `* * * * * date >> ~/clock.log`, wait two minutes and `cat ~/clock.log`. Remove it afterwards with `crontab -r`. Then read the real Bandit pages 22 and 23 and do both levels.', bandit: [22, 23] },
    journal: 'Why does reading /etc/cron.d tell an attacker so much about a machine?',
    solution: (s) => [
      'ls /etc/cron.d',
      'cat /etc/cron.d/cronjob_tinker', 'cat /usr/local/bin/cronjob_tinker.sh',
      { cron: true },
      `cat ${s.dest}`, `submit ${s.flags[0]}`,
      'cat /etc/cron.d/cronjob_scribe', 'cat /usr/local/bin/cronjob_scribe.sh',
      "echo I am user scribe | md5sum | cut -d ' ' -f 1",
      `cat /tmp/${s.hash}`, `submit ${s.flags[1]}`,
      { cmd: 'crontab -e', edit: () => '* * * * * date >> /home/recruit/clock.log\n' },
      'crontab -l',
      { cron: true },
      'cat ~/clock.log',
    ],
  },

  {
    id: 'z7-boss',
    title: 'The Bandit King',
    xp: 250,
    panel: 'map',
    boss: { name: 'Bandit King', taunt: '"Another recruit with a shell and big dreams," the Bandit King sneers from his throne. "Walk my keep without a single map."' },
    story: 'At the end of the Remote Reaches stands the keep of the Bandit King. Every skill you have collected opens one door in his chain: hidden files, ssh, find, decoding, switching users, peeling archives. The crown flag waits at the end. Forgeries lie everywhere, and a wrong flag costs a heart.',
    setup(w) {
      const m = w.m;
      const pagePw = w.token(16);
      const stewardPw = w.token(24);
      const decoyPw = w.token(24);
      const flag = w.flag(32);
      const rumour = w.token(32);
      const forged = w.token(32);
      const duped = w.token(32);

      // Local clues
      m.file(`${H}/summons/scroll.txt`, 'By order of the Bandit King.\n\nPresent yourself at the keep: ssh page@throne -p 2222\nYour password is in this folder. Things that matter are rarely in plain sight.\n', o);
      m.file(`${H}/summons/.page_pass`, `${pagePw}\n`, o);
      m.file(`${H}/summons/old_summons.txt`, `Expired summons. Old password: ${w.token(16)}\n(Do not bother. It stopped working last winter.)\n`, o);
      m.file(`${H}/summons/crown_rumour.txt`, `A drunk guard swears the crown flag is ${rumour}.\nHe also swears he saw a dragon.\n`, o);
      m.dir(`${H}/summons`, o);

      // The keep
      const k = w.remote({ hostname: 'throne', ip: '10.7.0.99', sshPort: 2222, banner: '\n  THE KEEP OF THE BANDIT KING. Every step is watched.\n\n', motd: '\n  Welcome to the keep, page. Read your README.\n\n' });
      k.addUser('page', { uid: 12001, password: pagePw });
      k.addUser('steward', { uid: 12002, password: stewardPw });
      k.addUser('archivist', { uid: 12003 });

      const plain = (pw) => `The steward's password is ${pw}\n`;
      const real = `${btoa(plain(stewardPw))}\n`;
      const size = real.length;
      const ledger = '/var/lib/throne/vault/cellar/.ledger';
      const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n - 1) + '\n';
      k.file(ledger, real, { owner: 'archivist', group: 'page', mode: 0o640 });
      k.file('/var/lib/throne/vault/old.ledger', pad(btoa('Old ledger, last year. Nothing of use here.'), size + 7), { owner: 'archivist', group: 'page', mode: 0o640 });
      k.file('/opt/throne/forged.ledger', `${btoa(plain(decoyPw))}\n`, { owner: 'root', group: 'page', mode: 0o640 });
      k.file('/srv/throne/archive.ledger', `${btoa(plain(w.token(24)))}\n`, { owner: 'archivist', group: 'archivist', mode: 0o644 });
      k.file('/home/page/README', `The Bandit King sends his regards.\n\nTo reach the crown you must become the steward.\nThe steward's password is written in a ledger hidden somewhere in this kingdom.\nThe ledger:\n  - is owned by the user archivist\n  - belongs to the group page\n  - is exactly ${size} bytes long\nIt is written in base64. Decode it, then speak to the steward.\n`, { owner: 'page', mode: 0o644 });

      // The crown archive: bzip2 > tar > (gzip text with one unique line) + a forger's copy
      const t = w.now();
      const phrases = ['The gate opens at dawn', 'Trust no jester', 'Torches burn at night', 'The moat is cold', 'Taxes are due on Friday', 'Bread costs two coins', 'The drawbridge creaks', 'Wolves guard the east road', 'The cellar is locked', 'Feast on the seventh day', 'The bell rings twice', 'Spies hide in the stables', 'The well is deep', 'Candles are rationed', 'No dice in the barracks', 'The throne is not a chair', 'Dragons are bad for business', 'Keep your boots dry', 'The tower stairs are many', 'Never whistle at the king'];
      let lines = [];
      for (const p of phrases) lines.push(p, p);
      lines.push(`The crown flag is: ${duped}`, `The crown flag is: ${duped}`, `The crown flag is: ${flag}`);
      lines = w.shuffle(lines);
      const vault = gzipData(`${lines.join('\n')}\n`, 'vault', t);
      const entry = (name, data) => ({ name, type: '0', data, mode: 0o644, uid: 0, gid: 0, mtime: t, uname: 'root', gname: 'root' });
      const crown = bzipData(tarPack([entry('vault.bin', vault), entry('counterfeit.txt', `A forger's copy of the royal ledger.\nThe crown flag is: ${forged}\n`)]));
      k.file('/home/steward/crown.dat', crown, { owner: 'steward', mode: 0o640 });
      k.file('/home/steward/NOTE', 'The crown archive is crown.dat. It is wrapped in more than one layer.\nIn the royal ledger every line is written twice, except the one that matters.\n', { owner: 'steward', mode: 0o600 });

      w.state.pagePw = pagePw;
      w.state.stewardPw = stewardPw;
      w.state.ledger = ledger;
      w.state.size = size;
    },
    teach: [
      {
        title: 'Your toolkit',
        body: 'Each skill opens one door of the keep:\n\n- `ls -a` and `cat`: find a hidden file (Terminal Town)\n- `ssh user@host -p PORT`: enter the keep (Gateway)\n- `find / -user U -group G -size Nc 2>/dev/null`: hunt a file by its properties (Search Swamp)\n- `base64 -d`: decode text (Search Swamp)\n- `su USER`: become another user with their password (Permission Peaks)\n- `file`, `tar -xf`, `gunzip`, `bunzip2`: peel an archive (Onion)\n- `sort FILE | uniq -u`: the one line that appears only once (Pipe Works)\n\nForged flags are everywhere. Only the right one counts, and each wrong `submit` costs a heart.',
      },
    ],
    brief: 'Walk the chain from your summons to the crown. Every objective you complete strikes the Bandit King. Lose all three hearts and the keep resets.',
    objectives: [
      { text: 'Find the hidden password in your summons folder and read it', check: (q) => reads(q, /\.page_pass$/, 'quest') },
      { text: 'Enter the keep: ssh as page on port 2222', check: (q) => q.ran('ssh', { host: 'quest', argMatch: /^page@/ }) },
      { text: 'Hunt the hidden ledger with find (owner, group and exact size)', check: (q) => q.ran('find', { host: 'throne', anyStatus: true, argv: (a) => a.includes('-size') && (a.includes('-user') || a.includes('-group')) }) },
      { text: 'Decode the ledger with base64 -d', check: (q) => q.ran('base64', { host: 'throne', flags: 'd', long: { d: '--decode' } }) },
      { text: 'Become the steward with su and the decoded password', check: (q) => q.ran('su', { host: 'throne' }) },
      { text: 'Peel the crown archive down to plain text (tar and gunzip)', check: (q) => q.ran('tar', { host: 'throne', flags: 'x' }) && (q.ran('gunzip', { host: 'throne' }) || q.ran('gzip', { host: 'throne', flags: 'd' }) || q.ran('zcat', { host: 'throne' })) },
      { text: 'Pull out the one line that appears only once, with sort and uniq -u', check: (q) => q.ran('uniq', { host: 'throne', flags: 'u' }) },
      { text: 'Submit the true crown flag', check: (q) => q.submitted() },
    ],
    hints: [
      '`ls -a summons` shows a hidden file. Use its contents as the password for `ssh page@throne -p 2222`. Read the README in the page\'s home.',
      'The README gives the ledger\'s owner, group and size: `find / -user archivist -group page -size NNNc 2>/dev/null`. `base64 -d` decodes it, and the password goes to `su steward`.',
      'As steward: `tar -xf crown.dat`, `file vault.bin`, rename it to `vault.gz`, `gunzip vault.gz`, then `sort vault | uniq -u`. Submit the part after "The crown flag is:". The forged copies repeat or live in other files.',
    ],
    codex: [],
    realWorld: { text: 'You now hold the whole toolkit of OverTheWire Bandit levels 0 to 14. Play them for real in order. Keep a notes file with every password and the command that found it.', bandit: [6, 7, 9, 11, 13, 14] },
    journal: 'Which door of the keep was hardest, and which command opened it?',
    solution: (s) => [
      'cat summons/scroll.txt', 'ls -a summons', 'cat summons/.page_pass',
      { cmd: 'ssh page@throne -p 2222', answers: ['yes', s.pagePw] },
      'cat README',
      `find / -user archivist -group page -size ${s.size}c 2>/dev/null`,
      `base64 -d ${s.ledger}`,
      { cmd: 'su steward', answers: [s.stewardPw] },
      'cd',
      'tar -xf crown.dat', 'file vault.bin', 'mv vault.bin vault.gz', 'gunzip vault.gz',
      'sort vault | uniq -u',
      `submit ${s.flags[0]}`,
    ],
  },
];
