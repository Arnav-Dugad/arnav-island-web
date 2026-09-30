// The app: the ambient light, the five pages under a floating tab bar, the island at the top, and every sheet over them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Proto } from './link/proto';
import { pairLink } from './link/relay';
import {
  afterUnlock, banner, codePairing, command, getLink, internet, locked, lyrics, moments, pairCode, pairWithCode, pasteOnPc, pc, peers, playingHere, prefs, ready, refreshStatus, request,
  requests, ringPc, ringing, say, setPrefs, shareRequest, start, status, statusError, transfers, visible, wake,
} from './state/hub';
import { isIos, standalone } from './state/device';
import { unlock, lockConfig } from './state/lock';
import { Ambient, HandoffParticles, WeatherGlass, skyOf } from './ui/ambient';
import { applyColors, colorsOf } from './ui/art';
import { Icon, quality } from './ui/components';
import { MiniIsland } from './ui/island';
import { haptic, listenTilt, setHaptics } from './ui/motion';
import { sheetsOpen } from './ui/sheet';
import { TabBar, type TabItem } from './ui/tabbar';
import { RemoteScreen } from './screens/Remote';
import { IslandScreen, IslandSheets } from './screens/Island';
import { SendScreen, ShelfScreen } from './screens/Send';
import { DevicesScreen, eraseAll } from './screens/Devices';
import { PcScreen } from './screens/PcScreen';
import { cameraShowing, cameraStream, flipCamera, startCamera, stopCamera } from './screens/camera';
import { PairSheet, type PairStart } from './sheets/Pair';
import { TrackpadSheet } from './sheets/Trackpad';
import {
  ClipSheet, ConfirmAction, InstallSheet, KeysSheet, LinkSheet, LockScreen, MusicSheet, OfferSheet, PageSheet, PhotoAskSheet, PlayingHereBar, ReceivedSheet, RingOverlay, ShareSheet, ShortcutsSheet, WhatsNewSheet,
} from './sheets/Sheets';

const TABS: TabItem[] = [{ label: 'Remote', icon: 'laptop' }, { label: 'Island', icon: 'dashboard' }, { label: 'Send', icon: 'send' }, { label: 'Shelf', icon: 'inventory2' }, { label: 'Devices', icon: 'devices' }];

export function App() {
  if (!ready.value) return <div class="ambient" />;
  if (locked.value) return <Locked />;
  return <Main />;
}

function Locked() {
  const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  const go = async () => { setBusy(true); const ok = await unlock(); setBusy(false); if (ok) { locked.value = false; await afterUnlock(); if (!getLink()) void start(); } else { setFailed(true); haptic('reject'); } };
  useEffect(() => { void go(); }, []);
  return <div id="app-inner"><Ambient playing={false} /><LockScreen onUnlock={() => void go()} busy={busy} failed={failed} /></div>;
}

