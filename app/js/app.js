/* Phil-IRI Recorder - screens and interactions */
(function () {
  'use strict';
  const { PERIODS, LANGS, LEVELS } = Data;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const GRADES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
  const KIND_LABEL = { class: 'Class list', grade: 'Grade level summary', school: 'School summary', learner: 'Individual record', none: 'Not a form' };
  const PERIOD_LABEL = { BOSY: 'BOSY', MOSY: 'MOSY', EOSY: 'EOSY' };
  const PAPER = [['', 'As in template'], ['9', 'A4'], ['1', 'Letter (8.5×11 in)'], ['14', 'Long / Folio (8.5×13 in)'], ['5', 'Legal (8.5×14 in)']];
  const isDesktop = !!window.desktop;

  let state = Data.emptyState();
  const tplCache = new Map();   // template id -> {buf, wb}
  const ui = { view: 'classes', classId: null, period: 'BOSY', lang: 'Filipino', helper: false, tplId: null, sheetIdx: 0, sel: null, zoom: 0.8, print: {} };

  // ---------- persistence ----------
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { state.ui = { view: ui.view, classId: ui.classId, period: ui.period, lang: ui.lang }; Data.kvSet('state', state); }, 250);
  }
  async function tplData(id) {
    if (tplCache.has(id)) return tplCache.get(id);
    const buf = await Data.kvGet('tpl:' + id);
    if (!buf) return null;
    const wb = await XL.loadWorkbook(buf.slice(0));
    const entry = { buf, wb };
    tplCache.set(id, entry);
    return entry;
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 3600);
  }

  // Two-click confirmation (the viewer blocks confirm() dialogs)
  function armed(btn, label) {
    if (btn.classList.contains('armed')) return true;
    btn.classList.add('armed');
    const old = btn.textContent;
    btn.textContent = label;
    setTimeout(() => { btn.classList.remove('armed'); btn.textContent = old; }, 3500);
    return false;
  }

  // ---------- saving files ----------
  async function saveBlob(name, blob) {
    name = name.replace(/[–—]/g, '-').replace(/[\\/:*?"<>|]+/g, ' ').replace(/[^\x20-\x7E\u00C0-\u017F]/g, '').replace(/\s+/g, ' ').trim();
    if (window.desktop) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const path = await window.desktop.saveFile(name, bytes);
      return path ? { status: 'saved', path } : { status: 'cancelled' };
    }
    if (window.claude && typeof window.claude.use === 'function') {
      const dl = await window.claude.use('downloads');
      if (dl) {
        try { await dl.save({ filename: name, data: blob }); return { status: 'saved' }; }
        catch (e) {
          if (e && e.code === 'declined') return { status: 'cancelled' };
          throw new Error(e && e.message ? e.message : 'The file could not be saved here.');
        }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.hidden = true;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 10000);
    return { status: 'saved' };
  }

  // ---------- helpers ----------
  const syClasses = () => state.classes.filter(c => c.sy === state.sy)
    .sort((a, b) => (+a.grade) - (+b.grade) || (a.section || '').localeCompare(b.section || ''));
  const className = c => c ? `Grade ${c.grade} – ${c.section || 'no section'}` : '';
  function currentClass() {
    const list = syClasses();
    let c = list.find(x => x.id === ui.classId);
    if (!c) { c = list[0] || null; ui.classId = c ? c.id : null; }
    return c;
  }
  function options(list, value) {
    return list.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`; }).join('');
  }
  function seg(name, values, current, labels = {}) {
    return `<div class="seg" role="group" data-seg="${name}">${values.map(v => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === current}">${esc(labels[v] || v)}</button>`).join('')}</div>`;
  }

  // ---------- render root ----------
  function render() {
    $$('.nav-item').forEach(b => b.setAttribute('aria-current', b.dataset.view === ui.view ? 'page' : 'false'));
    $('#brand-sy').textContent = 'School year ' + state.sy;
    $('#rail-foot').textContent = isDesktop ? 'Desktop app · data saved on this computer' : 'Test version · data stays in this browser. Use School & settings › Save backup.';
    $('#banner').innerHTML = state.sample ? `<div class="banner"><span><b>Sample data.</b> The classes and learners here are made-up examples so you can try the app.</span><button class="btn small" data-act="clear-sample" type="button">Clear sample data and start</button></div>` : '';
    const v = $('#view');
    if (ui.view === 'classes') v.innerHTML = viewClasses();
    else if (ui.view === 'results') v.innerHTML = viewResults();
    else if (ui.view === 'templates') { v.innerHTML = ui.tplId ? '<div class="empty">Opening template…</div>' : viewTemplates(); if (ui.tplId) renderMapper(); }
    else if (ui.view === 'print') { v.innerHTML = viewPrint(); refreshPreview(); }
    else if (ui.view === 'settings') v.innerHTML = viewSettings();
  }

  // ================= Classes & learners =================
  function viewClasses() {
    const list = syClasses();
    const c = currentClass();
    const listHtml = list.length ? list.map(x => `
      <button class="class-item" type="button" data-act="pick-class" data-id="${x.id}" aria-current="${c && x.id === c.id}">
        <span><b>${esc(className(x))}</b><br><small>${esc(x.adviser || 'No adviser yet')}</small></span>
        <span class="chip num">${x.learners.length}</span>
      </button>`).join('') : '<div class="empty">No classes yet for this school year.</div>';

    let detail = '<div class="panel empty">Add a class to start listing learners.</div>';
    if (c) {
      const learners = Data.sortLearners(c.learners);
      const rows = ['M', 'F', ''].map(sex => {
        const grp = learners.filter(l => (l.sex || '') === sex);
        if (!grp.length) return '';
        const title = sex === 'M' ? 'Male' : sex === 'F' ? 'Female' : 'Sex not set';
        return `<tr class="sep"><td colspan="8">${title} · ${grp.length}</td></tr>` + grp.map((l, i) => `
          <tr data-lid="${l.id}">
            <td class="idx">${i + 1}</td>
            <td class="w-lrn"><input type="text" id="lrn-${l.id}" data-f="lrn" value="${esc(l.lrn)}" inputmode="numeric" aria-label="LRN"></td>
            <td><input type="text" id="last-${l.id}" data-f="last" value="${esc(l.last)}" aria-label="Last name"></td>
            <td><input type="text" id="first-${l.id}" data-f="first" value="${esc(l.first)}" aria-label="First name"></td>
            <td><input type="text" id="middle-${l.id}" data-f="middle" value="${esc(l.middle)}" aria-label="Middle name"></td>
            <td style="width:70px"><input type="text" id="ext-${l.id}" data-f="ext" value="${esc(l.ext)}" aria-label="Extension (Jr., III)"></td>
            <td class="w-sex"><select id="sex-${l.id}" data-f="sex" aria-label="Sex">${options([['', '–'], ['M', 'M'], ['F', 'F']], l.sex)}</select></td>
            <td style="width:40px"><button class="btn quiet small danger" type="button" data-act="del-learner" title="Remove learner">✕</button></td>
          </tr>`).join('');
      }).join('');
      detail = `
      <div class="panel stack">
        <div class="grid2">
          <label class="field"><span>Grade</span><select id="c-grade" data-cf="grade">${options(GRADES.map(g => [g, 'Grade ' + g]), c.grade)}</select></label>
          <label class="field"><span>Section</span><input type="text" id="c-section" data-cf="section" value="${esc(c.section)}"></label>
          <label class="field"><span>Teacher / assessor</span><input type="text" id="c-adviser" data-cf="adviser" value="${esc(c.adviser)}"></label>
          <label class="field"><span>Designation</span><input type="text" id="c-designation" data-cf="designation" value="${esc(c.designation)}" placeholder="Teacher I"></label>
        </div>
      </div>
      <div class="panel flush">
        <div class="row" style="padding:12px 14px;justify-content:space-between">
          <h2>Learners <span class="muted num">(${c.learners.length})</span></h2>
          <div class="row">
            <button class="btn small" type="button" data-act="add-learner">Add learner</button>
            <button class="btn small quiet danger" type="button" data-act="del-class">Delete class</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="grid" id="learner-table">
            <thead><tr><th></th><th>LRN</th><th>Last name</th><th>First name</th><th>Middle name</th><th>Ext.</th><th>Sex</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="8" class="empty">No learners yet. Add them one by one, or paste a list from Excel below.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
      <div class="panel stack">
        <h2>Paste a class list</h2>
        <p class="muted">Copy rows from Excel or SF1 and paste them here. Use columns in this order: <b>LRN, Last name, First name, Middle name, Sex</b>. A single “DELA CRUZ, JUAN PEREZ” name column also works; add the sex in the next column.</p>
        <textarea id="paste-box" rows="4" placeholder="Paste here…"></textarea>
        <div class="row"><button class="btn primary small" type="button" data-act="paste-learners">Add these learners</button><span class="muted" id="paste-hint"></span></div>
      </div>`;
    }
    return `
      <div class="head">
        <div><h1>Classes &amp; learners</h1><p>One entry per class you assess. Learners are kept separate from any template, so they carry over to next year’s forms.</p></div>
        <div class="row">
          <label class="field"><span>School year</span><input type="text" id="sy-input" value="${esc(state.sy)}" list="sy-list" style="width:130px"></label>
          <datalist id="sy-list">${[...new Set(state.classes.map(x => x.sy).concat(state.sy))].map(s => `<option value="${esc(s)}">`).join('')}</datalist>
        </div>
      </div>
      <div class="split">
        <div class="stack">
          <div class="class-list">${listHtml}</div>
          <button class="btn" type="button" data-act="add-class">Add class</button>
        </div>
        <div class="stack">${detail}</div>
      </div>`;
  }

  function parseLearnerRows(text) {
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let cols = line.split('\t').map(s => s.trim());
      if (cols.length === 1 && line.includes(',') && line.split(',').length > 2 && !/\d{6,}/.test(line)) cols = line.split(',').map(s => s.trim());
      const l = { id: Data.uid('l'), lrn: '', last: '', first: '', middle: '', ext: '', sex: '' };
      if (/^\d{6,}$/.test(cols[0] || '')) l.lrn = cols.shift();
      const sexIdx = cols.findIndex(x => /^(m|f|male|female|lalaki|babae)$/i.test(x));
      if (sexIdx >= 0) { l.sex = /^(f|female|babae)$/i.test(cols[sexIdx]) ? 'F' : 'M'; cols.splice(sexIdx, 1); }
      cols = cols.filter(Boolean);
      if (cols.length === 1 && cols[0].includes(',')) {
        const [last, rest] = cols[0].split(/,(.*)/s);
        const parts = rest.trim().split(/\s+/);
        l.last = last.trim();
        const ext = parts.findIndex(p => /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(p));
        if (ext >= 0) l.ext = parts.splice(ext, 1)[0];
        if (parts.length > 1) { l.middle = parts.pop().replace(/\.$/, ''); }
        l.first = parts.join(' ');
      } else {
        [l.last = '', l.first = '', l.middle = ''] = cols;
      }
      if (l.last || l.first) out.push(l);
    }
    return out;
  }

  // ================= Reading results =================
  function viewResults() {
    const list = syClasses();
    if (!list.length) return `<div class="head"><div><h1>Reading results</h1></div></div><div class="panel empty">Add a class first under <b>Classes &amp; learners</b>.</div>`;
    const c = currentClass();
    const learners = Data.sortLearners(c.learners);
    const counts = { Independent: 0, Instructional: 0, Frustration: 0, nonReader: 0, none: 0 };
    for (const l of learners) {
      const r = Data.result(state, l.id, ui.period, ui.lang);
      const lvl = r.level || Data.computed(r, state.settings).suggested;
      if (r.nonReader) counts.nonReader++;
      if (lvl) counts[lvl]++; else if (!r.nonReader) counts.none++;
    }
    const helperHead = ui.helper ? '<th>Words</th><th>Miscues</th><th>Correct</th><th>Items</th><th>Word %</th><th>Comp. %</th><th>Suggests</th>' : '';
    const rows = ['M', 'F', ''].map(sex => {
      const grp = learners.filter(l => (l.sex || '') === sex);
      if (!grp.length) return '';
      const title = sex === 'M' ? 'Male' : sex === 'F' ? 'Female' : 'Sex not set';
      return `<tr class="sep"><td colspan="${ui.helper ? 14 : 7}">${title}</td></tr>` + grp.map((l, i) => {
        const r = Data.result(state, l.id, ui.period, ui.lang);
        const comp = Data.computed(r, state.settings);
        const lvl = r.level || '';
        const helper = ui.helper ? `
          <td style="width:74px"><input type="number" min="0" id="w-${l.id}" data-r="words" value="${esc(r.words)}" aria-label="Words in passage"></td>
          <td style="width:74px"><input type="number" min="0" id="m-${l.id}" data-r="miscues" value="${esc(r.miscues)}" aria-label="Miscues"></td>
          <td style="width:70px"><input type="number" min="0" id="cc-${l.id}" data-r="compCorrect" value="${esc(r.compCorrect)}" aria-label="Correct answers"></td>
          <td style="width:64px"><input type="number" min="0" id="ct-${l.id}" data-r="compTotal" value="${esc(r.compTotal)}" aria-label="Number of questions"></td>
          <td class="num">${comp.wordPct ?? '–'}</td><td class="num">${comp.compPct ?? '–'}</td>
          <td>${comp.suggested ? `<button class="btn small quiet" type="button" data-act="use-suggest" data-level="${comp.suggested}">${comp.suggested}</button>` : '<span class="muted">–</span>'}</td>` : '';
        return `<tr data-lid="${l.id}">
          <td class="idx">${i + 1}</td>
          <td style="min-width:190px">${esc(Data.fullName(l, state.settings))}</td>
          <td><div class="lvl">${LEVELS.map(L => `<button type="button" data-level="${L}" aria-pressed="${lvl === L}" title="${L}">${L.slice(0, L === 'Instructional' ? 5 : 5)}</button>`).join('')}</div>
            ${!lvl && comp.suggested ? `<div class="suggest">from scores: ${comp.suggested}</div>` : ''}</td>
          <td class="w-grade"><select id="ig-${l.id}" data-r="indepGrade" aria-label="Grade level where independent">${options([['', '–']].concat(GRADES.map(g => [g, 'Grade ' + g])), r.indepGrade || '')}</select></td>
          <td class="center"><input type="checkbox" id="sr-${l.id}" data-r="struggling" ${r.struggling ? 'checked' : ''} aria-label="Struggling reader"></td>
          <td class="center"><input type="checkbox" id="nr-${l.id}" data-r="nonReader" ${r.nonReader ? 'checked' : ''} aria-label="Non-reader"></td>
          <td style="min-width:140px"><input type="text" id="rm-${l.id}" data-r="remarks" value="${esc(r.remarks)}" aria-label="Remarks"></td>
          ${helper}
        </tr>`;
      }).join('');
    }).join('');
    return `
      <div class="head">
        <div><h1>Reading results</h1><p>Record each learner’s level for the assessment period. English and Filipino are kept separately because they print on separate forms.</p></div>
      </div>
      <div class="panel row" style="justify-content:space-between">
        <div class="row">
          <label class="field"><span>Class</span><select id="res-class">${options(list.map(x => [x.id, className(x)]), c.id)}</select></label>
          <div class="field"><span style="font-weight:600;font-size:.85rem;color:var(--muted)">Period</span>${seg('period', PERIODS, ui.period, PERIOD_LABEL)}</div>
          <div class="field"><span style="font-weight:600;font-size:.85rem;color:var(--muted)">Language</span>${seg('lang', LANGS, ui.lang)}</div>
        </div>
        <label class="row" style="gap:6px"><input type="checkbox" id="helper-toggle" ${ui.helper ? 'checked' : ''}> Show scoring helper</label>
      </div>
      <div class="stats">
        <div class="stat i"><b>${counts.Independent}</b><span>Independent</span></div>
        <div class="stat n"><b>${counts.Instructional}</b><span>Instructional</span></div>
        <div class="stat f"><b>${counts.Frustration}</b><span>Frustration</span></div>
        <div class="stat"><b>${counts.nonReader}</b><span>Non-readers</span></div>
        <div class="stat"><b>${counts.none}</b><span>Not yet recorded</span></div>
      </div>
      <div class="panel flush">
        <div class="table-wrap">
          <table class="grid" id="results-table">
            <thead><tr><th></th><th>Learner</th><th>Reading level</th><th>Independent at</th><th>Struggling</th><th>Non-reader</th><th>Remarks</th>${helperHead}</tr></thead>
            <tbody>${rows || '<tr><td colspan="7" class="empty">This class has no learners yet.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
      ${ui.helper ? `<p class="muted">The helper suggests a level from oral reading scores: word reading ${state.settings.rules.word.indep}%+ and comprehension ${state.settings.rules.comp.indep}%+ is Independent; ${state.settings.rules.word.inst}%+ and ${state.settings.rules.comp.inst}%+ is Instructional; lower is Frustration. Change the cut-offs in School &amp; settings.</p>` : ''}`;
  }

  // ================= Templates =================
  function viewTemplates() {
    const cards = state.templates.map(t => {
      const sheets = t.sheets.map((m, i) => {
        const status = m.kind === 'none' ? '<span class="chip">Skipped</span>' : m.checked ? '<span class="chip ok">Checked</span>' : `<span class="chip warn">Check ${countUnsure(m)} item${countUnsure(m) === 1 ? '' : 's'}</span>`;
        return `<div class="sheet-row">
          <span><b>${esc(m.sheetName)}</b>${m.hidden ? ' <span class="muted">(hidden sheet)</span>' : ''}</span>
          <span class="chip">${KIND_LABEL[m.kind]}${m.language ? ' · ' + m.language : ''}</span>
          ${status}
          <button class="btn small" type="button" data-act="open-sheet" data-tpl="${t.id}" data-i="${i}">Open</button>
        </div>`;
      }).join('');
      return `<div class="panel tpl-card">
        <div class="tpl-top">
          <div><h2>${esc(t.name)}</h2><p class="muted">${esc(t.fileName)} · imported ${new Date(t.addedAt).toLocaleDateString()}${t.sample ? ' · sample layout for testing' : ''}</p></div>
          <div class="row">
            <button class="btn small" type="button" data-act="print-tpl" data-tpl="${t.id}">Print with this</button>
            <button class="btn small quiet danger" type="button" data-act="del-tpl" data-tpl="${t.id}">Remove</button>
          </div>
        </div>
        <div class="sheet-rows">${sheets}</div>
      </div>`;
    }).join('');
    return `
      <div class="head">
        <div><h1>Templates</h1><p>Import the DepEd form exactly as you received it. The app reads each sheet, finds where the data goes, and prints into the original file, so the layout never changes.</p></div>
      </div>
      <div class="drop" id="drop">
        <b>Drop a DepEd template here</b>
        <span class="muted">Excel workbook (.xlsx). Old .xls files: open in Excel and save as .xlsx first.</span>
        <div class="row" style="justify-content:center">
          <span class="btn primary file-btn">Choose file…<input type="file" id="tpl-file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></span>
          ${Object.keys(window.SAMPLE_TEMPLATES || {}).map(k => `<button class="btn" type="button" data-act="load-sample-tpl" data-k="${k}">Try ${esc(window.SAMPLE_TEMPLATES[k].name)}</button>`).join('')}
        </div>
      </div>
      ${cards || '<div class="panel empty">No templates yet.</div>'}`;
  }

  function countUnsure(m) {
    let n = m.fields.filter(f => f.conf < 0.8).length;
    for (const l of m.lists) n += l.columns.filter(c => c.conf < 0.8).length + (l.unknownColumns || []).length;
    for (const s of m.summaries) n += (s.unknownColumns || []).length;
    return n;
  }

  async function importTemplate(buf, fileName, name, sample) {
    let wb;
    try { wb = await XL.loadWorkbook(buf.slice(0)); }
    catch (e) { toast(e.message || 'This file could not be read as an Excel workbook.'); return; }
    const id = Data.uid('t');
    const sheets = wb.sheets.map(s => Detect.detectSheet(s));
    state.templates.unshift({ id, name: name || fileName.replace(/\.xls[xm]?$/i, ''), fileName, addedAt: Date.now(), sample: !!sample, sheets });
    await Data.kvSet('tpl:' + id, buf);
    tplCache.set(id, { buf, wb });
    save();
    const forms = sheets.filter(s => s.kind !== 'none').length;
    toast(`Imported ${fileName}: ${forms} form${forms === 1 ? '' : 's'} found in ${sheets.length} sheet${sheets.length === 1 ? '' : 's'}.`);
    render();
  }

  // ---------- mapper ----------
  const FIELD_KEYS = Object.keys(Detect.FIELD_LABELS).filter(k => !k.startsWith('a.') && k !== 'row.no');
  const COL_KEYS = ['row.no', 'learner.name', 'learner.lrn', 'learner.sex', 'a.level', 'a.indepGrade', 'a.struggling', 'a.nonReader', 'a.remarks', 'a.gst', 'a.miscues', 'a.words', 'a.wordPct', 'a.compCorrect', 'a.compPct', 'a.wpm'];
  const METRICS = [['enrolled', 'Enrolment'], ['level:Independent', 'Independent'], ['level:Instructional', 'Instructional'], ['level:Frustration', 'Frustration'], ['struggling', 'Struggling readers'], ['nonReader', 'Non-readers']]
    .concat(GRADES.map(g => ['indepAt:' + g, 'Independent at Grade ' + g]));
  const L = k => Detect.FIELD_LABELS[k] || k;
  const confClass = c => c >= 0.8 ? 'ok' : 'warn';
  function colLabel(col) {
    let s = L(col.key);
    if (col.choice) s += ' = ' + col.choice;
    if (col.flag || col.choice) s += ` (mark “${col.mark ?? state.settings.defaultMark}”)`;
    return s;
  }

  async function renderMapper() {
    const t = state.templates.find(x => x.id === ui.tplId);
    if (!t) { ui.tplId = null; render(); return; }
    const data = await tplData(t.id);
    if (!data) { $('#view').innerHTML = '<div class="panel empty">The template file is missing from this computer. Remove it and import it again.</div>'; return; }
    const m = t.sheets[ui.sheetIdx] || t.sheets[0];
    const sheet = data.wb.sheets.find(s => s.path === m.sheetPath);
    const marks = {}, titles = {};
    for (const f of m.fields) { marks[f.ref] = f.conf >= 0.8 ? 'mk-sure' : 'mk-check'; titles[f.ref] = `${L(f.key)} (${f.mode === 'blank' ? 'fills the ____' : f.mode === 'find' ? 'replaces “' + f.find + '”' : 'value'})`; }
    for (const l of m.lists) {
      for (let r = l.headerRows[0]; r <= l.headerRows[1]; r++) for (let c = l.cols[0]; c <= l.cols[1]; c++) marks[XL.makeRef(r, c)] = marks[XL.makeRef(r, c)] || 'mk-head';
      for (const col of l.columns) for (const p of l.parts) for (let r = p.first; r <= p.last; r++) {
        const ref = XL.makeRef(r, col.col);
        marks[ref] = col.conf >= 0.8 ? 'mk-col' : 'mk-colcheck';
        titles[ref] = `${colLabel(col)} · ${p.sex === 'M' ? 'male learners' : p.sex === 'F' ? 'female learners' : 'learners'}`;
      }
    }
    for (const s of m.summaries) for (let r = s.rows[0]; r <= s.rows[1]; r++) {
      marks[XL.makeRef(r, s.labelCol)] = 'mk-col'; titles[XL.makeRef(r, s.labelCol)] = s.groupBy === 'section' ? 'Section name' : 'Grade level';
      for (const col of s.columns) { const ref = XL.makeRef(r, col.col); if (!sheet.cells.get(ref)?.formula) { marks[ref] = 'mk-col'; titles[ref] = `Count: ${METRICS.find(x => x[0] === col.metric)?.[1] || col.metric} · ${col.sex}`; } }
    }
    if (ui.sel) marks[ui.sel] = (marks[ui.sel] || '') + ' mk-sel';

    const sheetTabs = t.sheets.map((s, i) => `<option value="${i}"${i === ui.sheetIdx ? ' selected' : ''}>${esc(s.sheetName)} — ${KIND_LABEL[s.kind]}</option>`).join('');
    const fieldsHtml = m.fields.length ? m.fields.map(f => `
      <div class="map-item" data-ref="${f.ref}">
        <span class="dot ${confClass(f.conf)}" title="${f.conf >= 0.8 ? 'Sure' : 'Please check'}"></span>
        <span class="mono">${f.ref}</span>
        <select data-field="${f.id}" aria-label="What goes in ${f.ref}">${options(FIELD_KEYS.map(k => [k, L(k)]), f.key)}</select>
        <button class="x" type="button" data-act="del-field" data-id="${f.id}" title="Remove">✕</button>
      </div>`).join('') : '<p class="muted">None found.</p>';
    const listsHtml = m.lists.map((l, li) => `
      <div class="panel stack">
        <h3>Learner table ${m.lists.length > 1 ? li + 1 : ''}</h3>
        ${l.parts.map((p, pi) => `<div class="row" style="gap:6px">
          <span class="muted" style="width:52px">Rows</span>
          <input type="number" style="width:72px" id="p-${li}-${pi}-f" data-part="${li}:${pi}:first" value="${p.first}"> –
          <input type="number" style="width:72px" id="p-${li}-${pi}-l" data-part="${li}:${pi}:last" value="${p.last}">
          <select data-part="${li}:${pi}:sex" id="p-${li}-${pi}-s">${options([['', 'All learners'], ['M', 'Male only'], ['F', 'Female only']], p.sex || '')}</select>
        </div>`).join('')}
        <div class="map-list">${l.columns.map((col, ci) => `
          <div class="map-item" data-col="${col.col}">
            <span class="dot ${confClass(col.conf)}"></span>
            <span class="mono">${XL.numToCol(col.col)}</span>
            <select data-lcol="${li}:${ci}" aria-label="Column ${XL.numToCol(col.col)}">${options(COL_KEYS.map(k => [k, L(k)]), col.key)}</select>
            <button class="x" type="button" data-act="del-lcol" data-li="${li}" data-ci="${ci}" title="Remove">✕</button>
          </div>
          ${col.choice || col.flag || col.key === 'a.level' || col.key === 'learner.sex' ? `<div class="row" style="gap:6px;padding:0 4px 6px 64px;font-size:.82rem">
            ${col.key === 'a.level' || col.key === 'learner.sex' ? `<select data-lchoice="${li}:${ci}">${options((col.key === 'a.level' ? [['', 'Write the level'], ...LEVELS.map(x => [x, 'Mark if ' + x])] : [['', 'Write M/F'], ['M', 'Mark if male'], ['F', 'Mark if female']]), col.choice || '')}</select>` : ''}
            ${col.choice || col.flag ? `<span class="muted">mark</span><input type="text" style="width:44px" data-lmark="${li}:${ci}" value="${esc(col.mark ?? state.settings.defaultMark)}">` : ''}
          </div>` : ''}`).join('')}
          ${(l.unknownColumns || []).map(u => `<div class="map-item"><span class="dot bad"></span><span class="mono">${XL.numToCol(u.col)}</span><span class="muted" title="${esc(u.label)}">Not recognised</span><button class="btn small quiet" type="button" data-act="add-lcol" data-li="${li}" data-col="${u.col}">Assign</button></div>`).join('')}
        </div>
      </div>`).join('');
    const sumHtml = m.summaries.map((s, si) => `
      <div class="panel stack">
        <h3>Count table · one row per ${s.groupBy === 'section' ? 'section' : 'grade level'}</h3>
        <div class="row" style="gap:6px"><span class="muted">Rows</span>
          <input type="number" style="width:72px" data-srow="${si}:0" value="${s.rows[0]}"> – <input type="number" style="width:72px" data-srow="${si}:1" value="${s.rows[1]}">
          <select data-sgroup="${si}">${options([['section', 'Sections of one grade'], ['grade', 'Grade levels']], s.groupBy)}</select>
        </div>
        <p class="muted">${s.columns.length} count columns found${(s.unknownColumns || []).length ? `, ${s.unknownColumns.length} not recognised` : ''}. Columns that already hold formulas (totals) are left alone.</p>
        <details><summary>Show columns</summary><div class="map-list">${s.columns.map((col, ci) => `
          <div class="map-item"><span class="dot ok"></span><span class="mono">${XL.numToCol(col.col)}</span>
            <select data-scol="${si}:${ci}">${options(METRICS, col.metric)}</select><span class="chip">${col.sex}</span></div>`).join('')}</div></details>
      </div>`).join('');

    const selCell = ui.sel ? (() => {
      const p = XL.parseRef(ui.sel);
      const txt = XL.cellText(sheet, p.r, p.c);
      const blanks = (txt.match(/_{3,}/g) || []).length;
      const existing = m.fields.filter(f => f.ref === ui.sel);
      return `<div class="panel stack">
        <h3>Cell ${ui.sel}</h3>
        <p>${txt ? `“${esc(txt.length > 120 ? txt.slice(0, 120) + '…' : txt)}”` : '<span class="muted">Empty cell</span>'}</p>
        ${existing.length ? `<p class="muted">Already filled with: ${existing.map(f => esc(L(f.key))).join(', ')}</p>` : ''}
        <label class="field"><span>Put this here</span><select id="sel-key">${options(FIELD_KEYS.map(k => [k, L(k)]))}</select></label>
        <label class="field"><span>How</span><select id="sel-mode">${options([
          ['value', txt ? 'Replace the whole cell' : 'Write into the cell'],
          ...Array.from({ length: blanks }, (_, i) => ['blank:' + i, `Fill blank ${i + 1} (____)`]),
          ...(txt ? [['find', 'Replace one word or number in the text']] : []),
        ], blanks ? 'blank:0' : 'value')}</select></label>
        <label class="field" id="find-wrap" hidden><span>Word to replace</span><input type="text" id="sel-find" placeholder="e.g. 2025-2026"></label>
        <div class="row"><button class="btn primary small" type="button" data-act="add-field">Add</button><button class="btn small quiet" type="button" data-act="clear-sel">Cancel</button></div>
      </div>`;
    })() : '<div class="panel muted" style="font-size:.88rem">Click any cell on the form to tell the app what goes there.</div>';

    $('#view').innerHTML = `
      <div class="head">
        <div><button class="btn quiet small" type="button" data-act="close-tpl">‹ All templates</button><h1>${esc(t.name)}</h1></div>
        <div class="row">
          <select id="sheet-pick" aria-label="Sheet">${sheetTabs}</select>
          <select id="kind-pick" aria-label="Form type">${options(Object.entries(KIND_LABEL), m.kind)}</select>
          <select id="lang-pick" aria-label="Language">${options([['', 'Language: choose when printing'], ['Filipino', 'Filipino'], ['English', 'English']], m.language || '')}</select>
          <button class="btn small" type="button" data-act="redetect">Read again</button>
          <button class="btn small ${m.checked ? '' : 'primary'}" type="button" data-act="mark-checked">${m.checked ? 'Checked ✓' : 'Mark as checked'}</button>
        </div>
      </div>
      <div class="legend">
        <span><i class="sw" style="background:rgba(45,122,76,.45)"></i>Found, sure</span>
        <span><i class="sw" style="background:rgba(214,150,30,.55)"></i>Found, please check</span>
        <span><i class="sw" style="background:rgba(45,122,76,.14)"></i>Learner / count rows</span>
        <span><i class="sw" style="background:rgba(29,107,87,.16)"></i>Table heading</span>
        <span>Hover a cell to see what goes there.</span>
      </div>
      <div class="mapper">
        <div class="sheet-view" id="sheet-view"><div class="paper" style="zoom:${ui.zoom}">${XL.renderSheet(sheet, { marks, titles })}</div></div>
        <div class="side">
          ${selCell}
          <div class="panel stack"><h3>Single values</h3><div class="map-list">${fieldsHtml}</div></div>
          ${listsHtml}${sumHtml}
          <div class="row"><span class="muted">Zoom</span>${seg('zoom', ['0.6', '0.8', '1'], String(ui.zoom), { '0.6': '60%', '0.8': '80%', '1': '100%' })}</div>
        </div>
      </div>`;
    const mode = $('#sel-mode');
    if (mode) mode.addEventListener('change', () => { $('#find-wrap').hidden = mode.value !== 'find'; });
  }

  function currentMapping() {
    const t = state.templates.find(x => x.id === ui.tplId);
    return t ? t.sheets[ui.sheetIdx] : null;
  }

  // ================= Print forms =================
  function printableSheets() {
    const out = [];
    for (const t of state.templates) t.sheets.forEach((m, i) => { if (m.kind !== 'none') out.push({ t, m, i, key: t.id + ':' + i }); });
    return out;
  }
  function viewPrint() {
    const forms = printableSheets();
    if (!forms.length) return `<div class="head"><div><h1>Print forms</h1></div></div><div class="panel empty">Import a template first under <b>Templates</b>.</div>`;
    const p = ui.print;
    if (!forms.find(f => f.key === p.form)) p.form = forms[0].key;
    const f = forms.find(x => x.key === p.form);
    const kind = f.m.kind;
    const list = syClasses();
    if (!p.classId || !list.find(c => c.id === p.classId)) p.classId = ui.classId || (list[0] && list[0].id);
    const grades = [...new Set(list.map(c => String(c.grade)))].sort((a, b) => a - b);
    if (!p.grade || !grades.includes(p.grade)) p.grade = (list.find(c => c.id === p.classId) || {}).grade || grades[0];
    p.period = p.period || ui.period;
    p.lang = f.m.language || p.lang || ui.lang;
    if (p.fit === undefined) p.fit = true;
    const wide = kind === 'grade' || kind === 'school';
    if (p.orient === undefined || p.lastForm !== p.form) { p.orient = wide ? 'landscape' : ''; p.lastForm = p.form; }
    const groups = {};
    for (const x of forms) (groups[x.t.name] = groups[x.t.name] || []).push(x);
    const formSelect = Object.entries(groups).map(([n, xs]) => `<optgroup label="${esc(n)}">${xs.map(x => `<option value="${x.key}"${x.key === p.form ? ' selected' : ''}>${esc(x.m.sheetName)} (${KIND_LABEL[x.m.kind]})</option>`).join('')}</optgroup>`).join('');
    const ctx = kind === 'class' || kind === 'learner'
      ? `<label class="field"><span>Class</span><select id="pr-class">${options(list.map(c => [c.id, className(c)]), p.classId)}</select></label>`
      : kind === 'grade' ? `<label class="field"><span>Grade</span><select id="pr-grade">${options(grades.map(g => [g, 'Grade ' + g]), p.grade)}</select></label>`
        : `<div class="field"><span style="font-weight:600;font-size:.85rem;color:var(--muted)">Covers</span><span>All classes in ${esc(state.sy)}</span></div>`;
    return `
      <div class="head">
        <div><h1>Print forms</h1><p>The app fills your data into the original template and saves it as an Excel file. Open it in Excel and print. It looks exactly like the DepEd form because it <i>is</i> the DepEd form.</p></div>
      </div>
      <div class="panel stack">
        <div class="grid2">
          <label class="field"><span>Form</span><select id="pr-form">${formSelect}</select></label>
          ${ctx}
          <div class="field"><span style="font-weight:600;font-size:.85rem;color:var(--muted)">Period</span>${seg('pr-period', PERIODS, p.period, PERIOD_LABEL)}</div>
          <div class="field"><span style="font-weight:600;font-size:.85rem;color:var(--muted)">Language${f.m.language ? ' (set by the form)' : ''}</span>${f.m.language ? `<span class="chip ok">${f.m.language}</span>` : seg('pr-lang', LANGS, p.lang)}</div>
        </div>
        <details>
          <summary>Page setup</summary>
          <div class="grid2" style="margin-top:10px">
            <label class="row" style="gap:6px"><input type="checkbox" id="pr-fit" ${p.fit ? 'checked' : ''}> Fit the form to the page width</label>
            <label class="field"><span>Orientation</span><select id="pr-orient">${options([['', 'As in template'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], p.orient)}</select></label>
            <label class="field"><span>Paper</span><select id="pr-paper">${options(PAPER, p.paper || '')}</select></label>
            <label class="row" style="gap:6px"><input type="checkbox" id="pr-only" ${p.keepAll ? '' : 'checked'}> Show only this form’s sheet in the saved file</label>
          </div>
        </details>
      </div>
      <div id="pr-warn"></div>
      <div class="row">
        <button class="btn primary" type="button" data-act="save-form">Save filled Excel file</button>
        ${isDesktop ? '<button class="btn" type="button" data-act="open-form">Open in Excel to print</button>' : ''}
        <span class="muted" id="pr-pages"></span>
      </div>
      <div class="preview-wrap" id="preview"><div class="empty">Preparing preview…</div></div>`;
  }

  function printContext() {
    const forms = printableSheets();
    const f = forms.find(x => x.key === ui.print.form);
    if (!f) return null;
    const p = ui.print;
    return {
      f, ctx: {
        kind: f.m.kind, classId: p.classId, grade: p.grade, period: p.period,
        lang: f.m.language || p.lang, date: new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }),
      },
    };
  }

  async function buildFiles() {
    const pc = printContext();
    if (!pc) return null;
    const { f, ctx } = pc;
    const data = await tplData(f.t.id);
    if (!data) throw new Error('The template file is missing. Import it again.');
    const sheet = data.wb.sheets.find(s => s.path === f.m.sheetPath);
    const p = ui.print;
    const page = { fit: p.fit, orientation: p.orient || null, paper: p.paper ? +p.paper : null };
    const opts = { onlySheet: p.keepAll ? null : f.m.sheetPath, pageSheet: f.m.sheetPath, page, type: 'uint8array' };
    const files = [];
    const warnings = [];
    const cls = state.classes.find(c => c.id === ctx.classId);
    const base = [f.m.sheetName, ctx.kind === 'grade' ? 'Grade ' + ctx.grade : ctx.kind === 'school' ? state.sy : className(cls), ctx.period].join(' - ').replace(/[\\/:*?"<>|]+/g, ' ');
    if (ctx.kind === 'learner') {
      const learners = Data.sortLearners(cls ? cls.learners : []);
      for (const l of learners) {
        const r = Data.buildWrites(f.m, sheet, state, Object.assign({}, ctx, { learner: l }));
        const out = await XL.fillWorkbook(data.buf.slice(0), { [f.m.sheetPath]: r.pages[0] }, opts);
        files.push({ name: `${Data.fullName(l, state.settings)} - ${ctx.period}.xlsx`.replace(/[\\/:*?"<>|]+/g, ' '), data: out.data, writes: r.pages[0] });
      }
      if (!learners.length) warnings.push('This class has no learners.');
    } else {
      const r = Data.buildWrites(f.m, sheet, state, ctx);
      warnings.push(...r.warnings);
      for (let i = 0; i < r.pages.length; i++) {
        const out = await XL.fillWorkbook(data.buf.slice(0), { [f.m.sheetPath]: r.pages[i] }, opts);
        files.push({ name: `${base}${r.pages.length > 1 ? ` (page ${i + 1})` : ''}.xlsx`, data: out.data, writes: r.pages[i] });
      }
    }
    const missing = Data.missingResults(state, ctx);
    return { f, ctx, files, warnings, missing, sheet };
  }

  // shrink a wide form so the whole width is visible
  function fitZoom(box) {
    const paper = box.querySelector('.paper');
    const w = paper && paper.scrollWidth;
    const avail = box.clientWidth - 34;
    if (w && avail > 0 && w > avail) paper.style.zoom = Math.max(0.3, avail / w).toFixed(3);
  }

  let previewSeq = 0;
  async function refreshPreview() {
    const seq = ++previewSeq;
    const box = $('#preview');
    if (!box) return;
    try {
      const res = await buildFiles();
      if (seq !== previewSeq || !res) return;
      const warn = [...res.warnings];
      if (res.missing.length) warn.unshift(`${res.missing.length} learner(s) have no reading level for ${res.ctx.period} ${res.ctx.lang}: ${res.missing.slice(0, 5).map(l => Data.fullName(l, state.settings)).join('; ')}${res.missing.length > 5 ? '…' : ''}`);
      const unchecked = !res.f.m.checked ? '<li>This form has not been marked as checked yet. Open it under Templates and confirm the highlighted cells.</li>' : '';
      $('#pr-warn').innerHTML = warn.length || unchecked ? `<div class="notice"><b>Before you print</b><ul>${unchecked}${warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '';
      $('#pr-pages').textContent = res.files.length > 1 ? `${res.files.length} files will be saved${res.ctx.kind === 'learner' ? ' (one per learner, in a .zip)' : ''}.` : '';
      if (!res.files.length) { box.innerHTML = '<div class="empty">Nothing to preview.</div>'; return; }
      const wb = await XL.loadWorkbook(res.files[0].data.slice(0));
      if (seq !== previewSeq) return;
      const sheet = wb.sheets.find(s => s.path === res.f.m.sheetPath);
      XL.computeFormulas(sheet);
      const marks = {};
      for (const w of res.files[0].writes) marks[w.ref] = 'mk-fill';
      box.innerHTML = `<div class="paper">${XL.renderSheet(sheet, { marks })}</div>`;
      fitZoom(box);
    } catch (e) {
      if (seq === previewSeq) box.innerHTML = `<div class="notice bad">${esc(e.message || e)}</div>`;
    }
  }

  async function saveForm(openAfter) {
    const btns = $$('[data-act="save-form"],[data-act="open-form"]');
    btns.forEach(b => { b.disabled = true; });
    try {
      const res = await buildFiles();
      if (!res || !res.files.length) { toast('Nothing to save.'); return; }
      let blob, name;
      if (res.files.length === 1) {
        blob = new Blob([res.files[0].data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        name = res.files[0].name;
      } else {
        const zip = new JSZip();
        for (const f of res.files) zip.file(f.name, f.data);
        blob = await zip.generateAsync({ type: 'blob' });
        name = res.files[0].name.replace(/( \(page 1\))?\.xlsx$/, '') + '.zip';
        if (res.ctx.kind === 'learner') name = `${res.f.m.sheetName} - ${className(state.classes.find(c => c.id === res.ctx.classId))} - ${res.ctx.period}.zip`;
      }
      if (openAfter && window.desktop) {
        const path = await window.desktop.openInExcel(name, new Uint8Array(await blob.arrayBuffer()));
        toast(path ? 'Opened in Excel. Press Ctrl+P there to print.' : 'Could not open the file.');
        return;
      }
      const r = await saveBlob(name, blob);
      if (r.status === 'saved') toast(r.path ? `Saved to ${r.path}` : 'Saved. Open the file in Excel to print it.');
    } catch (e) {
      toast(e.message || String(e));
    } finally { btns.forEach(b => { b.disabled = false; }); }
  }

  // ================= Settings =================
  function viewSettings() {
    const s = state.school, st = state.settings;
    const inp = (id, label, val, extra = '') => `<label class="field"><span>${label}</span><input type="text" id="${id}" value="${esc(val)}" ${extra}></label>`;
    return `
      <div class="head"><div><h1>School &amp; settings</h1><p>These details fill the header and signature lines of every form.</p></div></div>
      <div class="panel stack">
        <h2>School</h2>
        <div class="grid2">
          ${inp('s-name', 'School name', s.name, 'data-s="name"')}
          ${inp('s-id', 'School ID', s.id, 'data-s="id"')}
          ${inp('s-district', 'District', s.district, 'data-s="district"')}
          ${inp('s-division', 'Division', s.division, 'data-s="division"')}
          ${inp('s-region', 'Region', s.region, 'data-s="region"')}
          ${inp('s-head', 'School head', s.head, 'data-s="head"')}
          ${inp('s-chair', 'Grade level chairperson', s.chair, 'data-s="chair"')}
          ${inp('s-coord', 'Reading coordinator', s.coordinator, 'data-s="coordinator"')}
        </div>
      </div>
      <div class="panel stack">
        <h2>How things are written on the forms</h2>
        <div class="grid2">
          <label class="field"><span>Name format</span><select id="set-order">${options([['last', 'DELA CRUZ, Juan P.'], ['first', 'Juan P. Dela Cruz']], st.nameOrder)}</select></label>
          <label class="row" style="gap:6px;align-self:end"><input type="checkbox" id="set-upper" ${st.upperNames ? 'checked' : ''}> Names in capital letters</label>
          <label class="field"><span>Mark for tick-box columns</span><input type="text" id="set-mark" value="${esc(st.defaultMark)}" style="width:80px"></label>
          ${PERIODS.map(k => inp('pn-' + k, `${k} is written as`, st.periodNames[k], `data-pn="${k}"`)).join('')}
        </div>
        <p class="muted">The period name replaces the word in the form title, for example “(MIDYEAR)”.</p>
      </div>
      <div class="panel stack">
        <h2>Scoring helper cut-offs</h2>
        <p class="muted">Used only to suggest a level from oral reading scores. Check them against the Phil-IRI manual your division uses.</p>
        <div class="grid2">
          <label class="field"><span>Word reading: Independent from (%)</span><input type="number" id="r-wi" data-rule="word.indep" value="${st.rules.word.indep}"></label>
          <label class="field"><span>Word reading: Instructional from (%)</span><input type="number" id="r-wn" data-rule="word.inst" value="${st.rules.word.inst}"></label>
          <label class="field"><span>Comprehension: Independent from (%)</span><input type="number" id="r-ci" data-rule="comp.indep" value="${st.rules.comp.indep}"></label>
          <label class="field"><span>Comprehension: Instructional from (%)</span><input type="number" id="r-cn" data-rule="comp.inst" value="${st.rules.comp.inst}"></label>
          <label class="field"><span>Overall level</span><select id="set-combine">${options([['lower', 'The lower of the two'], ['comp', 'Comprehension level'], ['word', 'Word reading level']], st.combine)}</select></label>
        </div>
      </div>
      <div class="panel stack">
        <h2>Backup</h2>
        <p class="muted">${isDesktop ? 'Your data is saved on this computer automatically.' : 'In this test version your data is kept in this browser only.'} Save a backup file regularly (for example to a USB drive). A backup includes your templates.</p>
        <div class="row">
          <button class="btn" type="button" data-act="backup">Save backup file</button>
          <span class="btn file-btn">Restore from backup…<input type="file" id="restore-file" accept=".json,application/json"></span>
          <span class="btn file-btn">Add a colleague’s classes…<input type="file" id="merge-file" accept=".json,application/json"></span>
        </div>
        <p class="muted">“Add a colleague’s classes” brings in other teachers’ classes and results from their backup file, so a grade level chairperson or coordinator can print the summaries.</p>
        <div class="row"><button class="btn danger" type="button" data-act="reset-all">Erase everything</button></div>
      </div>`;
  }

  async function makeBackup() {
    const tpls = {};
    for (const t of state.templates) {
      const buf = await Data.kvGet('tpl:' + t.id);
      if (buf) tpls[t.id] = await new JSZip().file('x', buf).file('x').async('base64');
    }
    return JSON.stringify({ app: 'phil-iri-recorder', savedAt: new Date().toISOString(), state, templates: tpls });
  }
  function b64ToBuf(b64) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }

  // ================= events =================
  document.addEventListener('click', async (e) => {
    const nav = e.target.closest('.nav-item');
    if (nav) { ui.view = nav.dataset.view; if (ui.view !== 'templates') { ui.tplId = null; ui.sel = null; } render(); save(); window.scrollTo(0, 0); return; }

    const segBtn = e.target.closest('.seg button');
    if (segBtn) {
      const name = segBtn.parentElement.dataset.seg, v = segBtn.dataset.v;
      if (name === 'period') { ui.period = v; render(); }
      else if (name === 'lang') { ui.lang = v; render(); }
      else if (name === 'pr-period') { ui.print.period = v; render(); }
      else if (name === 'pr-lang') { ui.print.lang = v; render(); }
      else if (name === 'zoom') { ui.zoom = +v; renderMapper(); }
      save();
      return;
    }

    const lvlBtn = e.target.closest('.lvl button');
    if (lvlBtn) {
      const lid = lvlBtn.closest('tr').dataset.lid;
      const cur = Data.result(state, lid, ui.period, ui.lang).level;
      Data.setResult(state, lid, ui.period, ui.lang, { level: cur === lvlBtn.dataset.level ? '' : lvlBtn.dataset.level });
      save(); render();
      return;
    }

    const td = e.target.closest('#sheet-view td[data-ref]');
    if (td) { ui.sel = td.dataset.ref; renderMapper(); return; }

    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const c = currentClass();

    if (act === 'clear-sample') {
      if (!armed(b, 'Click again to clear')) return;
      state.classes = []; state.results = {}; state.sample = false;
      state.school = Data.emptyState().school;
      ui.classId = null; save(); render(); toast('Sample data cleared. Add your first class.');
    } else if (act === 'pick-class') { ui.classId = b.dataset.id; save(); render(); }
    else if (act === 'add-class') {
      const nc = { id: Data.uid('c'), sy: state.sy, grade: c ? c.grade : '7', section: '', adviser: c ? c.adviser : '', designation: c ? c.designation : '', learners: [] };
      state.classes.push(nc); ui.classId = nc.id; save(); render();
      const s = $('#c-section'); if (s) s.focus();
    } else if (act === 'del-class') {
      if (!armed(b, 'Click again to delete')) return;
      for (const l of c.learners) delete state.results[l.id];
      state.classes = state.classes.filter(x => x !== c); ui.classId = null; save(); render(); toast('Class deleted.');
    } else if (act === 'add-learner') {
      const l = { id: Data.uid('l'), lrn: '', last: '', first: '', middle: '', ext: '', sex: '' };
      c.learners.push(l); save(); render();
      const inp = $(`#last-${l.id}`); if (inp) inp.focus();
    } else if (act === 'del-learner') {
      const lid = b.closest('tr').dataset.lid;
      c.learners = c.learners.filter(l => l.id !== lid); delete state.results[lid]; save(); render();
    } else if (act === 'paste-learners') {
      const rows = parseLearnerRows($('#paste-box').value);
      if (!rows.length) { $('#paste-hint').textContent = 'No names found. Check that each learner is on its own line.'; return; }
      c.learners.push(...rows); save(); render(); toast(`Added ${rows.length} learner${rows.length === 1 ? '' : 's'}.`);
    } else if (act === 'use-suggest') {
      const lid = b.closest('tr').dataset.lid;
      Data.setResult(state, lid, ui.period, ui.lang, { level: b.dataset.level }); save(); render();
    } else if (act === 'load-sample-tpl') {
      const s = window.SAMPLE_TEMPLATES[b.dataset.k];
      await importTemplate(b64ToBuf(s.data), s.file, s.name, true);
    } else if (act === 'open-sheet') {
      ui.tplId = b.dataset.tpl; ui.sheetIdx = +b.dataset.i; ui.sel = null; render(); window.scrollTo(0, 0);
    } else if (act === 'close-tpl') { ui.tplId = null; ui.sel = null; render(); }
    else if (act === 'del-tpl') {
      if (!armed(b, 'Click again to remove')) return;
      state.templates = state.templates.filter(t => t.id !== b.dataset.tpl); Data.kvDel('tpl:' + b.dataset.tpl); tplCache.delete(b.dataset.tpl); save(); render();
    } else if (act === 'print-tpl') {
      const t = state.templates.find(x => x.id === b.dataset.tpl);
      const i = t.sheets.findIndex(m => m.kind !== 'none');
      if (i < 0) { toast('No forms were found in this template.'); return; }
      ui.print.form = t.id + ':' + i; ui.view = 'print'; render();
    } else if (act === 'redetect') {
      const t = state.templates.find(x => x.id === ui.tplId);
      const data = await tplData(t.id);
      const m = t.sheets[ui.sheetIdx];
      const sheet = data.wb.sheets.find(s => s.path === m.sheetPath);
      t.sheets[ui.sheetIdx] = Detect.detectSheet(sheet);
      save(); renderMapper(); toast('Read the sheet again. Your manual changes on this sheet were replaced.');
    } else if (act === 'mark-checked') {
      const m = currentMapping(); m.checked = !m.checked; save(); renderMapper();
    } else if (act === 'del-field') {
      const m = currentMapping(); m.fields = m.fields.filter(f => f.id !== b.dataset.id); save(); renderMapper();
    } else if (act === 'clear-sel') { ui.sel = null; renderMapper(); }
    else if (act === 'add-field') {
      const m = currentMapping();
      const key = $('#sel-key').value, modeV = $('#sel-mode').value;
      const f = { id: Data.uid('F'), ref: ui.sel, key, conf: 1, label: L(key) };
      if (modeV.startsWith('blank:')) { f.mode = 'blank'; f.blankIndex = +modeV.split(':')[1]; }
      else if (modeV === 'find') {
        f.mode = 'find'; f.find = $('#sel-find').value;
        if (!f.find) { toast('Type the word or number to replace.'); return; }
      } else f.mode = 'value';
      m.fields.push(f); ui.sel = null; save(); renderMapper();
    } else if (act === 'del-lcol') {
      const m = currentMapping(); const l = m.lists[+b.dataset.li];
      const [col] = l.columns.splice(+b.dataset.ci, 1);
      (l.unknownColumns = l.unknownColumns || []).push({ col: col.col, label: col.label || '' });
      save(); renderMapper();
    } else if (act === 'add-lcol') {
      const m = currentMapping(); const l = m.lists[+b.dataset.li];
      const col = +b.dataset.col;
      l.unknownColumns = (l.unknownColumns || []).filter(u => u.col !== col);
      l.columns.push({ col, key: 'a.remarks', conf: 1 }); l.columns.sort((a, b2) => a.col - b2.col);
      save(); renderMapper();
    } else if (act === 'save-form') saveForm(false);
    else if (act === 'open-form') saveForm(true);
    else if (act === 'backup') {
      const json = await makeBackup();
      const r = await saveBlob(`phil-iri-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([json], { type: 'application/json' }));
      if (r.status === 'saved') toast('Backup saved.');
    } else if (act === 'reset-all') {
      if (!armed(b, 'Click again to erase everything')) return;
      for (const t of state.templates) Data.kvDel('tpl:' + t.id);
      state = Data.emptyState(); tplCache.clear(); ui.classId = null; save(); render(); toast('Everything was erased.');
    }
  });

  document.addEventListener('change', async (e) => {
    const t = e.target;
    const c = currentClass();
    if (t.id === 'sy-input') { state.sy = t.value.trim() || state.sy; ui.classId = null; save(); render(); return; }
    if (t.dataset.cf && c) { c[t.dataset.cf] = t.value; save(); if (t.dataset.cf === 'grade' || t.dataset.cf === 'section') render(); return; }
    if (t.dataset.f && c) {
      const l = c.learners.find(x => x.id === t.closest('tr').dataset.lid);
      if (l) { l[t.dataset.f] = t.value.trim(); save(); if (t.dataset.f === 'sex') render(); }
      return;
    }
    if (t.dataset.r) {
      const lid = t.closest('tr').dataset.lid;
      const v = t.type === 'checkbox' ? t.checked : t.value;
      Data.setResult(state, lid, ui.period, ui.lang, { [t.dataset.r]: v });
      save();
      if (t.type === 'checkbox' || ['words', 'miscues', 'compCorrect', 'compTotal'].includes(t.dataset.r)) render();
      return;
    }
    if (t.id === 'res-class') { ui.classId = t.value; save(); render(); return; }
    if (t.id === 'helper-toggle') { ui.helper = t.checked; render(); return; }
    if (t.id === 'tpl-file' && t.files[0]) { const file = t.files[0]; await importTemplate(await file.arrayBuffer(), file.name); return; }
    // mapper
    if (t.id === 'sheet-pick') { ui.sheetIdx = +t.value; ui.sel = null; renderMapper(); return; }
    const m = ui.view === 'templates' && ui.tplId ? currentMapping() : null;
    if (m) {
      if (t.id === 'kind-pick') { m.kind = t.value; }
      else if (t.id === 'lang-pick') { m.language = t.value || null; }
      else if (t.dataset.field) { const f = m.fields.find(x => x.id === t.dataset.field); f.key = t.value; f.label = L(t.value); f.conf = 1; }
      else if (t.dataset.part) { const [li, pi, k] = t.dataset.part.split(':'); const p = m.lists[+li].parts[+pi]; p[k] = k === 'sex' ? (t.value || null) : +t.value; m.lists[+li].lastRow = Math.max(...m.lists[+li].parts.map(x => x.last)); }
      else if (t.dataset.lcol) { const [li, ci] = t.dataset.lcol.split(':').map(Number); const col = m.lists[li].columns[ci]; col.key = t.value; col.conf = 1; delete col.choice; col.flag = ['a.struggling', 'a.nonReader'].includes(t.value); }
      else if (t.dataset.lchoice) { const [li, ci] = t.dataset.lchoice.split(':').map(Number); const col = m.lists[li].columns[ci]; col.choice = t.value || undefined; col.conf = 1; }
      else if (t.dataset.lmark) { const [li, ci] = t.dataset.lmark.split(':').map(Number); m.lists[li].columns[ci].mark = t.value; }
      else if (t.dataset.srow) { const [si, k] = t.dataset.srow.split(':').map(Number); m.summaries[si].rows[k] = +t.value; }
      else if (t.dataset.sgroup) { m.summaries[+t.dataset.sgroup].groupBy = t.value; m.kind = t.value === 'section' ? 'grade' : 'school'; }
      else if (t.dataset.scol) { const [si, ci] = t.dataset.scol.split(':').map(Number); m.summaries[si].columns[ci].metric = t.value; }
      else return;
      save(); renderMapper(); return;
    }
    // print
    if (t.id === 'pr-form') { ui.print.form = t.value; render(); return; }
    if (t.id === 'pr-class') { ui.print.classId = t.value; render(); return; }
    if (t.id === 'pr-grade') { ui.print.grade = t.value; render(); return; }
    if (t.id === 'pr-fit') { ui.print.fit = t.checked; refreshPreview(); return; }
    if (t.id === 'pr-orient') { ui.print.orient = t.value; refreshPreview(); return; }
    if (t.id === 'pr-paper') { ui.print.paper = t.value; refreshPreview(); return; }
    if (t.id === 'pr-only') { ui.print.keepAll = !t.checked; refreshPreview(); return; }
    // settings
    if (t.dataset.s) { state.school[t.dataset.s] = t.value.trim(); save(); return; }
    if (t.dataset.pn) { state.settings.periodNames[t.dataset.pn] = t.value.trim(); save(); return; }
    if (t.dataset.rule) { const [a, k] = t.dataset.rule.split('.'); state.settings.rules[a][k] = +t.value; save(); return; }
    if (t.id === 'set-order') { state.settings.nameOrder = t.value; save(); return; }
    if (t.id === 'set-upper') { state.settings.upperNames = t.checked; save(); return; }
    if (t.id === 'set-mark') { state.settings.defaultMark = t.value || '1'; save(); return; }
    if (t.id === 'set-combine') { state.settings.combine = t.value; save(); return; }
    if ((t.id === 'restore-file' || t.id === 'merge-file') && t.files[0]) {
      try {
        const json = JSON.parse(await t.files[0].text());
        if (json.app !== 'phil-iri-recorder' || !json.state) throw new Error('This is not a Phil-IRI Recorder backup file.');
        if (t.id === 'restore-file') {
          state = Object.assign(Data.emptyState(), json.state);
          tplCache.clear();
          for (const [id, b64] of Object.entries(json.templates || {})) await Data.kvSet('tpl:' + id, b64ToBuf(b64));
          ui.classId = null; save(); render(); toast('Backup restored.');
        } else {
          const have = new Set(state.classes.map(x => x.id));
          const add = json.state.classes.filter(x => !have.has(x.id));
          state.classes.push(...add);
          for (const x of add) for (const l of x.learners) if (json.state.results[l.id]) state.results[l.id] = json.state.results[l.id];
          save(); render(); toast(`Added ${add.length} class${add.length === 1 ? '' : 'es'} from the colleague’s file.`);
        }
      } catch (err) { toast(err.message || 'That file could not be read.'); }
      t.value = '';
    }
  });

  // paste a block from Excel straight into the learner grid
  document.addEventListener('paste', (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.f) return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text.includes('\n') && !text.includes('\t')) return;
    e.preventDefault();
    $('#paste-box').value = text;
    $('#paste-hint').textContent = 'Pasted below. Check it, then press “Add these learners”.';
    $('#paste-box').scrollIntoView({ block: 'center' });
  });

  // drag and drop templates
  document.addEventListener('dragover', (e) => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
  document.addEventListener('dragleave', (e) => { const d = e.target.closest && e.target.closest('#drop'); if (d) d.classList.remove('over'); });
  document.addEventListener('drop', async (e) => {
    const d = e.target.closest && e.target.closest('#drop');
    if (!d) return;
    e.preventDefault(); d.classList.remove('over');
    const file = e.dataTransfer.files[0];
    if (file) await importTemplate(await file.arrayBuffer(), file.name);
  });

  // ---------- start ----------
  async function boot() {
    const saved = await Data.kvGet('state');
    if (saved && saved.v === 1) {
      state = Object.assign(Data.emptyState(), saved);
      state.settings = Object.assign(Data.emptyState().settings, saved.settings);
      Object.assign(ui, saved.ui || {});
    } else {
      state = Data.sampleState();
      render();
      const first = Object.keys(window.SAMPLE_TEMPLATES || {})[0];
      if (first) {
        const s = window.SAMPLE_TEMPLATES[first];
        await importTemplate(b64ToBuf(s.data), s.file, s.name, true);
      }
      ui.view = 'classes';
    }
    render();
  }
  boot();
})();
