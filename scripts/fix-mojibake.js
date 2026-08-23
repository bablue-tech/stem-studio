const fs = require('fs');
const file = process.argv[2] || 'public/js/main.js';
let s = fs.readFileSync(file, 'utf8');

const map = [
  ['\u00e2\u20ac\u2122', '\u2019'],
  ['\u00e2\u20ac\u201d', '\u2014'],
  ['\u00e2\u20ac\u201c', '\u2013'],
  ['\u00c2\u00b7', '\u00b7'],
  ['\u00e2\u2013\u00b6', '\u25b6'],
  ['\u00c3\u0097', '\u00d7'],
  ['\u00e2\u20ac\u0153', '\u201c'],
  ['\u00e2\u20ac\u009d', '\u201d'],
  ['\u00e2\u20ac\u00a6', '\u2026']
];

let total = 0;
for (const [bad, good] of map) {
  const n = s.split(bad).length - 1;
  if (n) { s = s.split(bad).join(good); total += n; }
}
fs.writeFileSync(file, s, 'utf8');
console.log(`repaired ${total} corrupted sequences in ${file}`);
