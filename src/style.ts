import { StandardFonts } from 'pdf-lib';
import type { DocRecord, Field, TextStyle } from './types';

export type FontFamily = 'Helvetica' | 'Times' | 'Courier';

export const FAMILIES: { id: FontFamily; label: string; css: string }[] = [
  { id: 'Helvetica', label: 'Helvetica (sans)', css: 'Helvetica, Arial, sans-serif' },
  { id: 'Times', label: 'Times (serif)', css: '"Times New Roman", Times, serif' },
  { id: 'Courier', label: 'Courier (mono)', css: '"Courier New", Courier, monospace' },
];

export const DEFAULT_STYLE: Required<Omit<TextStyle, 'size' | 'uncheckColor'>> & { size?: number; uncheckColor?: string } = {
  family: 'Helvetica',
  bold: false,
  italic: false,
  size: undefined,
  color: '#0d1a59',
  caps: true,
  check: 'tick',
  checkSize: 0.8,
  uncheck: 'none',
  uncheckSize: 0.8,
  uncheckColor: undefined as unknown as string,
};

export type CheckMark = NonNullable<TextStyle['check']>;

/** Mark geometry in a unit box (0..1, y down), shared by the preview and the PDF writer. */
export type MarkShape =
  | { kind: 'lines'; pts: [number, number][][] }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  /** Filled SVG path in unit coords; may extend outside 0..1 (e.g. a tail past the box). */
  | { kind: 'path'; d: string };

/**
 * Hand-drawn tick: a pen stroke that starts thin, thickens at the bottom of the V and
 * tapers into a long tail flying out past the top-right corner of the box.
 */
const HAND_TICK =
  'M0.07 0.50 C0.15 0.47 0.25 0.60 0.35 0.77 ' +
  'C0.50 0.43 0.78 0.04 1.34 -0.32 ' +
  'C0.88 0.07 0.60 0.47 0.41 0.93 ' +
  'C0.37 0.99 0.30 0.98 0.27 0.91 ' +
  'C0.22 0.77 0.15 0.62 0.07 0.50 Z';

/**
 * Hand-drawn cross: two tapered pen strokes. The first starts heavy at top-left and
 * tapers out past the bottom-right corner; the second starts outside the top-right
 * corner and ends heavy at bottom-left. Both sub-paths wind the same way so they fill as one.
 */
const HAND_CROSS =
  'M0.06 0.10 C0.10 0.05 0.17 0.06 0.22 0.11 ' +
  'C0.46 0.36 0.78 0.70 1.24 1.20 ' +
  'C0.74 0.84 0.42 0.52 0.09 0.24 ' +
  'C0.04 0.20 0.03 0.13 0.06 0.10 Z ' +
  'M1.30 -0.30 C0.92 0.12 0.56 0.50 0.26 0.84 ' +
  'C0.20 0.92 0.11 0.94 0.08 0.87 ' +
  'C0.06 0.80 0.12 0.74 0.17 0.69 ' +
  'C0.48 0.40 0.86 0.06 1.30 -0.30 Z';

export const CHECK_MARKS: { id: CheckMark; label: string; shape: MarkShape }[] = [
  { id: 'tick', label: 'Tick', shape: { kind: 'lines', pts: [[[0.14, 0.54], [0.4, 0.8], [0.88, 0.2]]] } },
  { id: 'hand', label: 'Hand tick', shape: { kind: 'path', d: HAND_TICK } },
  { id: 'cross', label: 'Cross', shape: { kind: 'lines', pts: [[[0.18, 0.18], [0.82, 0.82]], [[0.82, 0.18], [0.18, 0.82]]] } },
  { id: 'handx', label: 'Hand cross', shape: { kind: 'path', d: HAND_CROSS } },
  { id: 'dot', label: 'Dot', shape: { kind: 'circle', cx: 0.5, cy: 0.5, r: 0.3 } },
  { id: 'square', label: 'Square', shape: { kind: 'rect', x: 0.2, y: 0.2, w: 0.6, h: 0.6 } },
  { id: 'fill', label: 'Fill box', shape: { kind: 'rect', x: 0, y: 0, w: 1, h: 1 } },
];

export const CHECK_SIZES: { label: string; value: number }[] = [
  { label: 'S', value: 0.6 },
  { label: 'M', value: 0.8 },
  { label: 'L', value: 1 },
];

/** Three-state checkbox value: true = checked, false = unchecked, undefined = not set. */
export type CheckState = 'checked' | 'unchecked' | 'unset';
export function checkState(v: unknown): CheckState {
  return v === true ? 'checked' : v === false ? 'unchecked' : 'unset';
}

