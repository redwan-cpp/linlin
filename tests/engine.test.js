import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './harness.js';
import { createRemote } from '../src/engine/setup.js';
import { cronTick } from '../src/engine/cron.js';
import { COMMANDS } from '../src/engine/commands/index.js';
import { md5, sha256, sha1 } from '../src/engine/hash.js';

const BS = '\\';

test('identity and navigation', async () => {
  const { run } = setup();
  assert.equal(await run('whoami'), 'recruit\n');
  assert.equal(await run('pwd'), '/home/recruit\n');
  assert.equal(await run('cd /etc; pwd; cd -'), '/etc\n/home/recruit\n');
  assert.equal(await run('cd ..; pwd; cd ~; pwd'), '/home\n/home/recruit\n');
  assert.match(await run('cd /nope'), /bash: cd: \/nope: No such file or directory/);
  assert.match(await run('cd /root'), /bash: cd: \/root: Permission denied/);
  assert.match(await run('cd /etc/hostname'), /Not a directory/);
});

test('quoting, variables, expansion', async () => {
  const { run } = setup();
  assert.equal(await run('echo "a  b"   c'), 'a  b c\n');
  assert.equal(await run("echo '$HOME' \"$HOME\""), '$HOME /home/recruit\n');
  assert.equal(await run('X=5; echo $((X*2)) ${X} ${Y:-def} ${#X}'), '10 5 def 1\n');
  assert.equal(await run('echo {a,b}{1,2} {01..03}'), 'a1 a2 b1 b2 01 02 03\n');
  assert.equal(await run('echo $(echo inner) `echo tick`'), 'inner tick\n');
  assert.equal(await run(`echo a${BS} b`), 'a b\n');
  assert.equal(await run('false; echo $?; true; echo $?'), '1\n0\n');
  assert.equal(await run('echo -n hi; echo -e "x\\ty"'), 'hix\ty\n');
});

test('globs and hidden files', async () => {
  const { run } = setup();
  await run('mkdir g; cd g; touch a.txt b.txt c.log .hidden');
  assert.equal(await run('echo *.txt'), 'a.txt b.txt\n');
  assert.equal(await run('echo ?.log'), 'c.log\n');
  assert.equal(await run('echo [ab].*'), 'a.txt b.txt\n');
  assert.equal(await run('echo *.zip'), '*.zip\n');
  assert.equal(await run('echo .h*'), '.hidden\n');
  assert.equal(await run('ls'), 'a.txt  b.txt  c.log\n');
  assert.equal(await run('ls -A'), 'a.txt  b.txt  c.log  .hidden\n'); // en_US collation ignores the dot
});

test('ls -l format and quoting of odd names', async () => {
  const { run } = setup();
  await run('echo hi > f; mkdir d; touch "sp ace" ./-dash');
  const out = await run('ls -l f');
  assert.match(out, /^-rw-r--r-- 1 recruit recruit 3 \w{3} [ \d]\d \d\d:\d\d f\n$/);
  assert.match(await run('ls'), /'sp ace'/);
  assert.match(await run('ls | cat'), /^sp ace$/m);
  assert.equal(await run(`cat ./-dash; cat -- -dash; echo ok`), 'ok\n');
});

test('redirection and pipes', async () => {
  const { run } = setup();
  assert.equal(await run('echo one > f; echo two >> f; cat f'), 'one\ntwo\n');
  assert.equal(await run('cat nope 2>/dev/null; echo done'), 'done\n');
  assert.equal(await run('cat nope f 2>&1 | head -1'), 'cat: nope: No such file or directory\n');
  assert.equal(await run('wc -l < f'), '2\n');
  assert.equal(await run('printf "b\\na\\nb\\n" | sort | uniq -c | sort -rn | head -1'), '      2 b\n');
  assert.equal(await run('cat f | tee g | wc -l; cat g'), '2\none\ntwo\n');
  assert.equal(await run('echo x > /etc/passwd'), 'bash: /etc/passwd: Permission denied\n');
});

