// Builds a fresh world: a Kali-like machine "quest" with the player "recruit".
import { World, Machine } from './machine.js';
import { Shell } from './shell.js';
import { COMMANDS, ALSO_BINARIES, DECOR } from './commands/index.js';

export const PLAYER = 'recruit';
export const PLAYER_PASSWORD = 'quest';

const BASHRC = `# ~/.bashrc: executed by bash(1) for non-login shells.

# don't put duplicate lines or lines starting with space in the history.
HISTCONTROL=ignoreboth
HISTSIZE=1000
HISTFILESIZE=2000

# set a fancy prompt
PS1='\\u@\\h:\\w\\$ '

# enable color support of ls and also add handy aliases
alias ls='ls --color=auto'
alias grep='grep --color=auto'

# some more ls aliases
alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'
`;

const PROFILE = `# ~/.profile: executed by the command interpreter for login shells.
if [ -n "$BASH_VERSION" ]; then
    if [ -f "$HOME/.bashrc" ]; then
        . "$HOME/.bashrc"
    fi
fi

# set PATH so it includes user's private bin if it exists
if [ -d "$HOME/.local/bin" ] ; then
    PATH="$HOME/.local/bin:$PATH"
fi
`;

const OS_RELEASE = `PRETTY_NAME="Kali GNU/Linux Rolling"
NAME="Kali GNU/Linux"
VERSION_ID="2025.3"
VERSION="2025.3"
VERSION_CODENAME=kali-rolling
ID=kali
ID_LIKE=debian
HOME_URL="https://www.kali.org/"
SUPPORT_URL="https://forums.kali.org/"
BUG_REPORT_URL="https://bugs.kali.org/"
ANSI_COLOR="1;31"
`;

const WORDS = ['123456', 'password', '12345678', 'qwerty', '123456789', '12345', '1234', '111111', '1234567', 'dragon', '123123', 'baseball', 'abc123', 'football', 'monkey', 'letmein', '696969', 'shadow', 'master', '666666', 'qwertyuiop', '123321', 'mustang', '1234567890', 'michael', '654321', 'superman', '1qaz2wsx', '7777777', '121212', '000000', 'qazwsx', '123qwe', 'killer', 'trustno1', 'jordan', 'jennifer', 'zxcvbnm', 'asdfgh', 'hunter', 'buster', 'soccer', 'harley', 'batman', 'andrew', 'tigger', 'sunshine', 'iloveyou', '2000', 'charlie', 'robert', 'thomas', 'hockey', 'ranger', 'daniel', 'starwars', 'klaster', '112233', 'george', 'computer', 'michelle', 'jessica', 'pepper', '1111', 'zxcvbn', '555555', '11111111', '131313', 'freedom', '777777', 'pass', 'maggie', '159753', 'aaaaaa', 'ginger', 'princess', 'joshua', 'cheese', 'amanda', 'summer', 'love', 'ashley', 'nicole', 'chelsea', 'biteme', 'matthew', 'access', 'yankees', '987654321', 'dallas', 'austin', 'thunder', 'taylor', 'matrix'];