/** The mark to draw for a checkbox value, or null when nothing is printed. */
export function markFor(s: ResolvedStyle, v: unknown): { mark: CheckMark; size: number; color: string } | null {
  const st = checkState(v);
  if (st === 'checked') return { mark: s.check, size: s.checkSize, color: s.color };
  if (st === 'unchecked' && s.uncheck !== 'none') return { mark: s.uncheck, size: s.uncheckSize, color: s.uncheckColor };
  return null;
}

/** A value counts as filled once it's set — an explicitly unchecked box is filled. */
export function isFilled(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

export function markShape(m: CheckMark): MarkShape {
  return (CHECK_MARKS.find((x) => x.id === m) ?? CHECK_MARKS[0]).shape;
}

/** Stroke width for line marks, relative to the mark's side. */
export function markStroke(s: ResolvedStyle): number {
  return s.bold ? 0.17 : 0.12;
}

export const SWATCHES = ['#0d1a59', '#000000', '#1d4ed8', '#374151', '#b91c1c', '#047857'];

/** Cap height as a fraction of the font size; used to centre glyphs vertically. */
const CAP: Record<FontFamily, number> = { Helvetica: 0.718, Times: 0.662, Courier: 0.571 };

export interface ResolvedStyle {
  family: FontFamily;
  bold: boolean;
  italic: boolean;
  size?: number; // undefined = auto
  color: string;
  caps: boolean;
  check: CheckMark;
  checkSize: number;
  uncheck: CheckMark | 'none';
  uncheckSize: number;
  uncheckColor: string;
}

/** Form-wide style, with the field's own overrides (if any) layered on top. */
export function resolveStyle(doc: Pick<DocRecord, 'style'>, f: Field): ResolvedStyle {
  const d = { ...DEFAULT_STYLE, ...stripUndef(doc.style ?? {}) };
  const o = stripUndef(f.style ?? {});
  return {
    family: (o.family ?? d.family) as FontFamily,
    bold: o.bold ?? d.bold,
    italic: o.italic ?? d.italic,
    size: o.size ?? f.fontSize ?? d.size,
    color: o.color ?? d.color,
    caps: o.caps ?? d.caps,
    check: (o.check ?? d.check) as CheckMark,
    checkSize: o.checkSize ?? d.checkSize,
    uncheck: (o.uncheck ?? d.uncheck) as CheckMark | 'none',
    uncheckSize: o.uncheckSize ?? d.uncheckSize,
    uncheckColor: o.uncheckColor ?? o.color ?? d.uncheckColor ?? d.color,
  };
}

function stripUndef<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Size used when the style says "auto": fits the box (or one comb cell). */
export function autoSize(f: Field): number {
  if (f.type === 'comb') return Math.max(5, Math.min(12, f.h * 0.62, (f.w / (f.cells || 1)) * 0.8));
  if (f.multiline) return Math.min(10, Math.max(6, f.h * 0.5));
  return Math.min(11, Math.max(6, f.h * 0.62));
}

/** The text as it will be shown and printed (values are stored as typed). */
export function displayText(s: ResolvedStyle, text: string): string {
  return s.caps ? text.toUpperCase() : text;
}

export function fontSize(s: ResolvedStyle, f: Field): number {
  return s.size ?? autoSize(f);
}

export function capHeight(s: ResolvedStyle): number {
  return CAP[s.family];
}

export function cssFamily(s: ResolvedStyle): string {
  return FAMILIES.find((x) => x.id === s.family)!.css;
}

export function standardFont(s: ResolvedStyle): StandardFonts {
  const b = s.bold;
  const i = s.italic;
  switch (s.family) {
    case 'Times':
      return b && i ? StandardFonts.TimesRomanBoldItalic : b ? StandardFonts.TimesRomanBold : i ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman;
    case 'Courier':
      return b && i ? StandardFonts.CourierBoldOblique : b ? StandardFonts.CourierBold : i ? StandardFonts.CourierOblique : StandardFonts.Courier;
    default:
      return b && i ? StandardFonts.HelveticaBoldOblique : b ? StandardFonts.HelveticaBold : i ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
  }
}

export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.05, 0.1, 0.35];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Shrinks an auto-sized single line so it fits the box width. */
let measureCtx: CanvasRenderingContext2D | null = null;
export function fitToWidth(text: string, s: ResolvedStyle, size: number, maxW: number): number {
  if (!text || s.size !== undefined) return size;
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return size;
  let z = size;
  const font = (n: number) => `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${n}px ${cssFamily(s)}`;
  measureCtx.font = font(100);
  const w100 = measureCtx.measureText(text).width;
  if (w100 > 0) z = Math.min(size, (maxW / w100) * 100);
  return Math.max(4, z);
}