test('text tools', async () => {
  const { run } = setup();
  await run('printf "alice:30:admin\\nbob:25:user\\ncarol:35:user\\n" > p');
  assert.equal(await run('cut -d: -f1,3 p'), 'alice:admin\nbob:user\ncarol:user\n');
  assert.equal(await run('sort -t: -k2 -n p | head -1'), 'bob:25:user\n');
  assert.equal(await run("awk -F: '$2 > 28 {print $1}' p"), 'alice\ncarol\n');
  assert.equal(await run("awk -F: '{s+=$2} END {print s, NR}' p"), '90 3\n');
  assert.equal(await run("awk -F: '{c[$3]++} END {for (k in c) print k, c[k]}' p"), 'admin 1\nuser 2\n');
  assert.equal(await run("sed 's/user/member/g' p | tail -1"), 'carol:35:member\n');
  assert.equal(await run("sed -n '2p' p"), 'bob:25:user\n');
  assert.equal(await run('grep -c user p; grep -v user p; grep -n carol p'), '2\nalice:30:admin\n3:carol:35:user\n');
  assert.equal(await run('grep -i ALICE p'), 'alice:30:admin\n');
  assert.equal(await run("echo 'Uryyb' | tr 'A-Za-z' 'N-ZA-Mn-za-m'"), 'Hello\n');
  assert.equal(await run('echo hello | tr a-z A-Z; echo aabbcc | tr -d b; echo "a   b" | tr -s " "'), 'HELLO\naacc\na b\n');
  assert.equal(await run('head -n 1 p; tail -n 1 p; tail -n +3 p'), 'alice:30:admin\ncarol:35:user\ncarol:35:user\n');
  assert.equal(await run('wc p'), ' 3  3 41 p\n');
  assert.equal(await run('echo hi | base64; echo aGkK | base64 -d'), 'aGkK\nhi\n');
  assert.equal(await run('echo hi | xxd'), '00000000: 6869 0a                                  hi.\n');
  assert.equal(await run('echo hi | xxd | xxd -r'), 'hi\n');
  assert.equal(await run('printf "a\\nb\\n" > x; printf "a\\nc\\n" > y; diff x y'), '2c2\n< b\n---\n> c\n');
  assert.equal(await run('seq 3 | xargs echo n'), 'n 1 2 3\n');
  assert.equal(await run('echo "abc 1234 x" | grep -oE "[0-9]+"'), '1234\n');
});

test('find', async () => {
  const { run, m } = setup();
  m.file('/srv/a/one.txt', 'x'.repeat(1033), { owner: 'recruit', mode: 0o640 });
  m.file('/srv/a/two.txt', 'hi', { owner: 'root', mode: 0o755 });
  m.dir('/srv/locked', { mode: 0o700 });
  assert.equal(await run('find /srv -name "*.txt" 2>/dev/null | sort'), '/srv/a/one.txt\n/srv/a/two.txt\n');
  assert.equal(await run('find /srv -type f -size 1033c 2>/dev/null'), '/srv/a/one.txt\n');
  assert.equal(await run('find /srv -user root -type f 2>/dev/null'), '/srv/a/two.txt\n');
  assert.equal(await run('find /srv -type f ! -executable 2>/dev/null'), '/srv/a/one.txt\n');
  assert.equal(await run('find /srv -perm -u+x -type f 2>/dev/null'), '/srv/a/two.txt\n');
  assert.match(await run('find /srv'), /find: ‘\/srv\/locked’: Permission denied/);
  assert.doesNotMatch(await run('find /srv 2>/dev/null'), /Permission denied/);
  assert.equal(await run(`find /srv -name two.txt -exec cat {} ${BS}; 2>/dev/null`), 'hi');
});

test('permissions, chmod, chown', async () => {
  const { run } = setup();
  await run('echo s > s.sh');
  assert.match(await run('./s.sh'), /Permission denied/);
  await run('chmod u+x s.sh');
  assert.equal(await run('stat -c "%a %A" s.sh'), '744 -rwxr--r--\n');
  await run('chmod 640 s.sh');
  assert.equal(await run('stat -c %a s.sh'), '640\n');
  await run('chmod go=,u=rwx s.sh');
  assert.equal(await run('stat -c %A s.sh'), '-rwx------\n');
  assert.match(await run('chown root s.sh'), /Operation not permitted/);
  assert.match(await run('chmod 777 /etc/passwd'), /Operation not permitted/);
});

test('sudo and su', async () => {
  const { run, m } = setup();
  assert.match(await run('sudo whoami', ['quest']), /recruit is not in the sudoers file/);
  m.sudoers.push({ who: 'recruit', runas: 'root', cmds: ['/usr/bin/cat'], nopasswd: false });
  assert.match(await run('sudo cat /etc/shadow', ['wrong', 'quest']), /Sorry, try again\.[\s\S]*root:\$y\$/);
  assert.match(await run('sudo whoami'), /not allowed to execute '\/usr\/bin\/whoami'/);
  assert.match(await run('sudo -l'), /\(root\) \/usr\/bin\/cat/);
  m.user('root').password = 'toor';
  await run('su', ['toor']);
  assert.equal(await run('whoami'), 'root\n');
  await run('exit');
  assert.equal(await run('whoami'), 'recruit\n');
});

