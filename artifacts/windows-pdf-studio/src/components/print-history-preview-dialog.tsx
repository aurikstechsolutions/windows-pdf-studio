import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, FileImage, FileText, LoaderCircle, X } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

type Props = {
  name: string;
  mimeType: string;
  url: string;
  onClose: () => void;
};

export function PrintHistoryPreviewDialog({ name, mimeType, url, onClose }: Props) {
  const isPdf = mimeType.toLowerCase() === 'application/pdf';
  const isImage = mimeType.toLowerCase().startsWith('image/');

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div className="history-preview-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="history-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="history-preview-title">
        <header className="history-preview-header">
          <div className="history-preview-heading">
            <span className="history-preview-icon">{isPdf ? <FileText size={17} /> : <FileImage size={17} />}</span>
            <div>
              <p>{isPdf ? 'PDF PREVIEW · SCROLL TO VIEW ALL PAGES' : 'IMAGE PREVIEW'}</p>
              <h2 id="history-preview-title" title={name}>{name}</h2>
            </div>
          </div>
          <button type="button" className="history-preview-close" aria-label="Close preview" onClick={onClose} autoFocus>
            <X size={18} />
          </button>
        </header>
        <div className={`history-preview-body ${isPdf ? 'is-pdf' : ''}`}>
          {isPdf
            ? <PdfDocumentView url={url} />
            : isImage
              ? <img className="history-preview-image" src={url} alt={name} />
              : <div className="history-preview-unsupported" role="status">
                  <AlertCircle size={22} />
                  <p>This file type can’t be previewed here.</p>
                  <a href={url} download={name}>Download file</a>
                </div>}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function PdfDocumentView({ url }: { url: string }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDocument(null);
    setLoading(true);
    setError(null);
    const task = pdfjs.getDocument({ url });
    task.promise.then((pdf) => {
      if (!active) return;
      setDocument(pdf);
      setLoading(false);
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : 'The PDF could not be opened.');
      setLoading(false);
    });
    return () => {
      active = false;
      void task.destroy();
    };
  }, [url]);

  if (loading) return <div className="history-preview-state"><LoaderCircle size={22} className="history-preview-spinner" /><span>Opening PDF…</span></div>;
  if (error || !document) return <div className="history-preview-state is-error" role="alert"><AlertCircle size={20} /><span>{error ?? 'The PDF could not be opened.'}</span></div>;

  return <div className="history-preview-pdf-scroll" aria-label={`${document.numPages} page PDF preview`}>
    {Array.from({ length: document.numPages }, (_, index) => (
      <PdfPreviewPage key={index + 1} document={document} pageNumber={index + 1} />
    ))}
  </div>;
}

function PdfPreviewPage({ document, pageNumber }: { document: PDFDocumentProxy; pageNumber: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: ReturnType<PDFPageProxy['render']> | null = null;
    const renderPage = async () => {
      const page = await document.getPage(pageNumber);
      if (cancelled || !canvasRef.current) return;
      const scale = Math.min(1.25, 900 / page.getViewport({ scale: 1 }).width);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) return;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      renderTask = page.render({ canvas, canvasContext: context, viewport });
      await renderTask.promise;
    };
    void renderPage().catch(() => {
      if (canvasRef.current && !cancelled) {
        const context = canvasRef.current.getContext('2d');
        context?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber]);

  return <figure className="history-preview-pdf-page">
    <canvas ref={canvasRef} aria-label={`Page ${pageNumber}`} />
    <figcaption>Page {pageNumber}</figcaption>
  </figure>;
}
