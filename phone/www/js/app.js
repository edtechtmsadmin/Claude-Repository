/* Phil-IRI Reader - phone app screens.
 *
 * Flow: file from the desktop app -> pick test (oral reading / GST) ->
 * learner -> passage -> (warm-up) -> reading -> teacher check -> questions ->
 * result -> send results back to the desktop app.
 * The teacher stays in charge: the app marks, the teacher confirms.
 */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PERIODS = ['BOSY', 'MOSY', 'EOSY'];
  const LEVELS = ['Independent', 'Instructional', 'Frustration'];
  const LVL_CLASS = { Independent: 'i', Instructional: 'n', Frustration: 'f' };
  const KEY = 'phil-iri-reader';

  // ---------- data ----------
  const blank = () => ({
    pack: null, period: 'BOSY', results: [],
    settings: {
      mode: 'listen', showMarks: true, gstCutPct: 70,
      speech: { English: 'en-PH', Filipino: 'fil-PH' },
      counted: Object.assign({}, Align.COUNTED_DEFAULT),
    },
  });
  let db = blank();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) { db = Object.assign(blank(), saved); db.settings = Object.assign(blank().settings, saved.settings); }
  } catch (e) { /* first start or storage blocked */ }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('Could not save on this phone. Storage may be full.'); } }

  const ui = { screen: 'home', classId: null, lang: 'Filipino', test: 'oral', learnerId: null, passageId: null, allGrades: false };
  let session = null;      // the test in progress
  let listener = null;

  const P = () => db.pack;
  const cls = () => (P() && (P().classes.find(c => c.id === ui.classId) || P().classes[0])) || null;
  const learner = () => { for (const c of (P() ? P().classes : [])) { const l = c.learners.find(x => x.id === ui.learnerId); if (l) return l; } return null; };
  const passage = () => P() && P().passages.find(x => x.id === ui.passageId);
  const wordsOf = p => p.words && p.words.length ? p.words : Align.tokens(p.text);
  const latest = (lid, lang, type) => db.results.filter(r => r.learnerId === lid && r.period === db.period && r.language === lang && r.type === type).sort((a, b) => b.assessedAt.localeCompare(a.assessedAt))[0];
  const rules = () => (P() && P().rules) || { word: { indep: 97, inst: 90 }, comp: { indep: 80, inst: 59 } };
  function combine(wl, cl) {
    const how = (P() && P().combine) || 'lower';
    if (wl && cl) return how === 'comp' ? cl : how === 'word' ? wl : LEVELS[Math.max(LEVELS.indexOf(wl), LEVELS.indexOf(cl))];
    return wl || cl || null;
  }

  function toast(msg, ms = 3500) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
  }
  function seg(name, values, cur, labels = {}) {
    return `<div class="seg" data-seg="${name}">${values.map(v => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === cur}">${esc(labels[v] || v)}</button>`).join('')}</div>`;
  }
  const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // ---------- navigation (the phone's back button goes back a screen) ----------
  function go(screen, replace) {
    ui.screen = screen;
    try { history[replace ? 'replaceState' : 'pushState']({ screen }, ''); } catch (e) { /* file:// in some browsers */ }
    render(); window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', (e) => {
    if (session && session.listening) { stopListening(); }
    ui.screen = (e.state && e.state.screen) || 'home';
    if (['read', 'check', 'questions', 'gstread', 'gstq'].includes(ui.screen) && !session) ui.screen = 'home';
    render();
  });

  // ---------- files ----------
  function loadPack(json) {
    if (!json || json.app !== 'phil-iri-recorder' || !Array.isArray(json.passages)) throw new Error('This is not a file from the Phil-IRI Recorder desktop app.');
    if (!Array.isArray(json.classes)) json.classes = [];
    json.importedAt = new Date().toISOString();
    db.pack = json;
    ui.classId = null; ui.passageId = null; ui.learnerId = null;
    persist();
  }
  async function shareFile(name, text) {
    const C = window.Capacitor;
    const native = C && C.isNativePlatform && C.isNativePlatform();
    if (native) {
      const plug = n => (C.registerPlugin ? C.registerPlugin(n) : C.Plugins[n]);
      const FS = plug('Filesystem'), Share = plug('Share');
      const w = await FS.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
      await Share.share({ title: name, text: 'Phil-IRI results for the desktop app', url: w.uri, dialogTitle: 'Send the results file' });
      return true;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
    return true;
  }

  // ================= screens =================
  function render() {
    renderBar();
    const v = $('#view');
    const fn = SCREENS[ui.screen] || SCREENS.home;
    v.innerHTML = fn();
    v.dataset.screen = ui.screen;
    after[ui.screen] && after[ui.screen]();
  }
  function renderBar() {
    const back = ui.screen !== 'home';
    const reading = ['read', 'gstread', 'gstq'].includes(ui.screen);
    $('#bar').innerHTML = `
      ${back && !reading ? '<button class="icon-btn" type="button" data-act="back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' : ''}
      <div class="brand">${!back ? '<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M6 7.5c3.6-1.2 7-.9 10 1.2 3-2.1 6.4-2.4 10-1.2v17c-3.6-1.2-7-.9-10 1.2-3-2.1-6.4-2.4-10-1.2z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M16 8.7v17" stroke="currentColor" stroke-width="2.2"/></svg></span>' : ''}
        <div><div class="brand-name">${esc(TITLES[ui.screen] || 'Phil-IRI Reader')}</div>${P() ? `<div class="brand-sub">${esc(P().school.name || 'Phil-IRI')} · ${esc(db.period)}${P().sample ? ' · sample' : ''}</div>` : ''}</div></div>
      ${ui.screen === 'home' && P() ? '<button class="icon-btn" type="button" data-act="settings" aria-label="Settings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.8v2.6M12 18.6v2.6M4.2 7.5l2.2 1.3M17.6 15.2l2.2 1.3M4.2 16.5l2.2-1.3M17.6 8.8l2.2-1.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' : ''}`;
  }
  const TITLES = {
    home: 'Phil-IRI Reader', learners: 'Choose a learner', passages: 'Choose a passage', ready: 'Get ready', read: 'Oral reading',
    check: 'Check the marks', questions: 'Questions', result: 'Result', gstread: 'Screening test', gstq: 'Screening test',
    gstresult: 'Screening result', results: 'Results', settings: 'Settings',
  };

  const SCREENS = {};
  const after = {};

  // ---------- home ----------
  SCREENS.home = () => {
    if (!P()) return `
      <section class="hero">
        <h1>Phil-IRI on the phone</h1>
        <p class="lede">The learner reads, the phone listens and marks the miscues. You check the marks, and the results go back to the desktop app.</p>
      </section>
      <ol class="steps">
        <li><b>On the laptop</b><span>Phil-IRI Recorder › Passages › Phone app › <i>Save file for the phone</i>.</span></li>
        <li><b>Copy it to this phone</b><span>By USB cable, Bluetooth, Nearby Share, Messenger or Drive.</span></li>
        <li><b>Open it here</b><span>The passages and your class lists appear.</span></li>
      </ol>
      <label class="btn primary big file-btn">Open the file from the laptop<input type="file" id="pack-file" accept=".json,application/json"></label>
      <button class="btn quiet" type="button" data-act="sample">Try it first with a sample class</button>
      <p class="privacy">${lockIcon}No voice is recorded. The app keeps only the results.</p>`;
    const n = db.results.filter(r => r.period === db.period).length;
    const np = P().passages.length, nl = P().classes.reduce((a, c) => a + c.learners.length, 0);
    return `
      <div class="period">${seg('period', PERIODS, db.period, { BOSY: 'BOSY', MOSY: 'MOSY', EOSY: 'EOSY' })}</div>
      <button class="tile tile-oral" type="button" data-act="start" data-test="oral">
        <span class="tile-icon" aria-hidden="true"><svg viewBox="0 0 32 32"><rect x="11" y="4" width="10" height="16" rx="5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M7 15a9 9 0 0 0 18 0M16 24v4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></span>
        <span><b>Oral reading</b><span>The learner reads aloud. The phone listens and marks the miscues.</span></span>
      </button>
      <button class="tile tile-gst" type="button" data-act="start" data-test="gst">
        <span class="tile-icon" aria-hidden="true"><svg viewBox="0 0 32 32"><rect x="6" y="4" width="20" height="24" rx="3" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M11 11l2 2 4-4M11 19l2 2 4-4M20 11h2M20 19h2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span><b>Group Screening Test</b><span>The learner reads and answers on the phone. Checked at once.</span></span>
      </button>
      <button class="tile tile-res" type="button" data-act="results">
        <span class="tile-icon" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M6 26V14M13 26V6M20 26v-9M27 26V10" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></span>
        <span><b>Results · ${esc(db.period)}</b><span>${n} saved. Send them to the laptop.</span></span>
        <span class="count">${n}</span>
      </button>
      <div class="card small-card">
        <div><b>${np}</b> passage${np === 1 ? '' : 's'} · <b>${nl}</b> learner${nl === 1 ? '' : 's'}${P().sample ? ' · sample data' : ''}</div>
        <label class="btn small file-btn">${P().sample ? 'Open the real file' : 'Update from laptop'}<input type="file" id="pack-file" accept=".json,application/json"></label>
      </div>
      <p class="privacy">${lockIcon}No voice is recorded. The app keeps only the results.</p>`;
  };
  const lockIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="9" width="12" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

  // ---------- learners ----------
  SCREENS.learners = () => {
    const c = cls();
    if (!c) return `<div class="card empty">No class lists in the file. In the desktop app, add your learners, then save the file for the phone again.</div>`;
    ui.classId = c.id;
    const list = sex => c.learners.filter(l => (l.sex || '') === sex);
    const row = l => {
      const r = latest(l.id, ui.lang, ui.test);
      const chip = !r ? '<span class="chip">Not yet</span>'
        : ui.test === 'gst' ? `<span class="chip ${r.needsOral ? 'f' : 'i'}">GST ${r.gst}/${r.gstTotal}</span>`
          : `<span class="chip ${LVL_CLASS[r.level] || ''}">${esc(r.level || 'Done')}</span>`;
      return `<button class="learner" type="button" data-act="pick-learner" data-id="${l.id}"><span>${esc(l.name)}</span>${chip}</button>`;
    };
    const part = (label, arr) => arr.length ? `<h3>${label}</h3><div class="list">${arr.map(row).join('')}</div>` : '';
    const other = c.learners.filter(l => !['M', 'F'].includes(l.sex || ''));
    return `
      <div class="sub-head"><b>${ui.test === 'gst' ? 'Group Screening Test' : 'Oral reading'}</b> · ${esc(db.period)}</div>
      ${P().classes.length > 1 ? `<label class="field"><span>Class</span><select id="class-pick">${P().classes.map(x => `<option value="${x.id}"${x.id === c.id ? ' selected' : ''}>Grade ${esc(x.grade || '?')} – ${esc(x.section || '')}</option>`).join('')}</select></label>` : `<div class="class-name">Grade ${esc(c.grade || '?')} – ${esc(c.section || '')}</div>`}
      ${seg('lang', ['Filipino', 'English'], ui.lang)}
      ${part('Male', list('M'))}${part('Female', list('F'))}${part('Learners', other)}`;
  };

  // ---------- passages ----------
  SCREENS.passages = () => {
    const c = cls(); const l = learner();
    const all = P().passages.filter(p => p.language === ui.lang && (p.type || 'oral') === ui.test);
    const grade = c && c.grade;
    const shown = ui.allGrades || !grade ? all : all.filter(p => !p.grade || p.grade === grade);
    shown.sort((a, b) => (+a.grade || 99) - (+b.grade || 99) || String(a.set).localeCompare(String(b.set)));
    const item = p => {
      const w = wordsOf(p).length, q = (p.questions || []).length;
      const noKey = ui.test === 'gst' && !(p.questions || []).some(x => x.choices && x.choices.length && x.answer != null);
      return `<button class="passage" type="button" data-act="pick-passage" data-id="${p.id}"${noKey ? ' disabled' : ''}>
        <span class="tags"><span class="t-grade">${p.grade ? 'Grade ' + esc(p.grade) : 'Any grade'}</span>${p.set ? `<span class="t-set">Set ${esc(p.set)}</span>` : ''}</span>
        <b>${esc(p.title || 'Untitled')}</b>
        <span class="muted small">${w} words · ${q} question${q === 1 ? '' : 's'}${noKey ? ' · needs answer choices (add them on the laptop)' : ''}</span>
      </button>`;
    };
    return `
      <div class="sub-head"><b>${esc(l ? l.name : '')}</b> · ${esc(ui.lang)}</div>
      ${grade && all.length !== shown.length || ui.allGrades ? `<label class="check"><input type="checkbox" id="all-grades"${ui.allGrades ? ' checked' : ''}> Show passages of all grades</label>` : ''}
      ${shown.length ? `<div class="list">${shown.map(item).join('')}</div>`
        : `<div class="card empty">No ${esc(ui.lang)} ${ui.test === 'gst' ? 'screening test' : 'oral reading'} passages${grade && !ui.allGrades ? ' for Grade ' + esc(grade) : ''}. ${all.length ? '' : 'Add them in the desktop app (Passages), then save the file for the phone again.'}</div>`}`;
  };

  // ---------- warm-up ----------
  SCREENS.ready = () => {
    const p = passage(), l = learner();
    const mode = session.mode;
    return `
      <div class="sub-head"><b>${esc(l.name)}</b> · ${esc(p.title)}</div>
      ${seg('mode', ['listen', 'tap'], mode, { listen: 'Phone listens', tap: 'I tap the miscues' })}
      ${mode === 'listen' ? `
        <div class="card warm">
          <div class="warm-step"><span class="n">1</span><div><b>Headset on</b><span class="muted">A headset with a microphone hears the learner best and blocks classroom noise.</span></div></div>
          <div class="warm-step"><span class="n">2</span><div><b>Is the room quiet enough?</b>
            <div class="meter"><span id="meter-bar"></span></div>
            <span class="muted" id="noise-msg">Press Check and stay quiet for 3 seconds.</span>
            <button class="btn small" type="button" data-act="noise">Check</button></div></div>
          <div class="warm-step"><span class="n">3</span><div><b>Practice</b><span class="muted">The learner says: <i>“${ui.lang === 'Filipino' ? 'Handa na akong magbasa.' : 'I am ready to read.'}”</i></span>
            <span id="practice-msg" class="muted"></span>
            <button class="btn small" type="button" data-act="practice">Listen</button></div></div>
        </div>
        <p class="muted small">Speech: ${esc(Listen.kind() === 'android' ? 'phone speech recognition' : Listen.kind() === 'browser' ? 'browser speech recognition (needs internet)' : 'not available here, use tap mode or the Android app')} · ${esc(db.settings.speech[ui.lang])}</p>`
        : `<div class="card"><p>You listen, and tap every word the learner misreads. The timer starts when you press Start.</p></div>`}
      <button class="btn primary big" type="button" data-act="begin">Show the passage</button>`;
  };

  // ---------- reading ----------
  SCREENS.read = () => {
    const p = passage();
    let j = 0;
    const html = esc(p.text).split(/(\n\s*\n)/).map(par => /^\n/.test(par) ? '' : `<p>${par.replace(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu, m => `<span class="w" data-j="${j++}">${m}</span>`)}</p>`).join('');
    return `
      <article class="passage-read${db.settings.showMarks || session.mode === 'tap' ? '' : ' no-marks'}" lang="${ui.lang === 'Filipino' ? 'fil' : 'en'}">
        <h2>${esc(p.title)}</h2>${html}
      </article>
      <div class="dock">
        <div class="dock-info">
          <span class="mic" id="mic" data-state="idle" aria-hidden="true"></span>
          <span class="timer" id="timer">0:00</span>
          <span class="live"><b id="live-m">0</b> miscues${session.mode === 'listen' ? ` · <b id="live-u">0</b> to check` : ''}</span>
        </div>
        ${session.started ? '<button class="btn primary" type="button" data-act="done">Done</button>' : `<button class="btn primary" type="button" data-act="go">${session.mode === 'listen' ? 'Start listening' : 'Start'}</button>`}
      </div>`;
  };
  after.read = () => { paintWords(); tickTimer(); };

  function currentAlignment(final) {
    const p = passage();
    return Align.align(session.words, Align.tokens(session.heard), { final, title: Align.tokens(p.title) });
  }
  function paintWords() {
    if (!session) return;
    const res = session.mode === 'listen' ? (session.align || { words: session.words.map(() => ({ status: 'unread' })), extras: [] }) : null;
    let m = 0, u = 0;
    $$('.passage-read .w').forEach(el => {
      const j = +el.dataset.j;
      const w = res ? res.words[j] : { status: 'correct' };
      const mark = session.marks[j];
      let st = mark ? mark.status : w.status;
      if (session.mode === 'tap' && !mark) st = 'plain';
      el.dataset.s = st;
      if (st === 'miscue') m++; else if (st === 'unsure') u++;
    });
    if (res) {
      for (const x of res.extras) if (['insertion', 'repetition'].includes(x.kind)) m++;
      const ptr = res.pointer;
      $$('.passage-read .w').forEach(el => el.classList.toggle('here', +el.dataset.j === ptr && session.listening));
    }
    const lm = $('#live-m'), lu = $('#live-u');
    if (lm) lm.textContent = m; if (lu) lu.textContent = u;
  }
  function tickTimer() {
    clearInterval(tickTimer.t);
    tickTimer.t = setInterval(() => {
      const el = $('#timer');
      if (!el || !session) { clearInterval(tickTimer.t); return; }
      const end = session.endAt || Date.now();
      el.textContent = session.startAt ? fmtTime((end - session.startAt) / 1000) : '0:00';
    }, 250);
  }
  async function startReading() {
    session.started = true;
    if (session.mode === 'tap') { session.startAt = Date.now(); render(); return; }
    render();
    listener = Listen.create({
      lang: db.settings.speech[ui.lang],
      onText: (text) => {
        if (!session) return;
        session.heard = text;
        if (!session.startAt && text.trim()) session.startAt = Date.now();
        session.align = currentAlignment(false);
        paintWords();
        // the last word was read: stop by itself shortly after
        clearTimeout(session.autoStop);
        if (session.align.pointer >= session.words.length) session.autoStop = setTimeout(() => finishReading(), 2500);
        else session.lastProgressAt = Date.now();
      },
      onState: (s) => { const mic = $('#mic'); if (mic) mic.dataset.state = s; },
      onError: (m) => toast(m, 6000),
    });
    const ok = await listener.start();
    if (!ok) { session.mode = 'tap'; session.startAt = Date.now(); toast('Switched to tap mode: tap each word the learner misreads.', 6000); render(); return; }
    session.listening = true;
    const mic = $('#mic'); if (mic) mic.dataset.state = 'listening';
  }
  async function stopListening() {
    if (listener) { const l = listener; listener = null; await l.stop(); }
    if (session) session.listening = false;
  }
  async function finishReading() {
    if (!session || session.endAt) return;
    clearTimeout(session.autoStop);
    session.endAt = Date.now();
    if (!session.startAt) session.startAt = session.endAt;
    await stopListening();
    if (session.mode === 'listen') session.align = currentAlignment(true);
    go('check', true);
  }

  // ---------- teacher check ----------
  function scored() {
    const base = session.mode === 'listen' ? session.align : { words: session.words.map(() => ({ status: 'correct', kind: null, heard: '' })), extras: [] };
    return Align.score(base, session.marks, session.extraMarks, db.settings.counted);
  }
  const KINDS = ['mispronunciation', 'substitution', 'omission', 'insertion', 'repetition', 'transposition', 'reversal'];
  SCREENS.check = () => {
    const p = passage();
    const s = scored();
    const W = session.words;
    const secs = Math.max(1, Math.round((session.endAt - session.startAt) / 1000));
    const ctx = j => `<span class="ctx">${esc(W.slice(Math.max(0, j - 3), j).join(' '))} <mark>${esc(W[j])}</mark> ${esc(W.slice(j + 1, j + 4).join(' '))}</span>`;
    const unsure = [], miscues = [];
    s.words.forEach((w, j) => { if (w.status === 'unsure' || w.status === 'unread') unsure.push(j); else if (w.status === 'miscue') miscues.push(j); });
    const why = w => w.kind === 'mispronunciation' ? `Heard “${esc(w.heard)}”` : w.kind === 'omission' ? 'Short word not heard' : w.kind === 'notheard' || w.status === 'unread' ? 'Not heard at the end' : w.heard ? `Heard “${esc(w.heard)}”` : 'Please check';
    const base = session.mode === 'listen' ? session.align : { extras: [] };
    const extras = base.extras.map((x, k) => ({ x, k })).filter(({ x }) => !['filler', 'before', 'after'].includes(x.kind));
    const wordPct = W.length ? Math.round(((W.length - s.miscues) / W.length) * 1000) / 10 : 0;
    return `
      <div class="stats">
        <div><b>${fmtTime(secs)}</b><span>time</span></div>
        <div><b>${Math.round(W.length / (secs / 60))}</b><span>words / min</span></div>
        <div class="${s.miscues ? 'f' : 'i'}"><b>${s.miscues}</b><span>miscues</span></div>
        <div><b>${wordPct}%</b><span>word reading</span></div>
      </div>
      ${unsure.length ? `<h3>Please check · ${unsure.length}</h3>
        <p class="muted small">Did the learner read these words correctly?</p>
        <div class="list">${unsure.map(j => `
          <div class="checkrow" data-j="${j}">${ctx(j)}<span class="why">${why(s.words[j])}</span>
            <div class="row2"><button class="btn ok" type="button" data-act="mark" data-j="${j}" data-s="correct">✔ Correct</button>
            <button class="btn bad" type="button" data-act="mark" data-j="${j}" data-s="miscue">✘ Miscue</button></div></div>`).join('')}</div>
        <button class="btn quiet small" type="button" data-act="all-correct">Count all of these as correct</button>` : `<div class="card ok-card">${session.mode === 'listen' ? 'Nothing left to check.' : 'Tap mode: the miscues you tapped are below.'}</div>`}
      <h3>Miscues · ${s.miscues}</h3>
      ${miscues.length || extras.length ? `<div class="list">
        ${miscues.map(j => `<div class="checkrow miscue" data-j="${j}">${ctx(j)}${s.words[j].heard ? `<span class="why">Heard “${esc(s.words[j].heard)}”</span>` : s.words[j].kind === 'omission' ? '<span class="why">Skipped</span>' : ''}
          <div class="row2"><select data-kind="${j}" aria-label="Kind of miscue">${KINDS.map(k => `<option value="${k}"${(s.words[j].kind || 'mispronunciation') === k ? ' selected' : ''}>${Align.KIND_LABEL[k]}</option>`).join('')}</select>
          <button class="btn small" type="button" data-act="mark" data-j="${j}" data-s="correct">Not a miscue</button></div></div>`).join('')}
        ${extras.map(({ x, k }) => {
          const on = (session.extraMarks[k] || (['insertion', 'repetition'].includes(x.kind) ? 'count' : 'ignore')) === 'count';
          const where = x.before > 0 ? `after “${esc(W[x.before - 1])}”` : 'at the start';
          const what = x.kind === 'repetition' ? 'said again' : x.kind === 'selfcorrection' ? 'then corrected' : 'added';
          return `<div class="checkrow extra"><span class="ctx">${Align.KIND_LABEL[x.kind] || x.kind}: <mark>${esc(x.heard)}</mark> ${what}, ${where}</span>
          <label class="check"><input type="checkbox" data-extra="${k}"${on ? ' checked' : ''}> Count as a miscue</label></div>`;
        }).join('')}</div>` : '<p class="muted">No miscues.</p>'}
      <details class="card"><summary>See the passage with the marks</summary>
        <div class="passage-mini">${W.map((w, j) => `<span class="w" data-j="${j}" data-s="${s.words[j].status}">${esc(w)}</span>`).join(' ')}</div>
        <p class="muted small">Tap a word to change it: correct → miscue → correct.</p></details>
      <button class="btn primary big" type="button" data-act="to-questions"${unsure.length ? ' disabled' : ''}>${(p.questions || []).length ? 'Next: questions' : 'See the result'}</button>
      ${unsure.length ? '<p class="muted small center">Check the yellow words first.</p>' : ''}`;
  };

  // ---------- questions ----------
  SCREENS.questions = () => {
    const p = passage();
    const qs = p.questions || [];
    const done = qs.every((q, i) => session.answers[i] != null);
    return `
      <p class="muted small">Ask each question. Questions with choices can be answered by the learner on the phone.</p>
      <div class="list">${qs.map((q, i) => {
        const a = session.answers[i];
        const hasChoices = q.choices && q.choices.length && q.answer != null;
        return `<div class="qcard" data-i="${i}">
          <div class="qhead"><span class="qn">${i + 1}</span><span class="qt">${esc(q.type || '')}</span></div>
          <p class="qtext">${esc(q.text)}</p>
          ${hasChoices ? `<div class="choices">${q.choices.map((c, k) => `<button class="choice" type="button" data-act="choose" data-i="${i}" data-k="${k}" aria-pressed="${session.picks[i] === k}">${'abcd'[k]}. ${esc(c)}</button>`).join('')}</div>`
          : `${q.expected ? `<p class="expected">Expected: ${esc(q.expected)}</p>` : ''}
            <div class="row2"><button class="btn ok" type="button" data-act="answer" data-i="${i}" data-v="1" aria-pressed="${a === true}">✔ Correct</button>
            <button class="btn bad" type="button" data-act="answer" data-i="${i}" data-v="0" aria-pressed="${a === false}">✘ Wrong</button></div>`}
        </div>`;
      }).join('')}</div>
      <button class="btn primary big" type="button" data-act="finish"${done ? '' : ' disabled'}>See the result</button>`;
  };

  // ---------- result ----------
  function saveOral() {
    const p = passage(), l = learner(), c = cls();
    const s = scored();
    const words = session.words.length;
    const time = Math.max(1, Math.round((session.endAt - session.startAt) / 1000));
    const qs = p.questions || [];
    const compTotal = qs.length, compCorrect = session.answers.filter(a => a === true).length;
    const wordPct = words ? Math.round(((words - s.miscues) / words) * 1000) / 10 : null;
    const compPct = compTotal ? Math.round((compCorrect / compTotal) * 1000) / 10 : null;
    const wordLevel = Align.level(wordPct, rules().word), compLevel = compTotal ? Align.level(compPct, rules().comp) : null;
    const r = {
      id: 'r' + Date.now().toString(36), type: 'oral', learnerId: l.id, learnerName: l.name, classId: c && c.id, period: db.period, language: ui.lang,
      passageId: p.id, passageTitle: p.title, grade: p.grade, set: p.set, mode: session.mode,
      words, miscues: s.miscues, byKind: s.byKind, time, wpm: Math.round(words / (time / 60)), wordPct, wordLevel,
      compCorrect: compTotal ? compCorrect : null, compTotal: compTotal || null, compPct, compLevel,
      level: combine(wordLevel, compLevel), assessedAt: new Date().toISOString(),
    };
    db.results.push(r); persist();
    session.saved = r;
  }
  SCREENS.result = () => {
    const r = session.saved;
    const lvl = (x) => x ? `<span class="chip ${LVL_CLASS[x]}">${x}</span>` : '<span class="chip">–</span>';
    return `
      <div class="result-hero ${LVL_CLASS[r.level] || ''}">
        <span class="muted">${esc(r.learnerName)} · ${esc(r.language)} · Grade ${esc(r.grade || '?')} ${r.set ? 'Set ' + esc(r.set) : ''}</span>
        <b>${esc(r.level || '–')}</b>
        <span class="muted small">Saved on this phone</span>
      </div>
      <div class="card rows">
        <div><span>Word reading</span><b>${r.wordPct}%</b>${lvl(r.wordLevel)}</div>
        <div><span>Comprehension</span><b>${r.compTotal ? `${r.compCorrect}/${r.compTotal} · ${r.compPct}%` : 'no questions'}</b>${lvl(r.compLevel)}</div>
        <div><span>Miscues</span><b>${r.miscues} of ${r.words} words</b><span></span></div>
        <div><span>Reading time</span><b>${fmtTime(r.time)} · ${r.wpm} wpm</b><span></span></div>
      </div>
      ${Object.keys(r.byKind).length ? `<p class="muted small">${Object.entries(r.byKind).map(([k, v]) => `${Align.KIND_LABEL[k] || k}: ${v}`).join(' · ')}</p>` : ''}
      <button class="btn primary big" type="button" data-act="next-learner">Next learner</button>
      <button class="btn quiet" type="button" data-act="home">Back to start</button>`;
  };

  // ---------- GST ----------
  SCREENS.gstread = () => {
    const p = passage();
    return `
      <article class="passage-read" lang="${ui.lang === 'Filipino' ? 'fil' : 'en'}"><h2>${esc(p.title)}</h2>${esc(p.text).split(/\n\s*\n/).map(x => `<p>${x}</p>`).join('')}</article>
      <div class="dock"><div class="dock-info"><span class="muted">Read the story, then answer the questions.</span></div>
        <button class="btn primary" type="button" data-act="gst-questions">${ui.lang === 'Filipino' ? 'Tapos na akong magbasa' : 'I am done reading'}</button></div>`;
  };
  SCREENS.gstq = () => {
    const p = passage();
    const qs = p.questions.filter(q => q.choices && q.choices.length && q.answer != null);
    const i = session.qi;
    const q = qs[i];
    return `
      <div class="gst-progress"><span style="width:${Math.round((i / qs.length) * 100)}%"></span></div>
      <p class="muted small center">${ui.lang === 'Filipino' ? 'Tanong' : 'Question'} ${i + 1} / ${qs.length}</p>
      <p class="gst-q">${esc(q.text)}</p>
      <div class="choices big">${q.choices.map((c, k) => `<button class="choice" type="button" data-act="gst-pick" data-k="${k}">${'abcd'[k]}. ${esc(c)}</button>`).join('')}</div>
      <button class="btn quiet small" type="button" data-act="gst-look">${ui.lang === 'Filipino' ? 'Tingnan muli ang kuwento' : 'Look at the story again'}</button>
      <div class="peek" id="peek" hidden>${esc(p.text).split(/\n\s*\n/).map(x => `<p>${x}</p>`).join('')}</div>`;
  };
  SCREENS.gstresult = () => {
    const r = session.saved;
    return `
      <div class="result-hero ${r.needsOral ? 'f' : 'i'}">
        <span class="muted">${esc(r.learnerName)} · ${esc(r.language)} · ${esc(r.passageTitle)}</span>
        <b>${r.gst} / ${r.gstTotal}</b>
        <span>${r.needsOral ? 'Below the cut-off: give the oral reading test.' : 'At or above the cut-off.'}</span>
      </div>
      <p class="muted small center">Cut-off: ${r.gstCutPct}% correct (${Math.ceil(r.gstTotal * r.gstCutPct / 100)} of ${r.gstTotal}). Change it in Settings. Saved on this phone.</p>
      <button class="btn primary big" type="button" data-act="next-learner">Next learner</button>
      ${r.needsOral ? '<button class="btn" type="button" data-act="oral-now">Give the oral reading test now</button>' : ''}
      <button class="btn quiet" type="button" data-act="home">Back to start</button>`;
  };

  // ---------- results ----------
  SCREENS.results = () => {
    const list = db.results.filter(r => r.period === db.period).sort((a, b) => b.assessedAt.localeCompare(a.assessedAt));
    const row = r => `<div class="result-row">
      <div><b>${esc(r.learnerName)}</b><span class="muted small">${esc(r.language)} · ${r.type === 'gst' ? 'GST' : 'Oral'} · ${esc(r.passageTitle)} · ${new Date(r.assessedAt).toLocaleDateString()}</span></div>
      ${r.type === 'gst' ? `<span class="chip ${r.needsOral ? 'f' : 'i'}">${r.gst}/${r.gstTotal}</span>` : `<span class="chip ${LVL_CLASS[r.level] || ''}">${esc(r.level || '–')}</span>`}
      <button class="icon-btn small" type="button" data-act="del-result" data-id="${r.id}" aria-label="Delete">✕</button></div>`;
    return `
      <div class="period">${seg('period', PERIODS, db.period)}</div>
      <button class="btn primary big" type="button" data-act="send"${db.results.length ? '' : ' disabled'}>Send results to the laptop</button>
      <p class="muted small">Makes one file with every result on this phone. Send it to the laptop (Bluetooth, Nearby Share, Messenger, Drive or USB), then in Phil-IRI Recorder choose <i>More › Bring in results from the phone</i>.${db.sentAt ? ` Last sent ${new Date(db.sentAt).toLocaleString()}.` : ''}</p>
      <h3>${esc(db.period)} · ${list.length}</h3>
      ${list.length ? `<div class="list">${list.map(row).join('')}</div>` : '<div class="card empty">No results yet for this period.</div>'}`;
  };

  // ---------- settings ----------
  SCREENS.settings = () => {
    const st = db.settings;
    return `
      <div class="card stack">
        <h3>While reading</h3>
        <label class="field"><span>Marking</span><select id="set-mode"><option value="listen"${st.mode === 'listen' ? ' selected' : ''}>The phone listens and marks</option><option value="tap"${st.mode === 'tap' ? ' selected' : ''}>I tap the miscues myself</option></select></label>
        <label class="check"><input type="checkbox" id="set-marks"${st.showMarks ? ' checked' : ''}> Show the colours to the learner while reading</label>
      </div>
      <div class="card stack">
        <h3>Speech recognition</h3>
        <label class="field"><span>English</span><select id="set-sp-en">${['en-PH', 'en-US', 'en-GB'].map(v => `<option${st.speech.English === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Filipino</span><select id="set-sp-fil">${['fil-PH', 'tl-PH'].map(v => `<option${st.speech.Filipino === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <p class="muted small">To work without internet, download the offline speech languages on the phone: Settings › Google › Voice (or Speech) › Offline speech recognition › English (Philippines) and Filipino, if listed. Without them, Android may use Google’s online service to turn speech into words; this app still records no voice.</p>
      </div>
      <div class="card stack">
        <h3>Counted as miscues</h3>
        ${Object.keys(Align.COUNTED_DEFAULT).map(k => `<label class="check"><input type="checkbox" data-count="${k}"${st.counted[k] !== false ? ' checked' : ''}> ${Align.KIND_LABEL[k]}</label>`).join('')}
        <p class="muted small">Follow the current Phil-IRI manual. Self-corrections are usually not counted.</p>
      </div>
      <div class="card stack">
        <h3>Group Screening Test</h3>
        <label class="field"><span>Cut-off, % correct (below this, give the oral test)</span><input type="number" id="set-cut" min="0" max="100" value="${esc(st.gstCutPct)}"></label>
        <p class="muted small">70% is 14 of 20 items. Follow the current Phil-IRI guidelines.</p>
      </div>
      <div class="card stack">
        <h3>Scoring rules (from the laptop file)</h3>
        <p class="small">Word reading: Independent ${rules().word.indep}%+, Instructional ${rules().word.inst}%+. Comprehension: Independent ${rules().comp.indep}%+, Instructional ${rules().comp.inst}%+.</p>
      </div>
      <button class="btn danger" type="button" data-act="erase">Erase everything on this phone</button>
      <p class="muted small center">Phil-IRI Reader 0.1 · no voice is recorded</p>`;
  };

  // ================= events =================
  document.addEventListener('click', async (e) => {
    const sb = e.target.closest('.seg[data-seg] button');
    if (sb) {
      const name = sb.parentElement.dataset.seg, v = sb.dataset.v;
      if (name === 'period') { db.period = v; persist(); }
      else if (name === 'lang') ui.lang = v;
      else if (name === 'mode') { session.mode = v; db.settings.mode = v; persist(); }
      render(); return;
    }
    const w = e.target.closest('.passage-read .w, .passage-mini .w');
    if (w && session && (ui.screen === 'read' ? session.started : ui.screen === 'check')) {
      const j = +w.dataset.j;
      const cur = w.dataset.s;
      session.marks[j] = cur === 'miscue' ? { status: 'correct', kind: null } : { status: 'miscue', kind: (session.marks[j] && session.marks[j].kind) || 'mispronunciation' };
      if (ui.screen === 'check') render(); else paintWords();
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'back') { history.back(); return; }
    if (act === 'home') { session = null; go('home'); return; }
    if (act === 'settings') { go('settings'); return; }
    if (act === 'results') { go('results'); return; }
    if (act === 'sample') { loadPack(JSON.parse(JSON.stringify(window.SAMPLE_PACK))); render(); toast('Sample class loaded. Open your real file later.'); return; }
    if (act === 'start') { ui.test = b.dataset.test; go('learners'); return; }
    if (act === 'pick-learner') { ui.learnerId = b.dataset.id; go('passages'); return; }
    if (act === 'pick-passage') {
      ui.passageId = b.dataset.id;
      const p = passage();
      session = { mode: db.settings.mode, words: wordsOf(p), heard: '', marks: {}, extraMarks: {}, answers: [], picks: [], started: false };
      if (ui.test === 'gst') { session.qi = 0; session.gstAnswers = []; go('gstread'); }
      else go('ready');
      return;
    }
    if (act === 'noise') {
      const msg = $('#noise-msg'); msg.textContent = 'Listening… stay quiet.';
      const lvl = await Listen.noiseCheck(3000, x => { const bar = $('#meter-bar'); if (bar) bar.style.width = x + '%'; });
      if (lvl == null) msg.textContent = 'The microphone could not be opened here. You can still start.';
      else msg.textContent = lvl < 35 ? 'Quiet enough. 👍' : lvl < 55 ? 'A little noisy. A headset will help.' : 'Too noisy. Please move to a quieter place.';
      return;
    }
    if (act === 'practice') {
      const msg = $('#practice-msg'); msg.textContent = 'Listening…';
      let heard = '';
      const l = Listen.create({ lang: db.settings.speech[ui.lang], onText: t => { heard = t; msg.textContent = 'Heard: “' + t + '”'; }, onError: m => { msg.textContent = m; } });
      if (await l.start()) setTimeout(async () => { await l.stop(); msg.textContent = heard ? `Heard: “${heard}” ✔ The phone can hear the learner.` : 'Nothing was heard. Check the headset and the microphone permission.'; }, 4000);
      return;
    }
    if (act === 'begin') { go('read'); return; }
    if (act === 'go') { await startReading(); return; }
    if (act === 'done') { await finishReading(); return; }
    if (act === 'mark') {
      const j = +b.dataset.j;
      session.marks[j] = { status: b.dataset.s, kind: b.dataset.s === 'miscue' ? (scored().words[j].kind === 'notheard' ? 'omission' : (scored().words[j].kind || 'mispronunciation')) : null };
      render(); return;
    }
    if (act === 'all-correct') { scored().words.forEach((w, j) => { if (w.status === 'unsure' || w.status === 'unread') session.marks[j] = { status: 'correct', kind: null }; }); render(); return; }
    if (act === 'to-questions') { if ((passage().questions || []).length) go('questions'); else { saveOral(); go('result', true); } return; }
    if (act === 'answer') { session.answers[+b.dataset.i] = b.dataset.v === '1'; render(); return; }
    if (act === 'choose') {
      const i = +b.dataset.i, k = +b.dataset.k, q = passage().questions[i];
      session.picks[i] = k; session.answers[i] = k === q.answer; render(); return;
    }
    if (act === 'finish') { saveOral(); go('result', true); return; }
    if (act === 'next-learner') { session = null; go('learners'); return; }
    if (act === 'oral-now') { ui.test = 'oral'; session = null; go('passages'); return; }
    if (act === 'gst-questions') { go('gstq', true); return; }
    if (act === 'gst-look') { const pk = $('#peek'); pk.hidden = !pk.hidden; return; }
    if (act === 'gst-pick') {
      const p = passage();
      const qs = p.questions.filter(q => q.choices && q.choices.length && q.answer != null);
      session.gstAnswers[session.qi] = +b.dataset.k;
      if (session.qi + 1 < qs.length) { session.qi++; render(); window.scrollTo(0, 0); return; }
      const score = qs.reduce((a, q, i) => a + (session.gstAnswers[i] === q.answer ? 1 : 0), 0);
      const l = learner(), c = cls();
      const r = {
        id: 'r' + Date.now().toString(36), type: 'gst', learnerId: l.id, learnerName: l.name, classId: c && c.id, period: db.period, language: ui.lang,
        passageId: p.id, passageTitle: p.title, grade: p.grade, set: p.set, gst: score, gstTotal: qs.length, gstCutPct: +db.settings.gstCutPct,
        needsOral: (score / qs.length) * 100 < +db.settings.gstCutPct, answers: session.gstAnswers.slice(), assessedAt: new Date().toISOString(),
      };
      db.results.push(r); persist(); session.saved = r;
      go('gstresult', true); return;
    }
    if (act === 'send') {
      const out = { app: 'phil-iri-reader', kind: 'results', version: 1, sentAt: new Date().toISOString(), sy: P() && P().sy, school: P() && P().school, results: db.results };
      try {
        await shareFile(`phil-iri-results-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out, null, 1));
        db.sentAt = out.sentAt; persist(); render();
      } catch (err) { if (!/cancel/i.test(String(err && err.message))) toast('The file could not be shared: ' + (err.message || err)); }
      return;
    }
    if (act === 'del-result') {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Delete?'; setTimeout(() => { b.dataset.armed = ''; b.textContent = '✕'; }, 3000); return; }
      db.results = db.results.filter(r => r.id !== b.dataset.id); persist(); render(); return;
    }
    if (act === 'erase') {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again to erase everything'; return; }
      db = blank(); persist(); session = null; go('home'); return;
    }
  });

  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'pack-file' && t.files[0]) {
      try { loadPack(JSON.parse(await t.files[0].text())); render(); toast(`Opened: ${P().passages.length} passages, ${P().classes.reduce((a, c) => a + c.learners.length, 0)} learners.`); }
      catch (err) { toast(err.message || 'That file could not be opened.', 6000); }
      t.value = ''; return;
    }
    if (t.id === 'class-pick') { ui.classId = t.value; render(); return; }
    if (t.id === 'all-grades') { ui.allGrades = t.checked; render(); return; }
    if (t.dataset.kind != null) { const j = +t.dataset.kind; session.marks[j] = { status: 'miscue', kind: t.value }; return; }
    if (t.dataset.extra != null) { session.extraMarks[+t.dataset.extra] = t.checked ? 'count' : 'ignore'; render(); return; }
    const st = db.settings;
    if (t.id === 'set-mode') st.mode = t.value;
    else if (t.id === 'set-marks') st.showMarks = t.checked;
    else if (t.id === 'set-sp-en') st.speech.English = t.value;
    else if (t.id === 'set-sp-fil') st.speech.Filipino = t.value;
    else if (t.id === 'set-cut') st.gstCutPct = Math.min(100, Math.max(0, +t.value || 0));
    else if (t.dataset.count) st.counted[t.dataset.count] = t.checked;
    else return;
    persist();
  });

  // test hook: lets automated tests and demos feed "heard" words
  window.PhilIriReader = { simulate: text => Listen.simulate(text), state: () => db };

  try { history.replaceState({ screen: 'home' }, ''); } catch (e) { /* ignore */ }
  render();
})();
