// The island at the top of the app, as on the PC: a dark glass capsule. At rest it shows what plays on your PC (its cover
// and level bars) or who is here; it widens for a transfer (with its ring), and drops open for a moment to say what just
// happened, then settles back. Tapped while music plays, it melts open into the song's own card and flows back when
// tapped again or anywhere else.
import { useState } from 'preact/hooks';
import type { PcStatus } from '../link/island';
import { positionNow } from '../link/island';
import { Proto } from '../link/proto';
import { type Banner, type BannerKind, type Transfer, command, refreshStatus } from '../state/hub';
import { Equalizer, Icon, type IconName, LiveDot, PlayPause, ProgressRing, type Quality, QualityRing, clock } from './components';
import { haptic, useNow } from './motion';

export function bannerIcon(kind: BannerKind): [IconName, string] {
  switch (kind) {
    case 'received': return ['download', 'var(--good)'];
    case 'sent': return ['checkCircle', 'var(--good)'];
    case 'failed': return ['errorOutline', 'var(--danger)'];
    case 'paired': return ['laptop', 'var(--accent)'];
    case 'music': return ['musicNote', 'var(--accent)'];
    case 'ring': return ['notificationsActive', 'var(--warn)'];
    case 'update': return ['systemUpdate', 'var(--accent)'];
    case 'clipboard': return ['contentPaste', 'var(--accent)'];
    case 'photo': return ['photoCamera', 'var(--accent)'];
    case 'internet': return ['public', 'var(--accent)'];
    case 'lock': return ['face', 'var(--accent)'];
    default: return ['info', 'var(--accent)'];
  }
}

