// This iPhone, your PCs (anywhere, through the relay), what the island may show of it, its security (Face ID, its key),
// the app on the Home Screen, and how the app looks.
import { useEffect, useState } from 'preact/hooks';
import { hex } from '../link/bytes';
import { keyPrint } from '../link/crypto';
import type { PeerView } from '../link/island';
import { remoteCapable } from '../link/island';
import { idb } from '../state/db';
import { platform, standalone } from '../state/device';
import { failure, forget, getLink, internet, choose, prefs, rename, request, running, say, sendDetails, setPrefs } from '../state/hub';
import { disableLock, enableLock, lockAvailable, lockConfig } from '../state/lock';
import { GlassChip, GlassPanel, GlassRow, GlassSwitch, Hairline, Icon, LiveDot, ScreenTitle, SectionLabel, quality } from '../ui/components';
import { askTilt, haptic, setHaptics, stopTilt } from '../ui/motion';

export const VERSION = '1.0.0';

export function DevicesScreen({ peers, pc, onPair, onScan }: { peers: PeerView[]; pc: PeerView | null; onPair: () => void; onScan: () => void }) {
  const p = prefs.value; const paired = peers.filter((x) => x.paired);
  const [lock, setLock] = useState<{ on: boolean; prf: boolean } | null>(null); const [canLock, setCanLock] = useState(false);
  const [print, setPrint] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    void lockConfig().then((c) => setLock(c?.on ? { on: true, prf: c.prf } : { on: false, prf: false })); void lockAvailable().then(setCanLock);
    const pub = getLink()?.publicKey; if (pub?.length) void keyPrint(pub).then((k) => setPrint(hex(k).toUpperCase().match(/.{4}/g)!.join(' ')));
  }, [running.value]);
  const relays = getLink()?.relayBrokersUp ?? 0;
  const kind = platform().kind;
  return (
    <>
      <ScreenTitle title="Devices" over="Arnav Island" />
      <GlassPanel class="row" style={{ padding: 18, gap: 14 }}>
        <span class="rowicon" style={{ width: 52, height: 52, borderRadius: 16 }}><Icon name={kind === 'iPad' || kind === 'Mac' ? 'tabletMac' : 'phoneIphone'} size={28} /></span>
        <div class="col grow">
          {editing ? <input autoFocus value={p.name} maxLength={40} class="t-headline" aria-label="This device's name" style={{ background: 'none', border: 0, padding: 0, minWidth: 0, width: '100%' }}
            onBlur={(e) => { rename(e.currentTarget.value); setEditing(false); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} />
            : <button type="button" class="row gap6" style={{ textAlign: 'left' }} onClick={() => setEditing(true)} aria-label="Rename this device"><span class="t-headline ellipsis">{p.name}</span><span class="faint"><Icon name="edit" size={16} /></span></button>}
          <span class={`t-caption ${failure.value ? 'danger' : 'muted'}`}>{failure.value ?? (!running.value ? 'Starting…' : internet.value ? `Reachable by your PCs anywhere${relays > 1 ? `, through ${relays} free relays` : ''}` : 'Connecting to the internet…')}</span>
        </div>
        <LiveDot on={running.value && internet.value && !failure.value} />
      </GlassPanel>

      <SectionLabel text="Your PCs" />
      <GlassPanel>
        {paired.map((x, i) => <div key={x.id}>{i > 0 && <Hairline />}<PcRow p={x} chosen={x.id === pc?.id} /></div>)}
        {paired.length > 0 && <Hairline />}
        <GlassRow icon="qrCodeScanner" title="Scan the QR code" detail="On your PC: the island’s Shelf › Nearby › Pair with a code. Any network works" onClick={onScan} />
        <Hairline />
        <GlassRow icon="keyboard" title="Type a code" detail="The eight letters and digits the island shows" onClick={onPair} />
      </GlassPanel>

      <SectionLabel text="On your PC’s island" />
      <GlassPanel>
        <GlassRow icon="phoneIphone" title={`Your ${kind === 'Device' ? 'device' : kind}’s details`} detail="Its system, screen and room, in the island’s view of this device" trailing={<GlassSwitch checked={p.details} label="Details" onChange={(on) => { setPrefs({ details: on }); if (on) sendDetails(true); }} />} />
        <Hairline />
        <GlassRow icon="download" title="Accept files from my PCs" detail="Without asking each time" trailing={<GlassSwitch checked={p.autoAccept} label="Accept files" onChange={(on) => setPrefs({ autoAccept: on })} />} />
      </GlassPanel>

      <SectionLabel text="Security" />
      <GlassPanel>
        <GlassRow icon="face" title={kind === 'Mac' ? 'Touch ID' : 'Face ID'} detail={!canLock ? 'Not available in this browser' : lock?.on ? (lock.prf ? 'On: your paired PCs are sealed until you unlock with Face ID' : 'On: Face ID is asked for when the app opens') : 'Ask for Face ID before the app opens. Your paired PCs stay sealed until you do'}
          trailing={<GlassSwitch checked={!!lock?.on} enabled={canLock && lock !== null} label="Face ID" onChange={async (on) => {
            if (on) { const r = await enableLock(p.name); if (r.ok) { setLock({ on: true, prf: r.prf }); haptic('confirm'); say({ kind: 'lock', title: 'Face ID is on', detail: r.prf ? 'Your pairings are sealed by it' : 'It’s asked for when the app opens' }); } else say({ kind: 'failed', title: 'Face ID stayed off', detail: r.why }); }
            else { if (await disableLock()) { setLock({ on: false, prf: false }); say({ kind: 'lock', title: 'Face ID is off' }); } }
          }} />} />
        {lock?.on && <><Hairline /><GlassRow icon="timer" title="Lock after" detail="Leaving the app for this long asks for Face ID again" trailing={
          <div class="row gap6">{[[0, 'Now'], [60, '1 min'], [300, '5 min']].map(([v, l]) => <GlassChip key={v} label={String(l)} selected={p.autoLock === v} onClick={() => setPrefs({ autoLock: Number(v) })} />)}</div>} /></>}
        <Hairline />
        <GlassRow icon="key" title="This device’s key" detail={print ? `Fingerprint ${print}. Its private half never leaves this device: not even this app can read it` : 'Making it…'} />
        <Hairline />
        <GlassRow icon="cleaningServices" title="Erase this device" detail="Forgets every PC and everything kept here. Pair again to use it" tint="var(--danger)" onClick={() => request('erase')} />
      </GlassPanel>

      <SectionLabel text={`On this ${kind === 'Device' ? 'device' : kind}`} />
      <GlassPanel>
        <GlassRow icon="addToHomeScreen" title={standalone() ? 'On your Home Screen' : 'Add to Home Screen'} detail={standalone() ? 'Opens full screen, like an app, and works offline' : 'A full-screen app with its own icon, that opens instantly and works offline'} onClick={standalone() ? undefined : () => request('install')} trailing={!standalone() && <span class="muted"><Icon name="chevronRight" /></span>} />
        <Hairline />
        <GlassRow icon="autoAwesome" title="Shortcuts and Siri" detail="Lock your PC, find it or open a link from the Shortcuts app, Siri or your Home Screen" onClick={() => request('shortcuts')} trailing={<span class="muted"><Icon name="chevronRight" /></span>} />
        {(kind === 'iPad' || kind === 'Mac') && <><Hairline /><GlassRow icon="keyboardCommandKey" title="Keyboard shortcuts" detail="Space plays, arrows change the volume, 1 to 5 switch tabs, ⌘K runs a command" onClick={() => request('keys')} trailing={<span class="muted"><Icon name="chevronRight" /></span>} /></>}
      </GlassPanel>

      <SectionLabel text="Appearance" />
      <div class="row gap8">
        {([['Automatic', 'brightnessAuto'], ['Dark', 'darkMode'], ['Light', 'lightMode']] as const).map(([label, icon], i) => <GlassChip key={label} label={label} icon={icon} selected={p.appearance === i} onClick={() => setPrefs({ appearance: i })} />)}
      </div>
      <GlassPanel style={{ marginTop: 10 }}>
        <GlassRow icon="blurOn" title="Liquid glass" detail={p.glass ? 'Surfaces frost what’s behind them and catch the light' : 'Off: solid surfaces, calmer and lighter on the battery'} trailing={<GlassSwitch checked={p.glass} label="Liquid glass" onChange={(on) => setPrefs({ glass: on })} />} />
        <Hairline />
        <GlassRow icon="screenRotation" title="Light follows your tilt" detail="The rim of light on the glass and the cover lean as you tilt the phone" trailing={<GlassSwitch checked={p.tilt} label="Tilt" onChange={async (on) => { if (on) { if (await askTilt()) setPrefs({ tilt: true }); else say({ kind: 'info', title: 'Motion isn’t allowed', detail: 'Allow Motion & Orientation for this site in Safari' }); } else { stopTilt(); setPrefs({ tilt: false }); } }} />} />
        <Hairline />
        <GlassRow icon="umbrella" title="Weather on the glass" detail="Rain, snow or fog on the app when that’s the weather where your PC is" trailing={<GlassSwitch checked={p.weather} label="Weather" onChange={(on) => setPrefs({ weather: on })} />} />
        <Hairline />
        <GlassRow icon="touchApp" title="Haptics" detail="A light tick as you touch the controls" trailing={<GlassSwitch checked={p.haptics} label="Haptics" onChange={(on) => { setHaptics(on); setPrefs({ haptics: on }); }} />} />
      </GlassPanel>

      <SectionLabel text="Privacy" />
      <GlassPanel class="col" style={{ padding: 18 }}>
        <div class="row gap10"><span class="good"><Icon name="shield" size={20} /></span><span class="t-strong">Only between your own devices</span></div>
        <div class="t-caption muted" style={{ marginTop: 6 }}>This app talks to your PCs through free public relays (MQTT over TLS), sealed end to end: a relay sees only random-looking topics and encrypted bytes, never what they carry. Every connection is encrypted with ECDH P-256 and AES-256-GCM, only with devices you paired. This site has no server of its own, no account, no cookies, no analytics and no third-party code; your keys and pairings stay on this device, sealed.</div>
      </GlassPanel>

      <SectionLabel text="About" />
      <GlassPanel>
        <GlassRow icon="newReleases" title={`Arnav Island for iPhone ${VERSION}`} detail="What it does, and what’s new" onClick={() => request('whatsnew')} trailing={<span class="muted"><Icon name="chevronRight" /></span>} />
        <Hairline />
        <GlassRow icon="openInNew" title="Arnav Island on GitHub" detail="The island for Windows, the Android app and this site" onClick={() => window.open('https://github.com/Arnav-Dugad/arnav-island-web', '_blank', 'noopener,noreferrer')} />
      </GlassPanel>
      <div style={{ height: 24 }} />
    </>
  );
}

