import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Download, FilePlus2, FileText, LockKeyhole, Plus, Scissors, Trash2, Upload } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { LibraryFileSummary } from '@/lib/library-types';
import './split-page.css';

type PdfSource = { name: string; blob: Blob };
type PageGroup = { id: string; pages: string; name: string };
type SplitOutput = { id: string; name: string; pages: number[]; blob: Blob; saved: boolean; saveError?: string };
type PageParseResult = { pages: number[]; error: string | null };

export type SplitPageProps = {
  libraryPdfs: LibraryFileSummary[];
  onLoadLibraryPdf: (fileId: string) => Promise<PdfSource>;
  onSaveOutput: (blob: Blob, name: string) => Promise<void>;
};

function parsePageSelection(value: string, pageCount: number): PageParseResult {
  const input = value.trim();
  if (!input) return { pages: [], error: 'Enter one or more page numbers or ranges.' };

  const pages: number[] = [];
  const seen = new Set<number>();
  for (const rawPart of input.split(',')) {
    const part = rawPart.trim();
    const match = part.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!match) return { pages: [], error: 'Use page numbers or ranges such as 1, 3-5.' };
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (first < 1 || last < 1 || first > pageCount || last > pageCount) {
      return { pages: [], error: `Page numbers must be between 1 and ${pageCount}.` };
    }
    if (first > last) return { pages: [], error: 'In each range, the first page must be less than or equal to the last.' };
    for (let page = first; page <= last; page += 1) {
      if (seen.has(page)) return { pages: [], error: `Page ${page} appears more than once in this output.` };
      seen.add(page);
      pages.push(page);
    }
  }
  return { pages, error: null };
}

