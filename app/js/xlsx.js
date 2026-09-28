/* Reading, rendering and filling .xlsx templates.
 *
 * The filler never rebuilds the workbook. It edits only the <c> elements it
 * writes to, inside the sheet XML parts it touches, so logos, borders, merged
 * cells, print settings and formulas in the DepEd file stay exactly as they
 * were.
 */
(function (global) {
  'use strict';

  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
  const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

  const INDEXED = ('000000,FFFFFF,FF0000,00FF00,0000FF,FFFF00,FF00FF,00FFFF,000000,FFFFFF,FF0000,00FF00,0000FF,FFFF00,FF00FF,00FFFF,' +
    '800000,008000,000080,808000,800080,008080,C0C0C0,808080,9999FF,993366,FFFFCC,CCFFFF,660066,FF8080,0066CC,CCCCFF,' +
    '000080,FF00FF,FFFF00,00FFFF,800080,800000,008080,0000FF,00CCFF,CCFFFF,CCFFCC,FFFF99,99CCFF,FF99CC,CC99FF,FFCC99,' +
    '3366FF,33CCCC,99CC00,FFCC00,FF9900,FF6600,666699,969696,003366,339966,003300,333300,993300,993366,333399,333333').split(',');

  // ---------- cell references ----------
  function colToNum(s) { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
  function numToCol(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function parseRef(ref) { const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref); return m ? { c: colToNum(m[1]), r: +m[2] } : null; }
  function makeRef(r, c) { return numToCol(c) + r; }
  function parseRange(rng) { const [a, b] = rng.split(':'); const s = parseRef(a); const e = b ? parseRef(b) : s; return { r1: s.r, c1: s.c, r2: e.r, c2: e.c }; }

  const els = (node, name) => node ? Array.from(node.getElementsByTagNameNS(NS, name)) : [];
  const el = (node, name) => els(node, name)[0] || null;
  const kids = (node, name) => node ? Array.from(node.children).filter(n => n.localName === name) : [];
  const kid = (node, name) => kids(node, name)[0] || null;

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('This file has damaged XML inside.');
    return doc;
  }

  function resolvePath(base, target) {
    if (target.startsWith('/')) return target.slice(1);
    const parts = base.split('/'); parts.pop();
    for (const seg of target.split('/')) {
      if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  }
  function relsPathFor(partPath) {
    const i = partPath.lastIndexOf('/');
    return partPath.slice(0, i) + '/_rels/' + partPath.slice(i + 1) + '.rels';
  }
  async function readRels(zip, partPath) {
    const f = zip.file(relsPathFor(partPath));
    const map = {};
    if (!f) return map;
    const doc = parseXml(await f.async('string'));
    for (const r of Array.from(doc.getElementsByTagNameNS(NS_PKG, 'Relationship'))) {
      map[r.getAttribute('Id')] = { target: resolvePath(partPath, r.getAttribute('Target')), type: r.getAttribute('Type') || '' };
    }
    return map;
  }

  // ---------- colours ----------
  function tintHex(hex, tint) {
    if (!tint) return hex;
    let r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const f = v => tint < 0 ? Math.round(v * (1 + tint)) : Math.round(v + (255 - v) * tint);
    r = f(r); g = f(g); b = f(b);
    return [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  function readColor(node, theme) {
    if (!node) return null;
    let hex = null;
    if (node.getAttribute('rgb')) hex = node.getAttribute('rgb').slice(-6);
    else if (node.getAttribute('theme') != null) hex = theme[+node.getAttribute('theme')] || null;
    else if (node.getAttribute('indexed') != null) {
      const i = +node.getAttribute('indexed');
      if (i === 64) return null;
      hex = INDEXED[i] || null;
    }
    if (!hex) return null;
    return '#' + tintHex(hex, parseFloat(node.getAttribute('tint') || '0'));
  }

  async function readTheme(zip) {
    const f = zip.file('xl/theme/theme1.xml');
    const fallback = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
    if (!f) return fallback;
    const doc = parseXml(await f.async('string'));
    const scheme = doc.getElementsByTagNameNS(NS_A, 'clrScheme')[0];
    if (!scheme) return fallback;
    const get = name => {
      const n = scheme.getElementsByTagNameNS(NS_A, name)[0];
      if (!n) return null;
      const c = n.firstElementChild;
      if (!c) return null;
      return (c.getAttribute('lastClr') || c.getAttribute('val') || '').slice(-6) || null;
    };
    // theme index order used by cell colours: lt1, dk1, lt2, dk2, accent1..6
    return ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map((n, i) => get(n) || fallback[i]);
  }

  async function readStyles(zip, theme) {
    const out = { xfs: [], numFmts: {} };
    const f = zip.file('xl/styles.xml');
    if (!f) return out;
    const doc = parseXml(await f.async('string'));
    for (const n of els(doc, 'numFmt')) out.numFmts[n.getAttribute('numFmtId')] = n.getAttribute('formatCode');
    const fonts = els(el(doc, 'fonts'), 'font').map(fn => {
      const val = (name, attr = 'val') => { const k = kid(fn, name); return k ? (k.getAttribute(attr) ?? '1') : null; };
      const b = kid(fn, 'b'), i = kid(fn, 'i'), u = kid(fn, 'u'), strike = kid(fn, 'strike');
      const on = k => k && k.getAttribute('val') !== '0' && k.getAttribute('val') !== 'false';
      return {
        name: val('name'), size: parseFloat(val('sz') || '11'),
        bold: on(b), italic: on(i), underline: on(u), strike: on(strike),
        color: readColor(kid(fn, 'color'), theme),
      };
    });
    const fills = els(el(doc, 'fills'), 'fill').map(fl => {
      const p = kid(fl, 'patternFill');
      if (!p || !p.getAttribute('patternType') || p.getAttribute('patternType') === 'none') return null;
      return readColor(kid(p, 'fgColor'), theme) || readColor(kid(p, 'bgColor'), theme);
    });
    const borders = els(el(doc, 'borders'), 'border').map(bd => {
      const side = name => {
        const s = kid(bd, name);
        if (!s || !s.getAttribute('style')) return null;
        return { style: s.getAttribute('style'), color: readColor(kid(s, 'color'), theme) || '#000000' };
      };
      return { left: side('left') || side('start'), right: side('right') || side('end'), top: side('top'), bottom: side('bottom') };
    });
    const cellXfs = el(doc, 'cellXfs');
    out.xfs = kids(cellXfs, 'xf').map(x => {
      const al = kid(x, 'alignment');
      return {
        font: fonts[+(x.getAttribute('fontId') || 0)] || null,
        fill: fills[+(x.getAttribute('fillId') || 0)] || null,
        border: borders[+(x.getAttribute('borderId') || 0)] || null,
        numFmtId: x.getAttribute('numFmtId') || '0',
        h: al ? al.getAttribute('horizontal') : null,
        v: al ? al.getAttribute('vertical') : null,
        wrap: al ? al.getAttribute('wrapText') === '1' || al.getAttribute('wrapText') === 'true' : false,
        rotate: al ? +(al.getAttribute('textRotation') || 0) : 0,
        indent: al ? +(al.getAttribute('indent') || 0) : 0,
      };
    });
    out.defaultFont = fonts[0] || null;
    return out;
  }

  function stringItemText(si) {
    // all <t> that are not inside phonetic runs
    let s = '';
    for (const t of Array.from(si.getElementsByTagNameNS(NS, 't'))) {
      if (t.parentNode && t.parentNode.localName === 'rPh') continue;
      s += t.textContent;
    }
    return s;
  }

  async function readSharedStrings(zip) {
    const f = zip.file('xl/sharedStrings.xml');
    if (!f) return [];
    const doc = parseXml(await f.async('string'));
    return kids(doc.documentElement, 'si').map(stringItemText);
  }

  // ---------- number display ----------
  function formatNumber(v, fmtCode, fmtId) {
    const id = +fmtId;
    const code = fmtCode || '';
    if ((id >= 14 && id <= 22) || (/[dmy]/i.test(code) && !/[0#]/.test(code.replace(/\[.*?\]/g, '')))) {
      const d = new Date(Math.round((v - 25569) * 86400000));
      if (!isNaN(d)) return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
    }
    if (id === 9 || id === 10 || code.includes('%')) {
      const dec = id === 10 ? 2 : ((code.split('.')[1] || '').replace(/[^0]/g, '').length);
      return (v * 100).toFixed(dec) + '%';
    }
    if (id === 2 || id === 4 || /0\.0+/.test(code)) {
      const dec = id === 2 || id === 4 ? 2 : (code.split('.')[1] || '').replace(/[^0]/g, '').length;
      return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    }
    if (Number.isInteger(v)) return String(v);
    return String(Math.round(v * 1e6) / 1e6);
  }

  // move the relative references of a shared formula to another cell
  function shiftFormula(text, dr, dc) {
    return text.split('"').map((part, i) => i % 2 ? part : part.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(])/g, (m, cAbs, col, rAbs, row) =>
      (cAbs ? '$' + col : numToCol(colToNum(col) + dc)) + (rAbs ? '$' + row : String(+row + dr)))).join('"');
  }

  // ---------- workbook loading ----------
  async function loadWorkbook(buffer) {
    const zip = await global.JSZip.loadAsync(buffer);
    const wbFile = zip.file('xl/workbook.xml');
    if (!wbFile) throw new Error('This is not an Excel .xlsx workbook. If it is an old .xls file, open it in Excel and use File > Save As > Excel Workbook (.xlsx).');
    const wbDoc = parseXml(await wbFile.async('string'));
    const rels = await readRels(zip, 'xl/workbook.xml');
    const theme = await readTheme(zip);
    const styles = await readStyles(zip, theme);
    const sst = await readSharedStrings(zip);
    const printAreas = {};
    for (const dn of els(wbDoc, 'definedName')) {
      if (dn.getAttribute('name') === '_xlnm.Print_Area' && dn.getAttribute('localSheetId') != null) {
        const txt = dn.textContent.split(',')[0];
        const m = /!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/.exec(txt);
        if (m) printAreas[+dn.getAttribute('localSheetId')] = { r1: +m[2], c1: colToNum(m[1]), r2: +m[4], c2: colToNum(m[3]) };
      }
    }
    const sheetEls = els(wbDoc, 'sheet');
    const sheets = [];
    for (let i = 0; i < sheetEls.length; i++) {
      const s = sheetEls[i];
      const rid = s.getAttributeNS(NS_R, 'id') || s.getAttribute('r:id');
      const rel = rels[rid];
      if (!rel || !/worksheet$/.test(rel.type)) continue;
      const sheet = await readSheet(zip, rel.target, styles, sst);
      sheet.mdw = maxDigitWidth(styles.defaultFont);
      if (sheet.defaultColWidth == null) sheet.defaultColWidth = (sheet.baseColWidth || 8) + 5 / sheet.mdw;
      sheet.name = s.getAttribute('name');
      sheet.index = i;
      sheet.hidden = !!s.getAttribute('state') && s.getAttribute('state') !== 'visible';
      sheet.printArea = printAreas[i] || null;
      sheets.push(sheet);
    }
    return { zip, sheets, styles };
  }

  async function readSheet(zip, path, styles, sst) {
    const doc = parseXml(await zip.file(path).async('string'));
    const cells = new Map();
    const rowsInfo = {};
    const colsInfo = [];
    const fmtPr = el(doc, 'sheetFormatPr');
    const baseColWidth = fmtPr && fmtPr.getAttribute('baseColWidth') ? parseFloat(fmtPr.getAttribute('baseColWidth')) : 8;
    const defaultColWidth = fmtPr && fmtPr.getAttribute('defaultColWidth') ? parseFloat(fmtPr.getAttribute('defaultColWidth')) : null;
    const defaultRowHeight = fmtPr && fmtPr.getAttribute('defaultRowHeight') ? parseFloat(fmtPr.getAttribute('defaultRowHeight')) : 15;
    for (const c of els(el(doc, 'cols'), 'col')) {
      colsInfo.push({
        min: +c.getAttribute('min'), max: +c.getAttribute('max'),
        width: c.getAttribute('width') ? parseFloat(c.getAttribute('width')) : null,
        hidden: c.getAttribute('hidden') === '1', style: c.getAttribute('style'),
      });
    }
    let maxR = 0, maxC = 0;
    const shared = {};
    for (const row of els(el(doc, 'sheetData'), 'row')) {
      const r = +row.getAttribute('r');
      rowsInfo[r] = {
        ht: row.getAttribute('ht') ? parseFloat(row.getAttribute('ht')) : null,
        hidden: row.getAttribute('hidden') === '1',
        s: row.getAttribute('customFormat') === '1' ? row.getAttribute('s') : null,
      };
      for (const c of kids(row, 'c')) {
        const ref = c.getAttribute('r');
        const p = parseRef(ref);
        if (!p) continue;
        const t = c.getAttribute('t');
        const s = +(c.getAttribute('s') || 0);
        const f = kid(c, 'f');
        const v = kid(c, 'v');
        let value = null, type = 'blank';
        if (t === 's' && v) { value = sst[+v.textContent] ?? ''; type = 'string'; }
        else if (t === 'inlineStr') { const is = kid(c, 'is'); value = is ? stringItemText(is) : ''; type = 'string'; }
        else if (t === 'str') { value = v ? v.textContent : ''; type = 'string'; }
        else if (t === 'b') { value = v && v.textContent === '1' ? 'TRUE' : 'FALSE'; type = 'bool'; }
        else if (t === 'e') { value = v ? v.textContent : '#ERR'; type = 'error'; }
        else if (v && v.textContent !== '') { value = parseFloat(v.textContent); type = 'number'; }
        let formula = null;
        if (f) {
          formula = f.textContent || '(shared)';
          if (f.getAttribute('t') === 'shared' && f.getAttribute('si') != null) {
            const si = f.getAttribute('si');
            if (f.textContent) shared[si] = { text: f.textContent, r: p.r, c: p.c };
            else if (shared[si]) formula = shiftFormula(shared[si].text, p.r - shared[si].r, p.c - shared[si].c);
          }
        }
        cells.set(ref, { r: p.r, c: p.c, ref, s, value, type, formula });
        if (p.r > maxR) maxR = p.r;
        if (p.c > maxC) maxC = p.c;
      }
    }
    const merges = els(el(doc, 'mergeCells'), 'mergeCell').map(m => parseRange(m.getAttribute('ref')));
    for (const m of merges) { if (m.r2 > maxR) maxR = m.r2; if (m.c2 > maxC) maxC = m.c2; }

    const ps = el(doc, 'pageSetup');
    const pm = el(doc, 'pageMargins');
    const po = el(doc, 'printOptions');
    const spr = el(doc, 'pageSetUpPr');
    const brk = name => els(el(doc, name), 'brk').map(b => +b.getAttribute('id')).filter(n => n > 0);
    const num = (node, a, d) => node && node.getAttribute(a) != null && node.getAttribute(a) !== '' ? parseFloat(node.getAttribute(a)) : d;
    const page = {
      orientation: ps ? ps.getAttribute('orientation') || 'portrait' : 'portrait',
      paperSize: ps ? +(ps.getAttribute('paperSize') || 9) : 9,
      scale: num(ps, 'scale', 100),
      fitToPage: !!spr && (spr.getAttribute('fitToPage') === '1' || spr.getAttribute('fitToPage') === 'true'),
      fitToWidth: num(ps, 'fitToWidth', 1),
      fitToHeight: num(ps, 'fitToHeight', 1),
      margins: { left: num(pm, 'left', 0.7), right: num(pm, 'right', 0.7), top: num(pm, 'top', 0.75), bottom: num(pm, 'bottom', 0.75) },
      hCenter: !!po && po.getAttribute('horizontalCentered') === '1',
      vCenter: !!po && po.getAttribute('verticalCentered') === '1',
      rowBreaks: brk('rowBreaks'),
      colBreaks: brk('colBreaks'),
    };

    // pictures (logos) from the sheet's drawing part
    const images = [];
    const sheetRels = await readRels(zip, path);
    const drawingEl = el(doc, 'drawing');
    if (drawingEl) {
      const rel = sheetRels[drawingEl.getAttributeNS(NS_R, 'id')];
      if (rel && zip.file(rel.target)) {
        try {
          const ddoc = parseXml(await zip.file(rel.target).async('string'));
          const drels = await readRels(zip, rel.target);
          const anchors = [
            ...Array.from(ddoc.getElementsByTagNameNS(NS_XDR, 'twoCellAnchor')),
            ...Array.from(ddoc.getElementsByTagNameNS(NS_XDR, 'oneCellAnchor')),
          ];
          for (const a of anchors) {
            const blip = a.getElementsByTagNameNS(NS_A, 'blip')[0];
            if (!blip) continue;
            const target = drels[blip.getAttributeNS(NS_R, 'embed')];
            if (!target || !zip.file(target.target)) continue;
            const pos = n => n ? {
              col: +n.getElementsByTagNameNS(NS_XDR, 'col')[0].textContent,
              colOff: +n.getElementsByTagNameNS(NS_XDR, 'colOff')[0].textContent,
              row: +n.getElementsByTagNameNS(NS_XDR, 'row')[0].textContent,
              rowOff: +n.getElementsByTagNameNS(NS_XDR, 'rowOff')[0].textContent,
            } : null;
            const from = pos(a.getElementsByTagNameNS(NS_XDR, 'from')[0]);
            const to = pos(a.getElementsByTagNameNS(NS_XDR, 'to')[0]);
            const extEl = a.getElementsByTagNameNS(NS_A, 'ext');
            let ext = null;
            for (const e of Array.from(extEl)) if (e.getAttribute('cx')) { ext = { cx: +e.getAttribute('cx'), cy: +e.getAttribute('cy') }; break; }
            const xdrExt = a.getElementsByTagNameNS(NS_XDR, 'ext')[0];
            if (xdrExt) ext = { cx: +xdrExt.getAttribute('cx'), cy: +xdrExt.getAttribute('cy') };
            const bytes = await zip.file(target.target).async('base64');
            const extName = target.target.split('.').pop().toLowerCase();
            const mime = extName === 'jpg' || extName === 'jpeg' ? 'image/jpeg' : extName === 'gif' ? 'image/gif' : extName === 'emf' || extName === 'wmf' ? null : 'image/png';
            if (!mime) continue;
            images.push({ from, to, ext, src: `data:${mime};base64,${bytes}` });
            if (to && to.row + 1 > maxR) maxR = to.row + 1;
          }
        } catch (e) { /* a drawing we cannot read is skipped in the preview only */ }
      }
    }

    return {
      path, cells, merges, rowsInfo, colsInfo, defaultColWidth, baseColWidth, defaultRowHeight,
      maxR, maxC, page, images, styles,
    };
  }

  // ---------- sheet helpers ----------
  function mergeAt(sheet, r, c) {
    for (const m of sheet.merges) if (r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) return m;
    return null;
  }
  function cellText(sheet, r, c) {
    const cell = sheet.cells.get(makeRef(r, c));
    if (!cell || cell.value == null) return '';
    return typeof cell.value === 'number' ? formatNumber(cell.value, sheet.styles.numFmts[sheet.styles.xfs[cell.s]?.numFmtId], sheet.styles.xfs[cell.s]?.numFmtId) : String(cell.value);
  }
  function colWidthChars(sheet, c) {
    for (const ci of sheet.colsInfo) if (c >= ci.min && c <= ci.max) return ci.hidden ? 0 : (ci.width ?? sheet.defaultColWidth);
    return sheet.defaultColWidth;
  }
  // Excel measures column widths in digits of the workbook's normal font
  const colPx = (sheet, c) => {
    const w = colWidthChars(sheet, c);
    if (w === 0) return 0;
    const mdw = sheet.mdw || 7;
    return Math.floor(((256 * w + Math.floor(128 / mdw)) / 256) * mdw);
  };
  const mdwCache = {};
  function maxDigitWidth(font) {
    if (!font || typeof document === 'undefined') return 7;
    const px = Math.round((font.size || 11) * 96 / 72);
    const key = font.name + '|' + px;
    if (mdwCache[key]) return mdwCache[key];
    let w = 7;
    try {
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `${px}px '${(font.name || 'Calibri').replace(/'/g, '')}', Calibri, Carlito, Arial, sans-serif`;
      w = Math.max(...'0123456789'.split('').map(d => ctx.measureText(d).width));
      w = Math.round(w) || 7;
    } catch (e) { /* keep 7 */ }
    return (mdwCache[key] = w);
  }
  function rowPx(sheet, r) {
    const ri = sheet.rowsInfo[r];
    if (ri && ri.hidden) return 0;
    const pt = ri && ri.ht != null ? ri.ht : sheet.defaultRowHeight;
    return Math.round(pt * 4 / 3);
  }
  function styleOf(sheet, r, c) {
    const cell = sheet.cells.get(makeRef(r, c));
    if (cell) return sheet.styles.xfs[cell.s] || null;
    const ri = sheet.rowsInfo[r];
    if (ri && ri.s != null) return sheet.styles.xfs[+ri.s] || null;
    for (const ci of sheet.colsInfo) if (c >= ci.min && c <= ci.max && ci.style != null) return sheet.styles.xfs[+ci.style] || null;
    return null;
  }
  function hasBorder(sheet, r, c, side) {
    const st = styleOf(sheet, r, c);
    if (st && st.border && st.border[side]) return true;
    // neighbours may draw the shared edge
    if (side === 'bottom') { const s2 = styleOf(sheet, r + 1, c); return !!(s2 && s2.border && s2.border.top); }
    if (side === 'top' && r > 1) { const s2 = styleOf(sheet, r - 1, c); return !!(s2 && s2.border && s2.border.bottom); }
    return false;
  }

  // ---------- rendering ----------
  const BORDER_CSS = {
    thin: '1px solid', hair: '1px dotted', dotted: '1px dotted', dashed: '1px dashed', medium: '2px solid',
    mediumDashed: '2px dashed', thick: '3px solid', double: '3px double', dashDot: '1px dashed', mediumDashDot: '2px dashed',
    dashDotDot: '1px dashed', slantDashDot: '2px dashed', mediumDashDotDot: '2px dashed',
  };
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  /* Render a sheet as an HTML table that follows the workbook's widths,
   * heights, merges, fonts, fills, borders and pictures.
   * opts.marks: {ref: className} to highlight cells (mapping view)
   * opts.values: {ref: text} to show pending values without saving
   * opts.editable: let the user type into every cell that is not a formula
   * opts.locked: Set of refs that stay read-only (worked out by the app)
   * opts.toggles: Set of refs that switch on/off with a click (tick columns)
   */
  function printArea(sheet) {
    return sheet.printArea || { r1: 1, c1: 1, r2: Math.max(sheet.maxR, 1), c2: Math.max(sheet.maxC, 1) };
  }

  /* opts.range: {r1,c1,r2,c2} draws only that part (one printed page) */
  function renderSheet(sheet, opts = {}) {
    const area = opts.range || Object.assign({}, printArea(sheet), { r1: 1, c1: 1 });
    const r1 = area.r1, c1 = area.c1;
    const r2 = Math.min(area.r2, r1 + 600), c2 = Math.min(area.c2, c1 + 100);
    const marks = opts.marks || {};
    const colW = [];
    let totalW = 0, colgroup = '';
    for (let c = c1; c <= c2; c++) { const w = colPx(sheet, c); colW[c] = w; totalW += w; colgroup += `<col style="width:${w}px">`; }
    let html = `<table class="xl-sheet" cellspacing="0" cellpadding="0" style="width:${totalW}px"><colgroup>${colgroup}</colgroup><tbody>`;
    // merges clipped to the drawn range; a merge cut by a page break continues as an empty box
    const starts = new Map();
    const covered = new Set();
    for (const m of sheet.merges) {
      const mr1 = Math.max(m.r1, r1), mc1 = Math.max(m.c1, c1), mr2 = Math.min(m.r2, r2), mc2 = Math.min(m.c2, c2);
      if (mr1 > mr2 || mc1 > mc2) continue;
      starts.set(mr1 + ':' + mc1, { m, mr1, mc1, mr2, mc2, cont: mr1 !== m.r1 || mc1 !== m.c1 });
      for (let r = mr1; r <= mr2; r++) for (let c = mc1; c <= mc2; c++) if (r !== mr1 || c !== mc1) covered.add(r + ':' + c);
    }
    let totalH = 0;
    for (let r = r1; r <= r2; r++) {
      const h = rowPx(sheet, r);
      totalH += h;
      html += `<tr style="height:${h}px"${h === 0 ? ' class="xl-hidden"' : ''}>`;
      for (let c = c1; c <= c2; c++) {
        if (covered.has(r + ':' + c)) continue;
        const ref = makeRef(r, c);
        const mm = starts.get(r + ':' + c);
        const m = mm ? mm.m : null;
        const rs = mm ? mm.mr2 - r + 1 : 1;
        const cs = mm ? mm.mc2 - c + 1 : 1;
        const cont = mm && mm.cont;
        const st = cont ? styleOf(sheet, m.r1, m.c1) : styleOf(sheet, r, c);
        const css = [];
        const cell = cont ? null : sheet.cells.get(ref);
        const txt = cont ? '' : (opts.values && ref in opts.values ? opts.values[ref] : cellText(sheet, r, c));
        if (st) {
          const f = st.font;
          if (f) {
            if (f.bold) css.push('font-weight:700');
            if (f.italic) css.push('font-style:italic');
            if (f.underline || f.strike) css.push(`text-decoration:${f.underline ? 'underline' : ''} ${f.strike ? 'line-through' : ''}`);
            css.push(`font-size:${(f.size * 4 / 3).toFixed(1)}px`);
            if (f.name) css.push(`font-family:'${f.name.replace(/["'<>&]/g, '')}',Calibri,Carlito,Arial,sans-serif`);
            if (f.color) css.push(`color:${f.color}`);
          }
          if (st.fill) css.push(`background:${st.fill}`);
          const b = st.border || {};
          // for merged cells, the right/bottom edge comes from the far cells
          const right = m ? (styleOf(sheet, m.r1, m.c2)?.border?.right) : b.right;
          const bottom = m ? (styleOf(sheet, m.r2, m.c1)?.border?.bottom) : b.bottom;
          const sides = { left: b.left, top: b.top, right, bottom };
          for (const k in sides) if (sides[k]) css.push(`border-${k}:${BORDER_CSS[sides[k].style] || '1px solid'} ${sides[k].color}`);
          const h = st.h || (cell && cell.type === 'number' ? 'right' : null);
          if (h && h !== 'general') css.push(`text-align:${h === 'centerContinuous' ? 'center' : h === 'justify' || h === 'distributed' ? 'justify' : h}`);
          css.push(`vertical-align:${st.v === 'center' ? 'middle' : st.v === 'top' ? 'top' : 'bottom'}`);
          if (st.wrap) css.push('white-space:pre-wrap');
          if (st.indent) css.push(`padding-left:${st.indent * 9 + 2}px`);
        } else {
          css.push('vertical-align:bottom');
          if (cell && cell.type === 'number') css.push('text-align:right');
        }
        // like Excel, text runs over into empty cells on its right
        const hAlign = st && st.h;
        if (!mm && txt && !(st && st.wrap) && (!hAlign || hAlign === 'left' || hAlign === 'general') && !(cell && cell.type === 'number')) {
          const nextEmpty = c < c2 && !sheet.cells.get(makeRef(r, c + 1))?.value && !(opts.values && opts.values[makeRef(r, c + 1)]) && !mergeAt(sheet, r, c + 1);
          if (nextEmpty) css.push('overflow:visible;position:relative;z-index:1');
        }
        const cls = marks[ref] ? ` class="${marks[ref]}"` : '';
        const tip = opts.titles && opts.titles[ref] ? ` title="${esc(opts.titles[ref])}"` : '';
        const vert = st && st.rotate === 255 ? ' xl-vert' : '';
        const locked = opts.locked && opts.locked.has(ref);
        const toggle = opts.toggles && opts.toggles.has(ref);
        const editable = opts.editable && !cont && !(cell && cell.formula) && !locked && !toggle;
        const inner = toggle ? ' tabindex="0" role="checkbox"' : editable ? ' contenteditable="true" spellcheck="false"' : '';
        html += `<td${cont ? '' : ` data-ref="${ref}"`}${rs > 1 ? ` rowspan="${rs}"` : ''}${cs > 1 ? ` colspan="${cs}"` : ''}${cls}${tip} style="${css.join(';')}"><div class="xl-c${st && st.wrap ? ' xl-wrap' : ''}${vert}${toggle ? ' xl-toggle' : ''}"${inner}>${esc(txt)}</div></td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    // pictures, placed from the sheet origin and shifted to this range
    const colLeft = c => { let x = 0; for (let i = 1; i < c; i++) x += colPx(sheet, i); return x; };
    const rowTop = r => { let y = 0; for (let i = 1; i < r; i++) y += rowPx(sheet, i); return y; };
    const ox = colLeft(c1), oy = rowTop(r1);
    let imgs = '';
    for (const im of sheet.images) {
      if (!im.from) continue;
      const left = colLeft(im.from.col + 1) + im.from.colOff / 9525 - ox;
      const top = rowTop(im.from.row + 1) + im.from.rowOff / 9525 - oy;
      let w, h;
      if (im.to) {
        w = colLeft(im.to.col + 1) + im.to.colOff / 9525 - ox - left;
        h = rowTop(im.to.row + 1) + im.to.rowOff / 9525 - oy - top;
      }
      if ((!w || !h) && im.ext) { w = im.ext.cx / 9525; h = im.ext.cy / 9525; }
      if (left + w < 0 || top + h < 0 || left > totalW || top > totalH) continue;
      imgs += `<img class="xl-img" alt="" src="${im.src}" style="left:${left}px;top:${top}px;width:${w}px;height:${h}px">`;
    }
    return `<div class="xl-wrapper" style="width:${totalW}px;height:${totalH}px">${html}${imgs}</div>`;
  }

  // ---------- printed pages ----------
  // paper sizes in inches (Excel paperSize codes)
  const PAPER_IN = { 1: [8.5, 11], 5: [8.5, 14], 8: [11.69, 16.54], 9: [8.27, 11.69], 11: [5.83, 8.27], 14: [8.5, 13] };

  /* Work out the pages exactly as the saved file prints them.
   * override = the Page setup chosen in the app: {fit, orientation, paper}
   */
  function paginate(sheet, override = {}) {
    const pg = Object.assign({}, sheet.page);
    if (override.orientation) pg.orientation = override.orientation;
    if (override.paper) pg.paperSize = override.paper;
    // fit 'page': whole form on one page; 'width': shrink only a form that is too wide
    if (override.fit === 'page') { pg.fitToPage = true; pg.fitToWidth = 1; pg.fitToHeight = 1; }
    else if (override.fit && needsFit(sheet, pg)) { pg.fitToPage = true; pg.fitToWidth = 1; pg.fitToHeight = 0; }
    let [w, h] = PAPER_IN[pg.paperSize] || PAPER_IN[9];
    if (pg.orientation === 'landscape') [w, h] = [h, w];
    const DPI = 96;
    const pageW = w * DPI, pageH = h * DPI;
    const mg = pg.margins;
    const printW = pageW - (mg.left + mg.right) * DPI;
    const printH = pageH - (mg.top + mg.bottom) * DPI;
    const area = printArea(sheet);
    const cw = [], rh = [];
    let totalW = 0, totalH = 0;
    for (let c = area.c1; c <= area.c2; c++) { cw[c] = colPx(sheet, c); totalW += cw[c]; }
    for (let r = area.r1; r <= area.r2; r++) { rh[r] = rowPx(sheet, r); totalH += rh[r]; }
    let scale = (pg.scale || 100) / 100;
    if (pg.fitToPage) {
      const sx = pg.fitToWidth > 0 ? (printW * pg.fitToWidth) / totalW : Infinity;
      const sy = pg.fitToHeight > 0 ? (printH * pg.fitToHeight) / totalH : Infinity;
      scale = Math.min(1, sx, sy);
    }
    scale = Math.max(0.1, Math.min(4, scale));
    const cut = (from, to, size, limit, manual) => {
      const out = [];
      let start = from, used = 0;
      for (let i = from; i <= to; i++) {
        const sz = size[i] * scale;
        if (used + sz > limit + 0.5 && i > start) { out.push([start, i - 1]); start = i; used = 0; }
        used += sz;
        if (manual.includes(i) && i < to) { out.push([start, i]); start = i + 1; used = 0; }
      }
      if (start <= to) out.push([start, to]);
      return out;
    };
    const rowsets = cut(area.r1, area.r2, rh, printH, pg.rowBreaks || []);
    const colsets = cut(area.c1, area.c2, cw, printW, pg.colBreaks || []);
    const pages = [];
    // Excel prints down, then over
    for (const [c1, c2] of colsets) for (const [r1, r2] of rowsets) pages.push({ r1, r2, c1, c2 });
    return { pages, scale, pageW, pageH, printW, printH, margins: mg, hCenter: pg.hCenter, vCenter: pg.vCenter, dpi: DPI };
  }

  function needsFit(sheet, pg) {
    if (pg.fitToPage) return false;
    let [w, h] = PAPER_IN[pg.paperSize] || PAPER_IN[9];
    if (pg.orientation === 'landscape') [w, h] = [h, w];
    const printW = (w - pg.margins.left - pg.margins.right) * 96;
    const area = printArea(sheet);
    let totalW = 0;
    for (let c = area.c1; c <= area.c2; c++) totalW += colPx(sheet, c);
    return totalW * (pg.scale || 100) / 100 > printW + 1;
  }
  /* The page options to write into the saved file (same rule as the screen).
   * fit 'auto': fit to width, and if only a little would spill onto an extra
   * page, fit the whole form on one page instead. */
  function effectivePage(sheet, override) {
    const o = Object.assign({}, override);
    if (o.fit === true) o.fit = 'width';
    if (o.fit === 'auto') {
      const lay = paginate(sheet, Object.assign({}, o, { fit: 'width' }));
      o.fit = 'width';
      if (lay.pages.length === 2) {
        const last = lay.pages[1];
        let h = 0;
        for (let r = last.r1; r <= last.r2; r++) h += rowPx(sheet, r);
        if (h * lay.scale < lay.printH * 0.25) o.fit = 'page';
      }
    }
    if (o.fit === 'width') {
      const pg = Object.assign({}, sheet.page);
      if (o.orientation) pg.orientation = o.orientation;
      if (o.paper) pg.paperSize = o.paper;
      if (!needsFit(sheet, pg)) o.fit = null;
    }
    return o;
  }

  function renderPages(sheet, override, opts = {}) {
    const lay = paginate(sheet, override);
    const n = lay.pages.length;
    const html = lay.pages.map((rg, i) => {
      let w = 0, h = 0;
      for (let c = rg.c1; c <= rg.c2; c++) w += colPx(sheet, c);
      for (let r = rg.r1; r <= rg.r2; r++) h += rowPx(sheet, r);
      const left = lay.margins.left * lay.dpi + (lay.hCenter ? Math.max(0, (lay.printW - w * lay.scale) / 2) : 0);
      const top = lay.margins.top * lay.dpi + (lay.vCenter ? Math.max(0, (lay.printH - h * lay.scale) / 2) : 0);
      return `<div class="xl-page" style="width:${lay.pageW}px;height:${lay.pageH}px">
        <div class="xl-page-area" style="left:${left}px;top:${top}px;transform:scale(${lay.scale})">${renderSheet(sheet, Object.assign({}, opts, { range: rg }))}</div>
        <div class="xl-page-no">Page ${i + 1} of ${n}</div>
      </div>`;
    }).join('');
    return { html: `<div class="xl-pages">${html}</div>`, count: n, layout: lay };
  }

  // ---------- filling ----------
  function prefixOf(node) { return node.prefix ? node.prefix + ':' : ''; }

  function findOrCreateRow(doc, sheetData, r) {
    const rows = kids(sheetData, 'row');
    for (const row of rows) {
      const rr = +row.getAttribute('r');
      if (rr === r) return row;
      if (rr > r) {
        const nr = doc.createElementNS(NS, prefixOf(sheetData) + 'row');
        nr.setAttribute('r', String(r));
        sheetData.insertBefore(nr, row);
        return nr;
      }
    }
    const nr = doc.createElementNS(NS, prefixOf(sheetData) + 'row');
    nr.setAttribute('r', String(r));
    sheetData.appendChild(nr);
    return nr;
  }

  function findOrCreateCell(doc, row, ref, colStyle) {
    const c = parseRef(ref).c;
    for (const cell of kids(row, 'c')) {
      const cc = parseRef(cell.getAttribute('r')).c;
      if (cc === c) return cell;
      if (cc > c) {
        const nc = doc.createElementNS(NS, prefixOf(row) + 'c');
        nc.setAttribute('r', ref);
        if (colStyle) nc.setAttribute('s', colStyle);
        row.insertBefore(nc, cell);
        return nc;
      }
    }
    const nc = doc.createElementNS(NS, prefixOf(row) + 'c');
    nc.setAttribute('r', ref);
    if (colStyle) nc.setAttribute('s', colStyle);
    row.appendChild(nc);
    return nc;
  }

  function setCellValue(doc, cellEl, value) {
    while (cellEl.firstChild) cellEl.removeChild(cellEl.firstChild);
    cellEl.removeAttribute('t');
    if (value === null || value === undefined || value === '') return;
    const p = prefixOf(cellEl);
    if (typeof value === 'number' && isFinite(value)) {
      const v = doc.createElementNS(NS, p + 'v');
      v.textContent = String(value);
      cellEl.appendChild(v);
      return;
    }
    cellEl.setAttribute('t', 'inlineStr');
    const is = doc.createElementNS(NS, p + 'is');
    const t = doc.createElementNS(NS, p + 't');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = String(value);
    is.appendChild(t);
    cellEl.appendChild(is);
  }

  /* writesBySheet: {sheetPath: [{ref, value}]}
   * options.onlySheet: sheet path to keep visible (others are hidden)
   * Returns {blob, skipped:[refs that hold formulas]}
   */
  async function fillWorkbook(buffer, writesBySheet, options = {}) {
    const zip = await global.JSZip.loadAsync(buffer);
    const skipped = [];
    for (const path of Object.keys(writesBySheet)) {
      const raw = await zip.file(path).async('string');
      const decl = /^\s*<\?xml[^>]*\?>/.exec(raw);
      const doc = parseXml(raw);
      const sheetData = el(doc, 'sheetData');
      const colStyles = {};
      for (const c of els(el(doc, 'cols'), 'col')) {
        if (c.getAttribute('style') == null) continue;
        for (let i = +c.getAttribute('min'); i <= +c.getAttribute('max'); i++) colStyles[i] = c.getAttribute('style');
      }
      for (const w of writesBySheet[path]) {
        const p = parseRef(w.ref);
        const row = findOrCreateRow(doc, sheetData, p.r);
        row.removeAttribute('spans');
        const rowStyle = row.getAttribute('customFormat') === '1' ? row.getAttribute('s') : null;
        const cellEl = findOrCreateCell(doc, row, w.ref, rowStyle || colStyles[p.c]);
        if (kid(cellEl, 'f')) { skipped.push(w.ref); continue; }
        setCellValue(doc, cellEl, w.value);
      }
      // drop stale cached results so every program recomputes the totals
      for (const f of els(sheetData, 'f')) {
        const v = kid(f.parentNode, 'v');
        if (v) f.parentNode.removeChild(v);
        if (f.parentNode.getAttribute('t') === 'str' || f.parentNode.getAttribute('t') === 'e') f.parentNode.removeAttribute('t');
      }
      if (options.page && path === (options.pageSheet || options.onlySheet)) applyPage(doc, options.page);
      let out = new XMLSerializer().serializeToString(doc);
      if (decl && !/^\s*<\?xml/.test(out)) out = decl[0] + out;
      zip.file(path, out);
    }

    // recalculate formulas (totals) when the file is opened
    let wbXml = await zip.file('xl/workbook.xml').async('string');
    if (/<(\w+:)?calcPr\b/.test(wbXml)) {
      wbXml = wbXml.replace(/<((?:\w+:)?calcPr)\b([^>]*?)(\/?)>/, (all, tag, attrs, slash) =>
        /fullCalcOnLoad=/.test(attrs) ? all : `<${tag}${attrs} fullCalcOnLoad="1"${slash}>`);
    } else {
      const pre = (/<(\w+:)?workbook\b/.exec(wbXml) || [])[1] || '';
      const anchor = new RegExp(`</${pre}definedNames>|</${pre}sheets>`);
      const all = [...wbXml.matchAll(new RegExp(anchor, 'g'))];
      const m = all.find(x => x[0].includes('definedNames')) || all[0];
      if (m) wbXml = wbXml.slice(0, m.index + m[0].length) + `<${pre}calcPr fullCalcOnLoad="1"/>` + wbXml.slice(m.index + m[0].length);
    }

    if (options.onlySheet) wbXml = await showOnlySheet(zip, wbXml, options.onlySheet);
    zip.file('xl/workbook.xml', wbXml);

    const blob = await zip.generateAsync({
      type: options.type || 'blob', compression: 'DEFLATE',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    return { data: blob, skipped };
  }

  /* Print options for the filled sheet. page = {fit, orientation, paper}
   * fit: scale to one page wide; orientation: 'portrait'|'landscape'|null
   * paper: Excel paperSize number or null (keep the template's)
   */
  function applyPage(doc, page) {
    const root = doc.documentElement;
    const p = prefixOf(root);
    if (page.fit) {
      let sheetPr = kid(root, 'sheetPr');
      if (!sheetPr) { sheetPr = doc.createElementNS(NS, p + 'sheetPr'); root.insertBefore(sheetPr, root.firstElementChild); }
      let psp = kid(sheetPr, 'pageSetUpPr');
      if (!psp) { psp = doc.createElementNS(NS, p + 'pageSetUpPr'); sheetPr.appendChild(psp); }
      psp.setAttribute('fitToPage', '1');
    }
    if (!page.fit && !page.orientation && !page.paper) return;
    let ps = kid(root, 'pageSetup');
    if (!ps) {
      ps = doc.createElementNS(NS, p + 'pageSetup');
      const after = kid(root, 'pageMargins') || kid(root, 'printOptions');
      const next = after ? after.nextElementSibling : null;
      const anchor = next || ['headerFooter', 'rowBreaks', 'colBreaks', 'drawing', 'legacyDrawing', 'tableParts', 'extLst'].map(n => kid(root, n)).find(Boolean);
      if (anchor) root.insertBefore(ps, anchor); else root.appendChild(ps);
      if (!after) {
        const pm = doc.createElementNS(NS, p + 'pageMargins');
        for (const [k, v] of [['left', '0.5'], ['right', '0.5'], ['top', '0.5'], ['bottom', '0.5'], ['header', '0.3'], ['footer', '0.3']]) pm.setAttribute(k, v);
        root.insertBefore(pm, ps);
      }
    }
    if (page.fit) { ps.setAttribute('fitToWidth', '1'); ps.setAttribute('fitToHeight', page.fit === 'page' ? '1' : '0'); }
    if (page.orientation) ps.setAttribute('orientation', page.orientation);
    if (page.paper) ps.setAttribute('paperSize', String(page.paper));
    else if (!ps.getAttribute('paperSize')) ps.setAttribute('paperSize', '9');
  }

  async function showOnlySheet(zip, wbXml, keepPath) {
    const rels = await readRels(zip, 'xl/workbook.xml');
    const doc = parseXml(wbXml);
    const sheets = els(doc, 'sheet');
    let keepIndex = -1;
    const tabs = [];
    sheets.forEach((s, i) => {
      const rel = rels[s.getAttributeNS(NS_R, 'id')];
      const keep = rel && rel.target === keepPath;
      if (keep) keepIndex = i;
      tabs.push({ path: rel && rel.target, keep });
    });
    if (keepIndex < 0) return wbXml;
    // mark sheet states by editing only the <sheet .../> tags
    let i = 0;
    wbXml = wbXml.replace(/<((?:\w+:)?sheet)\b([^>]*?)\/>/g, (all, tag, attrs) => {
      const t = tabs[i++];
      if (!t) return all;
      attrs = attrs.replace(/\sstate="[^"]*"/, '');
      return t.keep ? `<${tag}${attrs}/>` : `<${tag}${attrs} state="hidden"/>`;
    });
    wbXml = wbXml.replace(/<((?:\w+:)?workbookView)\b([^>]*?)(\/?)>/, (all, tag, attrs, slash) => {
      attrs = attrs.replace(/\s(activeTab|firstSheet)="[^"]*"/g, '');
      return `<${tag}${attrs} firstSheet="${keepIndex}" activeTab="${keepIndex}"${slash}>`;
    });
    for (const t of tabs) {
      if (!t.path || !zip.file(t.path)) continue;
      let x = await zip.file(t.path).async('string');
      const before = x;
      x = x.replace(/<((?:\w+:)?sheetView)\b([^>]*?)(\/?)>/, (all, tag, attrs, slash) => {
        attrs = attrs.replace(/\stabSelected="[^"]*"/, '');
        return `<${tag}${attrs}${t.keep ? ' tabSelected="1"' : ''}${slash}>`;
      });
      if (x !== before) zip.file(t.path, x);
    }
    return wbXml;
  }

  /* On-screen only: work out the form's own formulas (totals, row numbers,
   * IF checks) so the pages look filled. The saved file keeps the formulas
   * and Excel calculates them itself. Unknown functions stay blank. */
  function computeFormulas(sheet) {
    const memo = new Map();
    const blank = v => v == null || v === '';
    function val(ref, depth) {
      const cell = sheet.cells.get(ref);
      if (!cell) return null;
      if (!cell.formula || cell.formula === '(shared)' || cell.value != null) return cell.value;
      if (memo.has(ref)) return memo.get(ref);
      memo.set(ref, null);
      let v = null;
      try { v = evaluate(cell.formula, cell, depth); } catch (e) { v = null; }
      memo.set(ref, v);
      return v;
    }
    function evaluate(src, cell, depth) {
      if (depth > 40) return null;
      const toks = [];
      const re = /\s*(?:("(?:[^"]|"")*")|(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)|(\d+(?:\.\d+)?)|([A-Z][A-Z0-9.]*)\s*\(|(<>|<=|>=|[-+*/&=<>(),:^%]))/gy;
      let m, pos = 0;
      const text = src.replace(/^=/, '');
      while (pos < text.length) {
        re.lastIndex = pos;
        m = re.exec(text);
        if (!m) { if (/^\s*$/.test(text.slice(pos))) break; throw new Error('unsupported'); }
        pos = re.lastIndex;
        if (m[1]) toks.push({ t: 's', v: m[1].slice(1, -1).replace(/""/g, '"') });
        else if (m[2]) toks.push({ t: 'r', v: m[2].replace(/\$/g, '') });
        else if (m[3]) toks.push({ t: 'n', v: +m[3] });
        else if (m[4]) toks.push({ t: 'f', v: m[4] });
        else toks.push({ t: 'o', v: m[5] });
      }
      let i = 0;
      const peek = () => toks[i], next = () => toks[i++];
      const num = v => typeof v === 'number' ? v : typeof v === 'boolean' ? +v : blank(v) ? 0 : isNaN(+v) ? 0 : +v;
      const refVals = r => {
        if (!r.includes(':')) return [val(r, depth + 1)];
        const [a1, b1] = r.split(':').map(parseRef);
        const out = [];
        for (let rr = Math.min(a1.r, b1.r); rr <= Math.max(a1.r, b1.r); rr++) for (let cc = Math.min(a1.c, b1.c); cc <= Math.max(a1.c, b1.c); cc++) out.push(val(makeRef(rr, cc), depth + 1));
        return out;
      };
      function args() {
        const list = [];
        if (peek() && peek().v === ')') { next(); return list; }
        for (;;) {
          const tk = peek();
          if (tk && tk.t === 'r' && toks[i + 1] && (toks[i + 1].v === ',' || toks[i + 1].v === ')')) { next(); list.push({ range: tk.v }); }
          else list.push({ value: cmp() });
          const sep = next();
          if (!sep || sep.v === ')') break;
        }
        return list;
      }
      const flat = list => list.flatMap(a => a.range ? refVals(a.range) : [a.value]);
      const crit = (v, c) => {
        const mm = /^(<>|<=|>=|=|<|>)?(.*)$/.exec(String(c));
        const op = mm[1] || '=', rhs = mm[2];
        const both = !isNaN(+rhs) && rhs !== '' && !blank(v) && !isNaN(+v);
        const a = both ? +v : String(v ?? '').toLowerCase(), b = both ? +rhs : rhs.toLowerCase();
        return op === '=' ? a === b : op === '<>' ? a !== b : op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
      };
      function call(name, list) {
        switch (name) {
          case 'SUM': return flat(list).reduce((s2, v) => s2 + (typeof v === 'number' ? v : 0), 0);
          case 'COUNT': return flat(list).filter(v => typeof v === 'number').length;
          case 'COUNTA': return flat(list).filter(v => !blank(v)).length;
          case 'COUNTBLANK': return flat(list).filter(blank).length;
          case 'AVERAGE': { const ns = flat(list).filter(v => typeof v === 'number'); return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null; }
          case 'MAX': return Math.max(...flat(list).filter(v => typeof v === 'number'));
          case 'MIN': return Math.min(...flat(list).filter(v => typeof v === 'number'));
          case 'ROUND': return Math.round(num(list[0].value) * 10 ** num(list[1] ? list[1].value : 0)) / 10 ** num(list[1] ? list[1].value : 0);
          case 'ROW': return list[0] && list[0].range ? parseRef(list[0].range.split(':')[0]).r : cell.r;
          case 'COLUMN': return list[0] && list[0].range ? parseRef(list[0].range.split(':')[0]).c : cell.c;
          case 'IF': { const c = list[0].range ? refVals(list[0].range)[0] : list[0].value; const pick = list[num(c) || (typeof c === 'string' && c !== '') ? 1 : 2]; return pick ? (pick.range ? refVals(pick.range)[0] : pick.value) : false; }
          case 'AND': return flat(list).every(v => !!num(v));
          case 'OR': return flat(list).some(v => !!num(v));
          case 'NOT': return !num(flat(list)[0]);
          case 'ISBLANK': return blank(flat(list)[0]);
          case 'LEN': return String(flat(list)[0] ?? '').length;
          case 'TRIM': return String(flat(list)[0] ?? '').trim();
          case 'COUNTIF': return refVals(list[0].range).filter(v => crit(v, list[1].range ? refVals(list[1].range)[0] : list[1].value)).length;
          case 'SUMIF': { const r1 = refVals(list[0].range), r2 = list[2] ? refVals(list[2].range) : r1; const c = list[1].value; return r1.reduce((a, v, k) => a + (crit(v, c) ? num(r2[k]) : 0), 0); }
          default: throw new Error('unsupported');
        }
      }
      function atom() {
        const tk = next();
        if (!tk) throw new Error('end');
        if (tk.t === 'n' || tk.t === 's') return tk.v;
        if (tk.t === 'r') return refVals(tk.v)[0];
        if (tk.t === 'f') return call(tk.v, args());
        if (tk.v === '(') { const v = cmp(); next(); return v; }
        if (tk.v === '-') return -num(atom());
        if (tk.v === '+') return num(atom());
        throw new Error('bad');
      }
      function pow() { let v = atom(); while (peek() && peek().v === '%') { next(); v = num(v) / 100; } while (peek() && peek().v === '^') { next(); v = num(v) ** num(atom()); } return v; }
      function mul() { let v = pow(); while (peek() && (peek().v === '*' || peek().v === '/')) { const op = next().v; const r = pow(); v = op === '*' ? num(v) * num(r) : num(v) / num(r); } return v; }
      function add() { let v = mul(); while (peek() && (peek().v === '+' || peek().v === '-')) { const op = next().v; const r = mul(); v = op === '+' ? num(v) + num(r) : num(v) - num(r); } return v; }
      function cat() { let v = add(); while (peek() && peek().v === '&') { next(); v = String(v ?? '') + String(add() ?? ''); } return v; }
      function cmp() {
        let v = cat();
        while (peek() && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) {
          const op = next().v, r = cat();
          const a = blank(v) && typeof r === 'number' ? 0 : v, b = blank(r) && typeof v === 'number' ? 0 : r;
          v = op === '=' ? a == b : op === '<>' ? a != b : op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b; // eslint-disable-line eqeqeq
        }
        return v;
      }
      const out = cmp();
      if (typeof out === 'number' && !isFinite(out)) return null;
      return out;
    }
    for (const [ref, cell] of sheet.cells) {
      if (cell.formula && cell.value == null) {
        const v = val(ref, 0);
        if (v == null || v === false && /^IF\(/i.test(cell.formula)) continue;
        cell.value = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v;
        cell.type = typeof v === 'number' ? 'number' : 'string';
      }
    }
  }

  global.XL = {
    computeFormulas, paginate, renderPages, effectivePage,
    loadWorkbook, renderSheet, fillWorkbook,
    parseRef, makeRef, colToNum, numToCol, parseRange,
    cellText, mergeAt, hasBorder, rowPx, colPx, styleOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
