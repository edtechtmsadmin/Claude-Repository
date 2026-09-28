/* Phil-IRI Recorder - text out of documents, for reading passages.
 *
 * Accepts PDF (with real text), Word .docx and plain .txt. Pictures and
 * scanned pages are refused: the phone app needs the exact words, and
 * guessing them from a picture could change the passage.
 */
(function (global) {
  'use strict';

  const PICTURE = /\.(png|jpe?g|gif|bmp|webp|heic|heif|tiff?|svg)$/i;

  function kindOf(file) {
    const n = (file.name || '').toLowerCase();
    if (PICTURE.test(n) || /^image\//.test(file.type || '')) return 'picture';
    if (n.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
    if (n.endsWith('.docx')) return 'docx';
    if (n.endsWith('.txt')) return 'txt';
    if (n.endsWith('.doc')) return 'doc';
    return 'other';
  }

  // ---------- PDF (pdf.js; its worker code runs on the page only when needed) ----------
  let pdfReady = null;
  function pdfLib() {
    if (!pdfReady) {
      pdfReady = (async () => {
        if (!global.pdfjsLib) throw new Error('The PDF reader is missing from this copy of the app.');
        if (!global.pdfjsWorker) {
          const holder = document.getElementById('pdf-worker-src');
          const code = holder ? holder.textContent.trim() : '';
          const s = document.createElement('script');
          if (code) { s.textContent = code; document.head.appendChild(s); }
          else if (holder && holder.dataset.src) {
            // running from the app folder (desktop app): load the file itself, works from disk too
            await new Promise((ok, fail) => { s.onload = ok; s.onerror = () => fail(new Error('The PDF reader could not be started.')); s.src = holder.dataset.src; document.head.appendChild(s); });
          }
          if (!global.pdfjsWorker) throw new Error('The PDF reader is missing from this copy of the app.');
        }
        global.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; // not fetched: the worker above is used
        return global.pdfjsLib;
      })();
      pdfReady.catch(() => { pdfReady = null; });
    }
    return pdfReady;
  }

  // one page of pdf.js text items -> paragraphs; lines wrapped by the page are joined again
  function pageText(items) {
    const lines = [];
    let cur = null;
    for (const it of items) {
      if (typeof it.str !== 'string') continue;
      const x = it.transform[4], y = it.transform[5], h = Math.abs(it.height || it.transform[3]) || 10;
      if (!cur || Math.abs(y - cur.y) > h * 0.5) {
        if (cur && cur.text.trim()) lines.push(cur);
        cur = { y, h, text: '', end: x };
      }
      if (cur.text && !/\s$/.test(cur.text) && !/^\s/.test(it.str) && x - cur.end > h * 0.15) cur.text += ' ';
      cur.text += it.str;
      cur.end = x + (it.width || 0);
      cur.h = Math.max(cur.h, h);
    }
    if (cur && cur.text.trim()) lines.push(cur);
    // a line that is only a page number ("2", "- 2 -", "Page 2") is not part of the passage
    for (let i = lines.length - 1; i >= 0; i--) if (/^[-–\s]*(page|pahina)?\s*\d{1,3}[-–\s]*$/i.test(lines[i].text.trim())) lines.splice(i, 1);
    if (!lines.length) return '';
    const gaps = [];
    for (let i = 1; i < lines.length; i++) { const g = lines[i - 1].y - lines[i].y; if (g > 0) gaps.push(g); }
    gaps.sort((a, b) => a - b);
    const usual = gaps.length ? gaps[Math.floor(gaps.length / 2)] : lines[0].h * 1.2;
    let out = lines[0].text.trim();
    for (let i = 1; i < lines.length; i++) {
      const g = lines[i - 1].y - lines[i].y;
      const t = lines[i].text.trim();
      if (g > usual * 1.45 || g < 0) out += '\n\n' + t;
      else out += (/-$/.test(out) ? '' : ' ') + t;
    }
    return out.replace(/[ \t]+/g, ' ');
  }

  async function fromPdf(buf) {
    const lib = await pdfLib();
    const doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(pageText(content.items));
    }
    doc.destroy();
    return pages;
  }

  // ---------- Word .docx ----------
  async function fromDocx(buf) {
    const zip = await JSZip.loadAsync(buf);
    const f = zip.file('word/document.xml');
    if (!f) throw new Error('This Word file could not be read.');
    const xml = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const paras = [];
    for (const p of xml.getElementsByTagNameNS(W, 'p')) {
      let t = '';
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType !== 1) continue;
          if (c.namespaceURI === W && c.localName === 't') t += c.textContent;
          else if (c.namespaceURI === W && c.localName === 'tab') t += ' ';
          else if (c.namespaceURI === W && (c.localName === 'br' || c.localName === 'cr')) t += '\n';
          else if (c.namespaceURI === W && c.localName === 'p') continue; // nested paragraph (text box): read on its own
          else walk(c);
        }
      };
      walk(p);
      if (t.trim()) paras.push(t.replace(/[ \t]+/g, ' ').trim());
    }
    return paras.join('\n\n');
  }

  // returns {kind, pages: [text, ...]} (one entry for Word/text files)
  async function read(file) {
    const kind = kindOf(file);
    if (kind === 'picture') throw new Error('Pictures cannot be used. Please paste the passage as text, or bring in a PDF or Word file.');
    if (kind === 'doc') throw new Error('This is an old Word file (.doc). In Word, use File › Save As › Word Document (.docx), or save it as PDF, then bring it in.');
    if (kind === 'other') throw new Error('Please use a PDF, a Word file (.docx) or a text file (.txt).');
    const buf = await file.arrayBuffer();
    let pages;
    if (kind === 'pdf') pages = await fromPdf(buf);
    else if (kind === 'docx') pages = [await fromDocx(buf)];
    else pages = [new TextDecoder('utf-8').decode(buf)];
    if (!pages.some(p => p.trim())) {
      throw new Error(kind === 'pdf'
        ? 'This PDF has no text in it. It looks like a scanned picture, which cannot be used. Please use the original PDF or Word file, or type the passage.'
        : 'No text was found in this file.');
    }
    return { kind, pages };
  }

  // wrapped lines -> paragraphs: single line breaks become spaces, blank lines stay
  function tidy(text) {
    return String(text || '').replace(/\r\n?/g, '\n')
      .split(/\n\s*\n/).map(p => p.split('\n').map(l => l.trim()).filter(Boolean)
        .reduce((a, l) => a ? (/-$/.test(a) ? a + l : a + ' ' + l) : l, '').replace(/[ \t]+/g, ' '))
      .filter(Boolean).join('\n\n');
  }

  global.DocText = { read, tidy, kindOf, pageText };
})(typeof window !== 'undefined' ? window : globalThis);
