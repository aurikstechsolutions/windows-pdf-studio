import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, FilePlus2, FileText, RotateCcw, RotateCw, Save, X } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { LibraryFileSummary } from '@/lib/library-types';
import './organize-page.css';

type PageOrder = { id: string; sourceId: string; sourcePage: number; rotation: number };
type InputDocument = { blob: Blob; name: string; token: string };
type SourceDocument = InputDocument & { pdf: PDFDocumentProxy };

type OrganizePageProps = {
  libraryPdfs: LibraryFileSummary[];
  onLoadLibraryPdf: (fileId: string) => Promise<Blob>;
  onSave: (blob: Blob, name: string) => Promise<void>;
  initialDocuments?: InputDocument[];
  initialDocument?: { blob: Blob; name: string; token: string };
  mergeCount?: number;
  onOpenMerge?: () => void;
  embedded?: boolean;
  onClose?: () => void;
};

function normalizeOutputName(value: string) {
  const safeName = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\.+$/, '') || 'organized-document';
  return safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
}

function PagePreview({ pdf, item, sourceName }: { pdf: PDFDocumentProxy; item: PageOrder; sourceName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = previewRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '220px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | undefined;
    setRendered(false);
    setFailed(false);
    void (async () => {
      try {
        const page = await pdf.getPage(item.sourcePage);
        if (cancelled || !canvasRef.current) return;
        const rotation = ((page.rotate + item.rotation) % 360 + 360) % 360;
        const fullViewport = page.getViewport({ scale: 1, rotation });
        const scale = Math.min(.55, 190 / fullViewport.width, 218 / fullViewport.height);
        const viewport = page.getViewport({ scale, rotation });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas is not available.');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        renderTask = page.render({ canvas, canvasContext: context, viewport });
        await renderTask.promise;
        if (!cancelled) setRendered(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, item.sourcePage, item.rotation, visible]);

  return (
    <div className="organize-preview" ref={previewRef} aria-label={`Preview of ${sourceName}, source page ${item.sourcePage}`}>
      {!rendered && !failed && <span className="organize-preview-loading">Loading preview…</span>}
      {failed && <span className="organize-preview-loading">Preview unavailable</span>}
      <canvas ref={canvasRef} className={rendered ? 'is-ready' : ''} />
      <span className="organize-preview-caption" title={sourceName}>{sourceName} · page {item.sourcePage}</span>
    </div>
  );
}

export function OrganizePage({
  libraryPdfs, onLoadLibraryPdf, onSave, initialDocuments, initialDocument,
  mergeCount = 0, onOpenMerge, embedded = false, onClose,
}: OrganizePageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadingTasksRef = useRef<PDFDocumentLoadingTask[]>([]);
  const loadIdRef = useRef(0);
  const [sourceDocuments, setSourceDocuments] = useState<SourceDocument[]>([]);
  const [outputName, setOutputName] = useState('');
  const [pages, setPages] = useState<PageOrder[]>([]);
  const [selectedLibraryFile, setSelectedLibraryFile] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [savedCurrentVersion, setSavedCurrentVersion] = useState(false);
  const [hasSavedOnce, setHasSavedOnce] = useState(false);
  const sourceName = sourceDocuments.map((item) => item.name).join(' · ');

  useEffect(() => () => {
    loadIdRef.current += 1;
    const tasks = loadingTasksRef.current;
    loadingTasksRef.current = [];
    void Promise.all(tasks.map((task) => task.destroy())).catch(() => {});
  }, []);

  const openDocuments = async (documents: InputDocument[]) => {
    if (!documents.length) return;
    const loadId = ++loadIdRef.current;
    const nextTasks: PDFDocumentLoadingTask[] = [];
    setLoading(true);
    setError('');
    setSuccess('');
    setSavedCurrentVersion(false);
    setHasSavedOnce(false);
    try {
      const loadedDocuments = await Promise.all(documents.map(async (source) => {
        const task = pdfjs.getDocument({ data: await source.blob.arrayBuffer() });
        nextTasks.push(task);
        return { ...source, pdf: await task.promise };
      }));
      if (loadId !== loadIdRef.current) {
        await Promise.all(nextTasks.map((task) => task.destroy().catch(() => {})));
        return;
      }
      const previousTasks = loadingTasksRef.current;
      loadingTasksRef.current = nextTasks;
      setSourceDocuments(loadedDocuments);
      setPages(loadedDocuments.flatMap((source) => Array.from({ length: source.pdf.numPages }, (_, index) => ({
        id: crypto.randomUUID(),
        sourceId: source.token,
        sourcePage: index + 1,
        rotation: 0,
      }))));
      const firstName = loadedDocuments[0].name.replace(/\.pdf$/i, '');
      setOutputName(loadedDocuments.length > 1 ? `${firstName}-combined-organized.pdf` : `${firstName}-organized.pdf`);
      window.setTimeout(() => {
        void Promise.all(previousTasks.map((task) => task.destroy().catch(() => {})));
      }, 0);
    } catch {
      await Promise.all(nextTasks.map((task) => task.destroy().catch(() => {})));
      if (loadId === loadIdRef.current) {
        setError('One or more PDFs could not be opened. They may be damaged or password protected.');
      }
    } finally {
      if (loadId === loadIdRef.current) setLoading(false);
    }
  };

  const openPdf = async (blob: Blob, name: string) => {
    await openDocuments([{ blob, name, token: crypto.randomUUID() }]);
  };

  const initialInputs = initialDocuments?.length ? initialDocuments : initialDocument ? [initialDocument] : [];
  const initialDocumentsKey = initialInputs.map((item) => item.token).join('\u001f');
  useEffect(() => {
    if (!initialInputs.length) return;
    setSelectedLibraryFile('');
    void openDocuments(initialInputs);
    // Tokens identify the PDFs in this view; their blobs and names remain stable while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDocumentsKey]);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedLibraryFile('');
      void openPdf(file, file.name);
    }
    event.currentTarget.value = '';
  };

  const openLibraryPdf = async (fileId: string) => {
    if (!fileId) return;
    setSelectedLibraryFile(fileId);
    setLoading(true);
    setError('');
    try {
      const file = libraryPdfs.find((item) => item.id === fileId);
      if (!file) throw new Error('This PDF is no longer in the File Manager.');
      const blob = await onLoadLibraryPdf(fileId);
      await openDocuments([{blob, name:file.name, token:crypto.randomUUID()}]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This PDF could not be opened from File Manager.');
      setLoading(false);
    }
  };

  const movePage = (index: number, direction: -1 | 1) => {
    setPages((current) => {
      const destination = index + direction;
      if (destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
    setSuccess('');
    setSavedCurrentVersion(false);
  };

  const rotatePage = (pageId: string, direction: -1 | 1) => {
    setPages((current) => current.map((item) => item.id === pageId
      ? { ...item, rotation: (item.rotation + direction * 90 + 360) % 360 }
      : item));
    setSuccess('');
    setSavedCurrentVersion(false);
  };

  const exportPdf = async () => {
    if (!sourceDocuments.length || !pages.length || busy) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const { PDFDocument, degrees } = await import('pdf-lib');
      const output = await PDFDocument.create();
      const sources = new Map<string, Awaited<ReturnType<typeof PDFDocument.load>>>();
      for (const source of sourceDocuments) {
        sources.set(source.token, await PDFDocument.load(await source.blob.arrayBuffer()));
      }
      for (const item of pages) {
        const source = sources.get(item.sourceId);
        if (!source) throw new Error('A source PDF is missing from the organized page list.');
        const [page] = await output.copyPages(source, [item.sourcePage - 1]);
        const originalRotation = page.getRotation().angle;
        page.setRotation(degrees((originalRotation + item.rotation) % 360));
        output.addPage(page);
      }
      const bytes = await output.save();
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const blob = new Blob([buffer], { type: 'application/pdf' });
      const name = normalizeOutputName(outputName);
      await onSave(blob, name);
      setOutputName(name);
      setSuccess(`${name} was saved to File Manager. The source PDFs were not changed.`);
      setSavedCurrentVersion(true);
      setHasSavedOnce(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The organized PDF could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`page-wrap organize-page${embedded ? ' organize-page-embedded' : ''}`}>
      {embedded && <div className="organize-heading-actions">
        <button className="tool-btn" type="button" onClick={onClose} disabled={busy} data-testid="button-close-inline-organize"><X size={14} /> Close</button>
      </div>}

      <input ref={fileInputRef} className="hidden-input" type="file" accept="application/pdf,.pdf" onChange={onFileChange} data-testid="input-organize-pdf" />

      {!embedded && <section className="panel organize-source-panel">
        <div>
          <strong><FileText size={15} /> Choose a PDF</strong>
          <span>Open a file from this device or continue with one already saved locally.</span>
        </div>
          <div className="organize-source-actions">
            {sourceDocuments.length > 0 && <button className="tool-btn primary" type="button" onClick={() => fileInputRef.current?.click()} disabled={loading || busy} data-testid="button-open-organize-pdf"><FilePlus2 size={14} /> Open another PDF</button>}
            <label>
              <span className="sr-only">Open PDF from File Manager</span>
              <select
                className="field-select organize-library-select"
                value={selectedLibraryFile}
                onChange={(event) => void openLibraryPdf(event.currentTarget.value)}
                disabled={loading || busy || !libraryPdfs.length}
                data-testid="select-organize-library-pdf"
              >
                <option value="">Open from File Manager…</option>
                {libraryPdfs.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
              </select>
            </label>
          </div>
      </section>}

      {loading && <div className="notice info" role="status" data-testid="status-organize-loading">Opening PDF and preparing page list…</div>}
      {error && <div className="notice error" role="alert" data-testid="status-organize-error">{error}</div>}
      {success && <div className="notice success" role="status" data-testid="status-organize-success">{success}</div>}

      {!sourceDocuments.length && !loading ? (
        <section className="panel organize-empty" data-testid="state-organize-empty">
          <div className="empty-icon"><FileText size={23} /></div>
          <h2>No PDF selected</h2>
          <p>Open a PDF to see page previews and arrange its pages before saving a separate copy.</p>
          <button className="tool-btn primary" type="button" onClick={() => fileInputRef.current?.click()} data-testid="button-choose-organize-pdf"><FilePlus2 size={14} /> Choose a PDF</button>
        </section>
      ) : sourceDocuments.length ? (
        <div className="organize-layout">
          <section className="panel organize-pages-panel" aria-label="PDF pages">
            <div className="organize-panel-head">
              <div><h2>Page order · {sourceDocuments.length} {sourceDocuments.length === 1 ? 'PDF' : 'PDFs'}</h2><p title={sourceName}>{sourceName} · {pages.length} {pages.length === 1 ? 'page' : 'pages'}</p></div>
              <span>Changes apply to the new PDF only</span>
            </div>
            {pages.length ? (
              <ol className="organize-page-grid" aria-label="Pages in export order" data-testid="list-organize-pages">
                {pages.map((item, index) => {
                  const source = sourceDocuments.find((document) => document.token === item.sourceId);
                  if (!source) return null;
                  const position = index + 1;
                  return (
                    <li className="organize-page-card" key={item.id} data-testid={`card-organize-page-${position}`}>
                      <div className="organize-page-card-head">
                        <span>PAGE {String(position).padStart(2, '0')}</span>
                        {item.rotation !== 0 && <span className="organize-rotation-indicator">{item.rotation}°</span>}
                      </div>
                      <PagePreview pdf={source.pdf} item={item} sourceName={source.name} />
                      <div className="organize-page-actions">
                        <button type="button" aria-label={`Move page ${position} up`} title="Move up" onClick={() => movePage(index, -1)} disabled={busy || index === 0} data-testid={`button-organize-page-up-${position}`}><ArrowUp size={14} /></button>
                        <button type="button" aria-label={`Move page ${position} down`} title="Move down" onClick={() => movePage(index, 1)} disabled={busy || index === pages.length - 1} data-testid={`button-organize-page-down-${position}`}><ArrowDown size={14} /></button>
                        <span className="organize-action-spacer" />
                        <button type="button" aria-label={`Rotate page ${position} counter-clockwise`} title="Rotate counter-clockwise" onClick={() => rotatePage(item.id, -1)} disabled={busy} data-testid={`button-organize-page-rotate-ccw-${position}`}><RotateCcw size={14} /></button>
                        <button type="button" aria-label={`Rotate page ${position} clockwise`} title="Rotate clockwise" onClick={() => rotatePage(item.id, 1)} disabled={busy} data-testid={`button-organize-page-rotate-cw-${position}`}><RotateCw size={14} /></button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : <div className="organize-no-pages">The selected PDFs have no pages to organize.</div>}
          </section>

          <aside className="panel organize-export-panel">
            <h2>Save a new PDF</h2>
            <p>The original PDFs stay untouched. Your arranged copy will be added to File Manager.</p>
            <label className="field-label" htmlFor="organize-output-name">OUTPUT FILENAME</label>
            <input id="organize-output-name" className="field-input" value={outputName} onChange={(event) => { setOutputName(event.currentTarget.value); setSuccess(''); setSavedCurrentVersion(false); }} disabled={busy} data-testid="input-organize-output-name" />
            {savedCurrentVersion ? (
              <div className="organize-saved-state" role="status" data-testid="status-organized-pdf-saved">
                <CheckCircle2 size={15} /> Saved to File Manager
              </div>
            ) : (
              <button type="button" className="tool-btn primary organize-export-button" onClick={() => void exportPdf()} disabled={busy || loading || !pages.length} data-testid="button-export-organized-pdf">
                <Save size={14} /> {busy ? 'Saving PDF…' : hasSavedOnce ? 'Save updated PDF' : 'Save new PDF to File Manager'}
              </button>
            )}
            {embedded && mergeCount >= 2 && onOpenMerge && (
              <div className="organize-merge-actions">
                <p>Merge the original PDFs in queue order, without applying the page arrangement above.</p>
                <button type="button" className="tool-btn organize-merge-button" onClick={onOpenMerge} disabled={busy} data-testid="button-organize-merge-pdfs">
                  <FilePlus2 size={14} /> Merge original PDFs ({mergeCount})
                </button>
              </div>
            )}
            <p className="organize-local-note">PDF processing happens on this device.</p>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

export default OrganizePage;
