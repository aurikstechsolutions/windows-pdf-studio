import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import {
  Activity, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, Crop, FileImage,
  FilePlus2, FileText, FolderOpen, History, ImagePlus, KeyRound, LayoutDashboard, LayoutGrid, LockKeyhole, LogOut, QrCode,
  ListOrdered, Mail, Monitor, Pencil, Plus, Printer, RefreshCw, Scissors, Settings2, ShieldCheck, Upload, X, ZoomIn, ZoomOut
} from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  getListLicenseRequestsQueryKey,
  useCreateLicenseRequest,
  useListLicenseRequests,
  useReviewLicenseRequest,
  setAuthTokenGetter,
  setBaseUrl,
  type LicenseRequest,
} from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';
import { ErrorBoundary } from '@/components/error-boundary';
import LibraryPage from '@/components/library-page';
import MergePage from '@/components/merge-page';
import OrganizePage from '@/components/organize-page';
import PdfEditPage from '@/components/pdf-edit-page';
import SplitPage from '@/components/split-page';
import EmailInboxPage from '@/components/email-inbox-page';
import { SettingsPage } from '@/components/settings-page';
import { PaginationControls } from '@/components/pagination-controls';
import { CustomerUploadPage, RequestTrackingPage, ShopOwnerPage } from '@/components/shop-portal-page';
import { ShopDashboardPage } from '@/components/shop-dashboard-page';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { LibraryFileSummary, LibraryTab, PrintJobSummary } from '@/lib/library-types';
import {
  blobFromLocalUrl, createLibraryFolder, deleteLibraryFolder, deletePrintJob,
  getLibraryFile, getLibraryStorageUsage, getPrintJob, listLibraryFiles,
  listLibraryFolders, listPrintJobs, permanentlyDeleteLibraryFile, renameLibraryFolder,
  requestPersistentLocalStorage, saveLibraryFile, saveOrganizedPdf, savePrintJob, updateLibraryFile,
} from '@/lib/local-library';
import './index.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
const queryClient = new QueryClient();
const isDesktop = window.location.protocol === 'file:';
const basePath = isDesktop ? '' : import.meta.env.BASE_URL.replace(/\/$/, '');
const API_URL_KEY = 'windows-pdf-studio-api-url';
const AUTH_TOKEN_KEY = 'windows-pdf-studio-session';
const AUTH_VERIFIED_AT_KEY = 'windows-pdf-studio-auth-verified-at';
const OFFLINE_SESSION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const isTemporaryDevelopmentUrl = (value: string) => {
  try {
    return new URL(value).hostname.toLowerCase().endsWith('.replit.dev');
  } catch {
    return false;
  }
};
const developmentUrlNotice = 'An installed Windows app cannot reach a temporary development address. Use the license service’s public address instead.';
type AuthSessionResponse = {
  account: { email: string; role: string; deviceId: string | null; licenseActive: boolean } | null;
  accessToken: string | null;
};
if (isDesktop) {
  const savedApiUrl = localStorage.getItem(API_URL_KEY);
  if (savedApiUrl) setBaseUrl(savedApiUrl);
  setAuthTokenGetter(() => localStorage.getItem(AUTH_TOKEN_KEY));
}

