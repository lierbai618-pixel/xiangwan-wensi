const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
let start = s.indexOf('{');
let depth = 0, end = -1;
for (let k = start; k < s.length; k++) {
  const ch = s[k];
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth === 0) { end = k; break; } }
}
const sub = s.slice(start, end + 1);
try {
  const d = JSON.parse(sub);
  console.log('KEYS:', Object.keys(d).join(','));
  console.log('_modelUsed:', d._modelUsed, '| _modelStatus:', d._modelStatus, '| mode:', d.mode, '| answerMode:', d.answerMode);
} catch (e) {
  console.log('PARSE_ERR', e.message, '| head:', sub.slice(0, 200));
}
