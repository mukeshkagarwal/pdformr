export type FieldType = 'text' | 'comb' | 'checkbox';

/** Rect in page viewport units at scale 1 (PDF points, top-left origin). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextStyle {
  family?: 'Helvetica' | 'Times' | 'Courier';
  bold?: boolean;
  italic?: boolean;
  size?: number; // pt; undefined = auto-fit to the box
  color?: string; // #rrggbb
  caps?: boolean; // print values in capitals (default on)
  check?: 'tick' | 'hand' | 'cross' | 'handx' | 'dot' | 'square' | 'fill'; // checkbox mark shape
  checkSize?: number; // mark size as a fraction of the box (0.5–1)
  uncheck?: 'none' | 'tick' | 'hand' | 'cross' | 'handx' | 'dot' | 'square' | 'fill'; // mark printed for an explicitly unchecked box
  uncheckSize?: number;
  uncheckColor?: string; // defaults to `color`
}

export interface Field extends Rect {
  id: string;
  page: number; // 0-based
  type: FieldType;
  name: string;
  cells?: number; // comb only
  /** Overrides of the form-wide style for this field only. */
  style?: TextStyle;
  /** @deprecated legacy per-field size; read as style.size */
  fontSize?: number;
  multiline?: boolean;
  source: 'auto' | 'user' | 'acro';
  acroName?: string; // original AcroForm field name
}

export type FieldValue = string | boolean;
export type Values = Record<string, FieldValue>;

export interface PageInfo {
  w: number;
  h: number;
}

export interface DocRecord {
  name: string;
  fileName: string;
  fingerprint: string;
  pages: PageInfo[];
  fields: Field[];
  values: Values;
  /** Form-wide text style; fields may override parts of it. */
  style?: TextStyle;
  createdAt: number;
  updatedAt: number;
}

export interface FormDataFile {
  format: 'pdf-form-data';
  version: 1;
  docName: string;
  fileName?: string;
  pdfFingerprint: string;
  exportedAt: string;
  style?: TextStyle;
  fields: (Omit<Field, 'source'> & { source?: Field['source']; value: FieldValue | null })[];
}
