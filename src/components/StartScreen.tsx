import { useEffect, useRef, useState } from 'react';
import { createDoc, deleteDoc, findDoc, listDocs } from '../storage/db';
import { openPdf } from '../pdf/load';
import { detectAll } from '../pdf/detect';
import { parseFormData } from '../pdf/formData';
import { isFilled } from '../style';
import type { DocRecord, FormDataFile } from '../types';
import type { ToastApi } from './Toasts';
import { UserMenu } from '../auth/UserMenu';
import { APP_NAME } from '../brand';

interface Props {
  onOpen: (name: string, data?: FormDataFile) => void;
  toast: ToastApi;
}

export function StartScreen({ onOpen, toast }: Props) {
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [drag, setDrag] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const refresh = () => listDocs().then(setDocs);
  useEffect(() => {
    refresh();
  }, []);

  async function takeFile(file: File) {
    if (/\.json$/i.test(file.name) || file.type === 'application/json') {
      try {
        const data = parseFormData(await file.text());
        const doc = await findDoc(data.docName);
        if (!doc) {
          toast.show(`No saved PDF named "${data.docName}". Open the PDF first, then import this data from the editor.`, { kind: 'error', ms: 6000 });
          return;
        }
        onOpen(doc.name, data);
      } catch (e) {
        toast.show(String((e as Error).message ?? e), { kind: 'error' });
      }
      return;
    }
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      toast.show('Please choose a PDF file (or a .json form data file).', { kind: 'error' });
      return;
    }
    setPending(file);
  }

  async function create(name: string, file: File) {
    setPending(null);
    setBusy('Reading PDF…');
    try {
      const bytes = await file.arrayBuffer();
      const pdf = await openPdf(bytes);
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const vp = (await pdf.getPage(i)).getViewport({ scale: 1 });
        pages.push({ w: vp.width, h: vp.height });
      }
      const { fields, values } = await detectAll(pdf, (p, n) => setBusy(`Detecting fields… page ${p} of ${n}`));
      const now = Date.now();
      await createDoc(
        { name, fileName: file.name, fingerprint: pdf.fingerprints[0] ?? '', pages, fields, values, createdAt: now, updatedAt: now },
        bytes,
      );
      pdf.destroy();
      toast.show(`Found ${fields.length} field${fields.length === 1 ? '' : 's'} in ${pages.length} page${pages.length === 1 ? '' : 's'}.`);
      onOpen(name);
    } catch (e) {
      console.error(e);
      toast.show(`Could not open PDF: ${(e as Error).message ?? e}`, { kind: 'error', ms: 6000 });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="start">
      <header className="start-head">
        <div className="brand">
          <img className="logo" src="./icon.svg" alt="" width={20} height={20} /> {APP_NAME}
        </div>
        <span className="grow" />
        <span className="muted sm hide-narrow">Your forms stay in this browser — nothing is uploaded.</span>
        <UserMenu />
      </header>

      <div
        className={`drop ${drag ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) takeFile(f);
        }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      >
        <div className="drop-icon" aria-hidden>⇪</div>
        <div><b>Drop a PDF here</b> or click to choose</div>
        <div className="muted sm">You can also drop a saved <code>.formdata.json</code> to reopen its form with the data filled in</div>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf,application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) takeFile(f);
          }}
        />
      </div>

      <section className="saved">
        <h2>Saved forms</h2>
        {docs.length === 0 ? (
          <p className="muted">No saved forms yet.</p>
        ) : (
          <table className="doc-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>File</th>
                <th className="num">Fields</th>
                <th className="num">Filled</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.name} onClick={() => onOpen(d.name)}>
                  <td><b>{d.name}</b></td>
                  <td className="muted ellipsis">{d.fileName}</td>
                  <td className="num">{d.fields.length}</td>
                  <td className="num">{Object.values(d.values).filter(isFilled).length}</td>
                  <td className="muted">{new Date(d.updatedAt).toLocaleString()}</td>
                  <td className="actions">
                    <button className="btn sm" onClick={(e) => { e.stopPropagation(); onOpen(d.name); }}>Open</button>
                    <button
                      className="btn sm ghost danger"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!confirm(`Delete "${d.name}" and its saved data from this browser?`)) return;
                        await deleteDoc(d.name);
                        refresh();
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {pending && (
        <NamePrompt
          file={pending}
          onCancel={() => setPending(null)}
          onCreate={(name) => create(name, pending)}
          onOpenExisting={(name) => {
            setPending(null);
            onOpen(name);
          }}
          onReplace={async (name) => {
            await deleteDoc(name);
            create(name, pending);
          }}
        />
      )}
      {busy && (
        <div className="modal-back">
          <div className="modal busy"><span className="spinner" /> {busy}</div>
        </div>
      )}
    </div>
  );
}

function NamePrompt(props: {
  file: File;
  onCancel: () => void;
  onCreate: (name: string) => void;
  onOpenExisting: (name: string) => void;
  onReplace: (name: string) => void;
}) {
  const [name, setName] = useState(props.file.name.replace(/\.pdf$/i, ''));
  const [taken, setTaken] = useState<DocRecord | null>(null);
  const trimmed = name.trim();

  useEffect(() => {
    let live = true;
    if (!trimmed) return setTaken(null);
    findDoc(trimmed).then((d) => live && setTaken(d ?? null));
    return () => {
      live = false;
    };
  }, [trimmed]);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed && !taken) props.onCreate(trimmed);
        }}
      >
        <h3>Name this form</h3>
        <p className="muted sm">A unique name keeps this form's data separate from others. File: {props.file.name}</p>
        <input className="input" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. NRI account – John" />
        {taken && (
          <p className="warn sm">
            "{taken.name}" already exists ({taken.fileName}). Choose another name, open it, or replace it.
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn ghost" onClick={props.onCancel}>Cancel</button>
          {taken ? (
            <>
              <button type="button" className="btn danger" onClick={() => confirm(`Replace "${taken.name}"? Its saved data will be lost.`) && props.onReplace(taken.name)}>
                Replace
              </button>
              <button type="button" className="btn primary" onClick={() => props.onOpenExisting(taken.name)}>Open existing</button>
            </>
          ) : (
            <button type="submit" className="btn primary" disabled={!trimmed}>Continue</button>
          )}
        </div>
      </form>
    </div>
  );
}