export function installBase(m, { player = PLAYER, password = PLAYER_PASSWORD } = {}) {
  for (const d of ['/boot', '/dev', '/etc', '/home', '/media', '/mnt', '/opt', '/run', '/srv', '/usr/bin', '/usr/sbin', '/usr/lib', '/usr/lib64', '/usr/local/bin', '/usr/local/sbin', '/usr/share/doc', '/var/log', '/var/tmp', '/var/www/html', '/var/backups', '/var/spool/cron/crontabs', '/etc/cron.d', '/etc/sudoers.d', '/etc/ssh']) m.dir(d);
  m.dir('/tmp', { mode: 0o1777 });
  m.dir('/var/tmp', { mode: 0o1777 });
  m.link('/bin', 'usr/bin');
  m.link('/sbin', 'usr/sbin');
  m.link('/lib', 'usr/lib');
  m.link('/lib64', 'usr/lib64');
  m.device('/dev/null', 'null');
  m.device('/dev/zero', 'zero');
  m.device('/dev/urandom', 'urandom');
  m.device('/dev/tty', 'tty');

  m.addGroup('root', 0);
  m.addGroup('adm', 4);
  m.addGroup('sudo', 27);
  m.addGroup('shadow', 42);
  m.addGroup('crontab', 107);
  m.addGroup('users', 100);
  m.addUser('root', { uid: 0, password: 'n0t-th1s-3asy' });
  m.addUser('daemon', { uid: 1, home: '/usr/sbin', shell: '/usr/sbin/nologin', makeHome: false });
  m.addUser('bin', { uid: 2, home: '/bin', shell: '/usr/sbin/nologin', makeHome: false });
  m.addUser('sys', { uid: 3, home: '/dev', shell: '/usr/sbin/nologin', makeHome: false });
  m.addUser('www-data', { uid: 33, home: '/var/www', shell: '/usr/sbin/nologin', makeHome: false });
  m.addUser('messagebus', { uid: 101, home: '/nonexistent', shell: '/usr/sbin/nologin', makeHome: false });
  m.addUser('nobody', { uid: 65534, home: '/nonexistent', shell: '/usr/sbin/nologin', makeHome: false });
  m.addUser(player, { uid: 1000, password, gecos: 'Recruit,,,', groups: ['users'] });
  m.dir(`/home/${player}`, { mode: 0o755, owner: player });

  const home = `/home/${player}`;
  m.file(`${home}/.bashrc`, BASHRC, { owner: player });
  m.file(`${home}/.profile`, PROFILE, { owner: player });
  m.file(`${home}/.bash_logout`, '# ~/.bash_logout: executed by bash(1) when login shell exits.\n\n# when leaving the console clear the screen to increase privacy\n', { owner: player });
  m.file('/root/.bashrc', BASHRC);

  m.file('/etc/hostname', m.hostname + '\n');
  m.file('/etc/hosts', `127.0.0.1\tlocalhost\n127.0.1.1\t${m.hostname}\n${m.ip}\t${m.hostname}.lan\n\n::1\tlocalhost ip6-localhost ip6-loopback\n`);
  m.file('/etc/os-release', OS_RELEASE);
  m.file('/etc/issue', 'Kali GNU/Linux Rolling \\n \\l\n\n');
  m.file('/etc/motd', '\nThe programs included with the Kali GNU/Linux system are free software.\n');
  m.file('/etc/shells', '# /etc/shells: valid login shells\n/bin/sh\n/usr/bin/sh\n/bin/bash\n/usr/bin/bash\n/bin/zsh\n/usr/bin/zsh\n');
  m.file('/etc/resolv.conf', 'nameserver 10.0.0.1\n');
  m.file('/etc/crontab', `# /etc/crontab: system-wide crontab
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

# Example of job definition:
# .---------------- minute (0 - 59)
# |  .------------- hour (0 - 23)
# |  |  .---------- day of month (1 - 31)
# |  |  |  .------- month (1 - 12) OR jan,feb,mar,apr ...
# |  |  |  |  .---- day of week (0 - 6) (Sunday=0 or 7)
# |  |  |  |  |
# *  *  *  *  * user-name command to be executed
17 *\t* * *\troot\tcd / && run-parts --report /etc/cron.hourly
`);
  m.file('/etc/sudoers', '#\n# This file MUST be edited with the \'visudo\' command as root.\n#\nDefaults\tenv_reset\nDefaults\tmail_badpass\nDefaults\tsecure_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"\n\n# User privilege specification\nroot\tALL=(ALL:ALL) ALL\n\n# Allow members of group sudo to execute any command\n%sudo\tALL=(ALL:ALL) ALL\n\n@includedir /etc/sudoers.d\n', { mode: 0o440 });
  m.dir('/etc/sudoers.d', { mode: 0o750 });
  m.file('/etc/ssh/sshd_config', 'Include /etc/ssh/sshd_config.d/*.conf\n#Port 22\nPermitRootLogin prohibit-password\nPubkeyAuthentication yes\nPasswordAuthentication yes\nKbdInteractiveAuthentication no\nUsePAM yes\nX11Forwarding yes\nPrintMotd no\nAcceptEnv LANG LC_*\nSubsystem\tsftp\t/usr/lib/openssh/sftp-server\n');
  m.dir('/root', { mode: 0o700 });
  m.dir('/var/spool/cron/crontabs', { mode: 0o1730, group: 'crontab' });
  m.file('/var/log/auth.log', '', { mode: 0o640, group: 'adm' });
  m.file('/var/log/syslog', '', { mode: 0o640, group: 'adm' });
  m.file('/var/www/html/index.html', '<!DOCTYPE html>\n<html><head><title>It works!</title></head>\n<body><h1>It works!</h1></body></html>\n');
  m.file('/usr/share/wordlists/rockyou.txt', WORDS.join('\n') + '\n', { fakeSize: 139921497 });
  m.file('/boot/vmlinuz-6.12.38+kali-amd64', '\x00'.repeat(64), { mode: 0o600, fakeSize: 11842504 });

  for (const [name, impl] of Object.entries(COMMANDS)) {
    if (impl.builtin && !ALSO_BINARIES.includes(name)) continue;
    if (DECOR[name]) continue;
    const mode = name === 'sudo' || name === 'su' ? 0o4755 : 0o755;
    m.binary(name, { mode });
  }
  for (const [name, d] of Object.entries(DECOR)) m.binary(name, { dir: d.dir, mode: d.mode });

  const t0 = m.bootTime;
  m.spawn({ pid: 1, ppid: 0, user: 'root', cmd: '/sbin/init splash', stat: 'Ss', cpu: 0, mem: 0.1, start: t0, cputime: 3 });
  m.spawn({ pid: 312, user: 'root', cmd: '/lib/systemd/systemd-journald', stat: 'Ss', mem: 0.2, start: t0 + 2000 });
  m.spawn({ pid: 355, user: 'root', cmd: '/lib/systemd/systemd-udevd', stat: 'Ss', mem: 0.1, start: t0 + 2500 });
  m.spawn({ pid: 602, user: 'messagebus', cmd: '/usr/bin/dbus-daemon --system --address=systemd: --nofork --nopidfile --systemd-activation --syslog-only', stat: 'Ss', start: t0 + 4000 });
  m.spawn({ pid: 610, user: 'root', cmd: '/usr/sbin/cron -f', stat: 'Ss', start: t0 + 4100 });
  m.spawn({ pid: 640, user: 'root', cmd: 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', stat: 'Ss', start: t0 + 4300 });
  m.spawn({ pid: 702, user: 'root', cmd: '/usr/sbin/rsyslogd -n -iNONE', stat: 'Ssl', start: t0 + 4500 });
  m.spawn({ pid: 1101, user: 'root', cmd: 'sshd: recruit [priv]', stat: 'Ss', start: t0 + 600000 });
  return m;
}

export function createWorld({ seed, clock, hostname = 'quest' } = {}) {
  const world = new World({ seed, clock });
  const m = new Machine(world, { hostname, ip: '10.0.0.5' });
  world.addMachine(m);
  installBase(m);
  return world;
}

// A remote box for ssh levels: base system plus its own users.
export function createRemote(world, { hostname, ip, sshPort = 22, banner = '', motd = '' }) {
  const m = new Machine(world, { hostname, ip, sshPort, banner, motd });
  world.addMachine(m);
  installBase(m, { player: 'guest', password: world.token(12) });
  return m;
}

export function createShell(world, { term, docs, machine, user = PLAYER } = {}) {
  const sh = new Shell(world, { machine: machine || world.machine('quest'), user, term, commands: COMMANDS });
  sh.docs = docs || {};
  return sh;
}

export { COMMANDS };
