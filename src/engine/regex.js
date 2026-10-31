// Translate POSIX basic (BRE) and extended (ERE) regular expressions to JavaScript RegExp.
const CLASS = {
  alpha: 'A-Za-z', digit: '0-9', alnum: 'A-Za-z0-9', upper: 'A-Z', lower: 'a-z',
  space: ' \\t\\n\\r\\f\\v', blank: ' \\t', punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9A-Fa-f',
  print: ' -~', graph: '!-~', cntrl: '\\x00-\\x1f\\x7f',
};

export class RegexError extends Error {}

function bracket(pat, i) {
  // i at '['; returns [jsClass, endIndex]
  let j = i + 1;
  let out = '[';
  if (pat[j] === '^') { out += '^'; j++; }
  if (pat[j] === ']') { out += '\\]'; j++; }
  while (j < pat.length && pat[j] !== ']') {
    if (pat[j] === '[' && pat[j + 1] === ':') {
      const k = pat.indexOf(':]', j + 2);
      if (k > 0) {
        const name = pat.slice(j + 2, k);
        if (!CLASS[name]) throw new RegexError(`Invalid character class name`);
        out += CLASS[name];
        j = k + 2;
        continue;
      }
    }
    const ch = pat[j];
    out += ch === '\\' || ch === '[' ? '\\' + ch : ch;
    j++;
  }
  if (j >= pat.length) throw new RegexError('Unmatched [, [^, [:, [., or [=');
  return [out + ']', j];
}

export function toJsSource(pat, extended) {
  let out = '';
  let atStart = true;
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '[') {
      const [cls, end] = bracket(pat, i);
      out += cls;
      i = end;
      atStart = false;
      continue;
    }
    if (c === '\\') {
      const nx = pat[i + 1];
      i++;
      if (nx === undefined) throw new RegexError('Trailing backslash');
      atStart = false;
      if (!extended && '(){}|+?'.includes(nx)) { out += nx; atStart = nx === '(' || nx === '|'; continue; }
      if (nx === '<' || nx === '>') { out += '\\b'; continue; }
      if ('wWsSbBnt'.includes(nx) || /\d/.test(nx)) { out += '\\' + nx; continue; }
      out += /[A-Za-z]/.test(nx) ? nx : '\\' + nx;
      continue;
    }
    if (!extended && '(){}|+?'.includes(c)) { out += '\\' + c; atStart = false; continue; }
    if (c === '*' && atStart) { out += '\\*'; atStart = false; continue; }
    if (c === '^') { out += atStart ? '^' : extended ? '^' : '\\^'; continue; }
    if (c === '$') {
      const end = i === pat.length - 1 || (!extended && pat.startsWith('\\)', i + 1)) || (extended && (pat[i + 1] === ')' || pat[i + 1] === '|'));
      out += end || extended ? '$' : '\\$';
      continue;
    }
    if (extended && (c === '(' || c === '|')) { out += c; atStart = true; continue; }
    if (c === '/') { out += '\\/'; atStart = false; continue; }
    out += c;
    atStart = false;
  }
  return out;
}

export function posixRegex(pat, { extended = false, icase = false, global = false, fixed = false, word = false, line = false } = {}) {
  let src = fixed ? pat.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') : toJsSource(pat, extended);
  if (word) src = `(?<![A-Za-z0-9_])(?:${src})(?![A-Za-z0-9_])`;
  if (line) src = `^(?:${src})$`;
  try {
    return new RegExp(src, (icase ? 'i' : '') + (global ? 'g' : ''));
  } catch (e) {
    throw new RegexError(e.message.replace(/^Invalid regular expression: /, ''));
  }
}
