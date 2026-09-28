/* Reads a template sheet and guesses where each piece of data goes.
 *
 * Output (one "mapping" per sheet):
 *   fields:    single values, e.g. school name, grade, school year
 *              mode "value": write into the cell
 *              mode "blank": fill the Nth ____ run inside the cell's text
 *              mode "find":  replace a word in the text (2025-2026, MIDYEAR, FILIPINO)
 *   lists:     learner tables (one row per learner), split by sex when the
 *              template has separate male/female parts
 *   summaries: count tables (rows = sections or grade levels, columns = M/F)
 * Every guess has a confidence (conf) from 0 to 1.
 */
(function (global) {
  'use strict';
  const { parseRef, makeRef, cellText, mergeAt, hasBorder, rowPx } = global.XL;

  const norm = s => String(s || '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9%]+/g, ' ').trim();

  // ---- field dictionary (labels people write on forms) ----
  const SINGLE = {
    'school.name': ['name of school', 'school name', 'school', 'paaralan', 'pangalan ng paaralan'],
    'school.id': ['school id', 'school i d', 'school id no', 'school id number'],
    'school.idName': ['school id school name', 'school id and school name', 'school id and name'],
    'school.district': ['district', 'distrito', 'school district'],
    'school.division': ['division', 'schools division', 'sangay', 'schools division office'],
    'school.region': ['region', 'rehiyon'],
    'school.head': ['school head', 'principal', 'school principal', 'punong guro', 'head teacher'],
    'school.chair': ['grade level chairperson', 'chairperson', 'grade chairman', 'grade level chair'],
    'school.coordinator': ['reading coordinator', 'phil iri coordinator', 'coordinator', 'school reading coordinator'],
    'sy': ['school year', 'sy', 's y', 'taong panuruan'],
    'period': ['test period', 'assessment period', 'period', 'type of test', 'testing period'],
    'language': ['language', 'wika'],
    'class.gradeSection': ['grade and section', 'grade section', 'grade level and section', 'baitang at pangkat', 'baitang pangkat', 'grade section level'],
    'class.grade': ['grade', 'grade level', 'baitang', 'grade lvl'],
    'class.section': ['section', 'pangkat'],
    'class.adviser': ['teacher', 'name of teacher', 'class adviser', 'adviser', 'assessor', 'guro', 'name of assessor', 'tester', 'name of adviser'],
    'class.designation': ['designation', 'position'],
    'date': ['date', 'date of test', 'date of testing', 'petsa', 'date administered', 'date of assessment', 'date of screening'],
    'count.male': ['male', 'boys', 'no of male', 'lalaki', 'no of males'],
    'count.female': ['female', 'girls', 'babae', 'no of female', 'no of females'],
    'count.total': ['total', 'total enrolment', 'total enrollment', 'enrolment', 'enrollment'],
    'learner.name': ['name of learner', 'learner s name', 'learners name', 'name of pupil', 'name of student', 'pangalan ng mag aaral', 'name', 'pangalan', 'pupil s name', 'student s name'],
    'learner.lrn': ['lrn', 'learner reference number'],
    'learner.sex': ['sex', 'gender', 'kasarian'],
  };
  const FIELD_LABELS = {
    'school.name': 'School name', 'school.id': 'School ID', 'school.idName': 'School ID - School name',
    'school.district': 'District', 'school.division': 'Division', 'school.region': 'Region',
    'school.head': 'School head', 'school.chair': 'Grade level chairperson', 'school.coordinator': 'Reading coordinator',
    'sy': 'School year', 'period': 'Assessment period', 'tick:BOSY': 'Pre-test tick', 'tick:MOSY': 'Midyear tick', 'tick:EOSY': 'Post-test tick', 'language': 'Language',
    'class.gradeSection': 'Grade & section', 'class.grade': 'Grade', 'class.section': 'Section',
    'class.adviser': 'Teacher / assessor', 'class.designation': 'Teacher designation', 'date': 'Date',
    'count.male': 'Number of male learners', 'count.female': 'Number of female learners', 'count.total': 'Total learners',
    'learner.name': 'Learner name', 'learner.lrn': 'LRN', 'learner.sex': 'Sex',
    'a.level': 'Reading level', 'a.indepGrade': 'Grade level where independent', 'a.struggling': 'Struggling reader',
    'a.nonReader': 'Non-reader', 'a.remarks': 'Remarks', 'row.no': 'No.',
    'a.gst': 'GST score', 'a.miscues': 'Miscues', 'a.words': 'Words in passage', 'a.wordPct': 'Word reading %',
    'a.compCorrect': 'Comprehension score', 'a.compPct': 'Comprehension %', 'a.wpm': 'Reading rate (wpm)', 'a.time': 'Reading time (sec)',
  };
  // label -> key for table columns
  const COLUMN = {
    'row.no': ['no', 'number', 'bilang', 'blg', 'no of'],
    'learner.name': ['name of learner', 'name of learners', 'learner s name', 'learners name', 'learners names', 'name', 'names', 'pangalan', 'pangalan name', 'name of pupil', 'name of pupils', 'name of student', 'name of students', 'pangalan ng mag aaral'],
    'learner.lrn': ['lrn', 'learner reference number'],
    'learner.sex': ['sex', 'gender', 'kasarian', 'm f'],
    'a.gst': ['gst', 'gst score', 'group screening test', 'score in gst', 'gst raw score'],
    'a.miscues': ['miscues', 'no of miscues', 'number of miscues', 'total miscues'],
    'a.words': ['no of words', 'number of words', 'words in passage', 'total words'],
    'a.wordPct': ['word reading score', 'word reading score %', 'word reading', 'word reading %', 'word recognition', 'oral reading score'],
    'a.time': ['reading time', 'reading time sec', 'time', 'time in seconds', 'seconds'],
    'a.wpm': ['reading rate', 'reading rate wpm', 'wpm', 'words per minute', 'speed'],
    'a.compCorrect': ['comprehension score', 'no of correct answers', 'correct answers'],
    'a.compPct': ['comprehension %', 'comprehension', 'percentage comprehension', 'comprehension percentage'],
    'a.level': ['reading level', 'reading profile', 'level', 'overall reading level', 'reading profile level', 'profile'],
    'a.remarks': ['remarks', 'notes', 'intervention', 'interventions', 'interventions remarks', 'puna'],
  };
  const FOOTER = /^(total|prepared|noted|submitted|certified|checked|summary|legend|note\b|reviewed|approved|attested)/;
  const INDEP = /\bind\w*pend\w*/;
  const LEVEL_WORDS = [['Independent', INDEP], ['Instructional', /\binstruct\w*/], ['Frustration', /\bfrustrat\w*/]];

  function scoreLabel(n, syn) {
    if (!n) return 0;
    if (n === syn) return 1;
    if (n.startsWith(syn + ' ') && n.split(' ').length - syn.split(' ').length <= 1) return 0.75;
    return 0;
  }
  function bestKey(n, dict, exclude) {
    let best = null, score = 0;
    for (const key in dict) {
      if (exclude && exclude(key)) continue;
      for (const syn of dict[key]) {
        const s = scoreLabel(n, syn) + syn.length / 1000; // prefer longer, more specific labels
        if (s > score + 1e-9 && s >= 0.7) { best = key; score = s; }
      }
    }
    return best ? { key: best, conf: Math.min(1, score) } : null;
  }

  function textAt(sheet, r, c) {
    const m = mergeAt(sheet, r, c);
    return m ? cellText(sheet, m.r1, m.c1) : cellText(sheet, r, c);
  }
  function isEmpty(sheet, r, c) {
    const m = mergeAt(sheet, r, c);
    const cell = sheet.cells.get(makeRef(m ? m.r1 : r, m ? m.c1 : c));
    return !cell || cell.value == null || cell.value === '';
  }
  function topLeft(sheet, r, c) { const m = mergeAt(sheet, r, c); return m ? { r: m.r1, c: m.c1, m } : { r, c, m: null }; }
  const isFormula = (sheet, r, c) => { const cell = sheet.cells.get(makeRef(r, c)); return !!(cell && cell.formula); };

  function markFromText(n) {
    if (/\bput (a )?1\b|\bwrite 1\b|\b1 if\b/.test(n)) return 1;
    if (/\bcheck\b|\btick\b/.test(n)) return '✓';
    if (/\bput (an )?x\b/.test(n)) return 'X';
    return null;
  }

  // ---------- learner tables ----------
  function findLists(sheet) {
    const lists = [];
    const used = new Set();
    for (let r = 1; r <= Math.min(sheet.maxR, 200); r++) {
      for (let c = 1; c <= Math.min(sheet.maxC, 60); c++) {
        if (used.has(r)) break;
        const cell = sheet.cells.get(makeRef(r, c));
        if (!cell || cell.type !== 'string') continue;
        const n = norm(cell.value);
        if (!COLUMN['learner.name'].includes(n) || /:\s*$/.test(cell.value)) continue; // "Pangalan:" is a label, not a column
        const list = buildList(sheet, r, c);
        if (list) {
          lists.push(list);
          for (let rr = list.headerRows[0]; rr <= list.lastRow; rr++) used.add(rr);
        }
      }
    }
    return lists;
  }

  function buildList(sheet, hr, nc) {
    // header block: rows covered by the merges that start on the header row
    let headerEnd = hr;
    const inTable = c => {
      for (let r = hr; r <= headerEnd; r++) if (!isEmpty(sheet, r, c) || hasBorder(sheet, r, c, 'top') || hasBorder(sheet, r, c, 'left')) return true;
      return false;
    };
    for (let c = 1; c <= sheet.maxC; c++) {
      const m = mergeAt(sheet, hr, c);
      if (m && m.r1 === hr && m.r2 > headerEnd) headerEnd = m.r2;
    }
    // more header rows below (sub-headings like INDEPENDENT / INSTRUCTIONAL)
    for (let guard = 0; guard < 4; guard++) {
      const r = headerEnd + 1;
      let textCells = 0, numbers = 0;
      for (let c = 1; c <= sheet.maxC; c++) {
        const cell = sheet.cells.get(makeRef(r, c));
        if (!cell || cell.value == null || cell.value === '') continue;
        if (cell.type === 'number') numbers++; else textCells++;
      }
      if (textCells > 0 && numbers === 0 && isEmpty(sheet, r, nc)) headerEnd = r; else break;
    }
    headerEnd = Math.max(headerEnd, ...sheet.merges.filter(m => m.r1 >= hr && m.r1 <= headerEnd).map(m => m.r2));

    let c1 = nc, c2 = nc;
    while (c1 > 1 && inTable(c1 - 1)) c1--;
    while (c2 < sheet.maxC && inTable(c2 + 1)) c2++;

    const columns = [];
    let noCol = null;
    for (let c = c1; c <= c2; c++) {
      const chain = [];
      for (let r = hr; r <= headerEnd; r++) {
        const t = textAt(sheet, r, c).trim();
        if (t && chain[chain.length - 1] !== t) chain.push(t);
      }
      const col = columnMeaning(chain);
      col.col = c;
      col.label = chain.join(' › ');
      col.chain = chain;
      if (col.key === 'row.no') noCol = c;
      if (col.key || chain.length) columns.push(col);
    }

    // data rows, split into parts by "TOTAL MALE" / "TOTAL FEMALE" style rows
    const parts = [];
    let cur = null, pendingSex = null, gap = 0;
    const sexOf = t => /\b(female|girls|babae|f)\b/.test(t) ? 'F' : /\b(male|boys|lalaki|m)\b/.test(t) ? 'M' : null;
    let r = headerEnd + 1;
    for (; r <= Math.min(sheet.maxR + 1, headerEnd + 400); r++) {
      const texts = [];
      for (let c = c1; c <= c2; c++) {
        const cell = sheet.cells.get(makeRef(r, c));
        if (cell && cell.type === 'string' && String(cell.value).trim()) texts.push(norm(cell.value));
      }
      const first = texts[0] || '';
      if (FOOTER.test(first)) {
        if (cur) { cur.last = r - 1; if (!cur.sex) cur.sex = sexOf(first); parts.push(cur); cur = null; }
        if (!/^total/.test(first)) break;
        continue;
      }
      if (texts.length === 1 && /^(male|female|boys|girls|m|f)$/.test(first)) { pendingSex = sexOf(first); continue; }
      if (rowPx(sheet, r) > 0 && rowPx(sheet, r) < 12 && !texts.length) continue; // thin spacer row
      const bordered = hasBorder(sheet, r, nc, 'bottom') || hasBorder(sheet, r, nc, 'left');
      if (bordered) {
        gap = 0;
        if (!cur) { cur = { first: r, last: r, sex: pendingSex }; pendingSex = null; }
        cur.last = r;
      } else {
        if (cur) { parts.push(cur); cur = null; }
        if (++gap >= 2 && parts.length) break;
      }
    }
    if (cur) parts.push(cur);
    if (!parts.length) return null;
    // a learner table has several rows and at least one column besides the name
    const rowCount = parts.reduce((a, p) => a + p.last - p.first + 1, 0);
    if (rowCount < 3 || columns.filter(c => c.key && c.key !== 'learner.name' && c.key !== 'row.no').length < 1) return null;
    const lastRow = parts[parts.length - 1].last;

    // extra columns: link totals to the scores they add up, and "< 27" checks to the total
    const cols = columns.filter(c => c.key);
    cols.forEach((c, i) => {
      if (c.input === 'total') {
        const keys = [];
        for (let j = i - 1; j >= 0 && (cols[j].input === 'number'); j--) {
          if (c.group && cols[j].group && cols[j].group !== c.group && keys.length) break;
          keys.unshift(cols[j].key);
        }
        c.sumOf = keys;
      }
    });
    const totals = cols.filter(c => c.input === 'total');
    const conds = cols.filter(c => c.input === 'cond');
    for (const c of conds) {
      const t = totals.filter(x => x.col < c.col).pop() || totals[0];
      c.of = t ? t.key : null;
      // "< 27" next to ">= 28" means 27 and below
      if (c.op === 'lt') { const ge = conds.find(x => x.op === 'ge'); if (ge && ge.n === c.n + 1) c.n = ge.n; }
    }
    // a SUM or COUNT under a tick column needs the number 1, not a check mark
    for (const c of cols) {
      if (!(c.input === 'check' || c.input === 'cond' || c.choice || c.flag)) continue;
      for (let rr = lastRow + 1; rr <= lastRow + 3; rr++) {
        const cell = sheet.cells.get(makeRef(rr, c.col));
        if (cell && cell.formula && /\b(SUM|COUNT)\(/i.test(cell.formula)) { c.mark = 1; break; }
      }
      if (c.mark == null) c.mark = '√';
    }
    // template cells that are formulas are left to Excel
    for (const c of cols) {
      const cell = sheet.cells.get(makeRef(parts[0].first, c.col));
      if (cell && cell.formula && c.key !== 'row.no') { c.input = 'formula'; }
    }

    // learners already written on the form (a filled template)
    const found = [];
    for (const p of parts) {
      for (let rr = p.first; rr <= p.last; rr++) {
        const name = cellText(sheet, rr, nc).trim();
        if (!name || /^\d+$/.test(name)) continue;
        const values = {};
        for (const c of cols) {
          const t = cellText(sheet, rr, c.col).trim();
          if (t !== '') values[c.col] = t;
        }
        found.push({ sex: p.sex, name, values });
      }
    }

    // on a filled form, use the tick the teacher already used ("1", "√", "/", "x")
    for (const c of cols) {
      if (!(c.input === 'check' || c.input === 'cond' || c.choice || c.flag)) continue;
      const seen = found.map(f => f.values[c.col]).filter(v => v != null && v !== '');
      if (seen.length < 2) continue;
      const counts = {};
      for (const v of seen) counts[v] = (counts[v] || 0) + 1;
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      if (top.length <= 2 && !/^x$/i.test(top) || c.input !== 'check') c.mark = top === '1' ? 1 : top;
    }

    return {
      id: 'L' + hr + '_' + nc,
      headerRows: [hr, headerEnd],
      nameCol: nc, noCol, cols: [c1, c2],
      parts: parts.map(p => ({ first: p.first, last: p.last, sex: p.sex })),
      lastRow,
      columns: cols,
      unknownColumns: columns.filter(c => !c.key).map(c => ({ col: c.col, label: c.label })),
      found,
    };
  }

  // Columns the app has no fixed meaning for (GST scores, Test Taken, ...):
  // they still become input columns, stored under their heading text.
  function extraMeaning(chain) {
    const raw = chain.join(' ');
    const joined = norm(raw);
    const key = 'x:' + joined.slice(0, 60);
    const group = chain.length > 1 ? norm(chain[0]) : null;
    const label = chain.join(' ');
    let m;
    if ((m = /(?:<|less than|below)\s*=?\s*(\d+)/i.exec(raw)) && !/>\s*\/?\s*=?\s*\d/.test(raw)) return { key, input: 'cond', op: 'lt', n: +m[1], label, group, conf: 0.8 };
    if ((m = /(?:>\s*\/?\s*=|>=|≥|at least)\s*(\d+)|(\d+)\s*(?:and above|or more|pataas)/i.exec(raw))) return { key, input: 'cond', op: 'ge', n: +(m[1] || m[2]), label, group, conf: 0.8 };
    if ((m = />\s*(\d+)/.exec(raw))) return { key, input: 'cond', op: 'ge', n: +m[1] + 1, label, group, conf: 0.8 };
    if (/\btotal\b/.test(joined)) return { key, input: 'total', label, group, conf: 0.8 };
    if (/[√✓]|\bcheck\b|\btick\b|\bput (a )?(1|check|x)\b|\bor x\b|\(x\)/i.test(raw)) {
      const mark = /put (a )?1/i.test(raw) ? 1 : /✓/.test(raw) ? '✓' : /\bx\b/i.test(raw) && !/[√✓]/.test(raw) ? 'X' : '√';
      return { key, input: 'check', mark, label, group, conf: 0.8 };
    }
    if (/score|literal|inferential|applied|critical|\bnumber\b|\bno of\b|\braw\b|%|rate|time|words|miscues|items|points|correct|\bage\b/.test(joined)) {
      return { key, input: 'number', label, group, conf: 0.75 };
    }
    return { key, input: 'text', label, group, conf: 0.6 };
  }

  function columnMeaning(chain) {
    const joined = norm(chain.join(' '));
    const child = norm(chain[chain.length - 1] || '');
    const mark = markFromText(joined);
    if (/\bnon ?readers?\b/.test(joined)) return { key: 'a.nonReader', flag: true, mark, conf: 0.85 };
    if (/\bstruggling\b/.test(joined)) return { key: 'a.struggling', flag: true, mark, conf: 0.85 };
    if ((chain[chain.length - 1] || '').trim() === '#') return { key: 'row.no', conf: 0.9 };
    for (const [lvl, re] of LEVEL_WORDS) {
      if (re.test(child) && child.split(' ').length <= 2 && !/level/.test(child)) return { key: 'a.level', choice: lvl, mark, conf: 0.9 };
    }
    if (INDEP.test(joined) && /where|in which|independent in|grade|level/.test(joined)) {
      return { key: 'a.indepGrade', conf: /where|in which|independent in/.test(joined) ? 0.8 : 0.65 };
    }
    for (const [lvl, re] of LEVEL_WORDS) {
      if (re.test(child) && child.split(' ').length <= 3) return { key: 'a.level', choice: lvl, mark, conf: 0.75 };
    }
    const extra = chain.length ? extraMeaning(chain) : null;
    if (extra && (extra.input === 'cond' || extra.input === 'total')) return extra;
    if (chain.length === 1 || child) {
      const hit = bestKey(child, COLUMN) || bestKey(joined, COLUMN);
      if (hit) {
        if (hit.key === 'learner.sex' && /^(m|male)$/.test(child)) return { key: 'learner.sex', choice: 'M', mark, conf: 0.7 };
        return { key: hit.key, conf: hit.conf };
      }
      if (/^(m|male|boys)$/.test(child)) return { key: 'learner.sex', choice: 'M', mark, conf: 0.6 };
      if (/^(f|female|girls)$/.test(child)) return { key: 'learner.sex', choice: 'F', mark, conf: 0.6 };
    }
    return extra || { key: null, conf: 0 };
  }

  // ---------- count tables (grade level / school summaries) ----------
  function findSummaries(sheet, skipRows) {
    const out = [];
    for (let r = 1; r <= Math.min(sheet.maxR, 200); r++) {
      if (skipRows.has(r)) continue;
      let mf = 0;
      for (let c = 1; c <= sheet.maxC; c++) {
        const t = norm(cellText(sheet, r, c));
        if (t === 'm' || t === 'f') mf++;
      }
      if (mf < 4) continue;
      const s = buildSummary(sheet, r);
      if (s) { out.push(s); r = s.rows[1]; }
    }
    return out;
  }

  function buildSummary(sheet, mfRow) {
    // group label column: first column whose header (merged down to mfRow) names sections/grades
    let labelCol = null, groupBy = null, top = mfRow;
    for (let c = 1; c <= sheet.maxC && !labelCol; c++) {
      for (let r = Math.max(1, mfRow - 4); r <= mfRow; r++) {
        const t = norm(textAt(sheet, r, c));
        if (!t) continue;
        if (/^section|^pangkat|^class/.test(t)) { labelCol = c; groupBy = 'section'; top = topLeft(sheet, r, c).r; break; }
        if (/^grade( level)?$|^grade level|^baitang/.test(t)) { labelCol = c; groupBy = 'grade'; top = topLeft(sheet, r, c).r; break; }
      }
    }
    if (!labelCol) return null;
    const columns = [];
    const unknown = [];
    for (let c = labelCol + 1; c <= sheet.maxC; c++) {
      const sx = norm(cellText(sheet, mfRow, c));
      if (!/^(m|f|t)$/.test(sx)) continue;
      const chain = [];
      for (let r = top; r < mfRow; r++) {
        const t = textAt(sheet, r, c).trim();
        if (t && chain[chain.length - 1] !== t) chain.push(t);
      }
      const joined = norm(chain.join(' '));
      const child = norm(chain[chain.length - 1] || '');
      let metric = null;
      if (/enrol/.test(joined)) metric = 'enrolled';
      else if (/\bnon ?readers?\b/.test(joined)) metric = 'nonReader';
      else if (/struggling/.test(joined)) metric = 'struggling';
      else if (INDEP.test(joined) && /grade (\d+)/.test(child)) metric = 'indepAt:' + /grade (\d+)/.exec(child)[1];
      else for (const [lvl, re] of LEVEL_WORDS) if (re.test(child)) { metric = 'level:' + lvl; break; }
      const sex = sx.toUpperCase();
      const label = chain.join(' › ') + ' › ' + sex;
      if (metric) columns.push({ col: c, metric, sex, label, conf: 0.85 });
      else unknown.push({ col: c, label });
    }
    // data rows until TOTAL
    let first = mfRow + 1, last = mfRow;
    for (let r = first; r <= Math.min(sheet.maxR, mfRow + 200); r++) {
      const t = norm(cellText(sheet, r, labelCol));
      if (FOOTER.test(t)) break;
      if (!hasBorder(sheet, r, labelCol, 'bottom') && !hasBorder(sheet, r, labelCol, 'left') && isEmpty(sheet, r, labelCol)) break;
      last = r;
    }
    if (last < first) return null;
    return { id: 'S' + mfRow, groupBy, labelCol, headerRows: [top, mfRow], rows: [first, last], columns, unknownColumns: unknown };
  }

  // ---------- single fields ----------
  const PERIOD_RE = /\b(mid[- ]?year|midyear|bosy|mosy|eosy|pre[- ]?test|post[- ]?test|beginning of (the )?school year|middle of (the )?school year|end of (the )?school year)\b/i;
  const SY_RE = /\b(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}\b/;
  const SIGN_RE = /^(prepared by|prepared|noted by|noted|checked by|certified correct|certified by|submitted by|reviewed by|approved by|attested by)$/;
  const ROLE = [
    ['school.head', /school head|principal|punong guro|head teacher/],
    ['school.chair', /chair/],
    ['school.coordinator', /coordinator/],
    ['class.adviser', /adviser|teacher|assessor|guro/],
  ];

  function findFields(sheet, tableRows) {
    const fields = [];
    const add = f => { f.id = 'F' + (fields.length + 1); f.label = FIELD_LABELS[f.key] || f.key; fields.push(f); };
    const taken = new Set();
    for (const cell of sheet.cells.values()) {
      if (cell.type !== 'string') continue;
      const raw = String(cell.value);
      const n = norm(raw);
      if (!n) continue;
      const inTable = tableRows.has(cell.r);

      // "___/___Pre-Test ____ Post Test": a tick slot before each period word
      const tickRe = /(_+\s*[\/√✓xX]?\s*_*)\s*(pre[- ]?test|post[- ]?test|mid[- ]?year|bosy|mosy|eosy)/gi;
      let tm, ti = 0, hasTick = false;
      while ((tm = tickRe.exec(raw))) {
        const w = tm[2].toLowerCase();
        const P = /^pre|bosy/.test(w) ? 'BOSY' : /^post|eosy/.test(w) ? 'EOSY' : 'MOSY';
        add({ ref: cell.ref, key: 'tick:' + P, mode: 'tick', tickIndex: ti++, conf: 0.85 });
        hasTick = true;
      }
      if (hasTick) continue;

      // ____ blanks: "GRADE _____", "Female: _____", "Grade ____ Level Text"
      const blankRe = /_{3,}/g;
      let m, idx = 0, prevEnd = 0;
      while ((m = blankRe.exec(raw))) {
        const after = raw.slice(m.index + m[0].length);
        const tick = /^\s*\/?\s*(pre[- ]?test|bosy|beginning)/i.test(after) ? 'BOSY' : /^\s*\/?\s*(post[- ]?test|eosy|end of)/i.test(after) ? 'EOSY' : /^\s*\/?\s*(mid[- ]?year|mosy|middle)/i.test(after) ? 'MOSY' : null;
        if (tick) { add({ ref: cell.ref, key: 'tick:' + tick, mode: 'blank', blankIndex: idx, conf: 0.85 }); idx++; prevEnd = m.index + m[0].length; continue; }
        const labelTxt = norm(raw.slice(prevEnd, m.index));
        const words = labelTxt.split(' ');
        const cands = [words[words.length - 1], words.slice(-2).join(' '), labelTxt].map(t => bestKey(t, SINGLE));
        const hit = cands.find(h => h && h.conf >= 0.99) || cands[2] || cands[1] || cands[0];
        if (hit) add({ ref: cell.ref, key: hit.key, mode: 'blank', blankIndex: idx, conf: inTable ? 0.7 : hit.conf * 0.95 });
        idx++; prevEnd = m.index + m[0].length;
      }
      if (inTable) continue;

      // (PLACEHOLDER) cells: "(DISTRICT)", "(SCHOOL ID - SCHOOL NAME)", "(Designation)"
      const ph = /^\s*\(([^()]+)\)\s*$/.exec(raw);
      if (ph) {
        const inner = norm(ph[1]);
        const hit = /school id/.test(inner) && /school name|name/.test(inner) ? { key: 'school.idName', conf: 0.9 } : bestKey(inner, SINGLE);
        if (hit && !PERIOD_RE.test(ph[1])) { add({ ref: cell.ref, key: hit.key, mode: 'value', conf: Math.max(0.8, hit.conf * 0.9) }); taken.add(cell.ref); continue; }
      }
      // SCHOOL YEAR 2025-2026
      const sy = SY_RE.exec(raw);
      if (sy) add({ ref: cell.ref, key: 'sy', mode: 'find', find: sy[0], conf: 0.9 });
      // (MIDYEAR), PRE-TEST ...
      const pm = PERIOD_RE.exec(raw);
      if (pm && raw.length > pm[0].length + 2 && !fields.some(f => f.ref === cell.ref && f.key.startsWith('tick:'))) add({ ref: cell.ref, key: 'period', mode: 'find', find: pm[0], conf: 0.85 });
      // "... READING LEVEL IN FILIPINO" in titles
      const lm = /\b(filipino|english)\b/i.exec(raw);
      if (lm && /report|profile|summary|reading|inventory/.test(n) && raw.length > 20) add({ ref: cell.ref, key: 'language', mode: 'find', find: lm[0], conf: 0.8 });

      // signature blocks: "Prepared by:" with a name line below
      if (SIGN_RE.test(n)) {
        const t = signatureTarget(sheet, cell.r, cell.c);
        if (t && !taken.has(t.ref)) {
          const caption = norm(cellText(sheet, t.captionRow, t.c) || textAt(sheet, t.captionRow, t.c));
          const role = ROLE.find(([, re]) => re.test(caption));
          const key = role ? role[0] : (/noted|approved|attested/.test(n) ? 'school.head' : 'class.adviser');
          add({ ref: t.ref, key, mode: 'value', conf: role ? 0.75 : 0.55 });
          taken.add(t.ref);
        }
        continue;
      }

      // "School: Ocampo National High School" - label and value in one cell
      const lv = /^\s*([A-Za-z][^:_]{1,40}?)\s*:\s*(\S.*?)\s*$/.exec(raw);
      if (lv && !/_{3,}/.test(raw)) {
        const hit = bestKey(norm(lv[1]), SINGLE, k => k.startsWith('count.') || k.startsWith('learner.'));
        if (hit) { add({ ref: cell.ref, key: hit.key, mode: 'after', current: lv[2], conf: hit.conf * 0.9 }); taken.add(cell.ref); continue; }
      }

      // "SECTION :" / "Assessor:" with a value cell to the right
      const endsColon = /:\s*$/.test(raw);
      const hit = bestKey(n, SINGLE, k => k.startsWith('count.') || k.startsWith('learner.') && !endsColon);
      if (hit && !/_{3,}/.test(raw)) {
        const t = rightTarget(sheet, cell.r, cell.c);
        if (t && (endsColon || t.bordered) && !taken.has(t.ref)) {
          add({ ref: t.ref, key: hit.key, mode: 'value', conf: hit.conf * (t.bordered ? 0.95 : 0.8) });
          taken.add(t.ref);
        } else if (endsColon && !taken.has(cell.ref)) {
          // "School:" in a wide cell with no box next to it: write after the colon
          add({ ref: cell.ref, key: hit.key, mode: 'after', current: '', conf: hit.conf * 0.8 });
          taken.add(cell.ref);
        }
      }
    }
    // role captions ("School Head") with an empty name line right above
    for (const cell of sheet.cells.values()) {
      if (cell.type !== 'string' || tableRows.has(cell.r) || cell.r < 2) continue;
      if (/:\s*$|_{3,}/.test(cell.value)) continue; // a label, not a caption under a name line
      const n = norm(cell.value);
      const role = ROLE.find(([, re]) => re.test(n) && n.split(' ').length <= 4);
      if (!role) continue;
      const above = topLeft(sheet, cell.r - 1, cell.c);
      const ref = makeRef(above.r, above.c);
      if (!taken.has(ref) && isEmpty(sheet, above.r, above.c) && !fields.some(f => f.ref === ref)) {
        add({ ref, key: role[0], mode: 'value', conf: 0.6 });
        taken.add(ref);
      }
    }
    return fields;
  }

  function rightTarget(sheet, r, c) {
    const m = mergeAt(sheet, r, c);
    const start = (m ? m.c2 : c) + 1;
    let firstEmpty = null;
    for (let cc = start; cc <= Math.min(start + 4, sheet.maxC + 1); cc++) {
      const tl = topLeft(sheet, r, cc);
      if (!isEmpty(sheet, r, cc)) break;
      const bordered = hasBorder(sheet, r, cc, 'bottom');
      const ref = makeRef(tl.r, tl.c);
      if (bordered) return { ref, bordered: true };
      if (!firstEmpty) firstEmpty = { ref, bordered: false };
      if (tl.m) cc = tl.m.c2;
    }
    return firstEmpty;
  }

  function signatureTarget(sheet, r, c) {
    for (let rr = r + 1; rr <= r + 4; rr++) {
      for (let cc = c; cc <= c + 3; cc++) {
        const tl = topLeft(sheet, rr, cc);
        if (!isEmpty(sheet, tl.r, tl.c)) continue;
        const below = (tl.m ? tl.m.r2 : tl.r) + 1;
        if (textAt(sheet, below, tl.c) || hasBorder(sheet, tl.r, tl.c, 'bottom')) {
          return { ref: makeRef(tl.r, tl.c), c: tl.c, captionRow: below };
        }
      }
    }
    return null;
  }

  // how much of the form is written in Filipino vs English (header and column words)
  const FIL_WORDS = /\b(pangalan|paaralan|baitang|seksyon|pangkat|guro|petsa|talaan|pagtatasa|pangkatang|kabuuang|bilang|tamang|sagot|paghihinuha|kritikal|iskor|nakuha|distrito|mag-?aaral|antas|marka|panuto|lagda|inihanda|binigyang)\b/gi;
  const ENG_WORDS = /\b(name|school|grade|section|teacher|date|record|assessment|total|score|number|correct|responses|literal|inferential|critical|region|department|education|division|district|learners?|level|prepared|noted)\b/gi;
  function formWording(sheet) {
    let fil = 0, eng = 0;
    for (const cell of sheet.cells.values()) {
      if (cell.type !== 'string') continue;
      const t = String(cell.value);
      fil += (t.match(FIL_WORDS) || []).length;
      eng += (t.match(ENG_WORDS) || []).length;
    }
    return { fil, eng };
  }

  // ---------- whole sheet ----------
  function detectSheet(sheet) {
    const lists = findLists(sheet);
    const tableRows = new Set();
    for (const l of lists) for (let r = l.headerRows[0]; r <= l.lastRow + 1; r++) tableRows.add(r);
    const summaries = findSummaries(sheet, tableRows);
    for (const s of summaries) for (let r = s.headerRows[0]; r <= s.rows[1] + 1; r++) tableRows.add(r);
    const fields = findFields(sheet, tableRows);

    let kind = 'none';
    const notes = /instruction|direction|guide|read ?me|legend|how to/i.test(sheet.name);
    if (lists.length) kind = 'class';
    else if (summaries.length) kind = summaries[0].groupBy === 'section' ? 'grade' : 'school';
    else if (fields.some(f => f.key === 'learner.name')) kind = 'learner';

    let language = null;
    if (/\bfil(ipino)?\b|\bfil\s|^fil|\bfil[-_]/i.test(sheet.name)) language = 'Filipino';
    else if (/\beng(lish)?\b|^eng|\beng[-_]/i.test(sheet.name)) language = 'English';
    else {
      // a title that names the language ("... IN FILIPINO") wins; otherwise the wording of the form decides
      const lf = fields.find(f => f.key === 'language' && f.mode === 'find');
      const words = formWording(sheet);
      if (lf) language = /fil/i.test(lf.find) ? 'Filipino' : 'English';
      if (words.fil >= 4 && words.fil > words.eng * 1.5) language = 'Filipino';
      else if (!lf && words.eng >= 4 && words.eng > words.fil * 1.5) language = null; // English wording alone does not say which test it is
    }
    return {
      sheetPath: sheet.path, sheetName: sheet.name, sheetIndex: sheet.index, hidden: sheet.hidden,
      kind, language, fields, lists, summaries, checked: false, notes,
    };
  }

  global.Detect = { detectSheet, FIELD_LABELS, norm };
})(typeof window !== 'undefined' ? window : globalThis);
