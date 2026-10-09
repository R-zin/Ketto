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
  if (!response.ok) throw new Error(result.error || "Request failed");
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
