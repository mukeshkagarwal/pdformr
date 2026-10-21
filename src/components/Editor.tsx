import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findDoc, getPdfBytes, saveDoc } from '../storage/db';
import { broadcastChange, onRemoteChange } from '../storage/tabSession';
import { newId, openPdf, type PDFDocumentProxy } from '../pdf/load';
import { detectAll, rowDividers, uniqueNames } from '../pdf/detect';
import { buildFilledPdf, downloadBlob } from '../pdf/export';
import { addUnmatched, applyFormData, exportFormData, parseFormData } from '../pdf/formData';
import type { DocRecord, Field, FieldType, FieldValue, FormDataFile, Rect } from '../types';
import type { ToastApi } from './Toasts';
import { PageView } from './PageView';
import { StyleControls } from './StyleControls';
import { UserMenu } from '../auth/UserMenu';
import { isFilled } from '../style';
import { FieldPanel, type CellStrategy } from './FieldPanel';

export type Mode = 'fill' | 'edit';
export type Tool = 'select' | FieldType;

interface Props {
  name: string;
  onClose: () => void;
  toast: ToastApi;
  pendingImport: FormDataFile | null;
  onImportConsumed: () => void;
}

type Viewport = { convertToPdfPoint: (x: number, y: number) => number[] };

export function Editor({ name, onClose, toast, pendingImport, onImportConsumed }: Props) {
  const [doc, setDoc] = useState<DocRecord | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('fill');
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [styleOpen, setStyleOpen] = useState(false);
  useEffect(() => {
    if (!styleOpen) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as HTMLElement).closest('.pop-anchor')) setStyleOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [styleOpen]);
  const bytes = useRef<ArrayBuffer | null>(null);
  const viewports = useRef<Viewport[]>([]);
  const history = useRef<Field[][]>([]);
  const dirty = useRef(false);
  const lastSaved = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const importInput = useRef<HTMLInputElement>(null);

  // ------------------------------------------------------------ loading
  useEffect(() => {
    let live = true;
    let loaded: PDFDocumentProxy | null = null;
    (async () => {
      const [d, b] = await Promise.all([findDoc(name), getPdfBytes(name)]);
      if (!d || !b) throw new Error(`Form "${name}" was not found in this browser.`);
      const p = await openPdf(b);
      loaded = p;
      const vps: Viewport[] = [];
      for (let i = 1; i <= p.numPages; i++) vps.push((await p.getPage(i)).getViewport({ scale: 1 }));
      if (!live) return;
      bytes.current = b;
      viewports.current = vps;
      lastSaved.current = d.updatedAt;
      setDoc(d);
      setPdf(p);
      const avail = (scroller.current?.clientWidth ?? 900) - 40;
      const maxW = Math.max(...d.pages.map((pg) => pg.w));
      setZoom(clampZoom(Math.min(1.6, avail / maxW)));
    })().catch((e) => live && setError(String(e.message ?? e)));
    return () => {
      live = false;
      loaded?.destroy();
    };
  }, [name]);

  // ------------------------------------------------------------- saving
  useEffect(() => {
    if (!doc || !dirty.current) return;
    const t = setTimeout(async () => {
      dirty.current = false;
      const at = await saveDoc(doc);
      lastSaved.current = at;
      broadcastChange(doc.name, at);
    }, 350);
    return () => clearTimeout(t);
  }, [doc]);

  // Another tab edited the same form: pull its version in.
  useEffect(
    () =>
      onRemoteChange(async (m) => {
        if (m.doc !== name.trim().toLowerCase() || m.updatedAt <= lastSaved.current) return;
        const d = await findDoc(name);
        if (d && d.updatedAt > lastSaved.current) {
          lastSaved.current = d.updatedAt;
          dirty.current = false;
          setDoc(d);
        }
      }),
    [name],
  );

  // ----------------------------------------------------------- mutation
  const mutate = useCallback((fn: (d: DocRecord) => Partial<DocRecord>, opts: { history?: boolean } = {}) => {
    setDoc((d) => {
      if (!d) return d;
      const patch = fn(d);
      if (opts.history && patch.fields) {
        history.current.push(d.fields);
        if (history.current.length > 60) history.current.shift();
      }
      dirty.current = true;
      return { ...d, ...patch };
    });
  }, []);

  const setValue = useCallback(
    (id: string, v: FieldValue | null) =>
      mutate((d) => {
        const values = { ...d.values };
        if (v === null) delete values[id];
        else values[id] = v;
        return { values };
      }),
    [mutate],
  );

  const snapshot = useCallback(() => {
    setDoc((d) => {
      if (d) history.current.push(d.fields);
      return d;
    });
  }, []);

  const changeField = useCallback(
    (id: string, patch: Partial<Field>, withHistory = false) =>
      mutate((d) => ({ fields: d.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) }), { history: withHistory }),
    [mutate],
  );

  const deleteField = useCallback(
    (id: string) => {
      mutate(
        (d) => {
          const values = { ...d.values };
          delete values[id];
          return { fields: d.fields.filter((f) => f.id !== id), values };
        },
        { history: true },
      );
      setSelected(null);
    },
    [mutate],
  );

  const addField = useCallback(
    (page: number, type: FieldType, r: Rect) => {
      const id = newId();
      mutate(
        (d) => {
          const f: Field = { id, page, type, ...r, name: '', source: 'user' };
          if (type === 'comb') f.cells = Math.max(2, Math.round(r.w / Math.max(r.h, 6)));
          const fields = [...d.fields, f];
          f.name = nextName(fields, type, page);
          return { fields };
        },
        { history: true },
      );
      setSelected(id);
    },
    [mutate],
  );

  const duplicateField = useCallback(
    (id: string) => {
      const nid = newId();
      mutate(
        (d) => {
          const src = d.fields.find((f) => f.id === id);
          if (!src) return {};
          const f: Field = { ...src, id: nid, y: src.y + src.h + 4, source: 'user' };
          const fields = [...d.fields, f];
          f.name = nextName(fields, f.type, f.page, src.name);
          return { fields };
        },
        { history: true },
      );
      setSelected(nid);
    },
    [mutate],
  );

  const setCells = useCallback(
    async (f: Field, n: number, strategy: CellStrategy) => {
      const old = Math.max(1, f.cells ?? 1);
      const cw = f.w / old;
      let patch: Partial<Field> = { cells: n };
      if (strategy === 'keepBox') patch.w = round1(cw * n);
      else if (strategy === 'auto') {
        const xs = pdf ? await rowDividers(pdf, f.page, f).catch(() => []) : [];
        if (xs.length > n) {
          patch = { cells: n, x: round1(xs[0]), w: round1(xs[n] - xs[0]) };
        } else {
          patch.w = round1(cw * n);
          toast.show(
            xs.length > 1
              ? `Only ${xs.length - 1} printed boxes found on this row — kept box size for the rest.`
              : 'No printed boxes found on this row — kept box size.',
          );
        }
      }
      changeField(f.id, patch, true);
    },
    [pdf, changeField, toast],
  );

  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return toast.show('Nothing to undo.');
    dirty.current = true;
    setDoc((d) => (d ? { ...d, fields: prev } : d));
  }, [toast]);

  // ------------------------------------------------------------ actions
  const doImport = useCallback(
    (data: FormDataFile) => {
      if (!doc) return;
      const r = applyFormData(doc, data);
      mutate(() => ({ fields: r.fields, values: r.values, style: r.style }), { history: true });
      const msg = r.sameLayout
        ? `Imported ${r.matched} fields with their values.`
        : `Imported values into ${r.matched} matching field${r.matched === 1 ? '' : 's'}.` +
          (r.unmatched.length ? ` ${r.unmatched.length} had no match.` : '');
      toast.show(msg, {
        action: r.unmatched.length
          ? {
              label: `Add ${r.unmatched.length} as new fields`,
              run: () => mutate((d) => addUnmatched(d, r.unmatched), { history: true }),
            }
          : undefined,
      });
    },
    [doc, mutate, toast],
  );

  useEffect(() => {
    if (doc && pendingImport) {
      doImport(pendingImport);
      onImportConsumed();
    }
  }, [doc, pendingImport, doImport, onImportConsumed]);

  async function importFile(file: File) {
    try {
      doImport(parseFormData(await file.text()));
    } catch (e) {
      toast.show(`Import failed: ${(e as Error).message ?? e}`, { kind: 'error' });
    }
  }

  function exportData() {
    if (!doc) return;
    downloadBlob(JSON.stringify(exportFormData(doc), null, 2), `${safeFile(doc.name)}.formdata.json`, 'application/json');
  }

  async function downloadPdf() {
    if (!doc || !bytes.current) return;
    setBusy('Building PDF…');
    try {
      const out = await buildFilledPdf(bytes.current, doc, (p, x, y) => {
        const [px, py] = viewports.current[p].convertToPdfPoint(x, y);
        return [px, py];
      });
      downloadBlob(out, `${safeFile(doc.name)}.pdf`, 'application/pdf');
    } catch (e) {
      console.error(e);
      toast.show(`Could not build PDF: ${(e as Error).message ?? e}`, { kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function redetect() {
    if (!doc || !pdf) return;
    if (!confirm('Re-run field detection? Auto-detected fields are replaced (with their values); fields you added are kept.')) return;
    setBusy('Detecting fields…');
    try {
      const r = await detectAll(pdf, (p, n) => setBusy(`Detecting fields… page ${p} of ${n}`));
      mutate(
        (d) => {
          const kept = d.fields.filter((f) => f.source === 'user');
          const keptIds = new Set(kept.map((f) => f.id));
          const values = Object.fromEntries(Object.entries(d.values).filter(([k]) => keptIds.has(k)));
          const fields = [...kept, ...r.fields];
          uniqueNames(fields);
          return { fields, values: { ...values, ...r.values } };
        },
        { history: true },
      );
      setSelected(null);
      toast.show(`Detected ${r.fields.length} fields.`);
    } finally {
      setBusy(null);
    }
  }

  function clearValues() {
    if (!doc || !confirm('Clear all filled values for this form?')) return;
    mutate(() => ({ values: {} }));
  }

  // ----------------------------------------------------------- keyboard
  const sel = doc?.fields.find((f) => f.id === selected) ?? null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && mode === 'edit' && !typing) {
        e.preventDefault();
        undo();
        return;
      }
      if (mode !== 'edit' || typing) return;
      if (e.key === 'Escape') {
        setSelected(null);
        setTool('select');
      } else if (sel && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        deleteField(sel.id);
      } else if (sel && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 0.5;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (e.altKey) changeField(sel.id, { w: Math.max(3, sel.w + dx), h: Math.max(3, sel.h + dy) });
        else changeField(sel.id, { x: sel.x + dx, y: sel.y + dy });
      } else if (sel && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateField(sel.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, sel, undo, deleteField, changeField, duplicateField]);

  // Reading order: page, then top-to-bottom, with fields on the same line left-to-right.
  const order = useMemo(() => {
    if (!doc) return [] as Field[];
    return [...doc.fields].sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      const dy = a.y + a.h / 2 - (b.y + b.h / 2);
      if (Math.abs(dy) < Math.min(a.h, b.h) / 2) return a.x - b.x;
      return dy;
    });
  }, [doc?.fields]);

  const valuesRef = useRef(doc?.values);
  valuesRef.current = doc?.values;

  const nav = useCallback(
    (id: string, dir: 1 | -1) => {
      const i = order.findIndex((f) => f.id === id);
      const target = order[i + dir];
      if (i < 0 || !target) return;
      const focus = (tries: number) => {
        const el = document.querySelector<HTMLElement>(`.pages [data-fid="${target.id}"]`);
        if (!el) {
          // Field's page isn't rendered yet: bring it into view and retry.
          if (tries === 0) document.querySelectorAll('.page-outer')[target.page]?.scrollIntoView({ block: 'start' });
          if (tries < 30) requestAnimationFrame(() => focus(tries + 1));
          return;
        }
        let input: HTMLElement | null;
        if (target.type === 'comb') {
          const cells = el.querySelectorAll<HTMLInputElement>('input');
          const filled = String(valuesRef.current?.[target.id] ?? '').length;
          input = cells[Math.min(filled, cells.length - 1)] ?? null;
        } else input = el.matches('button, input, textarea') ? el : el.querySelector('input, textarea');
        input?.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (input instanceof HTMLInputElement && target.type === 'text') input.select();
      };
      focus(0);
    },
    [order],
  );

  const byPage = useMemo(() => {
    const m: Field[][] = doc ? doc.pages.map(() => []) : [];
    doc?.fields.forEach((f) => m[f.page]?.push(f));
    return m;
  }, [doc]);

  const filled = doc ? Object.values(doc.values).filter(isFilled).length : 0;

  if (error)
    return (
      <div className="center-msg">
        <p className="warn">{error}</p>
        <button className="btn" onClick={onClose}>Back to forms</button>
      </div>
    );

  return (
    <div className={`editor mode-${mode}`}>
      <header className="toolbar">
        <button className="btn ghost" onClick={onClose} title="All forms">‹ Forms</button>
        <span className="doc-name" title={doc?.fileName}>{name}</span>
        <span className="sep" />
        <div className="seg" role="tablist" aria-label="Mode">
          <button className={mode === 'fill' ? 'on' : ''} onClick={() => { setMode('fill'); setTool('select'); setSelected(null); }}>Fill</button>
          <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>Edit fields</button>
        </div>
        {mode === 'edit' && (
          <>
            <div className="seg" aria-label="Tool">
              {(
                [
                  ['select', '↖ Select'],
                  ['text', '+ Text'],
                  ['comb', '+ Boxes'],
                  ['checkbox', '+ Check'],
                ] as [Tool, string][]
              ).map(([t, label]) => (
                <button key={t} className={tool === t ? 'on' : ''} onClick={() => setTool(t)} title={t === 'select' ? 'Select / move fields' : `Drag on the page to add a ${t === 'comb' ? 'boxed (comb)' : t} field`}>
                  {label}
                </button>
              ))}
            </div>
            <button className="btn ghost" onClick={undo} title="Undo (Ctrl/Cmd+Z)">↶ Undo</button>
            <button className="btn ghost" onClick={redetect} title="Run automatic field detection again">⟳ Re-detect</button>
          </>
        )}
        <div className="pop-anchor">
          <button className={`btn ghost ${styleOpen ? 'pressed' : ''}`} onClick={() => setStyleOpen((o) => !o)} title="Font, size and colour for the whole form" aria-expanded={styleOpen}>
            <span className="aa">Aa</span> Text style
          </button>
          {styleOpen && doc && (
            <div className="popover" role="dialog" aria-label="Form text style">
              <h4>Form text style</h4>
              <StyleControls value={doc.style ?? {}} onChange={(patch) => mutate((d) => ({ style: { ...d.style, ...patch } }))} />
              {(() => {
                const n = doc.fields.filter((f) => f.style || f.fontSize).length;
                return n ? (
                  <p className="hint row">
                    {n} field{n === 1 ? ' has its' : 's have their'} own style.
                    <button className="btn sm ghost" onClick={() => mutate((d) => ({ fields: d.fields.map((f) => ({ ...f, style: undefined, fontSize: undefined })) }), { history: true })}>
                      Reset all
                    </button>
                  </p>
                ) : null;
              })()}
              <p className="hint">Text is centred in every box. Leave size empty to auto-fit. AA = all caps. Bold also thickens tick/cross marks.</p>
              <div className="row end">
                <button className="btn sm" onClick={() => setStyleOpen(false)}>Done</button>
              </div>
            </div>
          )}
        </div>
        <span className="grow" />
        <div className="zoom">
          <button className="btn ghost icon" onClick={() => setZoom((z) => clampZoom(z - 0.1))} aria-label="Zoom out">−</button>
          <button className="btn ghost zoom-val" onClick={() => {
            const avail = (scroller.current?.clientWidth ?? 900) - 40;
            if (doc) setZoom(clampZoom(avail / Math.max(...doc.pages.map((p) => p.w))));
          }} title="Fit width">{Math.round(zoom * 100)}%</button>
          <button className="btn ghost icon" onClick={() => setZoom((z) => clampZoom(z + 0.1))} aria-label="Zoom in">+</button>
        </div>
        <span className="sep" />
        <button className="btn ghost" onClick={() => importInput.current?.click()} title="Load values from a .formdata.json file">Import data</button>
        <button className="btn ghost" onClick={exportData} title="Download the filled values as JSON to share or reuse">Export data</button>
        <button className="btn ghost" onClick={clearValues}>Clear</button>
        <button className="btn primary" onClick={downloadPdf} disabled={!doc}>Download PDF</button>
        <UserMenu />
        <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) importFile(f);
        }} />
      </header>

      <div className="body">
        <div
          className="pages"
          ref={scroller}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f && /\.json$/i.test(f.name)) importFile(f);
            else if (f) toast.show('Drop a .formdata.json file here to import values.', { kind: 'error' });
          }}
        >
          {!doc || !pdf ? (
            <div className="center-msg"><span className="spinner" /> Loading…</div>
          ) : (
            doc.pages.map((pg, i) => (
              <PageView
                key={i}
                index={i}
                pdf={pdf}
                info={pg}
                zoom={zoom}
                fields={byPage[i]}
                values={doc.values}
                docStyle={doc.style}
                mode={mode}
                tool={tool}
                selected={selected}
                onSelect={setSelected}
                onSnapshot={snapshot}
                onChangeField={changeField}
                onAddField={(type, r) => {
                  addField(i, type, r);
                  setTool('select');
                }}
                onValue={setValue}
                onNav={nav}
              />
            ))
          )}
        </div>
        {mode === 'edit' && doc && (
          <FieldPanel
            doc={doc}
            field={sel}
            onChange={(patch) => sel && changeField(sel.id, patch, true)}
            onCells={(n, strategy) => sel && setCells(sel, n, strategy)}
            onDelete={() => sel && deleteField(sel.id)}
            onDuplicate={() => sel && duplicateField(sel.id)}
            onSelect={(id) => {
              setSelected(id);
              document.querySelector(`[data-fid="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }}
          />
        )}
      </div>

      <footer className="status">
        <span>{doc ? `${doc.pages.length} page${doc.pages.length === 1 ? '' : 's'} · ${doc.fields.length} fields · ${filled} filled` : ''}</span>
        <span className="grow" />
        <span className="muted">
          {mode === 'edit'
            ? tool === 'select'
              ? 'Click a field to select · drag to move · corner to resize · Del to remove · arrows nudge (Alt = resize)'
              : 'Drag on the page to draw the new field · Esc to cancel'
            : 'Saved automatically in this browser'}
        </span>
      </footer>

      {busy && (
        <div className="modal-back">
          <div className="modal busy"><span className="spinner" /> {busy}</div>
        </div>
      )}
    </div>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function clampZoom(z: number) {
  return Math.min(4, Math.max(0.3, Math.round(z * 100) / 100));
}

function safeFile(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'form';
}

function nextName(fields: Field[], type: FieldType, page: number, base?: string) {
  const names = new Set(fields.map((f) => f.name.toLowerCase()));
  const stem = base ?? `${type} ${page + 1}`;
  for (let n = 1; ; n++) {
    const cand = base ? `${stem} (${n + 1})` : `${stem}.${n}`;
    if (!names.has(cand.toLowerCase())) return cand;
  }
}
