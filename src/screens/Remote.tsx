// Your PC from your phone: what plays there (its cover, where it is, its lyrics, the controls), its sound on a dial, and
// quick actions (the clipboard, a link, lock, find it, the trackpad, its screen, this iPhone's camera there).
import { useMemo, useState } from 'preact/hooks';
import type { Lyrics, PcStatus, PeerView } from '../link/island';
import { positionNow } from '../link/island';
import { Proto } from '../link/proto';
import { command, copyFromPc, f64, firstLine, pasteOnPc, refreshStatus, request, ringPc, say } from '../state/hub';
import { skyOf } from '../ui/ambient';
import { Equalizer, GlassButton, GlassChip, GlassIconButton, GlassPanel, GlassSlider, GlassTile, Icon, LiveDot, PlayPause, ScreenTitle, SectionLabel, StepButton, clock, quality } from '../ui/components';
import { VolumeDial } from '../ui/dial';
import { LyricsView, synced } from '../ui/lyrics';
import { haptic, useNow } from '../ui/motion';
import { cameraShowing } from './camera';

export function RemoteScreen({ pc, status, error, cover, lyrics, onPair }: { pc: PeerView | null; status: PcStatus | null; error: string | null; cover: string | null; lyrics: Lyrics | null; onPair: () => void }) {
  if (!pc) return <Welcome onPair={onPair} />;
  const sky = skyOf(status?.weather ?? '');
  return (
    <>
      <ScreenTitle title={pc.name} over={!pc.online ? 'Your PC  ·  away' : `Your PC  ·  ${quality(pc).text.toLowerCase()}`} trailing={<LiveDot on={pc.online} />} />
      {status && (
        <div class="hscroll" style={{ paddingBottom: 14 }}>
          {status.batteryPresent && status.battery >= 0 && <GlassChip label={`${status.battery}%`} icon={status.charging ? 'batteryChargingFull' : 'batteryFull'} iconTint={status.charging ? 'var(--good)' : status.battery <= 20 ? 'var(--danger)' : undefined} />}
          {status.cpu >= 0 && status.cpu <= 100 && <GlassChip label={`CPU ${status.cpu}%`} icon="memory" onClick={() => request('island')} />}
          {status.weather.trim() && <GlassChip label={status.weather} icon={sky === 'storm' ? 'thunderstorm' : sky === 'rain' || sky === 'drizzle' ? 'umbrella' : sky === 'snow' ? 'acUnit' : /clear/i.test(status.weather) ? 'wbSunny' : 'cloud'} />}
        </div>
      )}
      <NowPlaying pc={pc} status={status} error={error} cover={cover} lyrics={lyrics} />
      {status && <><SectionLabel text={`Sound on ${pc.name}`} /><SoundPanel pc={pc} status={status} /></>}
      <SectionLabel text="Quick actions" />
      <QuickActions pc={pc} />
      <div style={{ height: 24 }} />
    </>
  );
}

