// Sending to your PC (photos, files, a photo taken for its Shelf, the clipboard), transfers as they go, and what came and
// went; and your PC's Shelf, each item taken here with a tap.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PeerView, ShelfItem, ShelfList } from '../link/island';
import { type Moment, type Transfer, cancel, choose, clearMoments, getLink, keptFile, pasteOnPc, peers, request, say, send, sendPhoto, sizeText, transfers as transfersSignal } from '../state/hub';
import { DrawnCheck, Empty, GlassButton, GlassChip, GlassIconButton, GlassPanel, GlassRow, GlassTile, Hairline, Icon, ProgressRing, ScreenTitle, SectionLabel, ago, glassClass, iconFor, leftText, rateText } from '../ui/components';
import { haptic } from '../ui/motion';

/** A hidden file input, opened from a tap (iOS opens its photo library, camera or Files). */
export function pickFiles(opts: { accept?: string; capture?: boolean; multiple?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input'); input.type = 'file'; input.multiple = opts.multiple ?? true;
    if (opts.accept) input.accept = opts.accept; if (opts.capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none'; document.body.appendChild(input);
    const done = () => { resolve(input.files ? [...input.files] : []); input.remove(); };
    input.addEventListener('change', done, { once: true }); input.addEventListener('cancel', () => { resolve([]); input.remove(); }, { once: true });
    input.click();
  });
}

export function SendScreen({ pc, moments, onPair }: { pc: PeerView | null; moments: Moment[]; onPair: () => void }) {
  const transfers = transfersSignal.value;
  const paired = peers.value.filter((p) => p.paired && !p.phone);
  const list = [...transfers.values()].sort((a, b) => a.id - b.id);
  return (
    <>
      <ScreenTitle title="Send" over={pc ? `To ${pc.name}` : 'Pair a PC first'} />
      {paired.length > 1 && <div class="hscroll" style={{ paddingBottom: 14 }}>{paired.map((p) => <GlassChip key={p.id} label={p.name} icon="laptop" selected={p.id === pc?.id} iconTint={p.online ? 'var(--good)' : undefined} onClick={() => choose(p.id)} />)}</div>}
      {!pc ? <GlassButton onClick={onPair} prominent><Icon name="laptop" /><span class="t-strong">Pair with your PC</span></GlassButton> : <>
        <div class="grid2">
          <GlassTile icon="photoLibrary" title="Photos & videos" detail="Full quality, as they are" enabled={pc.online} onClick={async () => { const f = await pickFiles({ accept: 'image/*,video/*' }); if (f.length) void send(pc.id, f); }} />
          <GlassTile icon="folder" title="Files" detail="Anything, any size" tint="var(--accent2)" enabled={pc.online} onClick={async () => { const f = await pickFiles({}); if (f.length) void send(pc.id, f); }} />
          <GlassTile icon="photoCamera" title="Camera" detail={pc.revision >= 3 ? `Straight onto ${pc.name}’s Shelf` : `A photo, to ${pc.name}`} tint="var(--accent2)" enabled={pc.online} onClick={async () => { const f = await pickFiles({ accept: 'image/*', capture: true, multiple: false }); if (f[0]) void sendPhoto(f[0]); }} />
          <GlassTile icon="contentPaste" title="Clipboard" detail={`Paste it on ${pc.name}`} enabled={pc.online} onClick={async () => { try { await pasteOnPc(await navigator.clipboard.readText()); } catch { say({ kind: 'info', title: 'Allow pasting to use this', detail: 'Tap Paste when your iPhone asks' }); } }} />
        </div>
        {!pc.online ? <div class="t-caption muted" style={{ padding: '12px 6px 0' }}>{pc.name} is away. Files go once Arnav Island runs there, on any network.</div>
          : <div class="row t-caption muted" style={{ padding: '12px 6px 0', gap: 6 }}><Icon name="public" size={14} /><span>Through the relay, end-to-end encrypted. On an iPad or Mac, drop files anywhere here, or paste them.</span></div>}
        <div class={`collapse ${list.length ? 'open' : ''}`}>
          <div>
            <SectionLabel text="Now" />
            <GlassPanel>{list.map((t, i) => <div key={t.id}>{i > 0 && <Hairline />}<TransferRow t={t} /></div>)}</GlassPanel>
          </div>
        </div>
        {moments.length > 0 && <>
          <div class="row" style={{ alignItems: 'flex-end' }}><SectionLabel text="Recent" class="grow" /><button type="button" class="t-caption accent" style={{ padding: 8 }} onClick={() => { haptic('tick'); clearMoments(); }}>Clear</button></div>
          <GlassPanel>{moments.slice(0, 20).map((m, i) => (
            <div key={m.at + m.title}>{i > 0 && <Hairline />}
              <GlassRow icon={m.kind === 0 ? 'download' : m.kind === 2 ? 'inventory2' : 'send'} title={m.title} detail={`${m.kind === 1 ? 'To' : 'From'} ${m.from}  ·  ${sizeText(m.size)}  ·  ${ago(m.at)}`}
                tint={m.kind === 1 ? 'var(--accent2)' : 'var(--good)'} onClick={m.kind !== 1 ? () => void openMoment(m) : undefined} trailing={m.kind !== 1 && m.files.length > 0 && <span class="muted"><Icon name="iosShare" size={20} /></span>} />
            </div>
          ))}</GlassPanel>
        </>}
      </>}
      <div style={{ height: 24 }} />
    </>
  );
}

