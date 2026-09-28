/* App data: storage, reading-level rules, and turning records into cell writes. */
(function (global) {
  'use strict';

  const PERIODS = ['BOSY', 'MOSY', 'EOSY'];
  const LANGS = ['Filipino', 'English'];
  const LEVELS = ['Independent', 'Instructional', 'Frustration'];

  function uid(prefix) { return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }

  function emptyState() {
    return {
      v: 1,
      sample: false,
      school: { name: '', id: '', district: '', division: '', region: '', head: '', chair: '', coordinator: '' },
      sy: defaultSY(),
      settings: {
        nameOrder: 'last',        // "DELA CRUZ, Juan P." or "Juan P. Dela Cruz"
        upperNames: false,
        periodNames: { BOSY: 'BEGINNING OF THE SCHOOL YEAR', MOSY: 'MIDYEAR', EOSY: 'END OF THE SCHOOL YEAR' },
        defaultMark: '1',
        rules: { word: { indep: 97, inst: 90 }, comp: { indep: 80, inst: 59 } },
        combine: 'lower',
      },
      classes: [],
      results: {},
      dates: {},
      templates: [],
      ui: {},
    };
  }
  function defaultSY() {
    const d = new Date();
    const y = d.getMonth() >= 5 ? d.getFullYear() : d.getFullYear() - 1; // school year starts around June
    return `${y}-${y + 1}`;
  }

  // ---------- storage (IndexedDB, falls back to memory) ----------
  const mem = new Map();
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open('phil-iri-recorder', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  async function kvGet(key) {
    const d = await db();
    if (!d) return mem.get(key);
    return new Promise(res => {
      try {
        const r = d.transaction('kv').objectStore('kv').get(key);
        r.onsuccess = () => res(r.result); r.onerror = () => res(mem.get(key));
      } catch (e) { res(mem.get(key)); }
    });
  }
  async function kvSet(key, val) {
    mem.set(key, val);
    const d = await db();
    if (!d) return false;
    return new Promise(res => {
      try {
        const tx = d.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = () => res(true); tx.onerror = () => res(false);
      } catch (e) { res(false); }
    });
  }
  async function kvDel(key) {
    mem.delete(key);
    const d = await db();
    if (!d) return;
    try { d.transaction('kv', 'readwrite').objectStore('kv').delete(key); } catch (e) { /* ignore */ }
  }
  const persistent = async () => !!(await db());

  // ---------- names & results ----------
  function fullName(l, settings) {
    const mi = l.middle ? l.middle.trim()[0].toUpperCase() + '.' : '';
    let s = settings.nameOrder === 'first'
      ? [l.first, mi, l.last, l.ext].filter(Boolean).join(' ')
      : `${l.last || ''}${l.ext ? ' ' + l.ext : ''}, ${[l.first, mi].filter(Boolean).join(' ')}`.trim();
    s = s.replace(/^,\s*/, '').replace(/,\s*$/, '');
    return settings.upperNames ? s.toUpperCase() : s;
  }
  function sortLearners(list) {
    return list.slice().sort((a, b) => (a.last || '').localeCompare(b.last || '') || (a.first || '').localeCompare(b.first || ''));
  }
  function result(state, learnerId, period, lang) {
    return (((state.results[learnerId] || {})[period] || {})[lang]) || {};
  }
  function setResult(state, learnerId, period, lang, patch) {
    const r = state.results[learnerId] = state.results[learnerId] || {};
    const p = r[period] = r[period] || {};
    p[lang] = Object.assign({}, p[lang] || {}, patch);
  }

  // Phil-IRI oral reading: suggest a level from raw scores
  function scoreLevel(pct, rule) {
    if (pct == null || isNaN(pct)) return null;
    if (pct >= rule.indep) return 'Independent';
    if (pct >= rule.inst) return 'Instructional';
    return 'Frustration';
  }
  function computed(res, settings) {
    const out = {};
    const words = +res.words, miscues = +res.miscues, correct = +res.compCorrect, items = +res.compTotal, time = +res.time;
    if (words > 0 && res.miscues !== '' && res.miscues != null) out.wordPct = Math.round(((words - miscues) / words) * 1000) / 10;
    if (items > 0 && res.compCorrect !== '' && res.compCorrect != null) out.compPct = Math.round((correct / items) * 1000) / 10;
    if (words > 0 && time > 0) out.wpm = Math.round(words / (time / 60));
    const wl = scoreLevel(out.wordPct, settings.rules.word);
    const cl = scoreLevel(out.compPct, settings.rules.comp);
    if (wl && cl) {
      if (settings.combine === 'comp') out.suggested = cl;
      else if (settings.combine === 'word') out.suggested = wl;
      else out.suggested = LEVELS[Math.max(LEVELS.indexOf(wl), LEVELS.indexOf(cl))];
    } else out.suggested = wl || cl || null;
    return out;
  }

  // ---------- turning records into cell writes ----------
  function matchCase(sample, value) {
    const letters = sample.replace(/[^A-Za-z]/g, '');
    if (letters && letters === letters.toUpperCase()) return String(value).toUpperCase();
    return String(value);
  }

  function groupLearners(state, ctx) {
    const classes = state.classes.filter(c => c.sy === state.sy);
    if (ctx.kind === 'class' || ctx.kind === 'learner') {
      const cls = classes.find(c => c.id === ctx.classId);
      return cls ? cls.learners : [];
    }
    if (ctx.kind === 'grade') return classes.filter(c => String(c.grade) === String(ctx.grade)).flatMap(c => c.learners);
    return classes.flatMap(c => c.learners);
  }

  function singleValue(key, state, ctx) {
    const s = state.school;
    const cls = state.classes.find(c => c.id === ctx.classId) || {};
    const learners = groupLearners(state, ctx);
    const grade = ctx.kind === 'grade' ? ctx.grade : cls.grade;
    switch (key) {
      case 'school.name': return s.name;
      case 'school.id': return s.id;
      case 'school.idName': return [s.id, s.name].filter(Boolean).join(' - ');
      case 'school.district': return s.district;
      case 'school.division': return s.division;
      case 'school.region': return s.region;
      case 'school.head': return s.head;
      case 'school.chair': return s.chair;
      case 'school.coordinator': return s.coordinator;
      case 'sy': return state.sy;
      case 'period': return state.settings.periodNames[ctx.period] || ctx.period;
      case 'language': return ctx.lang;
      case 'date': return ctx.date || (state.dates || {})[`${ctx.classId}:${ctx.period}`] || '';
      case 'class.grade': return grade != null ? String(grade) : '';
      case 'class.section': return cls.section || '';
      case 'class.gradeSection': return cls.grade ? (cls.section && cls.section.length <= 3 ? `${cls.grade}-${cls.section}` : `Grade ${cls.grade} - ${cls.section || ''}`) : '';
      case 'class.adviser': return cls.adviser || '';
      case 'class.designation': return cls.designation || '';
      case 'count.male': return learners.filter(l => l.sex === 'M').length;
      case 'count.female': return learners.filter(l => l.sex === 'F').length;
      case 'count.total': return learners.length;
      case 'tick:BOSY': case 'tick:MOSY': case 'tick:EOSY': return key.slice(5) === ctx.period ? '√' : '';
      case 'learner.name': return ctx.learner ? fullName(ctx.learner, state.settings) : '';
      case 'learner.lrn': return ctx.learner ? ctx.learner.lrn || '' : '';
      case 'learner.sex': return ctx.learner ? ctx.learner.sex || '' : '';
      default: return '';
    }
  }

  const numOf = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
  // value of a template-specific column (scores, ticks, totals) for one learner
  function extraValue(col, res) {
    const x = res.x || {};
    if (col.input === 'total') {
      const parts = (col.sumOf || []).map(k => numOf(x[k])).filter(v => v != null);
      return parts.length ? parts.reduce((a, b) => a + b, 0) : numOf(x[col.key]);
    }
    if (col.input === 'cond') {
      const t = col.of ? col.ofValue : null;
      if (t == null) return null;
      return col.op === 'lt' ? t < col.n : t >= col.n;
    }
    if (col.input === 'check') return !!x[col.key];
    return x[col.key] ?? null;
  }
  // totals of a row, so "Score < 27" can look at "Total Score"
  function withTotals(columns, res) {
    return columns.map(c => {
      if (c.input !== 'cond') return c;
      const t = columns.find(k => k.key === c.of);
      return Object.assign({}, c, { ofValue: t ? extraValue(t, res) : null });
    });
  }

  function columnValue(col, learner, index, state, ctx) {
    const res = result(state, learner.id, ctx.period, ctx.lang);
    const comp = computed(res, state.settings);
    const mark = col.mark != null ? (String(col.mark) === '1' ? 1 : col.mark) : (state.settings.defaultMark === '1' ? 1 : state.settings.defaultMark);
    if (col.key && col.key.startsWith('x:')) {
      if (col.input === 'formula') return null;
      const v = extraValue(col, res);
      if (col.input === 'check' || col.input === 'cond') return v ? mark : null;
      if (col.input === 'number' || col.input === 'total') return numOf(v);
      return v === '' ? null : v;
    }
    switch (col.key) {
      case 'row.no': return index + 1;
      case 'learner.name': return fullName(learner, state.settings);
      case 'learner.lrn': return learner.lrn || '';
      case 'learner.sex': return col.choice ? (learner.sex === col.choice ? mark : null) : (learner.sex || '');
      case 'a.level': {
        const lvl = res.level || comp.suggested || '';
        if (col.choice) return lvl === col.choice ? mark : null;
        return lvl;
      }
      case 'a.indepGrade': return res.indepGrade ? `Grade ${res.indepGrade}` : null;
      case 'a.struggling': return res.struggling ? mark : null;
      case 'a.nonReader': return res.nonReader ? mark : null;
      case 'a.remarks': return res.remarks || null;
      case 'a.gst': return res.gst !== '' && res.gst != null ? +res.gst : null;
      case 'a.miscues': return res.miscues !== '' && res.miscues != null ? +res.miscues : null;
      case 'a.words': return res.words ? +res.words : null;
      case 'a.time': return res.time ? +res.time : null;
      case 'a.compCorrect': return res.compCorrect !== '' && res.compCorrect != null ? +res.compCorrect : null;
      case 'a.wordPct': return comp.wordPct ?? null;
      case 'a.compPct': return comp.compPct ?? null;
      case 'a.wpm': return comp.wpm ?? null;
      default: return null;
    }
  }

  function countMetric(metric, learners, state, ctx) {
    return learners.filter(l => {
      if (metric === 'enrolled') return true;
      const res = result(state, l.id, ctx.period, ctx.lang);
      if (metric === 'struggling') return !!res.struggling;
      if (metric === 'nonReader') return !!res.nonReader;
      if (metric.startsWith('level:')) return (res.level || computed(res, state.settings).suggested) === metric.slice(6);
      if (metric.startsWith('indepAt:')) return String(res.indepGrade || '') === metric.slice(8);
      return false;
    }).length;
  }

  /* Build the cell writes for one sheet mapping.
   * Returns {pages:[[{ref,value}]], warnings:[]} - one page per output file.
   */
  function buildWrites(mapping, sheet, state, ctx) {
    const warnings = [];
    const base = [];
    // single fields, grouped per cell so several edits to one text combine
    const byRef = {};
    for (const f of mapping.fields) (byRef[f.ref] = byRef[f.ref] || []).push(f);
    for (const ref in byRef) {
      const fs = byRef[ref];
      const p = global.XL.parseRef(ref);
      const original = global.XL.cellText(sheet, p.r, p.c);
      const plain = fs.find(f => f.mode === 'value');
      if (plain) {
        const v = singleValue(plain.key, state, ctx);
        if (v === '' || v == null) { warnings.push(`No value for “${plain.label}” (cell ${ref}).`); continue; }
        base.push({ ref, value: v });
        continue;
      }
      let text = original;
      const after = fs.find(f => f.mode === 'after');
      if (after) {
        const v = singleValue(after.key, state, ctx);
        if (v === '' || v == null) warnings.push(`No value for “${after.label}” (cell ${ref}).`);
        else text = text.replace(/^(\s*[^:]*:\s*).*$/s, (m, head) => head + v);
      }
      const blanks = fs.filter(f => f.mode === 'blank').sort((a, b) => b.blankIndex - a.blankIndex);
      for (const f of blanks) {
        const v = singleValue(f.key, state, ctx);
        if (v === '' || v == null) { if (!f.key.startsWith('tick:')) warnings.push(`No value for “${f.label}” (cell ${ref}).`); continue; }
        const runs = [...text.matchAll(/_{3,}/g)];
        const run = runs[f.blankIndex];
        if (run) text = text.slice(0, run.index) + String(v) + text.slice(run.index + run[0].length);
      }
      for (const f of fs.filter(f => f.mode === 'find')) {
        const v = singleValue(f.key, state, ctx);
        if (v === '' || v == null) continue;
        const i = text.toLowerCase().indexOf(String(f.find).toLowerCase());
        if (i >= 0) text = text.slice(0, i) + matchCase(f.find, v) + text.slice(i + f.find.length);
      }
      if (text !== original) base.push({ ref, value: text });
    }

    // summaries (counts per section / grade level)
    for (const s of mapping.summaries) {
      const classes = state.classes.filter(c => c.sy === state.sy);
      let groups;
      if (s.groupBy === 'section') {
        groups = classes.filter(c => String(c.grade) === String(ctx.grade))
          .sort((a, b) => (a.section || '').localeCompare(b.section || ''))
          .map(c => ({ label: c.section || '(no section)', learners: c.learners }));
      } else {
        const grades = [...new Set(classes.map(c => String(c.grade)))].sort((a, b) => (+a) - (+b));
        groups = grades.map(g => ({ label: `Grade ${g}`, learners: classes.filter(c => String(c.grade) === g).flatMap(c => c.learners) }));
      }
      const cap = s.rows[1] - s.rows[0] + 1;
      if (groups.length > cap) warnings.push(`The count table has room for ${cap} rows but there are ${groups.length}. Only the first ${cap} are filled.`);
      if (!groups.length) warnings.push(s.groupBy === 'section' ? `There are no classes for Grade ${ctx.grade} in ${state.sy}.` : `There are no classes in ${state.sy}.`);
      groups.slice(0, cap).forEach((g, i) => {
        const r = s.rows[0] + i;
        base.push({ ref: global.XL.makeRef(r, s.labelCol), value: g.label });
        for (const col of s.columns) {
          const list = col.sex === 'T' ? g.learners : g.learners.filter(l => l.sex === col.sex);
          base.push({ ref: global.XL.makeRef(r, col.col), value: countMetric(col.metric, list, state, ctx) });
        }
      });
    }

    // learner tables (may need more than one page)
    const pages = [];
    const listPlans = mapping.lists.map(l => {
      const all = sortLearners(groupLearners(state, ctx));
      const hasSexParts = l.parts.some(p => p.sex);
      const parts = l.parts.map(p => {
        let learners = hasSexParts ? all.filter(x => x.sex === p.sex) : all;
        if (!hasSexParts) learners = [...all.filter(x => x.sex === 'M'), ...all.filter(x => x.sex !== 'M')];
        return { part: p, learners, cap: p.last - p.first + 1 };
      });
      if (!hasSexParts && parts.length > 1) {
        // one list spread over several blocks: fill them in order
        let rest = parts[0].learners;
        for (const pp of parts) { pp.learners = rest.slice(0, pp.cap); rest = rest.slice(pp.cap); }
        parts[parts.length - 1].learners = parts[parts.length - 1].learners.concat(rest);
      }
      const noSex = all.filter(x => x.sex !== 'M' && x.sex !== 'F');
      if (hasSexParts && noSex.length) warnings.push(`${noSex.length} learner(s) have no sex recorded and are left out of this form.`);
      return { list: l, parts };
    });
    const pageCount = Math.max(1, ...listPlans.flatMap(lp => lp.parts.map(pp => Math.ceil(pp.learners.length / pp.cap) || 1)));
    // a template that was already filled in: clear the old entries in the learner rows first
    const clears = [];
    for (const lp of listPlans) {
      for (const p of lp.list.parts) for (let r = p.first; r <= p.last; r++) {
        for (const col of lp.list.columns) {
          if (col.key === 'row.no' || col.input === 'formula') continue;
          const ref = global.XL.makeRef(r, col.col);
          const cell = sheet.cells.get(ref);
          if (cell && cell.value != null && cell.value !== '' && !cell.formula) clears.push({ ref, value: null });
        }
      }
    }
    for (let pg = 0; pg < pageCount; pg++) {
      const writes = base.concat(clears);
      for (const lp of listPlans) {
        for (const pp of lp.parts) {
          const slice = pp.learners.slice(pg * pp.cap, (pg + 1) * pp.cap);
          slice.forEach((learner, i) => {
            const r = pp.part.first + i;
            const rowCols = withTotals(lp.list.columns, result(state, learner.id, ctx.period, ctx.lang));
            for (const col of rowCols) {
              const v = columnValue(col, learner, pg * pp.cap + i, state, ctx);
              if (v === null || v === undefined || v === '') continue;
              writes.push({ ref: global.XL.makeRef(r, col.col), value: v });
            }
          });
        }
      }
      // never overwrite the template's own formulas (totals)
      pages.push(writes.filter(w => { const c = sheet.cells.get(w.ref); return !(c && c.formula); }));
    }
    if (pageCount > 1) warnings.push(`There are more learners than rows on the form, so it will be saved as ${pageCount} pages (separate files).`);
    return { pages, warnings };
  }

  // Missing entries that would leave the form incomplete
  function missingResults(state, ctx, mapping) {
    if (mapping && !mapping.lists.some(l => l.columns.some(c => c.key === 'a.level'))) return [];
    const learners = groupLearners(state, ctx);
    return learners.filter(l => {
      const res = result(state, l.id, ctx.period, ctx.lang);
      return !res.level && !computed(res, state.settings).suggested && !res.nonReader;
    });
  }

  function parseName(text) {
    const l = { id: uid('l'), lrn: '', last: '', first: '', middle: '', ext: '', sex: '' };
    const t = String(text).replace(/\s+/g, ' ').trim();
    if (t.includes(',')) {
      const [last, rest = ''] = t.split(/,(.*)/s);
      const parts = rest.trim().split(' ').filter(Boolean);
      l.last = last.trim();
      const ext = parts.findIndex(p => /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(p));
      if (ext >= 0) l.ext = parts.splice(ext, 1)[0];
      if (parts.length > 1 && /^[A-Za-z]\.?$/.test(parts[parts.length - 1])) l.middle = parts.pop().replace(/\.$/, '');
      else if (parts.length > 2) l.middle = parts.pop();
      l.first = parts.join(' ');
    } else {
      const parts = t.split(' ');
      l.last = parts.length > 1 ? parts.pop() : t;
      l.first = parts.join(' ');
    }
    return l;
  }
  const truthy = v => v != null && String(v).trim() !== '' && !/^(x|0|no|false)$/i.test(String(v).trim());

  // rows = list.found from detection; returns learners added
  function importFound(state, cls, list, period, lang) {
    const added = [];
    for (const row of list.found || []) {
      const l = parseName(row.name);
      l.sex = row.sex || '';
      const patch = { x: {} };
      for (const c of list.columns) {
        const v = row.values[c.col];
        if (v == null) continue;
        if (c.key === 'learner.lrn') l.lrn = v;
        else if (c.key === 'learner.sex' && !c.choice) l.sex = /^f/i.test(v) ? 'F' : /^m/i.test(v) ? 'M' : l.sex;
        else if (c.key === 'learner.sex' && c.choice && truthy(v)) l.sex = c.choice;
        else if (c.key === 'a.level' && c.choice) { if (truthy(v)) patch.level = c.choice; }
        else if (c.key === 'a.level') { const m = LEVELS.find(x => x.toLowerCase().startsWith(String(v).toLowerCase().slice(0, 4))); if (m) patch.level = m; }
        else if (c.key === 'a.indepGrade') { const m = /(\d+)/.exec(v); if (m) patch.indepGrade = m[1]; }
        else if (c.key === 'a.struggling') patch.struggling = truthy(v);
        else if (c.key === 'a.nonReader') patch.nonReader = truthy(v);
        else if (c.key === 'a.remarks') patch.remarks = v;
        else if (c.key && c.key.startsWith('x:') && (c.input === 'number' || c.input === 'text')) patch.x[c.key] = c.input === 'number' ? numOf(v) : v;
        else if (c.key && c.key.startsWith('x:') && c.input === 'check') patch.x[c.key] = truthy(v);
      }
      cls.learners.push(l);
      setResult(state, l.id, period, lang, patch);
      added.push(l);
    }
    return added;
  }
  function setExtra(state, learnerId, period, lang, key, value) {
    const cur = result(state, learnerId, period, lang);
    setResult(state, learnerId, period, lang, { x: Object.assign({}, cur.x || {}, { [key]: value }) });
  }

  // ---------- samples ----------
  function sampleState() {
    const st = emptyState();
    st.sample = true;
    st.school = {
      name: 'Sample National High School', id: '300000', district: 'Sample District', division: 'Sample Division',
      region: 'Region V', head: 'MARIA L. SANTOS', chair: 'JOSE R. REYES', coordinator: 'ANA B. CRUZ',
    };
    const names = [
      ['Abad', 'Carlo', 'Mendoza', 'M'], ['Bautista', 'Liza', 'Ramos', 'F'], ['Castillo', 'Mark', 'Dizon', 'M'],
      ['Dela Cruz', 'Angela', 'Perez', 'F'], ['Estrada', 'John Paul', 'Lim', 'M'], ['Fernandez', 'Kristine', 'Gomez', 'F'],
      ['Garcia', 'Miguel', 'Torres', 'M'], ['Hernandez', 'Joy', 'Aquino', 'F'], ['Ignacio', 'Ramon', 'Cruz', 'M'],
      ['Jimenez', 'Patricia', 'Soriano', 'F'], ['Lopez', 'Daniel', 'Navarro', 'M'], ['Mercado', 'Rhea', 'Santos', 'F'],
    ];
    const mk = (grade, section, adviser, offset) => ({
      id: uid('c'), sy: st.sy, grade, section, adviser, designation: 'Teacher I',
      learners: names.map((n, i) => ({
        id: uid('l'), lrn: String(1300000000 + offset * 100 + i).padStart(12, '1'),
        last: n[0], first: n[1], middle: n[2], ext: '', sex: n[3],
      })),
    });
    st.classes = [mk('7', 'Sampaguita', 'PEDRO C. VILLANUEVA', 1), mk('7', 'Rosal', 'LORNA D. MACARAEG', 2)];
    const lv = ['Independent', 'Instructional', 'Frustration'];
    for (const c of st.classes) {
      c.learners.forEach((l, i) => {
        for (const lang of LANGS) {
          const level = lv[(i + (lang === 'English' ? 1 : 0)) % 3];
          setResult(st, l.id, 'BOSY', lang, {
            level, indepGrade: level === 'Independent' ? '7' : String(4 + (i % 3)),
            struggling: level === 'Frustration' && i % 2 === 0, nonReader: false,
          });
        }
      });
    }
    return st;
  }

  global.Data = {
    PERIODS, LANGS, LEVELS, uid, emptyState, defaultSY,
    kvGet, kvSet, kvDel, persistent,
    fullName, sortLearners, result, setResult, computed,
    buildWrites, missingResults, groupLearners, sampleState,
    extraValue, withTotals, importFound, parseName, setExtra, singleValue,
  };
})(typeof window !== 'undefined' ? window : globalThis);
