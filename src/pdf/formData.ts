import type { DocRecord, Field, FieldValue, FormDataFile, Values } from '../types';
import { newId } from './load';

export function exportFormData(doc: DocRecord): FormDataFile {
  return {
    format: 'pdf-form-data',
    version: 1,
    docName: doc.name,
    fileName: doc.fileName,
    pdfFingerprint: doc.fingerprint,
    exportedAt: new Date().toISOString(),
    style: doc.style,
    fields: doc.fields.map((f) => ({ ...f, value: doc.values[f.id] ?? null })),
  };
}

export function parseFormData(text: string): FormDataFile {
  const data = JSON.parse(text);
  if (data?.format !== 'pdf-form-data' || !Array.isArray(data.fields)) {
    throw new Error('Not a form data file (expected "format": "pdf-form-data").');
  }
  return data as FormDataFile;
}

export interface ImportResult {
  fields: Field[];
  values: Values;
  style?: DocRecord['style'];
  matched: number;
  unmatched: FormDataFile['fields'];
  sameLayout: boolean;
}

/**
 * Applies imported data to a document. When the JSON came from the same PDF the
 * saved layout is restored exactly; otherwise values are matched to existing
 * fields by name, then by position on the same page.
 */
export function applyFormData(doc: DocRecord, data: FormDataFile): ImportResult {
  if (data.pdfFingerprint && data.pdfFingerprint === doc.fingerprint) {
    const fields: Field[] = [];
    const values: Values = {};
    for (const { value, ...f } of data.fields) {
      const field = { ...f, source: f.source ?? 'user', id: f.id || newId() } as Field;
      fields.push(field);
      if (value !== null && value !== undefined) values[field.id] = value;
    }
    return { fields, values, style: data.style ?? doc.style, matched: fields.length, unmatched: [], sameLayout: true };
  }

  const values: Values = { ...doc.values };
  const used = new Set<string>();
  const byName = new Map(doc.fields.map((f) => [f.name.toLowerCase(), f]));
  const unmatched: FormDataFile['fields'] = [];
  let matched = 0;
  for (const src of data.fields) {
    let target = byName.get((src.name ?? '').toLowerCase());
    if (target && (used.has(target.id) || !compatible(target, src.value))) target = undefined;
    if (!target) {
      let best = 0.5;
      for (const f of doc.fields) {
        if (f.page !== src.page || used.has(f.id) || !compatible(f, src.value)) continue;
        const s = iou(f, src);
        if (s > best) {
          best = s;
          target = f;
        }
      }
    }
    if (!target) {
      if (src.value !== null && src.value !== undefined && src.value !== '') unmatched.push(src);
      continue;
    }
    used.add(target.id);
    if (src.value !== null && src.value !== undefined) values[target.id] = src.value;
    matched++;
  }
  return { fields: doc.fields, values, style: data.style ?? doc.style, matched, unmatched, sameLayout: false };
}

/** Turns unmatched imported entries into new fields at their saved positions. */
export function addUnmatched(doc: DocRecord, entries: FormDataFile['fields']): { fields: Field[]; values: Values } {
  const fields = [...doc.fields];
  const values = { ...doc.values };
  for (const { value, ...f } of entries) {
    if (f.page >= doc.pages.length) continue;
    const field: Field = { ...f, id: newId(), source: 'user' };
    fields.push(field);
    if (value !== null) values[field.id] = value;
  }
  return { fields, values };
}

function compatible(f: Field, v: FieldValue | null) {
  if (v === null || v === undefined) return true;
  return f.type === 'checkbox' ? typeof v === 'boolean' : typeof v === 'string';
}

function iou(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}
