# Phil-IRI Recorder

A desktop app for teachers to record **Phil-IRI** results for **BOSY, MOSY and EOSY**
and print them on the **DepEd templates exactly as they are**, even when the
templates change every school year.

## How it works

1. **Import the DepEd template** (`.xlsx`). The app reads every sheet and works
   out where things go: school and header details, the learner table (including
   separate male and female tables), "Put 1" level columns, struggling and
   non-reader columns, and count tables for grade-level and school summaries.
2. **Check the highlighted cells once.** Green means sure; amber means please
   check. Click any cell to change what goes there, then mark the sheet as checked.
3. **Enter classes, learners and reading results.** English and Filipino are
   recorded separately.
4. **Print forms.** The app writes your data into a copy of the original DepEd
   file and saves it as Excel. Everything else (logo, fonts, borders, merged
   cells, formulas) is left untouched, so the printout matches the template.

Next year, import the new template and your data flows into the new layout.

## Try it

| Way | How |
|---|---|
| Windows app | Download from the **Actions** tab → latest *Build Windows app* run → *Phil-IRI-Recorder-Windows* (Setup or Portable `.exe`). |
| Single file, no install | Download [`dist/phil-iri-recorder.html`](dist/phil-iri-recorder.html) and open it in Chrome or Edge. Data stays in that browser; use *Save backup*. |
| From source | `npm install` then `npm start` (needs Node.js 20+). |

The app opens with **sample data** and a sample template so you can try it
right away. Use *Clear sample data and start* when you are ready.

## What it supports now

- Excel templates (`.xlsx`). Old `.xls` files: open in Excel and *Save As* `.xlsx`.
- Class lists, grade-level summaries, school summaries, and per-learner records
  (one file per learner, saved as a `.zip`).
- More learners than rows: the form is saved as several pages.
- Page setup when saving: fit to page width, orientation and paper size
  (A4, Letter, Long/Folio, Legal).
- Backups, and **Add a colleague's classes** so a grade chair or coordinator can
  combine teachers' data for summaries.

Not yet: Word (`.docx`) and PDF templates. See [docs/DESIGN.md](docs/DESIGN.md).

## Project layout

```
app/            the app (plain HTML/CSS/JS, runs offline)
  js/xlsx.js    reads, previews and fills .xlsx files without rebuilding them
  js/detect.js  finds fields and tables in a template
  js/data.js    classes, learners, results, and turning them into cell values
  js/app.js     screens
electron/       desktop shell (save dialog, open in Excel)
samples/        sample templates and the DepEd JHS template used for testing
tools/build.mjs builds dist/phil-iri-recorder.html and app/js/samples.js
```

After changing anything in `app/` or `samples/`, run `node tools/build.mjs`.
