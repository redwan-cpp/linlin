// Zone 1: Terminal Town. Who am I, where am I, how do I look around and read things.
import { gzipData } from '../../engine/commands/archive.js';

const H = '/home/recruit';
const showsHidden = (c) => c.name === 'ls' && c.argv.some((a) => /^-[A-Za-z]*[aA]/.test(a) || a === '--all' || a === '--almost-all');

export default [
  {
    id: 'z1-1',
    title: 'Wake Up, Recruit',
    xp: 50,
    panel: 'map',
    story: 'You wake in Terminal Town in front of a blinking cursor. An old sysadmin leans on a staff made of ethernet cable. "Every hacker starts here," he says. "Learn to question the machine, and it will answer."',
    teach: [
      {
        title: 'The terminal is a conversation',
        body: 'You type a **command**, press **Enter**, and the **shell** (a program called bash) answers. Then it shows the **prompt** again and waits for your next order.\n\nThe prompt tells you where you stand:\n\n```\nrecruit@quest:~$\n```\n\n- `recruit` is the user you are logged in as\n- `quest` is the name of this machine\n- `~` is your current folder (~ means your home folder)\n- `$` means a normal user. Root, the all-powerful admin, gets `#`',
        try: 'whoami',
        quiz: {
          q: 'In the prompt recruit@quest:~$ what is "quest"?',
          options: ['Your username', 'The machine\'s name (its hostname)', 'The current folder'],
          answer: 1,
          explain: 'The part after the @ is the hostname: the name of the computer you are on.',
          why: { 0: 'The username comes before the @.', 2: 'The folder comes after the colon. ~ means your home folder.' },
        },
      },
      {
        title: 'Ask the machine about itself',
        body: 'Hackers who land on an unknown machine first get their bearings. Four quick questions:\n\n- `whoami`: which user am I?\n- `hostname`: which machine is this?\n- `uname -a`: which operating system and kernel?\n- `date`: what time does the machine think it is?\n\nCommands can take **options** that start with a dash. For uname, `-a` means "all".',
        try: ['hostname', 'uname -a'],
      },
      {
        title: 'Where am I? pwd',
        body: 'Linux files live in one big upside-down tree. The top is `/`, called the **root** of the tree. Your home folder is `/home/recruit`.\n\n`pwd` (print working directory) shows the folder you are in right now. Watch the gold YOU marker on the Map panel to the right.',
        try: 'pwd',
        visual: 'map',
        quiz: {
          q: 'What does pwd show?',
          options: ['Your password', 'The folder you are currently in', 'The programs that are running'],
          answer: 1,
          explain: 'pwd = print working directory.',
          why: { 0: 'Despite the letters, pwd has nothing to do with passwords.', 2: 'Running programs are processes. You meet them in the Process Caves.' },
        },
      },
      {
        title: 'Make it talk: echo and clear',
        body: '`echo` prints whatever you give it. It sounds silly, but it is how scripts talk, and later it is how you will write files.\n\n`clear` wipes the screen (so does Ctrl+L). Nothing is lost: your history stays.',
        try: 'echo Hello, Linux',
      },
    ],
    brief: 'Old Root wants proof that you can question the machine. Every objective uses a command from the scroll.',
    objectives: [
      { text: 'Ask the machine who you are', check: (q) => q.ran('whoami') },
      { text: "Find the machine's name", check: (q) => q.ran('hostname') || q.ran('uname', { flags: 'n' }) || q.ran('uname', { flags: 'a' }) },
      { text: 'Show the folder you are standing in', check: (q) => q.ran('pwd') },
      { text: 'Make the shell say: I am ready', check: (q) => q.ran('echo', { argv: (a) => /i am ready/i.test(a.slice(1).join(' ')) }) },
      { text: 'Clear the screen with the clear command', check: (q) => q.ran('clear') },
    ],
    hints: [
      'Each objective matches one command from the scroll. Use "Re-read the lesson" if you need it.',
      'The commands are `whoami`, `hostname`, `pwd`, `echo` and `clear`.',
      'Type `echo I am ready` exactly, then `clear`.',
    ],
    codex: ['whoami', 'hostname', 'pwd', 'echo', 'clear', 'uname', 'date'],
    realWorld: { text: 'Open a terminal on your Kali PC and run `whoami`, `hostname`, `pwd` and `uname -a`. Kali\'s prompt looks different (it uses zsh, styled like ┌──(you㉿kali)-[~]), but the commands are the same.' },
    journal: 'In your own words: what does each part of recruit@quest:~$ mean?',
    solution: ['whoami', 'hostname', 'pwd', 'echo I am ready', 'clear'],
  },

  {
    id: 'z1-2',
    title: 'Look Around',
    xp: 60,
    panel: 'map',
    story: '"A thief who cannot see the room steals nothing," says Old Root, tapping your screen. "Look before you leap."',
    setup(w) {
      const size = 300 + Math.floor(w.rand() * 600);
      let text = '      X marks the spot\n';
      while (text.length < size) text += '~^~^~^ forest ~^~^~^ river ~^~^~^ hills ~^~^~^\n';
      text = text.slice(0, size - 1) + '\n';
      w.m.file(`${H}/treasure.map`, text, { owner: 'recruit' });
      w.m.file(`${H}/notes.txt`, 'Buy rope.\nAsk Old Root about the cellar.\n', { owner: 'recruit' });
      w.m.file(`${H}/todo.txt`, '- learn ls\n- learn cd\n', { owner: 'recruit' });
      for (const d of ['Documents', 'Downloads', 'Pictures']) w.m.dir(`${H}/${d}`, { owner: 'recruit' });
      w.m.file(`${H}/tools/scan.sh`, '#!/bin/bash\necho "Scanning the horizon..."\n', { owner: 'recruit', mode: 0o755 });
      w.state.flags.push(String(size));
    },
    teach: [
      {
        title: 'ls lists what is here',
        body: '`ls` shows the names in your current folder. The colours mean something:\n\n- **blue**: a directory (a folder)\n- **green**: a program you can run\n- **white**: an ordinary file\n\nNames with spaces are shown in quotes, so you can tell where a name starts and ends.',
        try: 'ls',
      },
      {
        title: 'Look anywhere: ls PATH',
        body: 'Give ls a path to look somewhere else without moving.\n\n- `ls /` shows the top of the tree: `bin`, `etc`, `home`, `tmp`, `usr`, `var`…\n- `ls /etc` shows system configuration files\n\nThe word after a command is called an **argument**.',
        try: ['ls /', 'ls /etc'],
        quiz: {
          q: 'What does ls /etc do?',
          options: ['Moves you into /etc', 'Lists what is inside /etc without moving you', 'Deletes /etc'],
          answer: 1,
          explain: 'ls only looks. cd is the command that moves you.',
        },
      },
      {
        title: 'The long view: ls -l',
        body: '`-l` turns on the **long format**: one line per file.\n\n```\n-rw-r--r-- 1 recruit recruit 220 Oct 31 12:00 notes.txt\n```\n\n- `-rw-r--r--`: type and permissions (Zone 5 is all about these)\n- `recruit recruit`: owner and group\n- `220`: size in **bytes**\n- `Oct 31 12:00`: last modified\n- `notes.txt`: the name\n\nAdd `-h` for human sizes like 4.0K. Short options combine: `ls -lh` is the same as `ls -l -h`.',
        try: 'ls -l',
        quiz: {
          q: 'In that line, what does 220 tell you?',
          options: ["The file's size in bytes", 'How many lines it has', 'Its permission number'],
          answer: 0,
          explain: 'The number just before the date is the size in bytes.',
        },
      },
    ],
    brief: 'Somewhere in your home folder lies a treasure map. Old Root needs its exact size to check that it is the real one.',
    objectives: [
      { text: 'List your home folder', check: (q) => q.ran('ls') },
      { text: 'Look at the top of the filesystem (/) without moving there', check: (q) => q.ran('ls', { arg: '/' }) },
      { text: 'Use the long listing format', check: (q) => q.ran('ls', { flags: 'l' }) },
      { text: 'Submit the exact size of treasure.map in bytes (submit NUMBER)', check: (q) => q.submitted() },
    ],
    hints: [
      'The long format has a size column.',
      'Run `ls -l` in your home folder and find the treasure.map line. The number just before the date is the size.',
      'Then type `submit` followed by that number, for example `submit 512`.',
    ],
    codex: ['ls'],
    realWorld: { text: 'On Kali, run `ls -la ~` and `ls -lh /usr/share/wordlists`. Spot the colours and compare the sizes.' },
    journal: 'What does each column of ls -l tell you?',
    solution: (s) => ['ls', 'ls /', 'ls -l', `submit ${s.flags[0]}`],
  },

  {
    id: 'z1-3',
    title: 'Walk the Roads',
    xp: 60,
    panel: 'map',
    story: 'Terminal Town has many roads. "Learn the addresses," Old Root says, "and you can walk anywhere, even blindfolded."',
    setup(w) {
      const m = w.m;
      m.file(`${H}/town/sign.txt`, 'Welcome to Terminal Town. Roads: market, tavern, library, well.\n', { owner: 'recruit' });
      m.file(`${H}/town/market/stall.txt`, 'Fresh bytes, two coins a kilobyte.\n', { owner: 'recruit' });
      m.file(`${H}/town/tavern/menu.txt`, 'Root beer. Only root may order it.\n', { owner: 'recruit' });
      m.file(`${H}/town/library/archive/old-book.txt`, 'Chapter 1: In the beginning was the command line.\n', { owner: 'recruit' });
      m.file(`${H}/town/well/bottom/echo.txt`, 'Hello? hello? hello?\n', { owner: 'recruit' });
      for (const d of ['town', 'town/market', 'town/tavern', 'town/library', 'town/library/archive', 'town/well', 'town/well/bottom']) m.dir(`${H}/${d}`, { owner: 'recruit' });
    },
    teach: [
      {
        title: 'cd moves you',
        body: '`cd` (change directory) walks you into a folder. Check where you landed with `pwd`, and watch the gold marker move on the Map.\n\n`cd town` walks into the town folder that is **inside** your current folder.',
        try: ['cd town', 'pwd'],
        visual: 'map',
      },
      {
        title: 'Absolute and relative paths',
        body: '- An **absolute** path starts with `/` and works from anywhere: `/home/recruit/town/market`\n- A **relative** path starts from where you are: from /home/recruit, `town/market` is the same place\n\nIf a path starts with `/`, it is absolute. Otherwise it is relative to your current folder.',
        quiz: {
          q: 'Which of these is an absolute path?',
          options: ['town/market', '/home/recruit/town', '../tavern'],
          answer: 1,
          explain: 'It starts with /, the root of the tree, so it works from anywhere.',
        },
      },
      {
        title: 'Shortcuts: . .. ~ and -',
        body: '- `.` means **this** folder\n- `..` means the **parent** folder, one level up\n- `~` means **your home** folder\n- `cd -` jumps back to the **previous** folder\n- `cd` on its own goes home\n\nThey chain: `cd ../..` climbs two levels.',
        try: ['cd ..', 'cd -'],
        quiz: {
          q: 'You are in /home/recruit/town/market. Where does cd ../tavern take you?',
          options: ['/home/recruit/town/tavern', '/home/recruit/tavern', '/tavern'],
          answer: 0,
          explain: '.. climbs to /home/recruit/town, then you walk into tavern.',
        },
      },
      {
        title: 'Tab saves your fingers',
        body: 'Type the first letters of a name and press **Tab**: the shell completes it. If several names match, press Tab twice to see them all.\n\nReal hackers almost never type a full path by hand.',
        try: 'cd ~',
      },
    ],
    brief: 'Walk the roads of Terminal Town. Old Root watches your footsteps.',
    objectives: [
      { text: 'Walk into the town folder', check: (q) => q.visited(`${H}/town`) },
      { text: 'Reach the bottom of the well (town/well/bottom)', check: (q) => q.visited(`${H}/town/well/bottom`) },
      { text: 'From the bottom of the well, climb back to town with a single cd using ..', check: (q) => q.any((c) => c.name === 'cd' && c.status === 0 && c.cwd === `${H}/town/well/bottom` && /^\.\.\/\.\.\/?$/.test(c.argv[1] || '')) },
      { text: 'Jump to /etc with an absolute path', check: (q) => q.ran('cd', { arg: '/etc' }) },
      { text: 'Jump back to where you were with cd -', check: (q) => q.ran('cd', { arg: '-' }) },
      { text: 'Go home with cd ~ or a plain cd', check: (q) => q.ran('cd', { argv: (a) => a.length === 1 || a[1] === '~' || a[1] === H }) && q.cwdIs(H) },
    ],
    hints: [
      'Use `cd` with a folder name to walk in, and `pwd` to check where you are.',
      '`cd town/well/bottom` takes you down the well. `cd ../..` climbs two levels.',
      'Then `cd /etc`, `cd -`, and finally `cd` on its own.',
    ],
    codex: ['cd'],
    realWorld: { text: 'On Kali: `cd /usr/share/wordlists`, `pwd`, `cd -`, then `cd`. Use Tab to complete every folder name.' },
    journal: 'Explain the difference between an absolute and a relative path.',
    solution: ['cd town', 'cd well/bottom', 'cd ../..', 'cd /etc', 'cd -', 'cd'],
  },

  {
    id: 'z1-4',
    title: 'Hidden Treasures',
    xp: 60,
    panel: 'map',
    story: 'Old Root lowers his voice. "The best secrets on a Linux box hide in plain sight. A single dot is enough to make a file vanish."',
    setup(w) {
      const m = w.m;
      const tok = w.token(10);
      m.file(`${H}/cellar/barrel.txt`, 'Empty. Smells of old logs.\n', { owner: 'recruit' });
      m.file(`${H}/cellar/crate.txt`, 'Just straw.\n', { owner: 'recruit' });
      m.dir(`${H}/cellar/cobwebs`, { owner: 'recruit' });
      m.file(`${H}/cellar/.stash_${tok}`, 'You found me. Submit the part of my name after "stash_".\n', { owner: 'recruit' });
      m.file(`${H}/cellar/.old_notes`, 'The smuggler always used dotfiles.\n', { owner: 'recruit' });
      m.dir(`${H}/cellar`, { owner: 'recruit' });
      w.state.flags.push(tok);
    },
    teach: [
      {
        title: 'Dotfiles hide',
        body: 'Any name that starts with a dot is **hidden**: plain `ls` skips it. Linux uses this for settings files, like `.bashrc` in your home folder.\n\n`ls -a` (all) shows everything, hidden or not.',
        try: 'ls -a ~',
      },
      {
        title: 'The two dots that are always there',
        body: '`ls -a` also shows `.` and `..`: every folder contains a link to itself and one to its parent. That is why `cd ..` works.\n\n`ls -A` shows hidden files **without** those two.',
        quiz: {
          q: 'Which command shows hidden files?',
          options: ['ls -h', 'ls -a', 'ls --secret'],
          answer: 1,
          explain: '-a means all, including names that start with a dot.',
          why: { 0: '-h means human-readable sizes, used with -l.', 2: 'There is no such option. ls would complain.' },
        },
      },
      {
        title: 'Combine them: ls -la',
        body: '`ls -la` gives the long format **and** hidden files. It is one of the most typed commands in Linux.\n\n`tree -a` draws the whole folder tree, hidden items included.',
        try: ['ls -la', 'tree -a ~'],
        after: '**Hacker\'s note:** attackers hide tools in dot-folders like `/tmp/.x`. Defenders hunt for them with `ls -la`.',
      },
    ],
    brief: 'A smuggler hid a stash in the cellar under your home. Find it.',
    objectives: [
      { text: 'Go down into the cellar', check: (q) => q.visited(`${H}/cellar`) },
      { text: 'Reveal the hidden files in the cellar', check: (q) => q.any((c) => showsHidden(c) && (c.cwd === `${H}/cellar` || c.argv.some((a) => a.includes('cellar')))) },
      { text: 'Submit the stash\'s secret: the part of its name after stash_', check: (q) => q.submitted() },
    ],
    hints: [
      'Hidden files start with a dot. Plain `ls` will not show them.',
      '`cd cellar`, then `ls -a`.',
      'If the file is `.stash_Ab12Cd34Ef`, type `submit Ab12Cd34Ef`.',
    ],
    codex: ['tree'],
    realWorld: { text: 'On Kali, run `ls -la ~` and count your dotfiles. Peek into one safely with `head ~/.bashrc`.' },
    journal: 'Why would an attacker give a file a name that starts with a dot?',
    solution: (s) => ['cd cellar', 'ls -a', `submit ${s.flags[0]}`],
  },

  {
    id: 'z1-5',
    title: 'Read the Scrolls',
    xp: 70,
    panel: 'map',
    story: 'The town library is full of scrolls. "Reading is half of hacking," Old Root says. "Logs, configs, notes: the answer is always written down somewhere."',
    setup(w) {
      const m = w.m;
      const tok = w.token(16);
      m.file(`${H}/library/welcome.txt`, 'Welcome, reader.\nScrolls here are long. Learn to page, to peek at the start, and to peek at the end.\n', { owner: 'recruit' });
      let epic = '';
      const verses = ['The shell was dark and the prompt was cold,', 'A recruit typed whoami, brave and bold,', 'The kernel answered, the cursor blinked,', 'And every folder, one by one, was linked.'];
      for (let i = 1; i <= 220; i++) epic += `${String(i).padStart(3, '0')}  ${verses[i % 4]}\n`;
      m.file(`${H}/library/epic.txt`, epic, { owner: 'recruit' });
      let log = '';
      const events = ['gate opened', 'guard changed', 'torch lit', 'scroll returned', 'door checked', 'rats counted'];
      for (let i = 0; i < 300; i++) {
        const t = new Date(Date.UTC(2026, 9, 31, Math.floor(i / 13), (i * 7) % 60, i % 60)).toISOString().replace('T', ' ').slice(0, 19);
        log += `${t} vault: ${events[i % events.length]}\n`;
      }
      log += `2026-10-31 23:59:59 vault: the final word is ${tok}\n`;
      m.file(`${H}/library/log.txt`, log, { owner: 'recruit' });
      m.file(`${H}/library/artifact.bin`, gzipData('ancient secrets\n', 'artifact', w.now()), { owner: 'recruit' });
      m.dir(`${H}/library`, { owner: 'recruit' });
      w.state.flags.push(tok);
    },
    teach: [
      {
        title: 'cat prints a whole file',
        body: '`cat welcome.txt` prints the file. Great for short files. On a 10,000-line log it floods your screen.',
        try: 'cat library/welcome.txt',
      },
      {
        title: 'less pages through long files',
        body: '`less` shows one screen at a time:\n\n- **Space**: next page, **b**: back\n- **/word**: search, **g** / **G**: top / bottom\n- **q**: quit\n\nManual pages open in less too, so these keys matter.',
        try: 'less library/epic.txt',
      },
      {
        title: 'head and tail',
        body: '`head` shows the first 10 lines and `tail` the last 10. `-n` picks how many:\n\n- `head -n 5 file`\n- `tail -n 3 file`\n\nNew log entries are added at the bottom, so `tail` is how you read logs. `tail -f` keeps following a log live.',
        try: 'tail -n 3 library/log.txt',
        quiz: {
          q: 'A log file gets new lines at the bottom. Which command shows the 20 newest?',
          options: ['head -n 20 log', 'tail -n 20 log', 'cat -20 log'],
          answer: 1,
          explain: 'tail reads from the end, where the newest lines are.',
        },
      },
      {
        title: 'file: what is it really?',
        body: 'Extensions lie. `file` looks at the bytes inside:\n\n```\n$ file mystery.txt\nmystery.txt: gzip compressed data\n```\n\n**Hacker\'s note:** run `file` on any unknown blob before you do anything else with it.',
        try: 'file library/artifact.bin',
      },
      {
        title: 'Shortcuts: Tab, ↑ and history',
        body: '- **Tab** completes file names\n- **↑ / ↓** walk through your previous commands\n- `history` lists them with numbers, and `!!` repeats the last one',
        try: 'history',
      },
    ],
    brief: 'Search the library. One scroll holds the final word of the vault log.',
    objectives: [
      { text: 'Read welcome.txt with cat', check: (q) => q.ran('cat', { arg: `${H}/library/welcome.txt` }) },
      { text: 'Open epic.txt in less, then quit with q', check: (q) => q.ran(['less', 'more'], { arg: `${H}/library/epic.txt` }) },
      { text: 'Show only the first 5 lines of epic.txt', check: (q) => q.ran('head', { arg: `${H}/library/epic.txt`, argv: (a) => /(^| )-n ?5( |$)|(^| )-5( |$)|--lines=5/.test(a.join(' ')) }) },
      { text: 'Find out what kind of file artifact.bin really is', check: (q) => q.ran('file', { arg: `${H}/library/artifact.bin` }) },
      { text: 'Read the last line of log.txt with tail, then submit its final word', check: (q) => q.ran('tail') && q.submitted() },
    ],
    hints: [
      'Each objective uses a different command from the scroll: cat, less, head, file, tail.',
      '`cd library`, then `cat welcome.txt`, `less epic.txt` (press q), `head -n 5 epic.txt` and `file artifact.bin`.',
      '`tail -n 1 log.txt` shows the last line. Submit the word after "is".',
    ],
    codex: ['cat', 'less', 'head', 'tail', 'file', 'history'],
    realWorld: { text: 'On Kali: `tail -n 20 /var/log/dpkg.log`, `file /usr/bin/ls`, and `less /etc/services` (search it with /ssh).' },
    journal: 'When would you use less instead of cat, and tail instead of head?',
    solution: (s) => ['cd library', 'cat welcome.txt', 'less epic.txt', 'head -n 5 epic.txt', 'file artifact.bin', 'tail -n 1 log.txt', `submit ${s.flags[0]}`],
  },

  {
    id: 'z1-6',
    title: 'Ask the Elders',
    xp: 60,
    panel: 'codex',
    story: '"I will not always be here," Old Root admits. "But the elders are. Every command carries its own manual. Learn to ask them."',
    teach: [
      {
        title: 'man: the manual',
        body: '`man ls` opens the manual for ls in the pager. Sections to look for:\n\n- **NAME**: one-line summary\n- **SYNOPSIS**: how to call it\n- **OPTIONS**: every flag it accepts\n\nSearch inside with `/word` and quit with `q`.',
        try: 'man ls',
      },
      {
        title: '--help: the short version',
        body: 'Most commands print a quick summary when given `--help`. Try `ls --help` when you just need the name of a flag.',
        try: 'ls --help',
      },
      {
        title: 'Where do commands live?',
        body: 'Most commands are programs stored in folders like `/usr/bin`. `which ls` shows the path.\n\nSome commands live **inside** the shell itself (builtins), like `cd`. `type cd` tells you. `type` also reveals aliases: try `type ll`.',
        try: ['which ls', 'type cd'],
        quiz: {
          q: 'You forgot which ls option sorts files by size. What is the fastest reliable way to find it?',
          options: ['Guess random letters', 'man ls or ls --help, then search for "size"', 'Reinstall Linux'],
          answer: 1,
          explain: 'The manual is always on the machine, even with no internet.',
        },
      },
    ],
    brief: 'Prove you can teach yourself. The elders answer anyone who asks properly.',
    objectives: [
      { text: 'Open the manual for any command', check: (q) => q.ran('man') },
      { text: 'Get the quick help of any command with --help', check: (q) => q.any((c) => c.argv.includes('--help')) },
      { text: 'Find where the ls program lives on disk', check: (q) => q.ran('which', { arg: 'ls' }) || q.ran('type', { arg: 'ls' }) },
      { text: 'Ask the shell whether cd is a builtin', check: (q) => q.ran('type', { arg: 'cd' }) },
      { text: 'Use the option you found in the manual to list /usr/bin sorted by size', check: (q) => q.ran('ls', { flags: 'S', arg: '/usr/bin' }) },
    ],
    hints: [
      '`man ls`, then type `/size` inside the pager to search.',
      'The option that sorts by size is a capital S.',
      '`ls -lS /usr/bin`',
    ],
    codex: ['man', 'which', 'type', 'help'],
    realWorld: { text: 'On Kali, open `man find` and search for -size with `/-size`. You will need it in the Search Swamp.' },
    journal: 'How would you find the right flag for a command you have never used before?',
    solution: ['man ls', 'ls --help', 'which ls', 'type cd', 'ls -lS /usr/bin'],
  },

  {
    id: 'z1-boss',
    title: 'The Maze Warden',
    xp: 150,
    panel: 'map',
    boss: { name: 'Maze Warden', taunt: '"None who enter my maze find the key," it rumbles.' },
    story: 'Beyond the town lies a stone maze guarded by the Maze Warden. Its key hides deep inside. Use everything you have learned. Beware: a wrong key costs a heart.',
    setup(w) {
      const m = w.m;
      const M = `${H}/maze`;
      const tok = w.token(20);
      const o = { owner: 'recruit' };
      m.file(`${M}/sign.txt`, 'Welcome, recruit. Three corridors lie before you.\nOnly fools walk the obvious ones.\nThe true path hides behind a door you cannot see.\n', o);
      m.file(`${M}/north/sign.txt`, 'Dead end. The wind laughs at you. Go back.\n', o);
      m.file(`${M}/south/sign.txt`, 'Dead end. Something scratches behind the wall. Go back.\n', o);
      m.file(`${M}/east/key.txt`, `KEY: ${w.token(20)}\n(Old Root scribbled underneath: "Too easy. Do you trust it?")\n`, o);
      m.file(`${M}/.secret_passage/sign.txt`, 'You found the hidden passage.\nThe walls whisper: down, then down again, then into the chamber.\n', o);
      m.file(`${M}/.secret_passage/up/key.txt`, `KEY: ${w.token(20)}\nA trap! This key is painted wood.\n`, o);
      m.file(`${M}/.secret_passage/down/sign.txt`, 'Keep going down.\n', o);
      m.file(`${M}/.secret_passage/down/down/chamber/keyhole.txt`, 'The real key always hides. It always has.\n', o);
      m.file(`${M}/.secret_passage/down/down/chamber/old_key`, '\x89\x01\x7f\x00\xfe\x13\x37\x00\x00\xaa\xbb\x02', o);
      m.file(`${M}/.secret_passage/down/down/chamber/.warden_key`, `KEY: ${tok}\n`, o);
      for (const d of ['', '/north', '/south', '/east', '/.secret_passage', '/.secret_passage/up', '/.secret_passage/down', '/.secret_passage/down/down', '/.secret_passage/down/down/chamber']) m.dir(M + d, o);
      w.state.flags.push(tok);
    },
    teach: [
      {
        title: 'Your toolkit',
        body: '- `cd`, `pwd`: move and check where you are\n- `ls -a`: reveal hidden doors\n- `cat`, `less`, `tail`: read the signs\n- `file`: spot the fakes\n\nSigns in the maze give directions, and some keys are traps. The real key is a **hidden text file** deep inside. Each wrong key you submit costs a heart.',
      },
    ],
    brief: 'Every objective you complete strikes the Warden. Lose all three hearts and the maze resets.',
    objectives: [
      { text: 'Read the maze\'s welcome sign', check: (q) => q.ran(['cat', 'less', 'head', 'tail'], { arg: `${H}/maze/sign.txt` }) },
      { text: 'Find the hidden passage', check: (q) => q.visited(`${H}/maze/.secret_passage`) },
      { text: 'Descend to the Warden\'s chamber', check: (q) => q.visited(`${H}/maze/.secret_passage/down/down/chamber`) },
      { text: 'Reveal what hides in the chamber', check: (q) => q.any((c) => showsHidden(c) && (c.cwd.endsWith('/chamber') || c.argv.some((a) => a.includes('chamber')))) },
      { text: 'Submit the Warden\'s true key', check: (q) => q.submitted() },
    ],
    hints: [
      'Read `maze/sign.txt` first. The obvious corridors are dead ends.',
      '`ls -a` inside the maze reveals a hidden passage. Follow its sign: down, then down again.',
      'In the chamber, `ls -a`, then `cat` the hidden key file and submit what comes after `KEY:`.',
    ],
    codex: [],
    realWorld: { text: 'You now have the skills for OverTheWire Bandit levels 0 and 1, apart from ssh, which you unlock in Zone 7. Read their pages now so you know what is coming.', bandit: [0, 1] },
    journal: 'Which skill helped you most in the maze, and why?',
    solution: (s) => ['cat maze/sign.txt', 'cd maze', 'ls -a', 'cd .secret_passage', 'cat sign.txt', 'cd down/down/chamber', 'ls -a', 'cat .warden_key', `submit ${s.flags[0]}`],
  },
];
