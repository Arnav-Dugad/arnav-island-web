// Pairing, from anywhere: the island's own code (Shelf › Nearby › Pair with a code), scanned from its QR code (which names
// that PC's key, so only the PC asks to confirm) or typed. Both then show the same six digits, which roll in here.
import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { pairLink } from '../link/relay';
import { codePairing, confirmPair, pairCode, pairResult, pairWithCode } from '../state/hub';
import { DrawnCheck, GlassButton, Icon, Radar, RollingDigits, glassClass } from '../ui/components';
import { haptic } from '../ui/motion';
import { GlassSheet } from '../ui/sheet';

export type PairStart = 'type' | 'scan' | 'finding';

export function PairSheet({ visible, start, onDismiss }: { visible: boolean; start: PairStart; onDismiss: () => void }) {
  const [mode, setMode] = useState<PairStart>(start);
  const code = pairCode.value, result = pairResult.value, finding = codePairing.value;
  useEffect(() => { if (visible) { setMode(start); if (start !== 'finding') pairResult.value = null; } }, [visible]);
  useEffect(() => { if (result?.ok) { const t = setTimeout(onDismiss, 1600); return () => clearTimeout(t); } }, [result]);
  useEffect(() => { if (finding && mode !== 'type') setMode('finding'); }, [finding]);
  const stage = result?.ok ? 'done' : code ? 'code' : mode;
  return (
    <GlassSheet visible={visible} onDismiss={() => { if (code && !code.confirmed) confirmPair(false); onDismiss(); }} label="Pair with your PC">
      <div class="stage" key={stage}>
        {stage === 'type' && <CodeEntry connecting={!!finding} error={result && !result.ok ? result.detail : null} onScan={() => { pairResult.value = null; setMode('scan'); }} onCode={(c) => pairWithCode(c)} />}
        {stage === 'scan' && <ScanPane onLink={(l) => { haptic('confirm'); pairWithCode(l.code, l.key); setMode('finding'); }} onType={() => { pairResult.value = null; setMode('type'); }} />}
        {stage === 'finding' && <Finding error={result && !result.ok ? result.detail : null} onScan={() => { pairResult.value = null; setMode('scan'); }} onType={() => { pairResult.value = null; setMode('type'); }} onHide={onDismiss} />}
        {stage === 'code' && code && <>
          <div class="t-title center">{code.confirmed ? `Confirm on ${code.name}` : `Pair with ${code.name}?`}</div>
          <div class="t-caption muted center" style={{ marginTop: 6 }}>{code.confirmed ? 'It shows the same code. Choose Pair there to finish' : `Check that ${code.name} shows the same code`}</div>
          <RollingDigits text={(() => { const s = String(code.code).padStart(6, '0'); return s.slice(0, 3) + ' ' + s.slice(3); })()} class="t-digits" style={{ fontSize: 48, marginTop: 26 }} />
          <div style={{ height: 30 }} />
          {code.confirmed ? <div class="row gap10"><Radar size={28} /><span class="t-caption muted">Waiting for {code.name}…</span></div>
            : <div class="row gap12" style={{ width: '100%' }}>
              <GlassButton onClick={() => { confirmPair(false); onDismiss(); }} style={{ flex: 1 }}><span class="t-strong">Not now</span></GlassButton>
              <GlassButton onClick={() => confirmPair(true)} prominent style={{ flex: 1 }}><span class="t-strong">Pair</span></GlassButton>
            </div>}
        </>}
        {stage === 'done' && <>
          <div style={{ height: 20 }} />
          <span style={{ width: 96, height: 96, borderRadius: 48, background: 'color-mix(in srgb, var(--good) 20%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><DrawnCheck size={62} /></span>
          <div class="t-title center" style={{ marginTop: 18 }}>Paired with {result?.name || 'your PC'}</div>
          <div class="t-caption muted">Files, music and the remote are ready</div>
          <div style={{ height: 20 }} />
        </>}
      </div>
    </GlassSheet>
  );
}

/** A scanned (or opened) pairing link's PC being found over the internet: a laptop in glass with the radar sweeping round it. */
function Finding({ error, onScan, onType, onHide }: { error: string | null; onScan: () => void; onType: () => void; onHide: () => void }) {
  return (
    <>
      <div class="t-title">{error ? 'Not paired' : 'Finding your PC'}</div>
      <div class={`t-caption center ${error ? 'danger' : 'muted'}`} style={{ marginTop: 4 }}>{error ?? 'Over the internet, end-to-end encrypted. Keep the code showing on your PC'}</div>
      <div style={{ position: 'relative', width: '100%', height: error ? 150 : 250, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'height 500ms var(--sp-soft)' }}>
        {!error && <span style={{ position: 'absolute' }}><Radar size={230} /></span>}
        <span class={glassClass('control', 'circle', true)} style={{ width: 66, height: 66, display: 'flex', alignItems: 'center', justifyContent: 'center', '--tint': error ? 'var(--danger)' : 'var(--accent)' }}><Icon name="laptop" size={30} /></span>
      </div>
      {error ? <div class="row gap10">
        <GlassButton onClick={onScan} prominent pad="11px 18px"><Icon name="qrCodeScanner" size={18} /><span class="t-caption">Scan again</span></GlassButton>
        <GlassButton onClick={onType} pad="11px 18px"><Icon name="keyboard" size={18} /><span class="t-caption">Type the code</span></GlassButton>
      </div> : <GlassButton onClick={onHide} pad="11px 18px"><span class="t-caption">Hide</span></GlassButton>}
    </>
  );
}

/** The island's pairing code, typed: eight letters and digits in two groups, each landing in its own glass cell. */
function CodeEntry({ connecting, error, onScan, onCode }: { connecting: boolean; error: string | null; onScan: () => void; onCode: (c: string) => void }) {
  const [text, setText] = useState(''); const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => input.current?.focus(), 350); return () => clearTimeout(t); }, []);
  useEffect(() => { if (error) setText(''); }, [error]);
  return (
    <>
      <div class="t-title">Pair with a code</div>
      <div class="t-caption muted center" style={{ marginTop: 4 }}>On your PC, open the island’s Shelf › Nearby › Pair with a code, then type the code it shows. Any network works.</div>
      <label class="row code-cells" style={{ marginTop: 22, position: 'relative' }} onClick={() => input.current?.focus()}>
        <input ref={input} value={text} disabled={connecting} inputMode="text" autoCapitalize="characters" autoComplete="one-time-code" autoCorrect="off" spellcheck={false} enterKeyHint="go" aria-label="Pairing code"
          class="code-input" maxLength={9}
          onInput={(e) => {
            const clean = e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); setText(clean); e.currentTarget.value = clean;
            if (clean.length > text.length) haptic('tick');
            if (clean.length === 8 && !connecting) onCode(clean);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.length === 8) onCode(text); }} />
        {Array.from({ length: 8 }, (_, i) => <Fragment key={i}>
          {i === 4 && <span class="t-headline faint" style={{ padding: '0 6px' }}>–</span>}
          <span class={`code-cell ${glassClass('control', 'inner', i === text.length && !connecting)}`}>{text[i] && <span class="t-headline pop" style={{ fontWeight: 600 }}>{text[i]}</span>}</span>
        </Fragment>)}
      </label>
      <div style={{ height: 20 }} />
      {connecting ? <div class="row gap10"><Radar size={28} /><span class="t-caption muted">Finding your PC over the internet…</span></div>
        : error ? <div class="t-caption danger center">{error}</div> : <div class="t-caption faint center">Encrypted end to end. The relay passes sealed bytes only.</div>}
      <div style={{ height: 16 }} />
      <GlassButton onClick={onScan} pad="11px 18px"><Icon name="qrCodeScanner" size={18} /><span class="t-caption">Scan instead</span></GlassButton>
    </>
  );
}

