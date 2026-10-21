import { pdfjs, newId, type PDFDocumentProxy } from './load';
import type { Field, Rect, Values } from '../types';

/**
 * Field detection for flat (non-AcroForm) PDFs works on a raster of the page:
 * luminance edges give horizontal and vertical line segments, which are then
 * assembled into boxes (comb cells / text boxes / checkboxes), bottom-ticked
 * combs and underlines. Text content is used to drop label cells, to find
 * dotted/underscore leaders and to name fields. Real AcroForm widgets are used
 * as-is when the PDF has them.
 */

const S = 2.5; // render scale (px per pt)
const EDGE = 38; // luminance delta that counts as an edge

interface HSeg { y: number; x1: number; x2: number; used?: boolean }
interface VSeg { x: number; y1: number; y2: number }
interface TextBox extends Rect { str: string; fh: number }

export interface DetectResult {
  fields: Field[];
  values: Values;
}

export async function detectAll(
  doc: PDFDocumentProxy,
  onProgress?: (page: number, total: number) => void,
): Promise<DetectResult> {
  const fields: Field[] = [];
  const values: Values = {};
  for (let p = 0; p < doc.numPages; p++) {
    onProgress?.(p + 1, doc.numPages);
    const r = await detectPage(doc, p);
    fields.push(...r.fields);
    Object.assign(values, r.values);
  }
  uniqueNames(fields);
  return { fields, values };
}

