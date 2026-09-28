/* Phil-IRI Recorder - screens and interactions
 *
 * Main flow for teachers: upload a form -> type into a table that has the
 * same columns as the form -> save / print. Everything else is secondary.
 */
(function () {
  'use strict';
  const { PERIODS, LANGS, LEVELS } = Data;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const GRADES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
  const KIND_LABEL = { class: 'Class form', grade: 'Grade level summary', school: 'School summary', learner: 'Individual record', none: 'Not a form' };
  const PERIOD_LABEL = { BOSY: 'BOSY (Pre-test)', MOSY: 'MOSY (Midyear)', EOSY: 'EOSY (Post-test)' };
  const PAPER = [['', 'As in template'], ['9', 'A4'], ['1', 'Letter (8.5×11 in)'], ['14', 'Long / Folio (8.5×13 in)'], ['5', 'Legal (8.5×14 in)']];
  const isDesktop = !!window.desktop;
  // printing from the page works in the desktop app and in a normal browser, not inside the Claude viewer
  const canPrint = isDesktop || !(window.claude && typeof window.claude.use === 'function');

  let state = Data.emptyState();
  const tplCache = new Map();   // template id -> {buf, wb}
  const ui = { view: 'fill', form: null, classId: null, grade: null, period: 'BOSY', lang: 'Filipino', preview: true, page: {}, tplId: null, sheetIdx: 0, sel: null, zoom: 0.8 };

  // ---------- persistence ----------
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      state.ui = { view: ui.view, form: ui.form, classId: ui.classId, grade: ui.grade, period: ui.period, lang: ui.lang, pLang: ui.pLang };
      Data.kvSet('state', state);
    }, 250);
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
    toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
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
    name = name.replace(/[–—]/g, '-').replace(/[\\/:*?"<>|]+/g, ' ').replace(/[^\x20-\x7EÀ-ſ]/g, '').replace(/\s+/g, ' ').trim();
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
    .sort((a, b) => (+a.grade || 99) - (+b.grade || 99) || (a.section || '').localeCompare(b.section || ''));
  const className = c => c ? (c.grade || c.section ? `Grade ${c.grade || '?'} – ${c.section || 'no section'}` : 'New class') : '';
  function options(list, value) {
    return list.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(l)}</option>`; }).join('');
  }
  function seg(name, values, current, labels = {}) {
    return `<div class="seg" role="group" data-seg="${name}">${values.map(v => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === current}">${esc(labels[v] || v)}</button>`).join('')}</div>`;
  }
  const b64ToBuf = b64 => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  const todayText = () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const usable = m => !m.notes && !m.hidden;
  function allForms() {
    const out = [];
    for (const t of state.templates) t.sheets.forEach((m, i) => { if (usable(m)) out.push({ t, m, i, key: t.id + ':' + i }); });
    return out;
  }
  // what the teacher typed straight onto a form: {ref: text}
  function editsKey(f, learnerId) {
    const who = f.m.kind === 'grade' ? 'g' + ui.grade : f.m.kind === 'school' ? 'all' : f.m.kind === 'learner' ? 'l' + (learnerId || ui.learnerId) : ui.classId;
    return `${f.key}:${who}:${ui.period}`;
  }
  function formEdits(f, create, learnerId) {
    state.edits = state.edits || {};
    const k = editsKey(f, learnerId);
    if (!state.edits[k] && create) state.edits[k] = {};
    return state.edits[k] || {};
  }
  function currentForm() {
    const forms = allForms();
    let f = forms.find(x => x.key === ui.form);
    if (!f) { f = forms[0] || null; ui.form = f ? f.key : null; }
    return f;
  }
  function currentClass(create) {
    const list = syClasses();
    let c = list.find(x => x.id === ui.classId);
    if (!c) c = list[0] || null;
    if (!c && create) {
      c = { id: Data.uid('c'), sy: state.sy, grade: '', section: '', adviser: '', designation: '', learners: [] };
      state.classes.push(c); save();
    }
    ui.classId = c ? c.id : null;
    return c;
  }
  function formLang(f) { return (f && f.m.language) || ui.lang; }

  // ---------- render root ----------
  function render() {
    $('#brand-sy').textContent = 'School year ' + state.sy;
    const onWork = ui.view === 'fill';
    // the file switcher and the Save / Excel / More buttons live in the top bar
    const f0 = currentForm();
    $('#topbar-actions').innerHTML = (onWork && f0 ? workActions(f0) : '')
      + (onWork ? `<button class="btn quiet" type="button" data-act="go-passages">Passages</button>` : '')
      + `<button class="btn quiet" type="button" data-act="${onWork ? 'go-settings' : 'go-fill'}" id="settings-btn">${onWork ? 'Settings' : '‹ Back to my forms'}</button>`;
    const files = state.templates.filter(t => t.sheets.some(usable));
    $('#topbar-files').innerHTML = onWork && f0 ? `
      <label class="file-switch"><span class="visually-hidden">Form file</span>
        <select id="file-pick" aria-label="Form file">${options(files.map(t => [t.id, t.name]).concat([['__upload', '+ Upload another form…']]), f0.t.id)}</select>
      </label>
      <input type="file" id="tpl-file" hidden accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">` : '';
    $('#rail-foot').textContent = isDesktop ? 'Your work is saved on this computer automatically.' : 'Test version: your work is kept in this browser. Save a backup in Settings.';
    const v = $('#view');
    if (ui.view === 'adjust' && ui.tplId) { v.innerHTML = '<div class="empty">Opening…</div>'; renderMapper(); return; }
    if (ui.view === 'settings') { v.innerHTML = viewSettings() + viewClasses(); return; }
    if (ui.view === 'passages') { v.innerHTML = viewPassages(); return; }
    ui.view = 'fill';
    v.innerHTML = viewFill();
  }

  // ================= Fill in forms =================
  function uploadBox(big) {
    const samples = Object.entries(window.SAMPLE_TEMPLATES || {});
    return `<div class="drop${big ? ' big' : ''}" id="drop">
      <b>${big ? 'Upload your DepEd form to start' : 'Upload another form'}</b>
      <span class="muted">Excel file (.xlsx) exactly as you received it. Blank or already filled in, both work.</span>
      <div class="row" style="justify-content:center">
        <span class="btn primary file-btn">Choose Excel file…<input type="file" id="tpl-file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></span>
      </div>
      ${big && samples.length ? `<span class="muted">No file at hand? Try a sample: ${samples.map(([k, s]) => `<button class="btn quiet small" type="button" data-act="load-sample-tpl" data-k="${k}">${esc(s.name)}</button>`).join(' ')}</span>` : ''}
    </div>`;
  }

  function viewFill() {
    const f = currentForm();
    if (!f) {
      const samples = Object.entries(window.SAMPLE_TEMPLATES || {});
      return `
        <section class="hero">
          <p class="eyebrow">Phil-IRI · BOSY · MOSY · EOSY</p>
          <h1>Fill in your DepEd reading forms without retyping them.</h1>
          <p class="lede">Upload the Excel form you received. Type the names and scores in a simple table. Save, and you get the very same form back, filled in and ready to print.</p>
        </section>
        <ol class="steps">
          <li><b>Upload the form</b><span>The Excel file from DepEd or your division, as it is.</span></li>
          <li><b>Type names and scores</b><span>A table with the same columns as the form. Totals fill themselves.</span></li>
          <li><b>Save and print</b><span>Your form, filled in, opened in Excel for printing.</span></li>
        </ol>
        <label class="drop big" id="drop">
          <svg class="drop-icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M14 6h14l10 10v26H14z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M28 6v10h10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M26 36V22m-6 6 6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <b>Choose your Excel form</b>
          <span class="muted">or drop it here · .xlsx, blank or already filled in</span>
          <input type="file" id="tpl-file" class="drop-input" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
        </label>
        ${samples.length ? `<p class="samples muted">No form at hand? Try a sample: ${samples.map(([k, s]) => `<button class="linkbtn" type="button" data-act="load-sample-tpl" data-k="${k}">${esc(s.name)}</button>`).join(' · ')}</p>` : ''}`;
    }
    return viewWork(f);
  }

  // ---------- the working screen: one form, one table ----------
  const FIT_OPTIONS = [['none', 'Keep the form’s own print settings'], ['auto', 'Tidy up printing automatically'], ['page', 'Whole form on one page'], ['width', 'Fit to page width']];
  function viewWork(f) {
    const tabs = allForms().filter(x => x.t.id === f.t.id);
    const kind = f.m.kind;
    const lang = formLang(f);
    let who = '';
    if (kind === 'class' || kind === 'learner' || kind === 'none') {
      const cls = currentClass(true);
      who = `<label class="pill-field"><span>Class</span><select id="fill-class">${options(syClasses().map(c => [c.id, className(c)]).concat([['__new', '+ Add another class']]), cls.id)}</select></label>`;
    } else if (kind === 'grade') {
      const grades = [...new Set(syClasses().map(c => String(c.grade)).filter(Boolean))].sort((a, b) => a - b);
      if (!grades.includes(String(ui.grade))) ui.grade = grades[0] || '';
      who = `<label class="pill-field"><span>Grade</span><select id="fill-grade">${options(grades.length ? grades.map(g => [g, 'Grade ' + g]) : [['', 'No classes yet']], ui.grade)}</select></label>`;
    }
    const head = `
      <nav class="sheet-tabs" role="tablist" aria-label="Forms in this file">${tabs.map(x => `<button type="button" role="tab" class="tab" data-act="tab" data-key="${x.key}" aria-selected="${x.key === f.key}">${esc(x.m.sheetName)}</button>`).join('')}</nav>
      <div class="controls">
        ${who}
        <div class="pill-field"><span>Period</span>${seg('period', PERIODS, ui.period)}</div>
        <div class="pill-field" title="The language of this form. Results are kept separately for Filipino and English."><span>Language</span>${seg('lang', LANGS, lang)}</div>
        <span class="controls-grow"></span>
        ${kind === 'class' ? statStrip(f, lang) : `<span class="kind-tag">${KIND_LABEL[kind]}</span>`}
        <span id="save-note" class="muted small" hidden></span>
      </div>
      <div id="pr-warn"></div>`;
    let body = '';
    if (kind === 'class') body = foundBanner(f) + detailsPanel(f) + fillClass(f, lang, true);
    else if (kind === 'grade' || kind === 'school') body = detailsPanel(f) + summaryCard(f, lang);
    else if (kind === 'learner') body = `<div class="card note"><h2>One form per learner</h2><p>This form is filled once for each learner in the class, using their name and the details below. <b>Save a form for every learner</b> gives you one Excel file per learner in a .zip.</p></div>` + detailsPanel(f);
    else body = `<div class="card note"><h2>This sheet has no learner table the app can fill yet</h2><p>The details the app recognised are below and will be written into the form. Fill in the rest in Excel after saving. If this sheet should be filled by the app, use <b>More › Adjust how this form is read</b>.</p></div>` + detailsPanel(f);
    return head + body;
  }

  // Save / Excel / More, shown in the top bar
  function workActions(f) {
    const kind = f.m.kind;
    const fitVal = ui.page.fit == null ? 'none' : ui.page.fit === false ? 'none' : ui.page.fit === true ? 'width' : ui.page.fit;
    const saveIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9m-4-4 4 4 4-4M4 15h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return `
      ${kind === 'learner'
        ? `<button class="btn primary" type="button" data-act="save-all">${saveIcon}Save for every learner</button>`
        : `<details class="fb-more save-menu">
            <summary class="btn primary">${saveIcon}Save filled file<span class="caret" aria-hidden="true"></span></summary>
            <div class="fb-menu save-choices">
              <button type="button" class="save-choice" data-act="save-file">
                <b>Whole file</b><span>Every form in one workbook, with the same sheets and file name as the template (${f.t.sheets.filter(usable).length} sheets)</span>
              </button>
              <button type="button" class="save-choice" data-act="save-form">
                <b>Only this form</b><span>Just “${esc(f.m.sheetName)}”, the form on your screen</span>
              </button>
            </div>
          </details>`}
      ${isDesktop ? '<button class="btn" type="button" data-act="open-form" title="Open the filled file in Excel to print">Excel</button>' : ''}
      <details class="fb-more">
        <summary class="btn" aria-label="More options">More</summary>
        <div class="fb-menu stack">
          <label class="field"><span>Printing</span><select id="pg-fit">${options(FIT_OPTIONS, fitVal)}</select></label>
          <label class="field"><span>Orientation</span><select id="pg-orient">${options([['', 'As in the form'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], ui.page.orient || '')}</select></label>
          <label class="field"><span>Paper</span><select id="pg-paper">${options(PAPER, ui.page.paper || '')}</select></label>
          <button class="btn" type="button" data-act="open-sheet" data-tpl="${f.t.id}" data-i="${f.i}">Adjust how this form is read</button>
          <button class="btn danger" type="button" data-act="del-tpl" data-tpl="${f.t.id}">Remove this file</button>
        </div>
      </details>`;
  }

  // counts at a glance: small coloured chips
  function statStrip(f, lang) {
    const cls = currentClass(true);
    const hasLevel = f.m.lists.some(l => l.columns.some(c => c.key === 'a.level'));
    const hasFlags = f.m.lists.some(l => l.columns.some(c => c.key === 'a.struggling' || c.key === 'a.nonReader'));
    const n = { all: cls.learners.length, M: 0, F: 0, Independent: 0, Instructional: 0, Frustration: 0, struggling: 0, nonReader: 0, entered: 0 };
    for (const l of cls.learners) {
      if (l.sex === 'M') n.M++; else if (l.sex === 'F') n.F++;
      const r = Data.result(state, l.id, ui.period, lang);
      if (r.level) n[r.level]++;
      if (r.struggling) n.struggling++;
      if (r.nonReader) n.nonReader++;
      if (r.level || r.nonReader || Object.values(r.x || {}).some(v => v !== '' && v != null && v !== false)) n.entered++;
    }
    const chip = (num, label, cls2 = '', title = '') => `<span class="sc ${cls2}"${title ? ` title="${title}"` : ''}><b>${num}</b>${label}</span>`;
    return `<div class="stat-chips" aria-label="Counts for this class">
      ${chip(n.all, 'learners', '', n.M || n.F ? `${n.M} male, ${n.F} female` : '')}
      ${hasLevel ? chip(n.Independent, 'Independent', 'i') + chip(n.Instructional, 'Instructional', 'n') + chip(n.Frustration, 'Frustration', 'f') : chip(n.entered, 'with entries')}
      ${hasFlags ? chip(n.struggling, 'struggling') + chip(n.nonReader, 'non-readers') : ''}
    </div>`;
  }

  // what a grade level or school summary will contain
  function summaryCard(f, lang) {
    const classes = syClasses();
    const groups = f.m.kind === 'grade'
      ? classes.filter(c => String(c.grade) === String(ui.grade)).map(c => ({ label: c.section || '(no section)', learners: c.learners }))
      : [...new Set(classes.map(c => String(c.grade)).filter(Boolean))].sort((a, b) => a - b).map(g => ({ label: 'Grade ' + g, learners: classes.filter(c => String(c.grade) === g).flatMap(c => c.learners) }));
    const count = (ls, test) => ls.filter(l => test(Data.result(state, l.id, ui.period, lang), l)).length;
    const rows = groups.map(g => `<tr><th scope="row">${esc(g.label)}</th>
      <td>${count(g.learners, (r, l) => l.sex === 'M')}</td><td>${count(g.learners, (r, l) => l.sex === 'F')}</td><td class="strong">${g.learners.length}</td>
      <td class="lv-i">${count(g.learners, r => r.level === 'Independent')}</td><td class="lv-n">${count(g.learners, r => r.level === 'Instructional')}</td><td class="lv-f">${count(g.learners, r => r.level === 'Frustration')}</td>
      <td>${count(g.learners, r => r.struggling)}</td><td>${count(g.learners, r => r.nonReader)}</td></tr>`).join('');
    return `<div class="card">
      <div class="card-head"><h2>${f.m.kind === 'grade' ? 'Sections in this grade' : 'Grade levels in the school'}</h2><p class="muted small">Counted from the class forms for ${esc(PERIOD_LABEL[ui.period])}, ${esc(lang)}. Other teachers’ classes: Settings › Add a colleague’s classes.</p></div>
      <div class="table-wrap"><table class="grid sum">
        <thead><tr><th rowspan="2">${f.m.kind === 'grade' ? 'Section' : 'Grade'}</th><th colspan="3">Enrolment</th><th colspan="3">Reading level</th><th rowspan="2">Struggling</th><th rowspan="2">Non-readers</th></tr>
        <tr><th>M</th><th>F</th><th>Total</th><th>Independent</th><th>Instructional</th><th>Frustration</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="9" class="empty">No class forms filled in yet${f.m.kind === 'grade' ? ' for this grade' : ''}.</td></tr>`}</tbody>
      </table></div>
    </div>`;
  }

  // ---------- typing straight on the form ----------
  async function renderFormView(f) {
    const box = $('#formview');
    if (!box) return;
    const data = await tplData(f.t.id);
    if (!data) { box.innerHTML = '<div class="notice bad">The form file is missing on this computer. Upload it again.</div>'; return; }
    const sheet = data.wb.sheets.find(s => s.path === f.m.sheetPath);
    const auto = {};
    try {
      const r = Data.buildWrites(f.m, sheet, state, Object.assign(fillContext(f), { learner: f.m.kind === 'learner' ? findLearner(ui.learnerId) : null }));
      for (const w of r.pages[0]) auto[w.ref] = w.value == null ? '' : String(w.value);
    } catch (e) { /* the form still opens without automatic values */ }
    const edits = formEdits(f, false);
    const values = Object.assign({}, auto, edits);
    const marks = {};
    const locked = new Set(), toggles = new Set();
    formMap = f.m.kind === 'class' ? learnerCells(f) : {};
    for (const ref in formMap) {
      const k = colKind(formMap[ref].c);
      if (['no', 'x-cond', 'x-formula', 'auto'].includes(k) || (k === 'x-total' && (formMap[ref].c.sumOf || []).length)) locked.add(ref);
      else if (['lvlmark', 'sexmark', 'flag', 'x-check'].includes(k)) toggles.add(ref);
      if (!formMap[ref].lid && k !== 'name' && k !== 'no') locked.add(ref);
      if (formMap[ref].lid && !(ref in values)) values[ref] = '';
    }
    for (const ref in edits) marks[ref] = 'mk-typed';
    for (const ref in auto) if (!(ref in edits) && auto[ref] !== '') marks[ref] = 'mk-fill';
    const out = XL.renderPages(sheet, XL.effectivePage(sheet, pageSetup(f)), { editable: true, values, marks, locked, toggles });
    box.innerHTML = pagesNote(out.count) + out.html;
    box.dataset.key = f.key;
    fitZoom(box);
    const over = f.m.kind === 'class' ? f.m.lists.some(l => learnerParts(f, l).some(p => p.learners.length > p.cap)) : false;
    if (over) box.insertAdjacentHTML('afterbegin', '<div class="notice">There are more learners than rows on this form. The extra learners are saved as another page (a second file) when you save.</div>');
    if (focusAfter) {
      const el = $(`#formview td[data-ref="${focusAfter}"] [contenteditable], #formview td[data-ref="${focusAfter}"] .xl-toggle`);
      focusAfter = null;
      if (el) { el.focus(); placeCaretEnd(el); }
    }
  }
  let formMap = {}, focusAfter = null;
  function placeCaretEnd(el) {
    if (!el.isContentEditable) return;
    try { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch (e) { /* ignore */ }
  }
  // learners of each part of a learner table, in the order the saved file uses
  function learnerParts(f, list) {
    const cls = currentClass(true);
    const all = Data.sortLearners(cls.learners);
    const hasSex = list.parts.some(p => p.sex);
    return list.parts.map((p, pi) => {
      let learners = hasSex ? all.filter(l => l.sex === p.sex) : [...all.filter(l => l.sex === 'M'), ...all.filter(l => l.sex !== 'M')];
      if (!hasSex && list.parts.length > 1) {
        const before = list.parts.slice(0, pi).reduce((a, q) => a + q.last - q.first + 1, 0);
        learners = learners.slice(before);
      }
      return { part: p, learners, cap: p.last - p.first + 1 };
    });
  }
  function learnerCells(f) {
    const map = {};
    f.m.lists.forEach((list, li) => {
      const cols = list.columns.slice().sort((a, b) => a.col - b.col);
      for (const pp of learnerParts(f, list)) {
        for (let i = 0; i <= pp.part.last - pp.part.first; i++) {
          const l = pp.learners[i];
          cols.forEach((c, ci) => { map[XL.makeRef(pp.part.first + i, c.col)] = { li, ci, c, lid: l ? l.id : null, sex: pp.part.sex || '' }; });
        }
      }
    });
    return map;
  }

  // the "header" values of a form: school, teacher, grade & section, date...
  const DETAIL_FIELDS = {
    'school.name': ['School', 'school', 'name'], 'school.id': ['School ID', 'school', 'id'],
    'school.idName': null, 'school.district': ['District', 'school', 'district'], 'school.division': ['Division', 'school', 'division'],
    'school.region': ['Region', 'school', 'region'], 'school.head': ['School head', 'school', 'head'],
    'school.chair': ['Grade level chairperson', 'school', 'chair'], 'school.coordinator': ['Reading coordinator', 'school', 'coordinator'],
    'class.adviser': ['Teacher / assessor', 'class', 'adviser'], 'class.designation': ['Designation', 'class', 'designation'],
    'class.section': ['Section', 'class', 'section'], 'class.grade': ['Grade', 'class', 'grade'], 'date': ['Date of assessment', 'date', ''],
  };
  function detailsPanel(f) {
    const keys = new Set();
    for (const fl of f.m.fields) {
      if (fl.key === 'school.idName') { keys.add('school.id'); keys.add('school.name'); }
      else if (fl.key === 'class.gradeSection') { keys.add('class.grade'); keys.add('class.section'); }
      else if (DETAIL_FIELDS[fl.key]) keys.add(fl.key);
    }
    const kind = f.m.kind;
    if (kind === 'grade' || kind === 'school') { keys.delete('class.section'); keys.delete('class.adviser'); keys.delete('class.designation'); keys.delete('class.grade'); }
    if (!keys.size) return '';
    const cls = currentClass(false) || {};
    const order = Object.keys(DETAIL_FIELDS);
    const inputs = [...keys].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(k => {
      const [label, where, prop] = DETAIL_FIELDS[k];
      let val = where === 'school' ? state.school[prop] : where === 'class' ? cls[prop] : ((state.dates || {})[`${cls.id}:${ui.period}`] || '');
      const id = 'd-' + k.replace('.', '-');
      if (k === 'class.grade') return `<label class="field"><span>${label}</span><select id="${id}" data-detail="${k}">${options([['', '–']].concat(GRADES.map(g => [g, 'Grade ' + g])), val)}</select></label>`;
      return `<label class="field"><span>${label}</span><input type="text" id="${id}" data-detail="${k}" value="${esc(val)}"${k === 'date' ? ` placeholder="${esc(todayText())}"` : ''}></label>`;
    }).join('');
    // folded into one line; open while something is still empty
    const filled = [...keys].map(k => {
      const [label, where, prop] = DETAIL_FIELDS[k];
      const v = where === 'school' ? state.school[prop] : where === 'class' ? cls[prop] : ((state.dates || {})[`${cls.id}:${ui.period}`] || '');
      return { label, v: k === 'class.grade' && v ? 'Grade ' + v : v };
    });
    const missing = filled.filter(x => !x.v).length;
    const summary = filled.filter(x => x.v).map(x => `<span><i>${esc(x.label)}</i> ${esc(x.v)}</span>`).join('');
    return `<details class="card details"${missing ? ' open' : ''}>
      <summary><h2>Form details</h2><span class="details-line">${summary || '<span class="muted">Not filled in yet</span>'}</span>${missing ? `<span class="chip warn">${missing} to fill in</span>` : '<span class="chip ok">Complete</span>'}</summary>
      <div class="grid2">${inputs}</div>
      <p class="muted small">These fill the top of the form. School details are remembered for all your forms.</p>
    </details>`;
  }

  // ---------- the entry table ----------
  const EDITABLE_X = ['number', 'text', 'check'];
  function colKind(c) {
    if (c.key === 'row.no') return 'no';
    if (c.key === 'learner.name') return 'name';
    if (c.key === 'learner.lrn') return 'lrn';
    if (c.key === 'learner.sex') return c.choice ? 'sexmark' : 'sex';
    if (c.key === 'a.level') return c.choice ? 'lvlmark' : 'lvl';
    if (c.key === 'a.indepGrade') return 'grade';
    if (c.key === 'a.struggling' || c.key === 'a.nonReader') return 'flag';
    if (c.key === 'a.remarks') return 'remarks';
    if (c.key && c.key.startsWith('x:')) return 'x-' + (c.input || 'text');
    if (['a.gst', 'a.miscues', 'a.words', 'a.time', 'a.compCorrect'].includes(c.key)) return 'num';
    return 'auto';
  }
  const RES_FIELD = { 'a.gst': 'gst', 'a.miscues': 'miscues', 'a.words': 'words', 'a.time': 'time', 'a.compCorrect': 'compCorrect' };

  function headRows(columns) {
    const deep = columns.some(c => (c.chain || []).length > 1);
    if (!deep) return `<tr>${columns.map(c => `<th>${esc((c.chain || [c.label]).join(' '))}</th>`).join('')}<th></th></tr>`;
    let r1 = '', r2 = '';
    for (let i = 0; i < columns.length; i++) {
      const c = columns[i], ch = c.chain || [c.label || ''];
      if (ch.length < 2) { r1 += `<th rowspan="2">${esc(ch.join(' '))}</th>`; continue; }
      let j = i;
      while (j + 1 < columns.length && (columns[j + 1].chain || [])[0] === ch[0] && (columns[j + 1].chain || []).length > 1) j++;
      r1 += `<th colspan="${j - i + 1}" class="grp">${esc(ch[0])}</th>`;
      for (let k = i; k <= j; k++) {
        const cc = columns[k].chain;
        const sub = cc.slice(1).filter(t => t !== ch[0]);
        r2 += `<th>${esc(sub[sub.length - 1] || '')}</th>`;
      }
      i = j;
    }
    return `<tr>${r1}<th rowspan="2"></th></tr><tr>${r2}</tr>`;
  }

  function cellHtml(c, ci, li, l, res, rowCols, n) {
    const k = colKind(c);
    const id = `g-${li}-${ci}-${l.id}`;
    const at = `id="${id}" data-li="${li}" data-ci="${ci}"`;
    const x = res.x || {};
    switch (k) {
      case 'no': return `<td class="idx">${n}</td>`;
      case 'name': return `<td class="namecell"><input type="text" ${at} value="${esc(Data.fullName(l, state.settings))}" aria-label="Name"></td>`;
      case 'lrn': return `<td><input type="text" ${at} value="${esc(l.lrn)}" inputmode="numeric" aria-label="LRN"></td>`;
      case 'sex': return `<td><select ${at} aria-label="Sex">${options([['', '–'], ['M', 'M'], ['F', 'F']], l.sex)}</select></td>`;
      case 'sexmark': return `<td class="center"><button type="button" class="mark" ${at} aria-pressed="${l.sex === c.choice}" aria-label="${c.choice}">${l.sex === c.choice ? '●' : ''}</button></td>`;
      case 'lvlmark': { const on = (res.level || '') === c.choice; return `<td class="center"><button type="button" class="mark lvl-${c.choice}" ${at} aria-pressed="${on}" aria-label="${c.choice}">${on ? '●' : ''}</button></td>`; }
      case 'lvl': return `<td><select ${at} aria-label="Reading level">${options([['', '–']].concat(LEVELS.map(x2 => [x2, x2])), res.level || '')}</select></td>`;
      case 'grade': return `<td><select ${at} aria-label="Grade level">${options([['', '–']].concat(GRADES.map(g => [g, 'Grade ' + g])), res.indepGrade || '')}</select></td>`;
      case 'flag': return `<td class="center"><input type="checkbox" ${at} ${res[c.key === 'a.struggling' ? 'struggling' : 'nonReader'] ? 'checked' : ''}></td>`;
      case 'remarks': return `<td><input type="text" ${at} value="${esc(res.remarks)}"></td>`;
      case 'num': return `<td class="numcell"><input type="number" ${at} value="${esc(res[RES_FIELD[c.key]])}"></td>`;
      case 'x-number': return `<td class="numcell"><input type="number" ${at} value="${esc(x[c.key])}"></td>`;
      case 'x-text': return `<td><input type="text" ${at} value="${esc(x[c.key])}"></td>`;
      case 'x-check': return `<td class="center"><input type="checkbox" ${at} ${x[c.key] ? 'checked' : ''}></td>`;
      case 'x-total': {
        if (!(c.sumOf || []).length) return `<td class="numcell"><input type="number" ${at} value="${esc(x[c.key])}"></td>`;
        const v = Data.extraValue(c, res);
        return `<td class="auto num" data-auto="${ci}">${v ?? ''}</td>`;
      }
      case 'x-cond': { const rc = rowCols[ci]; const v = Data.extraValue(rc, res); return `<td class="auto center" data-auto="${ci}">${v ? '✓' : ''}</td>`; }
      default: return `<td class="auto muted center" title="Worked out by the form itself">auto</td>`;
    }
  }

  function foundBanner(f) {
    const cls = currentClass(true);
    if (cls.learners.length) return '';
    return f.m.lists.map((list, li) => {
      const found = (list.found || []).length;
      return found ? `<div class="banner"><span><b>This file already has ${found} learner${found === 1 ? '' : 's'} filled in.</b> Bring them into the app with their entries so you can keep working on them.</span><button class="btn primary small" type="button" data-act="import-found" data-li="${li}">Bring them in</button></div>` : '';
    }).join('');
  }

  function fillClass(f, lang, bare) {
    const cls = currentClass(true);
    let html = bare ? '' : detailsPanel(f) + foundBanner(f);
    f.m.lists.forEach((list, li) => {
      const cols = list.columns.slice().sort((a, b) => a.col - b.col);
      const hasSexParts = list.parts.some(p => p.sex);
      const all = Data.sortLearners(cls.learners);
      const parts = hasSexParts ? list.parts.map(p => ({ p, learners: all.filter(l => l.sex === p.sex) })) : [{ p: list.parts[0], learners: [...all.filter(l => l.sex === 'M'), ...all.filter(l => l.sex !== 'M')] }];
      const cap = p => list.parts.filter(pp => !hasSexParts || pp.sex === p.sex).reduce((a, pp) => a + pp.last - pp.first + 1, 0);
      let rows = '';
      for (const { p, learners } of parts) {
        if (hasSexParts) rows += `<tr class="sep"><td colspan="${cols.length + 1}">${p.sex === 'M' ? 'Male' : 'Female'} <span class="muted">· ${learners.length} of ${cap(p)} rows</span></td></tr>`;
        learners.forEach((l, i) => {
          const res = Data.result(state, l.id, ui.period, lang);
          const rowCols = Data.withTotals(cols, res);
          rows += `<tr data-lid="${l.id}">${cols.map((c, ci) => cellHtml(c, ci, li, l, res, rowCols, i + 1)).join('')}<td class="rm"><button class="btn quiet small danger" type="button" data-act="rm-learner" title="Remove this learner">✕</button></td></tr>`;
        });
        rows += `<tr class="addrow"><td colspan="${cols.length + 1}"><input type="text" class="add-name" id="add-${li}-${p.sex || 'all'}" data-li="${li}" data-sex="${p.sex || ''}" placeholder="+ Type a learner’s name here and press Enter (or paste a list from Excel)"></td></tr>`;
      }
      html += `<div class="card flush">
        <div class="card-head"><h2>Learners</h2><p class="muted small">Enter goes down a column · paste names or scores copied from Excel into any cell · grey cells fill themselves</p></div>
        <div class="table-wrap"><table class="grid entry" data-li="${li}"><thead>${headRows(cols)}</thead><tbody>${rows}</tbody></table></div>
      </div>`;
    });
    return html;
  }

  // write one grid cell into the data
  function setGridValue(l, c, value, lang) {
    const k = colKind(c);
    const cls = currentClass(false);
    if (k === 'name') {
      if (!String(value).trim()) return;
      const p = Data.parseName(value);
      Object.assign(l, { last: p.last, first: p.first, middle: p.middle, ext: p.ext });
    } else if (k === 'lrn') l.lrn = String(value).trim();
    else if (k === 'sex') l.sex = /^f/i.test(value) ? 'F' : /^m/i.test(value) ? 'M' : '';
    else if (k === 'sexmark') l.sex = value ? c.choice : (l.sex === c.choice ? '' : l.sex);
    else if (k === 'lvlmark') Data.setResult(state, l.id, ui.period, lang, { level: value ? c.choice : '' });
    else if (k === 'lvl') { const m = LEVELS.find(x => x.toLowerCase().startsWith(String(value).toLowerCase().slice(0, 4))); Data.setResult(state, l.id, ui.period, lang, { level: m || '' }); }
    else if (k === 'grade') { const m = /(\d+)/.exec(value); Data.setResult(state, l.id, ui.period, lang, { indepGrade: m ? m[1] : '' }); }
    else if (k === 'flag') Data.setResult(state, l.id, ui.period, lang, { [c.key === 'a.struggling' ? 'struggling' : 'nonReader']: !!value });
    else if (k === 'remarks') Data.setResult(state, l.id, ui.period, lang, { remarks: value });
    else if (k === 'num') Data.setResult(state, l.id, ui.period, lang, { [RES_FIELD[c.key]]: value });
    else if (k === 'x-number' || (k === 'x-total' && !(c.sumOf || []).length)) Data.setExtra(state, l.id, ui.period, lang, c.key, value === '' ? '' : +value);
    else if (k === 'x-text') Data.setExtra(state, l.id, ui.period, lang, c.key, value);
    else if (k === 'x-check') Data.setExtra(state, l.id, ui.period, lang, c.key, !!value);
    if (cls) save();
  }
  const truthyText = v => v === true || (typeof v === 'string' && v.trim() !== '' && !/^(x|0|no|false|-)$/i.test(v.trim()));

  // refresh totals / ticks of one row without re-drawing the table
  function refreshRow(tr, f, li) {
    const l = findLearner(tr.dataset.lid);
    if (!l) return;
    const cols = f.m.lists[li].columns.slice().sort((a, b) => a.col - b.col);
    const res = Data.result(state, l.id, ui.period, formLang(f));
    const rowCols = Data.withTotals(cols, res);
    for (const td of tr.querySelectorAll('td[data-auto]')) {
      const c = rowCols[+td.dataset.auto];
      const v = Data.extraValue(c, res);
      td.textContent = c.input === 'cond' ? (v ? '✓' : '') : (v ?? '');
    }
  }
  function findLearner(id) {
    for (const c of state.classes) { const l = c.learners.find(x => x.id === id); if (l) return l; }
    return null;
  }

  function addLearners(names, sex) {
    const cls = currentClass(true);
    const added = [];
    for (const n of names) {
      if (!n.trim()) continue;
      const l = Data.parseName(n);
      l.sex = sex || '';
      cls.learners.push(l);
      added.push(l);
    }
    save();
    return added;
  }

  // paste a block copied from Excel into the entry table
  function pasteBlock(target, text) {
    const f = currentForm();
    const lang = formLang(f);
    const li = +target.dataset.li;
    const cols = f.m.lists[li].columns.slice().sort((a, b) => a.col - b.col);
    const lines = text.replace(/\r/g, '').split('\n').filter((x, i, arr) => x !== '' || i < arr.length - 1).map(x => x.split('\t'));
    if (target.classList.contains('add-name')) {
      const nameCi = cols.findIndex(c => c.key === 'learner.name');
      const added = addLearners(lines.map(r => r[0]), target.dataset.sex);
      added.forEach((l, i) => lines[i].slice(1).forEach((v, j) => { const c = cols[nameCi + 1 + j]; if (c) setGridValue(l, c, v, lang); }));
      toast(`Added ${added.length} learner${added.length === 1 ? '' : 's'}.`);
      render();
      return;
    }
    const tr = target.closest('tr');
    const rowsEls = $$('tr[data-lid]', tr.closest('tbody'));
    const start = rowsEls.indexOf(tr);
    const ci0 = +target.dataset.ci;
    let n = 0;
    lines.forEach((vals, i) => {
      const rowEl = rowsEls[start + i];
      if (!rowEl) return;
      const l = findLearner(rowEl.dataset.lid);
      vals.forEach((v, j) => {
        const c = cols[ci0 + j];
        if (!c) return;
        const k = colKind(c);
        if (['x-check', 'flag', 'lvlmark', 'sexmark'].includes(k)) setGridValue(l, c, truthyText(v), lang);
        else setGridValue(l, c, v.trim(), lang);
        n++;
      });
    });
    toast(`Pasted ${n} cell${n === 1 ? '' : 's'}.`);
    render();
  }

  // ---------- building the filled file ----------
  function fillContext(f) {
    return {
      kind: f.m.kind, classId: ui.classId, grade: ui.grade, period: ui.period, lang: formLang(f),
      date: (state.dates || {})[`${ui.classId}:${ui.period}`] || (f.m.fields.some(x => x.key === 'date' && x.current) ? '' : todayText()),
    };
  }
  async function buildFiles(all) {
    const f = currentForm();
    if (!f) return null;
    const ctx = fillContext(f);
    const data = await tplData(f.t.id);
    if (!data) throw new Error('The form file is missing on this computer. Upload it again under My forms.');
    const sheet = data.wb.sheets.find(s => s.path === f.m.sheetPath);
    const kind = f.m.kind;
    const page = XL.effectivePage(sheet, pageSetup(f));
    const opts = { onlySheet: f.m.sheetPath, pageSheet: f.m.sheetPath, page, type: 'uint8array' };
    const files = [], warnings = [];
    const cls = state.classes.find(c => c.id === ctx.classId);
    const who = kind === 'grade' ? 'Grade ' + ctx.grade : kind === 'school' ? state.sy : className(cls);
    const base = [f.m.sheetName, who, ctx.period].join(' - ');
    if (kind === 'learner') {
      const learners = Data.sortLearners(cls ? cls.learners : []).filter(l => all || l.id === ui.learnerId);
      for (const l of learners) {
        const r = Data.buildWrites(f.m, sheet, state, Object.assign({}, ctx, { learner: l }));
        const typed = Object.entries(formEdits(f, false, l.id)).map(([ref, v]) => ({ ref, value: /^-?\d+(\.\d+)?$/.test(v.trim()) ? +v : v }));
        const writes = r.pages[0].concat(typed).filter(w => { const c = sheet.cells.get(w.ref); return !(c && c.formula); });
        const out = await XL.fillWorkbook(data.buf.slice(0), { [f.m.sheetPath]: writes }, opts);
        files.push({ name: `${f.m.sheetName} - ${Data.fullName(l, state.settings)} - ${ctx.period}.xlsx`, data: out.data, writes });
      }
      if (!learners.length) warnings.push('This class has no learners yet.');
    } else {
      const r = Data.buildWrites(f.m, sheet, state, ctx);
      if (kind !== 'none') warnings.push(...r.warnings);
      const typed = Object.entries(formEdits(f, false)).map(([ref, v]) => ({ ref, value: /^-?\d+(\.\d+)?$/.test(v.trim()) ? +v : v }));
      for (let i = 0; i < r.pages.length; i++) {
        const writes = r.pages[i].concat(typed).filter(w => { const c = sheet.cells.get(w.ref); return !(c && c.formula); });
        const out = await XL.fillWorkbook(data.buf.slice(0), { [f.m.sheetPath]: writes }, opts);
        files.push({ name: `${base}${r.pages.length > 1 ? ` (page ${i + 1})` : ''}.xlsx`, data: out.data, writes });
      }
    }
    const missing = kind === 'class' ? Data.missingResults(state, ctx, f.m) : [];
    return { f, ctx, files, warnings, missing };
  }

  // the page options used both on screen and in the saved file
  function pageSetup(f) {
    const kind = f.m.kind;
    // by default the saved file keeps the template's own print settings
    const fit = ui.page.fit == null || ui.page.fit === false ? 'none' : ui.page.fit === true ? 'width' : ui.page.fit;
    return { fit: fit === 'none' ? null : fit, orientation: ui.page.orient || (fit === 'auto' ? null : (kind === 'grade' || kind === 'school') ? 'landscape' : null), paper: ui.page.paper ? +ui.page.paper : null };
  }
  // shrink the pages so a whole page width fits the screen
  function fitZoom(box) {
    const pages = box.querySelector('.xl-pages') || box.querySelector('.paper');
    if (!pages) return;
    const page = pages.querySelector('.xl-page');
    const w = page ? page.offsetWidth : pages.scrollWidth;
    const avail = box.clientWidth - 24;
    const fit = w && avail > 0 ? Math.min(2.5, Math.max(0.3, avail / w)) : 1;
    const z = ui.fz == null || ui.fz === 'fit' ? fit : ui.fz;
    ui.zoomNow = z;
    pages.style.zoom = z.toFixed(3);
  }
  function applyZoomAll() { for (const id of ['formview', 'preview']) { const b = document.getElementById(id); if (b && !b.hidden) fitZoom(b); } }
  window.addEventListener('resize', () => { clearTimeout(applyZoomAll.t); applyZoomAll.t = setTimeout(applyZoomAll, 150); });
  function pagesNote(n) { return `<p class="pages-note">${n === 1 ? 'Prints on 1 page.' : `Prints on ${n} pages. The gaps show where each page ends.`}</p>`; }

  let previewSeq = 0;
  async function refreshPreview() {
    const seq = ++previewSeq;
    const box = $('#preview');
    if (!box || box.hidden) return;
    try {
      const res = await buildFiles();
      if (seq !== previewSeq || !res) return;
      const warn = [...res.warnings];
      if (res.missing.length) warn.unshift(`${res.missing.length} learner(s) have no reading level yet: ${res.missing.slice(0, 5).map(l => Data.fullName(l, state.settings)).join('; ')}${res.missing.length > 5 ? '…' : ''}`);
      $('#pr-warn').innerHTML = warn.length ? `<details class="warn-line"><summary>${warn.length} thing${warn.length === 1 ? '' : 's'} to check before printing</summary><ul>${warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : '';
      $('#save-note').textContent = res.files.length > 1 ? `${res.files.length} files will be saved${res.ctx.kind === 'learner' ? ' (in a .zip)' : ''}.` : '';
      if (!res.files.length) { box.innerHTML = '<div class="empty">Nothing to show yet.</div>'; return; }
      const wb = await XL.loadWorkbook(res.files[0].data.slice(0));
      if (seq !== previewSeq) return;
      const sheet = wb.sheets.find(s => s.path === res.f.m.sheetPath);
      XL.computeFormulas(sheet);
      const out = XL.renderPages(sheet, XL.effectivePage(sheet, pageSetup(res.f)));
      box.innerHTML = pagesNote(out.count) + out.html;
      fitZoom(box);
    } catch (e) {
      if (seq === previewSeq) box.innerHTML = `<div class="notice bad">${esc(e.message || e)}</div>`;
    }
  }

  // print the filled pages straight from the app
  async function printForm() {
    try {
      const res = await buildFiles(false);
      if (!res || !res.files.length) { toast('Nothing to print yet.'); return; }
      let html = '', size = null;
      for (const file of res.files) {
        const wb = await XL.loadWorkbook(file.data.slice(0));
        const sheet = wb.sheets.find(x => x.path === res.f.m.sheetPath);
        XL.computeFormulas(sheet);
        const out = XL.renderPages(sheet, XL.effectivePage(sheet, pageSetup(res.f)));
        html += out.html;
        size = size || out.layout;
      }
      let root = $('#print-root');
      if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
      root.innerHTML = `<style>@page { size: ${(size.pageW / 96).toFixed(2)}in ${(size.pageH / 96).toFixed(2)}in; margin: 0; }</style>${html}`;
      window.print();
    } catch (e) { toast(e.message || String(e)); }
  }

  /* Fill every form in the file and save it as one workbook, like the
   * template that was uploaded: class forms with the chosen class, grade
   * summaries with that class's grade, school summaries with all classes,
   * each sheet in its own language. */
  async function saveWholeFile(openAfter) {
    const btns = $$('[data-act="save-file"],[data-act="open-form"]');
    btns.forEach(b => { b.disabled = true; });
    try {
      const f = currentForm();
      if (!f) { toast('Upload a form first.'); return; }
      const t = f.t;
      const data = await tplData(t.id);
      if (!data) throw new Error('The form file is missing on this computer. Upload it again.');
      const cls = currentClass(false);
      const grade = (f.m.kind === 'grade' && ui.grade) || (cls && cls.grade) || ui.grade;
      const writesBySheet = {};
      const skipped = [];
      let extraPages = 0;
      for (const m of t.sheets) {
        if (m.notes || m.hidden) continue;
        if (m.kind === 'learner') { skipped.push(m.sheetName); continue; }
        const sheet = data.wb.sheets.find(s => s.path === m.sheetPath);
        if (!sheet) continue;
        const ctx = {
          kind: m.kind, classId: ui.classId, grade, period: ui.period, lang: m.language || ui.lang,
          date: (state.dates || {})[`${ui.classId}:${ui.period}`] || (m.fields.some(x => x.key === 'date' && x.current) ? '' : todayText()),
        };
        const r = Data.buildWrites(m, sheet, state, ctx);
        if (r.pages.length > 1) extraPages++;
        const writes = r.pages[0].filter(w => { const c = sheet.cells.get(w.ref); return !(c && c.formula); });
        if (writes.length) writesBySheet[m.sheetPath] = writes;
      }
      const out = await XL.fillWorkbook(data.buf.slice(0), writesBySheet, { type: 'uint8array' });
      const blob = new Blob([out.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      // same workbook name as the uploaded template (Windows asks before replacing a file)
      const name = /\.xls[xm]$/i.test(t.fileName) ? t.fileName.replace(/\.xlsm$/i, '.xlsx') : `${t.name}.xlsx`;
      const notes = [];
      if (skipped.length) notes.push(`${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} one-learner forms: save them from ${skipped.length === 1 ? 'its' : 'their'} own tab.`);
      if (extraPages) notes.push('Some forms have more learners than rows; the extra learners are not in this file. Use “Save only this form” on that tab to get the extra pages.');
      if (openAfter && window.desktop) {
        const path = await window.desktop.openInExcel(name.replace(/[–—]/g, '-'), new Uint8Array(await blob.arrayBuffer()));
        toast(path ? 'Opened in Excel. Press Ctrl+P there to print.' : 'Could not open the file.');
      } else {
        const r = await saveBlob(name, blob);
        if (r.status === 'saved') toast((r.path ? `Saved to ${r.path}. ` : 'Saved the whole file. ') + notes.join(' '));
      }
    } catch (e) {
      toast(e.message || String(e));
    } finally { btns.forEach(b => { b.disabled = false; }); }
  }

  async function saveForm(openAfter, all) {
    const btns = $$('[data-act="save-form"],[data-act="open-form"],[data-act="save-all"]');
    btns.forEach(b => { b.disabled = true; });
    try {
      const res = await buildFiles(all);
      if (!res || !res.files.length) { toast('Nothing to save yet.'); return; }
      let blob, name;
      if (res.files.length === 1) {
        blob = new Blob([res.files[0].data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        name = res.files[0].name;
      } else {
        const zip = new JSZip();
        for (const f of res.files) zip.file(f.name.replace(/[\\/:*?"<>|]+/g, ' '), f.data);
        blob = await zip.generateAsync({ type: 'blob' });
        name = res.files[0].name.replace(/( \(page 1\))?\.xlsx$/, '') + '.zip';
        if (res.ctx.kind === 'learner') name = `${res.f.m.sheetName} - ${className(state.classes.find(c => c.id === res.ctx.classId))} - ${res.ctx.period}.zip`;
      }
      if (openAfter && window.desktop) {
        const path = await window.desktop.openInExcel(name.replace(/[–—]/g, '-'), new Uint8Array(await blob.arrayBuffer()));
        toast(path ? 'Opened in Excel. Press Ctrl+P there to print.' : 'Could not open the file.');
        return;
      }
      const r = await saveBlob(name, blob);
      if (r.status === 'saved') toast(r.path ? `Saved to ${r.path}` : 'Saved. Open the file in Excel to print it.');
    } catch (e) {
      toast(e.message || String(e));
    } finally { btns.forEach(b => { b.disabled = false; }); }
  }

  // ================= uploading a form =================
  async function importTemplate(buf, fileName, name) {
    let wb;
    try { wb = await XL.loadWorkbook(buf.slice(0)); }
    catch (e) { toast(e.message || 'This file could not be read as an Excel workbook.'); return; }
    const id = Data.uid('t');
    const sheets = wb.sheets.map(s => Detect.detectSheet(s));
    // remember school details already written on the form
    for (const m of sheets) for (const fl of m.fields) {
      if (fl.mode !== 'after' || !fl.current || !fl.key.startsWith('school.')) continue;
      const prop = fl.key.split('.')[1];
      if (prop in state.school && !state.school[prop]) state.school[prop] = fl.current.trim();
    }
    state.templates.unshift({ id, name: name || fileName.replace(/\.xls[xm]?$/i, ''), fileName, addedAt: Date.now(), sheets });
    await Data.kvSet('tpl:' + id, buf);
    tplCache.set(id, { buf, wb });
    const forms = sheets.filter(usable);
    if (!forms.length) { save(); toast(`${fileName} has no sheets to fill in.`); render(); return; }
    let first = sheets.findIndex(s => s.kind === 'class' && usable(s));
    if (first < 0) first = sheets.indexOf(forms[0]);
    ui.form = id + ':' + first;
    ui.view = 'fill'; ui.tplId = null; ui.preview = true;
    const m = sheets[first >= 0 ? first : 0];
    if (m && m.language) ui.lang = m.language;
    // a period already ticked on the form (e.g. "√ Pre-Test")
    save();
    toast(`${fileName} is ready.${forms.length > 1 ? ` ${forms.length} forms, one tab each.` : ''} Start typing below.`);
    render();
    window.scrollTo(0, 0);
  }

  // ---------- adjust (field mapping) ----------
  const FIELD_KEYS = Object.keys(Detect.FIELD_LABELS).filter(k => !k.startsWith('a.') && k !== 'row.no');
  const COL_KEYS = ['row.no', 'learner.name', 'learner.lrn', 'learner.sex', 'a.level', 'a.indepGrade', 'a.struggling', 'a.nonReader', 'a.remarks'];
  const X_INPUTS = [['number', 'Number'], ['text', 'Text'], ['check', 'Tick box'], ['total', 'Total (adds up)'], ['formula', 'Leave to Excel']];
  const METRICS = [['enrolled', 'Enrolment'], ['level:Independent', 'Independent'], ['level:Instructional', 'Instructional'], ['level:Frustration', 'Frustration'], ['struggling', 'Struggling readers'], ['nonReader', 'Non-readers']]
    .concat(GRADES.map(g => ['indepAt:' + g, 'Independent at Grade ' + g]));
  const L = k => Detect.FIELD_LABELS[k] || (k && k.startsWith('x:') ? 'Own column' : k);
  const confClass = c => c >= 0.8 ? 'ok' : 'warn';

  async function renderMapper() {
    const t = state.templates.find(x => x.id === ui.tplId);
    if (!t) { ui.tplId = null; render(); return; }
    const data = await tplData(t.id);
    if (!data) { $('#view').innerHTML = '<div class="panel empty">The form file is missing on this computer. Remove it and upload it again.</div>'; return; }
    const m = t.sheets[ui.sheetIdx] || t.sheets[0];
    const sheet = data.wb.sheets.find(s => s.path === m.sheetPath);
    const marks = {}, titles = {};
    for (const f of m.fields) { marks[f.ref] = f.conf >= 0.8 ? 'mk-sure' : 'mk-check'; titles[f.ref] = L(f.key); }
    for (const l of m.lists) {
      for (let r = l.headerRows[0]; r <= l.headerRows[1]; r++) for (let c = l.cols[0]; c <= l.cols[1]; c++) marks[XL.makeRef(r, c)] = marks[XL.makeRef(r, c)] || 'mk-head';
      for (const col of l.columns) for (const p of l.parts) for (let r = p.first; r <= p.last; r++) {
        const ref = XL.makeRef(r, col.col);
        marks[ref] = 'mk-col';
        titles[ref] = `${col.key.startsWith('x:') ? col.chain.join(' ') : L(col.key)}${col.choice ? ' = ' + col.choice : ''}`;
      }
    }
    for (const s of m.summaries) for (let r = s.rows[0]; r <= s.rows[1]; r++) {
      marks[XL.makeRef(r, s.labelCol)] = 'mk-col';
      for (const col of s.columns) { const ref = XL.makeRef(r, col.col); if (!sheet.cells.get(ref)?.formula) marks[ref] = 'mk-col'; }
    }
    if (ui.sel) marks[ui.sel] = (marks[ui.sel] || '') + ' mk-sel';

    const sheetTabs = t.sheets.map((s, i) => `<option value="${i}"${i === ui.sheetIdx ? ' selected' : ''}>${esc(s.sheetName)} — ${KIND_LABEL[s.kind]}</option>`).join('');
    const fieldsHtml = m.fields.length ? m.fields.map(f => `
      <div class="map-item"><span class="dot ${confClass(f.conf)}"></span><span class="mono">${f.ref}</span>
        <select data-field="${f.id}" aria-label="What goes in ${f.ref}">${options(FIELD_KEYS.map(k => [k, L(k)]), f.key)}</select>
        <button class="x" type="button" data-act="del-field" data-id="${f.id}" title="Remove">✕</button></div>`).join('') : '<p class="muted">None found.</p>';
    const listsHtml = m.lists.map((l, li) => `
      <div class="panel stack">
        <h3>Learner table</h3>
        ${l.parts.map((p, pi) => `<div class="row" style="gap:6px"><span class="muted" style="width:44px">Rows</span>
          <input type="number" style="width:70px" data-part="${li}:${pi}:first" value="${p.first}"> –
          <input type="number" style="width:70px" data-part="${li}:${pi}:last" value="${p.last}">
          <select data-part="${li}:${pi}:sex">${options([['', 'All learners'], ['M', 'Male only'], ['F', 'Female only']], p.sex || '')}</select></div>`).join('')}
        <div class="map-list">${l.columns.map((col, ci) => `
          <div class="map-item"><span class="dot ${confClass(col.conf)}"></span><span class="mono">${XL.numToCol(col.col)}</span>
            ${col.key.startsWith('x:')
              ? `<select data-xinput="${li}:${ci}" title="${esc(col.chain.join(' '))}">${options(X_INPUTS.concat(col.input === 'cond' ? [['cond', 'Tick from total']] : []), col.input)}</select>`
              : `<select data-lcol="${li}:${ci}">${options(COL_KEYS.map(k => [k, L(k)]), col.key)}</select>`}
            <button class="x" type="button" data-act="del-lcol" data-li="${li}" data-ci="${ci}" title="Ignore this column">✕</button></div>
          ${col.key.startsWith('x:') ? `<div class="muted small" style="padding:0 4px 4px 64px">${esc(col.chain.join(' › '))}</div>` : ''}
          ${col.choice || col.flag || col.input === 'check' || col.input === 'cond' ? `<div class="row small" style="gap:6px;padding:0 4px 6px 64px">${col.choice ? esc('when ' + col.choice) + ' ·' : ''} <span class="muted">write</span><input type="text" style="width:44px" data-lmark="${li}:${ci}" value="${esc(col.mark ?? '√')}"></div>` : ''}`).join('')}
          ${(l.unknownColumns || []).map(u => `<div class="map-item"><span class="dot bad"></span><span class="mono">${XL.numToCol(u.col)}</span><span class="muted">Ignored</span><button class="btn small quiet" type="button" data-act="add-lcol" data-li="${li}" data-col="${u.col}">Use</button></div>`).join('')}
        </div>
      </div>`).join('');
    const sumHtml = m.summaries.map((s, si) => `
      <div class="panel stack"><h3>Count table · one row per ${s.groupBy === 'section' ? 'section' : 'grade level'}</h3>
        <div class="row" style="gap:6px"><span class="muted">Rows</span>
          <input type="number" style="width:70px" data-srow="${si}:0" value="${s.rows[0]}"> – <input type="number" style="width:70px" data-srow="${si}:1" value="${s.rows[1]}">
          <select data-sgroup="${si}">${options([['section', 'Sections of one grade'], ['grade', 'Grade levels']], s.groupBy)}</select></div>
        <details><summary>${s.columns.length} count columns</summary><div class="map-list">${s.columns.map((col, ci) => `
          <div class="map-item"><span class="dot ok"></span><span class="mono">${XL.numToCol(col.col)}</span><select data-scol="${si}:${ci}">${options(METRICS, col.metric)}</select><span class="chip">${col.sex}</span></div>`).join('')}</div></details>
      </div>`).join('');
    const selCell = ui.sel ? (() => {
      const p = XL.parseRef(ui.sel);
      const txt = XL.cellText(sheet, p.r, p.c);
      const blanks = (txt.match(/_{3,}/g) || []).length;
      return `<div class="panel stack"><h3>Cell ${ui.sel}</h3>
        <p>${txt ? `“${esc(txt.length > 120 ? txt.slice(0, 120) + '…' : txt)}”` : '<span class="muted">Empty cell</span>'}</p>
        <label class="field"><span>Put this here</span><select id="sel-key">${options(FIELD_KEYS.map(k => [k, L(k)]))}</select></label>
        <label class="field"><span>How</span><select id="sel-mode">${options([
          ['value', txt ? 'Replace the whole cell' : 'Write into the cell'],
          ...(/:/.test(txt) ? [['after', 'Write after the “:”']] : []),
          ...Array.from({ length: blanks }, (_, i) => ['blank:' + i, `Fill blank ${i + 1} (____)`]),
          ...(txt ? [['find', 'Replace one word or number']] : []),
        ], blanks ? 'blank:0' : /:/.test(txt) ? 'after' : 'value')}</select></label>
        <label class="field" id="find-wrap" hidden><span>Word to replace</span><input type="text" id="sel-find" placeholder="e.g. 2025-2026"></label>
        <div class="row"><button class="btn primary small" type="button" data-act="add-field">Add</button><button class="btn small quiet" type="button" data-act="clear-sel">Cancel</button></div></div>`;
    })() : '<div class="panel muted small">Click a cell on the form to say what goes there.</div>';

    $('#view').innerHTML = `
      <div class="head">
        <div><button class="btn quiet small" type="button" data-act="close-tpl">‹ Back</button><h1>Adjust: ${esc(m.sheetName)}</h1></div>
        <div class="row">
          <select id="sheet-pick" aria-label="Sheet">${sheetTabs}</select>
          <select id="kind-pick" aria-label="Form type">${options(Object.entries(KIND_LABEL), m.kind)}</select>
          <select id="lang-pick" aria-label="Language">${options([['', 'Language: choose when filling'], ['Filipino', 'Filipino'], ['English', 'English']], m.language || '')}</select>
          <button class="btn small" type="button" data-act="redetect">Read again</button>
          <button class="btn small primary" type="button" data-act="fill-sheet" data-tpl="${t.id}" data-i="${ui.sheetIdx}">Done, fill in</button>
        </div>
      </div>
      <div class="legend">
        <span><i class="sw" style="background:rgba(45,122,76,.45)"></i>Found</span>
        <span><i class="sw" style="background:rgba(214,150,30,.55)"></i>Not sure</span>
        <span><i class="sw" style="background:rgba(45,122,76,.14)"></i>Learner rows</span>
        <span>Hover a cell to see what goes there.</span>
      </div>
      <div class="mapper">
        <div class="sheet-view" id="sheet-view"><div class="paper" style="zoom:${ui.zoom}">${XL.renderSheet(sheet, { marks, titles })}</div></div>
        <div class="side">${selCell}
          <div class="panel stack"><h3>Top of the form</h3><div class="map-list">${fieldsHtml}</div></div>
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

  // ================= Reading passages =================
  // Kept here so the phone app can be given the exact text the learner reads.
  const SETS = ['A', 'B', 'C', 'D'];
  const QTYPES = ['Literal', 'Inferential', 'Critical'];
  const PTYPE_LABEL = { oral: 'Oral reading', gst: 'Group Screening Test (GST)' };
  const passageList = () => (state.passages = state.passages || []);
  const byGradeSet = (a, b) => (+a.grade || 99) - (+b.grade || 99) || String(a.set).localeCompare(String(b.set)) || a.title.localeCompare(b.title);
  function passageCount(text) {
    const w = Data.passageWords(text).length, s = Data.passageSentences(text);
    return `<b>${w}</b> word${w === 1 ? '' : 's'} · ${s} sentence${s === 1 ? '' : 's'}`;
  }
  function viewPassages() {
    const list = passageList();
    if (ui.pImport) return importPanel(ui.pImport);
    if (ui.passageId) {
      const p = list.find(x => x.id === ui.passageId);
      if (p) return passageEditor(p);
      ui.passageId = null;
    }
    const lang = ui.pLang || 'English';
    const count = l => list.filter(p => p.language === l).length;
    const shown = list.filter(p => p.language === lang && (!ui.pGrade || p.grade === ui.pGrade)).sort(byGradeSet);
    const card = p => {
      const w = Data.passageWords(p.text).length, q = (p.questions || []).length;
      return `<button type="button" class="passage-card" data-act="open-passage" data-id="${p.id}">
        <span class="pc-tags"><span class="pc-grade">${p.grade ? 'Grade ' + esc(p.grade) : 'No grade'}</span>${p.set ? `<span class="pc-set">Set ${esc(p.set)}</span>` : ''}<span class="pc-type">${p.type === 'gst' ? 'GST' : 'Oral'}</span></span>
        <b>${esc(p.title || 'Untitled passage')}</b>
        <span class="pc-text" lang="${p.language === 'Filipino' ? 'fil' : 'en'}">${esc(p.text.slice(0, 180)) || '<i>No text yet</i>'}</span>
        <span class="pc-meta">${w} words · ${q} question${q === 1 ? '' : 's'}</span>
      </button>`;
    };
    return `
      <div class="head"><div><h1>Reading passages</h1>
        <p>Type or paste the Phil-IRI passages and their questions here, in Filipino and English. They are sent to the phone app, so it knows exactly what the learner is reading.</p></div></div>
      <div class="controls">
        <div class="pill-field"><span>Language</span>${seg('plang', ['Filipino', 'English'], lang, { Filipino: `Filipino (${count('Filipino')})`, English: `English (${count('English')})` })}</div>
        <label class="pill-field"><span>Grade</span><select id="p-grade-filter">${options([['', 'All grades']].concat(GRADES.map(g => [g, 'Grade ' + g])), ui.pGrade || '')}</select></label>
        <span class="controls-grow"></span>
        <details class="fb-more">
          <summary class="btn">Phone app<span class="caret" aria-hidden="true"></span></summary>
          <div class="fb-menu stack">
            <button class="btn" type="button" data-act="export-passages">Save passages file for the phone</button>
            <span class="btn file-btn">Bring in a passages file…<input type="file" id="passages-file" accept=".json,application/json"></span>
            <p class="muted small">The file holds every passage in both languages, its words and its questions. Copy it to the phone app. A passages file from a colleague can be brought in here too.</p>
          </div>
        </details>
        <span class="btn file-btn">Bring in from PDF or Word…<input type="file" class="passage-doc" accept="${DOC_ACCEPT}"></span>
        <button class="btn primary" type="button" data-act="add-passage">+ Add passage</button>
      </div>
      ${shown.length ? `<div class="passage-grid">${shown.map(card).join('')}</div>` : `
        <div class="card empty-card">
          <b>No ${esc(lang)} passages${ui.pGrade ? ' for Grade ' + esc(ui.pGrade) : ''} yet</b>
          <span class="muted">Add the passages from the Phil-IRI booklet: Sets A to D for each grade, with the comprehension questions. Type or paste the text, or bring it in from a PDF or Word file. Pictures are not accepted.</span>
          <div class="row" style="justify-content:center">
            <span class="btn file-btn">Bring in from PDF or Word…<input type="file" class="passage-doc" accept="${DOC_ACCEPT}"></span>
            <button class="btn primary" type="button" data-act="add-passage">+ Add ${esc(lang)} passage</button></div>
        </div>`}`;
  }
  function passageEditor(p) {
    const langAttr = p.language === 'Filipino' ? 'fil' : 'en';
    const q = (x, i) => {
      const hasChoices = (x.choices || []).some(c => c.trim());
      return `<li class="q-item" data-qi="${i}">
        <div class="q-top">
          <span class="q-num">${i + 1}</span>
          <select data-qf="${i}:type" aria-label="Question type">${options(QTYPES, x.type)}</select>
          <span class="controls-grow"></span>
          <button class="btn small quiet" type="button" data-act="move-question" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button class="btn small quiet" type="button" data-act="move-question" data-i="${i}" data-d="1" ${i === p.questions.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
          <button class="btn small quiet danger" type="button" data-act="del-question" data-i="${i}">Remove</button>
        </div>
        <textarea rows="2" data-qf="${i}:text" lang="${langAttr}" placeholder="Question ${i + 1}">${esc(x.text)}</textarea>
        <details class="q-choices"${hasChoices || p.type === 'gst' ? ' open' : ''}>
          <summary>Answer choices <span class="muted small">· tick the correct one</span></summary>
          <div class="choice-grid">${[0, 1, 2, 3].map(c => `
            <label class="choice"><input type="radio" name="ans-${x.id}" data-qf="${i}:answer" value="${c}" ${x.answer === c ? 'checked' : ''} aria-label="Correct answer ${'abcd'[c]}">
              <span>${'abcd'[c]}.</span><input type="text" data-qf="${i}:c${c}" lang="${langAttr}" value="${esc((x.choices || [])[c] || '')}"></label>`).join('')}
          </div>
        </details>
        <label class="field"><span>Expected answer (for questions answered aloud, optional)</span><input type="text" data-qf="${i}:expected" lang="${langAttr}" value="${esc(x.expected)}"></label>
      </li>`;
    };
    return `
      <div class="head"><div>
        <button class="btn quiet small back" type="button" data-act="close-passage">‹ All passages</button>
        <h1 id="p-heading">${esc(p.title || 'New passage')}</h1></div>
        <div class="row">
          <button class="btn danger" type="button" data-act="del-passage">Delete passage</button>
          <button class="btn primary" type="button" data-act="close-passage">Done</button>
        </div>
      </div>
      <div class="passage-edit">
        <div class="card">
          <div class="grid2 p-fields">
            <label class="field"><span>Title</span><input type="text" data-pf="title" lang="${langAttr}" value="${esc(p.title)}" placeholder="e.g. Ang Batang Masipag"></label>
            <label class="field"><span>Language</span><select data-pf="language">${options(['Filipino', 'English'], p.language)}</select></label>
            <label class="field"><span>Grade level</span><select data-pf="grade">${options([['', '–']].concat(GRADES.map(g => [g, 'Grade ' + g])), p.grade)}</select></label>
            <label class="field"><span>Set</span><select data-pf="set">${options(SETS.map(s => [s, 'Set ' + s]).concat(p.set && !SETS.includes(p.set) ? [[p.set, p.set]] : []), p.set)}</select></label>
            <label class="field"><span>Used for</span><select data-pf="type">${options(Object.entries(PTYPE_LABEL), p.type)}</select></label>
          </div>
          <div class="p-text-head">
            <span class="p-text-label">Passage text</span>
            <span class="controls-grow"></span>
            <button class="btn small quiet" type="button" data-act="tidy-passage" title="Joins lines that were cut by the page, keeps paragraphs">Fix line breaks</button>
            <span class="btn small file-btn">Bring in from PDF or Word…<input type="file" class="passage-doc" accept="${DOC_ACCEPT}"></span>
          </div>
          <label class="field"><span class="visually-hidden">Passage text</span>
            <textarea class="passage-text" data-pf="text" rows="12" lang="${langAttr}" placeholder="Type or paste the passage exactly as it is printed in the booklet.">${esc(p.text)}</textarea></label>
          <p class="p-count" id="p-count">${passageCount(p.text)} <span class="muted">· the phone app will listen for these words in this order</span></p>
        </div>
        <div class="card">
          <div class="card-head"><h2>Comprehension questions</h2><span class="muted small">Literal, inferential and critical, as in the Phil-IRI booklet</span></div>
          ${p.questions.length ? `<ol class="q-list">${p.questions.map(q).join('')}</ol>` : '<p class="muted">No questions yet.</p>'}
          <div class="row"><button class="btn" type="button" data-act="add-question">+ Add question</button></div>
        </div>
      </div>`;
  }
  // text from a PDF / Word / text file: the teacher picks pages and trims before using it
  const DOC_ACCEPT = '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';
  const importText = im => im.pages.slice(im.from - 1, im.to).filter(x => x.trim()).join('\n\n');
  function importPanel(im) {
    const n = im.pages.length;
    const pageOpts = Array.from({ length: n }, (_, i) => [i + 1, 'Page ' + (i + 1)]);
    const target = im.target && currentPassage();
    return `
      <div class="head"><div>
        <button class="btn quiet small back" type="button" data-act="cancel-import">‹ Cancel</button>
        <h1>Bring in a passage</h1>
        <p>From <b>${esc(im.name)}</b>. Delete anything that is not part of the passage, such as page numbers, headings or the questions, then press “${target ? 'Use this text' : 'Make a passage'}”.</p></div>
      </div>
      <div class="card">
        ${n > 1 ? `<div class="row imp-pages">
          <label class="pill-field"><span>From</span><select id="imp-from">${options(pageOpts, im.from)}</select></label>
          <label class="pill-field"><span>To</span><select id="imp-to">${options(pageOpts, im.to)}</select></label>
          <span class="muted small">${n} pages in this PDF. Pick the pages where the passage is.</span></div>` : ''}
        <textarea class="passage-text" id="imp-text" rows="16">${esc(im.text)}</textarea>
        <p class="p-count" id="imp-count">${passageCount(im.text)}</p>
        <div class="row">
          <button class="btn primary" type="button" data-act="use-import">${target ? 'Use this text' : 'Make a passage'}</button>
          <button class="btn small quiet" type="button" data-act="tidy-import">Fix line breaks</button>
          <button class="btn quiet" type="button" data-act="cancel-import">Cancel</button>
        </div>
      </div>`;
  }
  async function startImport(input) {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (DocText.kindOf(file) === 'picture') { toast('Pictures cannot be used. Please paste the passage as text, or bring in a PDF or Word file.'); return; }
    toast('Reading ' + file.name + '…');
    try {
      const { pages } = await DocText.read(file);
      const first = pages.findIndex(p => p.trim()) + 1;
      ui.pImport = { name: file.name, pages, from: first, to: pages.length > 1 ? first : pages.length, target: ui.passageId || null };
      ui.pImport.text = importText(ui.pImport);
      $('#toast').hidden = true;
      render(); window.scrollTo(0, 0);
    } catch (err) { toast(err.message || 'That file could not be read.'); }
  }
  function useImport() {
    const im = ui.pImport;
    let text = ($('#imp-text') ? $('#imp-text').value : im.text).trim();
    if (!text) { toast('There is no text to use.'); return; }
    let p = im.target && passageList().find(x => x.id === im.target);
    if (!p) {
      p = Data.newPassage(ui.pLang || 'English');
      if (ui.pGrade) p.grade = ui.pGrade;
      // a short first line is most likely the title
      const m = /^([^\n]*)\n+([\s\S]*)$/.exec(text);
      if (m && m[2].trim() && m[1].length <= 70 && Data.passageWords(m[1]).length <= 10 && !/[.!?]$/.test(m[1].trim())) { p.title = m[1].trim(); text = m[2].trim(); }
      passageList().push(p);
    }
    p.text = text; p.updated = Date.now();
    ui.passageId = p.id; ui.pImport = null;
    save(); render(); window.scrollTo(0, 0);
    toast('Passage text brought in. Check it against the booklet.');
  }
  function passageAct(act, b) {
    const p = currentPassage();
    if (act === 'add-passage') {
      const np = Data.newPassage(ui.pLang || 'English');
      if (ui.pGrade) np.grade = ui.pGrade;
      passageList().push(np); ui.passageId = np.id;
    } else if (act === 'open-passage') ui.passageId = b.dataset.id;
    else if (act === 'close-passage') {
      // an untouched new passage is not kept
      if (p && !p.title.trim() && !p.text.trim() && !p.questions.length) state.passages = passageList().filter(x => x !== p);
      else if (p) ui.pLang = p.language;
      ui.passageId = null;
    } else if (act === 'del-passage') {
      if (!armed(b, 'Click again to delete')) return true;
      state.passages = passageList().filter(x => x !== p); ui.passageId = null; toast('Passage deleted.');
    } else if (act === 'add-question') {
      p.questions.push(Data.newQuestion());
      save(); render();
      const qs = $$('.q-item textarea'); if (qs.length) qs[qs.length - 1].focus();
      return true;
    } else if (act === 'del-question') {
      if (!armed(b, 'Remove?')) return true;
      p.questions.splice(+b.dataset.i, 1);
    } else if (act === 'move-question') {
      const i = +b.dataset.i, j = i + +b.dataset.d;
      [p.questions[i], p.questions[j]] = [p.questions[j], p.questions[i]];
    } else if (act === 'tidy-passage') {
      const ta = $('textarea[data-pf="text"]'); ta.value = DocText.tidy(ta.value); passageInput(ta); toast('Line breaks fixed.'); return true;
    } else if (act === 'tidy-import') {
      const ta = $('#imp-text'); ta.value = DocText.tidy(ta.value); ui.pImport.text = ta.value; $('#imp-count').innerHTML = passageCount(ta.value); return true;
    } else if (act === 'use-import') { useImport(); return true; }
    else if (act === 'cancel-import') ui.pImport = null;
    else if (act === 'export-passages') { exportPassages(); return true; }
    else return false;
    if (p) p.updated = Date.now();
    save(); render(); window.scrollTo(0, 0);
    return true;
  }
  async function exportPassages() {
    const list = passageList().filter(p => p.text.trim());
    if (!list.length) { toast('Add a passage with its text first.'); return; }
    const pack = Data.passagePack(state, list.slice().sort((a, b) => a.language.localeCompare(b.language) || byGradeSet(a, b)));
    const r = await saveBlob(`phil-iri-passages-${state.sy}.json`, new Blob([JSON.stringify(pack, null, 1)], { type: 'application/json' }));
    if (r.status === 'saved') toast(`Saved ${list.length} passage${list.length === 1 ? '' : 's'} for the phone app.`);
  }
  function currentPassage() { return passageList().find(x => x.id === ui.passageId) || null; }
  // typing: store as the teacher types, without redrawing (keeps the cursor in place)
  function passageInput(t) {
    const p = currentPassage();
    if (!p) return false;
    if (t.dataset.pf) {
      const k = t.dataset.pf;
      p[k] = t.value;
      if (k === 'text') $('#p-count').innerHTML = passageCount(p.text) + ' <span class="muted">· the phone app will listen for these words in this order</span>';
      if (k === 'title') $('#p-heading').textContent = p.title || 'New passage';
    } else if (t.dataset.qf) {
      const [i, k] = t.dataset.qf.split(':');
      const qq = p.questions[+i];
      if (!qq) return false;
      if (k === 'answer') qq.answer = +t.value;
      else if (/^c\d$/.test(k)) qq.choices[+k[1]] = t.value;
      else qq[k] = t.value;
    } else return false;
    p.updated = Date.now();
    save();
    return true;
  }

  // ================= Classes =================
  function viewClasses() {
    const list = syClasses();
    const rows = list.map(c => `
      <tr data-cid="${c.id}">
        <td style="width:130px"><select id="cg-${c.id}" data-cf="grade">${options([['', '–']].concat(GRADES.map(g => [g, 'Grade ' + g])), c.grade)}</select></td>
        <td><input type="text" id="cs-${c.id}" data-cf="section" value="${esc(c.section)}" placeholder="Section"></td>
        <td><input type="text" id="ca-${c.id}" data-cf="adviser" value="${esc(c.adviser)}" placeholder="Teacher"></td>
        <td class="num">${c.learners.length} learners</td>
        <td><button class="btn small quiet danger" type="button" data-act="del-class">Delete</button></td>
      </tr>`).join('');
    return `
      <div class="head" style="margin-top:12px">
        <div><h1>Classes</h1><p>Each class keeps its learners for the whole school year, so you type names only once for BOSY, MOSY and EOSY and for every form.</p></div>
        <label class="field"><span>School year</span><input type="text" id="sy-input" value="${esc(state.sy)}" style="width:130px"></label>
      </div>
      <div class="panel flush"><div class="table-wrap"><table class="grid">
        <thead><tr><th>Grade</th><th>Section</th><th>Teacher</th><th>Learners</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="empty">No classes yet. A class is created for you when you start filling in a form.</td></tr>'}</tbody>
      </table></div></div>
      <div class="row"><button class="btn" type="button" data-act="add-class">Add class</button></div>`;
  }

  // ================= Settings =================
  function viewSettings() {
    const s = state.school, st = state.settings;
    const inp = (id, label, val, extra = '') => `<label class="field"><span>${label}</span><input type="text" id="${id}" value="${esc(val)}" ${extra}></label>`;
    return `
      <div class="head"><div><h1>Settings</h1><p>School details fill the top and signature lines of every form.</p></div></div>
      <div class="panel stack"><h2>School</h2><div class="grid2">
        ${inp('s-name', 'School name', s.name, 'data-s="name"')}${inp('s-id', 'School ID', s.id, 'data-s="id"')}
        ${inp('s-district', 'District', s.district, 'data-s="district"')}${inp('s-division', 'Division', s.division, 'data-s="division"')}
        ${inp('s-region', 'Region', s.region, 'data-s="region"')}${inp('s-head', 'School head', s.head, 'data-s="head"')}
        ${inp('s-chair', 'Grade level chairperson', s.chair, 'data-s="chair"')}${inp('s-coord', 'Reading coordinator', s.coordinator, 'data-s="coordinator"')}
      </div></div>
      <div class="panel stack"><h2>How things are written on the forms</h2><div class="grid2">
        <label class="field"><span>Name format</span><select id="set-order">${options([['last', 'DELA CRUZ, Juan P.'], ['first', 'Juan P. Dela Cruz']], st.nameOrder)}</select></label>
        <label class="row" style="gap:6px;align-self:end"><input type="checkbox" id="set-upper" ${st.upperNames ? 'checked' : ''}> Names in capital letters</label>
        ${PERIODS.map(k => inp('pn-' + k, `${k} is written as`, st.periodNames[k], `data-pn="${k}"`)).join('')}
      </div><p class="muted small">The period name replaces the word in a form title, for example “(MIDYEAR)”.</p></div>
      <div class="panel stack"><h2>Backup</h2>
        <p class="muted">${isDesktop ? 'Your work is saved on this computer automatically.' : 'In this test version your work is kept in this browser only.'} Save a backup file now and then, for example to a USB drive. It includes your forms.</p>
        <div class="row">
          <button class="btn" type="button" data-act="backup">Save backup file</button>
          <span class="btn file-btn">Restore from backup…<input type="file" id="restore-file" accept=".json,application/json"></span>
          <span class="btn file-btn">Add a colleague’s classes…<input type="file" id="merge-file" accept=".json,application/json"></span>
        </div>
        <p class="muted small">“Add a colleague’s classes” reads another teacher’s backup file, so a grade level chairperson or coordinator can print the summaries.</p>
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

  // ================= events =================
  document.addEventListener('click', async (e) => {

    const segBtn = e.target.closest('.seg[data-seg] button');
    if (segBtn) {
      const name = segBtn.parentElement.dataset.seg, v = segBtn.dataset.v;
      if (name === 'period') ui.period = v;
      else if (name === 'lang') {
        // remember the language for this form (the app may have guessed wrong)
        ui.lang = v;
        const f = currentForm();
        if (f) f.m.language = v;
      }
      else if (name === 'zoom') { ui.zoom = +v; renderMapper(); return; }
      else if (name === 'plang') ui.pLang = v;
      save(); render();
      return;
    }

    const mark = e.target.closest('button.mark');
    if (mark) {
      const f = currentForm();
      const tr = mark.closest('tr');
      const l = findLearner(tr.dataset.lid);
      const cols = f.m.lists[+mark.dataset.li].columns.slice().sort((a, b) => a.col - b.col);
      const c = cols[+mark.dataset.ci];
      const on = mark.getAttribute('aria-pressed') !== 'true';
      setGridValue(l, c, on, formLang(f));
      // the other level columns in this row switch off
      for (const b of tr.querySelectorAll('button.mark')) {
        const cc = cols[+b.dataset.ci];
        if (cc.key !== c.key) continue;
        const pressed = cc.key === 'a.level' ? on && cc.choice === c.choice : (l.sex === cc.choice);
        b.setAttribute('aria-pressed', pressed); b.textContent = pressed ? '●' : '';
      }
      if (ui.preview) refreshPreview();
      return;
    }

    const td = e.target.closest('#sheet-view td[data-ref]');
    if (td) { ui.sel = td.dataset.ref; renderMapper(); return; }

    const b = e.target.closest('[data-act]');
    if (!e.target.closest('.fb-more')) $$('.fb-more[open]').forEach(d => d.removeAttribute('open'));
    if (!b) return;
    const act = b.dataset.act;

    if (act === 'go-passages') { ui.view = 'passages'; ui.passageId = null; ui.pImport = null; render(); window.scrollTo(0, 0); return; }
    if (passageAct(act, b)) return;
    if (act === 'go-settings') { ui.view = 'settings'; render(); window.scrollTo(0, 0); return; }
    if (act === 'go-fill') { ui.view = 'fill'; ui.tplId = null; ui.sel = null; save(); render(); window.scrollTo(0, 0); return; }
    if (act === 'tab') { ui.form = b.dataset.key; ui.preview = true; const f = currentForm(); if (f && f.m.language) ui.lang = f.m.language; save(); render(); return; }
    if (act === 'load-sample-tpl') {
      const s = window.SAMPLE_TEMPLATES[b.dataset.k];
      await importTemplate(b64ToBuf(s.data), s.file, s.name);
    } else if (act === 'import-found') {
      const f = currentForm();
      const cls = currentClass(true);
      const list = f.m.lists[+b.dataset.li];
      const added = Data.importFound(state, cls, list, ui.period, formLang(f));
      // header values written on the form
      for (const fl of f.m.fields) {
        if (fl.mode !== 'after' || !fl.current) continue;
        const v = fl.current.trim();
        if (fl.key === 'class.adviser' && !cls.adviser) cls.adviser = v;
        if (fl.key === 'class.gradeSection' && !cls.section) {
          const m = /(\d{1,2})\s*[-–]?\s*(.*)/.exec(v);
          if (m) { cls.grade = m[1]; cls.section = m[2].replace(/^[-–\s]+/, ''); } else cls.section = v;
        }
        if (fl.key === 'date') (state.dates = state.dates || {})[`${cls.id}:${ui.period}`] = v;
      }
      save(); render();
      toast(`Brought in ${added.length} learners with their entries for ${ui.period}.`);
    } else if (act === 'rm-learner') {
      if (!armed(b, 'Remove?')) return;
      const lid = b.closest('tr').dataset.lid;
      for (const c of state.classes) c.learners = c.learners.filter(l => l.id !== lid);
      delete state.results[lid]; save(); render();
    } else if (act === 'zoom-in' || act === 'zoom-out' || act === 'zoom-fit') {
      if (act === 'zoom-fit') ui.fz = 'fit';
      else ui.fz = Math.min(3, Math.max(0.3, (ui.zoomNow || 1) * (act === 'zoom-in' ? 1.15 : 1 / 1.15)));
      $$('[data-act="zoom-fit"]').forEach(x => x.setAttribute('aria-pressed', ui.fz === 'fit'));
      applyZoomAll();
    } else if (act === 'toggle-table') {
      ui.tableView = !ui.tableView; ui.preview = !ui.tableView ? false : true; render();
    } else if (act === 'print-form') {
      printForm();
    } else if (act === 'toggle-preview') {
      ui.preview = !ui.preview; render();
      if (ui.preview) $('#preview').scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else if (act === 'save-file') saveWholeFile(false);
    else if (act === 'save-form') saveForm(false);
    else if (act === 'open-form') { const f = currentForm(); if (f && f.m.kind === 'learner') saveForm(true); else saveWholeFile(true); }
    else if (act === 'save-all') saveForm(false, true);
    else if (act === 'fill-sheet') {
      ui.form = b.dataset.tpl + ':' + b.dataset.i; ui.view = 'fill'; ui.tplId = null; ui.sel = null; save(); render(); window.scrollTo(0, 0);
    } else if (act === 'open-sheet') {
      ui.view = 'adjust'; ui.tplId = b.dataset.tpl; ui.sheetIdx = +b.dataset.i; ui.sel = null; render(); window.scrollTo(0, 0);
    } else if (act === 'close-tpl') { ui.view = 'fill'; ui.tplId = null; ui.sel = null; render(); }
    else if (act === 'del-tpl') {
      if (!armed(b, 'Click again to remove')) return;
      state.templates = state.templates.filter(t => t.id !== b.dataset.tpl); Data.kvDel('tpl:' + b.dataset.tpl); tplCache.delete(b.dataset.tpl); ui.form = null; save(); render(); toast('File removed.');
    } else if (act === 'redetect') {
      const t = state.templates.find(x => x.id === ui.tplId);
      const data = await tplData(t.id);
      const m = t.sheets[ui.sheetIdx];
      t.sheets[ui.sheetIdx] = Detect.detectSheet(data.wb.sheets.find(s => s.path === m.sheetPath));
      save(); renderMapper(); toast('Read the sheet again.');
    } else if (act === 'del-field') {
      const m = currentMapping(); m.fields = m.fields.filter(f => f.id !== b.dataset.id); save(); renderMapper();
    } else if (act === 'clear-sel') { ui.sel = null; renderMapper(); }
    else if (act === 'add-field') {
      const m = currentMapping();
      const key = $('#sel-key').value, modeV = $('#sel-mode').value;
      const f = { id: Data.uid('F'), ref: ui.sel, key, conf: 1, label: L(key) };
      if (modeV.startsWith('blank:')) { f.mode = 'blank'; f.blankIndex = +modeV.split(':')[1]; }
      else if (modeV === 'find') { f.mode = 'find'; f.find = $('#sel-find').value; if (!f.find) { toast('Type the word or number to replace.'); return; } }
      else f.mode = modeV;
      m.fields.push(f); ui.sel = null; save(); renderMapper();
    } else if (act === 'del-lcol') {
      const m = currentMapping(); const l = m.lists[+b.dataset.li];
      const [col] = l.columns.splice(+b.dataset.ci, 1);
      (l.unknownColumns = l.unknownColumns || []).push({ col: col.col, label: col.label || '', chain: col.chain });
      save(); renderMapper();
    } else if (act === 'add-lcol') {
      const m = currentMapping(); const l = m.lists[+b.dataset.li];
      const col = +b.dataset.col;
      const u = (l.unknownColumns || []).find(x => x.col === col) || {};
      l.unknownColumns = (l.unknownColumns || []).filter(x => x.col !== col);
      const chain = u.chain || [u.label || XL.numToCol(col)];
      l.columns.push({ col, key: 'x:' + Detect.norm(chain.join(' ')).slice(0, 60) || 'x:col' + col, input: 'text', chain, label: chain.join(' › '), conf: 1 });
      l.columns.sort((a, c2) => a.col - c2.col);
      save(); renderMapper();
    } else if (act === 'add-class') {
      state.classes.push({ id: Data.uid('c'), sy: state.sy, grade: '', section: '', adviser: '', designation: '', learners: [] }); save(); render();
    } else if (act === 'del-class') {
      if (!armed(b, 'Click again to delete')) return;
      const cid = b.closest('tr').dataset.cid;
      const c = state.classes.find(x => x.id === cid);
      for (const l of c.learners) delete state.results[l.id];
      state.classes = state.classes.filter(x => x !== c); save(); render(); toast('Class deleted.');
    } else if (act === 'backup') {
      const json = await makeBackup();
      const r = await saveBlob(`phil-iri-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([json], { type: 'application/json' }));
      if (r.status === 'saved') toast('Backup saved.');
    } else if (act === 'reset-all') {
      if (!armed(b, 'Click again to erase everything')) return;
      for (const t of state.templates) Data.kvDel('tpl:' + t.id);
      state = Data.emptyState(); tplCache.clear(); ui.classId = null; ui.form = null; save(); render(); toast('Everything was erased.');
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (ui.view !== 'passages') return;
    if (t.id === 'imp-text') { ui.pImport.text = t.value; $('#imp-count').innerHTML = passageCount(t.value); return; }
    if (t.tagName !== 'SELECT' && t.type !== 'radio' && (t.dataset.pf || t.dataset.qf)) passageInput(t);
  });

  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (ui.view === 'passages') {
      if (t.dataset.pf || t.dataset.qf) {
        passageInput(t);
        if (t.dataset.pf === 'language' || t.dataset.pf === 'type') render();
        return;
      }
      if (t.id === 'p-grade-filter') { ui.pGrade = t.value; render(); return; }
      if (t.classList.contains('passage-doc')) { await startImport(t); return; }
      if (t.id === 'imp-from' || t.id === 'imp-to') {
        const im = ui.pImport;
        im[t.id === 'imp-from' ? 'from' : 'to'] = +t.value;
        if (im.to < im.from) { if (t.id === 'imp-from') im.to = im.from; else im.from = im.to; }
        im.text = importText(im); render(); return;
      }
      if (t.id === 'passages-file' && t.files[0]) {
        try {
          const r = Data.importPassages(state, JSON.parse(await t.files[0].text()));
          save(); render(); toast(`Brought in ${r.added} new passage${r.added === 1 ? '' : 's'}${r.updated ? `, updated ${r.updated}` : ''}.`);
        } catch (err) { toast(err.message || 'That file could not be read.'); }
        t.value = ''; return;
      }
    }
    // entry table
    if (t.closest && t.closest('table.entry') && t.dataset.ci != null && !t.classList.contains('add-name')) {
      const f = currentForm();
      const tr = t.closest('tr');
      const l = findLearner(tr.dataset.lid);
      const cols = f.m.lists[+t.dataset.li].columns.slice().sort((a, b) => a.col - b.col);
      const c = cols[+t.dataset.ci];
      setGridValue(l, c, t.type === 'checkbox' ? t.checked : t.value, formLang(f));
      if (colKind(c) === 'name') t.value = Data.fullName(l, state.settings);
      refreshRow(tr, f, +t.dataset.li);
      if (colKind(c) === 'sex') render();
      if (ui.preview) refreshPreview();
      return;
    }
    if (t.id === 'file-pick') {
      if (t.value === '__upload') { const f = currentForm(); t.value = f ? f.t.id : ''; $('#tpl-file').click(); return; }
      const f = allForms().find(x => x.t.id === t.value && x.m.kind === 'class') || allForms().find(x => x.t.id === t.value);
      ui.form = f ? f.key : null; ui.preview = true; if (f && f.m.language) ui.lang = f.m.language; save(); render(); return;
    }
    if (t.id === 'fill-class') {
      if (t.value === '__new') { const c = { id: Data.uid('c'), sy: state.sy, grade: '', section: '', adviser: '', designation: '', learners: [] }; state.classes.push(c); ui.classId = c.id; }
      else ui.classId = t.value;
      save(); render(); return;
    }
    if (t.id === 'fill-grade') { ui.grade = t.value; save(); render(); return; }
    if (t.id === 'fill-learner') {
      if (t.value === '__new') { $('#new-learner').hidden = false; $('#new-learner').focus(); t.value = ui.learnerId || ''; return; }
      ui.learnerId = t.value; save(); render(); return;
    }
    if (t.id === 'new-learner' && t.value.trim()) { const [l] = addLearners([t.value]); ui.learnerId = l.id; save(); render(); return; }
    if (t.dataset.detail) {
      const [label, where, prop] = DETAIL_FIELDS[t.dataset.detail]; // eslint-disable-line no-unused-vars
      const v = t.value.trim();
      if (where === 'school') state.school[prop] = v;
      else if (where === 'class') { const c = currentClass(true); c[prop] = v; }
      else { const c = currentClass(true); (state.dates = state.dates || {})[`${c.id}:${ui.period}`] = v; }
      save();
      if (where === 'class' && (prop === 'grade' || prop === 'section')) render();
      else if (ui.preview) refreshPreview();
      return;
    }
    if (t.id === 'pg-fit' || t.id === 'pg-orient' || t.id === 'pg-paper') {
      if (t.id === 'pg-fit') ui.page.fit = t.value; else if (t.id === 'pg-orient') ui.page.orient = t.value; else ui.page.paper = t.value;
      const f = currentForm();
      if ($('#formview')) renderFormView(f);
      if ($('#preview') && !$('#preview').hidden) refreshPreview();
      return;
    }
    if (t.id === 'tpl-file' && t.files[0]) { const file = t.files[0]; await importTemplate(await file.arrayBuffer(), file.name); return; }
    // classes
    if (t.id === 'sy-input') { state.sy = t.value.trim() || state.sy; ui.classId = null; save(); render(); return; }
    if (t.dataset.cf) { const c = state.classes.find(x => x.id === t.closest('tr').dataset.cid); c[t.dataset.cf] = t.value.trim(); save(); return; }
    // adjust
    if (t.id === 'sheet-pick') { ui.sheetIdx = +t.value; ui.sel = null; renderMapper(); return; }
    const m = ui.view === 'adjust' && ui.tplId ? currentMapping() : null;
    if (m) {
      if (t.id === 'kind-pick') m.kind = t.value;
      else if (t.id === 'lang-pick') m.language = t.value || null;
      else if (t.dataset.field) { const f = m.fields.find(x => x.id === t.dataset.field); f.key = t.value; f.label = L(t.value); f.conf = 1; }
      else if (t.dataset.part) { const [li, pi, k] = t.dataset.part.split(':'); const p = m.lists[+li].parts[+pi]; p[k] = k === 'sex' ? (t.value || null) : +t.value; m.lists[+li].lastRow = Math.max(...m.lists[+li].parts.map(x => x.last)); }
      else if (t.dataset.lcol) { const [li, ci] = t.dataset.lcol.split(':').map(Number); const col = m.lists[li].columns[ci]; col.key = t.value; col.conf = 1; delete col.choice; col.flag = ['a.struggling', 'a.nonReader'].includes(t.value); }
      else if (t.dataset.xinput) { const [li, ci] = t.dataset.xinput.split(':').map(Number); const col = m.lists[li].columns[ci]; col.input = t.value; col.conf = 1; }
      else if (t.dataset.lmark) { const [li, ci] = t.dataset.lmark.split(':').map(Number); m.lists[li].columns[ci].mark = t.value; }
      else if (t.dataset.srow) { const [si, k] = t.dataset.srow.split(':').map(Number); m.summaries[si].rows[k] = +t.value; }
      else if (t.dataset.sgroup) { m.summaries[+t.dataset.sgroup].groupBy = t.value; m.kind = t.value === 'section' ? 'grade' : 'school'; }
      else if (t.dataset.scol) { const [si, ci] = t.dataset.scol.split(':').map(Number); m.summaries[si].columns[ci].metric = t.value; }
      else return;
      save(); renderMapper(); return;
    }
    // settings
    if (t.dataset.s) { state.school[t.dataset.s] = t.value.trim(); save(); return; }
    if (t.dataset.pn) { state.settings.periodNames[t.dataset.pn] = t.value.trim(); save(); return; }
    if (t.id === 'set-order') { state.settings.nameOrder = t.value; save(); return; }
    if (t.id === 'set-upper') { state.settings.upperNames = t.checked; save(); return; }
    if ((t.id === 'restore-file' || t.id === 'merge-file') && t.files[0]) {
      try {
        const json = JSON.parse(await t.files[0].text());
        if (json.app !== 'phil-iri-recorder' || !json.state) throw new Error('This is not a Phil-IRI Recorder backup file.');
        if (t.id === 'restore-file') {
          state = Object.assign(Data.emptyState(), json.state);
          tplCache.clear();
          for (const [id, b64] of Object.entries(json.templates || {})) await Data.kvSet('tpl:' + id, b64ToBuf(b64));
          ui.classId = null; ui.form = null; save(); render(); toast('Backup restored.');
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

  function saveTyped(div) {
    const box = $('#formview');
    const f = currentForm();
    if (!box || !f || box.dataset.key !== f.key) return;
    const td = div.closest('td[data-ref]');
    const ref = td.dataset.ref;
    const text = div.innerText.replace(/\n+$/, '');
    if (text === (div.dataset.orig ?? '')) return;
    const cellInfo = formMap[ref];
    if (cellInfo) {
      const k = colKind(cellInfo.c);
      if (!cellInfo.lid) {
        if (k === 'name' && text.trim()) addLearners([text], cellInfo.sex);
      } else {
        const l = findLearner(cellInfo.lid);
        if (k === 'name' && !text.trim()) { toast('To remove a learner, use the ✕ in the table view.'); }
        else setGridValue(l, cellInfo.c, text, formLang(f));
      }
      save();
      redrawFormSoon();
      return;
    }
    const edits = formEdits(f, true);
    edits[ref] = text;
    td.classList.add('mk-typed'); td.classList.remove('mk-fill');
    save();
  }
  let redrawTimer = null;
  function redrawFormSoon() {
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(() => {
      const a = document.activeElement;
      const td = a && a.closest && a.closest('#formview td[data-ref]');
      focusAfter = td ? td.dataset.ref : null;
      const f = currentForm();
      if (f) renderFormView(f);
    }, 0);
  }
  function toggleCell(el) {
    const f = currentForm();
    const ref = el.closest('td[data-ref]').dataset.ref;
    const info = formMap[ref];
    if (!info || !info.lid) return;
    const l = findLearner(info.lid);
    const k = colKind(info.c);
    const lang = formLang(f);
    const res = Data.result(state, l.id, ui.period, lang);
    const on = k === 'lvlmark' ? res.level === info.c.choice : k === 'sexmark' ? l.sex === info.c.choice : k === 'flag' ? !!res[info.c.key === 'a.struggling' ? 'struggling' : 'nonReader'] : !!(res.x || {})[info.c.key];
    setGridValue(l, info.c, !on, lang);
    save();
    focusAfter = ref;
    renderFormView(f);
  }
  document.addEventListener('click', (e) => {
    const tg = e.target.closest && e.target.closest('#formview .xl-toggle');
    if (tg) toggleCell(tg);
  });
  document.addEventListener('focusin', (e) => {
    const d = e.target;
    if (d.isContentEditable && d.closest('#formview')) d.dataset.orig = d.innerText;
  });
  document.addEventListener('focusout', (e) => {
    const d = e.target;
    if (d.isContentEditable && d.closest('#formview')) saveTyped(d);
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.classList && t.classList.contains('xl-toggle') && (e.key === ' ' || e.key === 'Enter' || e.key === '1' || /^[xX√/]$/.test(e.key))) { e.preventDefault(); toggleCell(t); return; }
    if (t.isContentEditable && t.closest('#formview') && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const td = t.closest('td[data-ref]');
      const p = XL.parseRef(td.dataset.ref);
      const span = +(td.getAttribute('rowspan') || 1);
      for (let r = p.r + span; r < p.r + span + 6; r++) {
        const next = $(`#formview td[data-ref="${XL.makeRef(r, p.c)}"] [contenteditable]`);
        if (next) { next.focus(); return; }
      }
      t.blur();
      return;
    }
    if (e.key !== 'Enter' || !t.closest || !t.closest('table.entry')) return;
    if (t.classList.contains('add-name')) {
      e.preventDefault();
      if (!t.value.trim()) return;
      const [l] = addLearners([t.value], t.dataset.sex);
      const id = t.id;
      render();
      const next = document.getElementById(id); if (next) next.focus();
      toast(`Added ${Data.fullName(l, state.settings)}.`);
      return;
    }
    // Enter: same column, next learner
    e.preventDefault();
    t.dispatchEvent(new Event('change', { bubbles: true }));
    const tr = t.closest('tr');
    let next = tr.nextElementSibling;
    while (next && !next.dataset.lid && !next.classList.contains('addrow')) next = next.nextElementSibling;
    const target = next && (next.dataset.lid ? next.querySelector(`[data-ci="${t.dataset.ci}"]`) : next.querySelector('.add-name'));
    if (target) target.focus();
  });

  document.addEventListener('paste', (e) => {
    const t = e.target;
    if (!t.closest || !t.closest('table.entry')) return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text.includes('\n') && !text.includes('\t')) return;
    e.preventDefault();
    pasteBlock(t, text);
  });

  // drag and drop a form anywhere on the upload box
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
      ui.view = 'fill';
    }
    render();
  }
  boot();
})();