export function MiniIsland({ status, cover, pcName, online, banner, transfer, onClick, expanded, internet, quality }: {
  status: PcStatus | null; cover: string | null; pcName: string | null; online: boolean; banner: Banner | null; transfer: Transfer | null; onClick: () => void; expanded: boolean; internet: boolean; quality: Quality | null;
}) {
  const mode = banner ? 2 : expanded && status?.available ? 3 : transfer ? 1 : 0;
  const width = mode === 3 || mode === 2 ? 360 : mode === 1 ? 250 : status?.available ? 190 : 150;
  const height = mode === 3 ? 190 : mode === 2 ? 74 : 38;
  const corner = mode === 3 ? 46 : mode === 2 ? 30 : 19;
  const label = banner ? `${banner.title}. ${banner.detail ?? ''}` : status?.available ? `${status.title} on ${status.pcName}` : pcName ?? 'No PC yet';
  const faceKey = `${mode}:${banner?.title ?? ''}`;
  return (
    <div class="mini-island glass island" role="button" tabIndex={0} aria-label={label} aria-live="polite"
      style={{ width: `min(${width}px, calc(100% - 32px))`, height, borderRadius: corner }}
      onClick={(e) => { if ((e.target as HTMLElement).closest('.island-control')) return; haptic('tick'); onClick(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}>
      <div class="face" key={faceKey}>
        {mode === 2 && banner && <BannerFace banner={banner} />}
        {mode === 3 && status && <IslandPlayer status={status} cover={cover} pcName={pcName ?? ''} />}
        {mode === 1 && transfer && <TransferFace t={transfer} />}
        {mode === 0 && (
          <div class="row" style={{ width: '100%', height: '100%', padding: '0 8px' }}>
            {status?.available ? <>
              {cover ? <img src={cover} alt="" style={{ width: 24, height: 24, borderRadius: 7, objectFit: 'cover' }} /> : <span style={{ width: 24, height: 24, borderRadius: 7, background: 'color-mix(in srgb, var(--accent) 30%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}><Icon name="musicNote" size={14} /></span>}
              <span class="t-caption ellipsis grow" style={{ color: 'rgba(255,255,255,.86)', marginLeft: 8 }}>{status.title}</span>
              <span style={{ marginLeft: 6, marginRight: 4 }}><Equalizer playing={status.playing} /></span>
            </> : <>
              <LiveDot on={online} size={7} />
              {online && internet && quality && <span style={{ position: 'relative', width: 13, height: 13, marginRight: 5, flex: 'none' }} aria-label={quality.text}><QualityRing q={quality} size={13} stroke={1.6} /></span>}
              <span class="t-caption ellipsis" style={{ color: 'rgba(255,255,255,.8)', flex: '0 1 auto' }}>{pcName ?? 'No PC yet'}</span>
              <span style={{ width: 10, flex: 'none' }} />
            </>}
          </div>
        )}
      </div>
    </div>
  );
}

function BannerFace({ banner }: { banner: Banner }) {
  const [icon, tint] = bannerIcon(banner.kind);
  return (
    <div class="row" style={{ width: '100%', height: '100%', padding: '0 14px', gap: 12 }}>
      <span style={{ width: 44, height: 44, borderRadius: 22, background: `color-mix(in srgb, ${tint} 20%, transparent)`, color: tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Icon name={icon} size={23} /></span>
      <span class="col grow">
        <span class="t-strong ellipsis" style={{ color: '#fff' }}>{banner.title}</span>
        {banner.detail && <span class="t-caption clamp2" style={{ color: 'rgba(255,255,255,.66)' }}>{banner.detail}</span>}
      </span>
    </div>
  );
}

function TransferFace({ t }: { t: Transfer }) {
  const f = t.total > 0 ? t.done / t.total : 0;
  return (
    <div class="row" style={{ width: '100%', height: '100%', padding: '0 10px', gap: 8 }}>
      <span style={{ color: 'var(--accent)' }}><Icon name={t.outgoing ? 'send' : 'download'} size={17} /></span>
      <span class="t-caption ellipsis grow" style={{ color: '#fff' }}>{t.title}</span>
      <span class="t-caption tabular" style={{ color: 'rgba(255,255,255,.7)' }}>{Math.floor(f * 100)}%</span>
      <ProgressRing fraction={f} track="rgba(255,255,255,.16)" size={22} stroke={3} />
    </div>
  );
}

/** The island opened into the song's card: the cover, the song, where it is, and the controls. */
function IslandPlayer({ status, cover, pcName }: { status: PcStatus; cover: string | null; pcName: string }) {
  const [asked, setAsked] = useState<[boolean, number] | null>(null);
  const playing = asked && Date.now() - asked[1] < 1800 ? asked[0] : status.playing;
  const now = useNow(playing ? 400 : 1000);
  const duration = Math.max(0, status.duration); const position = asked && !playing ? status.position : positionNow(status, now);
  const f = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
  const media = (b: number) => void command(Proto.CMD_MEDIA, Uint8Array.of(b)).then(() => refreshStatus());
  return (
    <div class="col" style={{ width: '100%', height: '100%', padding: '18px 20px' }}>
      <div class="row" style={{ gap: 14 }}>
        <span style={{ width: 64, height: 64, borderRadius: 17, overflow: 'hidden', background: 'color-mix(in srgb, var(--accent) 30%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flex: 'none' }}>
          {cover ? <img src={cover} alt={`Cover of ${status.title}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="musicNote" size={28} />}
        </span>
        <span class="col grow">
          <span class="t-micro ellipsis" style={{ color: 'rgba(255,255,255,.45)' }}>ON {pcName.toUpperCase()}</span>
          <span class="t-strong ellipsis" style={{ color: '#fff' }}>{status.title}</span>
          <span class="t-caption ellipsis" style={{ color: 'rgba(255,255,255,.66)' }}>{status.artist || status.app}</span>
        </span>
        <Equalizer playing={playing} width={22} height={16} />
      </div>
      <div style={{ marginTop: 14, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.16)', overflow: 'hidden' }}><div style={{ width: `${f * 100}%`, height: '100%', background: 'rgba(255,255,255,.92)' }} /></div>
      <div class="row t-caption tabular" style={{ marginTop: 4, color: 'rgba(255,255,255,.55)' }}><span>{clock(position)}</span><span class="grow" /><span>{duration > 0 ? '-' + clock(duration - position) : ''}</span></div>
      <div class="row" style={{ justifyContent: 'space-evenly', marginTop: 2 }}>
        <button type="button" class="island-control press" aria-label="Previous" disabled={!status.canPrevious} style={{ width: 46, height: 46, color: status.canPrevious ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => { haptic('click'); media(2); }}><Icon name="skipPrevious" size={28} /></button>
        <button type="button" class="island-control press" aria-label={playing ? 'Pause' : 'Play'} disabled={!status.canToggle} style={{ width: 50, height: 50, borderRadius: 25, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => { haptic('click'); setAsked([!playing, Date.now()]); void command(Proto.CMD_MEDIA, Uint8Array.of(1)); }}><PlayPause playing={playing} color="#0b0e14" size={22} /></button>
        <button type="button" class="island-control press" aria-label="Next" disabled={!status.canNext} style={{ width: 46, height: 46, color: status.canNext ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => { haptic('click'); media(3); }}><Icon name="skipNext" size={28} /></button>
      </div>
    </div>
  );
}
