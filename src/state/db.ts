// This device's keys and what it remembers, in IndexedDB. The identity's private key is a non-extractable CryptoKey (the
// browser keeps it; no script can read it out, and it never leaves this device). Everything else (your paired PCs, what
// came and went, the app's settings) is sealed with AES-256-GCM under a vault key that is itself a non-extractable
// CryptoKey, or, with Face ID on, one only a Face ID unlock can give back (see lock.ts).

const NAME = 'arnav-island';
const STORE = 'kv';
let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); opening = null; }; resolve(d); };
    r.onerror = () => { opening = null; reject(r.error); };
    r.onblocked = () => { opening = null; reject(new Error('blocked')); };
  });
  return opening;
}
function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const tx = d.transaction(STORE, mode); const req = f(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }));
}
export const idb = {
  get: <T>(key: string) => run<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>).catch(() => undefined),
  set: (key: string, value: unknown) => run('readwrite', (s) => s.put(value, key)).then(() => true).catch(() => false),
  del: (key: string) => run('readwrite', (s) => s.delete(key)).then(() => true).catch(() => false),
  /** Everything, gone (Devices › Erase this device). */
  wipe: async () => { try { (await db()).close(); } catch { /* not open */ } opening = null; await new Promise<void>((r) => { const q = indexedDB.deleteDatabase(NAME); q.onsuccess = q.onerror = q.onblocked = () => r(); }); },
};

// ---- the vault ----
let vault: CryptoKey | null = null;
export const vaultKey = {
  get: () => vault,
  set: (k: CryptoKey | null) => { vault = k; },
};
/** The vault key this device keeps unlocked (no Face ID lock): made once, non-extractable. */
export async function openVault(): Promise<CryptoKey> {
  const saved = await idb.get<CryptoKey>('vault');
  if (saved) { vault = saved; return saved; }
  const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await idb.set('vault', k); vault = k; return k;
}
interface Sealed { iv: Uint8Array; data: ArrayBuffer }
export async function sealTo(key: string, value: unknown, k: CryptoKey | null = vault): Promise<boolean> {
  if (!k) return false;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(key) }, k, new TextEncoder().encode(JSON.stringify(value)));
  return idb.set('s:' + key, { iv, data } satisfies Sealed);
}
export async function openFrom<T>(key: string, k: CryptoKey | null = vault): Promise<T | undefined> {
  if (!k) return undefined;
  const s = await idb.get<Sealed>('s:' + key); if (!s) return undefined;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: s.iv as BufferSource, additionalData: new TextEncoder().encode(key) }, k, s.data);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch { return undefined; }
}
/** The sealed keys (for sealing everything again under a new vault key). */
export const SEALED = ['peers', 'moments', 'prefs', 'lyricsSeen'];
