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
    'class.gradeSection': ['grade and section', 'grade section', 'grade level and section', 'baitang at pangkat'],
    'class.grade': ['grade', 'grade level', 'baitang', 'grade lvl'],
    'class.section': ['section', 'pangkat'],
    'class.adviser': ['teacher', 'name of teacher', 'class adviser', 'adviser', 'assessor', 'guro', 'name of assessor', 'tester', 'name of adviser'],
    'class.designation': ['designation', 'position'],
    'date': ['date', 'date of test', 'date of testing', 'petsa', 'date administered'],
    'count.male': ['male', 'boys', 'no of male', 'lalaki', 'no of males'],
    'count.female': ['female', 'girls', 'babae', 'no of female', 'no of females'],
    'count.total': ['total', 'total enrolment', 'total enrollment', 'enrolment', 'enrollment'],
    'learner.name': ['name of learner', 'learner s name', 'learners name', 'name of pupil', 'name of student', 'pangalan ng mag aaral', 'name'],
    'learner.lrn': ['lrn', 'learner reference number'],
    'learner.sex': ['sex', 'gender', 'kasarian'],
  };
  const FIELD_LABELS = {
    'school.name': 'School name', 'school.id': 'School ID', 'school.idName': 'School ID - School name',
    'school.district': 'District', 'school.division': 'Division', 'school.region': 'Region',
    'school.head': 'School head', 'school.chair': 'Grade level chairperson', 'school.coordinator': 'Reading coordinator',
    'sy': 'School year', 'period': 'Assessment period', 'language': 'Language',
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
    'a.compCorrect': ['comprehension score', 'no of correct answers', 'correct answers', 'score'],
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
        if (!COLUMN['learner.name'].includes(n)) continue;
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
      const nameEmpty = isEmpty(sheet, r, nc);
      if (bordered && nameEmpty) {
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
    return {
      id: 'L' + hr + '_' + nc,
      headerRows: [hr, headerEnd],
      nameCol: nc, noCol, cols: [c1, c2],
      parts: parts.map(p => ({ first: p.first, last: p.last, sex: p.sex })),
      lastRow: parts[parts.length - 1].last,
      columns: columns.filter(c => c.key),
      unknownColumns: columns.filter(c => !c.key).map(c => ({ col: c.col, label: c.label })),
    };
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
    if (chain.length === 1 || child) {
      const hit = bestKey(child, COLUMN) || bestKey(joined, COLUMN);
      if (hit) {
        if (hit.key === 'learner.sex' && /^(m|male)$/.test(child)) return { key: 'learner.sex', choice: 'M', mark, conf: 0.7 };
        return { key: hit.key, conf: hit.conf };
      }
      if (/^(m|male|boys)$/.test(child)) return { key: 'learner.sex', choice: 'M', mark, conf: 0.6 };
      if (/^(f|female|girls)$/.test(child)) return { key: 'learner.sex', choice: 'F', mark, conf: 0.6 };
    }
    return { key: null, conf: 0 };
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

      // ____ blanks: "GRADE _____", "Female: _____", "Grade ____ Level Text"
      const blankRe = /_{3,}/g;
      let m, idx = 0, prevEnd = 0;
      while ((m = blankRe.exec(raw))) {
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
      if (pm && raw.length > pm[0].length + 2) add({ ref: cell.ref, key: 'period', mode: 'find', find: pm[0], conf: 0.85 });
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

      // "SECTION :" / "Assessor:" with a value cell to the right
      const endsColon = /:\s*$/.test(raw);
      const hit = bestKey(n, SINGLE, k => k.startsWith('count.') || k.startsWith('learner.') && !endsColon);
      if (hit && !/_{3,}/.test(raw)) {
        const t = rightTarget(sheet, cell.r, cell.c);
        if (t && (endsColon || t.bordered) && !taken.has(t.ref)) {
          add({ ref: t.ref, key: hit.key, mode: 'value', conf: hit.conf * (t.bordered ? 0.95 : 0.8) });
          taken.add(t.ref);
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

  // ---------- whole sheet ----------
  function detectSheet(sheet) {
    const lists = findLists(sheet);
    const tableRows = new Set();
    for (const l of lists) for (let r = l.headerRows[0]; r <= l.lastRow + 1; r++) tableRows.add(r);
    const summaries = findSummaries(sheet, tableRows);
    for (const s of summaries) for (let r = s.headerRows[0]; r <= s.rows[1] + 1; r++) tableRows.add(r);
    const fields = findFields(sheet, tableRows);

    let kind = 'none';
    if (lists.length) kind = 'class';
    else if (summaries.length) kind = summaries[0].groupBy === 'section' ? 'grade' : 'school';
    else if (fields.some(f => f.key === 'learner.name')) kind = 'learner';

    let language = null;
    if (/\bfil/i.test(sheet.name)) language = 'Filipino';
    else if (/\beng/i.test(sheet.name)) language = 'English';
    else {
      const lf = fields.find(f => f.key === 'language' && f.mode === 'find');
      if (lf) language = /fil/i.test(lf.find) ? 'Filipino' : 'English';
    }
    return {
      sheetPath: sheet.path, sheetName: sheet.name, sheetIndex: sheet.index, hidden: sheet.hidden,
      kind, language, fields, lists, summaries, checked: false,
    };
  }

  global.Detect = { detectSheet, FIELD_LABELS, norm };
})(typeof window !== 'undefined' ? window : globalThis);
