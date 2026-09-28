# Phil-IRI Reader (phone app)

Android app for the Phil-IRI oral reading test and Group Screening Test (GST).
It works with the Phil-IRI Recorder desktop app in this repository.

**Status:** the source code is complete and tested in a browser, using simulated speech. The Android project (`android/`) has
**not** been generated or built yet, because the app is still being updated.

## How it works

1. On the laptop, go to Passages › Phone app › *Save file for the phone*. This makes
   `phil-iri-phone-<SY>.json`, which holds the passages, their exact word lists,
   the questions, the class lists and the scoring rules.
2. Open that file in the phone app. You can also start with the built-in sample class.
3. **Oral reading:** pick a learner and a passage. There is a warm-up (headset, noise
   check, practice sentence), then the learner reads.
   - The phone listens with speech recognition. It records no voice.
   - `www/js/align.js` lines up the heard words with the passage while the learner reads:
     - green = correct
     - red = miscue (substitution, omission)
     - yellow = the teacher must check it (possible mispronunciation, a short word not heard, words not heard at the end)
   - Insertions, repetitions, self-corrections and fillers are found between words.
   - It stops by itself after the last word, or when the teacher presses Done.
   - **Tap mode:** the teacher taps the miscues instead of the phone listening.
4. **Check screen:** the teacher confirms the yellow words, can change or undo a
   miscue, and chooses whether to count each extra word.
5. **Questions:** questions with choices are answered by the learner on the phone and
   checked automatically. The teacher marks the other questions ✔ or ✘ (the expected
   answer is shown).
6. **Result:** word reading %, comprehension %, time and wpm. The levels use the
   rules from the laptop file, combined as "lower of the two" by default.
7. **GST:** the learner reads and answers multiple-choice questions one at a time.
   The score is compared with a cut-off in % (default 70% = 14 of 20).
8. **Results › Send results to the laptop:** makes `phil-iri-results-<date>.json`.
   - The phone shares it through Android's share sheet; the browser downloads it.
   - On the laptop, go to More › *Bring in results from the phone*. The level, words,
     miscues, time, comprehension and GST score go into the learner's entries.

## Files

| Path | What it does |
|---|---|
| `www/index.html`, `www/styles.css`, `www/fonts*` | Page, look (same colours and glass style as the desktop app), bundled Lexend font |
| `www/js/align.js` | Follows the reading: word alignment and miscue types, scoring, levels. Works in Node too |
| `www/js/listen.js` | Speech: Android plugin (Capacitor), browser Web Speech, or `?simulate` for tests. Restarts after pauses. Noise check |
| `www/js/app.js` | Screens and flow, storage (localStorage), results file, back button |
| `www/js/sample.js` | Made-up sample class and passages (not DepEd material) |
| `tests/align.test.mjs` | `node tests/align.test.mjs`: 17 checks of the reading engine |
| `package.json`, `capacitor.config.json` | Capacitor 8 project settings (not installed yet) |

## Try it in a browser

Serve the repository folder, for example with `npx http-server -p 8765 .`, then open:
- `http://localhost:8765/phone/www/index.html` uses the browser's speech recognition. It needs Chrome and internet.
- `http://localhost:8765/phone/www/index.html?simulate` uses no microphone. In the console, type
  `PhilIriReader.simulate('mia found a small puppy')` to "read" words.

## Building the Android app (later)

You need Node 22, JDK 21 and the Android SDK. Run these in `phone/`:

```
npm install
npx cap add android          # creates android/ (commit it afterwards)
```

In `android/app/src/main/AndroidManifest.xml`, add:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<queries>
  <intent><action android:name="android.speech.RecognitionService" /></intent>
</queries>
```

Then build:

```
npm run apk                  # android/app/build/outputs/apk/debug/app-debug.apk
```

## Open points for the next update

- Test on real phones with children's voices, in English and Filipino.
  - Tune the thresholds in `align.js`: `SURE` 0.85, `CLOSE` 0.5.
  - Check how well Filipino works offline. The offline speech pack for Filipino may not exist on every phone.
- Keep short sound clips of the yellow words only until the teacher checks them. This needs
  a native plugin; Android's SpeechRecognizer does not give the audio.
- Transfer by QR code or Wi-Fi instead of files.
- Confirm the GST cut-off, the miscue types counted and the level rules against the current DepEd memo.