async function openMoment(m: Moment) {
  const files = (await Promise.all(m.files.map((id) => keptFile(id)))).filter((f): f is NonNullable<typeof f> => !!f);
  if (!files.length) { say({ kind: 'info', title: 'It’s no longer kept here', detail: 'Files older than the last few hundred MB are let go' }); return; }
  request('files:' + JSON.stringify(m.files));
}

function TransferRow({ t }: { t: Transfer }) {
  const f = t.total > 0 ? t.done / t.total : 0; const left = t.rate > 0 ? leftText((t.total - t.done) / t.rate) : '';
  return (
    <div class="row" style={{ padding: '12px 16px', gap: 13 }}>
      <ProgressRing fraction={f} color={t.outgoing ? 'var(--accent2)' : 'var(--good)'} size={42} stroke={3.5}><Icon name={t.outgoing ? 'send' : 'download'} size={17} /></ProgressRing>
      <div class="col grow">
        <span class="t-strong ellipsis">{t.title}</span>
        <span class="t-caption muted ellipsis">{[`${t.outgoing ? 'To' : 'From'} ${t.name}`, `${Math.floor(f * 100)}%`, t.rate > 0 ? rateText(t.rate) : '', left].filter(Boolean).join('  ·  ')}</span>
      </div>
      <GlassIconButton icon="close" description="Stop" onClick={() => cancel(t.id)} size={36} iconSize={17} />
    </div>
  );
}

/** Your PC's Shelf: what is on it, each taken here with a tap. */
export function ShelfScreen({ pc, shown, onPair }: { pc: PeerView | null; shown: boolean; onPair: () => void }) {
  const [list, setList] = useState<ShelfList | null>(null); const [loading, setLoading] = useState(false); const [taken, setTaken] = useState<Set<string>>(new Set());
  const busy = useRef(false);
  const load = async () => {
    const p = pc; if (!p || busy.current) return; busy.current = true; setLoading(true);
    const l = (await getLink()?.shelf(p.id)) ?? { shared: false, items: [], error: 'Not connected' };
    setList(l); setLoading(false); busy.current = false;
  };
  useEffect(() => { setList(null); setTaken(new Set()); }, [pc?.id]);
  useEffect(() => { if (shown && pc?.online) void load(); }, [shown, pc?.id, pc?.online]);
  const transfers = transfersSignal.value;
  return (
    <>
      <ScreenTitle title="Shelf" over={pc ? `${pc.name}’s` : 'Your PC’s'} trailing={pc && <GlassIconButton icon="refresh" description="Refresh" onClick={() => void load()} size={42} iconSize={20} class={loading ? 'spinning' : ''} />} />
      {!pc ? <Empty icon="inventory2" title="Pair with your PC" detail="Then take anything on its Shelf with a tap" action={<GlassButton onClick={onPair} prominent><span class="t-strong">Pair</span></GlassButton>} />
        : !pc.online ? <Empty icon="wifiOff" title={`${pc.name} is away`} detail="Its Shelf shows here when Arnav Island runs there" />
          : !list ? <Empty icon="inventory2" title={`Looking at ${pc.name}’s Shelf…`} />
            : list.error ? <Empty icon="errorOutline" title="Couldn’t look" detail={list.error} />
              : !list.shared ? <Empty icon="lock" title={`${pc.name} keeps its Shelf to itself`} detail="Turn on “My PCs can take from the Shelf” in the island’s Settings › Privacy & productivity" />
                : !list.items.length ? <Empty icon="inventory2" title="The Shelf is empty" detail="Drop files on the island’s Shelf and they show up here" />
                  : <div class="grid2" style={{ paddingBottom: 24 }}>
                    {list.items.map((item, i) => {
                      const moving = [...transfers.values()].find((t) => !t.outgoing && t.title === item.name && t.peer === pc.id) ?? null;
                      return <ShelfTile key={item.name + i} item={item} moving={moving} done={taken.has(item.name)} onTake={() => {
                        if (moving) return; getLink()?.take(pc.id, i, item.name); setTaken(new Set([...taken, item.name]));
                      }} />;
                    })}
                  </div>}
    </>
  );
}

function ShelfTile({ item, moving, done, onTake }: { item: ShelfItem; moving: Transfer | null; done: boolean; onTake: () => void }) {
  const preview = useMemo(() => (item.preview ? URL.createObjectURL(new Blob([item.preview as BlobPart], { type: 'image/jpeg' })) : null), [item]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return (
    <button type="button" class={`press tile-press col ${glassClass('card', 'tile')}`} style={{ padding: 10, textAlign: 'left', minWidth: 0 }} onClick={() => { haptic('click'); onTake(); }} aria-label={`Take ${item.name}`}>
      <span style={{ position: 'relative', width: '100%', aspectRatio: '1.25', borderRadius: 16, overflow: 'hidden', background: 'color-mix(in srgb, var(--accent) 10%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
        {preview ? <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name={item.folder ? 'folder' : iconFor(item.name)} size={38} />}
        {moving ? <span style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ProgressRing fraction={moving.total > 0 ? moving.done / moving.total : 0} color="#fff" track="rgba(255,255,255,.25)" size={46} stroke={4} /></span>
          : done && <span style={{ position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: 13, background: 'var(--good)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><DrawnCheck color="#fff" size={18} /></span>}
      </span>
      <span class="t-strong ellipsis" style={{ marginTop: 9, padding: '0 4px', width: '100%' }}>{item.name}</span>
      <span class="t-caption muted" style={{ padding: '0 4px' }}>{item.folder ? `Folder  ·  ${sizeText(item.size)}` : sizeText(item.size)}</span>
    </button>
  );
}
