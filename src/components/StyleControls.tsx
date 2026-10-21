import type { TextStyle } from '../types';
import { CHECK_MARKS, CHECK_SIZES, DEFAULT_STYLE, FAMILIES, SWATCHES, markStroke, type CheckMark as CheckMarkId, type ResolvedStyle } from '../style';
import { CheckMark } from './CheckMark';

interface Props {
  value: TextStyle;
  onChange: (patch: Partial<TextStyle>) => void;
  /** Which controls to show: text styling, checkbox mark, or both (form-wide). */
  mode?: 'all' | 'text' | 'checkbox';
  /** Placeholder for an empty size box. */
  sizeHint?: string;
}

export function StyleControls({ value, onChange, mode = 'all', sizeHint = 'auto' }: Props) {
  const v = { ...DEFAULT_STYLE, ...stripUndef(value) };
  return (
    <div className="style-ctl">
      {mode !== 'checkbox' && (
        <>
          <label className="stack">
            <span>Font</span>
            <select className="input" value={v.family} onChange={(e) => onChange({ family: e.target.value as TextStyle['family'] })}>
              {FAMILIES.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </label>
          <div className="row tight style-row">
            <div className="seg">
              <button type="button" className={v.bold ? 'on' : ''} aria-pressed={v.bold} title="Bold" onClick={() => onChange({ bold: !v.bold })}>
                <b>B</b>
              </button>
              <button type="button" className={v.italic ? 'on' : ''} aria-pressed={v.italic} title="Italic" onClick={() => onChange({ italic: !v.italic })}>
                <i>I</i>
              </button>
              <button type="button" className={`caps-btn ${v.caps ? 'on' : ''}`} aria-pressed={v.caps} title="All caps: show and print values in capital letters" onClick={() => onChange({ caps: !v.caps })}>
                AA
              </button>
            </div>
            <label className="num-in size-in" title="Font size in points. Leave empty to auto-fit each box.">
              <span>Size</span>
              <input
                type="number"
                min={4}
                max={48}
                step={0.5}
                placeholder={sizeHint}
                value={v.size ?? ''}
                onChange={(e) => onChange({ size: e.target.value ? Math.max(4, Math.min(48, parseFloat(e.target.value))) : undefined })}
              />
            </label>
            {v.size !== undefined && (
              <button type="button" className="btn sm ghost" onClick={() => onChange({ size: undefined })} title="Clear the size">
                {sizeHint === 'auto' ? 'Auto' : 'Reset'}
              </button>
            )}
          </div>
        </>
      )}
      <div className="stack">
        <span>Colour</span>
        <div className="swatches">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch ${v.color.toLowerCase() === c ? 'on' : ''}`}
              style={{ background: c }}
              aria-label={`Colour ${c}`}
              onClick={() => onChange({ color: c })}
            />
          ))}
          <input type="color" value={v.color} onChange={(e) => onChange({ color: e.target.value })} aria-label="Custom colour" title="Custom colour" />
        </div>
      </div>
      {mode !== 'text' && (
        <>
          <MarkPicker
            label="Checked mark"
            mark={v.check}
            size={v.checkSize}
            stroke={markStroke(v as ResolvedStyle)}
            onMark={(m) => onChange({ check: m as TextStyle['check'] })}
            onSize={(z) => onChange({ checkSize: z })}
          />
          <MarkPicker
            label="Unchecked mark"
            allowNone
            mark={v.uncheck}
            size={v.uncheckSize}
            stroke={markStroke(v as ResolvedStyle)}
            onMark={(m) => onChange({ uncheck: m as TextStyle['uncheck'] })}
            onSize={(z) => onChange({ uncheckSize: z })}
          />
          {v.uncheck !== 'none' && (
            <div className="stack">
              <span>Unchecked colour</span>
              <div className="swatches">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`swatch ${(v.uncheckColor ?? v.color).toLowerCase() === c ? 'on' : ''}`}
                    style={{ background: c }}
                    aria-label={`Unchecked colour ${c}`}
                    onClick={() => onChange({ uncheckColor: c })}
                  />
                ))}
                <input type="color" value={v.uncheckColor ?? v.color} onChange={(e) => onChange({ uncheckColor: e.target.value })} aria-label="Custom unchecked colour" />
                {v.uncheckColor && (
                  <button type="button" className="btn sm ghost" onClick={() => onChange({ uncheckColor: undefined })} title="Use the main colour">
                    Same
                  </button>
                )}
              </div>
            </div>
          )}
          <p className="hint">Click a box to cycle: not set → checked → unchecked. Not set prints nothing.</p>
        </>
      )}
    </div>
  );
}

function stripUndef<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined)) as Partial<T>;
}

function MarkPicker(p: {
  label: string;
  mark: string;
  size: number;
  stroke: number;
  allowNone?: boolean;
  onMark: (m: string) => void;
  onSize: (z: number) => void;
}) {
  const options = [...(p.allowNone ? [{ id: 'none', label: 'None' }] : []), ...CHECK_MARKS];
  return (
    <div className="stack">
      <span>{p.label}</span>
      <div className="row tight mark-row">
        <div className="seg marks" role="radiogroup" aria-label={p.label}>
          {options.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={p.mark === m.id}
              className={p.mark === m.id ? 'on' : ''}
              title={m.label}
              aria-label={`${p.label}: ${m.label}`}
              onClick={() => p.onMark(m.id)}
            >
              <span className="mark-box">
                {m.id !== 'none' && <CheckMark mark={m.id as CheckMarkId} size={0.8} stroke={p.stroke} />}
              </span>
            </button>
          ))}
        </div>
        {p.mark !== 'none' && (
          <div className="seg sizes" role="radiogroup" aria-label={`${p.label} size`}>
            {CHECK_SIZES.map((z) => (
              <button
                key={z.label}
                type="button"
                role="radio"
                aria-checked={p.size === z.value}
                className={p.size === z.value ? 'on' : ''}
                title={`Size ${z.label}`}
                onClick={() => p.onSize(z.value)}
              >
                {z.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