function Main() {
  const p = prefs.value; const chosen = pc.value; const st = status.value;
  const [page, setPage] = useState(0);
  const pager = useRef<HTMLDivElement>(null);
  const listeners = useRef(new Set<(p: number) => void>());
  const subscribe = useCallback((f: (p: number) => void) => { listeners.current.add(f); f(page); return () => { listeners.current.delete(f); }; }, []);
  const [pairing, setPairing] = useState<PairStart | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [screenPeer, setScreenPeer] = useState<string | null>(null);
  const [islandOpen, setIslandOpen] = useState(false);
  const [clipText, setClipText] = useState<string | null>(null);
  const [fileIds, setFileIds] = useState<string[] | null>(null);
  const [urlAction, setUrlAction] = useState<{ title: string; detail: string; verb: string; run: () => void } | null>(null);
  const [touching, setTouching] = useState(false);

  // ---- the look ----
  const dark = p.appearance === 1 || (p.appearance === 0 && matchMedia('(prefers-color-scheme: dark)').matches);
  const [systemDark, setSystemDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => { const m = matchMedia('(prefers-color-scheme: dark)'); const f = () => setSystemDark(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  const isDark = p.appearance === 0 ? systemDark : dark;
  useEffect(() => { document.documentElement.dataset.theme = isDark ? 'dark' : 'light'; }, [isDark]);
  useEffect(() => { setHaptics(p.haptics); if (p.tilt) listenTilt(); }, []);
  // The cover of what plays on the PC, and the colours it lends the whole app.
  const cover = useMemo(() => (st?.cover ? URL.createObjectURL(new Blob([st.cover as BlobPart], { type: 'image/jpeg' })) : null), [st?.coverHash ? Array.from(st.coverHash.slice(0, 8)).join() : '', !!st?.cover]);
  useEffect(() => () => { if (cover) URL.revokeObjectURL(cover); }, [cover]);
  const [colors, setColors] = useState<Awaited<ReturnType<typeof colorsOf>>>(null);
  useEffect(() => { let gone = false; if (!cover) { setColors(null); return; } void colorsOf(cover).then((c) => { if (!gone) setColors(c); }); return () => { gone = true; }; }, [cover]);
  useEffect(() => applyColors(colors, isDark), [colors, isDark]);

  // ---- the remote's status while the app is on screen: every second while music plays, a little less often otherwise ----
  useEffect(() => {
    status.value = null; if (!chosen?.online || !visible.value) return;
    let stop = false;
    void (async () => { while (!stop) { await refreshStatus(); await new Promise((r) => setTimeout(r, status.value?.playing ? 1000 : 2000)); } })();
    return () => { stop = true; };
  }, [chosen?.id, chosen?.online, visible.value]);
  useEffect(() => { if (!st?.available) setIslandOpen(false); }, [st?.available]);
  useEffect(() => { if (pairCode.value) setPairing((s) => s ?? 'finding'); }, [pairCode.value]);

  // ---- the pages ----
  const goTo = (i: number, smooth = true) => { const el = pager.current; if (!el) return; el.scrollTo({ left: i * el.clientWidth, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' }); };
  const pageRef = useRef(0); pageRef.current = page;
  useEffect(() => {
    const el = pager.current; if (!el) return; let raf = 0; let width = el.clientWidth;
    const onScroll = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; const pos = el.scrollLeft / Math.max(1, el.clientWidth); listeners.current.forEach((f) => f(pos)); const i = Math.round(pos); setPage((cur) => (cur !== i ? i : cur)); }); };
    el.addEventListener('scroll', onScroll, { passive: true });
    // Turned, or resized (iPad split view): the page shown stays in place.
    const ro = new ResizeObserver(() => { if (el.clientWidth === width) return; width = el.clientWidth; el.scrollTo({ left: pageRef.current * width }); }); ro.observe(el);
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); };
  }, []);

  // ---- requests from anywhere in the app ----
  useEffect(() => {
    const r = requests.value; if (!r) return; const what = r.what;
    if (what === 'island') goTo(1);
    else if (what === 'trackpad') { if (chosen) setSheet('trackpad'); else setPairing('scan'); }
    else if (what === 'screen') { if (chosen) setScreenPeer(chosen.id); else setPairing('scan'); }
    else if (what === 'camera-live') { if (chosen) void startCamera(chosen.id); }
    else if (what === 'camera-stop') stopCamera();
    else if (what === 'link' || what === 'install' || what === 'shortcuts' || what === 'keys' || what === 'whatsnew') setSheet(what);
    else if (what === 'pair') setPairing('scan');
    else if (what === 'erase') setUrlAction({ title: 'Erase this device?', detail: 'It forgets every PC, its key and everything kept here. Your PCs keep it paired until you forget it there too.', verb: 'Erase', run: () => void eraseAll() });
    else if (what.startsWith('clip:')) setClipText(what.slice(5));
    else if (what.startsWith('files:')) setFileIds(JSON.parse(what.slice(6)) as string[]);
  }, [requests.value]);

  // ---- links into the app: pairing, sharing (from Shortcuts), and actions ----
  useEffect(() => {
    const handle = () => {
      const full = location.pathname + location.search + location.hash;
      const pairMatch = full.match(/\/pair\/([^?#]+)(\?[^#]*)?/);
      if (pairMatch) { const l = pairLink('arnavisland://pair/' + pairMatch[1] + (pairMatch[2] ?? '')); history.replaceState(null, '', '/'); if (l) { pairWithCode(l.code, l.key); setPairing('finding'); } else say({ kind: 'failed', title: 'That link can’t pair', detail: 'Scan the QR code on your PC’s island again' }); return; }
      const share = location.hash.match(/^#\/share\?(.*)$/);
      if (share) { const q = new URLSearchParams(share[1]); const text = q.get('text') ?? q.get('url') ?? ''; history.replaceState(null, '', '/'); if (text) shareRequest.value = { files: [], text, target: null }; return; }
      const act = location.hash.match(/^#\/do\/(\w+)/);
      if (act) { history.replaceState(null, '', '/'); runUrlAction(act[1]); }
    };
    handle(); window.addEventListener('hashchange', handle); return () => window.removeEventListener('hashchange', handle);
  }, []);
  // Actions from a link always ask first (a link from anywhere must not be able to lock your PC).
  const runUrlAction = (a: string) => {
    const name = pc.value?.name ?? 'your PC';
    const acts: Record<string, [string, string, string, () => void]> = {
      lock: [`Lock ${name}?`, 'From a shortcut or a link.', 'Lock', () => void command(Proto.CMD_LOCK)],
      find: [`Ring ${name}?`, 'Its island chimes and lights up.', 'Ring', () => void ringPc()],
      play: [`Play or pause on ${name}?`, 'From a shortcut or a link.', 'Go ahead', () => void command(Proto.CMD_MEDIA, Uint8Array.of(1))],
      paste: [`Paste on ${name}?`, 'What you copied goes to its clipboard.', 'Paste', () => { void navigator.clipboard.readText().then(pasteOnPc).catch(() => say({ kind: 'info', title: 'Allow pasting to use this' })); }],
    };
    if (a === 'trackpad') { request('trackpad'); return; }
    if (a === 'screen') { request('screen'); return; }
    const x = acts[a]; if (!x) return;
    const run = () => { if (!pc.value) { say({ kind: 'failed', title: 'No PC yet', detail: 'Pair with your PC first' }); return; } x[3](); };
    setUrlAction({ title: x[0], detail: x[1], verb: x[2], run });
  };

  // ---- files dropped or pasted (iPad, Mac): off to the PC's Shelf, AirDrop-style ----
  useEffect(() => {
    const drop = (e: DragEvent) => { if (!e.dataTransfer?.files.length) return; e.preventDefault(); shareRequest.value = { files: [...e.dataTransfer.files], text: null, target: null }; };
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    const paste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
      const files = [...(e.clipboardData?.files ?? [])]; if (files.length) { e.preventDefault(); shareRequest.value = { files, text: null, target: null }; return; }
      const text = e.clipboardData?.getData('text/plain'); if (text?.trim()) { e.preventDefault(); shareRequest.value = { files: [], text, target: null }; }
    };
    window.addEventListener('drop', drop); window.addEventListener('dragover', over); window.addEventListener('paste', paste);
    return () => { window.removeEventListener('drop', drop); window.removeEventListener('dragover', over); window.removeEventListener('paste', paste); };
  }, []);

  // ---- keyboard shortcuts (iPad, Mac) ----
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [role="slider"]') || sheetsOpen.value > 0 || screenPeer) return;
      const s = status.value;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); goTo(1); setTimeout(() => (document.querySelector('.page:nth-child(2) input') as HTMLInputElement | null)?.focus(), 400); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key >= '1' && e.key <= '5') { goTo(Number(e.key) - 1); return; }
      if (e.key === ' ' && s?.available) { e.preventDefault(); void command(Proto.CMD_MEDIA, Uint8Array.of(1)); return; }
      if (e.key === 'ArrowRight' && s?.available) { void command(Proto.CMD_MEDIA, Uint8Array.of(3)); return; }
      if (e.key === 'ArrowLeft' && s?.available) { void command(Proto.CMD_MEDIA, Uint8Array.of(2)); return; }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && s) { e.preventDefault(); const v = Math.max(0, Math.min(100, s.volume + (e.key === 'ArrowUp' ? 5 : -5))); status.value = { ...s, volume: v }; void command(Proto.CMD_VOLUME, Uint8Array.of(v), true); return; }
      if (e.key.toLowerCase() === 'm' && s) { void command(Proto.CMD_MUTE, Uint8Array.of(2)).then(() => refreshStatus()); return; }
      if (e.key.toLowerCase() === 't') request('trackpad'); else if (e.key.toLowerCase() === 's') request('screen');
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [screenPeer]);

  // ---- the page comes and goes: reconnect on return; the lock asks again after its time ----
  useEffect(() => {
    let hiddenAt = 0;
    const vis = async () => {
      const on = document.visibilityState === 'visible'; visible.value = on;
      if (!on) { hiddenAt = Date.now(); return; }
      wake();
      const c = await lockConfig();
      if (c?.on && hiddenAt && Date.now() - hiddenAt >= prefs.value.autoLock * 1000) { hiddenAt = 0; if (c.prf) location.reload(); else locked.value = true; }
    };
    document.addEventListener('visibilitychange', vis); window.addEventListener('online', wake); window.addEventListener('pageshow', wake);
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', wake); window.removeEventListener('pageshow', wake); };
  }, []);
  // A finger on the screen (and a moment after, as a fling settles) holds the light still.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const down = () => { clearTimeout(t); setTouching(true); }; const up = () => { clearTimeout(t); t = setTimeout(() => setTouching(false), 700); };
    window.addEventListener('pointerdown', down, { passive: true }); window.addEventListener('pointerup', up, { passive: true }); window.addEventListener('pointercancel', up, { passive: true });
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, []);
  // The first time in Safari on an iPhone: how to put it on the Home Screen.
  useEffect(() => { if (!p.installSeen && isIos() && !standalone()) { const t = setTimeout(() => { setSheet((s) => s ?? 'install'); setPrefs({ installSeen: true }); }, 2200); return () => clearTimeout(t); } }, []);
  useEffect(() => { if (!p.welcomed && standalone()) { setPrefs({ welcomed: true }); } }, []);

  const list = peers.value; const tr = transfers.value; const latest = useMemo(() => [...tr.values()].sort((a, b) => b.id - a.id)[0] ?? null, [tr]);
  const sky = skyOf(st?.weather ?? '');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <div id="app-inner" class={`${p.glass ? '' : 'solid'} ${sheetsOpen.value > 0 || screenPeer || reduced ? 'still' : ''} ${touching ? 'touching' : ''} ${playingHere.value ? 'with-player' : ''}`}>
      <Ambient playing={st?.playing === true} />
      <div ref={pager} class="pager" role="tabpanel" aria-label={TABS[page]?.label} inert={sheetsOpen.value > 0 || !!screenPeer || !!ringing.value}>
        <section class="page" aria-label="Remote"><div class="page-in"><RemoteScreen pc={chosen} status={st} error={statusError.value} cover={cover} lyrics={lyrics.value} onPair={() => setPairing('scan')} /></div></section>
        <section class="page" aria-label="Island"><div class="page-in"><IslandScreen pc={chosen} shown={page === 1} onPair={() => setPairing('scan')} /></div></section>
        <section class="page" aria-label="Send"><div class="page-in"><SendScreen pc={chosen} moments={moments.value} onPair={() => setPairing('scan')} /></div></section>
        <section class="page" aria-label="Shelf"><div class="page-in"><ShelfScreen pc={chosen} shown={page === 3} onPair={() => setPairing('scan')} /></div></section>
        <section class="page" aria-label="Devices"><div class="page-in"><DevicesScreen peers={list} pc={chosen} onPair={() => setPairing('type')} onScan={() => setPairing('scan')} /></div></section>
      </div>
      <div class="topfade" />
      {p.weather && <WeatherGlass sky={sky} active={visible.value && !screenPeer} />}
      <HandoffParticles transfers={tr} />
      {islandOpen && <div class="island-catch" onClick={() => setIslandOpen(false)} />}
      <MiniIsland status={st} cover={cover} pcName={chosen?.name ?? null} online={chosen?.online === true} banner={banner.value} transfer={latest} expanded={islandOpen} internet={internet.value} quality={chosen ? quality(chosen) : null}
        onClick={() => { if (islandOpen) setIslandOpen(false); else if (st?.available && !banner.value) setIslandOpen(true); else goTo(tr.size ? 2 : 0); }} />
      <TabBar items={TABS} subscribe={subscribe} selected={page} onSelect={(i) => goTo(i)} />
      <PlayingHereBar />
      {cameraShowing.value && <CameraPip />}
      <PairSheet visible={pairing !== null} start={pairing ?? 'scan'} onDismiss={() => { setPairing(null); if (!pairCode.value) codePairing.value = codePairing.value; }} />
      <OfferSheet />
      <MusicSheet />
      <LinkSheet visible={sheet === 'link'} pc={chosen} onDismiss={() => setSheet(null)} />
      <TrackpadSheet visible={sheet === 'trackpad'} pc={chosen} onDismiss={() => setSheet(null)} />
      <IslandSheets />
      <ShareSheet request={shareRequest.value} onDone={() => { shareRequest.value = null; }} />
      <ReceivedSheet ids={fileIds} onDismiss={() => setFileIds(null)} />
      <PageSheet />
      <ClipSheet text={clipText} onDone={() => setClipText(null)} />
      <PhotoAskSheet />
      <InstallSheet visible={sheet === 'install'} onDismiss={() => setSheet(null)} />
      <ShortcutsSheet visible={sheet === 'shortcuts'} onDismiss={() => setSheet(null)} />
      <KeysSheet visible={sheet === 'keys'} onDismiss={() => setSheet(null)} />
      <WhatsNewSheet visible={sheet === 'whatsnew'} onDismiss={() => setSheet(null)} />
      <ConfirmAction action={urlAction} onDismiss={() => setUrlAction(null)} />
      {screenPeer && <PcScreen peer={screenPeer} onClose={() => setScreenPeer(null)} />}
      <RingOverlay />
    </div>
  );
}

/** The camera's own little window while it shows on the PC: flip it, or stop. */
function CameraPip() {
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (v.current) { v.current.srcObject = cameraStream.value; void v.current.play().catch(() => {}); } }, [cameraStream.value]);
  return (
    <div class="camera-pip glass island" role="region" aria-label={`The camera, on ${cameraShowing.value}`}>
      <video ref={v} muted playsInline autoPlay />
      <div class="row camera-pip-bar">
        <span class="live-badge t-micro">LIVE</span>
        <span class="grow" />
        <button type="button" class="press" aria-label="Flip the camera" onClick={() => { haptic('click'); void flipCamera(); }}><Icon name="sync" size={20} /></button>
        <button type="button" class="press" aria-label="Stop the camera" onClick={() => { haptic('click'); stopCamera(); }}><Icon name="close" size={20} /></button>
      </div>
    </div>
  );
}
