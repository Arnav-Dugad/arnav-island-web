// The PC's lyrics for what plays there, word by word: the line being sung is bright and large, its words light up as they
// are sung, the lines before fade. It follows the song unless you scroll; a line tapped plays from there.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Lyrics, LyricsLine } from '../link/island';
import { haptic } from './motion';

/** The line sung at [time] (seconds): the last one that has started, or -1 before the first. */
export function lineAt(lines: LyricsLine[], time: number): number {
  let lo = 0, hi = lines.length - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >>> 1; if (lines[mid].time <= time) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  return found;
}
/** Lyrics are synced when their lines have times (plain lyrics all start at zero). */
export const synced = (lines: LyricsLine[]) => lines.length > 1 && lines.some((l) => l.time > 0);

export function LyricsView({ lyrics, position, playing, pcName, onSeek }: { lyrics: Lyrics | null; position: () => number; playing: boolean; pcName: string; onSeek: (t: number) => void }) {
  const lines = lyrics?.lines ?? [];
  if (!lyrics || lyrics.state === 1) return <Hint title="Looking for the lyrics…" />;
  if (lyrics.state === 0) return <Hint title={`Lyrics are off on ${pcName}`} detail="Turn them on in the island’s Settings › Music" />;
  if (!lines.length) return <Hint title="No lyrics for this song" />;
  if (!synced(lines)) return (
    <div class="lyrics-list" style={{ padding: 22 }}>
      {lines.map((l, i) => <div key={i} class="t-strong" style={{ fontSize: 18, lineHeight: '25px', color: 'rgba(255,255,255,.86)', padding: '4px 0' }}>{l.text}</div>)}
    </div>
  );
  return <Synced lines={lines} position={position} playing={playing} onSeek={onSeek} />;
}

function Synced({ lines, position, playing, onSeek }: { lines: LyricsLine[]; position: () => number; playing: boolean; onSeek: (t: number) => void }) {
  const [now, setNow] = useState(position());
  useEffect(() => { const t = setInterval(() => setNow(position()), playing ? 90 : 500); return () => clearInterval(t); }, [playing, position]);
  const current = lineAt(lines, now);
  const list = useRef<HTMLDivElement>(null); const touchedAt = useRef(0);
  useEffect(() => {
    const el = list.current; if (!el || current < 0 || Date.now() - touchedAt.current < 3500) return;
    const target = el.children[Math.max(0, current - 1)] as HTMLElement | undefined;
    if (target) el.scrollTo({ top: target.offsetTop - 22, behavior: 'smooth' });
  }, [current]);
  return (
    <div ref={list} class="lyrics-list" style={{ padding: '22px 22px 180px' }} onScroll={() => { touchedAt.current = Date.now(); }} onTouchMove={() => { touchedAt.current = Date.now(); }}>
      {lines.map((l, i) => {
        const on = i === current;
        return (
          <div key={i} role="button" tabIndex={0} class={`lyric ${on ? 'on' : ''}`} style={{ color: i < current ? 'rgba(255,255,255,.38)' : on ? '#fff' : 'rgba(255,255,255,.5)' }}
            onClick={(e) => { e.stopPropagation(); haptic('tick'); onSeek(l.time); }}>
            {on ? <Sung line={l} now={now} /> : (l.text.trim() || '♪')}
          </div>
        );
      })}
    </div>
  );
}

/** The line being sung: words already sung are white, the one being sung fills in, the rest wait. */
function Sung({ line, now }: { line: LyricsLine; now: number }) {
  const text = line.text.trim() ? line.text : '♪';
  if (!line.words.length) return <>{text}</>;
  const starts = line.words.map(([, at]) => Math.max(0, Math.min(text.length, at)));
  const parts = [];
  if (starts[0] > 0) parts.push(<span key="pre">{text.slice(0, starts[0])}</span>);
  line.words.forEach(([time], k) => {
    const from = starts[k]; const to = k + 1 < starts.length ? Math.max(from, starts[k + 1]) : text.length;
    const next = k + 1 < line.words.length ? line.words[k + 1][0] : time + 0.6;
    const f = Math.max(0, Math.min(1, (now - time) / Math.max(0.08, next - time)));
    const color = now < time ? 'rgba(255,255,255,.42)' : `color-mix(in srgb, #fff ${Math.round(65 + 35 * f)}%, var(--accent))`;
    parts.push(<span key={k} style={{ color, transition: 'color 90ms linear' }}>{text.slice(from, to)}</span>);
  });
  return <>{parts}</>;
}

function Hint({ title, detail }: { title: string; detail?: string }) {
  return (
    <div class="col center" style={{ padding: 24, alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div class="t-headline" style={{ color: '#fff' }}>{title}</div>
      {detail && <div class="t-caption" style={{ color: 'rgba(255,255,255,.7)', marginTop: 6 }}>{detail}</div>}
    </div>
  );
}