export async function detectPage(doc: PDFDocumentProxy, pageIndex: number): Promise<DetectResult> {
  const page = await doc.getPage(pageIndex + 1);
  const vp1 = page.getViewport({ scale: 1 });
  const texts = await getTextBoxes(page, vp1);

  const values: Values = {};
  const acro = await getAcroFields(page, vp1, pageIndex, values);
  if (acro.length) {
    nameFields(acro, texts);
    return { fields: acro, values };
  }

  const { L, W, H } = await renderLuma(page);

  const hsegs = findHSegs(L, W, H);
  const vsegs = findVSegs(L, W, H);
  const fields: Field[] = [];
  const add = (f: Omit<Field, 'id' | 'page' | 'name' | 'source'>) => {
    if (f.x < 0 || f.y < 0 || f.x + f.w > vp1.width + 1 || f.y + f.h > vp1.height + 1) return;
    fields.push({ ...f, id: newId(), page: pageIndex, name: '', source: 'auto' });
  };

  // 1. Boxes from horizontal pairs + vertical dividers.
  const rows = findBoxRows(hsegs, vsegs);
  const singles: Rect[] = [];
  for (const cells of rows) {
    // Light grey text inside a box is a placeholder hint (e.g. "D D M M Y Y"), not a label.
    const empty = cells.map((c) => isBlank(c, L, W) && (!hasText(c, texts) || darkest(inner(c), L, W, H) > 150));
    let i = 0;
    while (i < cells.length) {
      if (!empty[i]) { i++; continue; }
      const c0 = cells[i];
      let j = i + 1;
      if (c0.w <= c0.h * 1.8) {
        while (
          j < cells.length && empty[j] &&
          Math.abs(cells[j].x - (cells[j - 1].x + cells[j - 1].w)) < 1.5 &&
          Math.abs(cells[j].w - c0.w) / c0.w < 0.35
        ) j++;
      }
      const n = j - i;
      if (n >= 2) {
        const last = cells[j - 1];
        add({ type: 'comb', x: c0.x, y: c0.y, w: last.x + last.w - c0.x, h: c0.h, cells: n });
      } else {
        singles.push(c0);
      }
      i = j;
    }
  }
  // Square singles: checkbox, or comb when several sit in a tight row.
  singles.sort((a, b) => a.y - b.y || a.x - b.x);
  const taken = new Set<Rect>();
  for (let i = 0; i < singles.length; i++) {
    const a = singles[i];
    if (taken.has(a)) continue;
    const squareish = a.w / a.h > 0.6 && a.w / a.h < 1.6 && a.h <= 22;
    if (squareish) {
      const run = [a];
      for (let k = i + 1; k < singles.length; k++) {
        const b = singles[k];
        const prev = run[run.length - 1];
        if (Math.abs(b.y - a.y) > 1.5 || Math.abs(b.h - a.h) > 1.5 || Math.abs(b.w - a.w) > 2) continue;
        const gap = b.x - (prev.x + prev.w);
        if (gap < -1 || gap > a.w * 0.45) continue;
        if (hasText({ x: prev.x + prev.w, y: a.y, w: Math.max(gap, 0.1), h: a.h }, texts)) continue;
        run.push(b);
      }
      if (run.length >= 3) {
        run.forEach((r) => taken.add(r));
        const last = run[run.length - 1];
        add({ type: 'comb', x: a.x, y: a.y, w: last.x + last.w - a.x, h: a.h, cells: run.length });
        continue;
      }
      if (a.w <= 20) {
        add({ type: 'checkbox', ...a });
        continue;
      }
    }
    add({ type: 'text', ...a, multiline: a.h > 30 || undefined });
  }

  // 2. Bottom lines with tick dividers and plain underlines.
  const pageW = vp1.width;
  for (const s of hsegs) {
    if (s.used) continue;
    const len = s.x2 - s.x1;
    if (len < 20 || len > pageW * 0.85) continue;
    const ticks = vsegs
      .filter((v) => v.x >= s.x1 - 1.5 && v.x <= s.x2 + 1.5 && Math.abs(v.y2 - s.y) < 1.8 && v.y2 - v.y1 >= 2 && v.y2 - v.y1 <= 14)
      .map((v) => v.x)
      .sort((a, b) => a - b);
    const xs = dedupeSorted(ticks, 1.5);
    if (xs.length >= 4) {
      const widths = xs.slice(1).map((x, k) => x - xs[k]);
      const med = median(widths);
      if (med >= 4 && med <= 24 && widths.every((w) => Math.abs(w - med) / med < 0.4)) {
        const h = Math.min(Math.max(med * 1.1, 10), 16);
        add({ type: 'comb', x: xs[0], y: s.y - h, w: xs[xs.length - 1] - xs[0], h, cells: xs.length - 1 });
        continue;
      }
    }
    if (len < 30) continue;
    if (textSitsOn(s, texts)) continue;
    const h = underlineHeight(s, texts, hsegs);
    if (h < 7) continue;
    add({ type: 'text', x: s.x1, y: s.y - h, w: len, h });
  }

  // 3. Dotted / underscore leaders in text.
  for (const t of texts) {
    const re = /_{4,}|\.{6,}|…{3,}|(?:\. ){5,}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t.str))) {
      const cw = t.w / Math.max(t.str.length, 1);
      const x = t.x + m.index * cw;
      const w = m[0].length * cw;
      if (w < 20) continue;
      const h = Math.min(Math.max(t.fh * 1.25, 10), 16);
      add({ type: 'text', x, y: t.y + t.h - h, w, h });
    }
  }

  const kept = mergeCombs(dedupe(fields));
  nameFields(kept, texts);
  return { fields: kept, values };
}

// ------------------------------------------------------------------ raster

interface Luma { L: Uint8Array; W: number; H: number }
const lumaCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<Luma>>>();

