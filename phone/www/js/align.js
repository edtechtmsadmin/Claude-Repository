/* Phil-IRI Reader - following the reading.
 *
 * The app knows the passage, so it does not have to understand free speech:
 * it lines up what the speech recogniser heard against the passage words and
 * decides, word by word:
 *   correct   - heard as written
 *   unsure    - heard something close (possible mispronunciation), a short
 *               word that was not heard, or not heard at the end: the teacher
 *               checks these
 *   miscue    - clearly a different word (substitution) or skipped (omission)
 *   unread    - not reached yet (while reading)
 * Extra words between passage words are insertions, repetitions,
 * self-corrections or fillers ("uh", "um").
 *
 * Works in the browser and in Node (for tests).
 */
(function (global) {
  'use strict';

  const NUM = {
    zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
    eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20',
    isa: '1', dalawa: '2', tatlo: '3', apat: '4', lima: '5', anim: '6', pito: '7', walo: '8', siyam: '9', sampu: '10',
  };
  const FILLERS = new Set(['uh', 'um', 'uhm', 'umm', 'ah', 'ahh', 'ahm', 'eh', 'ehh', 'er', 'erm', 'hmm', 'hm', 'mm']);
  const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

  function tokens(text) { return String(text || '').match(WORD_RE) || []; }
  function norm(w) {
    let s = String(w || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    return NUM[s] || s;
  }
  // rough sound key: letters Filipino and English readers often swap sound the same here
  function soundKey(s) {
    return s.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/[cq]/g, 'k').replace(/x/g, 'ks')
      .replace(/z/g, 's').replace(/v/g, 'b').replace(/f/g, 'p').replace(/j/g, 'dy').replace(/ee|ea|ie|y$/g, 'i')
      .replace(/oo|ou/g, 'u').replace(/o/g, 'u').replace(/e/g, 'i').replace(/h(?![aeiou])/g, '').replace(/(.)\1+/g, '$1');
  }
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j), cur = new Array(n + 1);
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }
  const ratio = (a, b) => (a || b) ? 1 - lev(a, b) / Math.max(a.length, b.length) : 1;
  // 0..1: how alike two (normalised) words are. Words that only sound alike
  // (o/u, e/i, f/p ...) stay below "sure", so the teacher gets to check them.
  function sim(a, b, ka, kb) {
    if (a === b) return 1;
    if (!a || !b) return 0;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) / Math.max(la, lb) > 0.6) return 0;
    return Math.max(ratio(a, b), 0.8 * ratio(ka ?? soundKey(a), kb ?? soundKey(b)));
  }

  const SURE = 0.85, CLOSE = 0.5;

  /**
   * passage: array of passage words (as written)
   * heard:   array of heard words (as the recogniser wrote them)
   * opts.final: reading finished (words not reached are "not heard")
   * opts.title: title words; a learner reading the title first is not penalised
   * opts.lowConfidence: Set of heard indexes the recogniser was unsure about
   * returns { words: [{status, kind, heard}], extras: [{before, heard, kind}], pointer }
   */
  function align(passage, heard, opts = {}) {
    const W = passage.map(norm);
    let H = heard.map(w => ({ raw: w, n: norm(w) })).filter(h => h.n);
    const low = opts.lowConfidence || new Set();
    H.forEach((h, i) => { h.low = low.has(i); });
    // the title read aloud first
    if (opts.title && opts.title.length) {
      const T = opts.title.map(norm);
      let k = 0;
      while (k < H.length && k < T.length && sim(H[k].n, T[k]) >= CLOSE && !(W[k] && sim(H[k].n, W[k]) >= SURE && sim(H[k].n, T[k]) < SURE)) k++;
      if (k === T.length) H = H.slice(k);
    }
    const n = W.length, m = H.length;
    const WK = W.map(soundKey);
    H.forEach(h => { h.k = soundKey(h.n); });
    // compare heard word i with passage word j once, then reuse
    const memo = new Float32Array(Math.max(1, m * n)).fill(-1);
    const S = (i, j) => { const x = i * n + j; let v = memo[x]; if (v < 0) { v = sim(H[i].n, W[j], H[i].k, WK[j]); memo[x] = v; } return v; };
    const INF = 1e9;
    // reading goes forward, so only a band around the diagonal is searched
    // (wide enough for a skipped line or a repeated sentence)
    const BAND = 45 + Math.abs(m - n);
    const D = Array.from({ length: m + 1 }, () => new Float64Array(n + 1).fill(INF));
    const B = Array.from({ length: m + 1 }, () => new Int8Array(n + 1));
    // back pointers: 1 pair, 2 omit, 3 insert, 4 two heard -> one word, 5 one heard -> two words
    const pairCost = v => v >= SURE ? 0 : v >= CLOSE ? 0.45 : 1;
    const insCost = (i, j) => {
      const h = H[i].n;
      if (FILLERS.has(h)) return 0.05;
      if (j === n) return 0.02;                     // talking after the last word
      if (j === 0) return 0.3;                      // before the first word
      if ((j > 0 && S(i, j - 1) >= SURE) || S(i, j) >= CLOSE || W[j].startsWith(h)) return 0.5;
      return 1;
    };
    D[0][0] = 0;
    for (let i = 0; i <= m; i++) {
      const lo = Math.max(0, i - BAND), hi = Math.min(n, i + BAND);
      for (let j = lo; j <= hi; j++) {
        const d = D[i][j];
        if (d >= INF) continue;
        if (j < n) { const c = d + (W[j].length <= 2 ? 0.8 : 1); if (c < D[i][j + 1]) { D[i][j + 1] = c; B[i][j + 1] = 2; } }
        if (i < m) { const c = d + insCost(i, j); if (c < D[i + 1][j]) { D[i + 1][j] = c; B[i + 1][j] = 3; } }
        if (i < m && j < n) { const c = d + pairCost(S(i, j)); if (c < D[i + 1][j + 1]) { D[i + 1][j + 1] = c; B[i + 1][j + 1] = 1; } }
        if (i + 1 < m && j < n && W[j].startsWith(H[i].n) && H[i].n !== W[j] && sim(H[i].n + H[i + 1].n, W[j]) >= SURE) { const c = d + 0.05; if (c < D[i + 2][j + 1]) { D[i + 2][j + 1] = c; B[i + 2][j + 1] = 4; } }
        if (i < m && j + 1 < n && H[i].n.startsWith(W[j]) && H[i].n !== W[j] && sim(H[i].n, W[j] + W[j + 1]) >= SURE) { const c = d + 0.05; if (c < D[i + 1][j + 2]) { D[i + 1][j + 2] = c; B[i + 1][j + 2] = 5; } }
      }
    }
    // while reading, the learner is somewhere in the passage: end where the heard words fit best
    let end = n;
    if (!opts.final) {
      let best = INF;
      for (let j = 0; j <= n; j++) { const c = D[m][j] - j * 1e-6; if (c < best) { best = c; end = j; } }
    }
    const ops = [];
    let i = m, j = end;
    while (i > 0 || j > 0) {
      const b = B[i][j];
      if (b === 1) { ops.push({ t: 'pair', h: i - 1, w: j - 1 }); i--; j--; }
      else if (b === 2) { ops.push({ t: 'omit', w: j - 1 }); j--; }
      else if (b === 3) { ops.push({ t: 'ins', h: i - 1, before: j }); i--; }
      else if (b === 4) { ops.push({ t: 'pair2', h: i - 2, w: j - 1 }); i -= 2; j--; }
      else if (b === 5) { ops.push({ t: 'pairw2', h: i - 1, w: j - 2 }); i--; j -= 2; }
      else break;
    }
    ops.reverse();

    const words = W.map(() => ({ status: 'unread', kind: null, heard: '' }));
    const extras = [];
    // trailing passage words that were never reached
    let lastHeardWord = -1;
    for (const o of ops) if (o.t !== 'omit' && o.t !== 'ins') lastHeardWord = Math.max(lastHeardWord, o.t === 'pairw2' ? o.w + 1 : o.w);
    for (let k = 0; k < ops.length; k++) {
      const o = ops[k];
      if (o.t === 'pair' || o.t === 'pair2') {
        const h = o.t === 'pair2' ? H[o.h].n + H[o.h + 1].n : H[o.h].n;
        const raw = o.t === 'pair2' ? H[o.h].raw + ' ' + H[o.h + 1].raw : H[o.h].raw;
        const s = o.t === 'pair2' ? sim(h, W[o.w]) : S(o.h, o.w);
        const lowConf = H[o.h].low;
        words[o.w] = s >= SURE ? { status: lowConf ? 'unsure' : 'correct', kind: lowConf ? 'check' : null, heard: raw }
          : s >= CLOSE ? { status: 'unsure', kind: 'mispronunciation', heard: raw }
            : { status: 'miscue', kind: 'substitution', heard: raw };
      } else if (o.t === 'pairw2') {
        words[o.w] = { status: 'correct', kind: null, heard: H[o.h].raw };
        words[o.w + 1] = { status: 'correct', kind: null, heard: H[o.h].raw };
      } else if (o.t === 'omit') {
        if (o.w > lastHeardWord) words[o.w] = { status: opts.final ? 'unsure' : 'unread', kind: opts.final ? 'notheard' : null, heard: '' };
        else words[o.w] = W[o.w].length <= 2 ? { status: 'unsure', kind: 'omission', heard: '' } : { status: 'miscue', kind: 'omission', heard: '' };
      } else if (o.t === 'ins') {
        const h = H[o.h].n, next = ops[k + 1];
        let kind;
        if (FILLERS.has(h)) kind = 'filler';
        else if (o.before === 0) kind = 'before';
        else if (o.before >= n) kind = 'after';
        else if (next && next.t === 'pair' && next.w === o.before && S(next.h, o.before) >= SURE && S(o.h, o.before) < SURE
          && (W[o.before].startsWith(h) || S(o.h, o.before) >= CLOSE)) kind = 'selfcorrection';
        else if ((o.before > 0 && S(o.h, o.before - 1) >= SURE) || S(o.h, o.before) >= SURE) kind = 'repetition';
        else kind = 'insertion';
        extras.push({ before: o.before, heard: H[o.h].raw, kind });
      }
    }
    return { words, extras, pointer: lastHeardWord + 1 };
  }

  // miscue kinds counted in the word reading score (teacher can change in Settings)
  const COUNTED_DEFAULT = { mispronunciation: true, substitution: true, omission: true, insertion: true, repetition: true, transposition: true, reversal: true, selfcorrection: false };
  const KIND_LABEL = {
    mispronunciation: 'Mispronunciation', substitution: 'Substitution', omission: 'Omission', insertion: 'Insertion',
    repetition: 'Repetition', transposition: 'Transposition', reversal: 'Reversal', selfcorrection: 'Self-correction',
  };

  /**
   * Apply the teacher's decisions and count.
   * marks[j] = {status: 'correct'|'miscue', kind}; extraMarks[k] = 'count'|'ignore'
   */
  function score(result, marks = {}, extraMarks = {}, counted = COUNTED_DEFAULT) {
    const final = result.words.map((w, j) => marks[j] ? Object.assign({}, w, marks[j]) : w);
    const byKind = {};
    let miscues = 0, unsure = 0;
    final.forEach(w => {
      if (w.status === 'unsure' || w.status === 'unread') unsure++;
      if (w.status === 'miscue' && counted[w.kind || 'substitution'] !== false) { miscues++; byKind[w.kind || 'substitution'] = (byKind[w.kind || 'substitution'] || 0) + 1; }
    });
    result.extras.forEach((x, k) => {
      const mk = extraMarks[k] || (['insertion', 'repetition'].includes(x.kind) ? 'count' : 'ignore');
      if (mk === 'count' && counted[x.kind === 'selfcorrection' ? 'selfcorrection' : x.kind] !== false && !['filler', 'before', 'after'].includes(x.kind)) {
        miscues++; byKind[x.kind] = (byKind[x.kind] || 0) + 1;
      }
    });
    return { words: final, miscues, unsure, byKind };
  }

  function level(pct, rule) {
    if (pct == null || isNaN(pct)) return null;
    return pct >= rule.indep ? 'Independent' : pct >= rule.inst ? 'Instructional' : 'Frustration';
  }

  global.Align = { tokens, norm, sim, align, score, level, COUNTED_DEFAULT, KIND_LABEL, FILLERS };
})(typeof window !== 'undefined' ? window : globalThis);
