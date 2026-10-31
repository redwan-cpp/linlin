// Zone 2: File Forest. Create, copy, move, delete, odd names, wildcards, editing, links.
const H = '/home/recruit';
const o = { owner: 'recruit' };
const posCount = (a) => a.slice(1).filter((x) => !x.startsWith('-')).length;

export default [
  {
    id: 'z2-1',
    title: 'Planting Seeds',
    xp: 60,
    panel: 'map',
    story: 'You enter the File Forest, where everything grows from nothing. "Make your camp," says Old Root. "A hacker who cannot create files cannot leave a mark."',
    teach: [
      {
        title: 'touch: create an empty file',
        body: '`touch notes.txt` creates an empty file (or just updates the timestamp of one that already exists). It takes many names at once:\n\n```\ntouch a.txt b.txt c.txt\n```',
        try: 'touch hello.txt',
        visual: 'map',
      },
      {
        title: 'mkdir: make a folder',
        body: '`mkdir camp` creates a folder. To create a whole path in one go, add `-p` (parents):\n\n```\nmkdir -p camp/supplies/food\n```\n\nWithout `-p`, mkdir refuses when `camp/supplies` does not exist yet.',
        try: 'mkdir -p demo/one/two',
        quiz: {
          q: 'mkdir a/b/c fails because a does not exist. What fixes it?',
          options: ['mkdir -p a/b/c', 'touch a/b/c', 'mkdir --force a/b/c'],
          answer: 0,
          explain: '-p creates every missing parent folder along the way.',
          why: { 1: 'touch makes files, and it also needs the folders to exist.', 2: 'mkdir has no --force option.' },
        },
      },
      {
        title: 'Write into a file: echo and >',
        body: '`echo text > file` writes the text into a file, **replacing** whatever was there. `>>` adds to the end instead.\n\nYou will master this in the Pipe Works. For now it is the quickest way to write a note.',
        try: 'echo "First note" > hello.txt',
      },
    ],
    brief: 'Build your forest camp exactly as Old Root sketched it.',
    objectives: [
      { text: 'Create a folder named camp in your home', check: (q) => q.isDir(`${H}/camp`) },
      { text: 'Create the empty file camp/tent.txt', check: (q) => q.isFile(`${H}/camp/tent.txt`) },
      { text: 'Create camp/supplies/food with a single command', check: (q) => q.isDir(`${H}/camp/supplies/food`) && q.ran('mkdir', { flags: 'p' }) },
      { text: 'Create rope, torch and map inside camp with one touch command', check: (q) => ['rope', 'torch', 'map'].every((f) => q.exists(`${H}/camp/${f}`)) && q.ran('touch', { argv: (a) => posCount(a) >= 3 }) },
      { text: 'Write the words "camp ready" into camp/log.txt', check: (q) => (q.read(`${H}/camp/log.txt`) || '').toLowerCase().includes('camp ready') },
    ],
    hints: [
      '`mkdir camp`, then `touch camp/tent.txt`.',
      '`mkdir -p camp/supplies/food` makes every missing folder at once. `touch` takes several names: `touch camp/rope camp/torch camp/map`.',
      '`echo "camp ready" > camp/log.txt`',
    ],
    codex: ['touch', 'mkdir'],
    realWorld: { text: 'On Kali, make a practice area: `mkdir -p ~/lab/zone2 && cd ~/lab/zone2`. Repeat each quest of this zone there.' },
    journal: 'When do you need mkdir -p?',
    solution: ['mkdir camp', 'touch camp/tent.txt', 'mkdir -p camp/supplies/food', 'touch camp/rope camp/torch camp/map', 'echo "camp ready" > camp/log.txt'],
  },

  {
    id: 'z2-2',
    title: 'Copy & Carry',
    xp: 60,
    panel: 'map',
    story: 'A trader left supplies scattered across the forest floor. "Pack what matters," Old Root says, "and label it properly."',
    setup(w) {
      const m = w.m;
      m.file(`${H}/forest/herbs.txt`, 'Sage, thyme, a little root.\n', o);
      m.file(`${H}/forest/map.txt`, 'North: river. East: the Swamp.\n', o);
      for (const d of [1, 2, 3]) m.file(`${H}/forest/logs/day${d}.log`, `Day ${d}: walked, foraged, slept.\n`, o);
      m.dir(`${H}/forest/backpack`, o);
      m.dir(`${H}/forest/logs`, o);
      m.dir(`${H}/forest`, o);
    },
    teach: [
      {
        title: 'cp: copy',
        body: '`cp SOURCE DEST` copies a file. If DEST is a folder, the copy goes inside it and keeps its name:\n\n```\ncp herbs.txt backpack/\n```\n\nThe original stays where it was.',
        try: 'cp forest/herbs.txt forest/herbs-copy.txt',
        visual: 'map',
      },
      {
        title: 'cp -r: copy whole folders',
        body: 'Folders need `-r` (recursive). Without it, cp refuses with "-r not specified; omitting directory".',
        quiz: {
          q: 'Which command copies the folder logs, and everything inside it, into backpack?',
          options: ['cp logs backpack', 'cp -r logs backpack/', 'mv logs backpack'],
          answer: 1,
          explain: '-r copies the folder and all of its contents.',
          why: { 0: 'Without -r, cp skips folders.', 2: 'mv moves it, so the original would be gone.' },
        },
      },
      {
        title: 'mv: move and rename',
        body: '`mv` moves a file. Moving it to a new name in the same folder **renames** it:\n\n```\nmv map.txt old-map.txt\n```\n\nmv works on folders without needing -r.',
      },
    ],
    brief: 'Pack the backpack inside the forest folder. Old Root will inspect it.',
    objectives: [
      { text: 'Copy herbs.txt into the backpack (keep the original)', check: (q) => q.isFile(`${H}/forest/backpack/herbs.txt`) && q.isFile(`${H}/forest/herbs.txt`) },
      { text: 'Copy the whole logs folder into the backpack', check: (q) => q.isFile(`${H}/forest/backpack/logs/day3.log`) && q.isDir(`${H}/forest/logs`) },
      { text: 'Rename map.txt to old-map.txt', check: (q) => !q.exists(`${H}/forest/map.txt`) && (q.isFile(`${H}/forest/old-map.txt`) || q.isFile(`${H}/forest/backpack/old-map.txt`)) },
      { text: 'Move old-map.txt into the backpack', check: (q) => q.isFile(`${H}/forest/backpack/old-map.txt`) && !q.exists(`${H}/forest/old-map.txt`) },
    ],
    hints: [
      'Work inside the forest folder: `cd forest`.',
      '`cp herbs.txt backpack/` and `cp -r logs backpack/`.',
      '`mv map.txt old-map.txt`, then `mv old-map.txt backpack/`.',
    ],
    codex: ['cp', 'mv'],
    realWorld: { text: 'On Kali: `cp /etc/hosts ~/lab/zone2/`, then rename the copy with mv. Notice cp overwrites without asking unless you add -i.' },
    journal: 'What is the difference between cp and mv?',
    solution: ['cd forest', 'cp herbs.txt backpack/', 'cp -r logs backpack/', 'mv map.txt old-map.txt', 'mv old-map.txt backpack/'],
  },

  {
    id: 'z2-3',
    title: 'Burn It Down',
    xp: 60,
    panel: 'map',
    story: '"Clearing land is part of farming," says Old Root, "but in Linux there is no undo. Measure twice, delete once."',
    setup(w) {
      const m = w.m;
      const C = `${H}/clearing`;
      m.file(`${C}/junk.txt`, 'useless\n', o);
      m.file(`${C}/trash1.tmp`, 'tmp\n', o);
      m.file(`${C}/trash2.tmp`, 'tmp\n', o);
      m.file(`${C}/treasure.txt`, 'Do not burn me.\n', o);
      m.dir(`${C}/empty-hut`, o);
      m.file(`${C}/old-camp/ashes.txt`, 'cold\n', o);
      m.file(`${C}/old-camp/tent/pole.txt`, 'broken\n', o);
      m.dir(`${C}/old-camp/tent`, o);
      m.dir(`${C}/old-camp`, o);
      m.dir(C, o);
    },
    teach: [
      {
        title: 'rm removes files, forever',
        body: '`rm junk.txt` deletes a file. There is **no trash can**: it is gone.\n\n`rm -i` asks before each deletion. Use it whenever you are unsure.',
        visual: 'map',
      },
      {
        title: 'Folders: rmdir and rm -r',
        body: '- `rmdir dir` removes a folder **only if it is empty**. Safe.\n- `rm -r dir` removes a folder and **everything inside it**.\n\n`rm -rf` (force) never asks and never complains. It is the most dangerous command you will learn.',
        quiz: {
          q: 'You want to delete the folder old-camp and everything in it. Which command?',
          options: ['rmdir old-camp', 'rm old-camp', 'rm -r old-camp'],
          answer: 2,
          explain: '-r tells rm to go into the folder and delete everything.',
          why: { 0: 'rmdir only removes empty folders.', 1: 'Without -r, rm refuses to delete a folder.' },
        },
      },
      {
        title: 'Look before you delete',
        body: 'Before you delete with a pattern, run `ls` with the same pattern:\n\n```\nls *.tmp     # see what matches\nrm *.tmp     # then delete\n```\n\nThe `*` is a wildcard. You will master it in a later quest.',
      },
    ],
    brief: 'Clear the land, but whatever you do, keep treasure.txt. If you delete it by mistake, use Restart world.',
    objectives: [
      { text: 'Delete junk.txt', check: (q) => !q.exists(`${H}/clearing/junk.txt`) },
      { text: 'Remove the empty folder empty-hut with rmdir', check: (q) => !q.exists(`${H}/clearing/empty-hut`) && q.ran('rmdir') },
      { text: 'Remove old-camp and everything inside it', check: (q) => !q.exists(`${H}/clearing/old-camp`) },
      { text: 'Delete both .tmp files', check: (q) => !q.exists(`${H}/clearing/trash1.tmp`) && !q.exists(`${H}/clearing/trash2.tmp`) },
      {
        text: 'Finish the clearing with treasure.txt still safe',
        check: (q) => q.isFile(`${H}/clearing/treasure.txt`) && ['junk.txt', 'empty-hut', 'old-camp', 'trash1.tmp', 'trash2.tmp'].every((f) => !q.exists(`${H}/clearing/${f}`)),
      },
    ],
    hints: [
      '`cd clearing`, then `ls` to see what is there.',
      '`rm junk.txt`, `rmdir empty-hut`, `rm -r old-camp`.',
      '`rm trash1.tmp trash2.tmp` (or `rm *.tmp`). Leave treasure.txt alone.',
    ],
    codex: ['rm', 'rmdir'],
    realWorld: { text: 'On Kali, practise inside ~/lab only. Try `rm -i` on a test file and answer n to see the safety prompt.' },
    journal: 'Why is rm -rf dangerous, and how do you protect yourself?',
    solution: ['cd clearing', 'rm junk.txt', 'rmdir empty-hut', 'rm -r old-camp', 'rm trash1.tmp trash2.tmp'],
  },

  {
    id: 'z2-4',
    title: 'Strange Names',
    xp: 70,
    panel: 'map',
    story: 'Deep in the forest, someone named files to confuse travellers: dashes, spaces, look-alike options. These exact tricks guard the first OverTheWire Bandit levels.',
    setup(w) {
      const m = w.m;
      const a = w.token(24);
      const b = w.token(24);
      m.file(`${H}/oddities/-`, `${a}\n`, o);
      m.file(`${H}/oddities/spaces in this filename`, `${b}\n`, o);
      m.file(`${H}/oddities/--help`, 'Ha! Fooled you. This file is not the help text.\n', o);
      m.file(`${H}/oddities/readme`, 'Two flags hide here: one in the file named -, one in the file whose name has spaces.\n', o);
      m.dir(`${H}/oddities`, o);
      w.state.flags.push(a, b);
    },
    teach: [
      {
        title: 'Spaces split arguments',
        body: 'The shell splits your command at spaces. `cat my file` means two files: `my` and `file`. To keep a name together:\n\n- quotes: `cat "my file"` or `cat \'my file\'`\n- a backslash before the space: `cat my\\ file`\n- Tab completion, which adds the backslashes for you',
        quiz: {
          q: 'How do you read a file named "secret notes"?',
          options: ['cat secret notes', 'cat "secret notes"', 'cat secret-notes'],
          answer: 1,
          explain: 'The quotes make the shell pass the whole name as one argument.',
          why: { 0: 'That asks cat for two files, "secret" and "notes".', 2: 'That is a different name entirely.' },
        },
      },
      {
        title: 'A file named -',
        body: 'Many commands treat `-` as "read from standard input" (the keyboard). So `cat -` just waits for you to type. Press Ctrl+C to escape.\n\nTo mean the **file** called `-`, give it a path: `cat ./-`. The `./` means "the thing called - in this folder".',
      },
      {
        title: 'Names that look like options',
        body: 'A file called `--help` or `-rf` looks like an option to most commands. Two fixes:\n\n- `cat ./--help`\n- `cat -- --help`: a lone `--` means "no more options after this point"',
      },
    ],
    brief: 'Read the two hidden flags in the oddities folder, then leave a note of your own.',
    objectives: [
      { text: 'Read the file named - and submit its flag', check: (q) => q.got(0) },
      { text: 'Read the file whose name has spaces and submit its flag', check: (q) => q.got(1) },
      { text: 'Create a file named my notes.txt (with the space) in oddities', check: (q) => q.isFile(`${H}/oddities/my notes.txt`) },
    ],
    hints: [
      '`cd oddities`, then `ls`. Names with spaces show up in quotes.',
      '`cat ./-` reads the dash file. For the spaces: `cat "spaces in this filename"`, or type `cat sp` and press Tab.',
      '`touch "my notes.txt"`',
    ],
    codex: [],
    realWorld: { text: 'These are OverTheWire Bandit levels 1 and 2. Once you have ssh (Zone 7), they take two minutes each.', bandit: [2, 3] },
    journal: 'Write down three ways to handle a file name that contains spaces.',
    solution: (s) => ['cd oddities', 'cat ./-', `submit ${s.flags[0]}`, 'cat "spaces in this filename"', `submit ${s.flags[1]}`, 'touch "my notes.txt"'],
  },

  {
    id: 'z2-5',
    title: 'Wild Cards',
    xp: 70,
    panel: 'map',
    story: 'The forest\'s loot pile is enormous. Typing every name would take all night. "Let the shell do the typing," Old Root grins.',
    setup(w) {
      const m = w.m;
      const L = `${H}/loot`;
      for (let i = 1; i <= 10; i++) m.file(`${L}/gem${i}.txt`, `gem ${i}\n`, o);
      for (const c of ['a', 'b', 'c']) m.file(`${L}/coin_${c}.log`, `coin ${c}\n`, o);
      m.file(`${L}/scroll.md`, '# scroll\n', o);
      m.file(`${L}/potion-red.dat`, 'red\n', o);
      m.file(`${L}/potion-blue.dat`, 'blue\n', o);
      m.file(`${L}/ring.txt`, 'ring\n', o);
      m.dir(`${L}/logs`, o);
      m.dir(L, o);
    },
    teach: [
      {
        title: '* matches anything',
        body: 'The shell expands patterns **before** the command runs:\n\n- `*` matches any text: `*.txt` means every name ending in .txt\n- `ls *.log` really runs `ls coin_a.log coin_b.log coin_c.log`\n\n`echo` a pattern to preview what it expands to. Hidden files are never matched by `*`.',
        try: ['echo loot/*.log', 'ls loot/*.dat'],
      },
      {
        title: '? and [ ]',
        body: '- `?` matches exactly one character: `gem?.txt` matches gem1 to gem9, but not gem10\n- `[abc]` matches one of the listed characters: `coin_[ab].log`\n- `[0-9]` matches one character from a range',
        quiz: {
          q: 'Which names does gem?.txt match?',
          options: ['gem1.txt to gem9.txt', 'Every gem file, including gem10.txt', 'Only a file literally called gem?.txt'],
          answer: 0,
          explain: '? stands for exactly one character, so gem10.txt (two characters) does not match.',
        },
      },
      {
        title: 'Braces build names',
        body: '`{a,b,c}` is not a wildcard: it **generates** names, even for things that do not exist yet:\n\n```\nmkdir {mon,tue,wed}\ntouch day{1..3}.txt\n```\n\nThe second line creates day1.txt, day2.txt and day3.txt.',
        try: 'echo {mon,tue,wed}',
      },
    ],
    brief: 'Sort the loot pile with patterns instead of typing every name.',
    objectives: [
      { text: 'List only the .txt files in loot, with one pattern', check: (q) => q.any((c) => c.name === 'ls' && /\*\.txt/.test(c.line)) },
      { text: 'Move all three .log files into loot/logs with one command', check: (q) => ['a', 'b', 'c'].every((c) => q.isFile(`${H}/loot/logs/coin_${c}.log`)) && q.any((c) => c.name === 'mv' && /\*/.test(c.line)) },
      { text: 'List gem1.txt to gem9.txt (but not gem10.txt) using ?', check: (q) => q.any((c) => c.name === 'ls' && /gem\?\.txt/.test(c.line)) },
      { text: 'Create folders mon, tue and wed in loot with one brace command', check: (q) => ['mon', 'tue', 'wed'].every((d) => q.isDir(`${H}/loot/${d}`)) && q.any((c) => c.name === 'mkdir' && /\{[^}]*,[^}]*\}/.test(c.line)) },
    ],
    hints: [
      '`cd loot`. `echo` a pattern first to preview what it matches.',
      '`ls *.txt`, `ls gem?.txt` and `mv *.log logs/`.',
      '`mkdir {mon,tue,wed}`',
    ],
    codex: [],
    realWorld: { text: 'On Kali: `ls /etc/*.conf`, `echo /etc/[a-c]*` and `ls /usr/share/wordlists/*`.' },
    journal: 'What is the difference between * and ? in a pattern?',
    solution: ['cd loot', 'ls *.txt', 'mv *.log logs/', 'ls gem?.txt', 'mkdir {mon,tue,wed}'],
  },

  {
    id: 'z2-6',
    title: "The Scribe's Quill",
    xp: 70,
    panel: 'map',
    story: 'Old Root hands you a quill. "echo is a hammer. Sometimes you need a quill: a real editor."',
    teach: [
      {
        title: 'nano: a friendly editor',
        body: '`nano quest-log.txt` opens the file in the nano editor, creating it if needed. Just type. The bar at the bottom lists shortcuts, where `^` means Ctrl:\n\n- **Ctrl+O**, then **Enter**: write out (save)\n- **Ctrl+X**: exit (nano asks to save if you forgot)\n- **Ctrl+K** cuts a line, **Ctrl+U** pastes it\n\nYou can also click the shortcut buttons at the bottom.',
        try: 'nano scratch.txt',
      },
      {
        title: '> versus >>',
        body: 'Quick writes without an editor:\n\n- `echo hi > f.txt` **replaces** the file\n- `echo hi >> f.txt` **adds** a line at the end\n\nOne `>` where you meant `>>` has wiped many important files. Check twice.',
        quiz: {
          q: 'f.txt contains two lines. You run echo three > f.txt. What is in f.txt now?',
          options: ['Three lines', 'Only the word three', 'Nothing: it errors'],
          answer: 1,
          explain: 'A single > truncates the file first, then writes.',
        },
      },
      {
        title: 'Check your work',
        body: '`cat file` shows what you saved. `cat -A` reveals invisible characters: `$` marks the end of each line, which helps when something looks right but is not.',
      },
    ],
    brief: 'Start your quest log and keep it tidy.',
    objectives: [
      { text: 'Open quest-log.txt in nano', check: (q) => q.ran('nano', { arg: `${H}/quest-log.txt` }) },
      { text: 'Save a line in it containing: I can edit files', check: (q) => (q.read(`${H}/quest-log.txt`) || '').toLowerCase().includes('i can edit files') },
      { text: 'Add a second line with echo and >> (without overwriting)', check: (q) => q.ran('echo', { redirect: '>>' }) && (q.read(`${H}/quest-log.txt`) || '').toLowerCase().includes('i can edit files') && (q.read(`${H}/quest-log.txt`) || '').trim().split('\n').length >= 2 },
      { text: 'Show the finished log with cat', check: (q) => q.ran('cat', { arg: `${H}/quest-log.txt` }) && (q.read(`${H}/quest-log.txt`) || '').trim().split('\n').length >= 2 },
    ],
    hints: [
      '`nano quest-log.txt`, type the line, then Ctrl+O, Enter, Ctrl+X.',
      '`echo "Day 1 done" >> quest-log.txt` adds a line. A single > would erase your first one.',
      '`cat quest-log.txt`',
    ],
    codex: ['nano'],
    realWorld: { text: 'On Kali: `nano ~/lab/zone2/notes.md`, save and exit. Then open `vim` once and learn to escape it: press Esc, type :q! and press Enter.' },
    journal: 'When would you use nano instead of echo >?',
    solution: [{ cmd: 'nano quest-log.txt', edit: () => 'I can edit files\n' }, 'echo "Day 1 done" >> quest-log.txt', 'cat quest-log.txt'],
  },

  {
    id: 'z2-7',
    title: 'Links and Shadows',
    xp: 70,
    panel: 'map',
    story: 'Some paths in the forest are shortcuts that bend space. "A link is a signpost," Old Root says. "Follow it and you arrive somewhere else."',
    setup(w) {
      w.m.file(`${H}/grove/scroll.txt`, 'The grove remembers every name it is called by.\n', o);
      w.m.dir(`${H}/grove`, o);
      w.m.file('/var/log/forest.log', 'Owls: 3. Wolves: 0. Recruits: 1.\n');
    },
    teach: [
      {
        title: 'Symbolic links are shortcuts',
        body: '`ln -s TARGET NAME` creates a shortcut called NAME that points to TARGET:\n\n```\nln -s /var/log logs\n```\n\n`ls -l` shows it as `logs -> /var/log`, and `cd logs` takes you there. Delete the target and the link breaks (it "dangles").',
        visual: 'map',
      },
      {
        title: 'Hard links are second names',
        body: '`ln FILE NAME` (without -s) gives the same file a second name. Both names point to the same data: change one and the other changes too. The link count in `ls -l` goes up to 2.',
        quiz: {
          q: 'What does ls -l show for a symbolic link named logs that points to /var/log?',
          options: ['logs -> /var/log', 'logs (2 links)', 'logs.lnk'],
          answer: 0,
          explain: 'ls -l prints the arrow and the target for every symlink.',
        },
      },
      {
        title: 'stat and readlink',
        body: '`stat FILE` shows everything about a file: size, link count, permissions as numbers, owner and timestamps. `readlink logs` prints where a link points.',
      },
    ],
    brief: 'Bend the forest\'s paths to your will.',
    objectives: [
      { text: 'Create a symbolic link named logs in your home that points to /var/log', check: (q) => q.isLink(`${H}/logs`) && q.node(`${H}/logs`).target.replace(/\/$/, '') === '/var/log' },
      { text: 'Walk through the link with cd', check: (q) => q.visited(`${H}/logs`) },
      { text: 'Make a hard link grove/scroll-copy.txt for grove/scroll.txt', check: (q) => !!q.node(`${H}/grove/scroll-copy.txt`) && q.node(`${H}/grove/scroll-copy.txt`) === q.node(`${H}/grove/scroll.txt`) },
      { text: 'Use stat on scroll.txt to see its link count', check: (q) => q.ran('stat', { arg: `${H}/grove/scroll.txt` }) },
    ],
    hints: [
      '`ln -s /var/log logs` creates the shortcut in your current folder (your home).',
      '`cd logs`, look around, then `cd` to come home. For the hard link: `ln grove/scroll.txt grove/scroll-copy.txt`.',
      '`stat grove/scroll.txt`, then look for "Links: 2".',
    ],
    codex: ['ln', 'stat', 'readlink'],
    realWorld: { text: 'On Kali: `ls -l /bin` shows that /bin is a symlink to usr/bin. Try `readlink -f /bin/sh` to see what sh really is.' },
    journal: 'Explain the difference between a symlink and a hard link as if to a friend.',
    solution: ['ln -s /var/log logs', 'cd logs', 'cd', 'ln grove/scroll.txt grove/scroll-copy.txt', 'stat grove/scroll.txt'],
  },

  {
    id: 'z2-boss',
    title: 'The Hoarder',
    xp: 150,
    panel: 'map',
    boss: { name: 'Hoarder', taunt: '"Mine! All mine!" The Hoarder clutches a sack of mixed loot.' },
    story: 'The Hoarder has buried the forest\'s shared supplies under a mountain of junk. Sort the pile and he loses his grip. One item holds the flag. A wrong flag costs a heart.',
    setup(w) {
      const m = w.m;
      const D = `${H}/hoard`;
      const tok = w.token(24);
      m.file(`${D}/README`, 'Sort the hoard:\n  gems -> gems/\n  scrolls -> scrolls/\n  junk -> gone\nRename the cursed map to map.txt.\nThe flag hides in a file whose name starts with a dash.\n', o);
      for (const g of ['ruby', 'opal', 'jade']) m.file(`${D}/${g}.gem`, `${g}\n`, o);
      for (const s of ['fire', 'ice']) m.file(`${D}/${s}.scroll`, `${s}\n`, o);
      for (let i = 1; i <= 6; i++) m.file(`${D}/bone${i}.junk`, 'bone\n', o);
      m.file(`${D}/cursed map.txt`, 'X marks the hoard.\n', o);
      m.file(`${D}/-flag`, `FLAG: ${tok}\n`, o);
      m.dir(D, o);
      w.state.flags.push(tok);
    },
    teach: [
      {
        title: 'Your toolkit',
        body: '- `mkdir` and `touch`: make room\n- `mv` with `*` patterns: move many files at once\n- `rm` with patterns: clear junk (preview with `ls` first!)\n- quotes and `./`: handle strange names\n\nEvery objective you finish chips away at the Hoarder\'s health.',
      },
    ],
    brief: 'Read the README, sort the hoard, then claim the flag.',
    objectives: [
      { text: 'Make folders gems and scrolls inside the hoard', check: (q) => q.isDir(`${H}/hoard/gems`) && q.isDir(`${H}/hoard/scrolls`) },
      { text: 'Move every .gem into gems/', check: (q) => ['ruby', 'opal', 'jade'].every((g) => q.isFile(`${H}/hoard/gems/${g}.gem`)) },
      { text: 'Move every .scroll into scrolls/', check: (q) => ['fire', 'ice'].every((s) => q.isFile(`${H}/hoard/scrolls/${s}.scroll`)) },
      { text: 'Destroy all the .junk files', check: (q) => [1, 2, 3, 4, 5, 6].every((i) => !q.exists(`${H}/hoard/bone${i}.junk`)) },
      { text: 'Rename "cursed map.txt" to map.txt', check: (q) => q.isFile(`${H}/hoard/map.txt`) && !q.exists(`${H}/hoard/cursed map.txt`) },
      { text: 'Read the dash-named file and submit its flag', check: (q) => q.submitted() },
    ],
    hints: [
      'Read the README first: `cat hoard/README`.',
      '`cd hoard`, `mkdir gems scrolls`, `mv *.gem gems/`, `mv *.scroll scrolls/`, `rm *.junk`.',
      '`mv "cursed map.txt" map.txt`, then `cat ./-flag` and submit what comes after FLAG:.',
    ],
    codex: [],
    realWorld: { text: 'These file-wrangling skills are exactly what Bandit levels 1 to 3 test. They need ssh, which you unlock in Zone 7.', bandit: [2, 3, 4] },
    journal: 'Which wildcard or quoting trick did you use most against the Hoarder?',
    solution: (s) => ['cat hoard/README', 'cd hoard', 'mkdir gems scrolls', 'mv *.gem gems/', 'mv *.scroll scrolls/', 'rm *.junk', 'mv "cursed map.txt" map.txt', 'cat ./-flag', `submit ${s.flags[0]}`],
  },
];
