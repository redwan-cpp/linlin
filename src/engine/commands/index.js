// Registry of every command the engine implements.
import { commands as core } from './core.js';
import { commands as files } from './files.js';
import { commands as text } from './text.js';
import { commands as find } from './find.js';
import { commands as perms } from './perms.js';
import { commands as system } from './system.js';
import { commands as net } from './net.js';
import { commands as archive } from './archive.js';
import { commands as cron } from '../cron.js';

export const COMMANDS = { ...core, ...files, ...text, ...find, ...perms, ...system, ...net, ...archive, ...cron };

// Builtins that also ship as real binaries in /usr/bin on Debian.
export const ALSO_BINARIES = ['echo', 'pwd', 'kill', 'test', '[', 'true', 'false', 'printf', 'env'];

// Binaries that exist for realism (setuid scan results, ps output) but just print a short notice.
export const DECOR = {
  passwd: { dir: '/usr/bin', mode: 0o4755, msg: 'passwd: Authentication token manipulation error\npasswd: password unchanged\n' },
  mount: { dir: '/usr/bin', mode: 0o4755, msg: '/dev/sda1 on / type ext4 (rw,relatime,errors=remount-ro)\nproc on /proc type proc (rw,nosuid,nodev,noexec,relatime)\ntmpfs on /run type tmpfs (rw,nosuid,nodev,noexec,relatime,size=812536k,mode=755)\n' },
  umount: { dir: '/usr/bin', mode: 0o4755, msg: 'umount: bad usage\nTry \'umount --help\' for more information.\n' },
  chsh: { dir: '/usr/bin', mode: 0o4755, msg: 'Password: \nchsh: PAM: Authentication failure\n' },
  chfn: { dir: '/usr/bin', mode: 0o4755, msg: 'Password: \nchfn: PAM: Authentication failure\n' },
  gpasswd: { dir: '/usr/bin', mode: 0o4755, msg: 'Usage: gpasswd [option] GROUP\n' },
  newgrp: { dir: '/usr/bin', mode: 0o4755, msg: '' },
  pkexec: { dir: '/usr/bin', mode: 0o4755, msg: 'pkexec --version |\n       --help |\n       --disable-internal-agent |\n       [--keep-cwd] [--user username] PROGRAM [ARGUMENTS...]\n' },
  sshd: { dir: '/usr/sbin', mode: 0o755, msg: 'sshd re-exec requires execution with an absolute path\n' },
  cron: { dir: '/usr/sbin', mode: 0o755, msg: 'cron: can\'t lock /var/run/crond.pid, otherpid may be 610: Resource temporarily unavailable\n' },
  rsyslogd: { dir: '/usr/sbin', mode: 0o755, msg: 'rsyslogd: pidfile \'/run/rsyslogd.pid\' and pid 702 already exist.\n' },
  nmap: { dir: '/usr/bin', mode: 0o755, msg: 'Starting Nmap 7.95 ( https://nmap.org )\nNmap belongs to Stage 2 (The Network Coast). Your scanner will unlock there.\n' },
  python3: { dir: '/usr/bin', mode: 0o755, msg: 'Python 3.13.7 — the Python realm opens in a later stage. For now, stay sharp with the shell.\n' },
};

for (const [name, d] of Object.entries(DECOR)) {
  if (!COMMANDS[name]) COMMANDS[name] = { hidden: true, fn(ctx) { ctx.out(d.msg); return 1; } };
}
