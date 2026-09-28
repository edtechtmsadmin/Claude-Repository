"""Build two sample reading-profile templates for testing the app.

They imitate the kind of layout change that happens between school years:
different header wording, column order, one-row vs two-row headers, and
tick-box vs written reading levels. They are test files, not official forms.

    pip install openpyxl
    python samples/make_samples.py
"""
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

OUT = Path(__file__).parent
thin = Side(style="thin", color="000000")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
UNDER = Border(bottom=thin)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
HEAD_FILL = PatternFill("solid", fgColor="D9E2F3")


def box(ws, rng, fill=None, bold=False, align=CENTER):
    for row in ws[rng]:
        for c in row:
            c.border = BOX
            c.alignment = align
            if fill:
                c.fill = fill
            if bold:
                c.font = Font(name="Arial", size=9, bold=True)


def page_setup(ws, landscape=True):
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = "landscape" if landscape else "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = ws.page_margins.right = 0.4


def sample_a():
    """Class summary: male and female tables, "Put 1" level columns."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Fil Class Summary"
    widths = [7, 34, 13, 13, 13, 16, 18, 18]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    f = Font(name="Arial", size=9)
    top = [("A1", "SAMPLE TEMPLATE A (for testing only)", Font(name="Arial", size=8, italic=True, color="7F7F7F")),
           ("A3", "(DISTRICT)", Font(name="Arial", size=10)),
           ("A4", "(SCHOOL ID - SCHOOL NAME)", Font(name="Arial", size=10)),
           ("A6", "PHIL-IRI CLASS READING SUMMARY", Font(name="Arial", size=11, bold=True)),
           ("A7", "CLASS SUMMARY OF READING LEVELS IN FILIPINO (MIDYEAR)", Font(name="Arial", size=12, bold=True)),
           ("A8", "GRADE _____", Font(name="Arial", size=11, bold=True)),
           ("A9", "SCHOOL YEAR 2025-2026", Font(name="Arial", size=9, bold=True))]
    for ref, text, font in top:
        r = ref[1:]
        ws.merge_cells(f"A{r}:H{r}")
        ws[ref] = text
        ws[ref].font = font
        ws[ref].alignment = Alignment(horizontal="center")
    ws["A1"].alignment = Alignment(horizontal="left")
    ws["A11"] = "SECTION :"
    ws["E11"] = "Assessor:"
    ws.merge_cells("F11:H11")
    for c in "FGH":
        ws[f"{c}11"].border = UNDER
    ws["B12"] = "ENROLMENT:  Male: _____"
    ws["C12"] = "Female: _____"
    ws["D12"] = "Total: _____"
    ws["F12"] = "(Designation)"
    for ref in ("A11", "E11", "B12", "C12", "D12"):
        ws[ref].font = Font(name="Arial", size=9, bold=True)

    heads = [("A14:A16", "No."), ("B14:B16", "Name of Learners"), ("C14:E14", "Grade ____ Level Text"),
             ("C15:E15", "(Put 1 in the column that shows the level of the learner)"),
             ("F14:F16", "Grade Level Text where the learner is Independent"),
             ("G14:G16", "Put 1 if the learner is a Struggling Reader"),
             ("H14:H16", "Put 1 if the learner is a Non-Reader")]
    for rng, text in heads:
        ws.merge_cells(rng)
        ws[rng.split(":")[0]] = text
    for i, text in enumerate(["INDEPENDENT", "INSTRUCTIONAL", "FRUSTRATION"]):
        ws.cell(row=16, column=3 + i, value=text)
    box(ws, "A14:H16", fill=HEAD_FILL, bold=True)
    ws.row_dimensions[15].height = 26

    def part(first, label):
        last = first + 19
        for r in range(first, last + 1):
            ws.cell(row=r, column=1, value=r - first + 1)
        box(ws, f"A{first}:H{last}")
        for r in range(first, last + 1):
            for c in range(1, 9):
                ws.cell(row=r, column=c).font = f
            ws.cell(row=r, column=2).alignment = Alignment(horizontal="left", vertical="center")
        t = last + 1
        ws.merge_cells(f"A{t}:B{t}")
        ws[f"A{t}"] = label
        for col in "CDEGH":
            ws[f"{col}{t}"] = f"=SUM({col}{first}:{col}{last})"
        box(ws, f"A{t}:H{t}", fill=PatternFill("solid", fgColor="E2EFDA"), bold=True)
        return t

    t1 = part(17, "TOTAL MALE")
    ws.row_dimensions[t1 + 1].height = 5
    box(ws, f"A{t1 + 1}:H{t1 + 1}")
    t2 = part(t1 + 2, "TOTAL FEMALE")
    s = t2 + 3
    ws[f"B{s}"] = "Prepared by:"
    ws[f"B{s + 2}"].border = UNDER
    ws[f"B{s + 3}"] = "Class Adviser"
    ws[f"F{s}"] = "Noted:"
    ws.merge_cells(f"F{s + 2}:H{s + 2}")
    for c in "FGH":
        ws[f"{c}{s + 2}"].border = UNDER
    ws[f"F{s + 3}"] = "School Head"
    page_setup(ws, landscape=False)
    wb.save(OUT / "sample-template-A.xlsx")


def sample_b():
    """A 'next year' layout: one list, LRN and sex columns, level written out."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Form 3"
    widths = [6, 16, 34, 10, 18, 16, 12, 12, 22]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    f = Font(name="Calibri", size=10)
    ws["A1"] = "SAMPLE TEMPLATE B (for testing only)"
    ws["A1"].font = Font(size=8, italic=True, color="7F7F7F")
    ws.merge_cells("A2:I2")
    ws["A2"] = "PROFILE OF READERS PER CLASS - ENGLISH"
    ws["A2"].font = Font(size=13, bold=True)
    ws["A2"].alignment = CENTER

    ws["A4"] = "Name of School: ______________________________"
    ws["F4"] = "School ID:"
    ws["A5"] = "Grade Level:"
    ws["D5"] = "Section:"
    ws["F5"] = "Name of Teacher:"
    ws["A6"] = "School Year:"
    ws["D6"] = "Assessment Period:"
    for ref in ("G4", "B5", "E5", "G5", "B6", "E6"):
        ws[ref].border = UNDER
    for ref in ("A4", "F4", "A5", "D5", "F5", "A6", "D6"):
        ws[ref].font = Font(size=10, bold=True)
    ws.merge_cells("G4:H4")
    ws.merge_cells("G5:I5")

    heads = ["#", "LRN", "Pangalan (Name)", "Kasarian", "Reading Profile",
             "Independent Level", "Struggling Reader (check)", "Non-Reader (check)", "Interventions / Remarks"]
    for i, h in enumerate(heads, 1):
        ws.cell(row=8, column=i, value=h)
    box(ws, "A8:I8", fill=PatternFill("solid", fgColor="E2EFDA"), bold=True)
    ws.row_dimensions[8].height = 32
    first, last = 9, 48
    box(ws, f"A{first}:I{last}")
    for r in range(first, last + 1):
        for c in range(1, 10):
            ws.cell(row=r, column=c).font = f
        ws.cell(row=r, column=3).alignment = Alignment(horizontal="left", vertical="center")

    s = last + 2
    ws[f"A{s}"] = "Certified correct:"
    ws[f"A{s}"].font = Font(size=10, bold=True)
    ws.merge_cells(f"C{s + 2}:D{s + 2}")
    for c in "CD":
        ws[f"{c}{s + 2}"].border = UNDER
    ws[f"C{s + 3}"] = "Reading Coordinator"
    page_setup(ws, landscape=True)
    wb.save(OUT / "sample-template-B.xlsx")


