# Handover: Phil-IRI Recorder

Read this first when continuing the project in a new conversation.

## What the app is for

A Windows desktop app (also runs in a browser) for teachers recording Phil-IRI
results for BOSY, MOSY and EOSY. DepEd changes the form templates every year,
so the app must:

1. read any uploaded DepEd Excel template and show it on screen exactly as it
   looks in Excel (same layout, pages and page breaks);
2. let the teacher type directly on it (names, scores, ticks) with smart help
   (totals, row numbers, threshold ticks, header details);
3. save and print a result that looks the same as the uploaded template.

The users are non-technical teachers, each on their own laptop. Keep the UI
simple: one screen, one tab per form, no set-up steps.

## Decision (latest): the app is a consolidator

After many rounds trying to draw forms on screen exactly like Excel, the
teacher chose Option 2: the app reads the uploaded template, the teacher enters
data in a simple table, and the app saves the uploaded template itself filled
in. Printing is done from Excel. There is no on-screen imitation of the form in
the main flow any more (the drawing code in xlsx.js is only used by "Adjust").
The UI was redesigned (Lexend, school blue + pencil yellow, cards, stat strip).
Next planned: move from Electron to Tauri for a much smaller app (5-15 MB);
automation of names/data from other sources is a future update.
Templates change every year: never hard-code a layout; everything comes from
detect.js. `samples/phil-iri-jhs-sdo-template-v2.xlsx` is a second, differently
laid out version of the JHS template (33 male rows) used to check that.

## How it works (key idea)

The app never rebuilds the workbook. `app/js/xlsx.js` edits only the target
`<c>` cells inside the original `.xlsx`, so logos, borders, merges, fonts,
formulas and print settings stay as DepEd made them. Learner data is stored
separately from templates, so it carries over to next year's template.

## Files

| Path | What it does |
|---|---|
| `app/index.html`, `app/styles.css` | Page shell and styles (top bar, tabs, printed-page view, print CSS) |
| `app/js/xlsx.js` | Reads .xlsx (styles, theme colours, merges, images, shared formulas, page setup), draws sheets as HTML, splits into printed pages (`paginate`, `renderPages`, `effectivePage`), on-screen formula evaluator (`computeFormulas`), surgical fill (`fillWorkbook`) |
| `app/js/detect.js` | Works out each sheet: header fields (label: value, ____ blanks, (PLACEHOLDER), year/period/language words, Pre-Test/Post Test tick slots, signature lines), learner tables (male/female parts, "Put 1" columns, own columns like GST Literal/Inferential/Total/Score < 27), count tables (grade/school summaries), one-learner forms |
| `app/js/data.js` | State, IndexedDB storage, learners/results, turning data into cell writes (`buildWrites`), importing learners from an already filled form, reading passages (word list, phone file) |
| `app/js/doctext.js` | Text out of PDF (pdf.js), Word .docx and .txt for passages; refuses pictures and scanned PDFs |
| `app/vendor/` | JSZip, pdf.js 3.11 (+ worker, Apache-2.0 licence) |
| `app/js/app.js` | Screens: Fill in forms (pill tabs, controls row, entry table, details card, Save menu: whole file / only this form), Settings (school, classes, backup), Adjust (manual mapping). The older type-on-form/preview code is still there but unused |
| `electron/` | Desktop shell: save dialog, "Open in Excel" |
| `tools/build.mjs` | Builds `dist/phil-iri-recorder.html` (single offline file) and `app/js/samples.js` |
| `samples/` | Test templates: real DepEd JHS SDO template, GST sample rebuilt from a screenshot, sample A/B |
| `docs/DESIGN.md` | Original design and lessons from the real template |
| `.github/workflows/build-desktop.yml` | Builds the Windows installer and portable .exe on GitHub |

## Build and run

```
npm install              # once
npm start                # desktop app from source
node tools/build.mjs     # after any change in app/ or samples/
npx electron-builder --win portable --x64 --publish never   # portable .exe in dist-electron/
```

## Status (end of first conversation)

Working and tested (headless Chromium + LibreOffice checks):
- Upload -> each sheet is a tab; INSTRUCTION-type sheets hidden.
- Screen shows real printed pages (paper, orientation, margins, scale, fit,
  page breaks, page numbers). Default keeps the form's own print settings.
- Typing on the form for every sheet. Class forms: typing a name on an empty
  row adds a learner; scores go into learner data; totals and Score < 27 /
  >= 28 ticks fill themselves; tick columns toggle with a click.
- One-learner forms: learner picker, "Save all learners (.zip)".
- Already filled forms: "Bring them in" imports learners and entries.
- Save as Excel (original template + values), Print button (desktop and plain
  browsers), backups, colleague data merge for summaries.

