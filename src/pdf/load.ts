import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
// Start the worker as soon as the app loads rather than on the first PDF, so a tab
// that has loaded keeps working even if the server (or network) goes away later.
try {
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: 'module' });
} catch {
  /* fall back to pdf.js creating it on demand from workerSrc */
}

export { pdfjs };
export type { PDFDocumentProxy };

export async function openPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  // pdf.js transfers the buffer to its worker, so hand it a copy.
  return pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}
