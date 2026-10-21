import { memo, useRef, useState } from 'react';
import type { Field, FieldValue, TextStyle } from '../types';
import { checkState, cssFamily, displayText, fitToWidth, fontSize, markFor, markStroke, resolveStyle } from '../style';
import { CheckMark } from './CheckMark';

interface Props {
  field: Field;
  zoom: number;
  value: FieldValue | undefined;
  edit: boolean;
  selected: boolean;
  docStyle: TextStyle | undefined;
  onValue: (id: string, v: FieldValue | null) => void;
  /** Move focus to the next (1) or previous (-1) field. */
  onNav: (id: string, dir: 1 | -1) => void;
}

/** Enter → next field, Shift+Enter → previous (in multi-line text Shift+Enter is a new line). */
function enterNav(e: React.KeyboardEvent, id: string, onNav: Props['onNav'], multiline = false): boolean {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.altKey || e.ctrlKey || e.metaKey) return false;
  if (multiline && e.shiftKey) return false;
  e.preventDefault();
  onNav(id, e.shiftKey ? -1 : 1);
  return true;
}

export const FieldView = memo(function FieldView({ field: f, zoom, value, edit, selected, docStyle, onValue, onNav }: Props) {
  const rs = resolveStyle({ style: docStyle }, f);
  let size = fontSize(rs, f);
  if (f.type === 'text' && !f.multiline && typeof value === 'string') size = fitToWidth(displayText(rs, value), rs, size, f.w - 4);
  const style: React.CSSProperties = {
    left: f.x * zoom,
    top: f.y * zoom,
    width: f.w * zoom,
    height: f.h * zoom,
    fontSize: size * zoom,
    fontFamily: cssFamily(rs),
    fontWeight: rs.bold ? 700 : 400,
    fontStyle: rs.italic ? 'italic' : 'normal',
    color: rs.color,
    textTransform: rs.caps ? 'uppercase' : 'none',
  };
  const cls = `field f-${f.type} ${selected ? 'sel' : ''} ${value !== undefined && value !== '' ? 'has' : ''}`;
  const mk = f.type === 'checkbox' ? markFor(rs, value) : null;
  const cs = checkState(value);

  if (edit) {
    return (
      <div className={cls} style={style} data-fid={f.id} title={f.name}>
        {f.type === 'comb' && <CombGuides cells={f.cells ?? 1} />}
        {f.type === 'checkbox' ? (
          mk ? <span className="ghost-val"><CheckMark mark={mk.mark} size={mk.size} color={mk.color} stroke={markStroke(rs)} /></span> : cs === 'unchecked' ? <span className="off-hint" /> : null
        ) : (
          <span className="ghost-val">{String(value ?? '')}</span>
        )}
        {selected && <span className="tag">{f.name}{f.type === 'comb' ? ` · ${f.cells ?? 1} boxes` : ''}</span>}
        {selected && f.type === 'comb' && <span className="edge" data-handle="cells" title="Drag to add or remove boxes" />}
        {selected && <span className="handle" data-handle="1" title="Drag to resize" />}
      </div>
    );
  }

  if (f.type === 'checkbox') {
    return (
      <button
        type="button"
        className={cls}
        style={style}
        data-fid={f.id}
        title={`${f.name} — ${cs === 'unset' ? 'not set' : cs}. Click: not set → checked → unchecked. Del: not set.`}
        role="checkbox"
        aria-checked={cs === 'checked' ? 'true' : cs === 'unchecked' ? 'false' : 'mixed'}
        aria-label={`${f.name} (${cs === 'unset' ? 'not set' : cs})`}
        data-state={cs}
        onClick={() => onValue(f.id, cs === 'unset' ? true : cs === 'checked' ? false : null)}
        onKeyDown={(e) => {
          if (enterNav(e, f.id, onNav)) return;
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            onValue(f.id, null);
          }
        }}
      >
        {mk ? <CheckMark mark={mk.mark} size={mk.size} color={mk.color} stroke={markStroke(rs)} /> : cs === 'unchecked' ? <span className="off-hint" /> : null}
      </button>
    );
  }

  if (f.type === 'comb') return <CombInput f={f} style={style} cls={cls} value={String(value ?? '')} caps={rs.caps} onValue={onValue} onNav={onNav} />;

  const common = {
    className: 'fill-input',
    value: String(value ?? ''),
    'aria-label': f.name,
    title: f.name,
    spellCheck: false,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onValue(f.id, e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => enterNav(e, f.id, onNav, !!f.multiline),
  };
  return (
    <div className={cls} style={style} data-fid={f.id}>
      {f.multiline ? <div className="ta-wrap"><textarea {...common} rows={1} /></div> : <input {...common} />}
    </div>
  );
});

