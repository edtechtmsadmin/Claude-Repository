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
| `app/js/data.js` | State, IndexedDB storage, learners/results, turning data into cell writes (`buildWrites`), importing learners from an already filled form |
| `app/js/app.js` | Screens: Fill in forms (form tabs, type on the form, optional table view, Print, Save), Settings (school, classes, backup), Adjust (manual mapping) |
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

## Links from the first conversation

- Branch: `claude/kind-cori-6fpq9x` in `edtechtmsadmin/Claude-Repository`
- Test page: https://claude.ai/artifact/WvcHuH5ehohiDJTzAWsHtC
