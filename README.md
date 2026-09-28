# Phil-IRI Recorder

A desktop app for teachers to record **Phil-IRI** results for **BOSY, MOSY and EOSY**
and print them on the **DepEd templates exactly as they are**, even when the
templates change every school year.

## How it works

1. **Upload the form** (`.xlsx`), blank or already filled in.
2. **Type into the table that appears.** It has the same columns as the form
   (for example Test Taken, Literal, Inferential, Applied/Critical, Total Score,
   Score < 27, or the Independent / Instructional / Frustration "Put 1" columns).
   Totals and "Score < 27 / ≥ 28" ticks fill themselves. Names and scores can be
   pasted from Excel. A filled form's learners and entries can be brought in
   with one click.
3. **Save as Excel file** (or *Open in Excel to print* in the desktop app). The
   app writes into a copy of the original form, so logos, fonts, borders,
   merged cells and formulas stay exactly as DepEd made them.

Learners are kept per class for the whole school year, so they are typed once
and reused for BOSY, MOSY, EOSY and every form. Next year, upload the new form
and keep going. *My forms › Adjust* is there only if something lands in the
wrong cell.

## Try it

| Way | How |
|---|---|
| Windows app | Download from the **Actions** tab → latest *Build Windows app* run → *Phil-IRI-Recorder-Windows* (Setup or Portable `.exe`). |
| Single file, no install | Download [`dist/phil-iri-recorder.html`](dist/phil-iri-recorder.html) and open it in Chrome or Edge. Data stays in that browser; use *Save backup*. |
| From source | `npm install` then `npm start` (needs Node.js 20+). |

The first screen asks for a form. There are two sample forms to try if you
don't have one at hand.

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