function PcRow({ p, chosen }: { p: PeerView; chosen: boolean }) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (!confirm) return; const t = setTimeout(() => setConfirm(false), 3500); return () => clearTimeout(t); }, [confirm]);
  const q = quality(p);
  return <GlassRow icon={p.phone ? 'phoneIphone' : 'laptop'} title={p.name}
    detail={[q.text, chosen ? 'Remote and sends go here' : '', p.online && !remoteCapable(p) ? 'Update its island for the remote' : ''].filter(Boolean).join('  ·  ')}
    tint={p.online ? 'var(--good)' : 'var(--faint)'} onClick={() => { if (!p.phone) choose(p.id); }} ring={p.online ? q : null}
    trailing={<button type="button" class={`t-caption ${confirm ? 'danger' : 'muted'}`} style={{ padding: 8, borderRadius: 10 }} onClick={(e) => { e.stopPropagation(); haptic('tick'); if (confirm) void forget(p.id); else setConfirm(true); }}>{confirm ? 'Forget?' : 'Forget'}</button>} />;
}

/** Everything this device keeps, gone: its key, its pairings, its history. */
export async function eraseAll() {
  getLink()?.stop();
  try { const regs = await navigator.serviceWorker?.getRegistrations(); for (const r of regs ?? []) await r.update(); } catch { /* none */ }
  await idb.wipe();
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* none */ }
  try { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); } catch { /* none */ }
  location.replace('/');
}
