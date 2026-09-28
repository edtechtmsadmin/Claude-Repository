# Phil-IRI Recorder — Desktop App Design

A desktop app for recording Phil-IRI results at BOSY, MOSY and EOSY (beginning,
middle and end of school year) that keeps working when DepEd changes the form
templates each year.

## 1. The core problem and the core idea

DepEd changes the Phil-IRI forms (layout, columns, header fields, wording) from
year to year. If the app has the forms "built in", it breaks every year.

**Core idea: the app never redraws the form. It fills in the real DepEd file.**

- The imported DepEd template (usually an Excel `.xlsx`) *is* the design. The app
  keeps it untouched and only writes values into the right cells.
- Because the original file is what gets printed, the printout matches DepEd's
  layout, fonts, borders, merged cells, logos and page setup exactly.
- Learner data is stored separately from any template. When next year's template
  arrives, the same data flows into the new layout, so there is no re-encoding.

```
 DepEd template (.xlsx) ──► Template Reader ──► Field Map (saved per template)
                                                    │
 Learner data (database) ───────────────────────────┤
                                                    ▼
                                    Filler (writes values into a copy)
                                                    │
                                   Preview (PDF) ◄──┴──► Print / Save .xlsx / .pdf
```

## 2. What the app does (user's view)

1. **Import a template.** Drag in the DepEd file. The app scans it and shows the
   form exactly as it looks, with the fields it recognized highlighted:
   green = sure, yellow = unsure, red = not found.
2. **Confirm the mapping (once per template).** Click a yellow or red spot and
   pick what belongs there ("Learner name", "Sex", "Oral reading score", and so
   on). The confirmed mapping is saved as a *template profile*, for example
   "Phil-IRI Class Reading Profile, SY 2026–2027". You never do this again for
   that template.
3. **Encode data.** Use a simple spreadsheet-like screen per class and per
   period (BOSY, MOSY or EOSY): learner list, test scores, and so on. The app
   computes derived values (percentages, reading level) automatically.
4. **Preview and print.** Pick a template and a class, then Preview. You see the
   actual DepEd form filled in. Print it, or save it as `.xlsx` or `.pdf` for
   submission.
5. **New school year.** Import the new template, confirm the mapping, done.
   Past years' records stay intact and printable in their original templates.

## 3. Main screens

| Screen | Purpose |
|---|---|
| **Dashboard** | School year and period selector, classes, completion status (e.g. "Grade 4 – Sampaguita: MOSY 32/38 encoded"). |
| **Learners** | Class list: LRN, name, sex, grade, section. Import from SF1 or an Excel class list so names are typed once. |
| **Assessment entry** | Grid per class × period: GST score, passage used, word reading miscues, words, reading time, comprehension answers. Auto-computes rates and levels. Keyboard-first (Tab/Enter), like Excel. |
| **Templates** | Import, view and map DepEd templates; list of saved profiles by school year. |
| **Template mapper** | The form rendered as-is. Click a cell to assign a field. Mark the table area where learner rows go. |
| **Reports** | Choose template + class + period, then Preview / Print / Export. Batch mode: all classes at once. |
| **Settings** | School info (name, ID, district, division, principal, coordinator), reading-level rules, backups. |

## 4. How "smart reading" of a template works

Templates are made of two kinds of things, and the reader looks for both:

**A. Single fields** such as School, District, Grade & Section, Teacher, School
Year, Date, and signature names.

- Scan every cell for label text and fuzzy-match it against a synonym dictionary.
  For example `school_name` matches "Name of School", "School", "Paaralan".
- The value goes in the cell right of the label, the merged range beside it, or
  the underlined blank below it. The reader checks those positions in order.

**B. Learner tables** where one row = one learner.

- Find a row where several cells match known column headers (No., Name of
  Learner, Sex, GST Score, Frustration / Instructional / Independent, …).
- Handle two-row and merged headers, e.g. "ORAL READING" spanning "English" and
  "Filipino" sub-columns. The reader combines parent and child text before
  matching.
- The data area starts below the header and ends at the first footer marker
  ("TOTAL", "Prepared by:", "Noted:", a signature line) or a styling break.
- Capacity is how many learner rows the table holds.

**C. Things the reader must not touch.**

- Cells that already contain formulas (e.g. totals and counts per level). The
  app leaves them, so the template's own math still works.
- Logos, images, headers and footers, print areas, page breaks and column widths.
  These are preserved automatically (see §5).

