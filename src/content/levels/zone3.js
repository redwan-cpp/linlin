// Zone 3: Search Swamp. find, grep, strings, base64, xxd, wc and checksums.
import { gzipData } from '../../engine/commands/archive.js';
import { sha256 } from '../../engine/hash.js';

const H = '/home/recruit';
const o = { owner: 'recruit' };

// ---------- helpers for building files ----------
// Exactly n bytes of readable filler, ending in a newline.
const fill = (n, unit = 'reeds and mud and croaking. ') => {
  let s = '';
  while (s.length < n) s += unit;
  return s.slice(0, n - 1) + '\n';
};
// text (no newline) padded with spaces so the whole file is exactly n bytes, like the Bandit password files.
const padText = (text, n) => text + ' '.repeat(n - text.length - 1) + '\n';
// n random bytes. '=' is skipped so junk never fakes the "====" marker that strings hunts for.
const junk = (w, n) => {
  let s = '';
  for (let i = 0; i < n; i++) {
    let c = Math.floor(w.rand() * 256);
    if (c === 61) c = 62;
    s += String.fromCharCode(c);
  }
  return s;
};
const SYL = ['bra', 'mo', 'tel', 'ki', 'sna', 'po', 'dru', 'fen', 'lu', 'zar', 'gor', 'nim', 'vex', 'tho', 'ba', 'rin', 'sel', 'qua', 'dor', 'mip'];
const nonsense = (w) => {
  let s = '';
  const n = 2 + Math.floor(w.rand() * 2);
  for (let i = 0; i < n; i++) s += w.pick(SYL);
  return s;
};
const b64 = (text) => btoa(text).match(/.{1,76}/g).join('\n') + '\n';

// ---------- helpers for objectives ----------
// Some command in the typed history matches `re` on the raw line (ok: it must also have exited 0).
const typed = (q, name, re, ok = true) => q.any((c) => c.name === name && (!ok || c.status === 0) && re.test(c.line));
const hasOpt = (argv, ch) => argv.some((a) => /^-[A-Za-z]+$/.test(a) && a.includes(ch));
const quiet = /2>\s*\/dev\/null/;
// A grep command with these flags, a pattern matching patRe, aimed at the realm folder (by path, or by standing inside it).
const grepRealm = (c, flags, patRe) => {
  if (c.name !== 'grep' || !flags.every((ch) => hasOpt(c.argv, ch))) return false;
  const pos = c.argv.slice(1).filter((a) => !a.startsWith('-'));
  if (!pos.some((a) => patRe.test(a))) return false;
  const paths = pos.filter((a) => !patRe.test(a));
  return paths.some((p) => /(^|\/)realm\/?$/.test(p)) || (c.cwd.startsWith(`${H}/realm`) && paths.every((p) => p === '.' || p === './'));
};

