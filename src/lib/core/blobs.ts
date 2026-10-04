/**
 * Binary file storage (the PDFs and markdown files in the library) in
 * IndexedDB: identical in the Tauri webview and in a plain browser, handles
 * large binaries, and needs no filesystem permission. Metadata about each file
 * lives in the library record; this module only keeps the bytes.
 */
const DB_NAME = "fieldnotes-files";
const STORE = "blobs";

interface StoredBlob {
  id: string;
  mime: string;
  data: ArrayBuffer;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This environment has no local file storage (IndexedDB is unavailable)."));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open local file storage."));
  });
  // A failed open must not be cached forever.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = work(tx.objectStore(STORE));
    let result: T;
    req.onsuccess = () => {
      result = req.result;
    };
    // Resolve on commit, not on request success, so a put is durable when we return.
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error("Local file storage failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Local file storage was aborted (disk full?)."));
  });
}

export async function putBlob(id: string, data: Blob | ArrayBuffer, mime?: string): Promise<void> {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  const record: StoredBlob = { id, mime: mime ?? (data instanceof Blob ? data.type : "") ?? "", data: buffer };
  await run("readwrite", (store) => store.put(record));
}

export async function getBlob(id: string): Promise<{ data: ArrayBuffer; mime: string } | null> {
  const record = await run<StoredBlob | undefined>("readonly", (store) => store.get(id));
  return record ? { data: record.data, mime: record.mime } : null;
}

export async function deleteBlob(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id));
}

export async function listBlobIds(): Promise<string[]> {
  return (await run<IDBValidKey[]>("readonly", (store) => store.getAllKeys())).map(String);
}