test('setuid binaries and shell escapes', async () => {
  const { run, m, sh } = setup();
  m.fs.tryGet('/usr/bin/find').mode = 0o4755;
  await run(`find . -exec /bin/sh -p ${BS}; -quit`);
  assert.equal(await run('whoami'), 'root\n');
  assert.match(await run('id'), /euid=0\(root\)/);
  await run('exit');
  await run(`find . -exec /bin/sh ${BS}; -quit`);
  assert.equal(await run('whoami'), 'recruit\n');
  assert.equal(sh.sessions.length, 2);
});

test('PATH hijack', async () => {
  const { run } = setup();
  await run("mkdir -p ~/bin; printf '#!/bin/bash\\necho HIJACKED\\n' > ~/bin/ls; chmod +x ~/bin/ls");
  assert.notEqual(await run('ls'), 'HIJACKED\n');
  await run('export PATH=~/bin:$PATH');
  assert.equal(await run('ls'), 'HIJACKED\n');
  assert.equal(await run('which ls'), '/home/recruit/bin/ls\n');
});

test('scripts with args, if, for, while read', async () => {
  const { run } = setup();
  await run(`printf '#!/bin/bash\\nif [ "$1" = go ]; then for i in $(seq 1 $2); do echo "step $i"; done; else echo "usage: $0 go N"; exit 3; fi\\n' > r.sh; chmod +x r.sh`);
  assert.equal(await run('./r.sh go 2'), 'step 1\nstep 2\n');
  assert.equal(await run('./r.sh; echo $?'), 'usage: ./r.sh go N\n3\n');
  assert.equal(await run('printf "x 1\\ny 2\\n" | while read a b; do echo "$b-$a"; done'), '1-x\n2-y\n');
});

test('ssh, known_hosts, keys', async () => {
  const { run, world } = setup();
  const r = createRemote(world, { hostname: 'bandit.labs', ip: '10.0.0.9', sshPort: 2220, banner: 'BANNER\n', motd: 'MOTD\n' });
  r.addUser('bandit0', { uid: 11000, password: 'bandit0' });
  assert.match(await run('ssh bandit0@bandit.labs'), /port 22: Connection refused/);
  assert.match(await run('ssh bandit0@bandit.labs -p 2220', ['yes', 'nope', 'bandit0']), /Permanently added[\s\S]*Permission denied, please try again[\s\S]*MOTD/);
  assert.equal(await run('whoami; hostname'), 'bandit0\nbandit.labs\n');
  assert.match(await run('exit'), /Connection to bandit.labs closed/);
  await run('ssh-keygen -f ~/k -N ""');
  const pub = await run('cat ~/k.pub');
  r.file('/home/bandit0/.ssh/authorized_keys', pub, { owner: 'bandit0', mode: 0o600 });
  await run('chmod 644 ~/k');
  assert.match(await run('ssh -i ~/k bandit0@bandit.labs -p 2220', ['x', 'x', 'x']), /UNPROTECTED PRIVATE KEY FILE[\s\S]*Permission denied \(publickey,password\)/);
  await run('chmod 600 ~/k');
  assert.match(await run('ssh -i ~/k bandit0@bandit.labs -p 2220'), /MOTD/);
  assert.equal(await run('whoami'), 'bandit0\n');
});