**Confidence and learning.** Every guess gets a score. Anything below the
threshold is shown yellow for the user to confirm. Confirmed label → field
pairs are added to the local synonym dictionary, so each new year's template
needs fewer corrections.

**Tick-box style columns.** Some Phil-IRI forms mark the level with a ✓ under
Frustration / Instructional / Independent instead of writing the word. The
mapping supports a "choice" field: *put a mark in column X when level =
Independent*. The mark character is configurable (✓, /, x, 1).

## 5. Filling and printing "exactly as it is"

This is the most important technical decision.

**Do not load and re-save the workbook with a general Excel library.** Libraries
like openpyxl and ExcelJS drop or alter things they don't fully support (images,
shapes, some conditional formatting, data validation, print settings). That is
exactly the "it doesn't look the same" problem.

**Instead, edit the file surgically.** An `.xlsx` is a zip of XML files. The
filler:

1. copies the original template,
2. opens only the sheet XML parts it needs,
3. writes values into the mapped cells (keeping each cell's existing style),
4. leaves every other byte of the package unchanged, and
5. marks the workbook to recalculate formulas on open.

Result: the output is the DepEd file with values typed in, as if a teacher had
done it by hand.

**When there are more learners than rows:**

- *Option 1 (default):* make extra copies of the sheet ("Page 2", "Page 3") and
  continue numbering. The layout is preserved exactly.
- *Option 2:* insert rows by cloning the last data row's formatting. This is
  riskier with merged cells and page breaks, so the user must turn it on.

**Preview and print.** The app converts the filled `.xlsx` to PDF using a
bundled LibreOffice (headless). If Microsoft Excel is installed and the user
prefers it, the app uses Excel instead for the highest fidelity. The preview
shows that same PDF, so **what you see in the preview is exactly what prints.**
Printing sends the PDF to the chosen printer. The template's paper size
(A4, Letter or Legal), orientation and margins are respected.

**Word and PDF templates.** If DepEd releases a form as `.docx`, the same idea
applies: the reader finds labels and table rows in the document XML and fills
them. For a PDF-only form, the app lets the user place fields on top of the
page (a click-to-place overlay) and prints the PDF with the values drawn in.
Excel is the main target because Phil-IRI summary forms are usually
distributed as spreadsheets.

## 6. Data model (template-independent)

Data is stored in a local SQLite database, one file per school, easy to back up.

```
school            (id, name, school_id, district, division, region, principal, coordinator)
school_year       (id, label e.g. "2026-2027")
class             (id, school_year_id, grade, section, adviser)
learner           (id, lrn, last_name, first_name, middle_name, sex, birthdate)
enrollment        (learner_id, class_id)
assessment        (id, learner_id, class_id, period [BOSY|MOSY|EOSY],
                   language [English|Filipino], date_tested,
                   gst_score, gst_total,
                   passage_grade_level, passage_set,
                   words_in_passage, miscues, reading_time_seconds,
                   comprehension_correct, comprehension_total,
                   -- computed, stored for reporting:
                   word_reading_pct, comprehension_pct, reading_rate_wpm,
                   word_reading_level, comprehension_level, overall_level,
                   remarks)
template          (id, name, school_year_id, source_file_hash, original_file)
template_field    (template_id, field_key, sheet, cell_or_range, kind [single|column|choice],
                   choice_value, confidence, confirmed)
template_table    (template_id, sheet, first_data_row, last_data_row, overflow_mode)
```

The `field_key` values (`learner.full_name`, `assessment.overall_level`,
`school.name`, and so on) are the bridge between data and any template. A
template maps field keys to cells. The data never knows about cells.

**Computed fields as formulas.** Things like "full name, surname first" or
"count of Frustration readers, Grade 4, female" are defined once as named
computations. A template that has a "Total Frustration – Female" cell simply
maps to that computation.

## 7. Reading-level rules are configurable too

The classification thresholds can also change between Phil-IRI editions, so they
are settings, not code. The shipped defaults follow the Phil-IRI manual in use
and can be edited in Settings.

| Level | Word reading | Comprehension |
|---|---|---|
| Independent | 97–100% | 80–100% |
| Instructional | 90–96% | 59–79% |
| Frustration | 89% and below | 58% and below |

(Check these against the current DepEd manual before release. The rule for
combining the word-reading and comprehension levels into one overall level is
also a setting.)

## 8. Recommended technology

| Part | Choice | Why |
|---|---|---|
| App shell / UI | **Electron + React + TypeScript** (alternative: Tauri for a smaller installer) | Runs on the Windows laptops teachers commonly use; a rich grid UI is easy to build. |
| Data entry grid | AG Grid Community or Handsontable (non-commercial licence check) | Excel-like typing experience. |
| Database | SQLite (`better-sqlite3`) | Offline, single file, zero setup. |
| Template reading | Parse `.xlsx` XML directly (`fflate`/`jszip` + an XML parser); read-only use of ExcelJS/SheetJS is fine for analysis | Full access to merged cells, styles and formulas. |
| Template filling | Surgical XML edits (§5) | Preserves the layout exactly. |
| XLSX → PDF | Bundled LibreOffice headless; Excel via COM when available | Accurate rendering for preview and print. |
| PDF preview | pdf.js | Preview identical to printout. |
| Installer / updates | electron-builder (NSIS) | One-click Windows install. |

Everything works **offline**. No internet is needed at school.

## 9. Year-over-year workflow

```
New SY template arrives
        │
        ▼
Import ──► auto-map (most fields green thanks to the learned synonyms)
        │
        ▼
Fix the few yellow/red spots ──► Save profile "SY 2027-2028"
        │
        ▼
Roll over: carry learners to the new SY / next grade (optional)
        │
        ▼
Encode BOSY ──► print. MOSY ──► print. EOSY ──► print.
```

Old profiles are never deleted, so a 2026 report can always be reprinted in the
2026 form.

## 10. Extras worth having

- **Import class list** from SF1 or any Excel list (with the same auto column
  detection).
- **Comparison view**: BOSY → MOSY → EOSY progress per learner and per class,
  such as how many moved out of Frustration.
- **Validation** before printing: missing scores, impossible values (more
  miscues than words), learners without a period record.
- **Backup / restore**: one click to a USB drive or Google Drive folder.
- **Share template profiles**: export a profile as a small file so one
  coordinator maps the new template and every teacher imports the profile.
  This saves a lot of time for a whole school or division.

## 11. Build plan (milestones)

1. **Proof of concept (most important, do first):** take a real DepEd Phil-IRI
   `.xlsx`, fill 40 fake learners by surgical XML edit, convert to PDF, and
   compare the result side by side with the original. If this looks identical,
   the whole approach is proven.
2. Data entry: school, classes, learners, assessments, and computed levels.
3. Template mapper UI (manual mapping first).
4. Auto-detection (labels, tables, merged headers, confidence scores).
5. Preview, print, export, and batch printing.
6. Overflow handling, `.docx` support, profile sharing, backups.
7. Installer, and a pilot with a few teachers using the current year's forms.

## 12. Open questions for you

- Which file types do you receive from DepEd: Excel, Word, PDF, or a mix?
  Please share one or two real templates (this year's and last year's) so the
  reader can be tuned to them.
- Who uses the app: each teacher on their own laptop, or one reading
  coordinator for the whole school?
- Which forms must it print: the Class Reading Profile, the School Reading
  Profile, the Individual Reading Record, or all of them?
- Is English and Filipino testing done in the same period, and printed on the
  same form or on separate forms?

## 13. What the first real template taught us (SY 2025-2026 JHS SDO template)

The first real template (`samples/phil-iri-jhs-sdo-template.xlsx`) changed a few
assumptions, and the app now handles all of these:

- One workbook holds six forms: Class, Grade Level and School summaries, each in
  Filipino and English. The language comes from the sheet name or title.
- Class summaries list **males and females in separate tables** ("TOTAL MALE",
  "TOTAL FEMALE"), with levels marked by **"Put 1"** columns so the template's own
  `SUM` totals work. The mark is therefore the number `1`, not a check mark.
- Header values often live **inside text**: `GRADE _____`, `(DISTRICT)`,
  `(SCHOOL ID - SCHOOL NAME)`, `SCHOOL YEAR 2025-2026`, `(MIDYEAR)`. The app
  fills blanks, replaces placeholders, and swaps the year and period words.
- Grade Level and School summaries are **count tables** (rows = sections or
  grade levels; M/F columns under each level, "Independent in Grade N",
  struggling and non-readers). Total columns are formulas and are never touched.
- The data needed per learner is smaller than first planned: reading level, the
  grade level where the learner is independent, and the struggling reader and
  non-reader flags. Raw oral-reading scores are optional (scoring helper).
- The template has no print setup, so it spills over several pages. Saving
  offers "fit to page width", orientation and paper size.
