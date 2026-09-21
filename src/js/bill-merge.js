// ════════════════════════════════════════════════════════════════════════
// SPINLOG — BILL MERGE
//
// Several files picked for one bill become one PDF, in the order he picked them.
//
//   two photos            → a two-page PDF
//   a PDF and a photo     → the photo becomes the page after the PDF's last one
//   three PDFs            → one PDF with all their pages, in order
//   one file              → left completely alone
//
// ── Why one file matters ─────────────────────────────────────────────
// A service record holds ONE bill: `maintenance_records.bill` is a single column
// and the upload path stores a single object. A garage invoice is routinely two
// sheets, or a printed invoice plus a photo of the handwritten parts list, and
// until now that meant choosing which half to keep.
//
// ── Why pdf-lib, and why it is not in the precache ───────────────────
// Writing a PDF from images is about two hundred lines and no dependency: draw
// each one to a canvas, take the JPEG bytes, emit them as /DCTDecode. Reading an
// EXISTING PDF to append a page to it is a different problem — cross-reference
// tables, object streams, compressed xrefs, encryption — and hand-rolling that is
// how you get a file that opens in Chrome and not in anything else.
//
// So: pdf-lib, pinned at 1.17.1, vendored rather than pulled from a CDN like
// three.js is, and LAZY. 513KB is a lot to put in front of an app that opens in
// under a second, and most entries are one photo. It is fetched the first time a
// merge actually needs it and then held for the session. It is deliberately absent
// from PRECACHE in service-worker.js — the service worker's normal network-first
// rule caches it on first use, so the second merge works offline and the first one
// does not, which is the right trade for half a megabyte.
//
// ── States, out loud ─────────────────────────────────────────────────
// Every step reports: reading, loading the library, the page count as it builds,
// and either a named result or a named failure. A merge is the one operation here
// that can take several seconds on a phone with four photos of a bill, and a
// silent wait is indistinguishable from a broken one.
// ════════════════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  const LIB_URL = './vendor/pdf-lib.min.js';
  // A4 at 72dpi, the unit PDF works in. Pages are sized to the image instead when
  // the image is landscape, so a photographed bill is not letterboxed.
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  // Anything bigger is downscaled before it goes in. A modern phone camera makes
  // 4000px images and a bill is legible at 2000 — four of them at full size makes a
  // 30MB PDF that the upload then has to carry.
  const MAX_EDGE = 2200;
  const JPEG_QUALITY = 0.86;

  const IMAGE_TYPE = /^image\/(jpeg|jpg|png|webp|gif|bmp|heic|heif)$/i;
  const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i;
  const PDF_EXT = /\.pdf$/i;

  function isPdf(file) {
    return /pdf/i.test(file.type || '') || PDF_EXT.test(file.name || '');
  }
  function isImage(file) {
    return IMAGE_TYPE.test(file.type || '') || IMAGE_EXT.test(file.name || '');
  }

  // ── The library, once ───────────────────────────────────────────────

  let libPromise = null;

  function loadLib() {
    if (root.PDFLib) return Promise.resolve(root.PDFLib);
    if (libPromise) return libPromise;
    libPromise = new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = LIB_URL;
      tag.async = true;
      tag.onload = () => (root.PDFLib
        ? resolve(root.PDFLib)
        : reject(new Error('pdf-lib loaded but did not register')));
      tag.onerror = () => reject(new Error('could not load the PDF tool'));
      document.head.appendChild(tag);
    }).catch(err => {
      // Not cached: a failed load must be retryable, or one flaky moment disables
      // merging for the rest of the session.
      libPromise = null;
      throw err;
    });
    return libPromise;
  }

  // ── Images → JPEG bytes the right way up and the right size ─────────

  /**
   * Decode, downscale, re-encode as JPEG.
   *
   * Re-encoded rather than embedded as-is because PDF can only carry JPEG bytes
   * directly. A PNG would need FlateDecode with the right predictor, and WebP and
   * HEIC it cannot carry at all — and HEIC is what an iPhone produces by default,
   * so "embed the original bytes" would fail on the most likely input.
   *
   * createImageBitmap applies EXIF orientation, so a photo taken in portrait does
   * not arrive on its side.
   */
  async function imageToJpeg(file) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error(`${file.name} is not an image this browser can open`);
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    // White underneath: a transparent PNG would otherwise come out black, which is
    // a scanned receipt turning into a solid rectangle.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error(`${file.name} could not be converted`);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: w, height: h };
  }

  // ── The merge ───────────────────────────────────────────────────────

  /**
   * @param {File[]} files          in the order he picked them
   * @param {(state:{phase:string, text:string, pct:number}) => void} [onState]
   * @returns {Promise<{ok:boolean, file?:File, pages?:number, from?:number, reason?:string, error?:string}>}
   */
  async function merge(files, onState) {
    const list = [...(files || [])].filter(Boolean);
    const say = (phase, text, pct) => {
      if (onState) { try { onState({ phase, text, pct }); } catch { /* a bad listener is not a failure */ } }
    };

    if (!list.length) return { ok: false, reason: 'empty', error: 'Nothing was picked.' };
    // One file is already one file. Saying so rather than round-tripping it through
    // a PDF keeps a clean scan a clean scan.
    if (list.length === 1) {
      say('done', `${list[0].name} — nothing to merge.`, 100);
      return { ok: true, file: list[0], pages: null, from: 1, reason: 'single' };
    }

    const unknown = list.filter(f => !isPdf(f) && !isImage(f));
    if (unknown.length) {
      return {
        ok: false,
        reason: 'unsupported',
        error: `${unknown.map(f => f.name).join(', ')} — only images and PDFs can be merged.`,
      };
    }

    say('reading', `Reading ${list.length} files…`, 6);

    let PDFLib;
    try {
      say('loading', 'Getting the PDF tool…', 14);
      PDFLib = await loadLib();
    } catch (err) {
      return {
        ok: false,
        reason: 'no-lib',
        error: 'The PDF tool could not load, so the files were left as they are. '
          + 'Connect once and it will be kept for next time.',
      };
    }

    let out;
    try {
      out = await PDFLib.PDFDocument.create();
    } catch (err) {
      return { ok: false, reason: 'error', error: 'Could not start a new PDF.' };
    }

    for (let i = 0; i < list.length; i += 1) {
      const file = list[i];
      const pct = 20 + Math.round((i / list.length) * 70);
      try {
        if (isPdf(file)) {
          say('working', `Adding ${file.name}…`, pct);
          const src = await PDFLib.PDFDocument.load(await file.arrayBuffer(), {
            // A bill is sometimes a dealer's locked PDF. Refusing it outright would
            // be worse than copying the pages out of it.
            ignoreEncryption: true,
          });
          const pages = await out.copyPages(src, src.getPageIndices());
          pages.forEach(p => out.addPage(p));
        } else {
          say('working', `Adding ${file.name}…`, pct);
          const img = await imageToJpeg(file);
          const embedded = await out.embedJpg(img.bytes);
          // Portrait images go on an A4 page scaled to fit; landscape gets a page
          // its own shape, so a wide photo of a counterfoil is not shrunk into a
          // stripe across the middle of a portrait sheet.
          const landscape = img.width > img.height;
          const page = landscape
            ? out.addPage([PAGE_H, PAGE_W])
            : out.addPage([PAGE_W, PAGE_H]);
          const box = page.getSize();
          const fit = Math.min(box.width / img.width, box.height / img.height);
          const w = img.width * fit;
          const h = img.height * fit;
          page.drawImage(embedded, {
            x: (box.width - w) / 2,
            y: (box.height - h) / 2,
            width: w,
            height: h,
          });
        }
      } catch (err) {
        return {
          ok: false,
          reason: 'error',
          error: `${file.name} could not be added${err && err.message ? ` — ${err.message}` : ''}.`,
        };
      }
    }

    const pages = out.getPageCount();
    if (!pages) return { ok: false, reason: 'error', error: 'That came out empty.' };

    say('saving', `Writing ${pages} pages…`, 94);
    let bytes;
    try {
      bytes = await out.save({ useObjectStreams: true });
    } catch (err) {
      return { ok: false, reason: 'error', error: 'The merged PDF could not be written.' };
    }

    const file = new File([bytes], namedFor(list), {
      type: 'application/pdf',
      lastModified: Date.now(),
    });
    say('done', `Merged ${list.length} files into ${pages} pages.`, 100);
    return { ok: true, file, pages, from: list.length, reason: 'merged' };
  }

  /**
   * A name that says what it is.
   *
   * Built from the first file so it still resembles what he picked, which matters
   * when he later finds it in the archive and has to recognise it.
   */
  function namedFor(list) {
    const first = String(list[0].name || 'bill').replace(/\.[^.]+$/, '');
    const stem = first.replace(/[^\w-]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'bill';
    return `${stem}-plus-${list.length - 1}.pdf`;
  }

  root.dkBillMerge = {
    merge, loadLib, isPdf, isImage,
    LIB_URL, MAX_EDGE, JPEG_QUALITY,
  };
})(typeof self !== 'undefined' ? self : this);
