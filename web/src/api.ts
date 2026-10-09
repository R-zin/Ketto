export let access = sessionStorage.getItem("kettoo.session") || "";
export function setAccess(value: string) {
  access = value;
  if (value) sessionStorage.setItem("kettoo.session", value);
  else sessionStorage.removeItem("kettoo.session");
}
export async function api(
  path: string,
  body?: unknown,
  method?: string,
): Promise<any> {
  const response = await fetch("/api" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      ...(access ? { Authorization: "Bearer " + access } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error || "Request failed"), {
      status: response.status,
    });
  return result;
}
export function upload(
  cid: string,
  file: Blob,
  name: string,
  progress: (n: number) => void,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    activeUploads.add(x);
    x.onloadend = () => activeUploads.delete(x);
    x.onabort = () =>
      reject(
        new Error("Upload paused for live communication; queued for retry"),
      );
    x.open("POST", "/api/conversations/" + cid + "/files");
    x.setRequestHeader("Authorization", "Bearer " + access);
    x.upload.onprogress = (e) => {
      if (e.lengthComputable) progress(Math.round((100 * e.loaded) / e.total));
    };
    x.onerror = () => reject(new Error("Upload interrupted"));
    x.onload = () => {
      const b = JSON.parse(x.responseText);
      x.status < 300 ? resolve(b) : reject(new Error(b.error));
    };
    const form = new FormData();
    form.append("file", file, name);
    x.send(form);
  });
}
const activeUploads = new Set<XMLHttpRequest>();
export function pauseUploads() {
  for (const upload of activeUploads) upload.abort();
}
export async function fileUrl(id: string) {
  const r = await fetch("/api/files/" + id, {
    headers: { Authorization: "Bearer " + access },
  });
  if (!r.ok) throw new Error("Attachment unavailable");
  return URL.createObjectURL(await r.blob());
}
export type Pending = {
  id: string;
  owner: string;
  cid: string;
  text?: string;
  createdAt: number;
  kind: string;
  blob?: Blob;
  name?: string;
  attachmentId?: string;
};
const database = new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open("kettoo-outbox", 1);
  r.onupgradeneeded = () =>
    r.result.createObjectStore("messages", { keyPath: "id" });
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
async function transact<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("messages", mode);
    const r = fn(tx.objectStore("messages"));
    tx.oncomplete = () => resolve(r.result);
    tx.onerror = () => reject(tx.error);
  });
}
export const outbox = {
  put: (p: Pending) => transact("readwrite", (s) => s.put(p)),
  remove: (id: string) => transact("readwrite", (s) => s.delete(id)),
  all: () => transact<Pending[]>("readonly", (s) => s.getAll()),
};

export type Operation = {
  id: string;
  owner: string;
  path: string;
  body: any;
  state: "pending" | "rejected";
  queuedAt?: number;
  error?: string;
  photo?: Blob;
  photoName?: string;
  attachmentPath?: string;
};
const operationsDb = new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open("kettoo-operations", 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore("pending", { keyPath: "id" });
    r.result.createObjectStore("cache");
  };
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
async function operationStore<T>(
  name: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await operationsDb;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode),
      r = fn(tx.objectStore(name));
    tx.oncomplete = () => resolve(r.result);
    tx.onerror = () => reject(tx.error);
  });
}
export const operationQueue = {
  put: (o: Operation) =>
    operationStore("pending", "readwrite", (s) => s.put(o)),
  remove: (id: string) =>
    operationStore("pending", "readwrite", (s) => s.delete(id)),
  all: async () =>
    (
      await operationStore<Operation[]>("pending", "readonly", (s) =>
        s.getAll(),
      )
    ).sort(
      (a, b) =>
        (a.queuedAt || a.body.createdAt || a.body.reportedAt || 0) -
        (b.queuedAt || b.body.createdAt || b.body.reportedAt || 0),
    ),
};
export const operationCache = {
  keys: () =>
    operationStore<IDBValidKey[]>("cache", "readonly", (s) => s.getAllKeys()),
  put: (key: string, value: any) =>
    operationStore("cache", "readwrite", (s) => s.put(value, key)),
  get: <T = any>(key: string) =>
    operationStore<T>("cache", "readonly", (s) => s.get(key)),
  remove: (key: string) =>
    operationStore("cache", "readwrite", (s) => s.delete(key)),
};
export async function phaseFile(id: string): Promise<Blob> {
  const r = await fetch("/api/phase2/files/" + id, {
    headers: { Authorization: "Bearer " + access },
  });
  if (!r.ok) throw new Error("Image unavailable");
  return r.blob();
}
export async function phaseUpload(path: string, file: Blob, name: string) {
  return new Promise<any>((resolve, reject) => {
    const x = new XMLHttpRequest();
    activeUploads.add(x);
    x.onloadend = () => activeUploads.delete(x);
    x.onabort = () =>
      reject(
        new Error("Upload paused for live communication; queued for retry"),
      );
    x.onerror = () => reject(new Error("Upload interrupted"));
    x.open("POST", "/api/phase2/" + path + "/files");
    x.setRequestHeader("Authorization", "Bearer " + access);
    x.onload = () => {
      const b = JSON.parse(x.responseText);
      x.status < 300
        ? resolve(b)
        : reject(
            Object.assign(new Error(b.error || "Upload failed"), {
              status: x.status,
            }),
          );
    };
    const form = new FormData();
    form.append("file", file, name);
    x.send(form);
  });
}