/** The camera, reading the island's QR code (a pairing link) as soon as it's in view. */
function ScanPane({ onLink, onType }: { onLink: (l: { code: string; key: Uint8Array | null }) => void; onType: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'looking' | 'denied' | 'wrong'>('starting');
  useEffect(() => {
    let stream: MediaStream | null = null; let stop = false; let timer = 0 as unknown as ReturnType<typeof setTimeout>;
    void (async () => {
      const { default: jsQR } = await import('jsqr');
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
      catch { if (!stop) setState('denied'); return; }
      if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current!; v.srcObject = stream; v.setAttribute('playsinline', ''); try { await v.play(); } catch { /* shown anyway */ }
      setState('looking');
      const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      let wrongAt = 0;
      const look = () => {
        if (stop) return;
        if (v.videoWidth) {
          const s = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight)); canvas.width = Math.round(v.videoWidth * s); canvas.height = Math.round(v.videoHeight * s);
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const found = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
          if (found?.data) {
            const link = pairLink(found.data);
            if (link) { stop = true; stream?.getTracks().forEach((t) => t.stop()); onLink(link); return; }
            if (Date.now() - wrongAt > 2500) { wrongAt = Date.now(); setState('wrong'); setTimeout(() => !stop && setState('looking'), 2000); }
          }
        }
        timer = setTimeout(look, 110);
      };
      look();
    })();
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return (
    <>
      <div class="t-title">Scan the QR code</div>
      <div class="t-caption muted center" style={{ marginTop: 4 }}>On your PC: the island’s Shelf › Nearby › Pair with a code</div>
      <div class="scanner" style={{ marginTop: 16 }}>
        <video ref={video} muted playsInline autoPlay aria-label="The camera" />
        <div class="finder"><i /><i /><i /><i /><b /></div>
        {state === 'starting' && <div class="scanner-note t-caption">Opening the camera…</div>}
        {state === 'denied' && <div class="scanner-note col" style={{ gap: 8 }}><Icon name="photoCamera" size={28} /><span class="t-caption">Allow the camera for this site (Settings › Apps › Safari › Camera), or type the code</span></div>}
        {state === 'wrong' && <div class="scanner-note t-caption">That isn’t an island’s pairing code</div>}
      </div>
      <div style={{ height: 16 }} />
      <div class="row gap10">
        <GlassButton onClick={onType} pad="11px 18px"><Icon name="keyboard" size={18} /><span class="t-caption">Type the code</span></GlassButton>
        <GlassButton onClick={async () => { try { const l = pairLink(await navigator.clipboard.readText()); if (l) onLink(l); else setState('wrong'); } catch { /* not allowed */ } }} pad="11px 18px"><Icon name="contentPaste" size={18} /><span class="t-caption">Paste a link</span></GlassButton>
      </div>
    </>
  );
}
