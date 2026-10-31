// Zero-dependency bundler: turns the ES modules under src/ into one self-contained HTML page.
// Each module becomes a function in a tiny module table, so names never collide.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const ENTRY = 'src/ui/main.js';
const outArg = process.argv.indexOf('--out');
const OUT = outArg > -1 ? process.argv[outArg + 1] : join(root, 'dist/linux-quest.html');

const mods = new Map();
const order = [];

function load(id) {
  if (mods.has(id)) return;
  mods.set(id, null);
  const src = readFileSync(join(root, id), 'utf8');
  const deps = [];
  const exported = [];
  let code = src.replace(
    /^import\s+(?:\*\s+as\s+([\w$]+)|\{([^}]*)\})\s+from\s+['"](.+?)['"];?[ \t]*$/gm,
    (_, ns, names, spec) => {
      const dep = relative(root, resolve(root, dirname(id), spec));
      deps.push(dep);
      if (ns) return `const ${ns} = __req(${JSON.stringify(dep)});`;
      const binds = names.split(',').map((s) => s.trim()).filter(Boolean)
        .map((s) => s.replace(/\s+as\s+/, ': ')).join(', ');
      return `const { ${binds} } = __req(${JSON.stringify(dep)});`;
    });
  code = code.replace(/^import\s+([\w$]+)\s+from\s+['"](.+?)['"];?[ \t]*$/gm, (_, name, spec) => {
    const dep = relative(root, resolve(root, dirname(id), spec));
    deps.push(dep);
    return `const ${name} = __req(${JSON.stringify(dep)}).default;`;
  });
  code = code.replace(/^export\s+default\s+/gm, 'exports.default = ');
  code = code.replace(/^export\s+(async\s+function\*?|function\*?|class|const|let|var)\s+([\w$]+)/gm,
    (_, kw, name) => { exported.push(name); return `${kw} ${name}`; });
  code = code.replace(/^export\s+\{([^}]*)\};?/gm, (_, names) => {
    for (const n of names.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [a, b] = n.split(/\s+as\s+/);
      exported.push(b ? `${b}: ${a}` : a);
    }
    return '';
  });
  if (/^\s*(import|export)\s/m.test(code)) throw new Error(`Unhandled import/export in ${id}`);
  for (const d of deps) load(d);
  mods.set(id, `${code}\nObject.assign(exports, { ${exported.join(', ')} });`);
  order.push(id);
}

load(ENTRY);

const bundle = `(function () {
'use strict';
const __defs = {}, __cache = {};
function __req(id) {
  if (__cache[id]) return __cache[id];
  const exports = (__cache[id] = {});
  __defs[id](exports);
  return exports;
}
${order.map((id) => `__defs[${JSON.stringify(id)}] = function (exports) {\n${mods.get(id)}\n};`).join('\n')}
__req(${JSON.stringify(ENTRY)});
})();`;

new Function(bundle); // syntax check only; throws on a parse error

const css = readFileSync(join(root, 'src/ui/styles.css'), 'utf8');
const template = readFileSync(join(root, 'src/ui/page.html'), 'utf8');
const html = template
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => bundle.replace(/<\/script/gi, '<\\/script'));

// The local dist build is a standalone document for previews; the artifact publish (--out) gets
// its doctype, charset and viewport from the hosting skeleton instead.
const standalone = outArg === -1;
const doc = standalone
  ? `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${html}</body></html>`
  : html;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, doc);
console.log(`Built ${OUT} (${(html.length / 1024).toFixed(0)} KB, ${order.length} modules)`);
