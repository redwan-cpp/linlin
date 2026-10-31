// ssh and ssh-keygen against the World's virtual machines.
import { FsError, can } from '../vfs.js';
import { InterruptSignal } from '../shell.js';
import { sha256 } from '../hash.js';
import { mulberry32 } from '../util.js';

export function makeKeyPair(id, comment) {
  const priv = btoa(`openssh-key-v1\x00\x00\x00\x00\x04none\x00\x00\x00\x04none\x00\x00\x00\x00\x00\x00\x00\x01LQKEY:${id}\x00ssh-ed25519 ${id}`);
  const lines = priv.match(/.{1,70}/g).join('\n');
  return {
    priv: `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines}\n-----END OPENSSH PRIVATE KEY-----\n`,
    pub: `ssh-ed25519 ${btoa(`\x00\x00\x00\x0bssh-ed25519\x00\x00\x00 LQKEY:${id}`)} ${comment}\n`,
  };
}

export function keyIdFrom(text) {
  try {
    const priv = text.match(/-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END/);
    if (priv) return (atob(priv[1].replace(/\s+/g, '')).match(/LQKEY:(\w+)/) || [])[1] || null;
    const ids = [];
    for (const line of text.split('\n')) {
      const b = line.trim().split(/\s+/)[1];
      if (!b) continue;
      const m = atob(b).match(/LQKEY:(\w+)/);
      if (m) ids.push(m[1]);
    }
    return ids;
  } catch {
    return null;
  }
}

function fingerprint(seed) {
  return btoa(sha256(seed).slice(0, 32)).replace(/=+$/, '').slice(0, 43);
}

function randomart(seed, label) {
  const rand = mulberry32([...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7));
  const W = 17;
  const H = 9;
  const grid = Array.from({ length: H }, () => Array(W).fill(0));
  let x = 8;
  let y = 4;
  for (let i = 0; i < 64; i++) {
    x = Math.max(0, Math.min(W - 1, x + (rand() < 0.5 ? -1 : 1)));
    y = Math.max(0, Math.min(H - 1, y + (rand() < 0.5 ? -1 : 1)));
    grid[y][x]++;
  }
  const sym = ' .o+=*BOX@%&#/^';
  grid[4][8] = -1;
  grid[y][x] = -2;
  const rows = grid.map((r) => '|' + r.map((v) => (v === -1 ? 'S' : v === -2 ? 'E' : sym[Math.min(v, sym.length - 1)])).join('') + '|');
  return `+--[${label}]--+\n${rows.join('\n')}\n+----[SHA256]-----+\n`;
}

function ensureSshDir(ctx, home) {
  const dir = `${home}/.ssh`;
  if (!ctx.fs.tryGet(dir, ctx.fsCtx)) {
    const n = ctx.fs.mkdir(dir, ctx.fsCtx);
    n.mode = 0o700;
  }
  return dir;
}

