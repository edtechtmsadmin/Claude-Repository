/* Phil-IRI Reader - listening.
 *
 * Turns the learner's voice into words while they read, and nothing else:
 * no sound is recorded or kept by this app. Words arrive live; the app
 * compares them with the passage (align.js) and throws the sound away.
 *
 *   Android app   -> Android speech recognition (Capacitor plugin). Works
 *                    offline when the phone has the offline speech pack for
 *                    the language.
 *   Web browser   -> the browser's speech recognition (for trying the app).
 *   Test / demo   -> Listen.simulate(text) feeds words by hand.
 *
 * Recognisers stop after a pause, and children pause a lot, so listening is
 * restarted until the teacher presses Done.
 */
(function (global) {
  'use strict';

  let capSR = null;
  function cap() {
    const C = global.Capacitor;
    if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
    if (!capSR) capSR = C.registerPlugin ? C.registerPlugin('SpeechRecognition') : (C.Plugins && C.Plugins.SpeechRecognition);
    return capSR;
  }
  // "?simulate" in the address: no microphone, words come from Listen.simulate() (tests, demos)
  const simulated = () => { try { return /[?&]simulate\b/.test(global.location.search); } catch (e) { return false; } };
  const WebSR = () => !simulated() && (global.SpeechRecognition || global.webkitSpeechRecognition);
  let simTarget = null;

  function kind() { return simulated() ? 'simulated' : cap() ? 'android' : WebSR() ? 'browser' : 'none'; }

  /** opts: {lang, onText(fullText), onState('listening'|'paused'|'stopped'), onError(message)} */
  function create(opts) {
    let running = false, committed = '', current = '';
    const emit = () => opts.onText((committed + ' ' + current).trim());
    const err = (m) => opts.onError && opts.onError(m);
    let api = null;

    // test / demo hook: Listen.simulate('words heard')
    const sim = { add(text) { if (!running) return; committed = (committed + ' ' + text).trim(); emit(); } };

    if (!simulated() && cap()) {
      const SR = cap();
      let handles = [];
      const listenOnce = async () => {
        try {
          await SR.start({ language: opts.lang, maxResults: 1, partialResults: true, popup: false, prompt: '' });
          opts.onState && opts.onState('listening');
        } catch (e) {
          // "No match" / "busy" happen during pauses; try again while reading
          if (running) setTimeout(listenOnce, 300);
        }
      };
      api = {
        async start() {
          const perm = await SR.requestPermissions().catch(() => null);
          if (perm && perm.speechRecognition && perm.speechRecognition !== 'granted') { err('Please allow the microphone for Phil-IRI Reader.'); return false; }
          const av = await SR.available().catch(() => ({ available: false }));
          if (!av.available) { err('Speech recognition is not available on this phone. Use Tap mode.'); return false; }
          running = true; committed = ''; current = '';
          handles.push(await SR.addListener('partialResults', d => { if (d && d.matches && d.matches[0] != null) { current = d.matches[0]; emit(); } }));
          handles.push(await SR.addListener('listeningState', d => {
            if (d && d.status === 'stopped') {
              if (current) { committed = (committed + ' ' + current).trim(); current = ''; }
              opts.onState && opts.onState('paused');
              if (running) setTimeout(listenOnce, 150);
            }
          }));
          simTarget = sim;
          await listenOnce();
          return true;
        },
        async stop() {
          running = false;
          try { await SR.stop(); } catch (e) { /* already stopped */ }
          for (const h of handles) { try { await h.remove(); } catch (e) { /* ignore */ } }
          handles = [];
          if (current) { committed = (committed + ' ' + current).trim(); current = ''; }
          emit();
          opts.onState && opts.onState('stopped');
          simTarget = null;
        },
      };
    } else if (WebSR()) {
      let rec = null, sessionText = '';
      const open = () => {
        rec = new (WebSR())();
        rec.lang = opts.lang; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
        rec.onresult = (e) => {
          let t = '';
          for (let i = 0; i < e.results.length; i++) t += ' ' + e.results[i][0].transcript;
          sessionText = t.trim(); current = sessionText; emit();
        };
        rec.onerror = (e) => {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { running = false; err('Please allow the microphone for this page.'); }
          else if (e.error === 'network') err('The browser needs internet for speech. The Android app can work offline.');
        };
        rec.onend = () => {
          committed = (committed + ' ' + sessionText).trim(); sessionText = ''; current = '';
          if (running) { opts.onState && opts.onState('paused'); try { open(); } catch (e) { running = false; } }
        };
        rec.start();
        opts.onState && opts.onState('listening');
      };
      api = {
        async start() { running = true; committed = ''; current = ''; simTarget = sim; try { open(); } catch (e) { err('Speech recognition could not start.'); return false; } return true; },
        async stop() { running = false; try { rec && rec.stop(); } catch (e) { /* ignore */ } committed = (committed + ' ' + current).trim(); current = ''; emit(); opts.onState && opts.onState('stopped'); simTarget = null; },
      };
    } else {
      api = {
        async start() { running = true; committed = ''; current = ''; simTarget = sim; opts.onState && opts.onState('listening'); return true; },
        async stop() { running = false; emit(); opts.onState && opts.onState('stopped'); simTarget = null; },
      };
    }
    return api;
  }

  // loudness of the room for a few seconds, before the test (0-100); the microphone is released after
  async function noiseCheck(ms = 2500, onLevel) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } }); }
    catch (e) { return null; }
    const ctx = new (global.AudioContext || global.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
    const buf = new Float32Array(an.fftSize);
    const levels = [];
    const t0 = Date.now();
    await new Promise(done => {
      const tick = () => {
        an.getFloatTimeDomainData(buf);
        let sum = 0; for (const v of buf) sum += v * v;
        const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9);
        const lvl = Math.max(0, Math.min(100, Math.round((db + 70) * 1.6)));
        levels.push(lvl); onLevel && onLevel(lvl);
        if (Date.now() - t0 < ms) setTimeout(tick, 80); else done();
      };
      tick();
    });
    stream.getTracks().forEach(t => t.stop());
    ctx.close();
    levels.sort((a, b) => a - b);
    return levels[Math.floor(levels.length * 0.8)] || 0;
  }

  global.Listen = { create, kind, noiseCheck, simulate: (text) => simTarget && simTarget.add(text) };
})(typeof window !== 'undefined' ? window : globalThis);
