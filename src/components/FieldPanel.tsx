import { useState } from 'react';
import type { DocRecord, Field, FieldType } from '../types';
import { StyleControls } from './StyleControls';

function stripUndef<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined)) as Partial<T>;
}

export type CellStrategy = 'auto' | 'keepBox' | 'keepWidth' | 'manual';

const STRATEGIES: [CellStrategy, string, string][] = [
  ['auto', 'Auto-fit', 'Snap the width to the boxes printed on the page (falls back to keeping box size).'],
  ['keepBox', 'Keep box size', 'Each box keeps its width; the field grows or shrinks.'],
  ['keepWidth', 'Keep width', 'The field keeps its width; boxes get narrower or wider.'],
  ['manual', 'Manual', 'The count changes without resizing — then drag the field’s purple edge handle (adds/removes boxes) or corner handle (free resize) to fit.'],
];
const KEY = 'pdf-form-editor:cell-strategy';

function loadStrategy(): CellStrategy {
  try {
    const v = localStorage.getItem(KEY);
    if (v && STRATEGIES.some(([k]) => k === v)) return v as CellStrategy;
  } catch {
    /* ignore */
  }
  return 'auto';
}

interface Props {
  doc: DocRecord;
  field: Field | null;
  onChange: (patch: Partial<Field>) => void;
  onCells: (n: number, strategy: CellStrategy) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSelect: (id: string) => void;
}

export function FieldPanel({ doc, field: f, onChange, onCells, onDelete, onDuplicate, onSelect }: Props) {
  const [strategy, setStrategy] = useState<CellStrategy>(loadStrategy);
  const pickStrategy = (v: CellStrategy) => {
    setStrategy(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* ignore */
    }
  };

  if (!f) {
    return (
      <aside className="panel">
        <h4>Fields <span className="muted">({doc.fields.length})</span></h4>
        <ul className="field-list">
          {doc.fields.map((x) => (
            <li key={x.id} onClick={() => onSelect(x.id)}>
              <span className={`dot t-${x.type}`} />
              <span className="ellipsis">{x.name}</span>
              <span className="muted sm">p{x.page + 1}</span>
            </li>
          ))}
        </ul>
      </aside>
    );
  }

  const num = (k: keyof Field, label: string, step = 0.5, min = 0) => (
    <label className="num-in">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        value={Number(f[k] ?? 0).toFixed(1).replace(/\.0$/, '')}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange({ [k]: v });
        }}
      />
    </label>
  );

  return (
    <aside className="panel">
      <h4>Field</h4>
      <label className="stack">
        <span>Name</span>
        <input className="input" value={f.name} onChange={(e) => onChange({ name: e.target.value })} />
      </label>
      <label className="stack">
        <span>Type</span>
        <select
          className="input"
          value={f.type}
          onChange={(e) => {
            const type = e.target.value as FieldType;
            onChange({ type, cells: type === 'comb' ? f.cells ?? Math.max(2, Math.round(f.w / Math.max(f.h, 6))) : undefined });
          }}
        >
          <option value="text">Text</option>
          <option value="comb">Boxed text (one char per box)</option>
          <option value="checkbox">Checkbox</option>
        </select>
      </label>
      {f.type === 'comb' && (
        <>
          <div className="stack">
            <span>When the box count changes</span>
            <div className="seg sm" role="radiogroup" aria-label="When the box count changes">
              {STRATEGIES.map(([k, label, tip]) => (
                <button key={k} type="button" role="radio" aria-checked={strategy === k} className={strategy === k ? 'on' : ''} title={tip} onClick={() => pickStrategy(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="hint">{STRATEGIES.find(([k]) => k === strategy)![2]}</p>
          <label className="stack">
            <span>Boxes</span>
            <div className="row tight">
              <button type="button" className="btn sm icon" aria-label="One box fewer" onClick={() => onCells(Math.max(1, (f.cells ?? 1) - 1), strategy)}>−</button>
              <input
                className="input"
                type="number"
                min={1}
                max={200}
                value={f.cells ?? 1}
                onChange={(e) => onCells(Math.max(1, Math.min(200, parseInt(e.target.value) || 1)), strategy)}
              />
              <button type="button" className="btn sm icon" aria-label="One box more" onClick={() => onCells(Math.min(200, (f.cells ?? 1) + 1), strategy)}>+</button>
            </div>
          </label>
        </>
      )}
      <div className="override">
        <label className="check-in">
          <input
            type="checkbox"
            checked={!!f.style}
            onChange={(e) => onChange(e.target.checked ? { style: {} } : { style: undefined, fontSize: undefined })}
          />
          Own text style for this field
        </label>
        {f.style ? (
          <StyleControls
            value={{ ...doc.style, ...stripUndef(f.style) }}
            mode={f.type === 'checkbox' ? 'checkbox' : 'text'}
            sizeHint="form"
            onChange={(patch) => onChange({ style: { ...f.style, ...patch } })}
          />
        ) : (
          <p className="hint">Uses the form’s text style (toolbar → Aa Text style).</p>
        )}
      </div>
      {f.type === 'text' && (
        <label className="check-in">
          <input type="checkbox" checked={!!f.multiline} onChange={(e) => onChange({ multiline: e.target.checked || undefined })} />
          Multi-line
        </label>
      )}
      <div className="grid4">
        {num('x', 'X')}
        {num('y', 'Y')}
        {num('w', 'W', 0.5, 3)}
        {num('h', 'H', 0.5, 3)}
      </div>
      <p className="muted sm">Page {f.page + 1} · {f.source === 'auto' ? 'auto-detected' : f.source === 'acro' ? 'PDF form field' : 'added by you'}</p>
      <div className="row">
        <button className="btn sm" onClick={onDuplicate} title="Ctrl/Cmd+D">Duplicate</button>
        <button className="btn sm danger" onClick={onDelete} title="Delete">Delete</button>
      </div>
    </aside>
  );
}
