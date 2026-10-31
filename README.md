# Linux Quest

A retro pixel RPG that teaches the Linux command line. You learn by typing real commands into a terminal that behaves like bash on Kali Linux, guided by Old Root, the Sysadmin Sage, through 7 zones, 47 quests and 7 bosses. Stage 1, **The Linux Lands**, takes you from "what is a terminal?" to the skills OverTheWire Bandit expects.

Everything runs in your browser. Nothing you type can touch your real computer: the shell, the filesystem, the users and even the remote servers are simulated.

## What you will learn

| Zone | Skills | Boss |
|---|---|---|
| 1 · Terminal Town | `whoami`, `pwd`, `ls`, `cd`, paths, hidden files, `cat` `less` `head` `tail` `file`, `man` | Maze Warden |
| 2 · File Forest | `touch` `mkdir` `cp` `mv` `rm`, strange file names, wildcards, `nano`, links | Hoarder |
| 3 · Search Swamp | `find` by name, size, owner, permissions and age; `grep`; `strings` `base64` `xxd` | Bandit Chief |
| 4 · Pipe Works | redirection, pipes, `sort` `uniq` `cut` `tr` `awk` `sed` `xargs` `diff` | Log Golem |
| 5 · Permission Peaks | users and groups, rwx, `chmod` `chown`, `sudo` `su`, setuid, `umask` | Vault Keeper |
| 6 · Process Caves | `ps` `top` `kill`, signals, jobs, environment and `PATH`, aliases | Rogue Daemon |
| 7 · Remote Reaches | shell scripts, `ssh` and keys, `tar` `gzip` `bzip2`, `cron` | Bandit King |

Many quests recreate an OverTheWire Bandit level, so when you play the real thing the tricks are already familiar.

## Setup

You need [Node.js](https://nodejs.org/) 18 or newer and git. There are no dependencies to install.

```bash
git clone https://github.com/redwan-cpp/linlin.git
```

```bash
cd linlin
```

```bash
npm run build
```

This creates one self-contained file, `dist/linux-quest.html`. Open it in any modern browser (double-click it, or drag it into a browser window). To serve it instead:

```bash
python3 -m http.server 8000 --directory dist
```

Then visit http://localhost:8000/linux-quest.html.

Your progress saves in your browser automatically. It stays on that one browser and device.

### Hosted on claude.ai (optional)

The game is also built to run as a Claude artifact. There it gains three extras: progress saved to your account (so it follows you between computers), the **Oracle** hint button (Claude gives you a nudge, never the answer), and a one-click journal download. Played locally, the Oracle is hidden and the journal uses **Copy Markdown** instead. Everything else is identical.

## How to learn with it

**Pace:** about 2 hours a day gets you through Stage 1 in 3 to 4 weeks. Do one or two quests per session and finish each with its journal entry.

**Every quest has three beats:**

1. **The Scroll.** Old Root teaches one idea per card. Press **Run it** to try each example in the live terminal, and answer the quiz before moving on. Wrong answers explain themselves.
2. **The Quest.** A fresh world loads and the objectives appear on the left. They tick off as you complete them in the terminal. Some end with a flag to hand in: `submit THE_FLAG`.
3. **The Debrief.** You earn XP and Codex cards, then get a **"Do it for real"** mission to repeat the skill on a real Linux terminal (a Kali VM or PC, or a Mac terminal), and a journal question. Write the answer in your own words: explaining it is how it sticks.

**Bosses** end each zone. They combine everything in that zone, and decoy flags cost you one of three hearts. Lose all three and the arena resets.

**When you are stuck:**
- Read the error message first. The terminal prints the same errors real Linux does.
- `man COMMAND` or `COMMAND --help` work for every command in the game.
- Each quest has three hints that get more specific. Each one costs 10% of the quest's XP.
- **Re-read the lesson** brings the scroll back without losing your progress.

**The panels on the right show what the terminal is doing:**
- **Map:** a live view of the file tree, with a marker on where you are.
- **Runes:** a file's permissions as switches. Flip them to see the matching `chmod` command.
- **Pipes:** each stage of your last pipeline and the data it passed on.
- **Procs:** running processes, plus your environment variables and aliases.
- **Codex:** a card for every command you have learned. The full collection is in the **Codex** tab at the top.

**Keyboard:** Tab completes, ↑ and ↓ browse history, Ctrl+C cancels, Ctrl+L clears, Ctrl+D ends input. In `less` and `man`: Space, b, /search, q. In `nano`: Ctrl+O saves, Ctrl+X exits.

**Your journal:** the **Journal** tab collects every completed quest with your notes. **Export to Obsidian** (or **Copy Markdown**) gives you a note with properties, a section per zone and a checkbox for each real-world mission.

**After Stage 1:** play [OverTheWire Bandit](https://overthewire.org/wargames/bandit/) for real. Zone 7 already walked you through logging in.

## For developers

```bash
npm test
```

runs the engine tests and plays every quest's solution against a fresh world with two random seeds.

| Path | What it is |
|---|---|
| `src/engine/` | The simulation: virtual filesystem (`vfs.js`), bash parser and expansion, the shell, about 100 commands in `commands/`, awk, cron, the level runner |
| `src/ui/` | The game: world map, terminal, panels, screens, saves, sound, sprites |
| `src/content/` | The Codex (`codex.js`, also the `man` pages) and the levels in `levels/zone1.js` … `zone7.js` |
| `build.mjs` | A zero-dependency bundler that produces the single HTML file |
| `AUTHORING.md` | How to write new levels |

To add or change levels, read `AUTHORING.md`, then check a zone on its own with:

```bash
node tests/zonecheck.mjs 3
```

**Known limits of the simulated shell:** no heredocs (`<<`), no `case`, no shell functions. Compression is simulated, with the real magic bytes but not real deflate.
