import type {
  LibraryFileSummary,
  LibraryFolderSummary,
  PrintJobSummary,
} from './library-types';

const DATABASE_NAME = 'windows-pdf-studio-library';
const DATABASE_VERSION = 1;
const FILES = 'files';
const FOLDERS = 'folders';
const PRINT_JOBS = 'printJobs';

export interface StoredLibraryFile extends LibraryFileSummary {
  blob: Blob;
}

export interface StoredPrintJob extends Omit<PrintJobSummary, 'previewUrls'> {
  items: Array<{ name: string; mimeType: string; blob: Blob; sourceFileId?: string; page?: number }>;
}

export interface StorageUsage {
  usedBytes: number;
  quotaBytes: number | null;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Local file storage is not available in this environment.'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FOLDERS)) db.createObjectStore(FOLDERS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PRINT_JOBS)) db.createObjectStore(PRINT_JOBS, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local file storage.'));
    request.onblocked = () => reject(new Error('Close other Windows PDF Studio windows to update local storage.'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('A local storage operation failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('A local storage transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('A local storage transaction was cancelled.'));
  });
}

function summarizeFile(record: StoredLibraryFile): LibraryFileSummary {
  const { blob: _blob, ...summary } = record;
  return summary;
}

function inferFileType(name: string, mimeType: string): LibraryFileSummary['type'] {
  if (mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return 'pdf';
  if (mimeType.startsWith('image/')) return 'image';
  return 'export';
}

export async function saveLibraryFile(
  file: File | Blob,
  options: { name?: string; type?: LibraryFileSummary['type']; id?: string } = {},
): Promise<LibraryFileSummary> {
  const name = options.name ?? (file instanceof File ? file.name : 'Untitled export');
  const mimeType = file.type || 'application/octet-stream';
  const record: StoredLibraryFile = {
    id: options.id ?? crypto.randomUUID(),
    name,
    type: options.type ?? inferFileType(name, mimeType),
    mimeType,
    size: file.size,
    createdAt: Date.now(),
    lastOpenedAt: null,
    favorite: false,
    folderId: null,
    deletedAt: null,
    blob: file.slice(0, file.size, mimeType),
  };
  const db = await openDatabase();
  const transaction = db.transaction(FILES, 'readwrite');
  const done = transactionComplete(transaction);
  await requestResult(transaction.objectStore(FILES).put(record));
  await done;
  return summarizeFile(record);
}

export async function saveOrganizedPdf(blob: Blob, name: string): Promise<LibraryFileSummary> {
  if (blob.type !== 'application/pdf') {
    throw new Error('The organized document is not a valid PDF export.');
  }
  return saveLibraryFile(blob, { name, type: 'pdf' });
}

export async function getLibraryFile(id: string): Promise<StoredLibraryFile | undefined> {
  const db = await openDatabase();
  const transaction = db.transaction(FILES, 'readonly');
  const done = transactionComplete(transaction);
  const record = await requestResult(transaction.objectStore(FILES).get(id)) as StoredLibraryFile | undefined;
  await done;
  return record;
}

export async function listLibraryFiles(): Promise<LibraryFileSummary[]> {
  const db = await openDatabase();
  const transaction = db.transaction(FILES, 'readonly');
  const done = transactionComplete(transaction);
  const records = await requestResult(transaction.objectStore(FILES).getAll()) as StoredLibraryFile[];
  await done;
  return records.map(summarizeFile).sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateLibraryFile(
  id: string,
  changes: Partial<Pick<LibraryFileSummary, 'name' | 'favorite' | 'folderId' | 'deletedAt' | 'lastOpenedAt'>>,
): Promise<void> {
  const db = await openDatabase();
  const renaming = typeof changes.name === 'string';
  const transaction = db.transaction(renaming ? [FILES, PRINT_JOBS] : FILES, 'readwrite');
  const done = transactionComplete(transaction);
  const store = transaction.objectStore(FILES);
  const record = await requestResult(store.get(id)) as StoredLibraryFile | undefined;
  if (!record) {
    await done;
    throw new Error('This file is no longer in the local library.');
  }
  const nextRecord = { ...record, ...changes };
  const fileWrite = requestResult(store.put(nextRecord));

  if (renaming && changes.name !== record.name) {
    const printStore = transaction.objectStore(PRINT_JOBS);
    const jobs = await requestResult(printStore.getAll()) as StoredPrintJob[];
    const updatedJobs = jobs.flatMap((job) => {
      let changed = false;
      const renameLinkedLabel = (label: string) => {
        if (label === record.name) {
          changed = true;
          return changes.name!;
        }
        if (label === `Print · ${record.name}`) {
          changed = true;
          return `Print · ${changes.name}`;
        }
        const pagePrefix = `${record.name} · page `;
        if (label.startsWith(pagePrefix)) {
          changed = true;
          return `${changes.name}${label.slice(record.name.length)}`;
        }
        const olderPagePrefix = `${record.name} · `;
        const olderPageNumber = label.startsWith(olderPagePrefix) ? label.slice(olderPagePrefix.length) : '';
        if (/^\d+$/.test(olderPageNumber)) {
          changed = true;
          return `${changes.name} · page ${olderPageNumber}`;
        }
        return label;
      };
      const items = job.items.map((item) => {
        if (item.sourceFileId === id) {
          changed = true;
          return { ...item, name: renameLinkedLabel(item.name) };
        }
        // Older history entries did not store a source ID; match exact names and PDF page labels.
        const olderPagePrefix = `${record.name} · `;
        const olderPageNumber = item.name.startsWith(olderPagePrefix) ? item.name.slice(olderPagePrefix.length) : '';
        const matchesLegacyName = item.name === record.name || item.name.startsWith(`${record.name} · page `) || /^\d+$/.test(olderPageNumber);
        if (!item.sourceFileId && matchesLegacyName) {
          changed = true;
          return { ...item, name: renameLinkedLabel(item.name) };
        }
        return item;
      });
      const title = renameLinkedLabel(job.title);
      if (!changed) return [];
      return [{ ...job, title, items, itemNames: items.map((item) => item.name) }];
    });
    await Promise.all([fileWrite, ...updatedJobs.map((job) => requestResult(printStore.put(job)))]);
  } else {
    await fileWrite;
  }
  await done;
}

export async function permanentlyDeleteLibraryFile(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(FILES, 'readwrite');
  const done = transactionComplete(transaction);
  await requestResult(transaction.objectStore(FILES).delete(id));
  await done;
}

export async function listLibraryFolders(): Promise<LibraryFolderSummary[]> {
  const db = await openDatabase();
  const transaction = db.transaction(FOLDERS, 'readonly');
  const done = transactionComplete(transaction);
  const folders = await requestResult(transaction.objectStore(FOLDERS).getAll()) as LibraryFolderSummary[];
  await done;
  return folders.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createLibraryFolder(name: string): Promise<LibraryFolderSummary> {
  const normalized = name.trim();
  if (!normalized || normalized.length > 48) throw new Error('Folder names must be between 1 and 48 characters.');
  const folder = { id: crypto.randomUUID(), name: normalized, createdAt: Date.now() };
  const db = await openDatabase();
  const transaction = db.transaction(FOLDERS, 'readwrite');
  const done = transactionComplete(transaction);
  await requestResult(transaction.objectStore(FOLDERS).add(folder));
  await done;
  return folder;
}

export async function renameLibraryFolder(id: string, name: string): Promise<void> {
  const normalized = name.trim();
  if (!normalized || normalized.length > 48) throw new Error('Folder names must be between 1 and 48 characters.');
  const db = await openDatabase();
  const transaction = db.transaction(FOLDERS, 'readwrite');
  const done = transactionComplete(transaction);
  const store = transaction.objectStore(FOLDERS);
  const folder = await requestResult(store.get(id)) as LibraryFolderSummary | undefined;
  if (!folder) {
    await done;
    throw new Error('This folder no longer exists.');
  }
  await requestResult(store.put({ ...folder, name: normalized }));
  await done;
}

export async function deleteLibraryFolder(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([FOLDERS, FILES], 'readwrite');
  const done = transactionComplete(transaction);
  const filesStore = transaction.objectStore(FILES);
  const files = await requestResult(filesStore.getAll()) as StoredLibraryFile[];
  await Promise.all(files.filter((file) => file.folderId === id).map((file) =>
    requestResult(filesStore.put({ ...file, folderId: null })),
  ));
  await requestResult(transaction.objectStore(FOLDERS).delete(id));
  await done;
}

export async function listPrintJobs(): Promise<StoredPrintJob[]> {
  const db = await openDatabase();
  const transaction = db.transaction(PRINT_JOBS, 'readonly');
  const done = transactionComplete(transaction);
  const records = await requestResult(transaction.objectStore(PRINT_JOBS).getAll()) as StoredPrintJob[];
  await done;
  return records.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getPrintJob(id: string): Promise<StoredPrintJob | undefined> {
  const db = await openDatabase();
  const transaction = db.transaction(PRINT_JOBS, 'readonly');
  const done = transactionComplete(transaction);
  const record = await requestResult(transaction.objectStore(PRINT_JOBS).get(id)) as StoredPrintJob | undefined;
  await done;
  return record;
}

export async function savePrintJob(
  job: Omit<StoredPrintJob, 'id' | 'createdAt' | 'status'> & { createdAt?: number },
): Promise<StoredPrintJob> {
  const record: StoredPrintJob = {
    ...job,
    id: crypto.randomUUID(),
    createdAt: job.createdAt ?? Date.now(),
    status: 'sent-to-print-dialog',
  };
  const db = await openDatabase();
  const transaction = db.transaction(PRINT_JOBS, 'readwrite');
  const done = transactionComplete(transaction);
  await requestResult(transaction.objectStore(PRINT_JOBS).add(record));
  await done;
  return record;
}

export async function deletePrintJob(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(PRINT_JOBS, 'readwrite');
  const done = transactionComplete(transaction);
  await requestResult(transaction.objectStore(PRINT_JOBS).delete(id));
  await done;
}

export async function getLibraryStorageUsage(): Promise<StorageUsage> {
  const [files, jobs] = await Promise.all([listLibraryFiles(), listPrintJobs()]);
  const fileBytes = files.reduce((total, file) => total + file.size, 0);
  const jobBytes = jobs.reduce((total, job) => total + job.items.reduce((sum, item) => sum + item.blob.size, 0), 0);
  let quotaBytes: number | null = null;
  try {
    quotaBytes = (await navigator.storage?.estimate())?.quota ?? null;
  } catch {
    quotaBytes = null;
  }
  return { usedBytes: fileBytes + jobBytes, quotaBytes };
}

export async function requestPersistentLocalStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // IndexedDB remains available even when the browser declines persistent-storage status.
  }
}

export async function blobFromLocalUrl(src: string): Promise<Blob> {
  if (!src.startsWith('blob:') && !src.startsWith('data:')) {
    throw new Error('Only local document previews can be saved to print history.');
  }
  const response = await fetch(src);
  if (!response.ok) throw new Error('A print preview could not be saved locally.');
  return response.blob();
}
