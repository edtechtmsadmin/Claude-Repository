// node phone/tests/align.test.mjs
import '../www/js/align.js';
const { align, score, tokens } = globalThis.Align;
let fail = 0;
function check(name, cond, info) { if (!cond) { fail++; console.log('FAIL', name, info ?? ''); } else console.log('ok  ', name); }
const P = tokens('Mia found a small puppy near the gate. It was wet and hungry, so she gave it some warm milk.');
const st = r => r.words.map(w => w.status[0]).join('');

let r = align(P, tokens('mia found a small puppy near the gate it was wet and hungry so she gave it some warm milk'), { final: true });
check('perfect reading', r.words.every(w => w.status === 'correct') && !r.extras.length, st(r));

r = align(P, tokens('mia found a small puppy'), {});
check('partial: rest unread, no omissions', r.words.slice(0, 5).every(w => w.status === 'correct') && r.words.slice(5).every(w => w.status === 'unread') && r.pointer === 5, st(r));

r = align(P, tokens('mia found a small dog near the gate'), {});
check('substitution', r.words[4].status === 'miscue' && r.words[4].kind === 'substitution', JSON.stringify(r.words[4]));

r = align(P, tokens('mia found a small poppy near the gate'), {});
check('close word -> unsure mispronunciation', r.words[4].status === 'unsure' && r.words[4].kind === 'mispronunciation', JSON.stringify(r.words[4]));

r = align(P, tokens('mia found a puppy near the gate it was'), {});
check('omission of "small"', r.words[3].status === 'miscue' && r.words[3].kind === 'omission', st(r));

r = align(P, tokens('mia found a small small puppy near'), {});
check('repetition', r.extras.some(x => x.kind === 'repetition'), JSON.stringify(r.extras));

r = align(P, tokens('mia found a small pup puppy near the gate'), {});
check('self-correction', r.extras.some(x => x.kind === 'selfcorrection') && r.words[4].status === 'correct', JSON.stringify(r.extras));

r = align(P, tokens('mia found a very small puppy near'), {});
check('insertion', r.extras.some(x => x.kind === 'insertion' && x.heard === 'very'), JSON.stringify(r.extras));

r = align(P, tokens('um mia found uh a small puppy'), {});
check('fillers ignored', r.extras.every(x => ['filler', 'before'].includes(x.kind)) && r.words.slice(0, 5).every(w => w.status === 'correct'), JSON.stringify(r.extras));

r = align(P, tokens('the lost puppy mia found a small puppy'), { title: tokens('The Lost Puppy') });
check('title read first is ignored', !r.extras.length && r.words.slice(0, 5).every(w => w.status === 'correct'), JSON.stringify(r.extras));

r = align(P, tokens('mia found a small puppy near the gate'), { final: true });
check('final: words never reached are "not heard" (teacher checks)', r.words.slice(8).every(w => w.status === 'unsure' && w.kind === 'notheard'), st(r));

const F = tokens('Si Lito ay mag-aaral na masipag. May 3 aso siya.');
r = align(F, tokens('si lito ay mag aaral na masipag may tatlong aso siya'), { final: true });
check('Filipino: "mag aaral" heard as two words is correct', r.words[3].status === 'correct', st(r));
check('Filipino: "tatlong" for 3 -> unsure/miscue, not correct', r.words[7].status !== 'correct', JSON.stringify(r.words[7]));
r = align(F, tokens('si lito ay mag-aaral na masipag may tatlo aso siya'), { final: true });
check('number words: "tatlo" = 3', r.words[7].status === 'correct', JSON.stringify(r.words[7]));

r = align(P, tokens('mia found a small dog near the the gate'), { final: false });
const s = score(r, {}, {});
check('score counts substitution + repetition', s.miscues === 2, JSON.stringify(s.byKind));
const s2 = score(r, { 4: { status: 'correct', kind: null } }, {});
check('teacher override removes a miscue', s2.miscues === 1, JSON.stringify(s2.byKind));

// speed: a long passage aligned many times while reading
const long = tokens(('The quick brown fox jumps over the lazy dog. ').repeat(30));
const t0 = Date.now();
for (let k = 0; k < 20; k++) align(long, long.slice(0, 200), {});
check('fast enough for live use (<60 ms per update, 270 words)', (Date.now() - t0) / 20 < 60, ((Date.now() - t0) / 20).toFixed(1) + ' ms');
console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