def sample_gst(filled=False):
    """GST class profile laid out like Phil-IRI Form 1A (from a teacher's screenshot)."""
    wb = Workbook()
    ws = wb.active
    ws.title = "GST English"
    widths = [6, 34, 10, 9, 11, 11, 11, 9, 9]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws["I1"] = "Sample Phil-IRI Form 1A (for testing only)"
    ws["I1"].font = Font(size=7, italic=True)
    ws["I1"].alignment = Alignment(horizontal="right")
    for r, text, bold in [(3, "Republika ng Pilipinas", True), (4, "Kagawaran ng Edukasyon", True), (5, "Rehiyon V", False),
                          (6, "TANGGAPAN NG MGA PAARALANG PANSANGAY", True)]:
        ws.merge_cells(f"A{r}:I{r}")
        ws[f"A{r}"] = text
        ws[f"A{r}"].font = Font(name="Arial", size=9, bold=bold)
        ws[f"A{r}"].alignment = Alignment(horizontal="center")
    ws.merge_cells("A8:I8")
    ws["A8"] = "CLASS GROUP SCREENING TEST (GST) PROFILE IN ENGLISH"
    box(ws, "A8:I8", fill=PatternFill("solid", fgColor="C6E0B4"), bold=True)
    bold = Font(name="Arial", size=8, bold=True)
    vals = {"A9": "School: " + ("Sample National High School" if filled else ""),
            "F9": "District: " + ("Sample District" if filled else ""),
            "A10": "Grade & Section: " + ("12-A" if filled else ""),
            "F10": "Teacher: " + ("JUAN D. SANTOS" if filled else ""),
            "A11": "____Pre-Test ____ Post Test (\u221a appropriately)",
            "F11": "Date of Assessment: " + ("June 9, 2026" if filled else "")}
    for ref, text in vals.items():
        ws[ref] = text.rstrip() if not filled else text
        ws[ref].font = bold
    ws.merge_cells("A9:E9"); ws.merge_cells("A10:E10"); ws.merge_cells("A11:C11")
    box(ws, "A11:C11", bold=True, align=Alignment(horizontal="left"))
    heads = [("A13:A14", "No."), ("B13:B14", "Name"), ("C13", "Test Taken"), ("C14", "(\u221a or X)"),
             ("D13:F13", "Number of Correct Responses"), ("D14", "Literal"), ("E14", "Inferential"),
             ("F14", "Applied / Critical"), ("G13:G14", "Total Score"), ("H13", "Score < 27"), ("H14", "(\u221a)"),
             ("I13", "Score >/= 28"), ("I14", "(\u221a)")]
    for rng, text in heads:
        if ":" in rng:
            ws.merge_cells(rng)
        ws[rng.split(":")[0]] = text
    box(ws, "A13:I14", bold=True)
    ws.row_dimensions[14].height = 24
    first, last = 15, 64
    box(ws, f"A{first}:I{last}")
    f = Font(name="Arial", size=8)
    names = ["ABAD, CARLO M.", "CASTILLO, MARK D.", "ESTRADA, JOHN PAUL L.", "GARCIA, MIGUEL T.",
             "BAUTISTA, LIZA R.", "DELA CRUZ, ANGELA P.", "FERNANDEZ, KRISTINE G."]
    scores = [(7, 10, 10), (5, 7, 9), (7, 9, 10), (6, 13, 9), (6, 11, 12), (7, 13, 8), (6, 9, 6)]
    for r in range(first, last + 1):
        ws.cell(row=r, column=1, value=r - first + 1)
        for c in range(1, 10):
            ws.cell(row=r, column=c).font = f
            ws.cell(row=r, column=c).alignment = Alignment(horizontal="left" if c == 2 else "center")
    if filled:
        for i, (n, sc) in enumerate(zip(names, scores)):
            r = first + i
            ws.cell(row=r, column=2, value=n)
            ws.cell(row=r, column=3, value=1)
            for j, v in enumerate(sc):
                ws.cell(row=r, column=4 + j, value=v)
            t = sum(sc)
            ws.cell(row=r, column=7, value=t)
            ws.cell(row=r, column=8 if t <= 27 else 9, value=1)
    s = last + 3
    ws[f"B{s}"] = "Prepared by:"
    ws.merge_cells(f"C{s + 2}:E{s + 2}")
    for c in "CDE":
        ws[f"{c}{s + 2}"].border = UNDER
    ws[f"C{s + 3}"] = "Teacher"
    page_setup(ws, landscape=False)
    wb.save(OUT / ("sample-template-GST-filled.xlsx" if filled else "sample-template-GST.xlsx"))


if __name__ == "__main__":
    sample_a()
    sample_b()
    sample_gst()
    sample_gst(filled=True)
    print("wrote", OUT / "sample-template-A.xlsx", OUT / "sample-template-B.xlsx")