test('archives and compression', async () => {
  const { run } = setup();
  await run('mkdir pack; echo data > pack/a; tar -czf p.tgz pack; rm -r pack; tar -xzf p.tgz');
  assert.equal(await run('cat pack/a'), 'data\n');
  assert.equal(await run('tar -tf p.tgz'), 'pack/\npack/a\n');
  await run('echo hello > h; gzip h');
  assert.match(await run('file h.gz'), /gzip compressed data, was "h"/);
  await run('gunzip h.gz');
  assert.equal(await run('cat h'), 'hello\n');
  await run('echo z > z; bzip2 z; mv z.bz2 zz');
  assert.match(await run('bunzip2 zz'), /Can't guess original name for zz -- using zz.out/);
  assert.equal(await run('cat zz.out'), 'z\n');
  assert.match(await run('gunzip zz.out'), /unknown suffix -- ignored/);
});

test('jobs and signals', async () => {
  const { run, m } = setup();
  assert.match(await run('sleep 100 &'), /^\[1\] \d+\n$/);
  assert.match(await run('jobs'), /\[1\]\+  Running {17}sleep 100 &/);
  assert.match(await run('kill %1'), /Terminated/);
  const p = m.spawn({ user: 'recruit', cmd: '/usr/bin/miner --stealth', cpu: 97, onTerm: 'ignore' });
  await run(`kill ${p.pid}`);
  assert.ok(m.proc(p.pid), 'process ignores SIGTERM');
  await run(`kill -9 ${p.pid}`);
  assert.equal(m.proc(p.pid), null);
  assert.match(await run('kill 1'), /Operation not permitted/);
  assert.match(await run('ps aux | grep -c init'), /1/);
});

test('cron runs due jobs', async () => {
  const { world, m } = setup();
  m.file('/etc/cron.d/demo', '* * * * * root echo ran > /tmp/proof\n');
  const ran = await cronTick(world, COMMANDS, {});
  assert.equal(ran.length, 1);
  assert.equal(m.fs.tryGet('/tmp/proof').content, 'ran\n');
});

test('nano edits through the overlay', async () => {
  const { run, term } = setup({ edit: (c) => c + 'new line\n' });
  await run('nano notes.txt');
  assert.equal(term.overlays[0].type, 'editor');
  assert.equal(await run('cat notes.txt'), 'new line\n');
});

test('hashes match known vectors', () => {
  assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(sha1('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('syntax errors and continuations', async () => {
  const { sh, run } = setup();
  assert.match(await run('| grep x'), /syntax error near unexpected token `\|'/);
  assert.deepEqual(await sh.run('echo "open'), { incomplete: true });
  assert.deepEqual(await sh.run('if true; then'), { incomplete: true });
  assert.match(await run('nosuchcmd'), /nosuchcmd: command not found/);
});

test('tab completion', () => {
  const { sh } = setup();
  sh.s.machine.file('/home/recruit/secret notes.txt', 'x', { owner: 'recruit' });
  assert.equal(sh.complete('whoa').replacement, 'whoami ');
  assert.deepEqual(sh.complete('who').options.map((o) => o.label), ['who', 'whoami']);
  assert.equal(sh.complete('cat sec').replacement, 'secret\\ notes.txt ');
  assert.equal(sh.complete('cd /et').replacement, '/etc/');
});

test('process names, ps -u, nohup jobs, STOP/CONT (reported by zone 6 author)', async () => {
  const { run, m } = setup();
  const k = m.spawn({ user: 'recruit', cmd: '[kworker/0:2-events]', tty: '?', cpu: 90 });
  assert.equal(await run('pgrep kworker'), `${k.pid}\n`);
  assert.match(await run('ps -u recruit'), new RegExp(`${k.pid} \\?`));
  assert.match(await run('ps -ef | grep -c kworker'), /1/);
  assert.match(await run('nohup sleep 100 &'), /^\[1\] \d+/);
  assert.match(await run('jobs'), /Running {16}nohup sleep 100 &|Running/);
  await run('kill -STOP %1');
  assert.match(await run('jobs'), /Stopped/);
  await run('bg %1');
  assert.match(await run('jobs'), /Running/);
});

test('dot-source and child shells see only exported variables', async () => {
  const { run } = setup();
  await run('echo "GREETING=hi" > vars.sh');
  await run('. ./vars.sh');
  assert.equal(await run('echo $GREETING'), 'hi\n');
  assert.equal(await run('SECRET=x; bash -c "echo [$SECRET]"'), '[x]\n'); // expanded by the outer shell first
  assert.equal(await run(`SECRET=x; bash -c 'echo [$SECRET]'`), '[]\n');
  assert.equal(await run(`export SECRET; bash -c 'echo [$SECRET]'`), '[x]\n');
});

test('tr operands, sed backups, tac/paste/column (reported by zone 4 author)', async () => {
  const { run } = setup();
  assert.match(await run('tr a-z A-Z /etc/hostname'), /tr: extra operand '\/etc\/hostname'/);
  await run('printf "b 2\\na 1\\n" > f; sed -i.bak "s/a/z/" f');
  assert.equal(await run('cat f; cat f.bak'), 'b 2\nz 1\nb 2\na 1\n');
  assert.equal(await run('tac f'), 'z 1\nb 2\n');
  assert.equal(await run('paste -sd, f'), 'b 2,z 1\n');
  assert.equal(await run('printf "aa:1\\nb:22\\n" | column -t -s:'), 'aa  1\nb   22\n');
});

test('setgid folders pass their group to new files (reported by zone 5 author)', async () => {
  const { run, m } = setup();
  m.addGroup('crew', 2001, ['recruit']);
  m.dir('/srv/shared', { owner: 'recruit', group: 'crew', mode: 0o2775 });
  await run('touch /srv/shared/note; mkdir /srv/shared/sub');
  assert.equal(await run('stat -c "%G %A" /srv/shared/note /srv/shared/sub'), 'crew -rw-r--r--\ncrew drwxr-sr-x\n');
});
