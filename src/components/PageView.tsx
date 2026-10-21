import { memo, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from '../pdf/load';
import type { Field, FieldType, FieldValue, PageInfo, Rect, TextStyle, Values } from '../types';
import type { Mode, Tool } from './Editor';
import { FieldView } from './FieldView';

interface Props {
  index: number;
  pdf: PDFDocumentProxy;
  info: PageInfo;
  zoom: number;
  fields: Field[];
  values: Values;
  docStyle: TextStyle | undefined;
  mode: Mode;
  tool: Tool;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onSnapshot: () => void;
  onChangeField: (id: string, patch: Partial<Field>) => void;
  onAddField: (type: FieldType, r: Rect) => void;
  onValue: (id: string, v: FieldValue | null) => void;
  onNav: (id: string, dir: 1 | -1) => void;
}

type Drag =
  | { kind: 'move' | 'resize' | 'cells'; id: string; sx: number; sy: number; orig: Rect & { cells: number } }
  | { kind: 'draw'; sx: number; sy: number; cur: Rect };

export const PageView = memo(function PageView(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const W = p.info.w * p.zoom;
  const H = p.info.h * p.zoom;

  useEffect(() => {
    const el = wrap.current!;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let live = true;
    const t = setTimeout(async () => {
      let page;
      try {
        page = await p.pdf.getPage(p.index + 1);
      } catch {
        return; // document was closed
      }
      if (!live) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: p.zoom * dpr });
      const c = canvas.current!;
      const off = document.createElement('canvas');
      off.width = Math.ceil(vp.width);
      off.height = Math.ceil(vp.height);
      task = page.render({ canvasContext: off.getContext('2d')!, viewport: vp });
      try {
        await task.promise;
      } catch {
        return; // cancelled or document closed
      }
      if (!live) return;
      c.width = off.width;
      c.height = off.height;
      c.getContext('2d')!.drawImage(off, 0, 0);
    }, 60);
    return () => {
      live = false;
      clearTimeout(t);
      task?.cancel();
    };
  }, [visible, p.zoom, p.pdf, p.index]);

  const edit = p.mode === 'edit';

  const toPt = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / p.zoom, y: (e.clientY - r.top) / p.zoom };
  };

  function onPointerDown(e: React.PointerEvent) {
    if (!edit || e.button !== 0) return;
    const target = e.target as HTMLElement;
    const fieldEl = target.closest<HTMLElement>('[data-fid]');
    const pt = toPt(e);
    if (p.tool === 'select') {
      if (!fieldEl) {
        p.onSelect(null);
        return;
      }
      const id = fieldEl.dataset.fid!;
      const f = p.fields.find((x) => x.id === id);
      if (!f) return;
      p.onSelect(id);
      p.onSnapshot();
      wrap.current!.setPointerCapture(e.pointerId);
      const h = target.dataset.handle;
      setDrag({
        kind: h === 'cells' ? 'cells' : h ? 'resize' : 'move',
        id, sx: pt.x, sy: pt.y,
        orig: { x: f.x, y: f.y, w: f.w, h: f.h, cells: Math.max(1, f.cells ?? 1) },
      });
      e.preventDefault();
    } else {
      wrap.current!.setPointerCapture(e.pointerId);
      setDrag({ kind: 'draw', sx: pt.x, sy: pt.y, cur: { x: pt.x, y: pt.y, w: 0, h: 0 } });
      e.preventDefault();
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const pt = toPt(e);
    const dx = pt.x - drag.sx;
    const dy = pt.y - drag.sy;
    if (drag.kind === 'draw') {
      setDrag({ ...drag, cur: { x: Math.min(drag.sx, pt.x), y: Math.min(drag.sy, pt.y), w: Math.abs(dx), h: Math.abs(dy) } });
    } else if (drag.kind === 'cells') {
      // Box size stays fixed; dragging the edge adds or removes whole boxes.
      const cw = drag.orig.w / drag.orig.cells;
      const n = Math.max(1, Math.min(200, Math.round((drag.orig.w + dx) / cw)));
      p.onChangeField(drag.id, { cells: n, w: round(n * cw) });
    } else if (drag.kind === 'move') {
      p.onChangeField(drag.id, { x: round(drag.orig.x + dx), y: round(drag.orig.y + dy) });
    } else {
      p.onChangeField(drag.id, { w: round(Math.max(4, drag.orig.w + dx)), h: round(Math.max(4, drag.orig.h + dy)) });
    }
  }

  function onPointerUp() {
    if (drag?.kind === 'draw') {
      const r = drag.cur;
      const t = p.tool as FieldType;
      if (r.w < 3 && r.h < 3) {
        // Plain click: drop a default-sized field.
        const def = t === 'checkbox' ? { w: 10, h: 10 } : t === 'comb' ? { w: 120, h: 14 } : { w: 140, h: 14 };
        p.onAddField(t, { x: round(r.x), y: round(r.y - def.h / 2), ...def });
      } else {
        const rr = t === 'checkbox' ? { ...r, w: Math.max(r.w, r.h), h: Math.max(r.w, r.h) } : r;
        p.onAddField(t, { x: round(rr.x), y: round(rr.y), w: round(Math.max(rr.w, 6)), h: round(Math.max(rr.h, 6)) });
      }
    }
    setDrag(null);
  }

  return (
    <div className="page-outer">
      <div className="page-label">Page {p.index + 1}</div>
      <div
        ref={wrap}
        className={`page ${edit && p.tool !== 'select' ? 'drawing' : ''}`}
        style={{ width: W, height: H }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        <canvas ref={canvas} style={{ width: W, height: H }} />
        {visible &&
          p.fields.map((f) => (
            <FieldView
              key={f.id}
              field={f}
              zoom={p.zoom}
              value={p.values[f.id]}
              edit={edit}
              selected={p.selected === f.id}
              docStyle={p.docStyle}
              onValue={p.onValue}
              onNav={p.onNav}
            />
          ))}
        {drag?.kind === 'draw' && (
          <div
            className="draft"
            style={{ left: drag.cur.x * p.zoom, top: drag.cur.y * p.zoom, width: drag.cur.w * p.zoom, height: drag.cur.h * p.zoom }}
          />
        )}
      </div>
    </div>
  );
});

const round = (n: number) => Math.round(n * 10) / 10;
