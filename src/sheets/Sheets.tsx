// The app's other sheets: files and music a PC offers, a link for the PC, a page or the clipboard from it, a photo it asks
// for, files that arrived, find my phone, the Home Screen, Shortcuts, and the Face ID lock.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PeerView } from '../link/island';
import { Frames } from '../link/island';
import type { Arrived } from '../link/link';
import { Proto } from '../link/proto';
import {
  type ClipArrived, type PageArrived, type ShareRequest, answer, answerMusic, clipArrived, closePlayer, command, firstLine, keptFile, lastArrived, music, offers, outcomes, pageArrived, pasteOnPc, peers,
  photoFor, playerState, playingHere, ringing, say, send, sendBack, sendPhoto, sizeText, togglePlayer, transfers, utf8,
} from '../state/hub';
import { isIos, platform, standalone } from '../state/device';
import { DrawnCheck, GlassButton, GlassIconButton, GlassPanel, Icon, LiveDot, PlayPause, ProgressRing, clock, glassClass, iconFor, quality } from '../ui/components';
import { haptic, useNow } from '../ui/motion';
import { GlassSheet } from '../ui/sheet';
import { pickFiles } from '../screens/Send';
import { VERSION } from '../screens/Devices';

/** Files a PC offers: what, how much, from whom; Accept or Decline. */
export function OfferSheet() {
  const offer = offers.value[0] ?? null;
  return (
    <GlassSheet visible={!!offer} onDismiss={() => offer && answer(offer, false)} label="Files from your PC">
      {offer && <>
        <span style={{ width: 70, height: 70, borderRadius: 22, background: 'color-mix(in srgb, var(--good) 18%, transparent)', color: 'var(--good)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={offer.folder ? 'folder' : iconFor(offer.title)} size={34} /></span>
        <div class="t-title center" style={{ marginTop: 14 }}>{offer.name} is sending</div>
        <div class="t-strong center clamp2" style={{ marginTop: 4 }}>{offer.title}</div>
        <div class="t-caption muted center">{offer.count > 1 ? `${offer.count} files  ·  ` : ''}{sizeText(offer.size)}  ·  kept here, ready to save or share</div>
        <div class="row gap12" style={{ width: '100%', marginTop: 24 }}>
          <GlassButton onClick={() => answer(offer, false)} style={{ flex: 1 }}><span class="t-strong">Decline</span></GlassButton>
          <GlassButton onClick={() => answer(offer, true)} prominent style={{ flex: 1 }}><span class="t-strong">Accept</span></GlassButton>
        </div>
      </>}
    </GlassSheet>
  );
}

/** Music a PC offers to continue here: its cover (with its own light beneath), where it is, Play here or Not now. */
export function MusicSheet() {
  const m = music.value; const [answered, setAnswered] = useState<number | null>(null);
  const cover = useMemo(() => (m?.music.cover ? URL.createObjectURL(new Blob([m.music.cover as BlobPart], { type: 'image/jpeg' })) : null), [m?.transfer]);
  useEffect(() => () => { if (cover) URL.revokeObjectURL(cover); }, [cover]);
  const moving = m ? transfers.value.get(m.transfer) : undefined;
  return (
    <GlassSheet visible={!!m} onDismiss={() => m && answerMusic(m, false)} label="Music from your PC">
      {m && <>
        <div style={{ position: 'relative', width: 190, height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {cover ? <><div class="cover-glow" /><img src={cover} alt="Cover" style={{ width: 170, height: 170, borderRadius: 26, objectFit: 'cover', position: 'relative' }} /></>
            : <span style={{ width: 150, height: 150, borderRadius: 26, background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="musicNote" size={60} /></span>}
        </div>
        <div class="t-caption muted" style={{ marginTop: 16 }}>Continue on this {platform().kind === 'iPad' ? 'iPad' : 'iPhone'}?</div>
        <div class="t-title center clamp2">{m.music.title}</div>
        <div class="t-caption muted center">{[m.music.artist.trim() || null, `from ${m.name}`, m.music.duration > 0 ? `at ${clock(m.music.position)} of ${clock(m.music.duration)}` : null].filter(Boolean).join('  ·  ')}</div>
        <div style={{ height: 22 }} />
        {answered === m.transfer && m.music.fileSize > 0 ? (
          <div class="row gap10"><ProgressRing fraction={moving && moving.total > 0 ? moving.done / moving.total : 0} size={28} stroke={3} /><span class="t-body">Bringing the song over… {moving && moving.total > 0 ? Math.floor((moving.done / moving.total) * 100) : 0}%</span></div>
        ) : (
          <div class="row gap12" style={{ width: '100%' }}>
            <GlassButton onClick={() => answerMusic(m, false)} style={{ flex: 1 }}><span class="t-strong">Not now</span></GlassButton>
            <GlassButton onClick={() => { setAnswered(m.transfer); answerMusic(m, true); }} prominent style={{ flex: 1 }}><Icon name="playArrow" /><span class="t-strong">Play here</span></GlassButton>
          </div>
        )}
        {m.music.fileSize <= 0 && <div class="t-caption faint center" style={{ marginTop: 12 }}>Your PC plays it from an app, so it continues in {/spotify/i.test(m.music.app) ? 'Spotify' : /youtube/i.test(m.music.app) ? 'YouTube Music' : 'Apple Music'} here</div>}
      </>}
    </GlassSheet>
  );
}

/** Music handed over from your PC, playing here: a glass bar above the tabs with the cover, how far it's got, play and pause, and back to the PC. */
export function PlayingHereBar() {
  const p = playingHere.value; const st = playerState.value; const now = useNow(st.playing ? 250 : 1000, !!p);
  const cover = useMemo(() => (p?.music.cover ? URL.createObjectURL(new Blob([p.music.cover as BlobPart], { type: 'image/jpeg' })) : null), [p?.url]);
  useEffect(() => () => { if (cover) URL.revokeObjectURL(cover); }, [cover]);
  if (!p) return null;
  const pos = st.playing && st.duration > 0 ? Math.min(st.duration, st.position + (now - st.at) / 1000) : st.position;
  const f = st.duration > 0 ? pos / st.duration : 0;
  return (
    <div class="playing-here glass bar capsule">
      <div class="row" style={{ height: '100%', padding: '0 8px 0 9px', gap: 11 }}>
        <span style={{ width: 48, height: 48, borderRadius: 15, overflow: 'hidden', background: 'color-mix(in srgb, var(--accent) 20%, transparent)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{cover ? <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="musicNote" />}</span>
        <div class="col grow"><span class="t-strong ellipsis">{p.music.title}</span><span class="t-caption muted ellipsis">Playing here  ·  from {p.from}</span></div>
        <button type="button" class="press" aria-label={st.playing ? 'Pause' : 'Play'} style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => { haptic('click'); togglePlayer(); }}><PlayPause playing={st.playing} size={22} /></button>
        <button type="button" class="press accent" aria-label={`Continue on ${p.from}`} style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => { haptic('click'); sendBack(); }}><Icon name="laptop" size={22} /></button>
        <button type="button" class="press muted" aria-label="Stop" style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => { haptic('click'); closePlayer(); }}><Icon name="close" size={19} /></button>
      </div>
      <div class="playing-progress"><i style={{ width: `${f * 100}%` }} /></div>
    </div>
  );
}

/** A link to open in the PC's browser: typed, or already on the clipboard. */
export function LinkSheet({ visible, pc, onDismiss }: { visible: boolean; pc: PeerView | null; onDismiss: () => void }) {
  const [text, setText] = useState(''); const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (visible) { setText(''); setTimeout(() => field.current?.focus(), 300); } }, [visible]);
  const go = async () => {
    let url = text.trim(); if (!url) return; if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    if ((await command(Proto.CMD_OPEN, utf8(url)))?.status === Proto.OK) { say({ kind: 'info', title: `Opened on ${pc?.name}`, detail: url.slice(0, 60) }); onDismiss(); }
  };
  return (
    <GlassSheet visible={visible} onDismiss={onDismiss} label="Open a link on your PC">
      <div class="t-title" style={{ alignSelf: 'flex-start' }}>Open on {pc?.name ?? 'your PC'}</div>
      <label class={`row ${glassClass('control', 'capsule')}`} style={{ width: '100%', marginTop: 16, padding: '15px 18px', gap: 10 }}>
        <input ref={field} value={text} onInput={(e) => setText(e.currentTarget.value)} type="url" inputMode="url" placeholder="A web address" autoCapitalize="off" autoCorrect="off" spellcheck={false} enterKeyHint="go"
          class="t-body grow" style={{ background: 'none', border: 0, padding: 0, minWidth: 0 }} onKeyDown={(e) => { if (e.key === 'Enter') void go(); }} aria-label="A web address" />
        <button type="button" class="muted" aria-label="Paste" onClick={async () => { try { setText((await navigator.clipboard.readText()).trim()); } catch { /* not allowed */ } }}><Icon name="contentPaste" size={20} /></button>
      </label>
      <GlassButton onClick={() => void go()} prominent enabled={!!text.trim()} style={{ width: '100%', marginTop: 16 }}><Icon name="language" /><span class="t-strong">Open</span></GlassButton>
    </GlassSheet>
  );
}

/** A web page your PC handed over, where it was scrolled to: opened here in one tap. */
export function PageSheet() {
  const p: PageArrived | null = pageArrived.value; const host = useMemo(() => { try { return p ? new URL(p.url).host : ''; } catch { return ''; } }, [p?.url]);
  return (
    <GlassSheet visible={!!p} onDismiss={() => { pageArrived.value = null; }} label="A page from your PC">
      {p && <>
        <span class="well" style={{ width: 64, height: 64 }}><Icon name="language" size={30} /></span>
        <div class="t-caption muted" style={{ marginTop: 14 }}>From {p.from}{p.scroll > 0.02 ? `  ·  ${Math.round(p.scroll * 100)}% of the way down` : ''}</div>
        <div class="t-title center clamp2">{p.title || host || 'A page'}</div>
        <div class="t-caption muted center ellipsis" style={{ maxWidth: '100%' }}>{host}</div>
        <GlassButton onClick={() => { window.open(p.url, '_blank', 'noopener,noreferrer'); pageArrived.value = null; }} prominent style={{ width: '100%', marginTop: 22 }}><Icon name="openInNew" /><span class="t-strong">Open in Safari</span></GlassButton>
        <GlassButton onClick={async () => { try { await navigator.clipboard.writeText(p.url); say({ kind: 'clipboard', title: 'Link copied' }); } catch { /* no clipboard */ } pageArrived.value = null; }} style={{ width: '100%', marginTop: 8 }}><Icon name="contentCopy" size={18} /><span class="t-caption">Copy the link</span></GlassButton>
      </>}
    </GlassSheet>
  );
}

/** Text your PC put on this device's clipboard: a browser may write it only from a tap, so it waits for one. */
export function ClipSheet({ text, onDone }: { text: string | null; onDone: () => void }) {
  const c: ClipArrived | null = clipArrived.value ?? (text !== null ? { text, sensitive: false, from: 'your PC' } : null);
  const close = () => { clipArrived.value = null; onDone(); };
  return (
    <GlassSheet visible={!!c} onDismiss={close} label="Your PC's clipboard">
      {c && <>
        <span class="well" style={{ width: 58, height: 58 }}><Icon name="contentPaste" size={28} /></span>
        <div class="t-title center" style={{ marginTop: 12 }}>From {c.from}’s clipboard</div>
        <div class={`clip-preview t-body ${glassClass('control', 'inner')}`}>{c.sensitive ? '•••••••• (hidden: it may be a password)' : c.text.slice(0, 600)}</div>
        <GlassButton onClick={async () => { try { await navigator.clipboard.writeText(c.text); haptic('confirm'); say({ kind: 'clipboard', title: 'Copied', detail: c.sensitive ? 'Hidden text' : firstLine(c.text) }); } catch { say({ kind: 'failed', title: 'Couldn’t copy' }); } close(); }} prominent style={{ width: '100%', marginTop: 18 }}><Icon name="contentCopy" /><span class="t-strong">Copy</span></GlassButton>
      </>}
    </GlassSheet>
  );
}

/** A PC asks for a photo for its Shelf: the camera opens from a tap (iOS asks for one). */
export function PhotoAskSheet() {
  const id = photoFor.value; const pc = peers.value.find((p) => p.id === id);
  return (
    <GlassSheet visible={!!id} onDismiss={() => { photoFor.value = null; }} label="A photo for your PC">
      {id && <>
        <span class="well" style={{ width: 64, height: 64 }}><Icon name="photoCamera" size={30} /></span>
        <div class="t-title center" style={{ marginTop: 14 }}>{pc?.name ?? 'Your PC'} wants a photo</div>
        <div class="t-caption muted center">It lands on the island’s Shelf</div>
        <div class="row gap12" style={{ width: '100%', marginTop: 22 }}>
          <GlassButton onClick={async () => { const f = await pickFiles({ accept: 'image/*', multiple: false }); if (f[0]) void sendPhoto(f[0]); }} style={{ flex: 1 }}><Icon name="photoLibrary" size={18} /><span class="t-strong">Library</span></GlassButton>
          <GlassButton onClick={async () => { const f = await pickFiles({ accept: 'image/*', capture: true, multiple: false }); if (f[0]) void sendPhoto(f[0]); }} prominent style={{ flex: 1 }}><Icon name="photoCamera" size={18} /><span class="t-strong">Take one</span></GlassButton>
        </div>
      </>}
    </GlassSheet>
  );
}

/** Files that arrived (or kept from before): shown, and saved or shared through the iPhone's own share sheet. */
export function ReceivedSheet({ ids, onDismiss }: { ids: string[] | null; onDismiss: () => void }) {
  const fresh = lastArrived.value;
  const [files, setFiles] = useState<Arrived[]>([]);
  const [index, setIndex] = useState(0);
  const open = !!ids || !!fresh;
  useEffect(() => {
    setIndex(0);
    if (ids) void Promise.all(ids.map((id) => keptFile(id))).then((l) => setFiles(l.filter((f): f is NonNullable<typeof f> => !!f).map((f) => ({ name: f.name, parts: [f.name], blob: f.blob, type: f.type }))));
    else if (fresh) setFiles(fresh.files);
  }, [ids, fresh?.n]);
  const f = files[index];
  const url = useMemo(() => (f ? URL.createObjectURL(f.blob) : null), [f]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const close = () => { lastArrived.value = null; onDismiss(); };
  const share = async (all: boolean) => {
    const list = (all ? files : [f]).filter(Boolean).map((x) => new File([x.blob], x.name, { type: x.type }));
    try { if (navigator.canShare?.({ files: list })) { await navigator.share({ files: list }); return; } } catch (e) { if ((e as Error).name === 'AbortError') return; }
    for (const x of list) { const a = document.createElement('a'); a.href = URL.createObjectURL(x); a.download = x.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  };
  const kind = f?.type.split('/')[0];
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { setText(null); if (f && (kind === 'text' || f.type === 'application/json') && f.blob.size < 512 * 1024) void f.blob.text().then(setText); }, [f]);
  return (
    <GlassSheet visible={open && files.length > 0} onDismiss={close} class="sheet-tall" label="Files that arrived">
      {f && url && <>
        <div class="row" style={{ width: '100%', gap: 10 }}>
          <div class="col grow"><span class="t-headline ellipsis">{f.name}</span><span class="t-caption muted">{sizeText(f.blob.size)}{files.length > 1 ? `  ·  ${index + 1} of ${files.length}` : ''}{fresh && !ids ? `  ·  from ${fresh.from}` : ''}</span></div>
          <GlassIconButton icon="iosShare" description="Save or share" onClick={() => void share(false)} size={42} prominent />
        </div>
        <div class="viewer">
          {kind === 'image' && <img src={url} alt={f.name} />}
          {kind === 'video' && <video src={url} controls playsInline />}
          {kind === 'audio' && <audio src={url} controls />}
          {f.type === 'application/pdf' && <iframe src={url} title={f.name} sandbox="" />}
          {text !== null && <pre class="text-view">{text}</pre>}
          {text === null && !['image', 'video', 'audio'].includes(kind ?? '') && f.type !== 'application/pdf' && <div class="col" style={{ alignItems: 'center', gap: 10, color: 'var(--accent)' }}><Icon name={iconFor(f.name)} size={64} /><span class="t-caption muted">Save it to Files, or open it in another app</span></div>}
        </div>
        {files.length > 1 && <div class="row gap8" style={{ width: '100%' }}>
          <GlassIconButton icon="keyboardArrowLeft" description="Previous" enabled={index > 0} onClick={() => setIndex(index - 1)} size={42} />
          <GlassButton onClick={() => void share(true)} style={{ flex: 1 }} pad="11px 0"><Icon name="iosShare" size={18} /><span class="t-caption">Save or share all {files.length}</span></GlassButton>
          <GlassIconButton icon="keyboardArrowRight" description="Next" enabled={index < files.length - 1} onClick={() => setIndex(index + 1)} size={42} />
        </div>}
      </>}
    </GlassSheet>
  );
}

/**
 * Sending, as AirDrop does it: what's being sent shows as a picture (a fanned stack for several). Each of your PCs is a glass
 * bubble; one tap sends it to that PC's Shelf, and a ring fills round the bubble as it goes, turning into a tick when it's
 * there. For text or a link (from a Shortcut): paste it, open it, on the PC.
 */
export function ShareSheet({ request, onDone }: { request: ShareRequest | null; onDone: () => void }) {
  const paired = peers.value.filter((p) => p.paired && !p.phone);
  const [started, setStarted] = useState<Record<string, number>>({}); const [finished, setFinished] = useState<Record<string, boolean>>({});
  useEffect(() => { setStarted({}); setFinished({}); }, [request]);
  useEffect(() => { const o = outcomes.value; if (!o) return; const e = Object.entries(started).find(([, id]) => id === o.transfer); if (e) { setFinished((f) => ({ ...f, [e[0]]: o.ok })); haptic(o.ok ? 'confirm' : 'reject'); } }, [outcomes.value]);
  useEffect(() => { const n = Object.keys(started).length; if (n && Object.keys(finished).length === n && Object.values(finished).every(Boolean)) { const t = setTimeout(onDone, 1300); return () => clearTimeout(t); } }, [finished, started]);
  useEffect(() => { if (request?.target) { const p = paired.find((x) => x.id === request.target); if (p) go(p); } }, [request]);
  const go = (p: PeerView) => {
    if (!request || started[p.id] !== undefined || !p.online) return; haptic('click'); setStarted((s) => ({ ...s, [p.id]: -1 }));
    void send(p.id, request.files, { toShelf: true }).then((id) => { if (id !== null) setStarted((s) => ({ ...s, [p.id]: id })); });
  };
  const text = request?.text?.trim() ?? ''; const link = /^https?:\/\/\S+$/i.test(text) ? text : null;
  const all = Object.keys(started).length > 0 && Object.keys(finished).length === Object.keys(started).length && Object.values(finished).every(Boolean);
  return (
    <GlassSheet visible={!!request} onDismiss={onDone} label="Send to your PC">
      {request && (request.files.length ? <>
        <Previewed files={request.files} />
        <div class="t-caption muted" style={{ marginTop: 18 }}>{!Object.keys(started).length ? 'Tap a PC to send it to its Shelf' : all ? 'On its Shelf' : 'Sending…'}</div>
        <div style={{ height: 14 }} />
        {!paired.length ? <div class="t-body muted">Pair with your PC first (Devices › Scan the QR code)</div>
          : <div class="row" style={{ width: '100%', justifyContent: 'space-evenly' }}>{paired.slice(0, 4).map((p) => {
            const id = started[p.id]; const tr = id !== undefined ? transfers.value.get(id) : undefined;
            const progress = finished[p.id] === true ? 1 : id === undefined ? -1 : tr && tr.total > 0 ? tr.done / tr.total : 0;
            return <Bubble key={p.id} pc={p} progress={progress} done={finished[p.id]} onTap={() => go(p)} />;
          })}</div>}
      </> : <>
        <div class="t-title">Send to your PC</div>
        <div class="t-caption muted center clamp2" style={{ marginTop: 4 }}>{text.split('\n')[0].slice(0, 80)}</div>
        <div style={{ height: 18 }} />
        {!paired.length ? <div class="t-body muted">Pair with your PC first</div> : <div class="row gap12" style={{ width: '100%' }}>
          <GlassButton onClick={async () => { await pasteOnPc(text); onDone(); }} prominent={!link} style={{ flex: 1 }}><span class="t-strong">Paste on PC</span></GlassButton>
          {link && <GlassButton onClick={async () => { if ((await command(Proto.CMD_OPEN, utf8(link)))?.status === Proto.OK) say({ kind: 'info', title: 'Opened on your PC' }); onDone(); }} prominent style={{ flex: 1 }}><span class="t-strong">Open on PC</span></GlassButton>}
        </div>}
      </>)}
    </GlassSheet>
  );
}
function Previewed({ files }: { files: File[] }) {
  const pics = useMemo(() => files.slice(0, 3).map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => pics.forEach((u) => u && URL.revokeObjectURL(u)), [pics]);
  const total = files.reduce((a, f) => a + f.size, 0);
  return (
    <div class="col" style={{ alignItems: 'center' }}>
      <div class="fan">
        {[...pics.keys()].reverse().map((i) => (
          <span key={i} class={`fan-card ${glassClass('control', 'card')}`} style={{ '--r': pics.length === 1 || i === 0 ? '0deg' : i === 1 ? '-8deg' : '7deg', '--s': i === 0 ? '150px' : '138px' }}>
            {pics[i] ? <img src={pics[i]!} alt="" /> : <span class="accent"><Icon name="insertDriveFile" size={48} /></span>}
          </span>
        ))}
      </div>
      <div class="t-strong ellipsis" style={{ marginTop: 12, maxWidth: '100%' }}>{files.length === 1 ? files[0].name : `${files.length} items`}  ·  {sizeText(total)}</div>
    </div>
  );
}
function Bubble({ pc, progress, done, onTap }: { pc: PeerView; progress: number; done: boolean | undefined; onTap: () => void }) {
  return (
    <button type="button" class="col press" style={{ width: 88, alignItems: 'center', opacity: pc.online ? 1 : 0.45 }} disabled={!pc.online || progress >= 0} onClick={onTap} aria-label={`Send to ${pc.name}`}>
      <span style={{ position: 'relative', width: 78, height: 78, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span class={glassClass('control', 'circle', true)} style={{ width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', '--tint': done ? 'var(--good)' : 'var(--accent)' }}>
          {done ? <span class="pop"><Icon name="check" size={30} /></span> : <Icon name="laptop" size={28} />}
        </span>
        {progress >= 0 && <span style={{ position: 'absolute', inset: 0 }}>{progress <= 0 && done === undefined ? <span class="bubble-wait" /> : <ProgressRing fraction={progress} color={done === false ? 'var(--danger)' : done ? 'var(--good)' : 'var(--accent)'} size={78} stroke={3} />}</span>}
      </span>
      <span class="t-caption ellipsis" style={{ marginTop: 6, maxWidth: '100%' }}>{pc.name}</span>
      <span class="t-caption muted ellipsis" style={{ maxWidth: '100%' }}>{!pc.online ? 'Away' : done ? 'On its Shelf' : done === false ? 'Didn’t go' : progress >= 0 ? `${Math.floor(Math.max(0, progress) * 100)}%` : quality(pc).text.split('  ·')[0]}</span>
    </button>
  );
}

// ---- find my phone ----
let audioCtx: AudioContext | null = null;
/** Sound needs a first tap on iOS: the app's audio is readied on the first touch. */
export function unlockAudio() {
  try { if (!audioCtx) audioCtx = new AudioContext(); if (audioCtx.state === 'suspended') void audioCtx.resume(); } catch { /* no audio */ }
}
const CYCLE = 2700;
const beat = (ms: number) => { const p = ms % CYCLE; const into = p < 700 ? p : p >= 1100 && p < 1800 ? p - 1100 : -1; return into < 0 ? 0 : Math.pow(1 - into / 700, 2); };
const rings = (ms: number) => { const c = ms - (ms % CYCLE); return [c - CYCLE + 1100, c, c + 1100].filter((t) => t >= 0 && t <= ms).map((t) => (ms - t) / 1600).filter((a) => a <= 1); };
/**
 * Find my phone: an alarm in time with its beat (two tones, then a rest), the screen pulsing with rings on every beat; its
 * light warms from amber to a glowing red the longer it rings. Until Found it (or a minute).
 */
export function RingOverlay() {
  const r = ringing.value; const canvas = useRef<HTMLCanvasElement>(null); const [since, setSince] = useState(0);
  useEffect(() => {
    if (!r) return;
    unlockAudio(); const ctx = audioCtx; let stopAt = 0; const gain = ctx?.createGain(); if (ctx && gain) { gain.gain.value = 0.0001; gain.connect(ctx.destination); }
    const tone = (at: number, freq: number, dur: number) => { if (!ctx || !gain) return; const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq; const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.55, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + dur); o.connect(g).connect(ctx.destination); o.start(at); o.stop(at + dur + 0.05); };
    const schedule = () => { if (!ctx) return; const t = Math.max(ctx.currentTime, stopAt); for (const [off, f] of [[0, 1318.5], [0.18, 1568], [0.36, 1318.5], [1.1, 1318.5], [1.28, 1568], [1.46, 1318.5]] as const) tone(t + off, f, 0.16); stopAt = t + CYCLE / 1000; };
    schedule(); const loop = setInterval(schedule, CYCLE - 100);
    const end = setTimeout(() => { ringing.value = null; }, 60_000);
    let raf = 0; const t0 = r.at; const frame = () => { setSince(Date.now() - t0); raf = requestAnimationFrame(frame); }; raf = requestAnimationFrame(frame);
    return () => { clearInterval(loop); clearTimeout(end); cancelAnimationFrame(raf); };
  }, [r?.at]);
  useEffect(() => {
    const c = canvas.current; if (!c || !r) return; const dpr = Math.min(2, devicePixelRatio); const w = c.clientWidth, h = c.clientHeight; c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const warmth = Math.min(1, since / 30000); const col = [255 + (255 - 255) * warmth, 192 + (77 - 192) * warmth, 77 + (46 - 77) * warmth].map(Math.round).join(',');
    const b = beat(since); const cx = w / 2, cy = h * 0.4; const R = 230;
    const g = 290 * (1 + 0.08 * b); const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, g); gr.addColorStop(0, `rgba(${col},${0.22 + 0.18 * b + 0.1 * warmth})`); gr.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, g, 0, Math.PI * 2); ctx.fill();
    for (const age of rings(since)) { ctx.strokeStyle = `rgba(${col},${(1 - age) * 0.55})`; ctx.lineWidth = 2.5 - 1.5 * age; ctx.beginPath(); ctx.arc(cx, cy, R * (0.26 + 0.74 * age), 0, Math.PI * 2); ctx.stroke(); }
    const a = ((since / (1400 - 700 * warmth)) * Math.PI * 2) % (Math.PI * 2); const orbit = 104;
    ctx.strokeStyle = `rgba(${col},${0.55 + 0.4 * warmth})`; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(cx, cy, orbit, a - 0.9, a); ctx.stroke();
    const tx = cx + orbit * Math.cos(a), ty = cy + orbit * Math.sin(a); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(tx, ty, 2.5, 0, Math.PI * 2); ctx.fill();
  }, [since]);
  if (!r) return null;
  const warmth = Math.min(1, since / 30000); const b = beat(since);
  return (
    <div class="ring-overlay" style={{ '--warm': warmth }} role="alertdialog" aria-label={`${r.from} is looking for this device`}>
      <canvas ref={canvas} class="overlay-canvas" />
      <div class="col" style={{ position: 'absolute', left: 0, right: 0, top: '40%', transform: 'translateY(-88px)', alignItems: 'center', padding: 30 }}>
        <span class="bell" style={{ transform: `scale(${1 + 0.14 * b})` }}><span style={{ transform: b > 0.05 ? `rotate(${Math.sin(since / 30) * 14}deg)` : 'none', display: 'flex' }}><Icon name="notificationsActive" size={56} /></span></span>
        <div class="t-hero" style={{ color: '#fff', marginTop: 34 }}>Here I am</div>
        <div class="t-body center" style={{ color: 'rgba(255,255,255,.75)', marginTop: 6 }}>{r.from} is looking for this {platform().kind === 'iPad' ? 'iPad' : 'iPhone'}</div>
        <button type="button" class="press found" onClick={() => { haptic('confirm'); ringing.value = null; }}><Icon name="check" /><span class="t-strong">Found it</span></button>
      </div>
    </div>
  );
}

// ---- the Home Screen, Shortcuts, keys, what's new ----
/** How to put the app on the Home Screen: Safari's share button, then Add to Home Screen, with an arrow to it. */
export function InstallSheet({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const ios = isIos(); const ipad = platform().kind === 'iPad';
  return (
    <GlassSheet visible={visible} onDismiss={onDismiss} label="Add to Home Screen">
      <div class="install-icon"><img src="/icons/icon-192.png" alt="" width={84} height={84} /></div>
      <div class="t-title center" style={{ marginTop: 14 }}>Arnav Island on your Home Screen</div>
      <div class="t-body muted center" style={{ marginTop: 6 }}>Full screen like an app, with its own icon. It opens instantly, works offline, and keeps its settings.</div>
      <GlassPanel class="col" style={{ width: '100%', marginTop: 18, padding: '6px 0' }}>
        {(ios ? [[ 'iosShare', `Tap Share ${ipad ? 'at the top' : 'at the bottom'} of Safari`], ['addToHomeScreen', 'Choose Add to Home Screen'], ['check', 'Tap Add. Then open Arnav Island from your Home Screen']] : [['moreHoriz', 'Open your browser’s menu'], ['addToHomeScreen', 'Choose Install app or Add to Home screen'], ['check', 'Open Arnav Island from your Home Screen']]).map(([icon, text], i) => (
          <div key={i} class="row" style={{ padding: '11px 16px', gap: 13 }}><span class="rowicon"><Icon name={icon as 'check'} size={20} /></span><span class="t-body">{text}</span></div>
        ))}
      </GlassPanel>
      {ios && !standalone() && !ipad && <div class="install-arrow" aria-hidden="true"><Icon name="keyboardArrowDown" size={34} /></div>}
      <GlassButton onClick={onDismiss} style={{ width: '100%', marginTop: 14 }}><span class="t-strong">Got it</span></GlassButton>
    </GlassSheet>
  );
}

/** Shortcuts and Siri: the app's actions as links a Shortcut (or a Home Screen bookmark) can open. Each asks first. */
export function ShortcutsSheet({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const base = location.origin;
  const rows: [string, string, string][] = [['Lock my PC', `${base}/#/do/lock`, 'lock'], ['Find my PC', `${base}/#/do/find`, 'notificationsActive'], ['Play or pause', `${base}/#/do/play`, 'playArrow'], ['Open the trackpad', `${base}/#/do/trackpad`, 'mouse'], ['My PC’s screen', `${base}/#/do/screen`, 'desktopWindows'], ['Paste on my PC', `${base}/#/do/paste`, 'contentPaste'], ['Open a link on my PC', `${base}/#/share?text=`, 'language']];
  return (
    <GlassSheet visible={visible} onDismiss={onDismiss} class="sheet-max" label="Shortcuts and Siri">
      <div class="t-title" style={{ alignSelf: 'flex-start' }}>Shortcuts and Siri</div>
      <div class="t-caption muted" style={{ alignSelf: 'flex-start', marginTop: 4, marginBottom: 12 }}>In the Shortcuts app, make a shortcut with “Open URLs” and one of these. Say its name to Siri, or put it on your Home Screen. The app asks before it does anything.</div>
      <div class="sheet-scroll col gap8">
        {rows.map(([title, url, icon]) => (
          <GlassPanel key={url} class="row" style={{ padding: '12px 14px', gap: 12 }}>
            <span class="rowicon"><Icon name={icon as 'lock'} size={20} /></span>
            <div class="col grow"><span class="t-strong">{title}</span><span class="t-caption muted ellipsis">{url}{url.endsWith('=') ? '…' : ''}</span></div>
            <GlassIconButton icon="contentCopy" description={`Copy the link for ${title}`} size={38} iconSize={18} onClick={async () => { try { await navigator.clipboard.writeText(url); say({ kind: 'clipboard', title: 'Link copied', detail: title }); } catch { /* none */ } }} />
          </GlassPanel>
        ))}
        <div class="t-caption faint" style={{ padding: '8px 6px' }}>For “Open a link on my PC”, add the Shortcut’s input after <b>text=</b> (as a URL-encoded text). Share any page to that shortcut from Safari’s share sheet.</div>
      </div>
    </GlassSheet>
  );
}

export function KeysSheet({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const rows: [string, string][] = [['Space', 'Play or pause'], ['← →', 'Previous, next'], ['↑ ↓', 'Volume up, down'], ['M', 'Mute'], ['1 – 5', 'Remote, Island, Send, Shelf, Devices'], ['⌘ K', 'Run a command on the PC'], ['T', 'The trackpad'], ['S', 'The PC’s screen'], ['⌘ V', 'Send what you copied (files too)'], ['Esc', 'Close a sheet']];
  return (
    <GlassSheet visible={visible} onDismiss={onDismiss} label="Keyboard shortcuts">
      <div class="t-title" style={{ alignSelf: 'flex-start', marginBottom: 12 }}>Keyboard shortcuts</div>
      <GlassPanel style={{ width: '100%', padding: '4px 0' }}>{rows.map(([k, v]) => <div key={k} class="row" style={{ padding: '10px 16px', gap: 12 }}><span class="kbd">{k}</span><span class="t-body">{v}</span></div>)}</GlassPanel>
    </GlassSheet>
  );
}

export function WhatsNewSheet({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
  const items: [string, string][] = [
    ['Your whole island, from an iPhone', 'Everything the Android app does that a web app can: the remote with its lyrics and dial, the whole island (numbers, controls, focus, command bar, power, sound, pages, settings), files and the Shelf both ways, music handed over, the trackpad, and your PC’s screen to touch.'],
    ['This iPhone’s camera on your PC', 'Show the camera in a window on your PC, as a webcam you can walk around with.'],
    ['Face ID', 'Lock the app with Face ID. Your pairings are sealed by it, not just hidden.'],
    ['An app on your Home Screen', 'Full screen, instant, offline, with Shortcuts and Siri for your PC’s actions.'],
    ['iPad and Mac', 'Drop or paste files to send them, type on your PC with your keyboard, and keyboard shortcuts throughout.'],
    ['Private by design', 'No server, no account, no cookies, no analytics. The strictest security headers a site can send.'],
  ];
  return (
    <GlassSheet visible={visible} onDismiss={onDismiss} class="sheet-max" label="What's new">
      <span class="accent"><Icon name="newReleases" size={40} /></span>
      <div class="t-title center" style={{ marginTop: 10 }}>Arnav Island for iPhone {VERSION}</div>
      <div class="sheet-scroll col gap10" style={{ marginTop: 16 }}>
        {items.map(([t, d]) => <GlassPanel key={t} class="col" style={{ padding: 16 }}><span class="t-strong">{t}</span><span class="t-caption muted" style={{ marginTop: 4 }}>{d}</span></GlassPanel>)}
        <div class="t-caption faint center" style={{ padding: 8 }}>Needs Arnav Island 0.25 on your PC, with “Reach my PCs anywhere” on. iOS keeps web apps from notifications from your phone, recent photos, the hotspot, sharing this iPhone’s screen and running in the background; the Android app does those.</div>
      </div>
      <GlassButton onClick={onDismiss} prominent style={{ width: '100%', marginTop: 12 }}><span class="t-strong">Continue</span></GlassButton>
    </GlassSheet>
  );
}

export function ConfirmAction({ action, onDismiss }: { action: { title: string; detail: string; verb: string; run: () => void } | null; onDismiss: () => void }) {
  return (
    <GlassSheet visible={!!action} onDismiss={onDismiss} label={action?.title}>
      {action && <>
        <div class="t-title center">{action.title}</div>
        <div class="t-body muted center" style={{ marginTop: 8 }}>{action.detail}</div>
        <div class="row gap12" style={{ width: '100%', marginTop: 24 }}>
          <GlassButton onClick={onDismiss} style={{ flex: 1 }}><span class="t-strong">Cancel</span></GlassButton>
          <GlassButton onClick={() => { haptic('confirm'); action.run(); onDismiss(); }} prominent style={{ flex: 1 }}><span class="t-strong">{action.verb}</span></GlassButton>
        </div>
      </>}
    </GlassSheet>
  );
}

/** The Face ID lock: the island in glass, and Unlock. */
export function LockScreen({ onUnlock, busy, failed }: { onUnlock: () => void; busy: boolean; failed: boolean }) {
  return (
    <div class="lock-screen">
      <div class="col" style={{ alignItems: 'center', gap: 18 }}>
        <div class="glass island capsule" style={{ width: 150, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#fff' }}><Icon name="lock" size={18} /><span class="t-caption">Locked</span></div>
        <span class="lock-face"><Icon name="face" size={46} /></span>
        <div class="t-title center">Arnav Island is locked</div>
        <div class={`t-caption center ${failed ? 'danger' : 'muted'}`}>{failed ? 'Face ID didn’t unlock it. Try again' : 'Your pairings are sealed until you unlock'}</div>
        <GlassButton onClick={onUnlock} prominent enabled={!busy} pad="15px 34px"><Icon name="face" /><span class="t-strong">{busy ? 'Unlocking…' : 'Unlock with Face ID'}</span></GlassButton>
      </div>
    </div>
  );
}

// Frames and live dots are re-exported for the app shell's small pieces.
export { Frames, LiveDot, DrawnCheck };