Open issues / next steps:
1. The teacher's real file `GST Phil IRI Report Templates.xlsx` (sheets
   INSTRUCTION, Form 1A, 1B, 1C, 2A, 2B, 2C; Filipino versions like
   "TALAAN NG PANGKATANG PAGTATASA NG KLASE (TPPK)") has NOT been received.
   Ask for it to be attached in the chat and tune detection and page layout
   against it. Forms 1C, 2A, 2B, 2C were "Not a form" before the fallback.
2. The last screenshot (Form 1B) showed the form small in a corner over 7
   pages; fixed by computing the printed range from visible cells and
   keeping the form's own print setup. Needs confirming on the real file.
3. The on-screen page is the app's own drawing; fonts may differ slightly
   from Excel. Compare against Excel File > Print preview on Windows.
4. Word (.docx) and PDF templates are not supported yet.
5. Right-aligned text does not spill leftwards into empty cells yet.

## Status (end of second conversation): consolidator version

Main screen now (all tested in headless Chromium with both JHS templates):
- Compact top bar: brand, file switcher, and the actions (Save filled file,
  Excel on desktop, More menu, Settings). Pill-shaped form tabs; the selected
  tab glows.
- One controls row: class/grade, period (BOSY/MOSY/EOSY), language
  (English/Filipino), and small stat chips.
- The Language switch is remembered for each form (`m.language`). It is guessed
  from the sheet name, the title, or the amount of Filipino wording.
- Class forms show a simple entry table (add a name, then tap a reading level).
  Header details sit in a collapsible "details" card that opens by itself when
  something is still missing.
- **Save filled file** opens a small menu:
  - *Whole file* (`saveWholeFile`): every usable sheet is filled into ONE
    workbook with the same sheet names and the same file name as the uploaded
    template. Each sheet uses its own language.
  - *Only this form* (`saveForm`): just the sheet on screen.
- Printing is done from Excel. The page setup default keeps the template's own
  print settings. The More menu can still force fit/orientation/paper.
- Glassmorphism look: frosted, see-through panels (top bar, cards, controls,
  tabs, menus) over a soft blue/yellow/teal colour wash. This is the "glass"
  section at the end of `app/styles.css`. It falls back to solid panels when
  blur is unsupported or the user asks for reduced transparency.
- Light and dark themes, Lexend font. There is no horizontal scroll at phone
  width.

### Reading passages (preparation for the phone app)

"Passages" button in the top bar opens `viewPassages()` in `app/js/app.js`.
- Passages are kept in `state.passages`, so they go into backups too. Each
  passage has: `{id, language: 'Filipino'|'English', grade, set: A–D,
  type: 'oral'|'gst', title, text, questions[{id, type: Literal|Inferential|Critical,
  text, choices[4], answer (index), expected}]}`.
- Ways to bring text in: type it, paste it ("Fix line breaks" joins lines wrapped
  by a page), or bring in a PDF / Word .docx / .txt file (`app/js/doctext.js`).
  - The PDF reader is pdf.js 3.11 (`app/vendor/pdf.min.js`). Its worker is
    kept as text in the page and started only when a PDF is opened.
  - For a PDF the teacher picks the pages, then trims the text.
  - Lone page numbers are dropped, and a short first line becomes the title.
  - Pictures and scanned PDFs (no text) are refused on purpose. So are old
    .doc files, with a message to save them as .docx or PDF.
- "Phone app › Save passages file for the phone" saves
  `phil-iri-passages-<SY>.json`, made by `Data.passagePack`. Its fields are
  `{app, kind:'passages', version:1, school, sy, passages[{..., text, words[], wordCount,
  questions[{number, type, text, choices[], answer, expected}]}]}`.
  - `words` is the exact word list (`Data.passageWords`: apostrophes and
    hyphens stay inside a word, e.g. "mag-aaral"). The phone app should use it
    as-is when it follows the reading.
  - The same file can be brought back in (`Data.importPassages`: the same id
    replaces the passage, new ids are added).
- Plan for the phone app (from the discussion):
  - It follows the reading live on the phone and saves only the results, not
    the voice.
  - Speech recognition is guided by the passage.
  - Each word gets a traffic light (green sure, red miscue, yellow "please
    check"), followed by a quick check screen for the teacher.
  - It keeps short clips of the unsure words only until the teacher checks
    them.
  - Before the test: a warm-up sentence and a noise check.
  - Results are sent back to this desktop app.

Next steps:
1. Test with the teacher's GST / other templates when they are sent.
2. Move from Electron to Tauri for a much smaller download.
3. Future: automatic names/data from other sources (e.g. SF1).
4. The portable .exe was NOT rebuilt after the redesign (long build). Rebuild it
   with the electron-builder command above, or through the GitHub workflow.

## How to continue in a new conversation

Attach the project zip and say: "Continue the Phil-IRI Recorder project. Read
HANDOFF.md first."

## Links from the first conversation

- Branch: `claude/kind-cori-6fpq9x` in `edtechtmsadmin/Claude-Repository`
- Test page: https://claude.ai/artifact/WvcHuH5ehohiDJTzAWsHtC