function Welcome({ onPair }: { onPair: () => void }) {
  return (
    <div class="col" style={{ alignItems: 'center', paddingTop: 40 }}>
      <div class="glass island capsule welcome-island" style={{ width: 210, height: 62, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, var(--accent), var(--accent2))' }} />
        <Equalizer playing width={44} height={24} bars={5} />
      </div>
      <h1 class="t-title center" style={{ margin: '38px 0 0' }}>Your island, in your hand</h1>
      <p class="t-body muted center" style={{ margin: '10px 8px 0' }}>Control what plays on your PC, send photos and files both ways, see its screen and use it from here, and find this iPhone from your PC.</p>
      <GlassButton onClick={onPair} prominent pad="16px 30px" style={{ marginTop: 30 }}><Icon name="laptop" /><span class="t-strong">Pair with your PC</span></GlassButton>
      <GlassPanel class="col" style={{ width: '100%', marginTop: 26, padding: 18 }}>
        <span class="t-micro muted" style={{ marginBottom: 8 }}>On your PC</span>
        {['Open Arnav Island’s Settings › Privacy & productivity', 'Turn on “Share with my PCs” and “Reach my PCs anywhere”', 'Open the island’s Shelf › Nearby › Pair with a code, then scan its QR code here'].map((s, i) => (
          <div key={i} class="row" style={{ padding: '5px 0', gap: 12 }}>
            <span style={{ width: 24, height: 24, borderRadius: 12, background: 'color-mix(in srgb, var(--accent) 20%, transparent)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }} class="t-caption">{i + 1}</span>
            <span class="t-body">{s}</span>
          </div>
        ))}
      </GlassPanel>
    </div>
  );
}

/**
 * Now playing on the PC. The cover shrinks back a little while paused, leans with the phone and lifts off the card over a
 * shadow that slides the other way; tapped, it turns over to the song's lyrics. The play button morphs; the scrubber
 * answers the finger at once, ticking at each lyric line, and tells the PC as it goes.
 */
function NowPlaying({ pc, status, error, cover, lyrics }: { pc: PeerView; status: PcStatus | null; error: string | null; cover: string | null; lyrics: Lyrics | null }) {
  const [playingAsked, setPlayingAsked] = useState<[boolean, number] | null>(null);
  const [seekAsked, setSeekAsked] = useState<[number, number] | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const playing = playingAsked && Date.now() - playingAsked[1] < 1800 ? playingAsked[0] : status?.playing === true;
  const now = useNow(playing ? 250 : 1000);
  const ticks = useMemo(() => {
    const d = status?.duration ?? 0; const l = lyrics?.lines;
    return l && d > 0 && lyrics?.state === 2 && synced(l) ? l.map((x) => x.time / d) : null;
  }, [lyrics, status?.duration]);
  if (!status || !status.available) {
    return (
      <GlassPanel class="col" style={{ alignItems: 'center', padding: 26, textAlign: 'center' }}>
        <span style={{ width: 84, height: 84, borderRadius: 24, background: 'color-mix(in srgb, var(--accent) 14%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Equalizer playing={false} width={40} height={26} bars={5} /></span>
        <div class="t-headline" style={{ marginTop: 16 }}>{!status ? error ?? `Connecting to ${pc.name}…` : 'Nothing playing'}</div>
        <div class="t-caption muted" style={{ marginTop: 6 }}>{!status ? 'The remote shows what plays on your PC' : `Play something on ${pc.name} and it shows here`}</div>
      </GlassPanel>
    );
  }
  const duration = Math.max(0, status.duration);
  const position = seekAsked && now - seekAsked[1] < 2500 ? seekAsked[0] : playingAsked && !playing ? status.position : positionNow(status, now);
  const fraction = scrubbing ?? (duration > 0 ? position / duration : 0);
  const shownPos = scrubbing !== null ? scrubbing * duration : position;
  const seek = (to: number) => { if (!status.canSeek) return; setSeekAsked([to, Date.now()]); void command(Proto.CMD_SEEK, f64(to)); };
  const flip = () => { if (pc.revision >= 3) { haptic('tick'); setFlipped(!flipped); } };
  return (
    <GlassPanel class="col" style={{ alignItems: 'center', padding: 20 }}>
      <div class="cover-stage" style={{ '--cover-scale': playing ? 1 : 0.9 }}>
        <div class="cover-shadow" />
        <div class="cover-light" />
        <div class={`cover-card ${flipped ? 'flipped' : ''}`} role="button" tabIndex={0} aria-label={flipped ? 'Lyrics. Tap to show the cover' : `Cover of ${status.title}. Tap for the lyrics`} onClick={flip}
          onKeyDown={(e) => { if (e.key === 'Enter') flip(); }}>
          <div class="cover-front">
            {cover ? <img key={cover} src={cover} alt="" class="cover-img" /> : <span class="cover-none"><Icon name="musicNote" size={72} /></span>}
            <div class="cover-glint" />
          </div>
          <div class="cover-back">
            {cover && <img src={cover} alt="" class="cover-blur" />}
            <div class="cover-dim" />
            {flipped && <LyricsView lyrics={lyrics} position={() => positionNow(status)} playing={playing} pcName={pc.name} onSeek={seek} />}
          </div>
        </div>
      </div>
      <Marquee text={status.title} />
      <div class="t-body muted ellipsis" style={{ maxWidth: '100%' }}>{[status.artist, status.app].filter((s) => s.trim()).join('  ·  ')}</div>
      <div style={{ height: 16 }} />
      <GlassSlider value={fraction} onChange={setScrubbing} onDone={(f) => { setScrubbing(null); if (duration > 0) seek(f * duration); }} color="var(--scrub)" height={6} description={`Position in ${status.title}`} ticks={ticks} class="full" />
      <div class="row t-caption muted tabular" style={{ width: '100%' }}><span>{clock(shownPos)}</span><span class="grow" /><span>{duration > 0 ? '-' + clock(duration - shownPos) : ''}</span></div>
      <div class="row" style={{ width: '100%', justifyContent: 'space-evenly', marginTop: 10 }}>
        <GlassIconButton icon="skipPrevious" description="Previous" onClick={() => void command(Proto.CMD_MEDIA, Uint8Array.of(2))} size={60} iconSize={30} enabled={status.canPrevious} />
        <GlassButton onClick={() => { setPlayingAsked([!playing, Date.now()]); void command(Proto.CMD_MEDIA, Uint8Array.of(1)); }} prominent enabled={status.canToggle} pad="0" style={{ width: 84, height: 84 }} description={playing ? 'Pause' : 'Play'}>
          <PlayPause playing={playing} color="var(--play)" size={34} />
        </GlassButton>
        <GlassIconButton icon="skipNext" description="Next" onClick={() => void command(Proto.CMD_MEDIA, Uint8Array.of(3))} size={60} iconSize={30} enabled={status.canNext} />
      </div>
      {pc.revision >= 3 && <div style={{ marginTop: 14 }}><GlassChip label={flipped ? 'Cover' : 'Lyrics'} icon={flipped ? 'album' : 'lyrics'} selected={flipped} onClick={() => setFlipped(!flipped)} /></div>}
    </GlassPanel>
  );
}

/** The song's title, sliding along when it's longer than the card. */
function Marquee({ text }: { text: string }) {
  const [over, setOver] = useState(false);
  return (
    <div class={`marquee t-headline ${over ? 'over' : ''}`} style={{ marginTop: 22 }} ref={(el) => { if (el) { const o = el.scrollWidth > el.clientWidth + 2 || (el.firstElementChild as HTMLElement | null)?.scrollWidth! > el.clientWidth + 2; if (o !== over) setOver(o); } }}>
      <span class={over ? 'run' : ''} key={text}>{text}{over && <span aria-hidden="true" style={{ paddingLeft: 48 }}>{text}</span>}</span>
    </div>
  );
}

/** The PC's sound: a dial to twist (a tick at every 5%), its middle to mute, steps, and a few levels a tap away. */
function SoundPanel({ pc, status }: { pc: PeerView; status: PcStatus }) {
  const [asked, setAsked] = useState<[number, number] | null>(null);
  const now = useNow(400, !!asked);
  const volume = asked && now - asked[1] < 1600 ? asked[0] : status.volume / 100;
  const last = useMemo(() => ({ at: 0 }), []);
  const send = (v: number, final: boolean) => {
    setAsked([v, Date.now()]);
    if (final || Date.now() - last.at > 110) { last.at = Date.now(); void command(Proto.CMD_VOLUME, Uint8Array.of(Math.floor(v * 100 + 0.5)), !final); }
  };
  const pct = Math.floor(volume * 100 + 0.5);
  return (
    <GlassPanel class="row" style={{ padding: '16px 14px', gap: 14 }}>
      <VolumeDial value={volume} muted={status.muted} onChange={(v) => send(v, false)} onDone={(v) => send(v, true)} onMute={() => void command(Proto.CMD_MUTE, Uint8Array.of(2)).then(() => refreshStatus())} size={168} description={`Volume on ${pc.name}`} />
      <div class="col grow">
        <div class="t-headline tabular">{status.muted ? 'Muted' : `${pct}%`}</div>
        <div class="t-caption muted">Twist the dial, or step it; tap its middle to mute</div>
        <div class="row gap10" style={{ marginTop: 10 }}>
          <StepButton icon="remove" description={`Volume down on ${pc.name}`} onStep={() => send(Math.max(0, Math.min(100, pct - 5)) / 100, true)} />
          <StepButton icon="add" description={`Volume up on ${pc.name}`} onStep={() => send(Math.max(0, Math.min(100, pct + 5)) / 100, true)} />
        </div>
        <div class="row gap6" style={{ marginTop: 10 }}>
          {[25, 50, 75].map((level) => <GlassChip key={level} label={String(level)} selected={!status.muted && pct === level} onClick={() => send(level / 100, true)} />)}
        </div>
      </div>
    </GlassPanel>
  );
}

function QuickActions({ pc }: { pc: PeerView }) {
  const showing = cameraShowing.value;
  const update = (what: string, v: string) => say({ kind: 'failed', title: `Update Arnav Island on ${pc.name}`, detail: `${what} needs version ${v} or later` });
  return (
    <div class="col gap12">
      <div class="grid2">
        <GlassTile icon="contentPaste" title="Paste on PC" detail="Your iPhone’s clipboard, there" onClick={async () => {
          let text = '';
          try { text = await navigator.clipboard.readText(); } catch { say({ kind: 'info', title: 'Allow pasting to use this', detail: 'Tap Paste when your iPhone asks' }); return; }
          await pasteOnPc(text);
        }} />
        <GlassTile icon="contentCopy" title="Copy from PC" detail={`${pc.name}’s clipboard, here`} onClick={async () => {
          const text = await copyFromPc(); if (!text) return;
          try { await navigator.clipboard.writeText(text); say({ kind: 'clipboard', title: `Copied from ${pc.name}`, detail: firstLine(text) }); }
          catch { request('clip:' + text); }
        }} />
        <GlassTile icon="language" title="Open a link" detail={`In ${pc.name}’s browser`} tint="var(--accent2)" onClick={() => request('link')} />
        <GlassTile icon="lock" title={`Lock ${pc.name}`} detail="Right away" tint="var(--warn)" onClick={async () => { if ((await command(Proto.CMD_LOCK))?.status === Proto.OK) say({ kind: 'info', title: `Locked ${pc.name}` }); }} />
        <GlassTile icon="notificationsActive" title={`Find ${pc.name}`} detail="It chimes and lights up" tint="var(--warn)" onClick={() => void ringPc()} />
        <GlassTile icon="mouse" title="Trackpad" detail="And the keyboard" tint="var(--accent2)" onClick={() => { if (pc.revision < 3 && pc.online) update('The trackpad', '0.20'); else request('trackpad'); }} />
        <GlassTile icon="desktopWindows" title={`${pc.name}’s screen`} detail="Here, and touch it" onClick={() => { if (pc.revision < 7 && pc.online) update('Its screen', '0.24'); else request('screen'); }} />
        <GlassTile icon="photoCamera" title={showing ? 'Stop the camera' : `Camera on ${pc.name}`} detail={showing ? `In a window on ${showing}` : 'This iPhone’s camera, in a window there'} tint="var(--accent2)"
          onClick={() => { if (showing) request('camera-stop'); else if (pc.revision < 7 && pc.online) update('The camera there', '0.24'); else request('camera-live'); }} />
      </div>
    </div>
  );
}