async function renderLuma(page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>): Promise<Luma> {
  const vp = page.getViewport({ scale: S });
  const W = Math.ceil(vp.width);
  const H = Math.ceil(vp.height);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  await page.render({ canvasContext: ctx, viewport: vp, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise;
  const img = ctx.getImageData(0, 0, W, H).data;
  const L = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < L.length; i++, j += 4) {
    L[i] = (img[j] * 299 + img[j + 1] * 587 + img[j + 2] * 114) / 1000;
  }
  canvas.width = canvas.height = 0;
  return { L, W, H };
}

function cachedLuma(doc: PDFDocumentProxy, pageIndex: number): Promise<Luma> {
  let m = lumaCache.get(doc);
  if (!m) lumaCache.set(doc, (m = new Map()));
  let p = m.get(pageIndex);
  if (!p) {
    p = doc.getPage(pageIndex + 1).then(renderLuma);
    m.set(pageIndex, p);
  }
  return p;
}

/**
 * Finds the x positions (pt) of box dividers printed on the page along a field's row,
 * starting at the field's left edge and running right while the spacing stays regular.
 */
export async function rowDividers(doc: PDFDocumentProxy, pageIndex: number, r: Rect): Promise<number[]> {
  const { L, W, H } = await cachedLuma(doc, pageIndex);
  const y1 = Math.max(0, Math.round((r.y + r.h * 0.25) * S));
  const y2 = Math.min(H - 1, Math.round((r.y + r.h * 0.75) * S));
  const rowsN = y2 - y1;
  if (rowsN < 2) return [];
  const cols: number[] = [];
  for (let x = Math.max(0, Math.round((r.x - 3) * S)); x < W - 1; x++) {
    let hits = 0;
    for (let y = y1; y < y2; y++) {
      const i = y * W + x;
      const d = L[i] - L[i + 1];
      if (d > EDGE || d < -EDGE) hits++;
    }
    if (hits >= rowsN * 0.8) cols.push(x);
  }
  // Each stroked line yields edge columns on both sides; fold them into one position.
  const xs = dedupeSorted(cols.map((c) => (c + 1) / S), 2);
  const out: number[] = [];
  for (const x of xs) {
    if (!out.length) {
      if (Math.abs(x - r.x) > 3) return [];
      out.push(x);
      continue;
    }
    const step = x - out[out.length - 1];
    if (step < 3) continue;
    if (out.length >= 2) {
      const pitch = out[1] - out[0];
      if (step > pitch * 1.6) break; // end of the run
    } else if (step > Math.max(r.h * 3, 40)) break;
    out.push(x);
  }
  return out;
}

// ---------------------------------------------------------------- segments

function findHSegs(L: Uint8Array, W: number, H: number): HSeg[] {
  const minLen = Math.round(5 * S);
  const gap = 2;
  type Open = { x1: number; x2: number; y0: number; y1: number };
  let open: Open[] = [];
  const done: Open[] = [];
  for (let y = 0; y < H - 1; y++) {
    const runs: [number, number][] = [];
    let start = -1;
    let last = -10;
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const d = L[row + x] - L[row + W + x];
      if (d > EDGE || d < -EDGE) {
        if (start < 0) start = x;
        else if (x - last > gap + 1) {
          if (last - start + 1 >= minLen) runs.push([start, last]);
          start = x;
        }
        last = x;
      }
    }
    if (start >= 0 && last - start + 1 >= minLen) runs.push([start, last]);
    const next: Open[] = [];
    let p = 0;
    for (const [a, b] of runs) {
      while (p < open.length && open[p].x1 < a - 3) p++;
      const o = p < open.length && Math.abs(open[p].x1 - a) <= 3 && Math.abs(open[p].x2 - b) <= 3 ? open[p] : null;
      if (o) {
        p++;
        o.y1 = y;
        o.x1 = Math.min(o.x1, a);
        o.x2 = Math.max(o.x2, b);
        next.push(o);
      } else next.push({ x1: a, x2: b, y0: y, y1: y });
    }
    for (const o of open) if (o.y1 !== y) done.push(o);
    open = next.sort((m, n) => m.x1 - n.x1);
  }
  done.push(...open);
  const segs = done
    .filter((o) => o.y1 - o.y0 <= 4 * S)
    .map((o) => ({ y: (o.y0 + o.y1 + 1) / 2 / S, x1: o.x1 / S, x2: (o.x2 + 1) / S }));
  return mergeH(segs);
}