export const commands = {
  ssh: {
    async fn(ctx) {
      const args = ctx.args.slice();
      let port = null;
      let identity = null;
      let user = null;
      let dest = null;
      const remote = [];
      while (args.length) {
        const a = args.shift();
        // OpenSSH also accepts options after the destination (ssh host -p 2220)
        if (dest && (remote.length || !a.startsWith('-'))) { remote.push(a); continue; }
        if (a === '-p') port = Number(args.shift());
        else if (a.startsWith('-p') && /^-p\d+$/.test(a)) port = Number(a.slice(2));
        else if (a === '-i') identity = args.shift();
        else if (a === '-l') user = args.shift();
        else if (a === '-o' || a === '-F' || a === '-J') args.shift();
        else if (a.startsWith('-')) continue;
        else dest = a;
      }
      if (!dest) {
        ctx.err('usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-B bind_interface] [-b bind_address]\n           [-c cipher_spec] [-D [bind_address:]port] [-E log_file]\n           [-i identity_file] [-l login_name] [-p port] destination [command [argument ...]]\n');
        return 255;
      }
      if (dest.includes('@')) [user, dest] = dest.split('@');
      user = user || ctx.cred.name;
      const host = dest;
      const target = ['localhost', '127.0.0.1', ctx.machine.hostname].includes(host) ? ctx.machine : ctx.world.machine(host);
      if (!target) { ctx.err(`ssh: Could not resolve hostname ${host}: Name or service not known\n`); return 255; }
      const p = port ?? 22;
      if (p !== target.sshPort) { ctx.err(`ssh: connect to host ${host} port ${p}: Connection refused\n`); return 255; }
      const home = ctx.env('HOME') || '/';
      const hostKey = p === 22 ? host : `[${host}]:${p}`;
      const kh = `${home}/.ssh/known_hosts`;
      let known = '';
      try { known = ctx.fs.read(kh, ctx.fsCtx); } catch { known = ''; }
      if (!known.split('\n').some((l) => l.split(' ')[0] === hostKey)) {
        const fp = fingerprint(target.hostname + 'hostkey');
        const ans = await ctx.term.prompt(`The authenticity of host '${hostKey} (${p === 22 ? target.ip : `[${target.ip}]:${p}`})' can't be established.\nED25519 key fingerprint is SHA256:${fp}.\nThis key is not known by any other names.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? `);
        if (ans === null) throw new InterruptSignal();
        if (ans.trim() !== 'yes') { ctx.err('Host key verification failed.\n'); return 255; }
        try {
          ensureSshDir(ctx, home);
          ctx.fs.write(kh, `${hostKey} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${fp.slice(0, 32)}\n`, ctx.fsCtx, { append: true });
        } catch { /* read-only home: keep going like ssh does */ }
        ctx.err(`Warning: Permanently added '${hostKey}' (ED25519) to the list of known hosts.\n`);
      }
      if (target.banner) ctx.out(target.banner);
      const ru = target.user(user);
      // public-key attempt
      const keyFiles = identity ? [identity] : [`${home}/.ssh/id_ed25519`, `${home}/.ssh/id_rsa`];
      let authed = false;
      for (const kf of keyFiles) {
        const node = ctx.fs.tryGet(kf, ctx.fsCtx);
        if (!node) {
          if (identity) ctx.err(`Warning: Identity file ${kf} not accessible: No such file or directory.\n`);
          continue;
        }
        if (node.mode & 0o077 && node.uid === ctx.cred.uid) {
          ctx.err(`@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\nPermissions 0${(node.mode & 0o777).toString(8)} for '${kf}' are too open.\nIt is required that your private key files are NOT accessible by others.\nThis private key will be ignored.\nLoad key "${kf}": bad permissions\n`);
          continue;
        }
        if (!can(node, ctx.cred, 'r')) { ctx.err(`Load key "${kf}": Permission denied\n`); continue; }
        const id = keyIdFrom(node.content);
        if (!id || !ru) continue;
        let authorized = ru.authorizedKeys.includes(id);
        const ak = target.fs.tryGet(`${ru.home}/.ssh/authorized_keys`);
        if (!authorized && ak && ak.type === 'file') authorized = (keyIdFrom(ak.content) || []).includes(id);
        if (authorized) { authed = true; break; }
      }
      if (!authed) {
        for (let i = 0; i < 3 && !authed; i++) {
          const pw = await ctx.term.prompt(`${user}@${host}'s password: `, { hidden: true });
          if (pw === null) throw new InterruptSignal();
          if (ru && ru.password !== null && pw === ru.password) authed = true;
          else if (i < 2) ctx.err('Permission denied, please try again.\n');
        }
        if (!authed) { ctx.err(`${user}@${host}: Permission denied (publickey,password).\n`); return 255; }
      }
      if (remote.length) {
        const frame = { ...ctx.frame, machine: target, user, euid: null, cwd: ru.home };
        return ctx.sh.runLine(remote.join(' '), frame, ctx.io);
      }
      if (target.motd) ctx.out(target.motd);
      ctx.sh.pushSession({ machine: target, user, kind: 'ssh', login: true });
      return 0;
    },
  },
  'ssh-keygen': {
    async fn(ctx) {
      const args = ctx.args.slice();
      let type = 'ed25519';
      let file = null;
      let pass = null;
      let comment = `${ctx.cred.name}@${ctx.machine.hostname}`;
      let quiet = false;
      while (args.length) {
        const a = args.shift();
        if (a === '-t') type = args.shift();
        else if (a === '-f') file = args.shift();
        else if (a === '-N') pass = args.shift();
        else if (a === '-C') comment = args.shift();
        else if (a === '-q') quiet = true;
        else if (a === '-b') args.shift();
      }
      if (!['ed25519', 'rsa'].includes(type)) { ctx.err(`unknown key type ${type}\n`); return 1; }
      const home = ctx.env('HOME') || '/';
      if (!quiet) ctx.out(`Generating public/private ${type} key pair.\n`);
      if (!file) {
        const def = `${home}/.ssh/id_${type}`;
        const ans = await ctx.term.prompt(`Enter file in which to save the key (${def}): `);
        if (ans === null) throw new InterruptSignal();
        file = ans.trim() || def;
        if (file === def) ensureSshDir(ctx, home);
      }
      if (ctx.fs.tryGet(file, ctx.fsCtx)) {
        const ans = await ctx.term.prompt(`${file} already exists.\nOverwrite (y/n)? `);
        if (!ans || !/^y/i.test(ans.trim())) return 1;
      }
      if (pass === null) {
        const p1 = await ctx.term.prompt(`Enter passphrase for "${file}" (empty for no passphrase): `, { hidden: true });
        if (p1 === null) throw new InterruptSignal();
        const p2 = await ctx.term.prompt('Enter same passphrase again: ', { hidden: true });
        if (p2 === null) throw new InterruptSignal();
        if (p1 !== p2) { ctx.err('Passphrases do not match.  Try again.\n'); return 1; }
      }
      const id = ctx.world.token(16);
      const { priv, pub } = makeKeyPair(id, comment);
      try {
        const pn = ctx.fs.write(file, priv, ctx.fsCtx);
        pn.mode = 0o600;
        const qn = ctx.fs.write(`${file}.pub`, pub, ctx.fsCtx);
        qn.mode = 0o644;
      } catch (e) {
        if (!(e instanceof FsError)) throw e;
        ctx.err(`Saving key "${file}" failed: ${e.message}\n`);
        return 1;
      }
      if (!quiet) {
        ctx.out(`Your identification has been saved in ${file}\nYour public key has been saved in ${file}.pub\nThe key fingerprint is:\nSHA256:${fingerprint(id)} ${comment}\nThe key's randomart image is:\n${randomart(id, type === 'rsa' ? 'RSA 3072' : 'ED25519 256')}`);
      }
      return 0;
    },
  },
};
