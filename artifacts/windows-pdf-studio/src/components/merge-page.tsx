import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { ArrowDown, ArrowUp, Check, FilePlus2, FileText, LockKeyhole, Plus, Save, Trash2 } from 'lucide-react';
import './merge-page.css';

export type MergeFile = {
  id: string;
  name: string;
  size: number;
  pageCount: number | null;
};

export type MergePageProps = {
  files: MergeFile[];
  outputName: string;
  busy: boolean;
  error: string | null;
  success: string | null;
  mergedReady: boolean;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  onMoveFile: (id: string, direction: -1 | 1) => void;
  onClear: () => void;
  onOutputNameChange: (name: string) => void;
  onMerge: () => void;
  onDownload: () => void;
};

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Size unavailable';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MergePage({
  files,
  outputName,
  busy,
  error,
  success,
  mergedReady,
  onAddFiles,
  onRemoveFile,
  onMoveFile,
  onClear,
  onOutputNameChange,
  onMerge,
  onDownload,
}: MergePageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const knownPageCount = files.reduce((total, file) => total + (file.pageCount ?? 0), 0);
  const hasUnknownPages = files.some((file) => file.pageCount === null);
  const canMerge = files.length > 1 && !busy && !hasUnknownPages && files.every((file) => file.pageCount !== 0);

  const addFiles = (selected: File[]) => {
    if (selected.length) onAddFiles(selected);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.currentTarget.files ?? []));
    event.currentTarget.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!busy) addFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div className="page-wrap merge-page">
      <input
        ref={inputRef}
        className="merge-file-picker"
        type="file"
        accept="application/pdf,.pdf"
        multiple
        disabled={busy}
        onChange={handleFileChange}
        data-testid="input-merge-pdfs"
        aria-label="Choose PDF files to merge"
      />

      <div className="merge-layout">
        <section className="panel merge-queue-panel" aria-labelledby="merge-queue-title">
          <div className="merge-panel-head">
            <h2 className="card-title" id="merge-queue-title"><FileText size={15} /> PDF order</h2>
            <span className="merge-count" data-testid="text-merge-file-count">
              {files.length} {files.length === 1 ? 'FILE' : 'FILES'}
              {files.length > 0 && ` · ${hasUnknownPages ? `${knownPageCount}+` : knownPageCount} PAGES`}
            </span>
          </div>

          <button
            className={`merge-dropzone${dragging ? ' is-dragging' : ''}`}
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
            onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
            onDrop={handleDrop}
            disabled={busy}
            data-testid="button-add-merge-pdfs"
            aria-label="Add PDF files"
          >
            <span className="merge-drop-icon"><FilePlus2 size={20} /></span>
            <span className="merge-drop-copy">
              <strong>{busy ? 'Working with your PDFs…' : 'Choose PDFs or drop them here'}</strong>
              <span>Select multiple PDF files. They stay on this device.</span>
            </span>
            <Plus size={16} aria-hidden="true" />
          </button>

          {files.length ? (
            <ol className="merge-file-list" aria-label="PDFs in merge order" data-testid="list-merge-files">
              {files.map((file, index) => (
                <li className="merge-file-row" key={file.id} data-testid={`row-merge-file-${file.id}`}>
                  <span className="merge-file-order" aria-label={`Position ${index + 1}`}>{String(index + 1).padStart(2, '0')}</span>
                  <span className="merge-file-details">
                    <span className="merge-file-name" title={file.name}>{file.name}</span>
                    <span className="merge-file-meta">
                      <span>{file.pageCount === null ? 'Reading pages…' : file.pageCount === 0 ? 'Could not read PDF' : `${file.pageCount} ${file.pageCount === 1 ? 'page' : 'pages'}`}</span>
                      <span>{formatFileSize(file.size)}</span>
                    </span>
                  </span>
                  <span className="merge-file-actions">
                    <button
                      type="button"
                      className="merge-file-action"
                      aria-label={`Move ${file.name} up`}
                      title="Move up"
                      onClick={() => onMoveFile(file.id, -1)}
                      disabled={busy || index === 0}
                      data-testid={`button-move-merge-file-up-${file.id}`}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      type="button"
                      className="merge-file-action"
                      aria-label={`Move ${file.name} down`}
                      title="Move down"
                      onClick={() => onMoveFile(file.id, 1)}
                      disabled={busy || index === files.length - 1}
                      data-testid={`button-move-merge-file-down-${file.id}`}
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      type="button"
                      className="merge-file-action remove"
                      aria-label={`Remove ${file.name}`}
                      title="Remove file"
                      onClick={() => onRemoveFile(file.id)}
                      disabled={busy}
                      data-testid={`button-remove-merge-file-${file.id}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="merge-empty" data-testid="empty-merge-queue">
              <div>
                <span className="merge-empty-mark"><FileText size={18} /></span>
                <strong>Your merge queue is empty</strong>
                <p>Add two or more PDFs to combine them in the order shown here.</p>
              </div>
            </div>
          )}

          <div className="merge-queue-foot">
            <span className="merge-local-note"><LockKeyhole size={12} /> Merge runs on this device.</span>
            <button
              type="button"
              className="merge-clear"
              onClick={onClear}
              disabled={busy || files.length === 0}
              data-testid="button-clear-merge-queue"
            >
              Clear queue
            </button>
          </div>
        </section>

        <section className="panel merge-output-panel" aria-labelledby="merge-output-title">
          <div className="merge-panel-head">
            <h2 className="card-title" id="merge-output-title"><Save size={15} /> Output</h2>
          </div>
          <div className="merge-output-body">
            <p className="merge-output-intro">Choose a filename for the combined PDF. Your original files remain unchanged.</p>
            <label className="field-label" htmlFor="merge-output-name">OUTPUT FILENAME</label>
            <input
              className="merge-output-input"
              id="merge-output-name"
              type="text"
              value={outputName}
              onChange={(event) => onOutputNameChange(event.currentTarget.value)}
              disabled={busy}
              autoComplete="off"
              data-testid="input-merge-output-name"
            />
            <p className="merge-output-help">The merged document will be saved as a PDF.</p>

            <div className="merge-actions">
              <button
                type="button"
                className="merge-action primary"
                onClick={onMerge}
                disabled={!canMerge}
                data-testid="button-merge-save"
              >
                {busy ? 'Merging PDFs…' : <><FilePlus2 size={15} /> Merge &amp; save locally</>}
              </button>
              {mergedReady && (
                <button
                  type="button"
                  className="merge-action secondary"
                  onClick={onDownload}
                  disabled={busy}
                  data-testid="button-download-merged-pdf"
                >
                  <Save size={15} /> Download merged PDF
                </button>
              )}
            </div>

            <hr className="merge-divider" />

            {error && <div className="merge-feedback error" role="alert" data-testid="status-merge-error">{error}</div>}
            {success && (
              <div className="merge-feedback success" role="status" data-testid="status-merge-success">
                <Check size={13} aria-hidden="true" /> {success}
              </div>
            )}
            <p className="merge-output-footnote">PDFs are processed locally on this device. No document content is sent to a server.</p>
          </div>
        </section>
      </div>
    </div>
  );
}

export default MergePage;
