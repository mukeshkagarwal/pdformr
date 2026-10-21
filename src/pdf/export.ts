import {
  PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, StandardFonts, LineCapStyle, rgb, degrees,
  type PDFFont, type PDFPage, type RGB,
} from 'pdf-lib';
import type { DocRecord, Field } from '../types';
import { capHeight, displayText, fontSize, hexToRgb01, markFor, markShape, markStroke, resolveStyle, standardFont, type ResolvedStyle } from '../style';

/** Maps a point in page view space (scale 1, top-left origin) to PDF user space. */
export type ToPdf = (page: number, x: number, y: number) => [number, number];

export async function buildFilledPdf(
  bytes: ArrayBuffer,
  doc: Pick<DocRecord, 'fields' | 'values' | 'style'>,
  toPdf: ToPdf,
): Promise<Uint8Array> {
  const { fields, values } = doc;
  const pdf = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });
  const fonts = new Map<StandardFonts, Promise<PDFFont>>();
  const getFont = (name: StandardFonts) => {
    if (!fonts.has(name)) fonts.set(name, pdf.embedFont(name));
    return fonts.get(name)!;
  };
  const pages = pdf.getPages();
  const form = fields.some((f) => f.acroName) ? pdf.getForm() : null;

  for (const f of fields) {
    const v = values[f.id];
    if (v === undefined || v === '') continue;
    const page = pages[f.page];
    if (!page) continue;

    if (f.acroName && form && fillAcro(form, f, v)) continue;

    const style = resolveStyle(doc, f);
    if (f.type === 'checkbox' && !markFor(style, v)) continue;
    const ctx: DrawCtx = {
      page,
      font: await getFont(standardFont(style)),
      style,
      color: rgb(...hexToRgb01(style.color)),
      toPdf: (x, y) => toPdf(f.page, x, y),
      rot: page.getRotation().angle,
    };
    if (f.type === 'checkbox') drawCheck(ctx, f, markFor(style, v)!);
    else if (f.type === 'comb') drawComb(ctx, f, displayText(style, String(v)));
    else drawText(ctx, f, displayText(style, String(v)));
  }
  if (form) {
    try {
      form.updateFieldAppearances(await getFont(StandardFonts.Helvetica));
    } catch {
      /* keep existing appearances */
    }
  }
  return pdf.save();
}

function fillAcro(form: ReturnType<PDFDocument['getForm']>, f: Field, v: string | boolean): boolean {
  try {
    const field = form.getField(f.acroName!);
    if (field instanceof PDFTextField) {
      field.setText(String(v));
      return true;
    }
    if (field instanceof PDFCheckBox) {
      v ? field.check() : field.uncheck();
      return true;
    }
    if (field instanceof PDFDropdown) {
      field.select(String(v));
      return true;
    }
  } catch {
    /* fall back to drawing */
  }
  return false;
}

interface DrawCtx {
  page: PDFPage;
  font: PDFFont;
  style: ResolvedStyle;
  color: RGB;
  toPdf: (x: number, y: number) => [number, number];
  rot: number;
}

function safe(font: PDFFont, s: string): string {
  let out = '';
  for (const ch of s.replace(/\r/g, '')) {
    if (ch === '\n') {
      out += ch;
      continue;
    }
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

/** Draws text horizontally centred on cx with its cap height centred on cy. */
function putCentered(ctx: DrawCtx, text: string, cx: number, cy: number, size: number) {
  const w = ctx.font.widthOfTextAtSize(text, size);
  const [px, py] = ctx.toPdf(cx - w / 2, cy + (capHeight(ctx.style) * size) / 2);
  ctx.page.drawText(text, { x: px, y: py, size, font: ctx.font, color: ctx.color, rotate: degrees(ctx.rot) });
}

const PAD = 2;

function drawText(ctx: DrawCtx, f: Field, raw: string) {
  const text = safe(ctx.font, raw);
  const maxW = Math.max(1, f.w - PAD * 2);
  const auto = ctx.style.size === undefined;
  let size = fontSize(ctx.style, f);
  const cx = f.x + f.w / 2;

  if (f.multiline || text.includes('\n')) {
    const cap = capHeight(ctx.style);
    let lines = wrap(ctx.font, text, size, maxW);
    const blockH = (n: number, z: number) => (n - 1) * z * 1.2 + cap * z;
    while (auto && size > 4 && blockH(lines.length, size) > f.h - PAD * 2) {
      size -= 0.25;
      lines = wrap(ctx.font, text, size, maxW);
    }
    const top = f.y + (f.h - blockH(lines.length, size)) / 2 + (cap * size) / 2;
    lines.forEach((ln, i) => putCentered(ctx, ln, cx, top + i * size * 1.2, size));
    return;
  }
  if (auto) while (size > 4 && ctx.font.widthOfTextAtSize(text, size) > maxW) size -= 0.25;
  putCentered(ctx, text, cx, f.y + f.h / 2, size);
}

function drawComb(ctx: DrawCtx, f: Field, raw: string) {
  const cells = Math.max(1, f.cells ?? 1);
  const cw = f.w / cells;
  const chars = [...safe(ctx.font, raw)].slice(0, cells);
  const size = fontSize(ctx.style, f);
  chars.forEach((ch, i) => {
    if (ch !== ' ') putCentered(ctx, ch, f.x + cw * (i + 0.5), f.y + f.h / 2, size);
  });
}

function drawCheck(ctx: DrawCtx, f: Field, m: NonNullable<ReturnType<typeof markFor>>) {
  const side = Math.min(f.w, f.h);
  const s = side * m.size;
  const color = rgb(...hexToRgb01(m.color));
  const ox = f.x + (f.w - s) / 2;
  const oy = f.y + (f.h - s) / 2;
  const p = (u: number, v: number) => {
    const [x, y] = ctx.toPdf(ox + u * s, oy + v * s);
    return { x, y };
  };
  const sh = markShape(m.mark);
  if (sh.kind === 'lines') {
    const thickness = Math.max(0.6, s * markStroke(ctx.style));
    for (const pts of sh.pts) {
      for (let i = 1; i < pts.length; i++) {
        ctx.page.drawLine({ start: p(...pts[i - 1]), end: p(...pts[i]), thickness, color, lineCap: LineCapStyle.Round });
      }
    }
  } else if (sh.kind === 'path') {
    // drawSvgPath places the path's (0,0) at x/y and flips y, matching our unit box.
    const o = p(0, 0);
    ctx.page.drawSvgPath(sh.d, {
      x: o.x,
      y: o.y,
      scale: s,
      rotate: degrees(ctx.rot),
      color,
      ...(ctx.style.bold ? { borderColor: color, borderWidth: 0.05, borderLineCap: LineCapStyle.Round } : {}),
    });
  } else if (sh.kind === 'circle') {
    const c = p(sh.cx, sh.cy);
    ctx.page.drawCircle({ x: c.x, y: c.y, size: sh.r * s, color });
  } else {
    // Corners in PDF space; normalise so it works whatever the page rotation.
    const a = p(sh.x, sh.y);
    const b = p(sh.x + sh.w, sh.y + sh.h);
    ctx.page.drawRectangle({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y), color });
  }
}

function wrap(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const t = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(t, size) <= maxW || !line) line = t;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

export function downloadBlob(data: BlobPart, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