function findVSegs(L: Uint8Array, W: number, H: number): VSeg[] {
  const minLen = Math.round(2 * S);
  const gap = 2;
  type Open = { y1: number; y2: number; x0: number; x1: number };
  let open: Open[] = [];
  const done: Open[] = [];
  for (let x = 0; x < W - 1; x++) {
    const runs: [number, number][] = [];
    let start = -1;
    let last = -10;
    for (let y = 0; y < H; y++) {
      const i = y * W + x;
      const d = L[i] - L[i + 1];
      if (d > EDGE || d < -EDGE) {
        if (start < 0) start = y;
        else if (y - last > gap + 1) {
          if (last - start + 1 >= minLen) runs.push([start, last]);
          start = y;
        }
        last = y;
      }
    }
    if (start >= 0 && last - start + 1 >= minLen) runs.push([start, last]);
    const next: Open[] = [];
    let p = 0;
    for (const [a, b] of runs) {
      while (p < open.length && open[p].y1 < a - 3) p++;
      const o = p < open.length && Math.abs(open[p].y1 - a) <= 3 && Math.abs(open[p].y2 - b) <= 3 ? open[p] : null;
      if (o) {
        p++;
        o.x1 = x;
        o.y1 = Math.min(o.y1, a);
        o.y2 = Math.max(o.y2, b);
        next.push(o);
      } else next.push({ y1: a, y2: b, x0: x, x1: x });
    }
    for (const o of open) if (o.x1 !== x) done.push(o);
    open = next.sort((m, n) => m.y1 - n.y1);
  }
  done.push(...open);
  const segs = done
    .filter((o) => o.x1 - o.x0 <= 4 * S)
    .map((o) => ({ x: (o.x0 + o.x1 + 1) / 2 / S, y1: o.y1 / S, y2: (o.y2 + 1) / S }));
  return mergeV(segs);
}

/** Both edges of a stroked line show up as separate segments; fold near-duplicates together. */
function mergeH(segs: HSeg[]): HSeg[] {
  segs.sort((a, b) => a.y - b.y);
  const out: HSeg[] = [];
  for (const s of segs) {
    let m: HSeg | undefined;
    for (let k = out.length - 1; k >= 0 && out[k].y >= s.y - 3; k--) {
      const o = out[k];
      if (Math.abs(o.y - s.y) <= 1.6 && overlap(o.x1, o.x2, s.x1, s.x2) >= 0.8 * Math.min(o.x2 - o.x1, s.x2 - s.x1)) {
        m = o;
        break;
      }
    }
    if (m) {
      m.y = (m.y + s.y) / 2;
      m.x1 = Math.min(m.x1, s.x1);
      m.x2 = Math.max(m.x2, s.x2);
    } else out.push({ ...s });
  }
  return out;
}

function mergeV(segs: VSeg[]): VSeg[] {
  segs.sort((a, b) => a.x - b.x);
  const out: VSeg[] = [];
  for (const s of segs) {
    let m: VSeg | undefined;
    for (let k = out.length - 1; k >= 0 && out[k].x >= s.x - 3; k--) {
      const o = out[k];
      if (Math.abs(o.x - s.x) <= 1.6 && overlap(o.y1, o.y2, s.y1, s.y2) >= 0.8 * Math.min(o.y2 - o.y1, s.y2 - s.y1)) {
        m = o;
        break;
      }
    }
    if (m) {
      m.x = (m.x + s.x) / 2;
      m.y1 = Math.min(m.y1, s.y1);
      m.y2 = Math.max(m.y2, s.y2);
    } else out.push({ ...s });
  }
  return out;
}

// ------------------------------------------------------------------- boxes

