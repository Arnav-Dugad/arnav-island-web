// Face ID (or Touch ID, or the device passcode) for the app, through a passkey on this device (WebAuthn, platform
// authenticator, user verification required). Where the passkey can give a secret (the PRF extension, iOS 18 and later),
// the vault key that seals your paired PCs is kept encrypted under it, so without Face ID they can't be read at all; where
// it can't, the lock asks for Face ID before the app shows anything.
import { idb, openFrom, sealTo, SEALED, vaultKey } from './db';

export interface LockConfig { on: boolean; credential: Uint8Array; salt: Uint8Array; prf: boolean; sealed?: { iv: Uint8Array; data: ArrayBuffer } }

export const lockConfig = () => idb.get<LockConfig>('lock');
export const lockAvailable = async (): Promise<boolean> => {
  try { return !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
};

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
const b = (u: Uint8Array) => u as BufferSource;

async function wrapping(secret: ArrayBuffer): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('arnav-island-web-lock-v1'), info: new TextEncoder().encode('vault') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/** Asks for Face ID with this passkey; its PRF secret when it gives one, else an empty buffer; null when refused. */
async function assert(c: LockConfig): Promise<ArrayBuffer | null> {
  try {
    const cred = (await navigator.credentials.get({ publicKey: {
      challenge: b(crypto.getRandomValues(new Uint8Array(32))), allowCredentials: [{ type: 'public-key', id: b(c.credential), transports: ['internal'] }],
      userVerification: 'required', timeout: 60_000, extensions: c.prf ? ({ prf: { eval: { first: b(c.salt) } } } as AuthenticationExtensionsClientInputs) : undefined,
    } })) as PublicKeyCredential | null;
    if (!cred) return null;
    const r = cred.getClientExtensionResults() as PrfResults;
    return r.prf?.results?.first ?? new ArrayBuffer(0);
  } catch { return null; }
}

/** Seals everything again under [next] (the vault key changes when the lock goes on or off). */
async function reseal(next: CryptoKey): Promise<void> {
  const current = vaultKey.get();
  for (const key of SEALED) { const v = await openFrom<unknown>(key, current); if (v !== undefined) await sealTo(key, v, next); }
  vaultKey.set(next);
}

/** Turns the lock on: a new passkey on this device (Face ID asked twice at most). */
export async function enableLock(deviceName: string): Promise<{ ok: boolean; prf: boolean; why?: string }> {
  if (!(await lockAvailable())) return { ok: false, prf: false, why: 'Face ID isn’t available in this browser' };
  const salt = crypto.getRandomValues(new Uint8Array(32));
  let cred: PublicKeyCredential | null = null;
  try {
    cred = (await navigator.credentials.create({ publicKey: {
      rp: { name: 'Arnav Island' }, user: { id: b(crypto.getRandomValues(new Uint8Array(16))), name: 'Arnav Island lock', displayName: `Arnav Island on ${deviceName}` },
      challenge: b(crypto.getRandomValues(new Uint8Array(32))), pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' }, timeout: 60_000, attestation: 'none',
      extensions: { prf: { eval: { first: b(salt) } } } as AuthenticationExtensionsClientInputs,
    } })) as PublicKeyCredential | null;
  } catch (e) { return { ok: false, prf: false, why: (e as Error)?.name === 'NotAllowedError' ? 'Face ID was cancelled' : 'The passkey couldn’t be made' }; }
  if (!cred) return { ok: false, prf: false, why: 'The passkey couldn’t be made' };
  const created = cred.getClientExtensionResults() as PrfResults;
  const config: LockConfig = { on: true, credential: new Uint8Array(cred.rawId), salt, prf: created.prf?.enabled === true };
  // Its secret: given at creation on some systems, else asked for once more.
  let secret: ArrayBuffer | null = created.prf?.results?.first ?? null;
  if (config.prf && !secret) { secret = await assert(config); if (secret === null) return { ok: false, prf: false, why: 'Face ID was cancelled' }; if (secret.byteLength === 0) config.prf = false; }
  if (config.prf && secret && secret.byteLength >= 16) {
    // A fresh vault key, kept only sealed under the passkey's secret.
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await wrapping(secret), raw);
    const next = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); raw.fill(0);
    await reseal(next);
    config.sealed = { iv, data };
    await idb.set('lock', config); await idb.del('vault');
  } else {
    config.prf = false;
    await idb.set('lock', config);
  }
  return { ok: true, prf: config.prf };
}

/** Face ID, then the vault opens: true when unlocked. */
export async function unlock(): Promise<boolean> {
  const c = await lockConfig(); if (!c?.on) return true;
  const secret = await assert(c); if (secret === null) return false;
  if (!c.prf || !c.sealed) return true;
  if (secret.byteLength < 16) return false;
  try {
    const raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(c.sealed.iv) }, await wrapping(secret), c.sealed.data));
    vaultKey.set(await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])); raw.fill(0);
    return true;
  } catch { return false; }
}

/** Turns the lock off (after Face ID): the vault goes back to a key this device keeps. */
export async function disableLock(): Promise<boolean> {
  const c = await lockConfig(); if (!c?.on) return true;
  if (!(await unlock())) return false;
  if (c.prf) {
    const next = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await reseal(next); await idb.set('vault', next);
  }
  await idb.del('lock');
  return true;
}