export default [
  {
    id: 'z3-1',
    title: "The Seeker's Eye",
    xp: 60,
    panel: 'map',
    story: 'Fog rolls over the Search Swamp. Old Root hands you a lantern that hums softly. "The swamp swallows what you do not search for properly," he says. "find walks every path, even the ones you forgot."',
    setup(w) {
      const m = w.m;
      const S = `${H}/swamp`;
      const tok = w.flag(16);
      m.dir(S, o);
      m.file(`${S}/README.txt`, 'Welcome to the Search Swamp.\nThe fog is thick. Use find, not your eyes.\n', o);
      m.file(`${S}/bog/frog.txt`, 'Ribbit. This frog knows nothing.\n', o);
      m.file(`${S}/bog/Lily.TXT`, 'A lily pad. Nothing under it but water.\n', o);
      m.file(`${S}/bog/reeds/heron.txt`, 'The heron stands very still.\n', o);
      m.file(`${S}/bog/reeds/dragonfly.log`, 'Buzz at dawn. Buzz at dusk.\n', o);
      m.file(`${S}/mangrove/crab.log`, 'Sideways, always sideways.\n', o);
      m.file(`${S}/mangrove/roots/mud.txt`, 'Mud. Only mud.\n', o);
      m.file(`${S}/mangrove/roots/deep/tadpole.txt`, 'Tiny, wiggly, hopeful.\n', o);
      m.file(`${S}/mangrove/roots/deep/king.crown`, `The Frog King hides his secret under his crown.\nSECRET: ${tok}\n`, o);
      m.file(`${S}/hut/lantern.txt`, 'An old lantern. Still warm.\n', o);
      m.file(`${S}/hut/cellar/jars.txt`, 'Jars of pickled flies.\n', o);
      m.file(`${S}/hut/cellar/spider.log`, 'Eight legs, zero rent.\n', o);
    },
    teach: [
      {
        title: 'find walks the whole tree',
        body: '`ls` shows one folder. `find` goes **down through every folder below** the place you give it and prints everything it meets.\n\n```\nfind swamp\n```\n\nThe first word after `find` is where to start. It searches there and in every folder beneath it, however deep. With no path, find starts in the current folder (`.`).',
        try: 'find swamp',
        visual: 'map',
        quiz: {
          q: 'What does find swamp print?',
          options: ['Only the files directly inside swamp', 'Every file and folder below swamp, however deep', 'Only the folder names'],
          answer: 1,
          explain: 'find is recursive: it walks down through every sub-folder and prints each path it meets.',
          why: { 0: 'That is what ls swamp does. find keeps going into sub-folders.', 2: 'Without a test, find prints files and folders alike.' },
        },
      },
      {
        title: '-name: search by file name',
        body: 'Add a **test** after the path. `-name` keeps only the entries whose name matches a pattern:\n\n```\nfind swamp -name "*.txt"\n```\n\n- `*` matches any text and `?` matches one character (the wildcards from Zone 2)\n- `-name` looks at the **name only**, not at the folders before it\n- It is **case-sensitive**\n\nAlways put the pattern in **quotes**. Without them, the shell expands `*.txt` against your current folder before find even starts, and find gets the wrong words.',
        try: ['find swamp -name "*.txt"', 'find swamp -name "*.log"'],
        quiz: {
          q: 'Why do you write -name "*.txt" with quotes?',
          options: ['So find, not the shell, expands the pattern', 'Quotes make find run faster', 'The dot needs quotes to be read'],
          answer: 0,
          explain: 'Unquoted, the shell would replace *.txt with matching names from your current folder first. Quoted, find receives the pattern itself and applies it everywhere.',
          why: { 1: 'Quotes change nothing about speed. They change who expands the pattern.', 2: 'The dot is an ordinary character. The star is the one that gets expanded.' },
        },
      },
      {
        title: '-iname: ignore capitals',
        body: 'Linux names are case-sensitive: `Lily.TXT` and `lily.txt` are different files. Notice that the first command below misses the file. `-iname` is `-name` with case ignored:\n\n```\nfind swamp -iname "lily*"\n```',
        try: ['find swamp -name "lily*"', 'find swamp -iname "lily*"'],
      },
      {
        title: '-type and -maxdepth',
        body: '- `-type f` keeps only files\n- `-type d` keeps only directories\n- `-type l` keeps only symbolic links\n- `-maxdepth N` goes at most N levels down (1 = only the top of the folder)\n\n```\nfind swamp -maxdepth 1 -type d\n```\n\nWrite `-maxdepth` **first**, before the other tests. Real GNU find scolds you otherwise: it is a setting for the whole search, not a test.',
        try: ['find swamp -type d', 'find swamp -maxdepth 1'],
        quiz: {
          q: 'Which command lists only the folders that sit directly inside swamp?',
          options: ['find swamp -maxdepth 1 -type d', 'find swamp -type d -name 1', 'find swamp -only-dirs'],
          answer: 0,
          explain: '-type d keeps folders and -maxdepth 1 stops find after the first level.',
          why: { 1: '-name 1 looks for something called 1. It does not limit depth.', 2: 'There is no such option. find would say: unknown predicate.' },
        },
      },
      {
        title: 'Tests stack up',
        body: 'Several tests in a row must **all** be true (that is an AND). This finds only files that end in .log:\n\n```\nfind swamp -type f -name "*.log"\n```\n\nfind only prints **paths**. To read what you found, hand the path to `cat`.',
        try: 'find swamp -type f -name "*.log"',
        after: '**Hacker\'s note:** `find / -name "*.conf"` lists every config file on a box and `find / -name id_rsa` hunts for SSH private keys. Searching the whole disk throws a lot of errors, and the next quest shows how to silence them.',
      },
    ],
    brief: 'The Frog King buried a secret somewhere in the swamp. Learn to search, then find it.',
    objectives: [
      { text: 'List everything inside swamp with find (a path and no tests)', check: (q) => q.ran('find', { arg: `${H}/swamp`, argv: (a) => !a.slice(1).some((x) => x.startsWith('-')) }) },
      { text: 'Find every .txt file with -name and a quoted pattern', check: (q) => typed(q, 'find', /-name\s+(["'])\*\.txt\1/) },
      { text: 'Find Lily.TXT with -iname, even though the capitals do not match', check: (q) => q.any((c) => c.name === 'find' && /-iname\s/.test(c.line) && c.out.includes('Lily.TXT')) },
      { text: 'List only the folders inside swamp (-type d)', check: (q) => typed(q, 'find', /-type\s+d\b/) },
      { text: 'Stop find after the first level with -maxdepth 1', check: (q) => typed(q, 'find', /-maxdepth\s+1\b/) },
      { text: 'Find the file that ends in .crown, read it, and submit the secret', check: (q) => q.submitted() },
    ],
    hints: [
      'find takes a folder first, then tests. Start with `find swamp`.',
      'Quote patterns: `find swamp -name "*.txt"`. For capitals use -iname, for folders -type d, and put -maxdepth 1 before other tests.',
      '`find swamp -name "*.crown"` prints the path. `cat` that path and submit what comes after SECRET:.',
    ],
    codex: ['find'],
    realWorld: { text: 'On Kali: `find ~ -maxdepth 2 -type d`, then `find /usr/share -iname "*.txt" 2>/dev/null | head`. Try `-name` with and without quotes inside a folder full of .txt files and watch the difference.' },
    journal: 'Why must a pattern like "*.txt" be quoted when you give it to find?',
    solution: (s) => ['find swamp', 'find swamp -name "*.txt"', 'find swamp -iname "lily.txt"', 'find swamp -type d', 'find swamp -maxdepth 1 -type d', 'find swamp -name "*.crown"', 'cat swamp/mangrove/roots/deep/king.crown', `submit ${s.flags[0]}`],
  },

  {
    id: 'z3-2',
    title: 'Deep Search',
    xp: 80,
    panel: 'map',
    story: '"Names are only the start," says Old Root, lifting a heavier lens. "Ask how big, how old, whose, and who may touch it, and the swamp gives up its secrets." The Toad Keeper left his warehouse in a hurry.',
    setup(w) {
      const m = w.m;
      const W = `${H}/warehouse`;
      m.addGroup('swampers', 2001);
      m.addUser('toadkeeper', { uid: 1101, groups: ['swampers'] });
      const tk = { owner: 'toadkeeper', group: 'swampers' };
      m.dir(W, o);
      // Bandit 5 in miniature: one file is exactly 1033 bytes and not executable
      const secret1 = w.flag(20);
      m.file(`${W}/crates/ledger.txt`, padText(`Crate ledger. SECRET: ${secret1}`, 1033), { ...o, mode: 0o644 });
      m.file(`${W}/crates/tools.sh`, padText('#!/bin/bash   echo "tools"', 1033), { ...o, mode: 0o755 });
      m.file(`${W}/crates/hammer`, padText('hammer, nails, more nails', 1033), { ...o, mode: 0o755 });
      m.file(`${W}/crates/manifest.txt`, fill(1000), { ...o, mode: 0o644 });
      m.file(`${W}/crates/notes.txt`, fill(1034), { ...o, mode: 0o644 });
      m.file(`${W}/crates/pallet.bin`, fill(1500), { ...o, mode: 0o644 });
      // sizes, owners
      m.dir(`${W}/barrels`, tk);
      m.file(`${W}/barrels/small.txt`, fill(120), tk);
      m.file(`${W}/barrels/medium.txt`, fill(900), tk);
      m.file(`${W}/barrels/large.dat`, fill(3000), tk);
      m.file(`${W}/barrels/huge.dat`, fill(9000), tk);
      // empty things
      m.file(`${W}/stub.log`, '', o);
      m.file(`${W}/empty/nothing.txt`, '', o);
      m.dir(`${W}/empty/hollow`, o);
      m.file(`${W}/empty/pebble.txt`, 'one small pebble\n', o);
      // old things
      m.file(`${W}/old/almanac.txt`, fill(200, 'Planting season: when the frogs sing. '), { ...o, mtime: w.daysAgo(90) });
      m.file(`${W}/old/receipt.txt`, fill(150, 'Paid in full: three flies. '), { ...o, mtime: w.daysAgo(45) });
      m.file(`${W}/old/newspaper.txt`, fill(180, 'Swamp Gazette: all quiet today. '), o);
      // permissions
      m.file(`${W}/keys/toad.key`, 'toad-key-material\n', { ...o, mode: 0o600 });
      m.file(`${W}/keys/frog.key`, 'frog-key-material\n', { ...o, mode: 0o600 });
      m.file(`${W}/keys/shared.key`, 'public-key-material\n', { ...o, mode: 0o644 });
      m.file(`${W}/keys/notes.txt`, 'Keep private keys private.\n', { ...o, mode: 0o644 });
      // Bandit 6 in miniature: somewhere on the server, owned by toadkeeper:swampers, 21 bytes
      const secret2 = w.flag(20);
      for (const d of ['/var/lib/marsh/.cache', '/opt/marsh', '/srv/frogpond', '/usr/share/marsh']) m.dir(d);
      m.dir('/opt/vault', { mode: 0o700 });
      m.dir('/var/lib/lockbox', { mode: 0o700 });
      m.file('/var/lib/marsh/.cache/toad.note', secret2 + '\n', tk);
      m.file('/opt/marsh/lily-note.txt', w.token(20) + '\n', { owner: 'toadkeeper', group: 'users' });
      m.file('/srv/frogpond/pond-note.txt', w.token(20) + '\n', { owner: 'recruit', group: 'swampers' });
      m.file('/usr/share/marsh/lore.txt', w.token(21) + '\n', tk);
      m.file('/tmp/.toad-scratch', w.token(19) + '\n', tk);
    },
    teach: [
      {
        title: '-size: how big is it?',
        body: '`-size` takes a number and a unit letter:\n\n- `c` bytes, `k` kilobytes, `M` megabytes, `G` gigabytes\n- `+N` means **bigger than** N, `-N` means **smaller than** N, a plain `N` means **exactly** N\n\n```\nfind warehouse -type f -size +2k\nfind warehouse -type f -size 777c\n```\n\nAdd `-type f` to skip folders: a folder itself always counts as 4 kilobytes.\n\nCareful: with **no** unit letter, the number counts 512-byte blocks, which is almost never what you want. For an exact byte count, always end with `c`.',
        try: ['find warehouse -type f -size +2k', 'find warehouse -type f -size -200c'],
        quiz: {
          q: 'Which command finds files of exactly 1033 bytes?',
          options: ['find . -size 1033', 'find . -size 1033c', 'find . -size +1033c'],
          answer: 1,
          explain: 'The c unit means bytes, and no plus or minus means exactly that size.',
          why: { 0: 'With no unit, find counts 512-byte blocks, so this means 1033 blocks.', 2: '+ means bigger than 1033 bytes, not equal to it.' },
        },
      },
      {
        title: '-user and -group: whose is it?',
        body: 'Every file has an owner and a group. Search by either:\n\n```\nfind warehouse -user toadkeeper\nfind / -user toadkeeper -group swampers\n```\n\nTests combine with AND, so the second command only prints files that belong to **that user and that group**.',
        try: ['find warehouse -user toadkeeper', 'find warehouse -user toadkeeper -group swampers -name "*.dat"'],
        quiz: {
          q: 'You want files owned by user bob AND group staff. Which command?',
          options: ['find / -user bob -group staff', 'find / -user bob staff', 'find / -owner bob:staff'],
          answer: 0,
          explain: 'Each test is its own option, and all of them must be true.',
          why: { 1: 'Each test needs its own flag. staff would be read as a path.', 2: 'find has no -owner. The tests are -user and -group.' },
        },
      },
      {
        title: '-empty, -mtime and -perm',
        body: '- `-empty`: files with no bytes, and folders with nothing in them\n- `-mtime +30`: modified **more than** 30 days ago. `-mtime -2` means within the last 2 days, and `-mmin -10` counts minutes\n- `-perm 600`: permissions are **exactly** `600` (read and write for the owner only). Zone 5 explains these numbers in full. `-perm -4000` means "has at least the setuid bit"\n\nTry them on the warehouse.',
        try: ['find warehouse -empty', 'find warehouse -mtime +30', 'find warehouse -perm 600'],
        after: '**Hacker\'s note:** `find / -perm -4000 2>/dev/null` lists setuid programs, and it is on every privilege-escalation checklist. Defenders use `find / -mtime -1` after a break-in to see what changed in the last day.',
        quiz: {
          q: 'What does find . -mtime -2 print?',
          options: ['Files modified within the last 2 days', 'Files modified more than 2 days ago', 'Files exactly 2 bytes long'],
          answer: 0,
          explain: 'A minus sign means "less than": younger than 2 days. +2 would be older than 2 days.',
          why: { 1: 'That would be -mtime +2.', 2: '-mtime is about time, not size. Bytes are -size.' },
        },
      },
      {
        title: 'Not (!) and -executable',
        body: 'A `!` flips the test that follows it: `! -name "*.log"` means "does not end in .log". `-executable` is true for files you are allowed to run.\n\n```\nfind warehouse/crates -type f -executable\nfind warehouse/crates -type f ! -executable\n```\n\nPut a space after the `!`.',
        try: ['find warehouse/crates -type f -executable', 'find warehouse/crates -type f ! -executable'],
        after: 'This is the heart of **OverTheWire Bandit level 5**: "human-readable, 1033 bytes in size, not executable." Combine `-type f -size 1033c ! -executable`. If more than one file survives, `file` (from Zone 1) tells you which one is plain text.',
      },
      {
        title: 'Permission denied? Hide the noise',
        body: 'Searching a whole machine means walking into folders you may not open. find complains about each one:\n\n```\nfind: \'/etc/sudoers.d\': Permission denied\n```\n\nThose complaints travel on a separate channel from the results, called **stderr** (channel number 2). Send channel 2 into `/dev/null`, the black hole, and only the real results stay on screen:\n\n```\nfind /etc -name "s*" 2>/dev/null\n```\n\nYou will learn redirection properly in Zone 4. For now: `2>/dev/null` at the end hides the errors.',
        try: ['find /etc -name "s*"', 'find /etc -name "s*" 2>/dev/null'],
        quiz: {
          q: 'What does 2>/dev/null do at the end of a find command?',
          options: ['Throws away the error messages, such as Permission denied', 'Deletes the files that cause errors', 'Runs find as root'],
          answer: 0,
          explain: 'Channel 2 carries errors. /dev/null swallows whatever is sent to it. The normal results still appear.',
          why: { 1: 'It deletes nothing. It only decides where the error text goes.', 2: 'Redirecting output never changes who you are. Only sudo does that.' },
        },
      },
      {
        title: 'Put it together, and measure space',
        body: 'This is **OverTheWire Bandit level 6** in one line:\n\n```\nfind / -user bandit7 -group bandit6 -size 33c 2>/dev/null\n```\n\nStart at `/`, test owner, group and size, and hide errors. Swap in other names and sizes for any hunt.\n\nTwo helpers for space:\n\n- `du -sh FOLDER` shows how much room a folder uses\n- `df -h` shows how full each disk is',
        try: ['du -sh warehouse', 'df -h'],
      },
    ],
    brief: 'Answer the Toad Keeper\'s riddles about the warehouse, then hunt down his hidden note on the whole server.',
    objectives: [
      { text: 'Find the files in warehouse that are bigger than 2 kilobytes (-size with a +)', check: (q) => typed(q, 'find', /-size\s+\+\d+[ckM]/) },
      { text: 'List the empty files and folders in warehouse (-empty)', check: (q) => typed(q, 'find', /-empty\b/) },
      { text: 'Find the files in warehouse not modified for more than 30 days (-mtime +30)', check: (q) => typed(q, 'find', /-mtime\s+\+\d+/) },
      { text: 'Find the files with permissions exactly 600 (-perm 600)', check: (q) => typed(q, 'find', /-perm\s+0?600\b/) },
      { text: 'In warehouse/crates, find the one file of exactly 1033 bytes that is not executable (-size 1033c and !)', check: (q) => q.any((c) => c.name === 'find' && /-size\s+1033c/.test(c.line) && /(^|\s)(!|-not)\s*-executable/.test(c.line) && c.out.includes('ledger.txt')) },
      { text: 'Read that file and submit the secret inside it', check: (q) => q.got(0) },
      { text: 'Search the whole server for a file of user toadkeeper, group swampers and exactly 21 bytes, hiding errors with 2>/dev/null', check: (q) => q.any((c) => c.name === 'find' && /find\s+\/(\s|$)/.test(c.line) && /-user\s+toadkeeper/.test(c.line) && /-group\s+swampers/.test(c.line) && /-size\s+21c/.test(c.line) && quiet.test(c.line)) },
      { text: 'Read the note you found and submit its secret', check: (q) => q.got(1) },
    ],
    hints: [
      'Each flag asks one question: -size (how big), -empty, -mtime (how old), -perm (permissions). Try them on the warehouse folder.',
      '`find warehouse -type f -size +2k`, `-empty`, `-mtime +30`, `-perm 600`. For the crates: `find warehouse/crates -type f -size 1033c ! -executable`, then `cat` the path.',
      'Then `find / -user toadkeeper -group swampers -size 21c 2>/dev/null` prints one path. `cat` it and submit the text.',
    ],
    codex: ['find', 'du', 'df'],
    realWorld: { text: 'These two hunts are OverTheWire Bandit levels 5 and 6. Read their pages now; once you have ssh (Zone 7) they take minutes. On Kali, practise: `find /usr -type f -size +1M 2>/dev/null | head`, `find / -perm -4000 2>/dev/null`, `find /var -mtime -7 2>/dev/null | head`.', bandit: [6, 7] },
    journal: 'Why does find / print so many Permission denied lines, and what does 2>/dev/null do about them?',
    solution: (s) => [
      'find warehouse -size +2k',
      'find warehouse -empty',
      'find warehouse -mtime +30',
      'find warehouse -perm 600',
      'find warehouse/crates -type f -size 1033c ! -executable',
      'cat warehouse/crates/ledger.txt',
      `submit ${s.flags[0]}`,
      'find / -user toadkeeper -group swampers -size 21c 2>/dev/null',
      'cat /var/lib/marsh/.cache/toad.note',
      `submit ${s.flags[1]}`,
    ],
  },

  {
    id: 'z3-3',
    title: 'Word Hunt',
    xp: 70,
    panel: 'map',
    story: 'A thousand lines of mud-stained text lie in the logbook. "You will not read them all," Old Root laughs. "You will teach the machine to read for you."',
    setup(w) {
      const m = w.m;
      const L = `${H}/logbook`;
      m.dir(L, o);
      const journal = [
        'Day 1: I entered the swamp at dawn. Thick mist everywhere.',
        'Day 2: Heard a frog. Or was it the Frog King?',
        'Day 3: The FROG stole my lantern. Typical.',
        'Day 4: Found a lantern floating in the pond. Mine? Nope.',
        'Day 5: Mist again. I hate the mist.',
        'Day 6: Crossed the reeds. A heron watched me.',
        'Day 7: Ate swamp stew. Do not recommend.',
        'Day 8: The frog returned my torch. We are friends now.',
        'Day 9: Rain all day. No mist, at least.',
        'Day 10: Built a raft from reeds.',
        'Day 11: Lost the raft. Found a different frog.',
        'Day 12: The heron laughed. I think.',
        'Day 13: Mist, mist, mist.',
        'Day 14: Old Root says grep is your lantern in a dark file.',
      ];
      m.file(`${L}/journal.txt`, journal.join('\n') + '\n', o);
      // Bandit 7: the secret sits next to the word "millionth" in a big file
      const tok = w.flag(32);
      const N = 1200;
      const at = 200 + Math.floor(w.rand() * 800);
      let data = '';
      for (let i = 0; i < N; i++) data += i === at ? `millionth\t${tok}\n` : `${nonsense(w)}\t${w.token(32)}\n`;
      m.file(`${L}/data.txt`, data, o);
    },
    teach: [
      {
        title: 'grep: search inside a file',
        body: '`find` looks for **files**. `grep` looks **inside** them. It prints every line that contains your pattern:\n\n```\ngrep frog logbook/journal.txt\n```\n\nThe first word is the pattern, the second is the file. grep prints whole lines, not just the word.',
        try: 'grep frog logbook/journal.txt',
        quiz: {
          q: 'What does grep frog journal.txt print?',
          options: ['Every line that contains frog', 'Only the word frog', 'The line numbers of frog'],
          answer: 0,
          explain: 'grep prints each matching line in full.',
          why: { 1: 'It prints the whole line. (grep -o prints only the match. You meet it soon.)', 2: 'Line numbers need the -n flag.' },
        },
      },
      {
        title: '-i: ignore capitals',
        body: 'grep, like the rest of Linux, is case-sensitive: `frog` does not match `FROG`. Add `-i` to ignore case. Compare how many lines come back:\n\n```\ngrep -i frog logbook/journal.txt\n```',
        try: ['grep frog logbook/journal.txt', 'grep -i frog logbook/journal.txt'],
      },
      {
        title: '-n and -c: where and how many',
        body: '- `-n` puts the **line number** in front of each match\n- `-c` prints only **how many lines** matched\n\n```\ngrep -n lantern logbook/journal.txt\ngrep -c mist logbook/journal.txt\n```\n\n`-c` counts matching **lines**, not words. A line that says "mist, mist, mist" counts once.',
        try: ['grep -n lantern logbook/journal.txt', 'grep -c mist logbook/journal.txt'],
        quiz: {
          q: 'A line contains the word mist three times. How much does it add to grep -c mist?',
          options: ['3', '1', '0'],
          answer: 1,
          explain: '-c counts lines that match, no matter how many times the pattern appears in them.',
          why: { 0: 'grep counts lines, not occurrences.', 2: 'The line matches, so it counts.' },
        },
      },
      {
        title: '-v: everything except',
        body: '`-v` **inverts** the search: it prints the lines that do **not** match.\n\n```\ngrep -v mist logbook/journal.txt\n```\n\nFlags combine, just like in ls: `grep -in frog file` is `-i` plus `-n`. `grep -ic frog file` counts matches ignoring case.',
        try: ['grep -v mist logbook/journal.txt', 'grep -ic frog logbook/journal.txt'],
        quiz: {
          q: 'Which command shows the lines that do NOT contain mist?',
          options: ['grep -v mist journal.txt', 'grep -n mist journal.txt', 'grep !mist journal.txt'],
          answer: 0,
          explain: '-v means invert the match.',
          why: { 1: '-n only adds line numbers to the matches.', 2: 'grep has no ! syntax for this. The flag is -v.' },
        },
      },
      {
        title: 'The big file: Bandit 7',
        body: 'Now the real use. `logbook/data.txt` has twelve hundred lines. Each one is a word, a tab, and a random string. Peek at the first three:',
        try: 'head -n 3 logbook/data.txt',
        after: 'You will never read a file this big by eye. Ask grep for the one line you want. **OverTheWire Bandit level 7** says the secret sits next to the word `millionth`:\n\n```\ngrep millionth data.txt\n```\n\n**Hacker\'s note:** grep is the first filter you reach for on logs, dumps and configs. Feed it a huge output and it shrinks to the lines that matter.',
      },
    ],
    brief: 'Learn to make grep read for you, then find the one line in data.txt that holds the secret.',
    objectives: [
      { text: 'Print the lines of logbook/journal.txt that contain frog', check: (q) => q.ran('grep', { arg: `${H}/logbook/journal.txt`, argMatch: /^frog$/, noFlags: 'ivnc' }) },
      { text: 'Catch the FROG hiding in capitals with -i', check: (q) => q.ran('grep', { flags: 'i', arg: `${H}/logbook/journal.txt`, argMatch: /^frog$/i }) },
      { text: 'Show which line numbers mention the lantern (-n)', check: (q) => q.ran('grep', { flags: 'n', arg: `${H}/logbook/journal.txt`, argMatch: /lantern/i }) },
      { text: 'Show every line that does NOT mention mist (-v)', check: (q) => q.ran('grep', { flags: 'v', arg: `${H}/logbook/journal.txt`, argMatch: /mist/i }) },
      { text: 'Count the lines that mention frog, ignoring case (-c and -i)', check: (q) => q.ran('grep', { flags: 'ic', arg: `${H}/logbook/journal.txt`, argMatch: /frog/i }) },
      { text: 'Find the line next to the word millionth in logbook/data.txt and submit the secret', check: (q) => q.submitted() },
    ],
    hints: [
      'grep PATTERN FILE prints matching lines. The files live in the logbook folder: logbook/journal.txt. Flags to use: -i, -n, -v, -c.',
      '`grep -n lantern logbook/journal.txt`, `grep -v mist logbook/journal.txt`, `grep -ic frog logbook/journal.txt`.',
      '`grep millionth logbook/data.txt` prints one line: the word, a tab, then the secret. Submit only the secret.',
    ],
    codex: ['grep'],
    realWorld: { text: 'This is OverTheWire Bandit level 7. On Kali: `grep -i root /etc/passwd`, `grep -n bash /etc/passwd`, `grep -vc "^#" /etc/services`.', bandit: [8] },
    journal: 'Which grep flag did you use most, and what did it change about the output?',
    solution: (s) => [
      'grep frog logbook/journal.txt',
      'grep -i frog logbook/journal.txt',
      'grep -n lantern logbook/journal.txt',
      'grep -v mist logbook/journal.txt',
      'grep -ic frog logbook/journal.txt',
      'grep millionth logbook/data.txt',
      `submit ${s.flags[0]}`,
    ],
  },

  {
    id: 'z3-4',
    title: 'Grep the Realm',
    xp: 80,
    panel: 'map',
    story: 'The realm\'s scribes wrote everything down: configs, ledgers, logs. "A good hacker never reads a whole folder," says Old Root. "He asks the whole folder one question."',
    setup(w) {
      const m = w.m;
      const R = `${H}/realm`;
      m.dir(R, o);
      m.file(`${R}/README.txt`, 'THE REALM OF OVERDRIVE\nThe scribes wrote everything down: configs, ledgers, logs.\nThe Vault Keeper\'s password is stored in a setting called vault_password.\nBeware: a line that starts with # is switched off. Only the live line counts.\n', o);
      m.file(`${R}/castle/config.ini`, '# Castle configuration\n# Lines that start with # are comments and are ignored.\n# Do not store passwords here!\nname = Castle Overdrive\nport = 8080\n# admin_password = changeme\nmode = production\n# mode = debug\nmoat = deep\n', o);
      m.file(`${R}/castle/guests.txt`, 'Sir Lancelot, room 12\nLady Guinevere, room 7\nSir Gawain, room 3\nMerlin the Wizard, room 1\nSir Kay, room 9\n', o);
      m.file(`${R}/castle/notes.txt`, 'Remember: the drawbridge squeaks.\nPassword policy: change every password each season.\nThe cook knows the secret recipe.\n', o);
      m.file(`${R}/village/ledger.txt`, '2026-10-01 sold 3 swords for gold\n2026-10-02 bought golden apples\n2026-10-03 paid the baker in gold\n2026-10-04 picked marigold flowers\n2026-10-05 gold prices fell\n2026-10-06 the golden goose is missing\n', o);
      m.file(`${R}/logs/access.log`, [
        '203.0.113.7 - - [31/Oct/2026:10:01:11] "GET /gate HTTP/1.1" 200',
        '198.51.100.23 - - [31/Oct/2026:10:01:40] "GET /moat HTTP/1.1" 200',
        '203.0.113.7 - - [31/Oct/2026:10:02:05] "GET /vault HTTP/1.1" 403',
        '192.0.2.44 - - [31/Oct/2026:10:03:18] "GET /gate HTTP/1.1" 200',
        '203.0.113.7 - - [31/Oct/2026:10:03:59] "GET /admin HTTP/1.1" 404',
        '198.51.100.23 - - [31/Oct/2026:10:04:22] "GET /tower HTTP/1.1" 200',
        '192.0.2.44 - - [31/Oct/2026:10:05:01] "GET /kitchen HTTP/1.1" 200',
        '203.0.113.7 - - [31/Oct/2026:10:05:47] "GET /dungeon HTTP/1.1" 403',
      ].join('\n') + '\n', o);
      m.file(`${R}/logs/auth.log`, [
        'Oct 31 10:01:11 gate sshd: Accepted publickey for knight from 198.51.100.23',
        'Oct 31 10:01:52 gate sshd: Failed password for root from 203.0.113.7',
        'Oct 31 10:02:03 gate door: entry denied',
        'Oct 31 10:02:44 gate sshd: Failed password for admin from 203.0.113.7',
        'Oct 31 10:03:15 gate door: entry granted',
        'Oct 31 10:04:09 gate door: entry denied',
        'Oct 31 10:05:30 gate sshd: Accepted publickey for wizard from 192.0.2.44',
      ].join('\n') + '\n', o);
      // the live vault password, a retired one in a comment, and a locked cell
      const secret = w.flag(24);
      m.file(`${R}/dungeon/vault.conf`, `# Dungeon vault settings\ndoor = iron\nguard = skeleton\nvault_password = ${secret}\n`, o);
      m.dir(`${R}/dungeon/cell`, { mode: 0o700 });
      m.file(`${R}/dungeon/cell/prisoner.txt`, 'My password is on the wall.\n', { mode: 0o600 });
      m.file(`${R}/ruins/old.conf`, `# Old vault settings (retired)\n# vault_password = ${w.token(24)}\ndoor = wood\n`, o);
      m.file(`${R}/ruins/.hidden_note`, 'The old password was scratched on the wall.\n', o);
    },
    teach: [
      {
        title: '-r and -l: search a whole folder',
        body: 'Give grep a **folder** and `-r` (recursive), and it searches every file inside, at any depth. It prefixes each match with the file name:\n\n```\ngrep -r gold realm\n```\n\nAdd `-l` (a lowercase L) to print only the **names of the files** that match, once each.\n\nSee the "Permission denied" line? One dungeon cell is locked. You will learn to silence it at the end of this quest.',
        try: ['grep -r gold realm', 'grep -rl gold realm'],
        visual: 'map',
      },
      {
        title: '-w: whole words only',
        body: 'A plain pattern matches inside longer words too. `gold` also hits `golden` and `marigold`. `-w` demands a **whole word**:\n\n```\ngrep -w gold realm/village/ledger.txt\n```',
        try: ['grep gold realm/village/ledger.txt', 'grep -w gold realm/village/ledger.txt'],
        quiz: {
          q: 'Which line does grep -w cat match?',
          options: ['the cat sat', 'category list', 'concatenate files'],
          answer: 0,
          explain: 'Only the first has cat as a standalone word. In the others it is buried inside a longer word.',
          why: { 1: 'cat is only the start of category.', 2: 'cat is in the middle of concatenate.' },
        },
      },
      {
        title: 'Patterns: ^ $ . and [ ]',
        body: 'grep patterns are **regular expressions** (regex). A few symbols carry the power:\n\n- `^` the start of a line\n- `$` the end of a line\n- `.` any one character\n- `[0-9]` one digit (`[abc]` is one of a, b or c)\n- `*` the previous thing, zero or more times\n\nQuote regex patterns in single quotes so the shell leaves them alone.\n\n```\ngrep \'^Sir\' realm/castle/guests.txt\ngrep \'denied$\' realm/logs/auth.log\ngrep -v \'^#\' realm/castle/config.ini\n```\n\nThe last one hides every comment line and shows only the live settings. You will use it constantly on config files.',
        try: ["grep '^Sir' realm/castle/guests.txt", "grep 'denied$' realm/logs/auth.log", "grep -v '^#' realm/castle/config.ini"],
        quiz: {
          q: 'Which pattern matches lines that START with Sir?',
          options: ['^Sir', 'Sir$', '.Sir'],
          answer: 0,
          explain: '^ is the start-of-line anchor.',
          why: { 1: 'Sir$ would match lines that END with Sir.', 2: '.Sir needs one extra character before Sir, anywhere in the line.' },
        },
      },
      {
        title: '-E and -o: extract just the match',
        body: '`-E` switches on **extended** regex, which adds `+` (one or more), `?` (optional) and `|` (or). `-o` prints **only the matching part** of each line, not the whole line.\n\n```\ngrep -oE \'[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+\' realm/logs/access.log\n```\n\nThis pulls out every IP address: digits, a dot, digits, a dot, and so on. The backslash makes the dot a real dot instead of "any character".',
        try: ["grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+' realm/logs/access.log", "grep -E 'denied|Failed' realm/logs/auth.log"],
        after: '**Hacker\'s note:** extracting IP addresses, e-mails and hashes out of big dumps is one of the most common jobs in an investigation.',
        quiz: {
          q: 'In grep -E, what does [0-9]+ match?',
          options: ['One or more digits in a row', 'The literal text [0-9]+', 'Exactly nine digits'],
          answer: 0,
          explain: '[0-9] is one digit and + means "one or more of the previous thing".',
          why: { 1: 'Square brackets make a character class, not literal text.', 2: '[0-9] means the digits 0 to 9. It has nothing to do with the number nine.' },
        },
      },
      {
        title: 'wc: count lines, words and bytes',
        body: '`wc` counts. `-l` lines, `-w` words, `-c` bytes. With no flag it shows all three.\n\n```\nwc -l realm/logs/access.log\n```\n\n`grep -c` counts the lines that **match**. `wc -l` counts **all** the lines.',
        try: ['wc -l realm/logs/access.log', 'wc realm/castle/guests.txt'],
      },
      {
        title: 'Hunt for secrets',
        body: 'Real admins and real attackers both do this: search a whole folder for the word *password*.\n\n```\ngrep -rn password realm 2>/dev/null\n```\n\n- `-r` goes through every file, including hidden ones\n- `-n` shows the file and the line number\n- `2>/dev/null` hides folders grep is not allowed to open\n\nWatch what the locked dungeon cell does without the last part:',
        try: ['grep -rn gold realm', 'grep -rn gold realm 2>/dev/null'],
        after: '**Hacker\'s note:** `grep -rni "password" /etc 2>/dev/null`, and the same for `api_key` or `secret`, find credentials in config files more often than you would believe. Defenders run the same search on their own servers to catch leaks before attackers do.',
      },
    ],
    brief: 'The Vault Keeper\'s password is somewhere in the realm. Learn the grep tricks, then hunt for it.',
    objectives: [
      { text: 'Search the whole realm folder for the word password with grep -r', check: (q) => q.any((c) => grepRealm(c, ['r'], /^password$/i)) },
      { text: 'Print only the names of the files that contain password (-l)', check: (q) => q.any((c) => grepRealm(c, ['r', 'l'], /^password$/i)) },
      { text: 'Show the lines of realm/village/ledger.txt with the whole word gold (-w)', check: (q) => q.ran('grep', { flags: 'w', arg: `${H}/realm/village/ledger.txt`, argMatch: /^gold$/ }) },
      { text: 'Show the live settings of realm/castle/config.ini by hiding lines that start with # (-v and ^)', check: (q) => q.ran('grep', { flags: 'v', arg: `${H}/realm/castle/config.ini`, argv: (a) => a.includes('^#') }) },
      { text: 'Pull just the IP addresses out of realm/logs/access.log (-o, -E and [0-9]+)', check: (q) => q.ran('grep', { flags: 'oE', arg: `${H}/realm/logs/access.log`, argv: (a) => a.some((x) => x.includes('[0-9]+')) }) },
      { text: 'Count the lines of realm/logs/access.log with wc -l', check: (q) => q.ran('wc', { flags: 'l', arg: `${H}/realm/logs/access.log` }) },
      { text: 'Hunt for passwords with grep -rn on the realm, hiding errors with 2>/dev/null', check: (q) => q.any((c) => grepRealm(c, ['r', 'n'], /^password$/i) && quiet.test(c.line)) },
      { text: 'Submit the live vault_password (a line starting with # is switched off)', check: (q) => q.submitted() },
    ],
    hints: [
      'A recursive search needs -r and a folder: `grep -r password realm`. Put regex patterns in single quotes.',
      '`grep -rl password realm`, `grep -w gold realm/village/ledger.txt`, `grep -v \'^#\' realm/castle/config.ini`, `wc -l realm/logs/access.log`. For IPs: `grep -oE \'[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+\' realm/logs/access.log`.',
      '`grep -rn password realm 2>/dev/null` lists every hit. The vault_password line that does NOT start with # is the live one. Submit the value after the = sign.',
    ],
    codex: ['grep', 'wc'],
    realWorld: { text: 'On Kali: `grep -rn "PermitRootLogin" /etc/ssh 2>/dev/null`, `grep -oE "[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+" /etc/hosts`, `grep -v "^#" /etc/ssh/sshd_config`, and `wc -l /etc/passwd`.' },
    journal: 'Explain in your own words what ^, $ and . mean in a grep pattern, with one example each.',
    solution: (s) => [
      'grep -r password realm',
      'grep -rl password realm',
      'grep -w gold realm/village/ledger.txt',
      "grep -v '^#' realm/castle/config.ini",
      "grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+' realm/logs/access.log",
      'wc -l realm/logs/access.log',
      'grep -rn password realm 2>/dev/null',
      `submit ${s.flags[0]}`,
    ],
  },

  {
    id: 'z3-5',
    title: 'Data Decoder',
    xp: 90,
    panel: 'map',
    story: 'Not every file is made of words. Some are junk with a secret inside, some wear a disguise, and some are forgeries. "Bytes do not lie," says Old Root. "But you have to know how to ask them."',
    setup(w) {
      const m = w.m;
      const D = `${H}/decoder`;
      m.dir(D, o);
      // Bandit 9: junk with a few readable strings; the secret follows a run of = signs
      const t0 = w.flag(32);
      const readable = w.shuffle([`========== ${t0}`, 'The swamp is deep and old', 'mode=debug', `KEY: ${w.token(32)}`, 'user=nobody', 'Do not feed the frogs']);
      let bin = junk(w, 200);
      for (const p of readable) bin += '\x00' + p + '\x00' + junk(w, 300 + Math.floor(w.rand() * 300));
      m.file(`${D}/data.bin`, bin, o);
      // Bandit 10: base64
      const t1 = w.flag(32);
      m.file(`${D}/secret.b64`, b64(`The password is ${t1}\n`), o);
      // a file in disguise
      m.file(`${D}/mystery.dat`, gzipData('The swamp was here before the shell.\n', 'swamp.txt', w.now()), o);
      // five copies of an oath, one forged
      const names = new Set();
      while (names.size < 5) names.add(`oath-${w.token(6).toLowerCase()}.txt`);
      const list = [...names];
      const forged = w.pick(list);
      w.state.flags.push(forged);
      const oath = (signer) => `THE OATH OF THE SWAMP\n\nI swear to guard every secret,\nto share no map without a guide,\nand to keep my lantern lit.\n\nSigned: ${signer}\n`;
      for (const n of list) m.file(`${D}/oaths/${n}`, oath(n === forged ? 'Old Boot' : 'Old Root'), o);
    },
    teach: [
      {
        title: 'strings: the readable bits of a binary',
        body: 'Programs, images and dumps are mostly bytes that look like garbage on screen. `strings` pulls out every run of four or more printable characters and prints them, one per line:\n\n```\nstrings decoder/data.bin\n```\n\nMost of what you see will be junk. To filter, use a **pipe** `|`, which hands one command\'s output to the next. Zone 4 teaches pipes in depth. For now, `A | B` means "run A, then give its output to B":\n\n```\nstrings data.bin | grep "=="\n```\n\nThat keeps only the strings that contain two equals signs. (grep alone refuses to print binary files: it just says "binary file matches". That is why strings exists.)',
        try: ['strings decoder/data.bin | head -n 4', 'ls decoder | wc -l'],
        quiz: {
          q: 'What does strings file print?',
          options: ['Every run of readable characters found inside the file', 'The file type', 'The size of the file in bytes'],
          answer: 0,
          explain: 'strings scans the raw bytes and prints the printable text it finds, even in a binary.',
          why: { 1: 'That is the job of the file command.', 2: 'wc -c or ls -l give the size.' },
        },
      },
      {
        title: 'base64: an encoding, not a lock',
        body: 'Base64 turns any bytes into plain letters and digits, so that data can travel through text-only places such as e-mail. It often ends with one or two `=` signs. `base64 -d` **decodes** it:\n\n```\necho Swamp | base64\necho U3dhbXAK | base64 -d\n```\n\nThis is **OverTheWire Bandit level 10**: `base64 -d data.txt`.',
        try: ['echo Swamp | base64', 'echo U3dhbXAK | base64 -d'],
        after: '**Hacker\'s note:** base64 hides nothing. Malware and CTF puzzles love it. If you see a long string of letters ending in `=` or `==`, try decoding it.',
        quiz: {
          q: 'Is base64 a safe way to keep a password secret?',
          options: ['No, anyone can decode it with base64 -d', 'Yes, it is strong encryption', 'Only if the file is also gzipped'],
          answer: 0,
          explain: 'It is an encoding with no key. Decoding takes one command.',
          why: { 1: 'Encryption needs a secret key. Base64 has none.', 2: 'Compressing the file does not lock it either.' },
        },
      },
      {
        title: 'xxd: the bytes themselves',
        body: '`xxd FILE` prints a **hexdump**: the offset, then each byte as two hex digits, then the readable text on the right. Big files scroll forever, so pipe into `head`:\n\n```\nxxd decoder/mystery.dat | head -n 2\n```\n\nThe first few bytes are the file\'s **magic numbers**, its true identity:\n\n- `1f8b`: gzip\n- `425a68` (BZh): bzip2\n- `504b0304` (PK): zip\n- `89504e47` (.PNG): PNG image\n- `7f454c46` (.ELF): a Linux program',
        try: ['xxd decoder/mystery.dat | head -n 2', 'file decoder/mystery.dat'],
        after: '**Hacker\'s note:** a file called photo.jpg that starts with `7f454c46` is not a photo. Check the magic bytes before you trust a name.',
        quiz: {
          q: 'A file begins with the bytes 7f 45 4c 46. What is it?',
          options: ['A Linux program (ELF)', 'A PNG image', 'A gzip archive'],
          answer: 0,
          explain: '7f 45 4c 46 is the ELF magic number: the byte 7f and the letters E, L, F.',
          why: { 1: 'PNG starts with 89 50 4e 47.', 2: 'gzip starts with 1f 8b.' },
        },
      },
      {
        title: 'wc -c: size in bytes',
        body: 'You met `wc` already. `wc -c` counts **bytes**, the same number as the size column of `ls -l`. It works on any file, binary or not:\n\n```\nwc -c decoder/data.bin\n```',
        try: 'wc -c decoder/data.bin',
      },
      {
        title: 'md5sum and sha256sum: fingerprints',
        body: 'A **hash** boils a file down to a short fingerprint. The same bytes always give the same hash. Change **one single character** and the hash changes completely.\n\n```\necho hello | md5sum\necho hellO | md5sum\n```\n\nTo tell whether files are identical, compare their hashes instead of reading them. `sha256sum` does the same job with a longer, stronger hash.\n\n```\nmd5sum decoder/oaths/*\n```\n\nThe `*` makes the shell hand md5sum every file in the folder.',
        try: ['echo hello | md5sum', 'echo hellO | md5sum', 'sha256sum decoder/mystery.dat'],
        after: '**Hacker\'s note:** always check a download (a Kali ISO, a tool) against the hash the publisher posts, using `sha256sum`. MD5 is broken for security, but still fine for spotting duplicates.',
        quiz: {
          q: 'Two files give the same md5sum. What does that tell you?',
          options: ['They are (almost certainly) identical', 'They have the same name', 'They were created at the same time'],
          answer: 0,
          explain: 'The hash depends only on the bytes inside the file. Names and times do not matter.',
          why: { 1: 'The name is not part of the hash.', 2: 'Timestamps are not part of the hash either.' },
        },
      },
    ],
    brief: 'Decode two secrets, peek at a disguised file, and unmask the forged oath.',
    objectives: [
      { text: 'Bandit 9: use strings on decoder/data.bin to find the readable text that follows a run of = signs, and submit it', check: (q) => q.got(0) && q.ran('strings', { arg: `${H}/decoder/data.bin` }) },
      { text: 'Bandit 10: decode decoder/secret.b64 with base64 -d and submit the password', check: (q) => q.got(1) && q.ran('base64', { flags: 'd', arg: `${H}/decoder/secret.b64` }) },
      { text: 'Peek at the first bytes of decoder/mystery.dat with xxd piped into head', check: (q) => q.ran('xxd', { piped: true, arg: `${H}/decoder/mystery.dat` }) && q.pipeline('xxd', 'head') },
      { text: 'Count the bytes in decoder/data.bin with wc -c', check: (q) => q.ran('wc', { flags: 'c', arg: `${H}/decoder/data.bin` }) },
      { text: 'Run md5sum on all five files in decoder/oaths with one command', check: (q) => q.any((c) => c.name === 'md5sum' && c.argv.slice(1).filter((a) => !a.startsWith('-')).length >= 5) },
      { text: 'Compute the sha256sum of decoder/mystery.dat', check: (q) => q.ran('sha256sum', { arg: `${H}/decoder/mystery.dat` }) },
      { text: 'Find the forged oath (the one whose hash differs) and submit its file name', check: (q) => q.got(2) },
    ],
    hints: [
      'Work with paths like decoder/data.bin. Each file needs a different tool: strings, base64, xxd, md5sum.',
      '`strings decoder/data.bin | grep "=="`, `base64 -d decoder/secret.b64`, `xxd decoder/mystery.dat | head`, `wc -c decoder/data.bin`, `md5sum decoder/oaths/*`.',
      'In the md5sum list, four hashes are identical and one is different. Submit that file name, for example oath-abc123.txt.',
    ],
    codex: ['strings', 'base64', 'xxd', 'md5sum', 'sha256sum'],
    realWorld: { text: 'These are OverTheWire Bandit levels 9 and 10. Bandit 9: `strings data.txt | grep "==="`. Bandit 10: `base64 -d data.txt`. On Kali, also try `sha256sum /usr/bin/ls` and `xxd /usr/bin/ls | head -n 2`, and look for 7f45 4c46.', bandit: [10, 11] },
    journal: 'Why is base64 not encryption, and what is a hash good for?',
    solution: (s) => [
      'strings decoder/data.bin | grep "=="',
      `submit ${s.flags[0]}`,
      'base64 -d decoder/secret.b64',
      `submit ${s.flags[1]}`,
      'xxd decoder/mystery.dat | head',
      'wc -c decoder/data.bin',
      'md5sum decoder/oaths/*',
      'sha256sum decoder/mystery.dat',
      `submit ${s.flags[2]}`,
    ],
  },

  {
    id: 'z3-boss',
    title: 'The Bandit Chief',
    xp: 180,
    panel: 'map',
    boss: { name: 'Bandit Chief', taunt: '"You sniff around my swamp, scout? My keys are buried where no one finds them," the Bandit Chief sneers.' },
    story: 'At the heart of the swamp stands the Bandit Chief\'s stronghold. He buried six keys behind six traps and planted fakes to fool scouts. Use every tool from the swamp. A wrong key costs a heart.',
    setup(w) {
      const m = w.m;
      w.state.paths = {};
      // Trap 1: Bandit 5. Only one file is readable, exactly 1033 bytes, and not executable.
      const I = `${H}/inhere`;
      const slots = [];
      for (let i = 0; i < 20; i++) for (const n of ['-file1', '.file2', 'spaces file3', 'file4', 'file5']) slots.push(`maybehere${String(i).padStart(2, '0')}/${n}`);
      const order = w.shuffle(slots);
      const put = (slot, content, mode) => m.file(`${I}/${slot}`, content, { ...o, mode });
      const key1 = w.flag(32);
      let k = 0;
      w.state.paths.k1 = order[k];
      put(order[k++], padText(key1, 1033), 0o644);
      for (let i = 0; i < 4; i++) put(order[k++], padText(w.token(32), 1033), 0o755);
      for (let i = 0; i < 3; i++) put(order[k++], junk(w, 1033), 0o644);
      for (const size of [1032, 1034, 1100, 1000]) put(order[k++], padText(w.token(32), size), 0o644);
      while (k < order.length) put(order[k++], padText(w.token(32), w.pick([700, 800, 900, 950, 1020, 1050, 1200, 1500, 2000])), w.pick([0o644, 0o755, 0o600]));

      // Trap 2: Bandit 6. Somewhere on the server: user bandit7, group bandit6, 33 bytes.
      for (const [name, uid] of [['bandit5', 11005], ['bandit6', 11006], ['bandit7', 11007]]) m.addUser(name, { uid });
      for (const d of ['/var/lib/dpkg/info', '/usr/share/doc', '/opt/chief']) m.dir(d);
      m.dir('/opt/chief-vault', { mode: 0o700 });
      m.dir('/var/lib/chief-cache', { mode: 0o700 });
      const key2 = w.flag(32);
      m.file('/var/lib/dpkg/info/bandit7.password', key2 + '\n', { owner: 'bandit7', group: 'bandit6' });
      m.file('/var/lib/dpkg/info/bandit6.password', w.token(32) + '\n', { owner: 'bandit6', group: 'bandit6' });
      m.file('/var/lib/dpkg/info/bandit7.hint', w.token(32) + '\n', { owner: 'bandit7', group: 'bandit5' });
      m.file('/var/backups/bandit7.bak', w.token(32) + '\n', { owner: 'bandit7', group: 'bandit7' });
      m.file('/usr/share/doc/bandit-notes', w.token(33) + '\n', { owner: 'bandit7', group: 'bandit6' });
      m.file('/opt/chief/stash.old', w.token(31) + '\n', { owner: 'bandit7', group: 'bandit6' });

      // Trap 3: a huge ledger. The key is next to the exact word millionth.
      const key3 = w.flag(32);
      const N = 2400;
      const lines = [];
      for (let i = 0; i < N; i++) lines.push(`${nonsense(w)}\t${w.token(32)}`);
      const idx = w.shuffle(Array.from({ length: N - 400 }, (_, i) => i + 200));
      lines[idx[0]] = `millionth\t${key3}`;
      lines[idx[1]] = `millionths\t${w.token(32)}`;
      lines[idx[2]] = `millionthly\t${w.token(32)}`;
      lines[idx[3]] = `Millionth\t${w.token(32)}`;
      lines[idx[4]] = `billionth\t${w.token(32)}`;
      m.file(`${H}/ledger/data.txt`, lines.join('\n') + '\n', o);

      // Trap 4: junk with one readable key after a run of = signs
      const key4 = w.flag(32);
      const readable = w.shuffle([`========== ${key4}`, 'The Chief was here', 'mode=debug', `KEY: ${w.token(32)}`, `token=${w.token(16)}`, 'Nothing to see in this room', `PASSWORD: ${w.token(32)}`]);
      let bin = junk(w, 400);
      for (const p of readable) bin += '\x00' + p + '\x00' + junk(w, 500 + Math.floor(w.rand() * 500));
      m.file(`${H}/cipher/data.bin`, bin, o);

      // Trap 5: only one key file matches the SHA-256 hash on the wall
      const key5 = w.flag(32);
      const labels = w.shuffle(['alpha', 'beta', 'gamma', 'delta', 'omega']);
      const real = w.pick(labels);
      w.state.paths.seal = `seals/key_${real}.txt`;
      for (const l of labels) {
        const body = `KEY: ${l === real ? key5 : w.token(32)}\n`;
        m.file(`${H}/seals/key_${l}.txt`, body, o);
        if (l === real) m.file(`${H}/seals/HASH.txt`, `The Chief's seal. The real key file has this SHA-256 hash:\n${sha256(body)}\n`, o);
      }

      // Trap 6: base64
      const key6 = w.flag(32);
      m.file(`${H}/vault/final.b64`, b64(`The final password is ${key6}\n`), o);
    },
    teach: [
      {
        title: 'Your toolkit',
        body: '- `find` with `-type`, `-size Nc`, `-user`, `-group`, `! -executable`: pick files by their traits\n- `2>/dev/null`: hide Permission denied when searching `/`\n- `file`: tell readable text from junk\n- `grep -w` and `grep -n`: pull one line out of a huge file\n- `strings FILE | grep ...`: read the text inside a binary\n- `sha256sum`: compare a fingerprint with the one on the wall\n- `base64 -d`: undo an encoding',
      },
      {
        title: 'Rules of the fight',
        body: 'Six traps, six keys. The objectives name the folder for each one. Every key you submit correctly strikes the Chief.\n\n**Careful:** the Chief planted fake keys. Some files are *almost* right: wrong size, wrong owner, executable, or a look-alike word. Make sure every test matches **before** you submit. A wrong key costs a heart, and three wrong keys end the fight.',
      },
    ],
    brief: 'Every key you submit strikes the Chief. Lose all three hearts and the stronghold resets.',
    objectives: [
      { text: 'Trap 1: in inhere, find the one file that is human-readable, 1033 bytes and not executable. Submit its key', check: (q) => q.got(0) },
      { text: 'Trap 2: somewhere on the server, find the 33-byte file owned by user bandit7 and group bandit6. Submit its key', check: (q) => q.got(1) },
      { text: 'Trap 3: in ledger/data.txt the key sits next to the exact word millionth. Submit it', check: (q) => q.got(2) },
      { text: 'Trap 4: cipher/data.bin is mostly junk. The key is the readable text that follows a run of = signs. Submit it', check: (q) => q.got(3) },
      { text: 'Trap 5: only one key file in seals matches the SHA-256 hash in seals/HASH.txt. Submit the key inside it', check: (q) => q.got(4) },
      { text: 'Trap 6: decode vault/final.b64 and submit the final password', check: (q) => q.got(5) },
    ],
    hints: [
      'Six traps, six tools: find (twice), grep -w, strings, sha256sum, base64 -d. Each objective names its folder.',
      'Trap 1: `find inhere -type f -size 1033c ! -executable`, then `file` on what is left. Trap 2: `find / -user bandit7 -group bandit6 -size 33c 2>/dev/null`. Trap 3: `grep -w millionth ledger/data.txt`.',
      'Trap 4: `strings cipher/data.bin | grep "=="`. Trap 5: `sha256sum seals/key_*.txt` and compare with `cat seals/HASH.txt`. Trap 6: `base64 -d vault/final.b64`.',
    ],
    codex: [],
    realWorld: { text: 'You now own the skills for OverTheWire Bandit levels 5, 6, 7, 9 and 10 (level 8 also needs sort and uniq from Zone 4). They need ssh, which you unlock in Zone 7, but read their pages now and keep your own notes.', bandit: [6, 7, 8, 10, 11] },
    journal: 'Which tool did you reach for first on each trap, and why?',
    solution: (s) => [
      'find inhere -type f -size 1033c ! -executable',
      `cat "inhere/${s.paths.k1}"`,
      `submit ${s.flags[0]}`,
      'find / -user bandit7 -group bandit6 -size 33c 2>/dev/null',
      'cat /var/lib/dpkg/info/bandit7.password',
      `submit ${s.flags[1]}`,
      'grep -w millionth ledger/data.txt',
      `submit ${s.flags[2]}`,
      'strings cipher/data.bin | grep "=="',
      `submit ${s.flags[3]}`,
      'cat seals/HASH.txt',
      'sha256sum seals/key_*.txt',
      `cat ${s.paths.seal}`,
      `submit ${s.flags[4]}`,
      'base64 -d vault/final.b64',
      `submit ${s.flags[5]}`,
    ],
  },
];
