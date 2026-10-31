// Cron: the crontab command and a scheduler tick that runs due jobs on every machine.
import { Shell, headlessTerm, InterruptSignal } from './shell.js';
import { FsError } from './vfs.js';

function fieldMatches(field, value, min) {
  return field.split(',').some((part) => {
    const [range, stepStr] = part.split('/');
    const step = stepStr ? Number(stepStr) : 1;
    let lo;
    let hi;
    if (range === '*') { lo = min; hi = 99; } else if (range.includes('-')) [lo, hi] = range.split('-').map(Number);
    else { lo = Number(range); hi = stepStr ? 99 : lo; }
    return value >= lo && value <= hi && (value - lo) % step === 0;
  });
}

export function scheduleMatches(spec, date) {
  const alias = { '@hourly': '0 * * * *', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@weekly': '0 0 * * 0', '@monthly': '0 0 1 * *', '@yearly': '0 0 1 1 *' };
  if (spec === '@reboot') return false;
  const f = (alias[spec] || spec).split(/\s+/);
  return fieldMatches(f[0], date.getUTCMinutes(), 0) && fieldMatches(f[1], date.getUTCHours(), 0)
    && fieldMatches(f[2], date.getUTCDate(), 1) && fieldMatches(f[3], date.getUTCMonth() + 1, 1)
    && fieldMatches(f[4], date.getUTCDay(), 0);
}

// Parse crontab text. withUser: /etc/crontab and /etc/cron.d style lines carry a user field.
export function parseCrontab(text, withUser) {
  const jobs = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || /^[A-Za-z_]\w*=/.test(line)) continue;
    const parts = line.split(/\s+/);
    const at = parts[0].startsWith('@');
    const n = at ? 1 : 5;
    if (parts.length < n + (withUser ? 2 : 1)) return null;
    const spec = parts.slice(0, n).join(' ');
    const user = withUser ? parts[n] : null;
    const cmd = parts.slice(n + (withUser ? 1 : 0)).join(' ');
    jobs.push({ spec, user, cmd });
  }
  return jobs;
}

function collectJobs(m) {
  const jobs = [];
  const sys = m.fs.tryGet('/etc/crontab');
  if (sys && sys.type === 'file') for (const j of parseCrontab(sys.content, true) || []) jobs.push(j);
  const dir = m.fs.tryGet('/etc/cron.d');
  if (dir && dir.type === 'dir') {
    for (const [, f] of dir.children) if (f.type === 'file') for (const j of parseCrontab(f.content, true) || []) jobs.push(j);
  }
  for (const [user, text] of m.crontabs) for (const j of parseCrontab(text, false) || []) jobs.push({ ...j, user });
  return jobs;
}

// Advance cron by one virtual minute and run every due job. Returns the jobs that ran.
export async function cronTick(world, commands, docs) {
  const base = Math.floor(world.now() / 60000) * 60000;
  const date = new Date(base + world.cronMinute * 60000);
  world.cronMinute++;
  const ran = [];
  const seen = new Set();
  for (const m of world.machines.values()) {
    if (seen.has(m)) continue;
    seen.add(m);
    for (const job of collectJobs(m)) {
      if (!job.user || !m.user(job.user) || !scheduleMatches(job.spec, date)) continue;
      const sh = new Shell(world, { machine: m, user: job.user, term: headlessTerm, commands });
      sh.docs = docs;
      sh.s.interactive = false;
      sh.s.vars.set('PATH', '/usr/bin:/bin');
      sh.s.cwd = m.user(job.user).home;
      try { await sh.run(job.cmd, { record: false }); } catch (e) { if (!(e instanceof InterruptSignal)) throw e; }
      ran.push({ host: m.hostname, ...job });
    }
  }
  world.events.emit('cron', ran);
  return ran;
}

const TEMPLATE = `# Edit this file to introduce tasks to be run by cron.
#
# Each task to run has to be defined through a single line
# indicating with different fields when the task will be run
# and what command to run for the task
#
# m h  dom mon dow   command
# */5 * * * * /home/recruit/backup.sh
`;

export const commands = {
  crontab: {
    async fn(ctx) {
      const args = ctx.args.slice();
      let user = ctx.cred.name;
      let mode = null;
      let file = null;
      while (args.length) {
        const a = args.shift();
        if (a === '-u') user = args.shift();
        else if (a === '-l' || a === '-e' || a === '-r') mode = a[1];
        else file = a;
      }
      const m = ctx.machine;
      if (user !== ctx.cred.name && ctx.cred.uid !== 0) { ctx.err('must be privileged to use -u\n'); return 1; }
      if (!m.user(user)) { ctx.err(`crontab: user '${user}' unknown\n`); return 1; }
      const spool = `/var/spool/cron/crontabs/${user}`;
      const install = (text) => {
        if (parseCrontab(text, false) === null) {
          ctx.err('crontab: errors in crontab file, can\'t install.\n');
          return 1;
        }
        m.crontabs.set(user, text);
        m.file(spool, text, { mode: 0o600, owner: user, group: 'crontab' });
        return 0;
      };
      if (mode === 'l') {
        if (!m.crontabs.has(user)) { ctx.err(`no crontab for ${user}\n`); return 1; }
        ctx.out(m.crontabs.get(user));
        return 0;
      }
      if (mode === 'r') {
        if (!m.crontabs.has(user)) { ctx.err(`no crontab for ${user}\n`); return 1; }
        m.crontabs.delete(user);
        m.remove(spool);
        return 0;
      }
      if (mode === 'e') {
        if (!m.crontabs.has(user)) ctx.out(`no crontab for ${user} - using an empty one\n`);
        let result = 0;
        await ctx.term.overlay({
          type: 'editor',
          path: `/tmp/crontab.${ctx.world.token(6)}/crontab`,
          content: m.crontabs.get(user) ?? TEMPLATE,
          note: 'Editing your crontab. Save with Ctrl+O, exit with Ctrl+X.',
          save(text) {
            result = install(text);
            return result ? { ok: false, msg: 'errors in crontab file' } : { ok: true, msg: 'crontab saved' };
          },
        });
        if (!result) ctx.out('crontab: installing new crontab\n');
        return result;
      }
      if (file) {
        try { return install(ctx.fs.read(file, ctx.fsCtx)); } catch (e) {
          if (!(e instanceof FsError)) throw e;
          ctx.err(`${file}: ${e.message}\n`);
          return 1;
        }
      }
      ctx.err(`usage:\tcrontab [-u user] file\n\tcrontab [ -u user ] [ -i ] { -e | -l | -r }\n\t\t(default operation is replace, per 1003.2)\n\t-e\t(edit user's crontab)\n\t-l\t(list user's crontab)\n\t-r\t(delete user's crontab)\n`);
      return 1;
    },
  },
};
