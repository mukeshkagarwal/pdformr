# PDFormr

PDF Form Editing made easy.

**PDFormr** is a browser-based app for filling PDF forms. Users sign in with **Google or Facebook** (Supabase Auth); PDFs and form data are never uploaded and stay in the browser, in a separate workspace per account.

- Drop or choose a PDF and give it a unique name. The name is the key the form's data is saved under, in IndexedDB.
- Fields are detected automatically:
  - real AcroForm fields, when the PDF has them;
  - for flat PDFs, the page is rendered and its lines are analysed to find boxed (comb) fields, plain boxes, underlines, `____` / `.....` leaders and checkboxes.
- **Fill** mode: type into fields. Boxed fields take one character per box and move to the next box as you type. Checkboxes have three states — click (or Space) cycles **not set → checked → unchecked**, Delete resets to not set; *not set* prints nothing. **Enter** moves to the next field in reading order, **Shift+Enter** to the previous one (in multi-line fields Shift+Enter adds a new line). In boxed fields, **Ctrl/⌘+C** / **X** copies / cuts the whole value from any box, **Ctrl/⌘+A** selects all boxes (then type, paste or Delete to replace/clear), and paste fills from the current box — dropping spaces/dashes if the text wouldn't otherwise fit.
- **Edit fields** mode: select, move or resize fields, change their type or number of boxes, add new fields (Text / Boxes / Check, then drag on the page), delete fields, undo, or re-run detection.
- **Aa Text style** (toolbar) sets the font, bold/italic, size (empty = auto-fit), colour, **all caps** (on by default) and the **checkbox marks** — a checked mark and an unchecked mark (tick, hand-drawn tick, cross, hand-drawn cross, dot, square, filled box, or none for unchecked; size S/M/L; the unchecked mark can have its own colour) — for the whole form. In Edit mode, a field can tick *Own text style* to override any of these. Text is always centred in its box (each comb character in its cell).
- **Download PDF** writes the values into a copy of the original PDF.
- **Export data / Import data** saves and loads the values as a `*.formdata.json` file. The file can be shared on its own and used to fill the form again later:
  - same PDF: the layout and values are restored exactly;
  - different PDF: values are matched by field name, then by position.
- Each browser tab keeps its own open form (in `sessionStorage`), so several tabs can work on different forms independently. If two tabs have the same form open, they stay in sync.

## Run

```bash
npm install
cp .env.example .env.local   # add your Supabase URL + publishable key (optional for dev)
npm run dev
```

Without `.env.local` the dev server skips sign-in and runs as a local user.

`npm run build` produces a static site in `dist/` that can be hosted anywhere (`npm run preview` serves it locally).

### Offline

The built app is an installable PWA. On the first visit a service worker caches every app file (including the pdf.js worker); after that the app opens, reloads and works with **no server or network**. Browsers like Chrome/Edge also offer *Install app* in the address bar. When a new version is deployed, a toast offers **Reload**; the app never reloads on its own mid-edit.

The service worker only runs in the built app (`npm run build` + any static host or `npm run preview`), not in `npm run dev`. In dev, the pdf.js worker is still started when the app loads, so a tab that has loaded keeps working if the dev server stops — but reloading needs the server.

## Notes

- Text is written with the standard Helvetica font, so characters outside Latin‑1 (for example Devanagari) are replaced with `?` in the downloaded PDF.
- Detection is heuristic. Check the result in Edit mode and fix anything it got wrong.
