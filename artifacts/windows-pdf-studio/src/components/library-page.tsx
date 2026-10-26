import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertCircle, Archive, ArrowDownToLine, ArrowDownUp, Check, ChevronDown, Clock3, Eye, FileImage,
  FileText, Folder, FolderPlus, HardDrive, Image, LayoutGrid, List,
  Printer, Search, Star, Trash2, Upload, X, RotateCcw, Pencil, MoveRight, ShieldCheck
} from 'lucide-react';
import type { LibraryFileSummary, LibraryFolderSummary, LibraryPageProps } from '@/lib/library-types';
import { PaginationControls } from '@/components/pagination-controls';
import { PrintHistoryPreviewDialog } from '@/components/print-history-preview-dialog';
import './library-page.css';

type FileScope = 'all' | 'recent' | 'favorites' | 'trash';
type HistoryPreviewDialogState =
  | { kind: 'loading'; name: string }
  | { kind: 'error'; name: string; error: string }
  | { kind: 'ready'; name: string; mimeType: string; url: string };
type ModalState =
  | { kind: 'rename-file'; file: LibraryFileSummary }
  | { kind: 'create-folder' }
  | { kind: 'rename-folder'; folder: LibraryFolderSummary }
  | { kind: 'delete-folder'; folder: LibraryFolderSummary }
  | { kind: 'delete-file'; file: LibraryFileSummary };

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (timestamp: number | null) => timestamp
  ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(timestamp)
  : 'Never opened';
const formatDateTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(timestamp);

const extensionFor = (file: LibraryFileSummary) => {
  const match = file.name.match(/\.([^.]+)$/);
  return match?.[1]?.toUpperCase() ?? file.type.toUpperCase();
};