function findBoxRows(hsegs: HSeg[], vsegs: VSeg[]): Rect[][] {
  const rows: Rect[][] = [];
  const tol = 2;
  const sorted = [...hsegs].sort((a, b) => a.y - b.y);
  const vs = [...vsegs].sort((a, b) => a.x - b.x);
  const firstAtX = (x: number) => {
    let lo = 0;
    let hi = vs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (vs[mid].x < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  for (let ti = 0; ti < sorted.length; ti++) {
    const top = sorted[ti];
    const covered: [number, number][] = [];
    for (let bi = ti + 1; bi < sorted.length; bi++) {
      const bot = sorted[bi];
      const h = bot.y - top.y;
      if (h < 5.5) continue;
      if (h > 60) break;
      const ox1 = Math.max(top.x1, bot.x1);
      const ox2 = Math.min(top.x2, bot.x2);
      if (ox2 - ox1 < 4) continue;
      const found: number[] = [];
      for (let k = firstAtX(ox1 - 3.5); k < vs.length && vs[k].x <= ox2 + 3.5; k++) {
        const v = vs[k];
        if (v.y1 <= top.y + tol && v.y2 >= bot.y - tol) found.push(v.x);
      }
      const xs = dedupeSorted(found, 1.5);
      if (xs.length < 2) continue;
      const cells: Rect[] = [];
      for (let k = 1; k < xs.length; k++) {
        const x1 = xs[k - 1];
        const x2 = xs[k];
        if (x2 - x1 < 4) continue;
        if (covered.some(([a, b]) => overlap(a, b, x1, x2) > 1)) continue;
        cells.push({ x: x1, y: top.y, w: x2 - x1, h });
      }
      if (!cells.length) continue;
      cells.forEach((c) => covered.push([c.x, c.x + c.w]));
      top.used = true;
      bot.used = true;
      rows.push(cells);
      if (covered.reduce((s, [a, b]) => s + b - a, 0) >= (top.x2 - top.x1) * 0.9) break;
    }
  }
  return rows;
}

/** Interior of a box should be mostly white to be an input area. */
function isBlank(r: Rect, L: Uint8Array, W: number): boolean {
  const i = inner(r);
  const x1 = Math.round(i.x * S);
  const x2 = Math.round((i.x + i.w) * S);
  const y1 = Math.round(i.y * S);
  const y2 = Math.round((i.y + i.h) * S);
  if (x2 <= x1 || y2 <= y1) return false;
  let white = 0;
  let total = 0;
  for (let y = y1; y < y2; y += 1) {
    for (let x = x1; x < x2; x += 1) {
      total++;
      if (L[y * W + x] > 165) white++;
    }
  }
  return white / total > 0.86;
}

// -------------------------------------------------------------------- text

function inner(r: Rect): Rect {
  const ix = Math.max(2, r.w * 0.22);
  const iy = Math.max(2, r.h * 0.22);
  return { x: r.x + ix, y: r.y + iy, w: r.w - 2 * ix, h: r.h - 2 * iy };
}

function darkest(r: Rect, L: Uint8Array, W: number, H: number): number {
  let min = 255;
  const x1 = Math.max(0, Math.round(r.x * S));
  const x2 = Math.min(W, Math.round((r.x + r.w) * S));
  const y1 = Math.max(0, Math.round(r.y * S));
  const y2 = Math.min(H, Math.round((r.y + r.h) * S));
  for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) if (L[y * W + x] < min) min = L[y * W + x];
  return min;
}

async function getTextBoxes(page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>, vp1: pdfjs.PageViewport): Promise<TextBox[]> {
  const tc = await page.getTextContent();
  const out: TextBox[] = [];
  for (const it of tc.items) {
    if (!('str' in it) || !it.str.trim()) continue;
    const t = pdfjs.Util.transform(vp1.transform, it.transform);
    const fh = Math.hypot(t[2], t[3]) || it.height || 8;
    const w = it.width || fh * it.str.length * 0.5;
    out.push({ str: it.str, fh, x: t[4], y: t[5] - fh * 0.78, w, h: fh * 0.98 });
  }
  return out;
}

const LEADER = /^[\s_.…]+$/;

function hasText(r: Rect, texts: TextBox[]): boolean {
  for (const t of texts) {
    if (LEADER.test(t.str)) continue;
    const ox = overlap(t.x, t.x + t.w, r.x, r.x + r.w);
    const oy = overlap(t.y, t.y + t.h, r.y, r.y + r.h);
    if (ox <= 0 || oy <= 0) continue;
    // A lone glyph that is itself the box (e.g. a ☐ from a symbol font) doesn't count.
    if (t.str.trim().length === 1 && t.w >= r.w * 0.6) continue;
    if ((ox * oy) / Math.max(t.w * t.h, 1) > 0.3) return true;
  }
  return false;
}

function textSitsOn(s: HSeg, texts: TextBox[]): boolean {
  let covered = 0;
  for (const t of texts) {
    if (LEADER.test(t.str)) continue;
    const bottom = t.y + t.h;
    if (bottom > s.y - 4.5 && bottom < s.y + 1.5) covered += overlap(t.x, t.x + t.w, s.x1, s.x2);
  }
  return covered > (s.x2 - s.x1) * 0.35;
}

function underlineHeight(s: HSeg, texts: TextBox[], hsegs: HSeg[]): number {
  let room = 15;
  for (const t of texts) {
    if (overlap(t.x, t.x + t.w, s.x1 + 2, s.x2 - 2) <= 0) continue;
    const gap = s.y - (t.y + t.h);
    if (gap > 0 && gap < room) room = gap;
  }
  for (const o of hsegs) {
    if (o === s || overlap(o.x1, o.x2, s.x1, s.x2) < 5) continue;
    const gap = s.y - o.y;
    if (gap > 1 && gap < room) room = gap;
  }
  return room - 0.5;
}

// -------------------------------------------------------------- acroforms

async function getAcroFields(
  page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>,
  vp1: pdfjs.PageViewport,
  pageIndex: number,
  values: Values,
): Promise<Field[]> {
  const anns = await page.getAnnotations();
  const out: Field[] = [];
  for (const a of anns) {
    if (a.annotationType !== 20 /* WIDGET */ || !a.fieldName) continue;
    const [x1, y1, x2, y2] = vp1.convertToViewportRectangle(a.rect);
    const r = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    const id = newId();
    if (a.fieldType === 'Tx') {
      const comb = a.comb && a.maxLen > 1;
      out.push({ ...r, id, page: pageIndex, type: comb ? 'comb' : 'text', cells: comb ? a.maxLen : undefined, multiline: a.multiLine || undefined, name: a.fieldName, acroName: a.fieldName, source: 'acro' });
      if (typeof a.fieldValue === 'string' && a.fieldValue) values[id] = a.fieldValue;
    } else if (a.fieldType === 'Btn' && (a.checkBox || a.radioButton)) {
      out.push({ ...r, id, page: pageIndex, type: 'checkbox', name: a.fieldName, acroName: a.fieldName, source: 'acro' });
      if (a.fieldValue && a.fieldValue !== 'Off' && (a.checkBox || a.fieldValue === a.buttonValue)) values[id] = true;
    } else if (a.fieldType === 'Ch') {
      out.push({ ...r, id, page: pageIndex, type: 'text', name: a.fieldName, acroName: a.fieldName, source: 'acro' });
    }
  }
  return out;
}

// ------------------------------------------------------------------ naming

function nameFields(fields: Field[], texts: TextBox[]) {
  const labels = texts.filter((t) => /[A-Za-z]{2,}/.test(t.str) && !LEADER.test(t.str));
  for (const f of fields) {
    if (f.name) continue;
    const cy = f.y + f.h / 2;
    const sameLine = (t: TextBox) => Math.abs(t.y + t.h / 2 - cy) < Math.max(f.h / 2, 6);
    let best: TextBox | undefined;
    if (f.type === 'checkbox') {
      best = labels
        .filter((t) => sameLine(t) && t.x >= f.x + f.w - 1 && t.x < f.x + f.w + 40)
        .sort((a, b) => a.x - b.x)[0];
    }
    best ??= labels
      .filter((t) => sameLine(t) && t.x + t.w <= f.x + 3 && t.x + t.w > f.x - 220)
      .sort((a, b) => b.x + b.w - (a.x + a.w))[0];
    best ??= labels
      .filter((t) => t.y + t.h <= f.y + 2 && t.y + t.h > f.y - 14 && overlap(t.x, t.x + t.w, f.x, f.x + f.w) > 0)
      .sort((a, b) => b.y - a.y)[0];
    f.name = best ? cleanLabel(best.str) : '';
  }
}

function cleanLabel(s: string): string {
  const words = s.replace(/[_.…]{2,}/g, ' ').replace(/[:*]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  return words.slice(0, 6).join(' ').slice(0, 48).replace(/[\s/,;-]+$/, '');
}

export function uniqueNames(fields: Field[]) {
  const seen = new Map<string, number>();
  const counters: Record<string, number> = {};
  for (const f of fields) {
    if (!f.name) {
      counters[f.type] = (counters[f.type] ?? 0) + 1;
      f.name = `${f.type} ${f.page + 1}.${counters[f.type]}`;
    }
    const key = f.name.toLowerCase();
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n) f.name = `${f.name} (${n + 1})`;
  }
}

// ------------------------------------------------------------------- utils

function dedupe(fields: Field[]): Field[] {
  const prio = (f: Field) => (f.type === 'comb' ? 0 : f.type === 'checkbox' ? 1 : 2);
  const sorted = [...fields].sort((a, b) => prio(a) - prio(b));
  const out: Field[] = [];
  for (const f of sorted) {
    const clash = out.some((o) => {
      const ix = overlap(o.x, o.x + o.w, f.x, f.x + f.w);
      const iy = overlap(o.y, o.y + o.h, f.y, f.y + f.h);
      const inter = ix * iy;
      return inter > 0.5 * Math.min(o.w * o.h, f.w * f.h);
    });
    if (!clash) out.push(f);
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** A run of boxes can come out in pieces (cells paired with slightly different bottoms); join touching pieces. */
function mergeCombs(fields: Field[]): Field[] {
  const boxes = fields.filter((f) => f.type === 'comb' || f.type === 'checkbox').sort((a, b) => a.y - b.y || a.x - b.x);
  const gone = new Set<Field>();
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    if (gone.has(a)) continue;
    for (let k = i + 1; k < boxes.length; k++) {
      const b = boxes[k];
      if (gone.has(b)) continue;
      if (b.y - a.y > 2) break;
      const gap = b.x - (a.x + a.w);
      if (Math.abs(b.y - a.y) > 2 || Math.abs(b.h - a.h) > 2 || gap < -1.5 || gap > 2.5) continue;
      const ca = a.w / (a.cells ?? 1);
      const cb = b.w / (b.cells ?? 1);
      if (Math.abs(ca - cb) / Math.max(ca, cb) > 0.35) continue;
      a.cells = (a.cells ?? 1) + (b.cells ?? 1);
      a.type = 'comb';
      a.w = b.x + b.w - a.x;
      a.h = Math.max(a.h, b.h);
      gone.add(b);
      k = i; // rescan: the grown field may now touch others
    }
  }
  return fields.filter((f) => !gone.has(f));
}

function overlap(a1: number, a2: number, b1: number, b2: number) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

function dedupeSorted(xs: number[], tol: number): number[] {
  const out: number[] = [];
  for (const x of xs) {
    if (out.length && x - out[out.length - 1] <= tol) out[out.length - 1] = (out[out.length - 1] + x) / 2;
    else out.push(x);
  }
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}
