// The island's cryptography, byte for byte as Arnav Island for Windows (CNG) and Android do it: static ECDH P-256 keys
// (public keys on the wire as X then Y, 32 bytes each, big-endian), the shared X coordinate hashed once with SHA-256, and
// AES-256-GCM with a 12-byte nonce of a direction byte and a frame counter. Everything is WebCrypto: this device's private
// key is a non-extractable CryptoKey, so no script, not even this app's own, can ever read its bytes.
import { concat, utf8 } from './bytes';

const subtle = globalThis.crypto.subtle;

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

type Part = Uint8Array | string;
export async function sha256(...parts: Part[]): Promise<Uint8Array> {
  const data = concat(...parts.map((p) => (typeof p === 'string' ? utf8(p) : p)));
  return new Uint8Array(await subtle.digest('SHA-256', data as BufferSource));
}

export interface Identity { id: Uint8Array; pub: Uint8Array; key: CryptoKey }

/** A new key pair: the private half made extractable only so it can be wrapped for storage (see the store). */
export async function newKeyPair(extractable: boolean): Promise<CryptoKeyPair> {
  return subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, extractable, ['deriveBits']) as Promise<CryptoKeyPair>;
}

/** A public key as the wire has it: X then Y. */
export async function xy(key: CryptoKey): Promise<Uint8Array> {
  const raw = new Uint8Array(await subtle.exportKey('raw', key));
  return raw.slice(1, 65);
}

/** X then Y back into a key; WebCrypto refuses a point that isn't on P-256. */
export async function publicKey(xyBytes: Uint8Array): Promise<CryptoKey | null> {
  if (xyBytes.length !== 64) return null;
  try { return await subtle.importKey('raw', concat(Uint8Array.of(4), xyBytes) as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, true, []); }
  catch { return null; }
}

/** ECDH, then SHA-256 of the shared X coordinate (CNG's BCRYPT_KDF_HASH with SHA-256). */
export async function agree(mine: CryptoKey, theirs: Uint8Array): Promise<Uint8Array | null> {
  const key = await publicKey(theirs);
  if (!key) return null;
  try {
    const z = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: key }, mine, 256));
    const k = await sha256(z); z.fill(0); return k;
  } catch { return null; }
}

/** A device's key fingerprint as its pairing QR code carries it: the first ten bytes of the SHA-256 of its public key. */
export async function keyPrint(pub: Uint8Array): Promise<Uint8Array> { return (await sha256(pub)).slice(0, 10); }

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * One session's AES-256-GCM channel. The nonce is the direction (1 from the side that opened the connection, 2 back) and a
 * counter per direction, so no nonce repeats under a session key; the 16-byte tag follows the ciphertext. Seals are counted
 * as they're asked for (in order), so frames sealed together keep their order.
 */
export class Channel {
  private sent = 0n;
  private received = 0n;
  private constructor(private key: CryptoKey, private sendDir: number, private recvDir: number) {}
  static async create(raw: Uint8Array, initiator: boolean): Promise<Channel> {
    return new Channel(await aesKey(raw), initiator ? 1 : 2, initiator ? 2 : 1);
  }
  private nonce(dir: number, n: bigint): Uint8Array {
    const b = new Uint8Array(12); b[0] = dir;
    new DataView(b.buffer).setBigUint64(4, n, true);
    return b;
  }
  seal(plain: Uint8Array): Promise<Uint8Array> {
    const iv = this.nonce(this.sendDir, this.sent++);
    return subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, tagLength: 128 }, this.key, plain as BufferSource).then((c) => new Uint8Array(c));
  }
  async open(frame: Uint8Array): Promise<Uint8Array | null> {
    if (frame.length <= 16) return null;
    const iv = this.nonce(this.recvDir, this.received++);
    try { return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource, tagLength: 128 }, this.key, frame as BufferSource)); }
    catch { return null; }
  }
}

/** The relay's seal: a random nonce each message, the topic as associated data (ShareRelay's Seal). */
export class Seal {
  private constructor(private key: CryptoKey) {}
  static async create(raw: Uint8Array): Promise<Seal> { return new Seal(await aesKey(raw)); }
  async seal(plain: Uint8Array, topic: string): Promise<Uint8Array> {
    const nonce = randomBytes(12);
    const c = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource, additionalData: utf8(topic) as BufferSource, tagLength: 128 }, this.key, plain as BufferSource));
    return concat(nonce, c);
  }
  async open(sealed: Uint8Array, topic: string): Promise<Uint8Array | null> {
    if (sealed.length <= 12 + 16) return null;
    try {
      return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12) as BufferSource, additionalData: utf8(topic) as BufferSource, tagLength: 128 }, this.key, sealed.slice(12) as BufferSource));
    } catch { return null; }
  }
}