function safePdfName(value: string): string {
  const safe = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\.+$/g, '') || 'split-pages';
  return safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`;
}

function baseName(name: string): string {
  return name.replace(/\.pdf$/i, '') || 'document';
}

function newGroup(name: string, index: number, pages = ''): PageGroup {
  return { id: crypto.randomUUID(), pages, name: `${baseName(name)}-part-${index}.pdf` };
}

export function SplitPage({ libraryPdfs, onLoadLibraryPdf, onSaveOutput }: SplitPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const loadTokenRef = useRef(0);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const [source, setSource] = useState<PdfSource | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [groups, setGroups] = useState<PageGroup[]>([]);
  const [outputs, setOutputs] = useState<SplitOutput[]>([]);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const [librarySelection, setLibrarySelection] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => () => { void loadingTaskRef.current?.destroy(); }, []);

  const parsedGroups = useMemo(() => groups.map((group) => ({
    group,
    parsed: parsePageSelection(group.pages, pdf?.numPages ?? 0),
  })), [groups, pdf?.numPages]);
  const validGroups = useMemo(
    () => parsedGroups.filter(({ parsed }) => parsed.pages.length > 0 && !parsed.error),
    [parsedGroups],
  );
  const previewPageNumbers = useMemo(() => {
    const unique = new Set<number>();
    for (const { parsed } of validGroups) parsed.pages.slice(0, 4).forEach((page) => unique.add(page));
    return [...unique];
  }, [validGroups]);
  const canSplit = Boolean(pdf && groups.length && validGroups.length === groups.length && !busy && !loadingSource);

  useEffect(() => {
    let cancelled = false;
    setPreviews({});
    if (!pdf || !previewPageNumbers.length) return () => { cancelled = true; };

    void (async () => {
      const rendered: Record<number, string> = {};
      for (const pageNumber of previewPageNumbers) {
        try {
          const page = await pdf.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(0.28, 132 / baseViewport.width) });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.ceil(viewport.width));
          canvas.height = Math.max(1, Math.ceil(viewport.height));
          const context = canvas.getContext('2d');
          if (context) {
            await page.render({ canvas, canvasContext: context, viewport }).promise;
            rendered[pageNumber] = canvas.toDataURL('image/png');
          }
        } catch {
          // The page number remains visible in the preview even if a damaged page cannot render.
        }
        if (cancelled) return;
      }
      setPreviews(rendered);
    })();
    return () => { cancelled = true; };
  }, [pdf, previewPageNumbers]);

  const loadSource = async (nextSource: PdfSource) => {
    const token = ++loadTokenRef.current;
    const previousTask = loadingTaskRef.current;
    loadingTaskRef.current = null;
    if (previousTask) void previousTask.destroy();
    setPdf(null);
    setSource(null);
    setGroups([]);
    setLoadingSource(true);
    setError(null);
    setNotice(null);
    setOutputs([]);
    try {
      const task = pdfjs.getDocument({ data: await nextSource.blob.arrayBuffer() });
      const nextPdf = await task.promise;
      if (token !== loadTokenRef.current) {
        await task.destroy();
        return;
      }
      loadingTaskRef.current = task;
      setPdf(nextPdf);
      setSource(nextSource);
      setGroups([newGroup(nextSource.name, 1, nextPdf.numPages === 1 ? '1' : `1-${nextPdf.numPages}`)]);
    } catch {
      if (token === loadTokenRef.current) setError(`${nextSource.name} could not be opened. It may be damaged or password protected.`);
    } finally {
      if (token === loadTokenRef.current) setLoadingSource(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Choose a PDF file to split.');
      return;
    }
    void loadSource({ name: file.name, blob: file });
  };

  const handleLibrarySelection = async (fileId: string) => {
    setLibrarySelection(fileId);
    if (!fileId) return;
    setError(null);
    try {
      await loadSource(await onLoadLibraryPdf(fileId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The selected PDF could not be loaded from File Manager.');
    }
  };

  const updateGroup = (id: string, changes: Partial<Pick<PageGroup, 'pages' | 'name'>>) => {
    setGroups((current) => current.map((group) => group.id === id ? { ...group, ...changes } : group));
    setOutputs([]);
    setError(null);
    setNotice(null);
  };

  const addGroup = () => {
    setGroups((current) => [...current, newGroup(source?.name ?? 'document', current.length + 1)]);
    setOutputs([]);
    setNotice(null);
  };

  const removeGroup = (id: string) => {
    setGroups((current) => current.filter((group) => group.id !== id));
    setOutputs([]);
    setError(null);
    setNotice(null);
  };

  const splitPdf = async () => {
    if (!source || !pdf) return;
    const invalid = parsedGroups.find(({ parsed }) => parsed.error);
    if (invalid) {
      setError(invalid.parsed.error);
      return;
    }
    if (!groups.length) {
      setError('Add at least one page group to create a PDF.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    setOutputs([]);
    try {
      const { PDFDocument } = await import('pdf-lib');
      const original = await PDFDocument.load(await source.blob.arrayBuffer());
      const generated: SplitOutput[] = [];
      for (const { group, parsed } of parsedGroups) {
        const output = await PDFDocument.create();
        const copiedPages = await output.copyPages(original, parsed.pages.map((page) => page - 1));
        copiedPages.forEach((page) => output.addPage(page));
        const bytes = await output.save();
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        const blob = new Blob([buffer], { type: 'application/pdf' });
        const name = safePdfName(group.name);
        let saved = false;
        let saveError: string | undefined;
        try {
          await onSaveOutput(blob, name);
          saved = true;
        } catch {
          saveError = 'Could not save to File Manager';
        }
        generated.push({ id: group.id, name, pages: parsed.pages, blob, saved, saveError });
        setOutputs([...generated]);
      }
      const savedCount = generated.filter((output) => output.saved).length;
      setNotice(savedCount === generated.length
        ? `${generated.length} PDF${generated.length === 1 ? '' : 's'} saved to File Manager.`
        : `${savedCount} of ${generated.length} PDFs saved to File Manager. Download any unsaved files below.`);
    } catch {
      setError('The selected pages could not be extracted. The PDF may be encrypted, damaged, or unsupported.');
    } finally {
      setBusy(false);
    }
  };

  const downloadOutput = (output: SplitOutput) => {
    const url = URL.createObjectURL(output.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = output.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="page-wrap split-page">
      <input ref={inputRef} className="split-file-picker" type="file" accept="application/pdf,.pdf" onChange={handleFileChange} data-testid="input-split-pdf" />

      {error && <div className="split-feedback error" role="alert" data-testid="status-split-error">{error}</div>}
      {notice && <div className="split-feedback success" role="status" data-testid="status-split-success">{notice}</div>}

      <div className="split-layout">
        <section className="panel split-config-panel" aria-labelledby="split-source-title">
          <div className="split-panel-head">
            <h2 className="card-title" id="split-source-title"><FileText size={15} /> Source PDF</h2>
            <span className="split-local-note"><LockKeyhole size={12} /> On-device only</span>
          </div>
          <div className="split-source-body">
            <button type="button" className="split-choose" onClick={() => inputRef.current?.click()} disabled={busy || loadingSource} data-testid="button-choose-split-pdf">
              <span className="split-choose-icon"><Upload size={17} /></span>
              <span><strong>{loadingSource ? 'Opening PDF…' : source ? 'Choose a different PDF' : 'Choose a PDF from this device'}</strong><small>{source ? source.name : 'Your file is read in your browser and is not uploaded.'}</small></span>
            </button>
            {libraryPdfs.length > 0 && (
              <label className="split-library-select">
                <span className="field-label">OR OPEN FROM FILE MANAGER</span>
                <select value={librarySelection} onChange={(event) => void handleLibrarySelection(event.currentTarget.value)} disabled={busy || loadingSource} data-testid="select-split-library-pdf">
                  <option value="">Choose a saved PDF…</option>
                  {libraryPdfs.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
                </select>
              </label>
            )}
            {source && pdf && <div className="split-source-meta"><span>{source.name}</span><strong>{pdf.numPages} {pdf.numPages === 1 ? 'page' : 'pages'}</strong></div>}
          </div>

          <div className="split-panel-head split-groups-head">
            <h2 className="card-title"><Scissors size={15} /> Output files</h2>
            <span className="split-count" data-testid="text-split-output-count">{groups.length} {groups.length === 1 ? 'FILE' : 'FILES'}</span>
          </div>
          {!source ? (
            <div className="split-empty"><FilePlus2 size={19} /><strong>Select a source PDF first</strong><p>Then set the pages each output file should contain.</p></div>
          ) : (
            <div className="split-groups">
              {parsedGroups.map(({ group, parsed }, index) => (
                <article className="split-group" key={group.id} data-testid={`row-split-group-${index}`}>
                  <div className="split-group-top"><strong>File {index + 1}</strong>{groups.length > 1 && <button type="button" aria-label={`Remove output file ${index + 1}`} onClick={() => removeGroup(group.id)} disabled={busy} data-testid={`button-remove-split-group-${index}`}><Trash2 size={14} /></button>}</div>
                  <label className="field-label" htmlFor={`split-pages-${group.id}`}>PAGES TO EXTRACT</label>
                  <input id={`split-pages-${group.id}`} className="split-input" value={group.pages} onChange={(event) => updateGroup(group.id, { pages: event.currentTarget.value })} placeholder="Example: 1-3, 5" disabled={busy} data-testid={`input-split-pages-${index}`} />
                  {group.pages.trim() && parsed.error && <p className="split-range-error">{parsed.error}</p>}
                  <label className="field-label" htmlFor={`split-name-${group.id}`}>OUTPUT FILENAME</label>
                  <input id={`split-name-${group.id}`} className="split-input" value={group.name} onChange={(event) => updateGroup(group.id, { name: event.currentTarget.value })} disabled={busy} data-testid={`input-split-name-${index}`} />
                  <div className="split-preview">
                    <div className="split-preview-label">{parsed.error ? 'Preview updates when the page range is valid' : `${parsed.pages.length} ${parsed.pages.length === 1 ? 'page' : 'pages'} selected`}</div>
                    {!parsed.error && parsed.pages.length > 0 && (
                      <div className="split-thumbnails" data-testid={`preview-split-pages-${index}`}>
                        {parsed.pages.slice(0, 4).map((pageNumber) => (
                          <div className="split-thumbnail" key={pageNumber}>
                            {previews[pageNumber] ? <img src={previews[pageNumber]} alt={`Preview of page ${pageNumber}`} /> : <span className="split-thumbnail-placeholder"><FileText size={16} /></span>}
                            <span>Page {pageNumber}</span>
                          </div>
                        ))}
                        {parsed.pages.length > 4 && <div className="split-more-pages">+{parsed.pages.length - 4}<span>more</span></div>}
                      </div>
                    )}
                  </div>
                </article>
              ))}
              <button type="button" className="split-add-group" onClick={addGroup} disabled={busy} data-testid="button-add-split-group"><Plus size={14} /> Add another output file</button>
              <button type="button" className="split-submit" onClick={() => void splitPdf()} disabled={!canSplit} data-testid="button-split-save">
                <Scissors size={15} /> {busy ? 'Splitting and saving…' : 'Split & save files locally'}
              </button>
              <p className="split-footnote">Each page can be included in more than one output file. Files are saved in File Manager and never sent to a server.</p>
            </div>
          )}
        </section>

        <section className="panel split-results-panel" aria-labelledby="split-results-title">
          <div className="split-panel-head">
            <h2 className="card-title" id="split-results-title"><Download size={15} /> Created files</h2>
            {outputs.length > 0 && <span className="split-count">{outputs.length} READY</span>}
          </div>
          {outputs.length ? (
            <ul className="split-results" data-testid="list-split-results">
              {outputs.map((output) => (
                <li className="split-result" key={output.id} data-testid={`row-split-result-${output.id}`}>
                  <span className="split-result-icon"><FileText size={16} /></span>
                  <span className="split-result-details"><strong>{output.name}</strong><small>{output.pages.length} {output.pages.length === 1 ? 'page' : 'pages'} · {output.saved ? 'Saved to File Manager' : output.saveError}</small></span>
                  <button type="button" className="split-download" onClick={() => downloadOutput(output)} aria-label={`Download ${output.name}`} data-testid={`button-download-split-${output.id}`}><Download size={14} /><span>Download</span></button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="split-empty split-results-empty"><Download size={19} /><strong>Your split files will appear here</strong><p>Review the page previews, then split the PDF to save each file.</p></div>
          )}
        </section>
      </div>
    </div>
  );
}

export default SplitPage;