async function serviceRequest<T = AuthSessionResponse>(path: string, body?: unknown): Promise<T> {
  const token = isDesktop ? localStorage.getItem(AUTH_TOKEN_KEY) : null;
  const origin = isDesktop ? (localStorage.getItem(API_URL_KEY) ?? '').replace(/\/+$/, '') : '';
  if (isDesktop && origin && isTemporaryDevelopmentUrl(origin)) {
    throw new Error(developmentUrlNotice);
  }
  const normalizedPath = path.replace(/^\/+/, '');
  const response = await fetch(`${origin}/api/${normalizedPath}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: isDesktop ? 'omit' : 'same-origin',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(body === undefined ? {} : { 'X-Requested-With': 'XMLHttpRequest' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => ({})) as { error?: string; code?: string };
  if (!response.ok) {
    const error = new Error(result.error || 'The request could not be completed.') as Error & { status?: number; code?: string };
    error.status = response.status;
    error.code = result.code;
    throw error;
  }
  if (response.status === 204) return {} as T;
  return result as T;
}

async function authRequest<T = AuthSessionResponse>(path: string, body?: unknown): Promise<T> {
  return serviceRequest<T>(`auth/${path}`, body);
}

function storeDesktopSession(token: string | null) {
  if (isDesktop) {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
      localStorage.setItem(AUTH_VERIFIED_AT_KEY, String(Date.now()));
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_VERIFIED_AT_KEY);
    }
  }
  window.dispatchEvent(new Event('windows-pdf-studio-auth-change'));
}

function authErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type LocalAsset = { id: string; name: string; kind: 'image' | 'pdf'; src?: string; page?: number; width?: number; height?: number; sourceFileId?: string };
type MergePdfItem = { id:string; file:File; name:string; size:number; pageCount:number|null; sourceToken:string; sourceFileId:string|null };
type ViewerPdf = { id:string; blob:Blob; name:string; pageCount:number|null; sourceToken:string; fileId:string|null };
type CropRect = { x: number; y: number; w: number; h: number } | null;
type PrintSettings = { paper: string; orientation: 'portrait' | 'landscape'; placement: 'fit' | 'fill'; columns: string };
type WorkspaceState = {
  fileName: string; fileId: string | null; fileBlob: Blob | null; sourceToken: string | null; pdf: PDFDocumentProxy | null; page: number; pageCount: number;
  canvas: HTMLCanvasElement | null; scale: number; crop: CropRect;
  assets: LocalAsset[];
};

function useDeviceId() {
  return useMemo(() => {
    const key = 'windows-pdf-studio-device';
    let id = localStorage.getItem(key);
    if (!id) {
      id = `wps-${crypto.randomUUID()}`;
      localStorage.setItem(key, id);
    }
    return id;
  }, []);
}

function Brand({ caption = 'Local document tools' }: { caption?: string }) {
  return <div className="brand">
    <div className="brand-mark"><FileText size={18} strokeWidth={2.3} /></div>
    <div><div className="brand-name">Windows PDF Studio</div><div className="brand-caption">{caption}</div></div>
  </div>;
}

function AppShell({ children, active }: { children: React.ReactNode; active: string }) {
  return <div className={`app-shell ${active === 'documents' ? 'document-shell' : ''}`}>
    <aside className="side-rail">
      <Brand />
      <div className="nav-label">Workspace</div>
      <nav>
        <Link href="/dashboard" className={`nav-link ${active === 'dashboard' ? 'active' : ''}`} data-testid="link-shop-dashboard"><LayoutDashboard size={16}/><span>Dashboard</span></Link>
        <Link href="/shop" className={`nav-link ${active === 'qrUploads' ? 'active' : ''}`} data-testid="link-shop-qr"><QrCode size={16}/><span>QR Uploads</span></Link>
        <Link href="/" className={`nav-link ${active === 'documents' ? 'active' : ''}`} data-testid="link-documents"><FileText size={16}/><span>Editor</span></Link>
        <Link href="/merge" className={`nav-link ${active === 'merge' ? 'active' : ''}`} data-testid="link-merge-pdfs"><FilePlus2 size={16}/><span>Merge PDFs</span></Link>
        <Link href="/split" className={`nav-link ${active === 'split' ? 'active' : ''}`} data-testid="link-split-pdf"><Scissors size={16}/><span>Split PDFs</span></Link>
        <Link href="/edit" className={`nav-link ${active === 'edit' ? 'active' : ''}`} data-testid="link-edit-pdf"><Pencil size={16}/><span>Edit PDF</span></Link>
        <Link href="/organize" className={`nav-link ${active === 'organize' ? 'active' : ''}`} data-testid="link-organize-pages"><ListOrdered size={16}/><span>Organize pages</span></Link>
        <Link href="/print" className={`nav-link ${active === 'print' ? 'active' : ''}`} data-testid="link-print"><Printer size={16}/><span>Print sheets</span></Link>
        <Link href="/library" className={`nav-link ${active === 'library' ? 'active' : ''}`} data-testid="link-library"><FolderOpen size={16}/><span>File manager</span></Link>
        <Link href="/print-history" className={`nav-link ${active === 'history' ? 'active' : ''}`} data-testid="link-print-history"><History size={16}/><span>Print history</span></Link>
        <Link href="/inbox" className={`nav-link ${active === 'inbox' ? 'active' : ''}`} data-testid="link-email-inbox"><Mail size={16}/><span>Email inbox</span></Link>
        <Link href="/settings" className={`nav-link ${active === 'settings' ? 'active' : ''}`} data-testid="link-settings"><Settings2 size={16}/><span>Settings</span></Link>
      </nav>
      <div className="rail-bottom">
        <div className="rail-note"><strong>Private by design</strong>Workspace files stay on this device. QR customer jobs are private and expire automatically.</div>
        <SignOutButton/>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <div className="topbar-title">Windows PDF Studio <span style={{color:'#a1abad',fontWeight:500}}> / {active === 'documents' ? 'Editor' : active === 'merge' ? 'Merge PDFs' : active === 'split' ? 'Split PDFs' : active === 'edit' ? 'Edit PDF' : active === 'organize' ? 'Organize pages' : active === 'print' ? 'Print sheets' : active === 'library' ? 'File manager' : active === 'history' ? 'Print history' : active === 'inbox' ? 'Email inbox' : active === 'settings' ? 'Settings' : active === 'dashboard' ? 'Dashboard' : active === 'qrUploads' ? 'QR Uploads' : 'Administration'}</span></div>
        <div className="topbar-right"><span className="local-pill"><LockKeyhole size={12}/> Local document tools</span><span className="topbar-version">Desktop tools</span></div>
      </header>
      {children}
    </main>
  </div>;
}

function AdminPortalShell({ children, showSignOut = false }: { children: React.ReactNode; showSignOut?: boolean }) {
  return <div className="app-shell admin-portal-shell" data-testid="page-admin-portal">
    <aside className="side-rail">
      <Brand caption="Central admin portal" />
      <div className="nav-label">Administration</div>
      <nav>
        <Link href="/admin" className="nav-link active" data-testid="link-admin-license-requests">
          <ShieldCheck size={16}/><span>License requests</span>
        </Link>
      </nav>
      <div className="rail-bottom">
        <div className="rail-note"><strong>Central administration</strong>Approve licensed shop installations here. Customer print jobs remain private to each shop.</div>
        {showSignOut && <SignOutButton/>}
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <div className="topbar-title">Windows PDF Studio <span style={{color:'#a1abad',fontWeight:500}}> / Central admin</span></div>
        <div className="topbar-right"><span className="local-pill"><LockKeyhole size={12}/> Administrator access</span></div>
      </header>
      {children}
    </main>
  </div>;
}

function SignOutButton() {
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const signOut = async () => {
    setBusy(true);
    setError('');
    try {
      await authRequest('logout',{});
      storeDesktopSession(null);
      queryClient.clear();
      window.location.reload();
    } catch (reason) {
      setError(authErrorMessage(reason,'Sign-out could not be confirmed. Check the connection and try again.'));
      setBusy(false);
    }
  };
  return <div>
    <button className="nav-link" style={{width:'100%',border:0,background:'transparent',cursor:'pointer'}} onClick={()=>void signOut()} disabled={busy} aria-describedby={error?'signout-error':undefined} data-testid="button-sign-out"><LogOut size={16}/><span>{busy?'Signing out…':'Sign out'}</span></button>
    {error && <small id="signout-error" className="signout-error" role="alert">{error}</small>}
  </div>;
}

function IconButton({ label, onClick, disabled, children, testId }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; testId: string }) {
  return <button className="icon-btn" title={label} aria-label={label} onClick={onClick} disabled={disabled} data-testid={testId}>{children}</button>;
}

function Workspace({
  state, setState, onLibraryChange, mergeCount, mergeReady, mergeBusy, mergeError, mergeSuccess, mergeOutputName,
  mergeItems, organizePdfs, onLoadOrganizePdf, onSaveOrganizedPdf,
  viewerPdfs, onQueueCurrentPdf, onAddMergeFiles, onRemoveMergeFile, onMergeOutputNameChange, onMerge,
}: {
  state: WorkspaceState;
  setState: React.Dispatch<React.SetStateAction<WorkspaceState>>;
  onLibraryChange: () => void;
  mergeCount: number;
  mergeReady: boolean;
  mergeBusy: boolean;
  mergeError: string | null;
  mergeSuccess: string | null;
  mergeOutputName: string;
  mergeItems: Array<{id:string;name:string;size:number;pageCount:number|null}>;
  organizePdfs: LibraryFileSummary[];
  onLoadOrganizePdf: (fileId:string) => Promise<Blob>;
  onSaveOrganizedPdf: (blob:Blob,name:string) => Promise<void>;
  viewerPdfs: ViewerPdf[];
  onQueueCurrentPdf: (file: File, sourceToken: string, sourceFileId:string|null) => void;
  onAddMergeFiles: (files: File[]) => void;
  onRemoveMergeFile: (id:string) => void;
  onMergeOutputNameChange: (name: string) => void;
  onMerge: (name: string) => Promise<boolean>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const mergeFilesRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [renderError, setRenderError] = useState('');
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeName, setMergeName] = useState('merged-document.pdf');
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [viewerNavLoading, setViewerNavLoading] = useState(false);
  const viewerNavRequestRef = useRef(0);

  const navigationDocuments = useMemo(() => {
    const documents = [...viewerPdfs];
    if (state.pdf && state.fileBlob && state.sourceToken && !documents.some((item) => item.sourceToken === state.sourceToken)) {
      documents.unshift({
        id: `active-${state.sourceToken}`,
        blob: state.fileBlob,
        name: state.fileName,
        pageCount: state.pageCount,
        sourceToken: state.sourceToken,
        fileId: state.fileId,
      });
    }
    return documents;
  }, [viewerPdfs, state.pdf, state.fileBlob, state.fileName, state.pageCount, state.sourceToken, state.fileId]);
  const currentDocumentIndex = navigationDocuments.findIndex((item) => item.sourceToken === state.sourceToken);

  useEffect(() => {
    let cancelled = false;
    async function renderPage() {
      if (!state.pdf || !canvasRef.current) return;
      setRenderError('');
      try {
        const page = await state.pdf.getPage(state.page);
        const viewport = page.getViewport({ scale: state.scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        if (!cancelled) setState((s) => ({ ...s, canvas }));
      } catch {
        if (!cancelled) setRenderError('This PDF page could not be rendered. Try reopening the file.');
      }
    }
    void renderPage();
    return () => { cancelled = true; };
  }, [state.pdf, state.page, state.scale, setState]);

  const openPdf = async (file: File) => {
    try {
      const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      let fileId: string | null = null;
      try {
        fileId = (await saveLibraryFile(file, { type: 'pdf' })).id;
        onLibraryChange();
      } catch {
        setRenderError('PDF opened, but it could not be saved to the local library. Check available device storage.');
      }
      setState((s) => ({ ...s, fileName: file.name, fileId, fileBlob: file, sourceToken: crypto.randomUUID(), pdf: doc, page: 1, pageCount: doc.numPages, crop: null, canvas: null }));
    } catch {
      setRenderError('We could not open this PDF. The file may be damaged or password protected.');
    }
  };
  const onPdfChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void openPdf(file);
    event.target.value = '';
  };
  const downloadCanvas = (format: 'png' | 'jpeg', cropOnly = false) => {
    const source = canvasRef.current;
    if (!source) return;
    const out = document.createElement('canvas');
    let rect = cropOnly && state.crop ? state.crop : { x: 0, y: 0, w: source.width, h: source.height };
    const scaleX = source.width / (overlayRef.current?.clientWidth || source.width);
    const scaleY = source.height / (overlayRef.current?.clientHeight || source.height);
    if (cropOnly && state.crop) rect = { x: state.crop.x * scaleX, y: state.crop.y * scaleY, w: state.crop.w * scaleX, h: state.crop.h * scaleY };
    out.width = Math.max(1, Math.round(rect.w)); out.height = Math.max(1, Math.round(rect.h));
    out.getContext('2d')?.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, out.width, out.height);
    const a = document.createElement('a');
    a.download = `${state.fileName.replace(/\.pdf$/i, '')}-page-${state.page}${cropOnly ? '-crop' : ''}.${format === 'jpeg' ? 'jpg' : 'png'}`;
    a.href = out.toDataURL(`image/${format}`, .94); a.click();
    void (async () => {
      const blob = await (await fetch(a.href)).blob();
      await saveLibraryFile(blob, { name: a.download, type: 'export' });
      onLibraryChange();
    })().catch(() => setRenderError('The image was downloaded, but could not be saved to the local library.'));
  };
  const updateCrop = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStart || !overlayRef.current) return;
    const bounds = overlayRef.current.getBoundingClientRect();
    const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    setState((s) => ({ ...s, crop: { x: Math.min(x, dragStart.x), y: Math.min(y, dragStart.y), w: Math.abs(x - dragStart.x), h: Math.abs(y - dragStart.y) } }));
  };
  const addCurrentPageToPrint = () => {
    if (!canvasRef.current) return;
    const src = canvasRef.current.toDataURL('image/png');
    const asset = { id: crypto.randomUUID(), name: `${state.fileName} · page ${state.page}`, kind: 'image' as const, src, page: state.page, sourceFileId: state.fileId ?? undefined };
    setState((s) => ({ ...s, assets: [...s.assets, asset] }));
  };
  const loadQueuedPdf = async (documentIndex:number, lastPage:boolean) => {
    const target = navigationDocuments[documentIndex];
    if (!target || viewerNavLoading) return;
    const requestId = ++viewerNavRequestRef.current;
    setViewerNavLoading(true);
    setRenderError('');
    try {
      const pdf = await pdfjs.getDocument({data:await target.blob.arrayBuffer()}).promise;
      if (requestId !== viewerNavRequestRef.current) return;
      setState((current) => ({
        ...current,
        fileName:target.name,
        fileId:target.fileId,
        fileBlob:target.blob,
        sourceToken:target.sourceToken,
        pdf,
        page:lastPage ? pdf.numPages : 1,
        pageCount:pdf.numPages,
        crop:null,
        canvas:null,
      }));
    } catch {
      if (requestId === viewerNavRequestRef.current) setRenderError(`Could not open ${target.name}. The PDF may be damaged or password protected.`);
    } finally {
      if (requestId === viewerNavRequestRef.current) setViewerNavLoading(false);
    }
  };
  const pageBack = () => {
    if (viewerNavLoading || !state.pdf) return;
    if (state.page > 1) {
      setState((s) => ({ ...s, page: s.page - 1, crop: null }));
    } else if (currentDocumentIndex > 0) {
      void loadQueuedPdf(currentDocumentIndex - 1, true);
    }
  };
  const pageForward = () => {
    if (viewerNavLoading || !state.pdf) return;
    if (state.page < state.pageCount) {
      setState((s) => ({ ...s, page: s.page + 1, crop: null }));
    } else if (currentDocumentIndex >= 0 && currentDocumentIndex < navigationDocuments.length - 1) {
      void loadQueuedPdf(currentDocumentIndex + 1, false);
    }
  };
  const canGoPrevious = state.page > 1 || currentDocumentIndex > 0;
  const canGoNext = state.page < state.pageCount || (currentDocumentIndex >= 0 && currentDocumentIndex < navigationDocuments.length - 1);
  const documentPosition = navigationDocuments.length > 1 && currentDocumentIndex >= 0
    ? ` · PDF ${currentDocumentIndex + 1} of ${navigationDocuments.length}`
    : '';
  const addAnotherPdf = () => {
    if (state.fileBlob && state.sourceToken) {
      const currentFile = new File([state.fileBlob], state.fileName, { type: 'application/pdf' });
      onQueueCurrentPdf(currentFile, state.sourceToken, state.fileId);
    }
    mergeFilesRef.current?.click();
  };
  const openMergeDialog = () => {
    onMergeOutputNameChange(mergeOutputName);
    setMergeName(mergeOutputName);
    setMergeDialogOpen(true);
  };
  const submitMerge = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = mergeName.trim();
    if (!name) return;
    onMergeOutputNameChange(name);
    if (await onMerge(name)) setMergeDialogOpen(false);
  };

  return <div className="page-wrap documents-page-wrap">
    <input ref={fileRef} className="hidden-input" type="file" accept="application/pdf,.pdf" onChange={onPdfChange} data-testid="input-pdf-file"/>
    <input ref={mergeFilesRef} className="hidden-input" type="file" accept="application/pdf,.pdf" multiple onChange={(event) => { onAddMergeFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ''; }} data-testid="input-add-merge-pdfs"/>
    <div className="workspace-grid">
      <section className="panel viewer-panel" aria-label="PDF viewer">
        <div className="toolbar">
          <div className="toolbar-group">
            <IconButton label="Previous page or PDF" onClick={pageBack} disabled={!state.pdf || !canGoPrevious || viewerNavLoading} testId="button-previous-page"><ChevronLeft size={16}/></IconButton>
            <span className="viewer-status" data-testid="text-page-count">{viewerNavLoading ? 'Opening PDF…' : state.pdf ? `${state.page} / ${state.pageCount}${documentPosition}` : 'No document'}</span>
            <IconButton label="Next page or PDF" onClick={pageForward} disabled={!state.pdf || !canGoNext || viewerNavLoading} testId="button-next-page"><ChevronRight size={16}/></IconButton>
            {state.pdf && <IconButton label="Add another PDF to view or merge" onClick={addAnotherPdf} disabled={mergeBusy} testId="button-add-pdf-to-merge"><Plus size={16}/></IconButton>}
            <span className="toolbar-sep"/>
            <IconButton label="Zoom out" onClick={() => setState((s) => ({ ...s, scale: Math.max(.6, s.scale - .2) }))} disabled={!state.pdf} testId="button-zoom-out"><ZoomOut size={15}/></IconButton>
            <span className="viewer-status" data-testid="text-zoom-level">{Math.round(state.scale * 100)}%</span>
            <IconButton label="Zoom in" onClick={() => setState((s) => ({ ...s, scale: Math.min(2.6, s.scale + .2) }))} disabled={!state.pdf} testId="button-zoom-in"><ZoomIn size={15}/></IconButton>
          </div>
          <div className="toolbar-group">
            {state.pdf && state.fileBlob && <button className="tool-btn" onClick={() => setOrganizeOpen(true)} data-testid="button-open-inline-organize"><ListOrdered size={14}/> Organize pages</button>}
            {mergeCount >= 2 && <button className="tool-btn soft" onClick={openMergeDialog} disabled={mergeBusy} data-testid="button-merge-queued-pdfs"><FilePlus2 size={14}/>{mergeBusy ? 'Merging…' : `Merge PDFs (${mergeCount})`}</button>}
            <button className="tool-btn primary" onClick={() => fileRef.current?.click()} data-testid="button-open-pdf">
              {state.pdf ? <FilePlus2 size={14}/> : <FolderOpen size={14}/>} {state.pdf ? 'Start new' : 'Open PDF'}
            </button>
            <button className={`tool-btn ${cropMode ? 'soft' : ''}`} disabled={!state.pdf} onClick={() => { setCropMode((v) => !v); setState((s) => ({ ...s, crop: null })); }} data-testid="button-toggle-crop"><Crop size={14}/>{cropMode ? 'Cancel crop' : 'Select crop'}</button>
            <button className="tool-btn" disabled={!state.pdf} onClick={addCurrentPageToPrint} data-testid="button-add-page-to-sheet"><ImagePlus size={14}/> Add to sheet</button>
          </div>
        </div>
        {(mergeError || mergeSuccess) && !mergeDialogOpen && <div className={`notice ${mergeError ? 'error' : 'success'}`} style={{margin:'10px 12px 0'}} role={mergeError ? 'alert' : 'status'} data-testid="status-document-merge">{mergeError || mergeSuccess}</div>}
        {mergeDialogOpen && <div className="merge-name-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !mergeBusy) setMergeDialogOpen(false); }}>
          <form className="merge-name-dialog" role="dialog" aria-modal="true" aria-labelledby="document-merge-title" onSubmit={submitMerge} onKeyDown={(event) => { if (event.key === 'Escape' && !mergeBusy) setMergeDialogOpen(false); }}>
            <div className="eyebrow">Combine documents</div>
            <h2 id="document-merge-title">Name your merged PDF</h2>
            <p>{mergeCount} PDFs will be combined in the order they were added. The originals will stay unchanged.</p>
            <ol className="document-merge-list" aria-label="PDFs to merge">
              {mergeItems.map((item,index)=><li key={item.id}>
                <span className="document-merge-index">{String(index+1).padStart(2,'0')}</span>
                <span className="document-merge-file"><strong title={item.name}>{item.name}</strong><small>{item.pageCount === null ? 'Reading pages…' : item.pageCount === 0 ? 'Could not read PDF' : `${item.pageCount} ${item.pageCount === 1 ? 'page' : 'pages'}`}</small></span>
                <button type="button" className="icon-btn document-merge-remove" onClick={()=>onRemoveMergeFile(item.id)} disabled={mergeBusy} aria-label={`Remove ${item.name}`} title="Remove PDF"><X size={14}/></button>
              </li>)}
            </ol>
            <label className="field-label" htmlFor="document-merge-name">FILE NAME</label>
            <input id="document-merge-name" className="field-input" autoFocus value={mergeName} onChange={(event) => setMergeName(event.currentTarget.value)} disabled={mergeBusy} data-testid="input-document-merge-name"/>
            {mergeError && <div className="notice error" role="alert" data-testid="status-document-merge-error">{mergeError}</div>}
            <div className="merge-name-actions">
              <button type="button" className="tool-btn" onClick={() => setMergeDialogOpen(false)} disabled={mergeBusy}>Cancel</button>
              <button type="submit" className="tool-btn primary" disabled={!mergeReady || mergeBusy || !mergeName.trim()} data-testid="button-confirm-document-merge">{mergeBusy ? 'Merging…' : 'Merge and save'}</button>
            </div>
          </form>
        </div>}
        <div className={`viewer-stage ${state.pdf ? 'has-document' : 'is-empty'}`}>
          {!state.pdf ? <div className="empty-viewer">
            <div className="empty-icon"><FilePlus2 size={24}/></div>
            <h2>Your document stays on this device.</h2>
            <p>Choose a PDF to view pages, select a region, or export a page as a crisp PNG or JPG.</p>
            <button className="tool-btn primary" onClick={() => fileRef.current?.click()} data-testid="button-choose-pdf-empty"><Upload size={14}/> Choose a PDF</button>
            <div style={{marginTop:14,font:'10px var(--app-font-mono)'}}>PDF FILES · LOCAL PROCESSING</div>
          </div> : <div className="pdf-canvas-wrap">
            <canvas ref={canvasRef} data-testid="canvas-pdf-page"/>
            {cropMode && <div ref={overlayRef} className="crop-overlay" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const r=e.currentTarget.getBoundingClientRect(); setDragStart({x:e.clientX-r.left,y:e.clientY-r.top}); setState((s)=>({...s,crop:null})); }} onPointerMove={updateCrop} onPointerUp={() => setDragStart(null)} data-testid="region-crop-selector">
              {state.crop && <div className="crop-box" style={{left:state.crop.x,top:state.crop.y,width:state.crop.w,height:state.crop.h}}/>}
            </div>}
          </div>}
        </div>
        {renderError && <div className="notice error" style={{margin:12}} data-testid="status-pdf-error">{renderError}</div>}
      </section>
      <aside className="side-panel">
        <section className="panel side-card">
          <h2 className="card-title"><FileImage size={15}/> Export image</h2>
          <p className="hint" style={{margin:'-5px 0 13px'}}>Save the current page or only the selected region.</p>
          <button className="tool-btn" style={{width:'100%',justifyContent:'center',marginBottom:7}} disabled={!state.pdf} onClick={() => downloadCanvas('png')} data-testid="button-export-page-png">Export page as PNG</button>
          <button className="tool-btn" style={{width:'100%',justifyContent:'center',marginBottom:7}} disabled={!state.pdf} onClick={() => downloadCanvas('jpeg')} data-testid="button-export-page-jpg">Export page as JPG</button>
          <button className="tool-btn soft" style={{width:'100%',justifyContent:'center'}} disabled={!state.pdf || !state.crop || state.crop.w < 3} onClick={() => downloadCanvas('png', true)} data-testid="button-export-crop">Export selected crop</button>
        </section>
        <section className="panel side-card">
          <h2 className="card-title"><Activity size={15}/> Document details</h2>
          <div className="stat-row"><span>File</span><strong data-testid="text-document-name">{state.fileName || '—'}</strong></div>
          <div className="stat-row"><span>Page</span><strong data-testid="text-current-page">{state.pdf ? `${state.page} of ${state.pageCount}` : '—'}</strong></div>
          <div className="stat-row"><span>Selection</span><strong data-testid="text-crop-status">{state.crop ? `${Math.round(state.crop.w)} × ${Math.round(state.crop.h)} px` : 'None'}</strong></div>
          <hr className="divider"/>
          <p className="hint">Exports are rendered in your browser and downloaded directly. Nothing is sent to a server.</p>
        </section>
        <section className="panel side-card">
          <h2 className="card-title"><CircleHelp size={15}/> Quick help</h2>
          <p className="hint">Use the page controls to browse. Select crop, then drag across the page to define an export region. Add page to sheet sends a local preview copy to print setup.</p>
        </section>
      </aside>
    </div>
    {organizeOpen && state.fileBlob && state.sourceToken && <div className="organize-modal-backdrop">
      <div className="organize-modal-content">
        <OrganizePage
          embedded
          initialDocuments={navigationDocuments.map(({blob,name,sourceToken})=>({blob,name,token:sourceToken}))}
          libraryPdfs={organizePdfs}
          mergeCount={mergeCount}
          onOpenMerge={()=>{setOrganizeOpen(false);openMergeDialog();}}
          onLoadLibraryPdf={onLoadOrganizePdf}
          onSave={onSaveOrganizedPdf}
          onClose={()=>setOrganizeOpen(false)}
        />
      </div>
    </div>}
  </div>;
}

const papers: Record<string, {label:string;w:number;h:number}> = {
  letter:{label:'Letter · 8.5 × 11 in',w:816,h:1056}, a4:{label:'A4 · 210 × 297 mm',w:794,h:1123},
  legal:{label:'Legal · 8.5 × 14 in',w:816,h:1344}, photo:{label:'4 × 6 in',w:384,h:576},
};

function PrintPage({ state, setState, settings, setSettings, onLibraryChange, onSavePrintJob }: {
  state: WorkspaceState;
  setState: React.Dispatch<React.SetStateAction<WorkspaceState>>;
  settings: PrintSettings;
  setSettings: React.Dispatch<React.SetStateAction<PrintSettings>>;
  onLibraryChange: () => void;
  onSavePrintJob: (settings: PrintSettings, assets: LocalAsset[]) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { paper, orientation, placement, columns } = settings;
  const [message, setMessage] = useState('');
  const addAssets = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const newAssets: LocalAsset[] = [];
    for (const file of files) {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        try {
          let sourceFileId: string | undefined;
          try { sourceFileId = (await saveLibraryFile(file, { type: 'pdf' })).id; } catch { setMessage(`${file.name} was added to the sheet but could not be saved to the library.`); }
          const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
          for (let pageNum=1;pageNum<=doc.numPages;pageNum++) {
            const page = await doc.getPage(pageNum), viewport = page.getViewport({scale:1.1});
            const canvas=document.createElement('canvas'); canvas.width=viewport.width; canvas.height=viewport.height;
            const ctx=canvas.getContext('2d'); if(ctx) await page.render({canvas,canvasContext:ctx,viewport}).promise;
            newAssets.push({id:crypto.randomUUID(),name:`${file.name} · page ${pageNum}`,kind:'image',src:canvas.toDataURL('image/png'),page:pageNum,sourceFileId});
          }
        } catch { setMessage(`${file.name} could not be opened.`); }
      } else if (file.type.startsWith('image/')) {
        let sourceFileId: string | undefined;
        try { sourceFileId = (await saveLibraryFile(file, { type: 'image' })).id; } catch { setMessage(`${file.name} was added to the sheet but could not be saved to the library.`); }
        newAssets.push({id:crypto.randomUUID(),name:file.name,kind:'image',src:URL.createObjectURL(file),sourceFileId});
      }
    }
    if (newAssets.length) { setState((s)=>({...s,assets:[...s.assets,...newAssets]})); onLibraryChange(); setMessage(`${newAssets.length} item${newAssets.length===1?'':'s'} added locally.`); }
    event.target.value='';
  };
  const removeAsset = (id:string) => {
    const asset = state.assets.find((item) => item.id === id);
    if (asset?.src?.startsWith('blob:')) URL.revokeObjectURL(asset.src);
    setState((s)=>({...s,assets:s.assets.filter((a)=>a.id!==id)}));
  };
  const dimensions = useMemo(() => {
    const base = papers[paper] ?? papers.letter;
    return orientation === 'portrait' ? {w:base.w,h:base.h} : {w:base.h,h:base.w};
  },[paper,orientation]);
  const previewRatio = Math.min(480 / dimensions.w, 520 / dimensions.h);
  const cols = Math.max(1,Math.min(4,Number(columns)||2));
  const rows = Math.max(1,Math.ceil(state.assets.length/cols));
  const printNow = async () => {
    if (!state.assets.length) { setMessage('Add at least one image or PDF page before printing.'); return; }
    try {
      await onSavePrintJob(settings, state.assets);
      setMessage('Print setup saved to local history. The system print dialog will open; the app cannot confirm whether paper was printed.');
    } catch {
      setMessage('Print history could not be saved, but the print dialog will still open.');
    }
    window.print();
  };
  return <div className="page-wrap">
    <style>{`@media print { @page { size: ${dimensions.w/96}in ${dimensions.h/96}in; margin: 0; } }`}</style>
    <input ref={inputRef} className="hidden-input" type="file" accept="image/*,application/pdf,.pdf" multiple onChange={addAssets} data-testid="input-sheet-files"/>
    {message && <div className="notice info" data-testid="status-print-message">{message}</div>}
    <div className="sheet-layout">
      <section className="panel settings-card print-hide">
        <h2 className="card-title"><LayoutGrid size={15}/> Sheet setup</h2>
        <div className="field-row"><label className="field-label" htmlFor="paper-size">PAPER SIZE</label><select id="paper-size" className="field-select" value={paper} onChange={(e)=>setSettings((s)=>({...s,paper:e.target.value}))} data-testid="select-paper-size">{Object.entries(papers).map(([key,p])=><option key={key} value={key}>{p.label}</option>)}</select></div>
        <div className="field-row"><span className="field-label">ORIENTATION</span><div className="radio-row">{(['portrait','landscape'] as const).map((o)=><button key={o} type="button" className={`radio-choice ${orientation===o?'selected':''}`} onClick={()=>setSettings((s)=>({...s,orientation:o}))} data-testid={`button-orientation-${o}`}><span style={{width:9,height:11,border:'1px solid currentColor',display:'inline-block',transform:o==='landscape'?'rotate(90deg)':''}}/>{o[0].toUpperCase()+o.slice(1)}</button>)}</div></div>
        <div className="field-row"><label className="field-label" htmlFor="fit-mode">IMAGE PLACEMENT</label><select id="fit-mode" className="field-select" value={placement} onChange={(e)=>setSettings((s)=>({...s,placement:e.target.value as 'fit'|'fill'}))} data-testid="select-placement"><option value="fit">Fit · preserve full image</option><option value="fill">Fill · crop to cell</option></select></div>
        <div className="field-row"><label className="field-label" htmlFor="column-count">COLUMNS PER SHEET</label><select id="column-count" className="field-select" value={columns} onChange={(e)=>setSettings((s)=>({...s,columns:e.target.value}))} data-testid="select-columns"><option value="1">1 column</option><option value="2">2 columns</option><option value="3">3 columns</option><option value="4">4 columns</option></select></div>
        <button className="tool-btn" style={{width:'100%',justifyContent:'center',marginTop:4}} onClick={()=>inputRef.current?.click()} data-testid="button-add-print-files"><Upload size={14}/> Add images or PDF pages</button>
        <div className="asset-list" data-testid="list-sheet-assets">
          {state.assets.map((asset)=><div className="asset-row" key={asset.id} data-testid={`row-sheet-asset-${asset.id}`}><div className="asset-thumb">{asset.src?<img src={asset.src} alt=""/>:<FileImage size={15}/>}</div><span title={asset.name}>{asset.name}</span><button type="button" aria-label={`Remove ${asset.name}`} onClick={()=>removeAsset(asset.id)} data-testid={`button-remove-asset-${asset.id}`}><X size={14}/></button></div>)}
          {!state.assets.length && <div className="hint" style={{padding:'8px 2px'}}>No items yet. Upload images or convert PDF pages to local previews.</div>}
        </div>
      </section>
      <section className="panel sheet-preview-card">
        <div className="preview-head"><h2>Print preview</h2><span data-testid="text-sheet-summary">{papers[paper].label} · {orientation} · {state.assets.length} items</span><button className="tool-btn primary" onClick={printNow} data-testid="button-print-sheet"><Printer size={14}/> Print sheet</button></div>
        <div className="preview-canvas-bg">
          <div className="paper-sheet" data-testid="print-sheet-preview" style={{width:dimensions.w*previewRatio,height:dimensions.h*previewRatio,gridTemplateColumns:`repeat(${cols}, minmax(0,1fr))`,gridAutoRows:`minmax(0, 1fr)`,'--paper-print-width':`${dimensions.w/96}in`,'--paper-print-height':`${dimensions.h/96}in`} as React.CSSProperties}>
            {state.assets.map((asset,i)=><div className="sheet-item" key={asset.id} style={{gridColumn:`span 1`, minHeight:rows>1?0:65}} data-testid={`preview-sheet-item-${i}`}>
              {asset.src ? <img src={asset.src} alt={asset.name} style={{objectFit:placement==='fit'?'contain':'cover'}}/>:<FileImage size={20}/>}<span>{i+1}</span>
            </div>)}
            {!state.assets.length && <div style={{gridColumn:'1/-1',alignSelf:'center',textAlign:'center',color:'#9aa5a4',fontSize:11}}>Your sheet preview will appear here</div>}
          </div>
        </div>
        <p className="hint" style={{margin:'13px 0 0'}}>Browser print dialog will use your system printer. Confirm paper size and margins in the print dialog.</p>
      </section>
    </div>
  </div>;
}

function LicensePage({ connectionError, onRetry }: { connectionError?: string; onRetry?: () => void }) {
  const deviceId = useDeviceId();
  const [,setLocation] = useLocation();
  const [apiUrl,setApiUrl] = useState(isDesktop ? localStorage.getItem(API_URL_KEY) ?? '' : '');
  const [mode,setMode] = useState<'new'|'existing'|'request'>('new');
  const [newStep,setNewStep] = useState<'license'|'signup'>('license');
  const [authBusy,setAuthBusy] = useState(false);
  const [authNotice,setAuthNotice] = useState<{kind:'success'|'error'|'info';text:string}|null>(null);
  const [pendingShopTransfer,setPendingShopTransfer] = useState(false);
  const [licenseKey,setLicenseKey] = useState(localStorage.getItem('windows-pdf-studio-license') ?? '');
  const [verifiedLicenseEmail,setVerifiedLicenseEmail] = useState('');
  const [authForm,setAuthForm] = useState({email:'',password:'',confirmPassword:''});
  const [notice,setNotice] = useState<{kind:'success'|'error'|'info';text:string}|null>(null);
  const createRequest = useCreateLicenseRequest();
  const [requestForm,setRequestForm] = useState({name:'',email:'',deviceName:''});

  const saveApiUrl = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const url = new URL(apiUrl.trim());
      if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        setNotice({kind:'error',text:'Use a secure HTTPS address for the published license service.'});
        return;
      }
      if (url.pathname !== '/' || url.search || url.hash) {
        setNotice({kind:'error',text:'Enter the published app address only, without a path.'});
        return;
      }
      if (isTemporaryDevelopmentUrl(url.origin)) {
        setNotice({kind:'error',text:developmentUrlNotice});
        return;
      }
      const origin = url.origin;
      localStorage.setItem(API_URL_KEY,origin);
      setApiUrl(origin);
      setBaseUrl(origin);
      setNotice({kind:'success',text:'License service address saved for this device.'});
      window.dispatchEvent(new Event('windows-pdf-studio-api-url-change'));
    } catch {
      setNotice({kind:'error',text:'Enter a valid published app address.'});
    }
  };
  const verifyLicense = async (event:React.FormEvent) => {
    event.preventDefault();
    setAuthNotice(null);
    const key = licenseKey.trim();
    if (!key) {
      setAuthNotice({kind:'error',text:'Enter the license key issued for this shop.'});
      return;
    }
    if (isDesktop && !apiUrl) {
      setAuthNotice({kind:'error',text:'Connect the published license service before verifying this key.'});
      return;
    }
    setAuthBusy(true);
    try {
      const result = await serviceRequest<{active:boolean;email:string}>('licenses/activate',{licenseKey:key,deviceId});
      if (!result.active || !result.email) throw new Error('The license service did not confirm this key.');
      setLicenseKey(key);
      setVerifiedLicenseEmail(result.email);
      setAuthForm((current)=>({...current,email:result.email}));
      setNewStep('signup');
      setAuthNotice({kind:'success',text:'License verified. Create the sign-in for this shop.'});
    } catch (error) {
      setVerifiedLicenseEmail('');
      setNewStep('license');
      setAuthNotice({kind:'error',text:authErrorMessage(error,'The license could not be verified.')});
    } finally {
      setAuthBusy(false);
    }
  };
  const submitRequest = (e:React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (isDesktop && !localStorage.getItem(API_URL_KEY)) {
      setNotice({kind:'error',text:'Connect this Windows installation to the published license service first. Enter and save its address below, then submit again.'});
      window.setTimeout(() => {
        const serviceUrlInput = document.getElementById('license-service-url') as HTMLInputElement | null;
        serviceUrlInput?.scrollIntoView({behavior:'smooth',block:'center'});
        serviceUrlInput?.focus({preventScroll:true});
      }, 0);
      return;
    }
    createRequest.mutate({data:{
      name:requestForm.name.trim(),
      email:requestForm.email.trim().toLowerCase(),
      deviceId,
      deviceName:requestForm.deviceName.trim(),
    }},{onSuccess:()=>{
      setNotice({kind:'success',text:'Request submitted. An administrator will review the shop details and issue a license.'});
      setRequestForm({name:'',email:'',deviceName:''});
    },onError:(error)=>{
      setNotice({kind:'error',text:authErrorMessage(error,'We could not submit this request. Check the license service connection and try again.')});
    }});
  };
  const submitAccount = async (event:React.FormEvent) => {
    event.preventDefault();
    setAuthNotice(null);
    setPendingShopTransfer(false);
    if (isDesktop && !apiUrl) {
      setAuthNotice({kind:'error',text:'Save the license service address before signing in or registering.'});
      return;
    }
    if (mode === 'new' && authForm.password !== authForm.confirmPassword) {
      setAuthNotice({kind:'error',text:'The passwords do not match.'});
      return;
    }
    if (mode === 'new' && !verifiedLicenseEmail) {
      setAuthNotice({kind:'error',text:'Verify this shop license before creating an account.'});
      setNewStep('license');
      return;
    }
    setAuthBusy(true);
    try {
      const body = mode === 'new'
        ? {licenseKey:licenseKey.trim(),email:verifiedLicenseEmail,password:authForm.password,deviceId,client:isDesktop?'desktop':'browser'}
        : {email:authForm.email,password:authForm.password,deviceId,client:isDesktop?'desktop':'browser'};
      const session = await authRequest(mode === 'new' ? 'shop/register' : 'login',body);
      if (!session.account) throw new Error('The license service did not return an account.');
      if (isDesktop && !session.accessToken) throw new Error('The desktop session token was not returned. Check the license service.');
      storeDesktopSession(session.accessToken);
      if (isDesktop && mode === 'new') localStorage.setItem('windows-pdf-studio-license',licenseKey.trim());
      setAuthNotice({kind:'success',text:mode === 'new'?'Shop account created. This Windows installation is now linked to its license.':'Signed in to this shop installation.'});
      setLocation('/');
    } catch (error) {
      const authError = error as Error & {code?:string};
      if (isDesktop && authError.code === 'SHOP_INSTALLATION_TRANSFER_REQUIRED') {
        setPendingShopTransfer(true);
        setAuthNotice({kind:'info',text:'This shop account is linked to another installation. Moving it here will sign out that installation and make this Windows app the active shop device. Local files on the other device will stay there.'});
      } else {
        setAuthNotice({kind:'error',text:authErrorMessage(error,'Account access could not be completed.')});
      }
    } finally {
      setAuthBusy(false);
    }
  };
  const transferShopToThisInstallation = async () => {
    setAuthBusy(true);
    setAuthNotice(null);
    try {
      const session = await authRequest('login',{
        email:authForm.email.trim(),
        password:authForm.password,
        deviceId,
        client:'desktop',
        transferInstallation:true,
      });
      if (!session.account || !session.accessToken) {
        throw new Error('The license service did not return a Windows session.');
      }
      storeDesktopSession(session.accessToken);
      setPendingShopTransfer(false);
      setLocation('/');
    } catch (error) {
      setPendingShopTransfer(false);
      setAuthNotice({kind:'error',text:authErrorMessage(error,'The shop could not be moved to this installation.')});
    } finally {
      setAuthBusy(false);
    }
  };
  const activeMode = mode === 'existing' ? 'existing' : 'new';

  return <main className="shop-access-screen">
    <div className="shop-access-brandbar">
      <Brand caption="Secure shop access"/>
      <span className="shop-access-secure"><LockKeyhole size={13}/> LICENSED INSTALLATION</span>
    </div>
    <div className="shop-access-layout">
      <section className="shop-access-intro">
        <div className="shop-access-kicker">WINDOWS PDF STUDIO · SHOP EDITION</div>
        <h1>Your shop’s documents,<br/>ready when you are.</h1>
        <p>Connect this installation to its licensed shop account to open the private document workspace.</p>
        <div className="shop-access-promises">
          <div><CheckCircle2 size={17}/><span><strong>Private by design</strong><small>Documents stay on this device.</small></span></div>
          <div><CheckCircle2 size={17}/><span><strong>One installation, one shop</strong><small>Each shop has its own account and QR.</small></span></div>
          <div><CheckCircle2 size={17}/><span><strong>Customer jobs stay separate</strong><small>Every customer submission remains its own request.</small></span></div>
        </div>
        <div className="shop-access-installation"><span>INSTALLATION ID</span><strong data-testid="text-license-device-id">{deviceId.slice(0,18)}…</strong></div>
      </section>

      <section className="shop-access-card panel" aria-labelledby="shop-access-title">
        <div className="shop-access-card-heading">
          <div className="shop-access-card-mark"><FileText size={19}/></div>
          <div><div className="eyebrow">SHOP ACCESS</div><h2 id="shop-access-title">{mode === 'request' ? 'Request a shop license' : mode === 'existing' ? 'Welcome back' : newStep === 'signup' ? 'Create your shop account' : 'Connect a new shop'}</h2></div>
        </div>

        {mode !== 'request' && <div className="shop-access-tabs" role="tablist" aria-label="Shop account">
          <button type="button" className={activeMode==='new'?'active':''} role="tab" aria-selected={activeMode==='new'} onClick={()=>{setMode('new');setAuthNotice(null);setPendingShopTransfer(false);}} data-testid="button-new-shop-tab">New shop</button>
          <button type="button" className={activeMode==='existing'?'active':''} role="tab" aria-selected={activeMode==='existing'} onClick={()=>{setMode('existing');setAuthNotice(null);setPendingShopTransfer(false);}} data-testid="button-existing-shop-tab">Existing shop</button>
        </div>}

        {notice && <div className={`notice ${notice.kind}`} role="status" data-testid="status-license-message">{notice.text}</div>}
        {connectionError && <div className="notice error" role="alert" data-testid="status-license-connection-error">{connectionError} <button type="button" className="tool-btn" onClick={onRetry} data-testid="button-retry-license-connection"><RefreshCw size={13}/> Retry connection</button></div>}
        {authNotice && <div className={`notice ${authNotice.kind}`} role="status" data-testid="status-shop-auth">
          {authNotice.text}
          {pendingShopTransfer && <div className="shop-access-transfer-actions">
            <button type="button" className="shop-access-submit" disabled={authBusy} onClick={()=>void transferShopToThisInstallation()} data-testid="button-confirm-shop-transfer">{authBusy?'Moving shop…':'Move shop to this Windows app'}</button>
            <button type="button" className="shop-access-text-button" disabled={authBusy} onClick={()=>{setPendingShopTransfer(false);setAuthNotice(null);}} data-testid="button-cancel-shop-transfer">Cancel</button>
          </div>}
        </div>}

        {mode === 'new' && newStep === 'license' && <form className="shop-access-form" onSubmit={(event)=>void verifyLicense(event)}>
          <p className="shop-access-description">Enter the approved license key for this installation. We’ll verify it before asking you to create an account.</p>
          <div className="field-row">
            <label className="field-label" htmlFor="shop-license-key">SHOP LICENSE KEY</label>
            <input id="shop-license-key" className="field-input code-input" value={licenseKey} onChange={(event)=>setLicenseKey(event.target.value)} placeholder="Enter your approved license key" autoComplete="off" required data-testid="input-license-key"/>
          </div>
          <button className="shop-access-submit" type="submit" disabled={authBusy || (isDesktop && !apiUrl)} data-testid="button-verify-license">{authBusy?'Checking license…':'Verify license'}</button>
          {isDesktop && !apiUrl && <p className="shop-access-inline-hint">Save the published license service address below before continuing.</p>}
          <div className="shop-access-footnote">Your license is checked for this installation before account setup.</div>
          <button type="button" className="shop-access-text-button" onClick={()=>{setMode('request');setAuthNotice(null);setNotice(null);}} data-testid="button-open-license-request">Don’t have a license? Request one</button>
        </form>}

        {mode === 'new' && newStep === 'signup' && <form className="shop-access-form" onSubmit={(event)=>void submitAccount(event)}>
          <div className="shop-access-progress" aria-label="License verified, account setup in progress"><span className="done">1&nbsp; License verified</span><i/><span className="current">2&nbsp; Create account</span></div>
          <div className="shop-access-verified"><CheckCircle2 size={17}/><span><strong>License verified</strong><small>This license is assigned to {verifiedLicenseEmail}.</small></span></div>
          <div className="field-row"><label className="field-label" htmlFor="shop-email">LICENSE EMAIL</label><input id="shop-email" className="field-input" type="email" value={verifiedLicenseEmail} readOnly autoComplete="username" data-testid="input-shop-email"/></div>
          <div className="field-row"><label className="field-label" htmlFor="shop-password">CREATE PASSWORD <span>12 CHARACTERS MINIMUM</span></label><input id="shop-password" className="field-input" type="password" value={authForm.password} onChange={(event)=>setAuthForm({...authForm,password:event.target.value})} minLength={12} maxLength={256} autoComplete="new-password" required data-testid="input-shop-password"/></div>
          <div className="field-row"><label className="field-label" htmlFor="shop-confirm-password">CONFIRM PASSWORD</label><input id="shop-confirm-password" className="field-input" type="password" value={authForm.confirmPassword} onChange={(event)=>setAuthForm({...authForm,confirmPassword:event.target.value})} minLength={12} maxLength={256} autoComplete="new-password" required data-testid="input-shop-confirm-password"/></div>
          <button className="shop-access-submit" type="submit" disabled={authBusy} data-testid="button-shop-auth-submit">{authBusy?'Creating account…':'Create shop account'}</button>
          <button type="button" className="shop-access-text-button" onClick={()=>{setNewStep('license');setVerifiedLicenseEmail('');setAuthForm({email:'',password:'',confirmPassword:''});setAuthNotice(null);}} data-testid="button-change-license">Use a different license key</button>
        </form>}

        {mode === 'existing' && <form className="shop-access-form" onSubmit={(event)=>void submitAccount(event)}>
          <p className="shop-access-description">Sign in with this shop’s email and password. If it is linked to another installation, you can confirm moving it here.</p>
          <div className="field-row"><label className="field-label" htmlFor="shop-email">EMAIL ADDRESS</label><input id="shop-email" className="field-input" type="email" value={authForm.email} onChange={(event)=>setAuthForm({...authForm,email:event.target.value})} placeholder="you@example.com" autoComplete="username" required disabled={authBusy || pendingShopTransfer} data-testid="input-shop-email"/></div>
          <div className="field-row"><label className="field-label" htmlFor="shop-password">PASSWORD</label><input id="shop-password" className="field-input" type="password" value={authForm.password} onChange={(event)=>setAuthForm({...authForm,password:event.target.value})} maxLength={256} autoComplete="current-password" required disabled={authBusy || pendingShopTransfer} data-testid="input-shop-password"/></div>
          <button className="shop-access-submit" type="submit" disabled={authBusy || (isDesktop && !apiUrl)} data-testid="button-shop-auth-submit">{authBusy?'Signing in…':'Sign in to your shop'}</button>
        </form>}

        {mode === 'request' && <form className="shop-access-form" onSubmit={submitRequest}>
          <p className="shop-access-description">Send a request for this installation. An administrator will review the shop details and issue a license.</p>
          <div className="field-row"><label className="field-label" htmlFor="request-name">YOUR NAME</label><input id="request-name" className="field-input" value={requestForm.name} maxLength={120} required onChange={(event)=>setRequestForm({...requestForm,name:event.target.value})} placeholder="Full name" data-testid="input-request-name"/></div>
          <div className="field-row"><label className="field-label" htmlFor="request-email">EMAIL ADDRESS</label><input id="request-email" className="field-input" type="email" value={requestForm.email} required onChange={(event)=>setRequestForm({...requestForm,email:event.target.value})} placeholder="you@example.com" data-testid="input-request-email"/></div>
          <div className="field-row"><label className="field-label" htmlFor="request-device">SHOP NAME</label><input id="request-device" className="field-input" value={requestForm.deviceName} maxLength={120} required onChange={(event)=>setRequestForm({...requestForm,deviceName:event.target.value})} placeholder="e.g. Central Market Xerox" data-testid="input-request-device-name"/></div>
          {isDesktop && !localStorage.getItem(API_URL_KEY) && <p className="shop-access-inline-hint" role="note" data-testid="hint-license-service-required">This Windows installation needs a saved license-service address before it can send a request. Click submit to go to that setting.</p>}
          <button className="shop-access-submit" type="submit" disabled={createRequest.isPending || !requestForm.name.trim() || !requestForm.email.trim() || !requestForm.deviceName.trim()} data-testid="button-submit-license-request">{createRequest.isPending?'Submitting request…':'Submit license request'}</button>
          <button type="button" className="shop-access-text-button" onClick={()=>{setMode('new');setNotice(null);}} data-testid="button-back-to-license">Back to shop access</button>
        </form>}
      </section>
    </div>

    {isDesktop && <section className="shop-access-service panel">
      <div className="shop-access-service-copy"><div className="shop-access-service-icon"><Activity size={16}/></div><div><strong>License service</strong><span>{isTemporaryDevelopmentUrl(apiUrl) ? 'This development address cannot be reached from the Windows app.' : apiUrl ? 'Address saved for this installation.' : 'Connect this installation to the published service.'}</span></div></div>
      <form onSubmit={saveApiUrl} className="shop-access-service-form">
        <label className="field-label" htmlFor="license-service-url">PUBLISHED APP ADDRESS</label>
        <div className="shop-access-service-controls"><input id="license-service-url" className="field-input" type="url" value={apiUrl} onChange={(event)=>setApiUrl(event.target.value)} placeholder="https://your-published-service.example" data-testid="input-license-service-url"/><button className="tool-btn" type="submit" data-testid="button-save-license-service">Save address</button></div>
        <p className="shop-access-inline-hint" data-testid="hint-published-service-required">Use the public license-service address. Temporary development addresses cannot be used by installed Windows apps.</p>
        {isDesktop && isTemporaryDevelopmentUrl(apiUrl) && <p className="shop-access-inline-hint error" role="alert" data-testid="status-development-service-url">{developmentUrlNotice}</p>}
      </form>
    </section>}
    <footer className="shop-access-footer"><LockKeyhole size={13}/> Shop account access is separate from customer print jobs and local files.</footer>
  </main>;
}

function ShopAccessGate({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [serviceOrigin,setServiceOrigin] = useState(localStorage.getItem(API_URL_KEY) ?? '');
  const [sessionToken,setSessionToken] = useState(localStorage.getItem(AUTH_TOKEN_KEY) ?? '');
  const [status,setStatus] = useState<'checking'|'locked'|'unlocked'>('checking');
  const [connectionError,setConnectionError] = useState<string>();
  const [retryCount,setRetryCount] = useState(0);
  const publicBrowserRoute = !isDesktop && (location === '/admin' || location.startsWith('/admin/') || location.startsWith('/send/') || location.startsWith('/track/'));

  useEffect(() => {
    const syncAccessSettings = () => {
      setServiceOrigin(localStorage.getItem(API_URL_KEY) ?? '');
      setSessionToken(localStorage.getItem(AUTH_TOKEN_KEY) ?? '');
      setRetryCount((count)=>count+1);
    };
    window.addEventListener('windows-pdf-studio-auth-change',syncAccessSettings);
    window.addEventListener('windows-pdf-studio-api-url-change',syncAccessSettings);
    return () => {
      window.removeEventListener('windows-pdf-studio-auth-change',syncAccessSettings);
      window.removeEventListener('windows-pdf-studio-api-url-change',syncAccessSettings);
    };
  },[]);

  useEffect(() => {
    let active = true;
    if (publicBrowserRoute) {
      setConnectionError(undefined);
      setStatus('unlocked');
      return () => { active = false; };
    }
    if (isDesktop && (!serviceOrigin || !sessionToken)) {
      setConnectionError(undefined);
      setStatus('locked');
      return () => { active = false; };
    }

    setStatus('checking');
    setConnectionError(undefined);
    void authRequest('me').then((session) => {
      if (!active) return;
      if (session.account?.role === 'shop' && session.account.licenseActive) {
        localStorage.setItem(AUTH_VERIFIED_AT_KEY,String(Date.now()));
        setStatus('unlocked');
        return;
      }
      if (isDesktop) storeDesktopSession(null);
      setStatus('locked');
    }).catch((error:unknown) => {
      if (!active) return;
      const statusCode = typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as {status?:unknown}).status)
        : undefined;
      if (statusCode === 401 || statusCode === 403) {
        if (isDesktop) storeDesktopSession(null);
        setConnectionError(undefined);
        setStatus('locked');
        return;
      }
      const lastVerifiedAt = Number(localStorage.getItem(AUTH_VERIFIED_AT_KEY) ?? 0);
      if (isDesktop && lastVerifiedAt > 0 && Date.now() - lastVerifiedAt <= OFFLINE_SESSION_GRACE_MS) {
        setStatus('unlocked');
      } else {
        setConnectionError(isDesktop
          ? 'The license service could not be reached. Connect to the internet and retry; the workspace stays locked until this shop is verified.'
          : 'The shop service could not be reached. Check the connection and retry.');
        setStatus('locked');
      }
    });
    return () => { active = false; };
  },[publicBrowserRoute,serviceOrigin,sessionToken,retryCount]);

  if (publicBrowserRoute) return <>{children}</>;
  if (status === 'unlocked') return <>{children}</>;
  if (status === 'checking') {
    return <main className="shop-access-loading">
      <Brand caption="Verifying shop access"/>
      <section className="panel"><RefreshCw size={17}/><div><strong>Checking your shop account…</strong><span>The workspace stays locked until access is confirmed.</span></div></section>
    </main>;
  }
  return <>
    <LicensePage connectionError={connectionError} onRetry={()=>setRetryCount((count)=>count+1)}/>
  </>;
}

function AdminQueue() {
  const requestsQuery = useListLicenseRequests();
  const review = useReviewLicenseRequest();
  const queryClient = useQueryClient();
  const [requestPage, setRequestPage] = useState(1);
  const [result,setResult] = useState<{request:LicenseRequest;key:string|null}|null>(null);
  const [error,setError] = useState('');
  const requests = requestsQuery.data ?? [];
  const requestPageSize = 20;
  const requestPageCount = Math.max(1, Math.ceil(requests.length / requestPageSize));
  const safeRequestPage = Math.min(requestPage, requestPageCount);
  const pageRequests = requests.slice((safeRequestPage - 1) * requestPageSize, safeRequestPage * requestPageSize);
  useEffect(() => {
    setRequestPage((page) => Math.min(page, requestPageCount));
  }, [requestPageCount]);
  const decide = (request:LicenseRequest,decision:'approve'|'decline') => {
    setError('');
    review.mutate({requestId:request.id,data:{decision}},{onSuccess:(res)=>{setResult({request:res.request,key:res.licenseKey});void queryClient.invalidateQueries({queryKey:getListLicenseRequestsQueryKey()});},onError:()=>setError('The request could not be reviewed. Retry in a moment.')});
  };
  return <div className="page-wrap">
    <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
      <button className="tool-btn" onClick={()=>void requestsQuery.refetch()} data-testid="button-refresh-requests"><RefreshCw size={14}/> Refresh queue</button>
    </div>
    {result?.key && <div className="notice success" data-testid="status-issued-license-key"><strong>Approved for {result.request.name}.</strong> License key: <code style={{fontFamily:'var(--app-font-mono)',marginLeft:6}}>{result.key}</code></div>}
    {result && !result.key && <div className="notice info" data-testid="status-review-complete">Request {result.request.id} was declined.</div>}
    {error && <div className="notice error" role="alert" data-testid="status-admin-error">{error}</div>}
    <section className="panel" style={{overflow:'hidden'}}>
      {requestsQuery.isLoading ? <div className="empty-state" data-testid="status-admin-loading"><RefreshCw size={20}/><h3>Loading requests</h3><p>Retrieving the administrator queue.</p></div> :
       requestsQuery.isError ? <div className="empty-state" data-testid="status-admin-query-error"><Activity size={22}/><h3>Queue unavailable</h3><p>Administrator access may be required, or the connection failed.</p><button className="tool-btn" style={{marginTop:12}} onClick={()=>void requestsQuery.refetch()} data-testid="button-retry-requests">Try again</button></div> :
        !requests.length ? <div className="empty-state" data-testid="status-admin-empty"><ShieldCheck size={25}/><h3>Queue is clear</h3><p>New license access requests will appear here.</p></div> :
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Requester</th><th>Device</th><th>Submitted</th><th>Status</th><th>License key</th><th>Review</th></tr></thead><tbody>
         {pageRequests.map((request)=><tr key={request.id} data-testid={`row-license-request-${request.id}`}>
          <td className="person-cell"><strong>{request.name}</strong><span>{request.email}</span></td>
          <td><strong style={{display:'block',color:'#45545a',fontSize:11}}>{request.deviceName}</strong><span style={{font:'9px var(--app-font-mono)',color:'#8b9699'}}>{request.deviceId}</span></td>
          <td>{new Date(request.createdAt).toLocaleDateString()}</td>
          <td><span className={`status-badge ${request.status}`} data-testid={`status-request-${request.id}`}><span>•</span>{request.status}</span></td>
           <td>{request.status==='approved' && request.licenseKey
             ? <code className="license-key-cell" data-testid={`text-issued-license-key-${request.id}`}>{request.licenseKey}</code>
             : <span className="hint">—</span>}</td>
          <td>{request.status==='pending'?<div className="row-actions">
            <button className="tool-btn soft" disabled={review.isPending} onClick={()=>decide(request,'approve')} data-testid={`button-approve-request-${request.id}`}><Check size={13}/> Approve</button>
            <button className="tool-btn" disabled={review.isPending} onClick={()=>decide(request,'decline')} data-testid={`button-decline-request-${request.id}`}>Decline</button>
          </div>:<span className="hint">{request.reviewedAt?new Date(request.reviewedAt).toLocaleDateString():'Reviewed'}</span>}</td>
        </tr>)}
        </tbody></table></div>}
      {!requestsQuery.isLoading && !requestsQuery.isError && requests.length > 0 && (
        <PaginationControls page={safeRequestPage} pageSize={requestPageSize} total={requests.length} itemLabel="requests" onPageChange={setRequestPage} />
      )}
    </section>
  </div>;
}

function AdminPage() {
  return isDesktop ? <DesktopAdminPage/> : <BrowserAdminPage/>;
}

function DesktopAdminPage() {
  const appUrl = localStorage.getItem(API_URL_KEY);
  return <div className="auth-shell"><section className="panel license-card">
    <Brand caption="Shop dashboard"/>
    {appUrl
      ? <a className="tool-btn primary" href={`${appUrl}/admin`} target="_blank" rel="noreferrer" data-testid="link-open-web-admin">Open central admin portal</a>
      : <Link href="/" className="tool-btn primary" data-testid="link-back-to-documents">Back to Editor</Link>}
  </section></div>;
}

function BrowserAdminPage() {
  const [account,setAccount] = useState<AuthSessionResponse['account']|null>(null);
  const [authMode,setAuthMode] = useState<'login'|'setup'>('login');
  const [checking,setChecking] = useState(true);
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState<{kind:'success'|'error';text:string}|null>(null);
  const [form,setForm] = useState({email:'',password:'',confirmPassword:'',bootstrapSecret:''});

  useEffect(() => {
    let active = true;
    void authRequest('me').then((session) => {
      if (active && session.account?.role === 'admin') setAccount(session.account);
    }).catch(() => {
      if (active) setAccount(null);
    }).finally(() => {
      if (active) setChecking(false);
    });
    return () => { active = false; };
  },[]);

  const submit = async (event:React.FormEvent) => {
    event.preventDefault();
    setNotice(null);
    if (authMode === 'setup' && form.password !== form.confirmPassword) {
      setNotice({kind:'error',text:'The passwords do not match.'});
      return;
    }
    setBusy(true);
    try {
      const session = await authRequest(
        authMode === 'setup' ? 'admin/register' : 'login',
        authMode === 'setup'
          ? {email:form.email,password:form.password,bootstrapSecret:form.bootstrapSecret}
          : {email:form.email,password:form.password,client:'browser'},
      );
      if (session.account?.role !== 'admin') throw new Error('This account does not have administrator access.');
      setAccount(session.account);
      setForm({email:'',password:'',confirmPassword:'',bootstrapSecret:''});
      setNotice({kind:'success',text:authMode==='setup'?'Administrator account created.':'Signed in successfully.'});
    } catch (error) {
      setNotice({kind:'error',text:authErrorMessage(error,'Administrator sign-in could not be completed.')});
    } finally {
      setBusy(false);
    }
  };

  if (account?.role === 'admin') {
    return <AdminPortalShell showSignOut><AdminQueue/></AdminPortalShell>;
  }

  return <AdminPortalShell>
    <div className="page-wrap form-page">
      <section className="panel license-card" style={{maxWidth:640}}>
        {checking
          ? <div className="license-status-box"><RefreshCw size={16}/><div><strong>Checking session…</strong><span>Verifying administrator access.</span></div></div>
          : <>
            <div className="license-mode-toggle" role="tablist" aria-label="Administrator account action">
              <button type="button" className={`tool-btn ${authMode==='login'?'primary':''}`} role="tab" aria-selected={authMode==='login'} onClick={()=>{setAuthMode('login');setNotice(null);}} data-testid="button-admin-login-tab">Sign in</button>
              <button type="button" className={`tool-btn ${authMode==='setup'?'primary':''}`} role="tab" aria-selected={authMode==='setup'} onClick={()=>{setAuthMode('setup');setNotice(null);}} data-testid="button-admin-setup-tab">First-time setup</button>
            </div>
            {notice && <div className={`notice ${notice.kind}`} role="status" data-testid="status-admin-auth">{notice.text}</div>}
            {authMode==='setup' && <div className="notice info">First-time setup requires the authorized administrator email and the one-time setup code configured for this installation. The code must contain at least 16 characters. Setup is disabled after the first administrator is created.</div>}
            <form onSubmit={(event)=>void submit(event)}>
              <div className="field-row"><label className="field-label" htmlFor="admin-email">ADMINISTRATOR EMAIL</label><input id="admin-email" className="field-input" type="email" value={form.email} onChange={(event)=>setForm({...form,email:event.target.value})} autoComplete="username" required data-testid="input-admin-email"/></div>
              <div className="field-row"><label className="field-label" htmlFor="admin-password">PASSWORD {authMode==='setup'?'· 12 CHARACTERS MINIMUM':''}</label><input id="admin-password" className="field-input" type="password" value={form.password} onChange={(event)=>setForm({...form,password:event.target.value})} minLength={authMode==='setup'?12:1} maxLength={256} autoComplete={authMode==='setup'?'new-password':'current-password'} required data-testid="input-admin-password"/></div>
              {authMode==='setup' && <>
                <div className="field-row"><label className="field-label" htmlFor="admin-confirm-password">CONFIRM PASSWORD</label><input id="admin-confirm-password" className="field-input" type="password" value={form.confirmPassword} onChange={(event)=>setForm({...form,confirmPassword:event.target.value})} minLength={12} maxLength={256} autoComplete="new-password" required data-testid="input-admin-confirm-password"/></div>
                <div className="field-row"><label className="field-label" htmlFor="admin-bootstrap-secret">ONE-TIME SETUP CODE <span>16 CHARACTERS MINIMUM</span></label><input id="admin-bootstrap-secret" className="field-input" type="password" value={form.bootstrapSecret} onChange={(event)=>setForm({...form,bootstrapSecret:event.target.value})} minLength={16} maxLength={512} autoComplete="off" required data-testid="input-admin-bootstrap-secret"/></div>
              </>}
              <button className="tool-btn primary" type="submit" disabled={busy||checking} data-testid="button-admin-auth-submit">{busy?'Please wait…':authMode==='setup'?'Create administrator account':'Sign in to continue'}</button>
            </form>
          </>}
      </section>
    </div>
  </AdminPortalShell>;
}

function RoutedErrorBoundary({children}:{children:React.ReactNode}) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function RouteContent() {
  const [location,setLocation] = useLocation();
  const [shopServiceOrigin,setShopServiceOrigin] = useState(isDesktop ? localStorage.getItem(API_URL_KEY) ?? '' : '');
  const [shopSessionToken,setShopSessionToken] = useState(isDesktop ? localStorage.getItem(AUTH_TOKEN_KEY) ?? '' : '');
  const shopApiReady = !isDesktop || (Boolean(shopSessionToken) && Boolean(shopServiceOrigin));
  const [state,setState] = useState<WorkspaceState>({fileName:'',fileId:null,fileBlob:null,sourceToken:null,pdf:null,page:1,pageCount:0,canvas:null,scale:1.35,crop:null,assets:[]});
  const [printSettings,setPrintSettings] = useState<PrintSettings>(() => {
    const defaults: PrintSettings = {paper:'letter',orientation:'portrait',placement:'fit',columns:'2'};
    try { return { ...defaults, ...JSON.parse(localStorage.getItem('windows-pdf-studio-print-settings') ?? '{}') }; }
    catch { return defaults; }
  });
  const [libraryFiles,setLibraryFiles] = useState<LibraryFileSummary[]>([]);
  const [libraryFolders,setLibraryFolders] = useState<Array<{id:string;name:string;createdAt:number}>>([]);
  const [printJobs,setPrintJobs] = useState<PrintJobSummary[]>([]);
  const [mergeFiles,setMergeFiles] = useState<MergePdfItem[]>([]);
  const [mergeOutputName,setMergeOutputName] = useState('merged-document.pdf');
  const [mergeBusy,setMergeBusy] = useState(false);
  const [mergeError,setMergeError] = useState<string|null>(null);
  const [mergeSuccess,setMergeSuccess] = useState<string|null>(null);
  const [mergedPdf,setMergedPdf] = useState<Blob|null>(null);
  const [mergedOutputIdentity,setMergedOutputIdentity] = useState<{fileId:string|null;sourceToken:string}|null>(null);
  const mergeParseIdsRef = useRef(new Set<string>());
  const mergeDocumentTokensRef = useRef(new Set<string>());
  const [storageUsage,setStorageUsage] = useState({usedBytes:0,quotaBytes:null as number|null});
  const [libraryLoading,setLibraryLoading] = useState(true);
  const [libraryError,setLibraryError] = useState<string|null>(null);
  const previewUrlsRef = useRef<string[]>([]);
  const libraryAssetUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    if (location === '/licenses') setLocation('/');
  },[location,setLocation]);

  useEffect(() => {
    const syncShopConnection = () => {
      setShopSessionToken(isDesktop ? localStorage.getItem(AUTH_TOKEN_KEY) ?? '' : '');
      setShopServiceOrigin(isDesktop ? localStorage.getItem(API_URL_KEY) ?? '' : '');
    };
    window.addEventListener('windows-pdf-studio-auth-change',syncShopConnection);
    window.addEventListener('windows-pdf-studio-api-url-change',syncShopConnection);
    return () => {
      window.removeEventListener('windows-pdf-studio-auth-change',syncShopConnection);
      window.removeEventListener('windows-pdf-studio-api-url-change',syncShopConnection);
    };
  },[]);

  const refreshLibrary = useCallback(async () => {
    setLibraryError(null);
    try {
      const [files,folders,jobs,usage] = await Promise.all([
        listLibraryFiles(),listLibraryFolders(),listPrintJobs(),getLibraryStorageUsage(),
      ]);
      const nextPreviewUrls:string[] = [];
      const jobSummaries:PrintJobSummary[] = jobs.map((job) => {
        const previewUrls = job.items.slice(0,4).map((item) => {
          const url = URL.createObjectURL(item.blob);
          nextPreviewUrls.push(url);
          return url;
        });
        return {
          id:job.id,title:job.title,createdAt:job.createdAt,
          paper:papers[job.paper]?.label ?? job.paper,orientation:job.orientation,
          placement:job.placement,columns:job.columns,itemCount:job.items.length,
          itemNames:job.items.map((item)=>item.name),previewUrls,status:job.status,
        };
      });
      previewUrlsRef.current.forEach((url)=>URL.revokeObjectURL(url));
      previewUrlsRef.current = nextPreviewUrls;
      setLibraryFiles(files);
      setLibraryFolders(folders);
      setPrintJobs(jobSummaries);
      setStorageUsage(usage);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : 'Local file storage could not be read.');
    } finally {
      setLibraryLoading(false);
    }
  },[]);

  useEffect(() => {
    void requestPersistentLocalStorage().then(refreshLibrary);
    return () => {
      previewUrlsRef.current.forEach((url)=>URL.revokeObjectURL(url));
      libraryAssetUrlsRef.current.forEach((url)=>URL.revokeObjectURL(url));
    };
  },[refreshLibrary]);

  useEffect(() => {
    try { localStorage.setItem('windows-pdf-studio-print-settings',JSON.stringify(printSettings)); } catch { /* print presets remain available in history */ }
  },[printSettings]);

  const onLibraryChange = useCallback(() => { void refreshLibrary(); },[refreshLibrary]);
  const onImportFiles = useCallback(async (selected:File[]) => {
    const failed:string[] = [];
    for (const file of selected) {
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf') && !file.type.startsWith('image/')) {
        failed.push(`${file.name}: unsupported file type`);
        continue;
      }
      try { await saveLibraryFile(file); }
      catch { failed.push(file.name); }
    }
    await refreshLibrary();
    if (failed.length) throw new Error(`Some files could not be imported: ${failed.slice(0,3).join(', ')}${failed.length>3?'…':''}`);
  },[refreshLibrary]);

  const onOpenLibraryFile = useCallback(async (fileId:string) => {
    const file = await getLibraryFile(fileId);
    if (!file || file.deletedAt) throw new Error('This file is no longer available in the library.');
    await updateLibraryFile(fileId,{lastOpenedAt:Date.now()});
    await refreshLibrary();
    if (file.type === 'pdf' || file.mimeType === 'application/pdf') {
      const pdf = await pdfjs.getDocument({data:await file.blob.arrayBuffer()}).promise;
      setState((current)=>({...current,fileName:file.name,fileId:file.id,fileBlob:file.blob,sourceToken:crypto.randomUUID(),pdf,page:1,pageCount:pdf.numPages,crop:null,canvas:null}));
      setLocation('/');
      return;
    }
    const src = URL.createObjectURL(file.blob);
    libraryAssetUrlsRef.current.push(src);
    setState((current)=>({...current,assets:[...current.assets,{id:crypto.randomUUID(),name:file.name,kind:'image',src,sourceFileId:file.id}]}));
    setLocation('/print');
  },[refreshLibrary,setLocation]);

  const onOpenShopRequestFile = useCallback(async (file:File) => {
    const saved = await saveLibraryFile(file,{name:file.name});
    await refreshLibrary();
    if (saved.type === 'pdf' || file.type === 'application/pdf') {
      await onOpenLibraryFile(saved.id);
      return;
    }
    const src = URL.createObjectURL(file);
    libraryAssetUrlsRef.current.push(src);
    setState((current)=>({
      ...current,
      fileName:file.name,
      fileId:saved.id,
      fileBlob:null,
      sourceToken:null,
      pdf:null,
      page:1,
      pageCount:0,
      canvas:null,
      crop:null,
      assets:[...current.assets,{id:crypto.randomUUID(),name:file.name,kind:'image',src,sourceFileId:saved.id}],
    }));
    setLocation('/print');
  },[onOpenLibraryFile,refreshLibrary,setLocation]);

  const onLoadOrganizePdf = useCallback(async (fileId:string) => {
    const file = await getLibraryFile(fileId);
    if (!file || file.deletedAt) throw new Error('This PDF is no longer available in File Manager.');
    if (file.type !== 'pdf' && file.mimeType !== 'application/pdf') throw new Error('Only PDF files can be organized.');
    return file.blob;
  },[]);

  const onLoadEditPdf = useCallback(async (fileId:string) => {
    const file = await getLibraryFile(fileId);
    if (!file || file.deletedAt) throw new Error('This PDF is no longer available in File Manager.');
    if (file.type !== 'pdf' && file.mimeType !== 'application/pdf') throw new Error('Only PDF files can be edited.');
    return file.blob;
  },[]);

  const onSaveOrganizedPdf = useCallback(async (blob:Blob,name:string) => {
    await saveOrganizedPdf(blob,name);
    await refreshLibrary();
  },[refreshLibrary]);

  const onSaveEditedPdf = useCallback(async (blob:Blob,name:string) => {
    await saveLibraryFile(blob,{name,type:'pdf'});
    await refreshLibrary();
  },[refreshLibrary]);

  const onLoadSplitPdf = useCallback(async (fileId:string) => {
    const file = await getLibraryFile(fileId);
    if (!file || file.deletedAt) throw new Error('This PDF is no longer available in File Manager.');
    if (file.type !== 'pdf' && file.mimeType !== 'application/pdf') throw new Error('Only PDF files can be split.');
    return { name:file.name, blob:file.blob };
  },[]);

  const onSaveSplitPdf = useCallback(async (blob:Blob,name:string) => {
    await saveLibraryFile(blob,{name,type:'pdf'});
    await refreshLibrary();
  },[refreshLibrary]);

  const onSaveEmailAttachment = useCallback(async (file:File) => {
    await saveLibraryFile(file,{name:file.name});
    await refreshLibrary();
  },[refreshLibrary]);

  const onDownloadLibraryFile = useCallback(async (fileId:string) => {
    const file = await getLibraryFile(fileId);
    if (!file) throw new Error('This file is no longer available in the library.');
    const url = URL.createObjectURL(file.blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = file.name; anchor.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  },[]);

  const onLoadPrintJobPreview = useCallback(async (jobId:string,itemIndex:number) => {
    const job = await getPrintJob(jobId);
    if (!job) throw new Error('This print setup is no longer available.');
    const item = job.items[itemIndex];
    if (!item) throw new Error('This preview is no longer available.');
    const sourceFile = item.sourceFileId ? await getLibraryFile(item.sourceFileId) : undefined;
    const blob = sourceFile?.blob ?? item.blob;
    const mimeType = sourceFile?.type === 'pdf'
      ? 'application/pdf'
      : sourceFile?.mimeType || item.mimeType || blob.type || 'application/octet-stream';
    return {
      name: sourceFile?.name ?? item.name,
      mimeType,
      url: URL.createObjectURL(blob),
    };
  },[]);

  const onOpenPrintJob = useCallback(async (jobId:string) => {
    const job = await getPrintJob(jobId);
    if (!job || !job.items.length) throw new Error('This print setup no longer has saved content.');
    libraryAssetUrlsRef.current.forEach((url)=>URL.revokeObjectURL(url));
    libraryAssetUrlsRef.current = job.items.map((item)=>URL.createObjectURL(item.blob));
    setState((current)=>({
      ...current,fileName:job.title,fileId:null,fileBlob:null,sourceToken:null,pdf:null,page:1,pageCount:0,canvas:null,crop:null,
      assets:job.items.map((item,index)=>({id:crypto.randomUUID(),name:item.name,kind:'image',src:libraryAssetUrlsRef.current[index],sourceFileId:item.sourceFileId,page:item.page})),
    }));
    setPrintSettings({paper:job.paper,orientation:job.orientation,placement:job.placement,columns:String(job.columns)});
    setLocation('/print');
  },[setLocation]);

  const onSavePrintJob = useCallback(async (settings:PrintSettings,assets:LocalAsset[]) => {
    const items = await Promise.all(assets.map(async (asset) => {
      if (!asset.src) throw new Error(`No preview is available for ${asset.name}.`);
      const blob = await blobFromLocalUrl(asset.src);
      const sourceFile = asset.sourceFileId ? await getLibraryFile(asset.sourceFileId) : undefined;
      const name = sourceFile
        ? asset.page ? `${sourceFile.name} · page ${asset.page}` : sourceFile.name
        : asset.name;
      return {name,mimeType:blob.type||'image/png',blob,sourceFileId:asset.sourceFileId,page:asset.page};
    }));
    await savePrintJob({
      title:items.length === 1 ? items[0].name : `Print sheet · ${items.length} items`,
      paper:settings.paper,orientation:settings.orientation,placement:settings.placement,
      columns:Math.max(1,Math.min(4,Number(settings.columns)||2)),
      itemCount:items.length,itemNames:items.map((item)=>item.name),items,
    });
    await refreshLibrary();
  },[refreshLibrary]);

  const normalizeMergedName = (name:string) => {
    const safeName = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').replace(/\.+$/,'') || 'merged-document';
    return safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
  };

  const addMergeItems = (entries:Array<{file:File;sourceToken?:string;sourceFileId?:string|null}>) => {
    const accepted = entries.filter(({file})=>file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    const rejectedCount = entries.length - accepted.length;
    setMergeError(rejectedCount ? `${rejectedCount} file${rejectedCount===1?' was':'s were'} skipped. Choose PDF files only.` : null);
    if (!accepted.length) return;
    const additions:MergePdfItem[] = accepted.map(({file,sourceToken,sourceFileId})=>({
      id:crypto.randomUUID(),file,name:file.name,size:file.size,pageCount:null,
      sourceToken:sourceToken ?? crypto.randomUUID(),sourceFileId:sourceFileId ?? null,
    }));
    additions.forEach((item)=>mergeDocumentTokensRef.current.add(item.sourceToken));
    setMergeFiles((current)=>[...current,...additions]);
    setMergedPdf(null);
    setMergedOutputIdentity(null);
    setMergeSuccess(null);
    for (const item of additions) {
      mergeParseIdsRef.current.add(item.id);
      void (async()=>{
        try {
          const loadingTask = pdfjs.getDocument({data:await item.file.arrayBuffer()});
          let pageCount: number;
          try {
            const document = await loadingTask.promise;
            pageCount = document.numPages;
          } finally {
            await loadingTask.destroy().catch(()=>{});
          }
          if (!mergeParseIdsRef.current.has(item.id)) return;
          setMergeFiles((current)=>current.map((file)=>file.id===item.id?{...file,pageCount}:file));
        } catch {
          if (!mergeParseIdsRef.current.has(item.id)) return;
          setMergeFiles((current)=>current.map((file)=>file.id===item.id?{...file,pageCount:0}:file));
          setMergeError(`${item.name} could not be read. It may be damaged or password protected.`);
        } finally {
          mergeParseIdsRef.current.delete(item.id);
        }
      })();
    }
  };
  const onAddMergeFiles = (selected:File[]) => addMergeItems(selected.map((file)=>({file})));
  const onQueueCurrentPdf = (file:File,sourceToken:string,sourceFileId:string|null) => {
    if (mergeDocumentTokensRef.current.has(sourceToken)) return;
    addMergeItems([{file,sourceToken,sourceFileId}]);
  };

  const onRemoveMergeFile = (id:string) => {
    const removed=mergeFiles.find((item)=>item.id===id);
    if(removed?.sourceToken)mergeDocumentTokensRef.current.delete(removed.sourceToken);
    mergeParseIdsRef.current.delete(id);
    setMergeFiles((current)=>current.filter((item)=>item.id!==id));
    setMergedPdf(null);
    setMergeSuccess(null);
    setMergeError(null);
  };

  const onMoveMergeFile = (id:string,direction:-1|1) => {
    setMergeFiles((current)=>{
      const from=current.findIndex((item)=>item.id===id);
      const to=from+direction;
      if(from<0||to<0||to>=current.length)return current;
      const reordered=[...current];
      [reordered[from],reordered[to]]=[reordered[to],reordered[from]];
      return reordered;
    });
    setMergedPdf(null);
    setMergeSuccess(null);
  };

  const onMergePdfs = async (requestedName = mergeOutputName): Promise<boolean> => {
    if (mergeFiles.length<2) { setMergeError('Add at least two PDFs to combine.'); return false; }
    if (mergeFiles.some((file)=>file.pageCount===null)) { setMergeError('Wait for the selected PDFs to finish loading.'); return false; }
    if (mergeFiles.some((file)=>file.pageCount===0)) { setMergeError('Remove unreadable PDFs before merging.'); return false; }
    setMergeBusy(true);
    setMergeError(null);
    setMergeSuccess(null);
    setMergedPdf(null);
    let currentFileName='';
    try {
      const { PDFDocument } = await import('pdf-lib');
      const combined = await PDFDocument.create();
      for (const item of mergeFiles) {
        currentFileName=item.name;
        const source = await PDFDocument.load(await item.file.arrayBuffer());
        const copiedPages = await combined.copyPages(source,source.getPageIndices());
        copiedPages.forEach((page)=>combined.addPage(page));
      }
      const bytes=await combined.save();
      const pdfBuffer=new ArrayBuffer(bytes.byteLength);
      new Uint8Array(pdfBuffer).set(bytes);
      const blob=new Blob([pdfBuffer],{type:'application/pdf'});
      const name=normalizeMergedName(requestedName);
      setMergedPdf(blob);
      setMergeOutputName(name);
      const mergedDocument=await pdfjs.getDocument({data:await blob.arrayBuffer()}).promise;
      const sourceToken=crypto.randomUUID();
      setMergedOutputIdentity({fileId:null,sourceToken});
      setState((current)=>({
        ...current,
        fileName:name,
        fileId:null,
        fileBlob:blob,
        sourceToken,
        pdf:mergedDocument,
        page:1,
        pageCount:mergedDocument.numPages,
        crop:null,
        canvas:null,
      }));
      try {
        const savedFile=await saveLibraryFile(blob,{name,type:'pdf'});
        await refreshLibrary();
        setMergedOutputIdentity({fileId:savedFile.id,sourceToken});
        setState((current)=>current.sourceToken===sourceToken?{...current,fileId:savedFile.id}:current);
        const totalPages=mergeFiles.reduce((total,file)=>total+(file.pageCount??0),0);
        setMergeSuccess(`${name} was merged and saved to File Manager (${totalPages} pages).`);
        return true;
      } catch {
        setMergeError('The PDF was merged, but could not be saved to File Manager. Check device storage and try again.');
        return true;
      }
    } catch {
      setMergeError(currentFileName
        ? `Could not merge ${currentFileName}. It may be encrypted, damaged, or unsupported.`
        : 'The selected PDFs could not be merged.');
      return false;
    } finally {
      setMergeBusy(false);
    }
  };

  const onDownloadMergedPdf = () => {
    if (!mergedPdf) return;
    const url=URL.createObjectURL(mergedPdf);
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download=normalizeMergedName(mergeOutputName);
    anchor.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  const onClearMergeFiles = () => {
    mergeParseIdsRef.current.clear();
    mergeDocumentTokensRef.current.clear();
    setMergeFiles([]);
    setMergeOutputName('merged-document.pdf');
    setMergedPdf(null);
    setMergeError(null);
    setMergeSuccess(null);
  };

  const libraryProps = {
    files:libraryFiles,folders:libraryFolders,printJobs,
    storageUsed:storageUsage.usedBytes,storageQuota:storageUsage.quotaBytes,
    isLoading:libraryLoading,error:libraryError,
    onTabChange:(tab:LibraryTab)=>setLocation(tab==='files'?'/library':'/print-history'),
    onImport:onImportFiles,
    onOpenFile:onOpenLibraryFile,
    onDownloadFile:onDownloadLibraryFile,
    onRenameFile:async(fileId:string,name:string)=>{await updateLibraryFile(fileId,{name:name.trim()});await refreshLibrary();},
    onToggleFavorite:async(fileId:string)=>{const file=libraryFiles.find((item)=>item.id===fileId);if(file)await updateLibraryFile(fileId,{favorite:!file.favorite});await refreshLibrary();},
    onMoveFile:async(fileId:string,folderId:string|null)=>{await updateLibraryFile(fileId,{folderId});await refreshLibrary();},
    onTrashFile:async(fileId:string)=>{await updateLibraryFile(fileId,{deletedAt:Date.now()});await refreshLibrary();},
    onRestoreFile:async(fileId:string)=>{await updateLibraryFile(fileId,{deletedAt:null});await refreshLibrary();},
    onDeleteFile:async(fileId:string)=>{await permanentlyDeleteLibraryFile(fileId);await refreshLibrary();},
    onCreateFolder:async(name:string)=>{await createLibraryFolder(name);await refreshLibrary();},
    onRenameFolder:async(folderId:string,name:string)=>{await renameLibraryFolder(folderId,name);await refreshLibrary();},
    onDeleteFolder:async(folderId:string)=>{await deleteLibraryFolder(folderId);await refreshLibrary();},
    onOpenPrintJob,
    onLoadPrintJobPreview,
    onDeletePrintJob:async(jobId:string)=>{await deletePrintJob(jobId);await refreshLibrary();},
  };

  const mergePageProps = {
    files:mergeFiles.map(({id,name,size,pageCount})=>({id,name,size,pageCount})),
    outputName:mergeOutputName,busy:mergeBusy,error:mergeError,success:mergeSuccess,mergedReady:!!mergedPdf,
    onAddFiles:onAddMergeFiles,
    onRemoveFile:onRemoveMergeFile,
    onMoveFile:onMoveMergeFile,
    onClear:onClearMergeFiles,
    onOutputNameChange:(name:string)=>{setMergeOutputName(name);setMergedPdf(null);setMergeSuccess(null);},
    onMerge:()=>onMergePdfs(),
    onDownload:onDownloadMergedPdf,
  };

  const isViewingMergedOutput = mergedOutputIdentity !== null && (
    state.sourceToken === mergedOutputIdentity.sourceToken ||
    (mergedOutputIdentity.fileId !== null && state.fileId === mergedOutputIdentity.fileId)
  );

  return <RoutedErrorBoundary><Switch>
    <Route path="/"><AppShell active="documents"><Workspace
      state={state}
      setState={setState}
      onLibraryChange={onLibraryChange}
      mergeCount={mergeFiles.length}
      mergeReady={mergeFiles.length > 1 && mergeFiles.every((file)=>file.pageCount !== null && file.pageCount !== 0)}
      mergeBusy={mergeBusy}
      mergeError={mergeError}
      mergeSuccess={mergeSuccess}
      mergeOutputName={mergeOutputName}
      mergeItems={mergeFiles.map(({id,name,size,pageCount})=>({id,name,size,pageCount}))}
      organizePdfs={libraryFiles.filter((file)=>!file.deletedAt&&(file.type==='pdf'||file.mimeType==='application/pdf'))}
      onLoadOrganizePdf={onLoadOrganizePdf}
      onSaveOrganizedPdf={onSaveOrganizedPdf}
      viewerPdfs={isViewingMergedOutput?[]:mergeFiles.map(({id,file,name,pageCount,sourceToken,sourceFileId})=>({id,blob:file,name,pageCount,sourceToken,fileId:sourceFileId}))}
      onQueueCurrentPdf={onQueueCurrentPdf}
      onAddMergeFiles={onAddMergeFiles}
      onRemoveMergeFile={onRemoveMergeFile}
      onMergeOutputNameChange={(name)=>{setMergeOutputName(name);setMergedPdf(null);setMergeSuccess(null);setMergeError(null);}}
      onMerge={onMergePdfs}
    /></AppShell></Route>
    <Route path="/merge"><AppShell active="merge"><MergePage {...mergePageProps}/></AppShell></Route>
    <Route path="/split"><AppShell active="split"><SplitPage libraryPdfs={libraryFiles.filter((file)=>!file.deletedAt&&(file.type==='pdf'||file.mimeType==='application/pdf'))} onLoadLibraryPdf={onLoadSplitPdf} onSaveOutput={onSaveSplitPdf}/></AppShell></Route>
    <Route path="/edit"><AppShell active="edit"><PdfEditPage libraryPdfs={libraryFiles.filter((file)=>!file.deletedAt&&(file.type==='pdf'||file.mimeType==='application/pdf'))} onLoadLibraryPdf={onLoadEditPdf} onSaveOutput={onSaveEditedPdf}/></AppShell></Route>
    <Route path="/organize"><AppShell active="organize"><OrganizePage libraryPdfs={libraryFiles.filter((file)=>!file.deletedAt&&(file.type==='pdf'||file.mimeType==='application/pdf'))} onLoadLibraryPdf={onLoadOrganizePdf} onSave={onSaveOrganizedPdf}/></AppShell></Route>
    <Route path="/print"><AppShell active="print"><PrintPage state={state} setState={setState} settings={printSettings} setSettings={setPrintSettings} onLibraryChange={onLibraryChange} onSavePrintJob={onSavePrintJob}/></AppShell></Route>
    <Route path="/library"><AppShell active="library"><LibraryPage {...libraryProps} tab="files"/></AppShell></Route>
    <Route path="/print-history"><AppShell active="history"><LibraryPage {...libraryProps} tab="print-history"/></AppShell></Route>
    <Route path="/inbox"><AppShell active="inbox"><EmailInboxPage onOpenSettings={()=>setLocation('/settings')} onSaveAttachment={onSaveEmailAttachment}/></AppShell></Route>
    <Route path="/settings"><AppShell active="settings"><SettingsPage apiReady={shopApiReady} onOpenInbox={()=>setLocation('/inbox')}/></AppShell></Route>
    <Route path="/email-settings"><AppShell active="settings"><SettingsPage apiReady={shopApiReady} onOpenInbox={()=>setLocation('/inbox')}/></AppShell></Route>
    <Route path="/dashboard"><AppShell active="dashboard"><ShopDashboardPage apiReady={shopApiReady}/></AppShell></Route>
    <Route path="/shop"><AppShell active="qrUploads"><ShopOwnerPage apiReady={shopApiReady} publicOrigin={`${(isDesktop ? shopServiceOrigin : window.location.origin).replace(/\/+$/,'')}${basePath}`} onOpenFile={onOpenShopRequestFile}/></AppShell></Route>
    <Route path="/send/:shopCode">{(params) => <CustomerUploadPage shopCode={params.shopCode}/>}</Route>
    <Route path="/track/:trackingCode">{(params) => <RequestTrackingPage trackingCode={params.trackingCode}/>}</Route>
    <Route path="/admin"><AdminPage/></Route>
    <Route component={NotFound}/>
  </Switch></RoutedErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      {isDesktop
        ? <WouterRouter base={basePath} hook={useHashLocation}><ShopAccessGate><RouteContent/></ShopAccessGate></WouterRouter>
        : <WouterRouter base={basePath}><ShopAccessGate><RouteContent/></ShopAccessGate></WouterRouter>}
      <Toaster/>
    </TooltipProvider>
  </QueryClientProvider>;
}

export default App;
