// This iPhone's camera in a window on your PC (island 0.24): the camera's picture, encoded as H.264 here (WebCodecs) and
// sent as the "phone screen" the island shows in its floating window. Sized and paced for the relay: 1280 on its long side
// at 24 frames a second, its bit rate following the PC's feedback (down a quarter when it falls behind, up after easy
// seconds). Only while the app is on screen; Stop, or leaving the app, ends it.
import { signal } from '@preact/signals';
import { Reader } from '../link/bytes';
import type { ScreenSession } from '../link/link';
import { Proto } from '../link/proto';
import { limits, offerPhone, screenReply, videoFrames } from '../link/screenwire';
import { getLink, peers, prefs, say } from '../state/hub';

/** Which PC shows the camera now (its name), or null. */
export const cameraShowing = signal<string | null>(null);
export const cameraFacing = signal<'environment' | 'user'>('environment');
/** The live preview, for the app's own little window. */
export const cameraStream = signal<MediaStream | null>(null);

let stopNow: (() => void) | null = null;
export const cameraSupported = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

export function stopCamera() { stopNow?.(); }
export async function flipCamera() { if (!stopNow) return; const peer = current; cameraFacing.value = cameraFacing.value === 'environment' ? 'user' : 'environment'; stopNow(); if (peer) await startCamera(peer); }
let current: string | null = null;