export function LibraryPage(props: LibraryPageProps) {
  const {
    tab, files, folders, printJobs, storageUsed, storageQuota, isLoading, onTabChange,
    error,
    onImport, onOpenFile, onDownloadFile, onRenameFile, onToggleFavorite, onMoveFile,
    onTrashFile, onRestoreFile, onDeleteFile, onCreateFolder, onRenameFolder,
    onDeleteFolder, onOpenPrintJob, onLoadPrintJobPreview, onDeletePrintJob
  } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState<FileScope>('all');
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('recent');
  const [jobSort, setJobSort] = useState('recent');
  const [filePage, setFilePage] = useState(1);
  const [jobPage, setJobPage] = useState(1);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [modal, setModal] = useState<ModalState | null>(null);
  const [modalValue, setModalValue] = useState('');
  const [moveMenu, setMoveMenu] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [previewDialog, setPreviewDialog] = useState<HistoryPreviewDialogState | null>(null);
  const previewRequestRef = useRef(0);

  const runAction = async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
      return true;
    } catch (reason) {
      setActionError(reason instanceof Error && reason.message ? reason.message : 'That change could not be saved. Please try again.');
      return false;
    }
  };

  const liveFiles = files.filter((file) => !file.deletedAt);
  const visibleFiles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const filtered = files.filter((file) => {
      const lastActivity = file.lastOpenedAt ?? file.createdAt;
      const matchScope = scope === 'trash'
        ? !!file.deletedAt
        : !file.deletedAt && (scope !== 'favorites' || file.favorite) && (scope !== 'recent' || lastActivity >= recentCutoff);
      const matchFolder = scope !== 'trash' && activeFolder ? file.folderId === activeFolder : true;
      const matchType = typeFilter === 'all' || file.type === typeFilter;
      const matchSearch = !query || file.name.toLocaleLowerCase().includes(query) || file.mimeType.toLocaleLowerCase().includes(query);
      return matchScope && matchFolder && matchType && matchSearch;
    });
    return filtered.sort((a, b) => sortBy === 'name'
      ? a.name.localeCompare(b.name)
      : sortBy === 'size'
        ? b.size - a.size
        : (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt));
  }, [files, scope, activeFolder, typeFilter, search, sortBy]);

  const visibleJobs = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [...printJobs]
      .filter((job) => !query || job.title.toLocaleLowerCase().includes(query) || job.itemNames.some((name) => name.toLocaleLowerCase().includes(query)))
      .sort((a, b) => jobSort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt);
  }, [printJobs, search, jobSort]);

  const filePageSize = 25;
  const jobPageSize = 12;
  const filePageCount = Math.max(1, Math.ceil(visibleFiles.length / filePageSize));
  const jobPageCount = Math.max(1, Math.ceil(visibleJobs.length / jobPageSize));
  const safeFilePage = Math.min(filePage, filePageCount);
  const safeJobPage = Math.min(jobPage, jobPageCount);
  const pageFiles = visibleFiles.slice((safeFilePage - 1) * filePageSize, safeFilePage * filePageSize);
  const pageJobs = visibleJobs.slice((safeJobPage - 1) * jobPageSize, safeJobPage * jobPageSize);

  useEffect(() => {
    setFilePage(1);
  }, [scope, activeFolder, search, typeFilter, sortBy, tab]);
  useEffect(() => {
    setJobPage(1);
  }, [search, jobSort, tab]);
  useEffect(() => {
    setFilePage((page) => Math.min(page, Math.max(1, Math.ceil(visibleFiles.length / filePageSize))));
  }, [visibleFiles.length]);
  useEffect(() => {
    setJobPage((page) => Math.min(page, Math.max(1, Math.ceil(visibleJobs.length / jobPageSize))));
  }, [visibleJobs.length]);
  useEffect(() => {
    if (previewDialog?.kind !== 'ready') return;
    const { url } = previewDialog;
    return () => URL.revokeObjectURL(url);
  }, [previewDialog]);

  const currentFolder = folders.find((folder) => folder.id === activeFolder);
  const usedPercent = storageQuota ? Math.min(100, (storageUsed / storageQuota) * 100) : null;

  const openModal = (next: ModalState, initialValue = '') => {
    setModal(next);
    setModalValue(initialValue);
  };
  const closePreviewDialog = () => {
    previewRequestRef.current += 1;
    setPreviewDialog(null);
  };
  const openHistoryPreview = async (jobId: string, itemIndex: number, fallbackName: string) => {
    const requestId = ++previewRequestRef.current;
    setPreviewDialog({ kind: 'loading', name: fallbackName });
    try {
      const preview = await onLoadPrintJobPreview(jobId, itemIndex);
      if (requestId !== previewRequestRef.current) {
        URL.revokeObjectURL(preview.url);
        return;
      }
      setPreviewDialog({ kind: 'ready', ...preview });
    } catch (reason) {
      if (requestId !== previewRequestRef.current) return;
      setPreviewDialog({
        kind: 'error',
        name: fallbackName,
        error: reason instanceof Error ? reason.message : 'This document preview could not be opened.',
      });
    }
  };
  const submitModal = async (event: FormEvent) => {
    event.preventDefault();
    const value = modalValue.trim();
    if (!modal) return;
    let complete = false;
    if (modal.kind === 'rename-file' && value) complete = await runAction(() => onRenameFile(modal.file.id, value));
    if (modal.kind === 'create-folder' && value) complete = await runAction(() => onCreateFolder(value));
    if (modal.kind === 'rename-folder' && value) complete = await runAction(() => onRenameFolder(modal.folder.id, value));
    if (modal.kind === 'delete-folder') complete = await runAction(() => onDeleteFolder(modal.folder.id));
    if (modal.kind === 'delete-file') complete = await runAction(() => onDeleteFile(modal.file.id));
    if (complete) setModal(null);
  };
  const onImportChange = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);
    if (chosen.length) void runAction(() => onImport(chosen));
    event.target.value = '';
  };

  return (
    <div className="library-page" data-testid="page-library">
      <div className="library-tabs" role="tablist" aria-label="Document workspace">
        <button type="button" role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'selected' : ''} onClick={() => onTabChange('files')} data-testid="tab-library-files">
          <Folder size={15} /> Library <span>{liveFiles.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'print-history'} className={tab === 'print-history' ? 'selected' : ''} onClick={() => onTabChange('print-history')} data-testid="tab-print-history">
          <Clock3 size={15} /> Print history <span>{printJobs.length}</span>
        </button>
        {tab === 'files' && scope !== 'trash' && (
          <div className="library-import-action">
            <button type="button" className="lib-primary-button" onClick={() => inputRef.current?.click()} data-testid="button-import-files">
              <Upload size={15} /> Import files
            </button>
          </div>
        )}
        <div className="library-tabs-note"><ShieldCheck size={14} /> Stored on this device</div>
      </div>
      {(error || actionError) && <div className="library-error" role="alert" data-testid="status-library-error"><span className="library-error-mark">!</span><span>{actionError ?? error}</span>{actionError && <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss error" data-testid="button-dismiss-library-error"><X size={14} /></button>}</div>}

      <input ref={inputRef} className="library-file-input" type="file" multiple accept="application/pdf,image/*" onChange={onImportChange} aria-label="Choose files to import" data-testid="input-library-import" />

      {tab === 'files' ? (
        <div className="library-layout">
          <aside className="library-sidebar" aria-label="Library navigation">
            <div className="library-sidebar-top">
              <div className="library-side-label">COLLECTIONS</div>
              <button type="button" className="library-create-folder" onClick={() => openModal({ kind: 'create-folder' })} aria-label="Create folder" data-testid="button-create-folder"><FolderPlus size={15} /></button>
            </div>
            <button type="button" className={`library-side-item ${scope === 'all' && !activeFolder ? 'active' : ''}`} onClick={() => { setScope('all'); setActiveFolder(null); }} data-testid="nav-library-all">
              <LayoutGrid size={15} /><span>All files</span><span className="library-count">{liveFiles.length}</span>
            </button>
            <button type="button" className={`library-side-item ${scope === 'recent' ? 'active' : ''}`} onClick={() => { setScope('recent'); setActiveFolder(null); }} data-testid="nav-library-recent">
              <Clock3 size={15} /><span>Recent</span><span className="library-count">{liveFiles.filter((file)=>Date.now()-(file.lastOpenedAt??file.createdAt)<30*24*60*60*1000).length}</span>
            </button>
            <button type="button" className={`library-side-item ${scope === 'favorites' ? 'active' : ''}`} onClick={() => { setScope('favorites'); setActiveFolder(null); }} data-testid="nav-library-favorites">
              <Star size={15} /><span>Favorites</span><span className="library-count">{liveFiles.filter((file) => file.favorite).length}</span>
            </button>
            <div className="library-side-label library-folder-label">FOLDERS</div>
            {folders.map((folder) => (
              <div className={`library-folder-row ${activeFolder === folder.id && scope === 'all' ? 'active' : ''}`} key={folder.id} data-testid={`row-library-folder-${folder.id}`}>
                <button type="button" className="library-side-item" onClick={() => { setScope('all'); setActiveFolder(folder.id); }} data-testid={`button-open-folder-${folder.id}`}>
                  <Folder size={15} /><span>{folder.name}</span><span className="library-count">{liveFiles.filter((file) => file.folderId === folder.id).length}</span>
                </button>
                <div className="library-folder-tools">
                  <button type="button" aria-label={`Rename ${folder.name}`} title={`Rename ${folder.name}`} onClick={() => openModal({ kind: 'rename-folder', folder }, folder.name)} data-testid={`button-rename-folder-${folder.id}`}><Pencil size={13} /></button>
                  <button type="button" aria-label={`Delete ${folder.name}`} title={`Delete ${folder.name}`} onClick={() => openModal({ kind: 'delete-folder', folder })} data-testid={`button-delete-folder-${folder.id}`}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
            {!folders.length && <div className="library-no-folders">Folders help keep repeat jobs together.</div>}
            <button type="button" className={`library-side-item library-trash-link ${scope === 'trash' ? 'active' : ''}`} onClick={() => { setScope('trash'); setActiveFolder(null); }} data-testid="nav-library-trash">
              <Trash2 size={15} /><span>Recently deleted</span><span className="library-count">{files.filter((file) => !!file.deletedAt).length}</span>
            </button>
            <div className="library-storage">
              <div className="library-storage-title"><HardDrive size={14} /> LOCAL APP STORAGE</div>
              <div className="library-storage-values"><strong>{formatBytes(storageUsed)}</strong><span>{storageQuota ? `of ${formatBytes(storageQuota)}` : 'used'}</span></div>
              <div className="library-storage-track"><span style={{ width: `${usedPercent ?? 0}%` }} /></div>
              <p>{storageQuota ? `${Math.round(usedPercent ?? 0)}% of available space` : 'Your documents never leave this device.'}</p>
            </div>
          </aside>

          <section className="library-content" aria-label="File library">
            <div className="library-toolbar">
              <div className="library-search-wrap">
                <Search size={15} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search files…" aria-label="Search files" data-testid="input-library-search" />
                {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search" data-testid="button-clear-library-search"><X size={14} /></button>}
              </div>
              <div className="library-toolbar-controls">
                <label className="library-select-wrap"><span className="sr-only">Filter by file type</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} data-testid="select-library-type"><option value="all">All types</option><option value="pdf">PDFs</option><option value="image">Images</option><option value="export">Exports</option></select><ChevronDown size={13} /></label>
                <label className="library-select-wrap"><span className="sr-only">Sort files</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} data-testid="select-library-sort"><option value="recent">Most recent</option><option value="name">Name</option><option value="size">Largest</option></select><ArrowDownUp size={13} /></label>
                <div className="library-view-toggle" aria-label="File view">
                  <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="List view" data-testid="button-library-list-view"><List size={15} /></button>
                  <button type="button" className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Grid view" data-testid="button-library-grid-view"><LayoutGrid size={15} /></button>
                </div>
              </div>
            </div>
            <div className="library-results-line">
              <span><strong>{visibleFiles.length}</strong> {visibleFiles.length === 1 ? 'item' : 'items'}{scope === 'trash' ? ' in recently deleted' : ''}</span>
              <span>{scope === 'trash' ? 'Items in trash can be restored or permanently removed.' : 'Your files are available offline.'}</span>
            </div>
            {isLoading ? (
              <div className="library-skeleton-list" aria-label="Loading files" data-testid="status-library-loading">
                {[0, 1, 2, 3, 4].map((item) => <div className="library-skeleton-row" key={item}><i /><span /><b /></div>)}
              </div>
            ) : visibleFiles.length === 0 ? (
              <div className="library-empty" data-testid="state-library-empty">
                <div className="library-empty-art"><FileText size={28} /><span /></div>
                <div className="library-empty-kicker">{scope === 'trash' ? 'TRASH IS CLEAR' : search ? 'NO MATCHES' : 'READY WHEN YOU ARE'}</div>
                <h2>{scope === 'trash' ? 'Nothing needs clearing.' : search ? 'No files found.' : scope === 'favorites' ? 'No favorites yet.' : 'Your library starts here.'}</h2>
                <p>{scope === 'trash' ? 'Deleted files will appear here so you can restore them or remove them permanently.' : search ? 'Try a different title or clear your search to see everything.' : 'Import PDFs and images to keep your repeat work organized on this device.'}</p>
                {scope === 'all' && !search && <button type="button" className="lib-primary-button" onClick={() => inputRef.current?.click()} data-testid="button-import-files-empty"><Upload size={14} /> Import files</button>}
              </div>
            ) : view === 'list' ? (
              <div className="library-table-wrap">
                <table className="library-table">
                  <thead><tr><th>NAME</th><th>LAST OPENED</th><th>SIZE</th><th>ADDED</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>{pageFiles.map((file) => (
                  <FileRow key={file.id} file={file} folderName={folders.find((folder) => folder.id === file.folderId)?.name} folders={folders} moveMenu={moveMenu} setMoveMenu={setMoveMenu} onOpenFile={(id) => { void runAction(() => onOpenFile(id)); }} onDownloadFile={(id) => { void runAction(() => onDownloadFile(id)); }} onToggleFavorite={(id) => { void runAction(() => onToggleFavorite(id)); }} onTrashFile={(id) => { void runAction(() => onTrashFile(id)); }} onRestoreFile={(id) => { void runAction(() => onRestoreFile(id)); }} onDeleteFile={() => openModal({ kind: 'delete-file', file })} onRename={() => openModal({ kind: 'rename-file', file }, file.name)} onMoveFile={(id, folderId) => { void runAction(() => onMoveFile(id, folderId)); }} />
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <div className="library-grid">
                {pageFiles.map((file) => <FileCard key={file.id} file={file} folders={folders} folderName={folders.find((folder) => folder.id === file.folderId)?.name} onOpen={() => { void runAction(() => onOpenFile(file.id)); }} onFavorite={() => { void runAction(() => onToggleFavorite(file.id)); }} onDownload={() => { void runAction(() => onDownloadFile(file.id)); }} onRename={() => openModal({ kind: 'rename-file', file }, file.name)} onTrash={() => { void runAction(() => onTrashFile(file.id)); }} onRestore={() => { void runAction(() => onRestoreFile(file.id)); }} onDelete={() => openModal({ kind: 'delete-file', file })} onMove={(folderId) => { void runAction(() => onMoveFile(file.id, folderId)); }} />)}
              </div>
            )}
            {!isLoading && visibleFiles.length > 0 && (
              <PaginationControls page={safeFilePage} pageSize={filePageSize} total={visibleFiles.length} itemLabel="files" onPageChange={setFilePage} />
            )}
          </section>
        </div>
      ) : (
        <section className="history-content" aria-label="Print history">
          <div className="history-toolbar">
            <div className="library-search-wrap"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search print jobs…" aria-label="Search print jobs" data-testid="input-print-history-search" />{search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search" data-testid="button-clear-history-search"><X size={14} /></button>}</div>
            <label className="library-select-wrap"><span className="sr-only">Sort print history</span><select value={jobSort} onChange={(event) => setJobSort(event.target.value)} data-testid="select-print-history-sort"><option value="recent">Newest first</option><option value="oldest">Oldest first</option></select><ArrowDownUp size={13} /></label>
          </div>
          <div className="history-summary">
            <div><span className="history-summary-icon"><Printer size={17} /></span><div><strong>{printJobs.length}</strong><span>saved print {printJobs.length === 1 ? 'job' : 'jobs'}</span></div></div>
            <p>Reopen a saved setup to review its sheet and send it to your system print dialog again.</p>
          </div>
          {isLoading ? (
            <div className="history-skeleton" data-testid="status-print-history-loading">{[0, 1, 2].map((item) => <div key={item} className="history-skeleton-card" />)}</div>
          ) : visibleJobs.length === 0 ? (
            <div className="library-empty history-empty" data-testid="state-print-history-empty">
              <div className="library-empty-art history-art"><Printer size={27} /><span /></div>
              <div className="library-empty-kicker">{search ? 'NO MATCHES' : 'NOTHING PRINTED YET'}</div>
              <h2>{search ? 'No print jobs found.' : 'Your print setups will live here.'}</h2>
              <p>{search ? 'Try another title or item name.' : 'When you save a print sheet, you can reopen its settings and reprint it from this history.'}</p>
              <button type="button" className="history-link-button" onClick={() => onTabChange('files')} data-testid="button-history-go-library">Browse your library <MoveRight size={14} /></button>
            </div>
          ) : (
            <div className="history-list">
              {pageJobs.map((job) => (
                <article className="history-card" key={job.id} data-testid={`row-print-job-${job.id}`}>
                  <div className="history-thumb-stack" aria-label={`${job.previewUrls.length} print previews`}>
                    {job.previewUrls.slice(0, 3).map((url, index) => {
                      const itemName = job.itemNames[index] ?? job.title;
                      return <button
                        type="button"
                        className="history-thumb"
                        key={`${job.id}-preview-${index}`}
                        style={{ zIndex: 3 - index }}
                        aria-label={`Preview ${itemName}`}
                        title="Open preview"
                        onClick={() => { void openHistoryPreview(job.id, index, itemName); }}
                        data-testid={`button-preview-print-job-${job.id}-${index}`}
                      >
                        <img src={url} alt="" />
                        <span className="history-thumb-overlay" aria-hidden="true"><Eye size={18} /></span>
                      </button>;
                    })}
                    {!job.previewUrls.length && <div className="history-thumb history-thumb-placeholder"><FileImage size={18} /></div>}
                    {job.previewUrls.length > 3 && <span className="history-thumb-count">+{job.previewUrls.length - 3}</span>}
                  </div>
                  <div className="history-job-info">
                    <div className="history-job-top"><h2>{job.title}</h2><span className="history-status"><span /> PRINT DIALOG</span></div>
                    <div className="history-job-meta"><time dateTime={new Date(job.createdAt).toISOString()}>{formatDateTime(job.createdAt)}</time><i /> <span>{job.paper}</span><i /> <span>{job.orientation}</span><i /> <span>{job.itemCount} {job.itemCount === 1 ? 'item' : 'items'}</span></div>
                    <div className="history-item-names">{job.itemNames.slice(0, 3).join(' · ')}{job.itemNames.length > 3 ? ` +${job.itemNames.length - 3} more` : ''}</div>
                  </div>
                  <div className="history-job-actions">
                    <button type="button" className="history-reopen-button" onClick={() => { void runAction(() => onOpenPrintJob(job.id)); }} data-testid={`button-reopen-print-job-${job.id}`}><RotateCcw size={14} /> Reopen setup</button>
                    <button type="button" className="history-delete-button" aria-label={`Delete print job ${job.title}`} title="Delete history entry" onClick={() => { void runAction(() => onDeletePrintJob(job.id)); }} data-testid={`button-delete-print-job-${job.id}`}><Trash2 size={15} /></button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {!isLoading && visibleJobs.length > 0 && (
            <PaginationControls page={safeJobPage} pageSize={jobPageSize} total={visibleJobs.length} itemLabel="print jobs" onPageChange={setJobPage} />
          )}
          <div className="history-footnote"><ShieldCheck size={14} /> Print history keeps a local copy of each sheet and its settings. Windows PDF Studio cannot confirm whether paper was printed successfully.</div>
        </section>
      )}

      {modal && (
        <div className="library-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }} data-testid="dialog-library-backdrop">
          <form className="library-modal" onSubmit={(event) => { void submitModal(event); }} role="dialog" aria-modal="true" aria-labelledby="library-modal-title" data-testid="dialog-library-action">
            <button type="button" className="library-modal-close" aria-label="Close dialog" onClick={() => setModal(null)} data-testid="button-close-library-dialog"><X size={16} /></button>
            {actionError && <div className="library-modal-error" role="alert" data-testid="status-library-dialog-error">{actionError}</div>}
            {modal.kind === 'delete-folder' || modal.kind === 'delete-file' ? (
              <>
                <div className="library-modal-icon destructive"><Trash2 size={18} /></div>
                <div className="library-modal-eyebrow">CONFIRM REMOVAL</div>
                <h2 id="library-modal-title">{modal.kind === 'delete-folder' ? `Delete “${modal.folder.name}”?` : `Permanently delete “${modal.file.name}”?`}</h2>
                <p>{modal.kind === 'delete-folder' ? 'Files in this folder will remain in your library and move to All files.' : 'This file will be removed from local storage and cannot be restored.'}</p>
                <div className="library-modal-actions"><button type="button" className="library-secondary-button" onClick={() => setModal(null)} data-testid="button-cancel-library-dialog">Cancel</button><button type="submit" className="library-danger-button" data-testid="button-confirm-library-delete">Delete permanently</button></div>
              </>
            ) : (
              <>
                <div className="library-modal-icon"><FolderPlus size={18} /></div>
                <div className="library-modal-eyebrow">{modal.kind === 'create-folder' ? 'NEW COLLECTION' : 'UPDATE DETAILS'}</div>
                <h2 id="library-modal-title">{modal.kind === 'create-folder' ? 'Create a folder' : modal.kind === 'rename-folder' ? 'Rename folder' : 'Rename file'}</h2>
                <p>{modal.kind === 'create-folder' ? 'Give a set of repeat-use documents a clear home.' : 'Keep this name easy to recognize at a glance.'}</p>
                <label className="library-modal-label" htmlFor="library-modal-name">{modal.kind === 'rename-file' ? 'FILE NAME' : 'FOLDER NAME'}</label>
                <input id="library-modal-name" className="library-modal-input" value={modalValue} onChange={(event) => setModalValue(event.target.value)} autoFocus maxLength={180} required data-testid="input-library-modal-name" />
                <div className="library-modal-actions"><button type="button" className="library-secondary-button" onClick={() => setModal(null)} data-testid="button-cancel-library-dialog">Cancel</button><button type="submit" className="lib-primary-button" disabled={!modalValue.trim()} data-testid="button-save-library-dialog">{modal.kind === 'create-folder' ? 'Create folder' : 'Save changes'}</button></div>
              </>
            )}
          </form>
        </div>
      )}
      {previewDialog && (previewDialog.kind === 'ready' ? (
        <PrintHistoryPreviewDialog
          name={previewDialog.name}
          mimeType={previewDialog.mimeType}
          url={previewDialog.url}
          onClose={closePreviewDialog}
        />
      ) : (
        <div
          className="history-preview-backdrop"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closePreviewDialog(); }}
          data-testid="dialog-print-history-preview"
        >
          <section className="history-preview-dialog history-preview-dialog-state" role="dialog" aria-modal="true" aria-labelledby="history-preview-state-title">
            <button type="button" className="history-preview-close" aria-label="Close preview" onClick={closePreviewDialog}><X size={18} /></button>
            <div className={`history-preview-state ${previewDialog.kind === 'error' ? 'is-error' : ''}`}>
              {previewDialog.kind === 'loading'
                ? <span className="history-preview-spinner" aria-hidden="true" />
                : <AlertCircle size={22} />}
              <h2 id="history-preview-state-title">{previewDialog.kind === 'loading' ? 'Opening preview…' : 'Preview unavailable'}</h2>
              {previewDialog.kind === 'error' && <p>{previewDialog.error}</p>}
            </div>
          </section>
        </div>
      ))}
    </div>
  );
}

function FileRow({
  file, folderName, folders, moveMenu, setMoveMenu, onOpenFile, onDownloadFile, onToggleFavorite,
  onTrashFile, onRestoreFile, onDeleteFile, onRename, onMoveFile
}: {
  file: LibraryFileSummary;
  folderName?: string;
  folders: LibraryFolderSummary[];
  moveMenu: string | null;
  setMoveMenu: (id: string | null) => void;
  onOpenFile: (id: string) => void;
  onDownloadFile: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onTrashFile: (id: string) => void;
  onRestoreFile: (id: string) => void;
  onDeleteFile: () => void;
  onRename: () => void;
  onMoveFile: (id: string, folderId: string | null) => void;
}) {
  const icon = file.type === 'pdf' ? <FileText size={17} /> : file.type === 'image' ? <Image size={17} /> : <FileImage size={17} />;
  return <tr data-testid={`row-library-file-${file.id}`}>
    <td><div className="library-file-cell"><button type="button" className={`library-file-icon ${file.type}`} onClick={() => !file.deletedAt && onOpenFile(file.id)} aria-label={`Open ${file.name}`} disabled={!!file.deletedAt} data-testid={`button-open-file-${file.id}`}>{icon}</button><div className="library-file-name-wrap"><button type="button" className="library-file-name" onClick={() => !file.deletedAt && onOpenFile(file.id)} disabled={!!file.deletedAt} data-testid={`link-open-file-${file.id}`}>{file.name}</button><span>{extensionFor(file)}{folderName ? ` · ${folderName}` : ' · Unfiled'}</span></div></div></td>
    <td>{file.deletedAt ? 'Deleted' : formatDate(file.lastOpenedAt)}</td><td className="library-mono">{formatBytes(file.size)}</td><td>{formatDate(file.createdAt)}</td>
    <td><div className="library-row-actions">
      {file.deletedAt ? <>
        <button type="button" aria-label={`Restore ${file.name}`} title="Restore file" onClick={() => onRestoreFile(file.id)} data-testid={`button-restore-file-${file.id}`}><RotateCcw size={14} /></button>
        <button type="button" aria-label={`Permanently delete ${file.name}`} title="Permanently delete" onClick={onDeleteFile} data-testid={`button-delete-file-${file.id}`}><Trash2 size={14} /></button>
      </> : <>
        <button type="button" aria-label={file.favorite ? `Remove ${file.name} from favorites` : `Add ${file.name} to favorites`} title={file.favorite ? 'Remove from favorites' : 'Add to favorites'} className={file.favorite ? 'is-favorite' : ''} onClick={() => onToggleFavorite(file.id)} data-testid={`button-favorite-file-${file.id}`}><Star size={14} fill={file.favorite ? 'currentColor' : 'none'} /></button>
        <button type="button" aria-label={`Download ${file.name}`} title="Download" onClick={() => onDownloadFile(file.id)} data-testid={`button-download-file-${file.id}`}><ArrowDownToLine size={14} /></button>
        <button type="button" aria-label={`Rename ${file.name}`} title="Rename" onClick={onRename} data-testid={`button-rename-file-${file.id}`}><Pencil size={14} /></button>
        <div className="library-move-wrap"><button type="button" aria-label={`Move ${file.name} to folder`} title="Move to folder" onClick={() => setMoveMenu(moveMenu === file.id ? null : file.id)} data-testid={`button-move-file-${file.id}`}><Archive size={14} /></button>
          {moveMenu === file.id && <div className="library-move-menu" role="menu" data-testid={`menu-move-file-${file.id}`}><div>MOVE TO</div><button type="button" role="menuitem" onClick={() => { onMoveFile(file.id, null); setMoveMenu(null); }} data-testid={`button-move-file-unfiled-${file.id}`}>All files {file.folderId === null && <Check size={13} />}</button>{folders.map((folder) => <button type="button" role="menuitem" key={folder.id} onClick={() => { onMoveFile(file.id, folder.id); setMoveMenu(null); }} data-testid={`button-move-file-${file.id}-to-${folder.id}`}>{folder.name}{file.folderId === folder.id && <Check size={13} />}</button>)}</div>}
        </div>
        <button type="button" aria-label={`Move ${file.name} to recently deleted`} title="Move to trash" onClick={() => onTrashFile(file.id)} data-testid={`button-trash-file-${file.id}`}><Trash2 size={14} /></button>
      </>}
    </div></td>
  </tr>;
}

function FileCard({ file, folders, folderName, onOpen, onFavorite, onDownload, onRename, onTrash, onRestore, onDelete, onMove }: {
  file: LibraryFileSummary; folders: LibraryFolderSummary[]; folderName?: string; onOpen: () => void; onFavorite: () => void; onDownload: () => void; onRename: () => void; onTrash: () => void; onRestore: () => void; onDelete: () => void; onMove: (folderId: string | null) => void;
}) {
  return <article className="library-file-card" data-testid={`card-library-file-${file.id}`}>
    <div className={`library-card-art ${file.type}`}><div className="library-card-page">{file.type === 'pdf' ? <FileText size={24} /> : <FileImage size={23} />}<span>{extensionFor(file)}</span></div>{!file.deletedAt && <button type="button" aria-label={file.favorite ? 'Remove from favorites' : 'Add to favorites'} className={file.favorite ? 'is-favorite' : ''} onClick={onFavorite} data-testid={`button-favorite-file-${file.id}`}><Star size={14} fill={file.favorite ? 'currentColor' : 'none'} /></button>}</div>
    <div className="library-card-details"><button type="button" className="library-card-name" onClick={onOpen} disabled={!!file.deletedAt} data-testid={`button-open-file-${file.id}`}>{file.name}</button><span>{formatBytes(file.size)} <i /> {folderName ?? 'Unfiled'}</span></div>
    <div className="library-card-actions">{file.deletedAt ? <><button type="button" onClick={onRestore} data-testid={`button-restore-file-${file.id}`}><RotateCcw size={13} /> Restore</button><button type="button" aria-label={`Permanently delete ${file.name}`} onClick={onDelete} data-testid={`button-delete-file-${file.id}`}><Trash2 size={14} /></button></> : <><button type="button" onClick={onDownload} data-testid={`button-download-file-${file.id}`}><ArrowDownToLine size={13} /> Download</button><label className="library-card-move"><span className="sr-only">Move {file.name} to folder</span><select aria-label={`Move ${file.name} to folder`} value={file.folderId ?? ''} onChange={(event) => onMove(event.target.value || null)} data-testid={`select-move-file-${file.id}`}><option value="">Unfiled</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><ChevronDown size={12} /></label><button type="button" aria-label={`Rename ${file.name}`} onClick={onRename} data-testid={`button-rename-file-${file.id}`}><Pencil size={14} /></button><button type="button" aria-label={`Move ${file.name} to trash`} onClick={onTrash} data-testid={`button-trash-file-${file.id}`}><Trash2 size={14} /></button></>}</div>
  </article>;
}

export default LibraryPage;
