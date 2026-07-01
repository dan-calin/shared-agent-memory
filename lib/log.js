'use strict';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

module.exports = {
  title: (s) => console.log('\n' + paint('1', s)),
  step: (s) => console.log('  ' + paint('36', '•') + ' ' + s),
  info: (s) => console.log('  ' + s),
  warn: (s) => console.log('  ' + paint('33', '! ') + s),
  ok: (s) => console.log('  ' + paint('32', '✓ ') + s),
  done: () => console.log(paint('32', '\n✓ Done.')),
  plain: (s) => console.log(s),
};
