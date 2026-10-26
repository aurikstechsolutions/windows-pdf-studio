export type LibraryTab = 'files' | 'print-history';

export interface LibraryFileSummary {
  id: string;
  name: string;
  type: 'pdf' | 'image' | 'export';
  mimeType: string;
  size: number;
  createdAt: number;
  lastOpenedAt: number | null;
  favorite: boolean;
  folderId: string | null;
  deletedAt: number | null;
}

export interface LibraryFolderSummary {
  id: string;
  name: string;
  createdAt: number;
}

export interface PrintJobSummary {
  id: string;
  title: string;
  createdAt: number;
  paper: string;
  orientation: 'portrait' | 'landscape';
  placement: 'fit' | 'fill';
  columns: number;
  itemCount: number;
  itemNames: string[];
  previewUrls: string[];
  status: 'sent-to-print-dialog';
}

export interface PrintJobPreview {
  name: string;
  mimeType: string;
  url: string;
}

export interface LibraryPageProps {
  tab: LibraryTab;
  files: LibraryFileSummary[];
  folders: LibraryFolderSummary[];
  printJobs: PrintJobSummary[];
  storageUsed: number;
  storageQuota: number | null;
  isLoading: boolean;
  error: string | null;
  onTabChange: (tab: LibraryTab) => void;
  onImport: (files: File[]) => Promise<void>;
  onOpenFile: (fileId: string) => Promise<void>;
  onDownloadFile: (fileId: string) => Promise<void>;
  onRenameFile: (fileId: string, name: string) => Promise<void>;
  onToggleFavorite: (fileId: string) => Promise<void>;
  onMoveFile: (fileId: string, folderId: string | null) => Promise<void>;
  onTrashFile: (fileId: string) => Promise<void>;
  onRestoreFile: (fileId: string) => Promise<void>;
  onDeleteFile: (fileId: string) => Promise<void>;
  onCreateFolder: (name: string) => Promise<void>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onOpenPrintJob: (jobId: string) => Promise<void>;
  onLoadPrintJobPreview: (jobId: string, itemIndex: number) => Promise<PrintJobPreview>;
  onDeletePrintJob: (jobId: string) => Promise<void>;
}