function CombGuides({ cells }: { cells: number }) {
  return (
    <span className="comb-guides">
      {Array.from({ length: cells }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}

function CombInput({ f, style, cls, value, caps, onValue, onNav }: {
  f: Field;
  style: React.CSSProperties;
  cls: string;
  value: string;
  caps: boolean;
  onValue: (id: string, v: string) => void;
  onNav: Props['onNav'];
}) {
  const n = Math.max(1, f.cells ?? 1);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [all, setAll] = useState(false); // whole field selected (Ctrl/Cmd+A)
  const chars = [...value.padEnd(n, ' ')].slice(0, n);
  const shown = (caps ? value.toUpperCase() : value).replace(/\s+$/, '');

  const commit = (next: string[]) => onValue(f.id, next.join('').replace(/\s+$/, ''));
  const focus = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(n - 1, i))];
    el?.focus();
    el?.select();
  };
  /** Writes text into the boxes from `start`; drops spaces/dashes when it otherwise wouldn't fit. */
  const fill = (raw: string, start: number, base: string[]) => {
    let text = raw.replace(/[\r\n\t]+/g, ' ').trim();
    if ([...text].length > n - start) text = text.replace(/[\s-]+/g, '');
    const t = [...text];
    const next = [...base];
    t.forEach((c, k) => start + k < n && (next[start + k] = c));
    commit(next);
    focus(start + t.length);
  };
  const blank = () => Array<string>(n).fill(' ');

  return (
    <div
      className={`${cls} ${all ? 'all-sel' : ''}`}
      style={style}
      data-fid={f.id}
      title={`${f.name} — Ctrl/⌘+A selects all boxes, Ctrl/⌘+C copies the whole value`}
      role="group"
      aria-label={f.name}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setAll(false)}
      onMouseDown={() => setAll(false)}
    >
      {chars.map((ch, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          className="cell"
          value={ch === ' ' ? '' : ch}
          aria-label={`${f.name} ${i + 1}`}
          spellCheck={false}
          autoComplete="off"
          onFocus={(e) => e.target.select()}
          onCopy={(e) => {
            e.preventDefault();
            e.clipboardData.setData('text/plain', shown);
          }}
          onCut={(e) => {
            e.preventDefault();
            e.clipboardData.setData('text/plain', shown);
            setAll(false);
            commit(blank());
            focus(0);
          }}
          onChange={(e) => {
            if (all) {
              // Typing over a whole-field selection starts the value afresh.
              setAll(false);
              const raw = e.target.value;
              const typed = ch !== ' ' && raw.length > 1 ? raw.replace(ch, '') : raw;
              if (typed) fill(typed, 0, blank());
              else {
                commit(blank());
                focus(0);
              }
              return;
            }
            let v = e.target.value;
            if (ch !== ' ' && v.length > 1) v = v.replace(ch, '');
            const typed = [...v];
            if (!typed.length) {
              const next = [...chars];
              next[i] = ' ';
              return commit(next);
            }
            const next = [...chars];
            typed.forEach((c, k) => i + k < n && (next[i + k] = c));
            commit(next);
            focus(i + typed.length);
          }}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData('text');
            if (all) {
              setAll(false);
              fill(text, 0, blank());
            } else fill(text, i, chars);
          }}
          onKeyDown={(e) => {
            if (enterNav(e, f.id, onNav)) return;
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.key.toLowerCase() === 'a') {
              e.preventDefault();
              setAll(true);
              return;
            }
            if (all) {
              if (e.key === 'Backspace' || e.key === 'Delete') {
                e.preventDefault();
                setAll(false);
                commit(blank());
                focus(0);
                return;
              }
              if (e.key === 'Escape' || e.key.startsWith('Arrow')) setAll(false);
            }
            if (e.key === 'Backspace') {
              e.preventDefault();
              const next = [...chars];
              if (ch !== ' ') next[i] = ' ';
              else if (i > 0) next[i - 1] = ' ';
              commit(next);
              if (ch === ' ') focus(i - 1);
            } else if (e.key === 'Delete') {
              e.preventDefault();
              const next = [...chars];
              next[i] = ' ';
              commit(next);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              focus(i - 1);
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              focus(i + 1);
            } else if (e.key === ' ' && ch === ' ') {
              e.preventDefault();
              focus(i + 1);
            }
          }}
        />
      ))}
    </div>
  );
}
