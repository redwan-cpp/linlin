# Linux Quest — build plan

Stage 1 "The Linux Lands": 7 zones, 47 levels, retro pixel RPG, private claude.ai artifact.
Live: https://claude.ai/artifact/5S6sjwD8tnrht89bruvw5z (version 2)

## Milestone 1 — playable Zones 1–2
- [x] Project + zero-dependency bundler (`build.mjs`)
- [x] Engine: virtual filesystem, parser, expansion, shell, ~100 commands
- [x] Engine unit tests (`npm test`)
- [x] UI: world map, terminal, Scroll/Quest/Debrief, panels (Map, Runes, Pipes, Procs, Codex)
- [x] Save (db + local backup), Oracle hints (sample), journal export (downloads)
- [x] Zones 1–2 content + Codex entries
- [x] Level solvability tests
- [x] Browser playthrough (desktop + phone width)
- [x] Publish

## Milestone 2 — Zones 3–7
- [x] Zone content by sonnet subagents (one per zone, `AUTHORING.md`, `tests/zonecheck.mjs N`)
- [x] Review for accuracy and fun; engine gaps they reported fixed with regression tests
- [x] Full test run (173/173), republish to the same link

## Wrap-up
- [x] Roadmap 1.1 points to Linux Quest
- [x] Review section below

## Review
**Shipped:** engine (bash subset + ~100 GNU-style commands, permissions, sudo/su/setuid, ssh between virtual machines, cron, archives), retro-RPG UI, 47 levels across 7 zones, Codex/man pages, journal with Obsidian export, db-backed saves.

**Verified:** `npm test` = 24 engine tests + every level solved from a fresh world with two seeds + boss heart checks (173 passing). Browser playthrough of quests 1–2, a boss fight, nano, man, ssh prompts and the panels on desktop and phone widths.

**Not verified:** the Oracle (sample), cloud saves (db) and journal download only run inside claude.ai; nobody has played there yet (players collection empty).

**Bugs found and fixed during review:** sudo checked the setuid identity, `while read` looped forever, find -exec gave children an empty stdin, overlays/prompts focused a tick late, prompts lost their question text and kept old answers in the input, process names with brackets, ps -u, nohup jobs, STOP/CONT, `.`, bash -c env leakage, tr operands, sed -i.bak, setgid inheritance, tar multi-layer shortcut, try-it state leaking into quests (quests now start in a fresh world), the Map panel giving away file sizes.

**Known limits:** no heredocs, `case` or shell functions; awk `for (k in a)` iterates in insertion order; compression is simulated (real magic bytes, not real deflate).

**Next:** Stage 2 (networking) when Stage 1 is done.
