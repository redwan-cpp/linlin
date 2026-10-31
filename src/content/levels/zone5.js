// Zone 5: Permission Peaks. Users, groups, rwx, chmod/chown/chgrp, sudo/su, setuid/setgid/sticky, umask.
const H = '/home/recruit';

export default [
  {
    id: 'z5-1',
    title: 'Who Am I, Really?',
    xp: 70,
    panel: 'map',
    story: 'The Peaks begin at a gatehouse covered in ledgers. "Every climber on this mountain has a number," Old Root says, tapping a roster. "Learn to read the numbers, and you will always know who you, and everyone else, really are."',
    setup(w) {
      const uid = 1400 + Math.floor(w.rand() * 400);
      w.m.addUser('quartermaster', { uid, gecos: 'Keeper of the Armory,,,', makeHome: false });
      w.state.flags.push(String(uid));
    },
    teach: [
      {
        title: 'id: the numbers behind your name',
        body: 'Every account has a **UID** (user ID) and a **GID** (primary group ID). `id` prints yours, plus every group you belong to.\n\n```\n$ id\nuid=1000(recruit) gid=1000(recruit) groups=1000(recruit),100(users)\n```\n\nUID **0** always means **root**, the superuser, no matter what the account is named.',
        try: 'id',
      },
      {
        title: 'whoami vs id',
        body: '`whoami` only prints your username. `id` prints the full picture: UID, GID and every group. After `sudo` or an exploit, `id` is the first thing a hacker runs to see whether it worked.',
        try: 'whoami',
        quiz: {
          q: 'Which command tells you every group you belong to, not just your username?',
          options: ['whoami', 'id', 'pwd'],
          answer: 1,
          explain: 'id prints uid, gid and the full groups= list. whoami only prints the username.',
          why: { 0: 'whoami prints one word: your username.', 2: 'pwd has nothing to do with identity; it prints your current folder.' },
        },
      },
      {
        title: '/etc/passwd: the roster',
        body: 'Every account is one line in `/etc/passwd`, fields separated by `:`. Field 1 is the username, field 3 the UID, field 6 the home folder, field 7 the shell.\n\n`cut` pulls out just the columns you want:\n\n```\n$ cut -d: -f1,3,6,7 /etc/passwd\nroot:0:/root:/bin/bash\nrecruit:1000:/home/recruit:/bin/bash\n```',
        try: 'cut -d: -f1,3,6,7 /etc/passwd',
        quiz: {
          q: 'In the line recruit:x:1000:1000:Recruit,,,:/home/recruit:/bin/bash, which field is the UID?',
          options: ['Field 1', 'Field 3', 'Field 6'],
          answer: 1,
          explain: 'Fields: 1 name, 2 password placeholder, 3 UID, 4 GID, 5 comment, 6 home, 7 shell.',
          why: { 0: 'Field 1 is the username, recruit.', 2: 'Field 6 is the home folder, /home/recruit.' },
        },
      },
      {
        title: '/etc/group and id NAME',
        body: '`/etc/group` lists every group and its members. `groups` shows the groups **you** are in; `id NAME` or `groups NAME` asks about someone else.\n\n**Hacker\'s note:** scan the groups= line for power: `sudo` can run commands as root, `adm` can read logs, and `docker` or `lxd` are often root-equivalent.',
        try: ['groups', 'cat /etc/group'],
      },
    ],
    brief: 'Old Root wants to know you can read the roster. A new recruit called the quartermaster signed in today: find their number.',
    objectives: [
      { text: 'Ask the machine who you are with id', check: (q) => q.ran('id') },
      { text: 'List the groups you belong to', check: (q) => q.ran('groups') },
      { text: 'Read the username, UID, home and shell columns of /etc/passwd', check: (q) => q.ran('cut', { arg: '/etc/passwd' }) },
      { text: "Check the quartermaster's identity with id", check: (q) => q.ran('id', { arg: 'quartermaster' }) },
      { text: "Submit the quartermaster's UID", check: (q) => q.submitted() },
    ],
    hints: [
      '`id` shows your own numbers. `id NAME` shows anyone\'s. `groups` lists what you belong to.',
      '`cut -d: -f1,3,6,7 /etc/passwd` prints name, UID, home and shell for every account on the roster.',
      'Find the line for quartermaster (or run `id quartermaster`), note the number, then `submit NUMBER`.',
    ],
    codex: ['id', 'groups'],
    realWorld: { text: 'On Kali: `id`, then `cut -d: -f1,3,7 /etc/passwd` to see every account and its shell at a glance, and `getent group sudo` to see exactly who can sudo.' },
    journal: 'What is the real difference between whoami and id, and why would a hacker run id right after landing a shell?',
    solution: (s) => ['id', 'groups', 'cut -d: -f1,3,6,7 /etc/passwd', 'id quartermaster', `submit ${s.flags[0]}`],
  },

  {
    id: 'z5-2',
    title: 'Reading the Runes',
    xp: 60,
    panel: 'runes',
    story: 'A row of stone doors blocks the trail, each carved with strange symbols. "Those are runes," Old Root grins, "rwx runes. Learn to read them and no door on this mountain will confuse you again."',
    setup(w) {
      const m = w.m;
      const P = `${H}/peaks`;
      m.file(`${P}/open.txt`, 'Any hiker may read this trailpost.\n', { owner: 'recruit', mode: 0o644 });
      m.file(`${P}/locked.txt`, 'Old Root keeps this one to himself.\n', { mode: 0o600 });
      m.file(`${P}/secretdir/inside.txt`, 'You should not be able to see this line.\n', { mode: 0o644 });
      m.file(`${P}/noexec/inside.txt`, 'Listed, but out of reach.\n', { mode: 0o644 });
      m.file(`${P}/shareddir/team.txt`, 'Fellow climbers may read this logbook.\n', { group: 'users', mode: 0o640 });
      m.dir(P, { owner: 'recruit', mode: 0o755 });
      m.dir(`${P}/secretdir`, { mode: 0o700 });
      m.dir(`${P}/noexec`, { mode: 0o644 });
      m.dir(`${P}/shareddir`, { group: 'users', mode: 0o750 });
    },
    teach: [
      {
        title: 'ls -l: the permission string',
        body: 'Each line of `ls -l` starts with ten characters:\n\n```\n-rw-r--r--\n```\n\n- character 1: type (`-` file, `d` directory, `l` link)\n- next 3: **owner**\'s rwx\n- next 3: **group**\'s rwx\n- last 3: **others**\' rwx\n\n`r` read, `w` write, `x` execute. A `-` means that permission is missing.',
        try: 'ls -l peaks',
        visual: 'runes',
      },
      {
        title: 'For a folder, x means enter',
        body: 'On a **file**, x means "run this program". On a **directory**, the letters mean something else:\n\n- `r` on a directory: you may **list** the names inside (ls)\n- `x` on a directory: you may **enter it or reach files inside** (cd, cat, open)\n\nA folder can have one without the other. peaks/noexec has r but no x: `ls` works, but reaching anything inside it does not.',
        try: ['ls peaks/noexec', 'cat peaks/noexec/inside.txt'],
        quiz: {
          q: 'A directory is dr--r--r-- (readable, not executable, for everyone). What happens when you try to cat a file inside it?',
          options: ['It works fine, since you can read the directory', 'Permission denied, even though the file itself is readable', 'The file is silently deleted'],
          answer: 1,
          explain: 'Reaching anything inside a directory needs x on that directory, no matter what the file\'s own permissions say.',
        },
      },
      {
        title: 'Owner, group, others: three audiences',
        body: 'Linux checks the triplets in order and stops at the first one that applies to you:\n\n1. Are you the **owner**? Use the owner triplet.\n2. Are you in the file\'s **group**? Use the group triplet.\n3. Otherwise, use the **others** triplet.\n\npeaks/shareddir belongs to the group `users`, and you are a member, so its group triplet is the one that decides what you can do there.',
        try: 'ls -l peaks/shareddir',
        quiz: {
          q: 'Which letter lets you cd into a folder you do not own?',
          options: ['r', 'w', 'x'],
          answer: 2,
          explain: 'x on a directory is the "enter" permission, checked against whichever triplet (owner, group or others) applies to you.',
        },
      },
      {
        title: 'Locked tight: secretdir',
        body: 'peaks/secretdir is `drwx------`: only its owner has anything. No r, no x for you, so `ls` cannot even open it to list the names.\n\n**Hacker\'s note:** a folder with `--x` only (execute but not read) still lets you reach a file inside it *if you already know its exact name* — a common trick for web upload folders.',
        try: 'ls peaks/secretdir',
      },
    ],
    brief: 'Walk the Peaks and read what each door\'s runes allow, including the ones that refuse you.',
    objectives: [
      { text: 'Read peaks/open.txt, a sign anyone may read', check: (q) => q.ran(['cat', 'less', 'head', 'tail'], { arg: `${H}/peaks/open.txt` }) },
      { text: 'List peaks in long format to see every permission line', check: (q) => q.ran('ls', { flags: 'l', arg: `${H}/peaks` }) },
      { text: 'List peaks/noexec (it has read but no execute)', check: (q) => q.ran('ls', { arg: `${H}/peaks/noexec` }) },
      { text: 'Try to open peaks/noexec/inside.txt and see Linux refuse, even though the file itself is readable', check: (q) => q.any((c) => c.name === 'cat' && c.argv.some((a) => a.includes('noexec'))) },
      { text: 'Use your group membership to read peaks/shareddir/team.txt', check: (q) => q.ran('cat', { arg: `${H}/peaks/shareddir/team.txt` }) },
    ],
    hints: [
      '`ls -l peaks` shows a permission line for every entry: type, then three rwx triplets for owner, group, others.',
      'A directory needs x for you to enter or reach what is inside it, and only r to list the names. noexec has r but no x; secretdir has neither.',
      '`cat peaks/open.txt`, `ls -l peaks`, `ls peaks/noexec`, `cat peaks/noexec/inside.txt` (denied), then `cat peaks/shareddir/team.txt` (your group lets you in).',
    ],
    codex: [],
    realWorld: { text: 'On Kali, run `ls -ld /root /tmp /etc/shadow` and explain each permission string out loud before you move on.' },
    journal: 'Explain, in your own words, why a folder can be readable but not enterable, and what that means for the files inside it.',
    solution: ['cat peaks/open.txt', 'ls -l peaks', 'ls peaks/noexec', 'cat peaks/noexec/inside.txt', 'cat peaks/shareddir/team.txt'],
  },

  {
    id: 'z5-3',
    title: 'Changing the Runes',
    xp: 70,
    panel: 'runes',
    story: 'Old Root hands you a chisel shaped like the letters r, w and x. "Reading runes is one skill," he says. "Carving new ones is another. Carve carefully: a private key with loose runes is a key anyone can steal."',
    setup(w) {
      const m = w.m;
      const T = `${H}/tools`;
      m.file(`${T}/launch.sh`, '#!/bin/bash\necho "Supply drop inbound..."\n', { owner: 'recruit', mode: 0o644 });
      m.file(`${T}/notes.txt`, 'Base camp coordinates: do not lose this.\n', { owner: 'recruit', mode: 0o666 });
      m.file(`${T}/.climb_key`, 'This key lets you rope up the Peaks.\nGuard it like a password.\n', { owner: 'recruit', mode: 0o644 });
      m.dir(`${T}/vault`, { owner: 'recruit', mode: 0o777 });
      m.dir(T, { owner: 'recruit', mode: 0o755 });
    },
    teach: [
      {
        title: 'Octal: three digits, one per audience',
        body: 'Each permission is worth a number: **r=4, w=2, x=1**. Add them up per audience (owner, group, others) and you get one digit each.\n\n```\nrwxr-xr-x = 7 5 5   (owner: 4+2+1, group: 4+0+1, others: 4+0+1)\nrw-r--r-- = 6 4 4\nrw------- = 6 0 0\nrwx------ = 7 0 0\n```\n\n`chmod 755 file` sets ALL the bits at once, replacing whatever was there.',
        try: 'chmod 755 tools/launch.sh',
        visual: 'runes',
        quiz: {
          q: 'Which octal number means rw-r--r--?',
          options: ['644', '744', '600'],
          answer: 0,
          explain: 'Owner 6 (rw-), group 4 (r--), others 4 (r--) = 644.',
          why: { 1: '744 would give the owner execute too (rwxr--r--).', 2: '600 (rw-------) leaves group and others with nothing.' },
        },
      },
      {
        title: 'Symbolic mode: who, then how',
        body: 'Symbolic mode changes only what you name, leaving the rest alone:\n\n- **who**: `u` owner, `g` group, `o` others, `a` all\n- **op**: `+` add, `-` remove, `=` set exactly\n- **what**: any of `r`, `w`, `x`\n\n```\nu+x        add execute for the owner\ngo-w       remove write from group and others\na=r        everyone gets read-only, nothing else\nu=rwx,go=rx  owner gets everything, group and others get read+execute\n```',
        try: 'chmod go-w tools/notes.txt',
        quiz: {
          q: 'chmod u+x script.sh adds execute for...',
          options: ['everyone', 'the owner only', 'the group only'],
          answer: 1,
          explain: 'u means user, i.e. the owner. Only the owner triplet changes.',
        },
      },
      {
        title: 'Run what you can execute',
        body: 'Once a file has the x bit (and a `#!` line telling it which interpreter to use), run it with `./name`. Linux never searches your current folder automatically — that is a safety feature, so you must spell out the `./`.',
        try: './tools/launch.sh',
      },
      {
        title: 'Private keys must be locked down: chmod 600',
        body: 'ssh (and real-world good sense) refuse to trust a private key that anyone else can read. `chmod 600 keyfile` gives the owner read+write and nobody else anything — exactly what a secret file needs.\n\n**Hacker\'s note:** on real Kali, ssh will outright refuse an over-permissive key with "UNPROTECTED PRIVATE KEY FILE!" until you fix it.',
        try: 'chmod 600 tools/.climb_key',
      },
    ],
    brief: 'Carve the runes on four items in your toolkit the way a careful climber should.',
    objectives: [
      { text: 'Make tools/launch.sh executable', check: (q) => (q.mode(`${H}/tools/launch.sh`) & 0o111) !== 0 },
      { text: 'Run tools/launch.sh and see its message', check: (q) => q.output(/Supply drop inbound/) },
      { text: 'Remove write access for group and others on tools/notes.txt, leaving read alone', check: (q) => q.mode(`${H}/tools/notes.txt`) === 0o644 },
      { text: 'Lock tools/.climb_key down to exactly 600', check: (q) => q.mode(`${H}/tools/.climb_key`) === 0o600 },
      { text: 'Set tools/vault to exactly 700 using octal', check: (q) => q.mode(`${H}/tools/vault`) === 0o700 },
    ],
    hints: [
      '`chmod +x file` or `chmod 755 file` makes a file executable. Run it with `./file`.',
      '`chmod go-w file` removes write for group and others without touching read. `chmod 600 file` and `chmod 700 dir` set an exact octal number.',
      '`chmod +x tools/launch.sh && ./tools/launch.sh`, `chmod go-w tools/notes.txt`, `chmod 600 tools/.climb_key`, `chmod 700 tools/vault`.',
    ],
    codex: ['chmod'],
    realWorld: { text: 'On Kali: `chmod 600 ~/.ssh/id_rsa` before you ever use it with ssh -i, or ssh will refuse it outright.', bandit: [13] },
    journal: 'Why does ssh refuse to use a private key that other people can read?',
    solution: ['chmod +x tools/launch.sh', './tools/launch.sh', 'chmod go-w tools/notes.txt', 'chmod 600 tools/.climb_key', 'chmod 700 tools/vault'],
  },

  {
    id: 'z5-4',
    title: 'Owners and Groups',
    xp: 80,
    panel: 'runes',
    story: 'A supply outpost sits at the tree line, crates stacked under a faded sign: PROPERTY OF OLD ROOT. "Ownership is not the same as access," he says. "You can share what you own. You cannot simply take what someone else owns — not without my say."',
    setup(w) {
      const m = w.m;
      const O = `${H}/outpost`;
      m.addGroup('climbers', 2100, ['recruit']);
      m.file(`${O}/trailmap.txt`, 'Marked routes up the Peaks.\n', { owner: 'recruit', mode: 0o644 });
      m.file(`${O}/crate.txt`, 'Spare rope and a lantern.\n', { mode: 0o600 });
      m.dir(O, { owner: 'recruit', mode: 0o755 });
      m.sudoers.push({ who: 'recruit', runas: 'root', cmds: ['/usr/bin/chown'], nopasswd: true });
    },
    teach: [
      {
        title: 'chown: who owns this?',
        body: '`chown USER FILE` gives a file to USER. `chown USER:GROUP FILE` sets both the owner and the group at once. `ls -l` shows ownership without needing to open the file at all.',
        try: 'ls -l outpost',
        visual: 'runes',
      },
      {
        title: 'chgrp: just the group',
        body: '`chgrp GROUP FILE` changes a file\'s group. If you **own** the file and you **belong to** the target group, you can do this yourself, no special power needed.',
        try: ['groups', 'chgrp climbers outpost/trailmap.txt'],
        quiz: {
          q: 'You own notes.txt and you are a member of the group editors. Can you run chgrp editors notes.txt without sudo?',
          options: ['Yes: chgrp only checks that you own the file and belong to that group', 'No, only root can ever run chgrp', 'Only if notes.txt is already world-writable'],
          answer: 0,
          explain: 'chgrp allows the owner to move a file into any group they already belong to.',
        },
      },
      {
        title: 'Only root can give a file away',
        body: 'Changing a file\'s **owner** is different: Linux only lets **root** do it, even for the file\'s current owner. This stops people from dumping files on each other to dodge disk quotas.',
        try: 'chown recruit outpost/crate.txt',
        quiz: {
          q: "Why can't a normal user just chown a file to themselves, even one they are already using?",
          options: ['Linux has no such restriction', "Changing ownership is reserved for root, so users can't dodge disk quotas by handing files to each other", 'chown only works on directories'],
          answer: 1,
          explain: "Only root may reassign a file's owner. Groups are more relaxed: the owner can regroup a file into any group they belong to.",
        },
      },
      {
        title: 'sudo for exactly one command',
        body: 'Old Root scoped your sudo rights to exactly one program: chown. `sudo -l` shows what you are allowed to run. You will study sudo properly in the next lesson — for now, know that it lets you borrow root\'s power for a single command.',
        try: 'sudo -l',
      },
    ],
    brief: 'Sort out the outpost: share the trailmap with your fellow climbers, then claim the crate that is rightfully yours.',
    objectives: [
      { text: 'Check who owns outpost/crate.txt before you touch it', check: (q) => q.ran('ls', { flags: 'l', arg: `${H}/outpost` }) },
      { text: 'Give outpost/trailmap.txt to the climbers group with chgrp', check: (q) => q.group(`${H}/outpost/trailmap.txt`) === 'climbers' },
      { text: 'Try to take crate.txt for yourself without sudo, and watch Linux refuse', check: (q) => q.any((c) => c.name === 'chown' && c.status !== 0 && c.argv.some((a) => a.includes('crate.txt'))) },
      { text: 'Use sudo to hand crate.txt to yourself', check: (q) => q.owner(`${H}/outpost/crate.txt`) === 'recruit' },
      { text: 'Prove it worked: read crate.txt now that you own it', check: (q) => q.ran('cat', { arg: `${H}/outpost/crate.txt` }) },
    ],
    hints: [
      '`ls -l` shows owner and group without needing to read a file. `chgrp climbers trailmap.txt` works because you own it and belong to that group.',
      'A plain `chown recruit outpost/crate.txt` fails: Operation not permitted. Only root can hand a file to someone else.',
      '`sudo chown recruit outpost/crate.txt` (your sudo rule needs no password for chown), then `cat outpost/crate.txt` to prove it is yours.',
    ],
    codex: ['chown', 'chgrp'],
    realWorld: { text: 'On Kali: `ls -l /etc/shadow` to see root:shadow ownership, then on a test file in your own lab folder, `sudo chown $(whoami) somefile` to watch the prompt and the result.' },
    journal: "Why does Linux let you change a file's group yourself, but never its owner?",
    solution: ['ls -l outpost', 'chgrp climbers outpost/trailmap.txt', 'chown recruit outpost/crate.txt', 'sudo chown recruit outpost/crate.txt', 'cat outpost/crate.txt'],
  },

  {
    id: 'z5-5',
    title: 'Words of Power',
    xp: 90,
    panel: 'map',
    story: 'A watchtower looms over the Peaks. "Two words of power open root\'s doors," Old Root says. "sudo, which borrows my power for a moment, and su, which lets you become someone else entirely. Use both wisely."',
    setup(w) {
      const m = w.m;
      const pw = w.token(10);
      m.file(`${H}/watchtower/orders.txt`, `Nightwatch orders:\nKeeper's gate-word tonight is "${pw}".\nDo not write it down twice.\n`, { owner: 'recruit', mode: 0o644 });
      m.dir(`${H}/watchtower`, { owner: 'recruit', mode: 0o755 });
      m.addUser('keeper', { uid: 1500 + Math.floor(w.rand() * 300), password: pw, gecos: 'Tower Keeper,,,' });
      m.file('/home/keeper/duty-log.txt', 'Night 14: quiet. Night 15: quiet. Night 16: a shadow passed the gate.\n', { owner: 'keeper', mode: 0o640 });
      m.sudoers.push({ who: 'recruit', runas: 'root', cmds: ['/usr/bin/cat /etc/shadow'] });
      w.state.keeperPw = pw;
    },
    teach: [
      {
        title: '/etc/shadow: where the hashes sleep',
        body: 'Passwords are never stored in plain text. `/etc/shadow` holds the scrambled hashes, and it is `640`, owned by `root:shadow` — unreadable to anyone outside that group. Try it and watch Linux say no.',
        try: 'cat /etc/shadow',
        quiz: {
          q: 'What does the 640 permission on /etc/shadow mean for an ordinary user?',
          options: ['You can read it like any file', 'You cannot read it: only root, and members of the shadow group, can', 'You can write to it but not read it'],
          answer: 1,
          explain: '640 is rw-r-----: owner (root) can read and write, the shadow group can read, everyone else gets nothing.',
        },
      },
      {
        title: 'sudo: borrow root\'s power, briefly',
        body: '`sudo COMMAND` runs one command as root — but only if `/etc/sudoers` allows it. It asks for **your own** password, not root\'s, and remembers it for a few minutes so you are not asked every single time.',
        try: 'sudo cat /etc/shadow',
      },
      {
        title: 'sudo -l: know your powers before you need them',
        body: '`sudo -l` lists exactly what you are allowed to run, and as whom. Always run this first on any box: it takes seconds and tells you your entire plan.',
        try: 'sudo -l',
      },
      {
        title: 'su: become someone else entirely',
        body: '`su NAME` switches your whole identity to NAME — but it asks for **NAME\'s** password, not yours. `su -` also moves you into their home folder. `exit` climbs back out to whoever you were before.',
        quiz: {
          q: 'Which statement is true?',
          options: ["sudo needs the target account's password; su needs yours", "su needs the target account's password; sudo needs yours", 'Neither one ever asks for a password'],
          answer: 1,
          explain: 'sudo asks for your own password (checked against the sudoers rules). su asks for the password of the account you are switching to.',
        },
      },
      {
        title: 'exit: climb back out',
        body: 'Every su, sudo -i or bash you open is a new shell stacked on top of the last one. `exit` closes the top one and drops you back to where you were — your own prompt, your own powers.',
      },
    ],
    brief: 'The Keeper of the tower left orders lying around. Use sudo for the forbidden scroll, then borrow the Keeper\'s own words of power.',
    objectives: [
      { text: 'Try to read /etc/shadow without sudo and see Linux refuse', check: (q) => q.any((c) => c.name === 'cat' && c.status !== 0 && c.argv.some((a) => /shadow/.test(a))) },
      { text: 'Check exactly what you are allowed to run with sudo -l', check: (q) => q.ran('sudo', { flags: 'l' }) },
      { text: "Use sudo to read /etc/shadow, Old Root's forbidden scroll", check: (q) => q.ran('cat', { via: 'sudo', arg: '/etc/shadow' }) },
      { text: 'Find the gate-word and su into the keeper account', check: (q) => q.ran('su', { arg: 'keeper' }) },
      { text: "Read the keeper's duty-log, then exit back to yourself", check: (q) => q.ran('cat', { arg: '/home/keeper/duty-log.txt' }) && q.user() === 'recruit' },
    ],
    hints: [
      '`cat /etc/shadow` alone is denied. `sudo -l` shows exactly what Old Root allows you to run with sudo.',
      '`sudo cat /etc/shadow` asks for YOUR password (quest). The keeper\'s gate-word is hidden in watchtower/orders.txt.',
      '`cat watchtower/orders.txt`, then `su keeper` with that word, `cat /home/keeper/duty-log.txt`, then `exit` to come back as recruit.',
    ],
    codex: ['sudo', 'su'],
    realWorld: { text: 'On Kali: run `sudo -l` the moment you land on any box. If it lists anything at all, check every entry against gtfobins.github.io before you do anything else.' },
    journal: 'What is the real difference between sudo and su, and when would you reach for each?',
    solution: (s) => ['cat /etc/shadow', { cmd: 'sudo -l', answers: ['quest'] }, 'sudo cat /etc/shadow', 'cat watchtower/orders.txt', { cmd: 'su keeper', answers: [s.keeperPw] }, 'cat /home/keeper/duty-log.txt', 'exit'],
  },

  {
    id: 'z5-6',
    title: 'Special Runes',
    xp: 80,
    panel: 'runes',
    story: 'At the tower\'s armory, Old Root points out three runes you have not met yet: `s`, `s` again, and `t`. "Setuid, setgid, sticky," he says. "Small letters, enormous consequences. Learn to spot them."',
    setup(w) {
      const m = w.m;
      const T = `${H}/tower`;
      m.addGroup('nightwatch', 2200, ['recruit']);
      m.binary('whoami-root', { dir: T, mode: 0o4755, impl: 'whoami' });
      m.dir(`${T}/shared`, { owner: 'recruit', group: 'nightwatch', mode: 0o770 });
      m.dir(T, { owner: 'recruit', mode: 0o755 });
    },
    teach: [
      {
        title: 'setuid: borrow the owner\'s identity',
        body: 'A program with the **setuid** bit runs as its **owner**, no matter who launches it. `ls -l` shows it as an `s` where the owner\'s `x` would be:\n\n```\n-rwsr-xr-x 1 root root  whoami-root\n```\n\nAnyone who runs that program becomes root for as long as it runs.',
        try: ['ls -l tower/whoami-root', './tower/whoami-root'],
        visual: 'runes',
        quiz: {
          q: 'ls -l shows -rwsr-xr-x on a program owned by root. What happens when any user runs it?',
          options: ['It runs as that user, like normal', "It runs with root's power for as long as it is running", 'It refuses to run for non-root users'],
          answer: 1,
          explain: 'setuid makes the program act as its owner (root here), not as whoever launched it.',
        },
      },
      {
        title: 'Hunt them down: find -perm -4000',
        body: '`-perm -4000` means "the setuid bit is set". Run this on any new box and read every result carefully:\n\n```\nfind / -perm -4000 2>/dev/null\n```',
        try: 'find / -perm -4000 2>/dev/null',
        after: "**Hacker's note:** every setuid binary is a lead. GTFOBins (gtfobins.github.io) lists which ones let you read files or spawn a shell as their owner. This Zone's boss is beaten exactly this way.",
      },
      {
        title: 'setgid and sticky: the other two special runes',
        body: '- **setgid** (`g+s`) on a shared folder makes new files inside inherit the *folder\'s* group, not the creator\'s — handy for a team drop-box.\n- **sticky** (`+t`, shown as `t` in the others\' x slot) on a folder means only the **owner of a file** (or the folder\'s owner) may delete it, even if the folder is writable by everyone. `/tmp` always has it.',
        try: 'ls -ld /tmp',
        quiz: {
          q: 'Why does /tmp need the sticky bit, given that it is already rwxrwxrwx?',
          options: ["Without it, write access to /tmp would let anyone delete or rename anyone else's files there", 'It makes /tmp load faster', 'It hides /tmp from ls'],
          answer: 0,
          explain: 'Sticky restricts deletion to the owner, so a world-writable folder like /tmp does not turn into a free-for-all.',
        },
      },
      {
        title: 'umask: your permission thermostat',
        body: '`umask` sets which permission bits get **removed** from every new file and folder you create. The default, `022`, strips group and other write: new files land at `644`, new folders at `755`.\n\n`umask 077` makes everything you create private to you alone from the start.',
        try: ['umask', 'umask 077'],
      },
    ],
    brief: 'Learn the three special runes, then lock down your own tower before you leave it.',
    objectives: [
      { text: 'Find every setuid program on this machine', check: (q) => q.line(/-perm\s*-4000/) },
      { text: "Spot the s in tower/whoami-root's permissions with ls -l", check: (q) => q.ran('ls', { flags: 'l', arg: `${H}/tower/whoami-root` }) },
      { text: 'Run tower/whoami-root and see it answer as root, not you', check: (q) => q.any((c) => c.argv[0] && c.argv[0].includes('whoami-root')) && q.output(/root/) },
      { text: 'Set the setgid bit on tower/shared so the whole watch can manage it as a team', check: (q) => (q.mode(`${H}/tower/shared`) & 0o2000) !== 0 },
      { text: 'Check your current umask', check: (q) => q.ran('umask', { noArgs: true }) },
      { text: 'Tighten your umask to 077, then create tower/priv.txt and confirm it is private', check: (q) => q.mode(`${H}/tower/priv.txt`) === 0o600 },
    ],
    hints: [
      '`find / -perm -4000 2>/dev/null` lists every setuid program. `ls -l` on one shows an s where x would be.',
      'Running a setuid program makes it act as its owner the whole time it runs. `chmod 2770` (or `chmod g+s`) sets setgid on a directory.',
      '`find / -perm -4000 2>/dev/null`, `ls -l tower/whoami-root`, `./tower/whoami-root`, `chmod 2770 tower/shared`, then `umask` followed by `umask 077` and `touch tower/priv.txt`.',
    ],
    codex: ['umask'],
    realWorld: { text: 'On Kali: `find / -perm -4000 2>/dev/null` and check every single result against gtfobins.github.io. `umask` there usually still shows 0022.' },
    journal: 'Why is a setuid root binary dangerous if an attacker can control what it does once it runs?',
    solution: ['find / -perm -4000 2>/dev/null', 'ls -l tower/whoami-root', './tower/whoami-root', 'chmod 2770 tower/shared', 'umask', 'umask 077', 'touch tower/priv.txt'],
  },

  {
    id: 'z5-boss',
    title: 'Vault Keeper',
    xp: 200,
    panel: 'runes',
    boss: { name: 'Vault Keeper', taunt: '"This vault has stood sealed since before you could spell sudo," it growls, arms folded over a strongbox marked ROOT ONLY.' },
    story: 'At the summit, the Vault Keeper guards a strongbox bolted into the mountain itself: /root/vault.txt, readable by root and no one else. Everything you have learned in the Peaks leads to this door. Beware: a wrong flag costs a heart.',
    setup(w) {
      const m = w.m;
      const flag = w.flag(20);
      m.file('/root/vault.txt', `VAULT FLAG: ${flag}\n`, { mode: 0o600 });
      m.file('/root/vault_old.txt', `VAULT FLAG: ${w.token(20)}\n`, { mode: 0o600 });
      m.file('/usr/local/bin/patrol.sh', '#!/bin/bash\necho "Patrol complete."\n', { mode: 0o777 });
      m.binary('find', { dir: '/usr/local/bin', mode: 0o4755, impl: 'find' });
    },
    teach: [
      {
        title: 'Your toolkit',
        body: '- `find / -perm -4000 2>/dev/null`: hunt for setuid programs\n- A setuid **find** lets you spawn a privileged shell: `find . -exec /bin/sh -p ; -quit` (escape the semicolon so bash does not eat it: `\\;`)\n- `-p` keeps the privilege. Without it, sh drops straight back to you.\n- `cat` as root can read anything, including everything under /root\n- `chmod` fixes a permission mistake once you have the power to\n\nMore than one file in /root looks like the vault. Read before you submit — a wrong flag costs a heart.',
      },
    ],
    brief: 'Enumerate your way to root, read the real vault, and lock the one thing on this mountain still wide open.',
    objectives: [
      { text: 'Enumerate: find the setuid programs on this machine', check: (q) => q.line(/-perm\s*-4000/) },
      { text: 'Escalate: become root', check: (q) => q.euid() === 0 || q.user() === 'root' },
      { text: 'Read the vault', check: (q) => q.ran('cat', { arg: '/root/vault.txt' }) },
      { text: 'Submit the true flag', check: (q) => q.submitted() },
      { text: 'Lock down /usr/local/bin/patrol.sh: anyone can currently rewrite it', check: (q) => (q.mode('/usr/local/bin/patrol.sh') & 0o022) === 0 },
    ],
    hints: [
      '`find / -perm -4000 2>/dev/null` lists setuid programs. One of them is not supposed to be there.',
      'A setuid find lets you launch a privileged shell: `find . -exec /bin/sh -p \\; -quit`. Without -p, the shell drops the privilege immediately.',
      '`find . -exec /bin/sh -p \\; -quit`, then `cat /root/vault.txt` and submit the real flag (vault_old.txt is a decoy). Finish with `chmod 755 /usr/local/bin/patrol.sh`.',
    ],
    codex: [],
    realWorld: { text: 'This is the single most common Linux privilege-escalation path in the wild: enumerate setuid binaries and sudo rules, then check each one against gtfobins.github.io. Try it for real on a deliberately vulnerable VM once you have Kali running.' },
    journal: 'Which single command would you run first on an unfamiliar Linux box to look for a path to root, and why?',
    solution: (s) => ['find / -perm -4000 2>/dev/null', 'find . -exec /bin/sh -p \\; -quit', 'cat /root/vault.txt', `submit ${s.flags[0]}`, 'chmod 755 /usr/local/bin/patrol.sh', 'exit'],
  },
];
