// Thin raw-IndexedDB adapter — no `idb` dependency. The used surface is five
// operations behind one promisify helper; the whole thing sits behind
// isIndexedDbAvailable() with the flusher (outbox.ts) treating "unavailable"
// as "nothing to flush" rather than throwing. Pulling in a dependency for
// this little code, in the client bundle of the queue's hottest page,
// doesn't clear the bar apps/console's other lib/*-store.ts files hold
// their own dependencies to (see lib/email.ts).
import type { OutboxAction } from "./outbox-types";

const DB_NAME = "pulse-console-outbox";
const DB_VERSION = 1;
const STORE_ACTIONS = "actions";
const STORE_META = "meta";

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ACTIONS)) {
        const store = db.createObjectStore(STORE_ACTIONS, { keyPath: "id" });
        store.createIndex("by_seq", "seq");
        store.createIndex("by_attribute", "venueAttributeId");
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

// Issues the next seq and writes the action in the SAME readwrite
// transaction, so two rapid taps can't race and land on the same seq.
export async function enqueueAction(action: Omit<OutboxAction, "seq">): Promise<OutboxAction> {
  const db = await openDb();
  const tx = db.transaction([STORE_ACTIONS, STORE_META], "readwrite");
  const metaStore = tx.objectStore(STORE_META);
  const actionsStore = tx.objectStore(STORE_ACTIONS);

  const seq = await new Promise<number>((resolve, reject) => {
    const getReq = metaStore.get("seq");
    getReq.onsuccess = () => {
      const current = (getReq.result as { key: string; value: number } | undefined)?.value ?? 0;
      const next = current + 1;
      metaStore.put({ key: "seq", value: next });
      resolve(next);
    };
    getReq.onerror = () => reject(getReq.error);
  });

  const full: OutboxAction = { ...action, seq };
  actionsStore.put(full);
  await txDone(tx);
  return full;
}

export async function getAllActions(): Promise<OutboxAction[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_ACTIONS, "readonly");
  const result = await promisify(tx.objectStore(STORE_ACTIONS).getAll());
  return result as OutboxAction[];
}

export async function getAction(id: string): Promise<OutboxAction | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE_ACTIONS, "readonly");
  const result = await promisify(tx.objectStore(STORE_ACTIONS).get(id));
  return result as OutboxAction | undefined;
}

export async function deleteActions(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(STORE_ACTIONS, "readwrite");
  const store = tx.objectStore(STORE_ACTIONS);
  for (const id of ids) store.delete(id);
  await txDone(tx);
}

export async function countActions(): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(STORE_ACTIONS, "readonly");
  const result = await promisify(tx.objectStore(STORE_ACTIONS).count());
  return result;
}