export async function startCamera(peer: string): Promise<void> {
  const link = getLink(); const pc = peers.value.find((p) => p.id === peer); const pcName = pc?.name ?? 'your PC';
  if (!cameraSupported()) { say({ kind: 'failed', title: 'This browser can’t send video', detail: 'It needs iOS 17 or later' }); return; }
  if (!link || !pc) { say({ kind: 'failed', title: `Couldn’t reach ${pcName}` }); return; }
  stopNow?.();
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cameraFacing.value, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } }, audio: false }); }
  catch { say({ kind: 'failed', title: 'The camera isn’t allowed', detail: 'Allow it for this site in Settings › Apps › Safari › Camera' }); return; }
  const track = stream.getVideoTracks()[0]; const settings = track.getSettings();
  const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = stream;
  try { await video.play(); } catch { /* it plays once shown */ }
  for (let i = 0; i < 40 && !video.videoWidth; i++) await new Promise((r) => setTimeout(r, 50));
  const sw = video.videoWidth || settings.width || 1280, sh = video.videoHeight || settings.height || 720;
  const scale = Math.min(1, 1280 / Math.max(sw, sh)); const w = Math.max(16, Math.floor((sw * scale) / 16) * 16), h = Math.max(16, Math.floor((sh * scale) / 16) * 16);
  const fps = 24; const least = 250_000, most = 1_800_000; let bitrate = 800_000;

  const opened = await link.openScreen(peer, offerPhone(w, h, fps, `${prefs.value.name}’s camera`));
  if (!opened) { stream.getTracks().forEach((t) => t.stop()); say({ kind: 'failed', title: pc.revision < 7 ? `Update Arnav Island on ${pcName} to 0.24 or later` : `Couldn’t reach ${pcName}` }); return; }
  const [s, answer] = opened as [ScreenSession, Uint8Array]; const reply = screenReply(answer);
  if (!reply || reply.status !== 0) { stream.getTracks().forEach((t) => t.stop()); s.close(); say({ kind: 'failed', title: reply?.status === 1 ? `Turn on “My phone can control this PC” on ${pcName}’s island` : `${pcName} couldn’t show the camera` }); return; }

  let running = true; current = peer; cameraShowing.value = pcName; cameraStream.value = stream;
  const pcSays = { acked: 0, heard: false, wantKey: true, lastHeard: Date.now() };
  let number = 0, lastSent = Date.now(), slow = 0, lastCheck = Date.now(), lastUp = Date.now(), skipping = false;
  const canvas = new OffscreenCanvas(w, h); const ctx = canvas.getContext('2d')!;
  const encoder = new VideoEncoder({
    output: (chunk) => {
      if (!running) return;
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      const key = chunk.type === 'key';
      // A PC two seconds behind: nothing more until a key frame, so it catches up instead of lagging.
      if (pcSays.heard && number - pcSays.acked > fps * 2 && !skipping) { skipping = true; pcSays.wantKey = true; }
      if (skipping && !key) return;
      skipping = false; number++;
      const t0 = Date.now();
      for (const f of videoFrames(number, key, BigInt(Math.round(chunk.timestamp * 10)), data)) void s.send(f);
      lastSent = Date.now(); if (Date.now() - t0 > 1500 / fps) slow++; else slow = Math.max(0, slow - 1);
    },
    error: () => { if (running) { say({ kind: 'failed', title: `The camera stopped on ${pcName}` }); stop(); } },
  });
  const configure = () => encoder.configure({ codec: 'avc1.42e01f', width: w, height: h, bitrate, framerate: fps, latencyMode: 'realtime', avc: { format: 'annexb' }, hardwareAcceleration: 'prefer-hardware' } as VideoEncoderConfig);
  try { configure(); } catch { say({ kind: 'failed', title: 'This iPhone can’t encode the camera here' }); running = false; s.close(); stream.getTracks().forEach((t) => t.stop()); cameraShowing.value = null; cameraStream.value = null; return; }

  // What the PC says: how it's keeping up, key frames it wants, its end.
  void (async () => {
    while (running && s.open) {
      const f = await s.receive(500); if (!f || !f.length) continue; pcSays.lastHeard = Date.now();
      const r = new Reader(f);
      switch (r.u8()) {
        case Proto.SCREEN_FEEDBACK: pcSays.acked = r.u32() ?? 0; pcSays.heard = true; break;
        case Proto.SCREEN_KEYFRAME: pcSays.wantKey = true; break;
        case Proto.SCREEN_STOP: running = false; break;
      }
    }
    if (running) stop();
  })();

  const t0 = performance.now(); let lastFrame = 0;
  const tick = () => {
    if (!running) return;
    const now = performance.now();
    if (now - lastFrame >= 1000 / fps - 2 && video.readyState >= 2 && encoder.encodeQueueSize < 3) {
      lastFrame = now;
      try {
        ctx.drawImage(video, 0, 0, w, h);
        const frame = new VideoFrame(canvas, { timestamp: Math.round((now - t0) * 1000) });
        const key = pcSays.wantKey || number % (fps * 2) === 0; pcSays.wantKey = false;
        encoder.encode(frame, { keyFrame: key }); frame.close();
      } catch { /* a frame lost */ }
    }
    const at = Date.now();
    if (at - pcSays.lastHeard > 8000) { say({ kind: 'failed', title: `Lost ${pcName}` }); stop(); return; }
    // Still here: a word every second keeps the PC from giving up.
    if (at - lastSent >= 1000) { void s.send(limits(w, h, fps)); lastSent = at; }
    // The bit rate follows the path.
    if (at - lastCheck >= 500) {
      lastCheck = at; const behind = pcSays.heard && number - pcSays.acked > fps;
      const next = slow >= 3 || behind ? Math.max(least, Math.floor((bitrate * 3) / 4)) : at - lastUp >= 4000 && bitrate < most ? Math.min(most, Math.floor((bitrate * 115) / 100)) : bitrate;
      if (slow >= 3 || behind) { slow = 0; lastUp = at; } else if (next !== bitrate) lastUp = at;
      if (next !== bitrate) { bitrate = next; try { configure(); } catch { /* keeps the last rate */ } }
    }
    raf = requestAnimationFrame(tick);
  };
  let raf = requestAnimationFrame(tick);
  const onHide = () => { if (document.visibilityState === 'hidden') stop(); };
  document.addEventListener('visibilitychange', onHide);

  function stop() {
    if (!running && !stopNow) return;
    running = false; cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onHide);
    try { encoder.close(); } catch { /* closed */ }
    stream.getTracks().forEach((t) => t.stop()); video.srcObject = null;
    void s.send(Uint8Array.of(Proto.SCREEN_STOP)).finally(() => setTimeout(() => s.close(), 300));
    cameraShowing.value = null; cameraStream.value = null; stopNow = null; current = null;
  }
  stopNow = stop;
  say({ kind: 'photo', title: `The camera is on ${pcName}`, detail: 'In a window there. Tap the island’s tile again to stop' });
}
