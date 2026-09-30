// Everything on your PC's island, from here (island 0.22): its numbers live, its controls, the focus clock, its command
// bar, power, where its sound goes, its pages on the PC and every one of its settings. Asked once a second while this
// shows; anything changed here shows at once and then follows what the PC says.
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AudioOutput, CommandRow, IslandSetting, IslandSettings, PcBattery, PcControls, PcStats, PeerView } from '../link/island';
import { IslandWire, airplane } from '../link/island';
import {
  type StatsPoint, cachedStats, choose, closeIsland, controlsAt, islandReady, islandSettingAction, islandSettings, loadIslandSettings, loadOutputs, openIslandPage, outputs,
  pcBattery, pcControls, pcStats, peers, queryCommands, refreshIsland, runCommand, say, selectOutput, setControl, setIslandSetting, statsTrail, visible,
} from '../state/hub';
import {
  Empty, GlassButton, GlassChip, GlassIconButton, GlassPanel, GlassRow, GlassSlider, GlassSwitch, Hairline, Icon, type IconName, LiveDot, ProgressRing, Radar, RollingDigits, ScreenTitle, SectionLabel, StepButton,
  clock, glassClass, quality, rateText, span,
} from '../ui/components';
import { haptic, useNow, useSpring } from '../ui/motion';
import { GlassSheet } from '../ui/sheet';

/** The Island tab's sheets, drawn over the whole app (the tab bar too), as the app's other sheets are. */
export interface Confirm { title: string; detail: string; action: string; danger: boolean; run: () => void }
export const islandUi = { statsOpen: signal(false), section: signal<number | null>(null), confirm: signal<Confirm | null>(null) };

export function IslandScreen({ pc, shown, onPair }: { pc: PeerView | null; shown: boolean; onPair: () => void }) {
  const stats = pcStats.value, controls = pcControls.value, settings = islandSettings.value, outs = outputs.value, battery = pcBattery.value;
  const pcs = useMemo(() => peers.value.filter((p) => p.paired && !p.phone), [peers.value]);
  const ready = islandReady(pc);
  useEffect(() => {
    if (!ready || !shown || !visible.value) return;
    let stop = false; let n = 0;
    void (async () => {
      void loadOutputs(); if (!islandSettings.value) void loadIslandSettings();
      while (!stop) { await refreshIsland(true); if (++n % 10 === 0) void loadOutputs(); await new Promise((r) => setTimeout(r, 1000)); }
    })();
    return () => { stop = true; };
  }, [pc?.id, ready, shown, visible.value]);
  const confirm = (c: Confirm) => { islandUi.confirm.value = c; };
  const carousel = !!pc && pcs.length > 1;
  return (
    <>
      <ScreenTitle title="Island" over={pc ? (!pc.online ? `${pc.name}  ·  away` : `${pc.name}  ·  ${quality(pc).text.toLowerCase()}`) : 'No PC yet'} trailing={pc && <LiveDot on={pc.online} />} />
      {carousel && <StatsCarousel pcs={pcs} pc={pc!} stats={stats} />}
      {!pc ? <Empty icon="laptop" title="Pair with your PC" detail="Then everything on its island is here: its numbers, its controls, its settings." action={<GlassButton onClick={onPair} prominent pad="13px 26px"><span class="t-strong">Pair</span></GlassButton>} />
        : !pc.online ? <Empty icon="cloudOff" title={`${pc.name} is away`} detail="Its island shows here again as soon as it’s back." />
          : pc.revision < 5 ? <Empty icon="systemUpdate" title={`Update Arnav Island on ${pc.name}`} detail="Version 0.22 or later lets this iPhone control everything on its island." />
            : <>
              {!carousel && <StatsPanel s={stats} live onOpen={() => { islandUi.statsOpen.value = true; }} />}
              {battery?.present && <><SectionLabel text="Battery" /><BatteryPanel b={battery} /></>}
              <SectionLabel text="Controls" /><ControlsPanel c={controls} />
              <SectionLabel text="Focus" /><FocusPanel c={controls} />
              <SectionLabel text={`Run on ${pc.name}`} /><CommandPanel pcName={pc.name} onConfirm={confirm} />
              <SectionLabel text="Power" /><PowerPanel pcName={pc.name} onConfirm={confirm} />
              {outs.length > 0 && <><SectionLabel text="Sound comes from" /><OutputsPanel outputs={outs} settings={settings} /></>}
              <SectionLabel text={`Show on ${pc.name}`} /><PagesPanel />
              <SectionLabel text="Island settings" /><SettingsPanel s={settings} onOpen={(i) => { islandUi.section.value = i; }} />
              <div style={{ height: 24 }} />
            </>}
    </>
  );
}

export function IslandSheets() {
  const stats = pcStats.value; const settings = islandSettings.value;
  return (
    <>
      <StatsSheet visible={islandUi.statsOpen.value && !!stats} s={stats} onDismiss={() => { islandUi.statsOpen.value = false; }} />
      <SectionSheet section={islandUi.section.value} s={settings} onConfirm={(c) => { islandUi.confirm.value = c; }} onDismiss={() => { islandUi.section.value = null; }} />
      <ConfirmSheet c={islandUi.confirm.value} onDismiss={() => { islandUi.confirm.value = null; }} />
    </>
  );
}

function ConfirmSheet({ c, onDismiss }: { c: Confirm | null; onDismiss: () => void }) {
  return (
    <GlassSheet visible={!!c} onDismiss={onDismiss} label={c?.title}>
      {c && <>
        <div class="t-title center">{c.title}</div>
        <div class="t-body muted center" style={{ marginTop: 8 }}>{c.detail}</div>
        <div class="row gap12" style={{ width: '100%', marginTop: 24 }}>
          <GlassButton onClick={onDismiss} style={{ flex: 1 }}><span class="t-strong">Cancel</span></GlassButton>
          <GlassButton onClick={() => { haptic('confirm'); c.run(); onDismiss(); }} prominent={!c.danger} style={{ flex: 1 }}><span class="t-strong" style={{ color: c.danger ? 'var(--danger)' : undefined }}>{c.action}</span></GlassButton>
        </div>
      </>}
    </GlassSheet>
  );
}

// ---- stats ----
/** With more than one PC, their numbers side by side in a carousel: settle on another and the rest follows it. */
function StatsCarousel({ pcs, pc, stats }: { pcs: PeerView[]; pc: PeerView; stats: PcStats | null }) {
  const ref = useRef<HTMLDivElement>(null); const index = Math.max(0, pcs.findIndex((p) => p.id === pc.id));
  const [page, setPage] = useState(index);
  useEffect(() => { const el = ref.current; if (el && Math.round(el.scrollLeft / el.clientWidth) !== index) el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' }); }, [index]);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <>
      <div ref={ref} class="carousel" onScroll={(e) => {
        const el = e.currentTarget; const p = Math.round(el.scrollLeft / Math.max(1, el.clientWidth)); if (p !== page) { setPage(p); haptic('tick'); }
        if (settle.current) clearTimeout(settle.current);
        settle.current = setTimeout(() => { const chosen = pcs[p]; if (chosen && chosen.id !== pc.id) choose(chosen.id); }, 180);
      }}>
        {pcs.map((p) => { const live = p.id === pc.id; return <div key={p.id} class="carousel-page"><StatsPanel s={live ? stats : cachedStats(p.id)} live={live && p.online} title={p.name} away={!p.online} onOpen={() => { if (live) islandUi.statsOpen.value = true; }} /></div>; })}
      </div>
      <div class="row" style={{ justifyContent: 'center', paddingTop: 10, gap: 6, marginBottom: 4 }}>
        {pcs.map((p, i) => <span key={p.id} class="pager-dot" style={{ width: i === page ? 18 : 6, background: i === page ? 'var(--accent)' : 'color-mix(in srgb, var(--faint) 50%, transparent)' }} />)}
      </div>
    </>
  );
}

/** The PC's numbers: its rings, a flowing graph of the processor and a bar for each core. The card warms when the processor has worked hard for half a minute. */
function StatsPanel({ s, live, title, away = false, onOpen }: { s: PcStats | null; live: boolean; title?: string; away?: boolean; onOpen: () => void }) {
  const trail = statsTrail.value;
  const heatTarget = useMemo(() => {
    if (!live) return 0; const cpu = trail.slice(-30).map((p) => p.cpu).filter((v) => v >= 0);
    if (cpu.length < 10) return 0; const avg = cpu.reduce((a, b) => a + b, 0) / cpu.length; return Math.max(0, Math.min(1, (avg - 55) / 35));
  }, [trail, live]);
  const heat = useSpring(heatTarget, 1, 20);
  const cpuColor = `color-mix(in srgb, #ff8a3d ${Math.round(heat * 100)}%, var(--accent))`;
  return (
    <div role="button" tabIndex={0} class={`${glassClass()} stats-card`} onClick={onOpen} aria-label={`${title ? title + ': ' : ''}Your PC's numbers. Tap for more`} style={{ cursor: 'pointer', overflow: 'hidden' }}>
      {heat > 0.01 && <div class="heat" style={{ opacity: heat }} />}
      <div class="col" style={{ padding: 18, opacity: away ? 0.5 : 1, position: 'relative' }}>
        {title && <div class="row" style={{ paddingBottom: 10 }}><span class="t-strong ellipsis grow">{title}</span><span class={`t-micro ${live && !away ? 'good' : 'muted'}`}>{away ? 'Away' : live ? 'Live' : 'Swipe to see it live'}</span></div>}
        <div class="row" style={{ justifyContent: 'space-evenly' }}>
          <Gauge label="CPU" value={s?.cpu ?? -1} color={cpuColor} /><Gauge label="GPU" value={s?.gpu ?? -1} color="var(--accent2)" /><Gauge label="Memory" value={s?.ramPercent ?? -1} color="var(--good)" />
        </div>
        {heat > 0.5 && <div class="t-caption center" style={{ color: '#ff8a3d', marginTop: 8 }}>Working hard: {Math.round(s?.cpu ?? 0)}% for the last half minute</div>}
        <div style={{ height: 14 }} />
        <Graph samples={s?.cpuHistory ?? []} color={cpuColor} height={46} top={100} />
        {!!s?.cores.length && <><div style={{ height: 12 }} /><CoreBars cores={s.cores} color={cpuColor} live={live} /></>}
        <div class="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <Rate icon="south" bytes={s?.download} /><Rate icon="north" bytes={s?.upload} />
          <span class="row t-caption muted">More<Icon name="chevronRight" size={18} /></span>
        </div>
      </div>
    </div>
  );
}
/** A bar for each core, its height its load; a busy core (70% or more) shimmers. */
function CoreBars({ cores, color, live }: { cores: number[]; color: string; live: boolean }) {
  const busy = cores.filter((c) => c >= 70).length;
  return (
    <div class="col">
      <div class="cores" style={{ gap: cores.length > 24 ? 2 : 3 }} aria-label={`${cores.length} cores: ${cores.map((c) => (c < 0 ? 'unknown' : `${Math.round(c)}%`)).join(', ')}`}>
        {cores.map((v, i) => { const f = v < 0 ? 0 : v / 100; return (
          <span key={i} class="core"><i style={{ height: `max(2px, ${f * 100}%)`, background: color, opacity: 0.55 + 0.45 * f }}>{live && f >= 0.7 && <b style={{ animationDelay: `${-i * 0.09}s` }} />}</i></span>
        ); })}
      </div>
      <div class="row t-micro muted" style={{ marginTop: 4 }}><span class="grow">{cores.length} cores</span>{busy > 0 && <span>{busy} busy</span>}</div>
    </div>
  );
}
function Gauge({ label, value, color, size = 86 }: { label: string; value: number; color: string; size?: number }) {
  const known = value >= 0;
  return (
    <div class="col" style={{ alignItems: 'center' }} aria-label={known ? `${label} ${Math.round(value)} percent` : `${label} unknown`}>
      <ProgressRing fraction={known ? value / 100 : 0} color={color} size={size} stroke={6}>
        {known ? <RollingDigits text={`${Math.round(value)}%`} class="t-headline" /> : <span class="t-headline faint">—</span>}
      </ProgressRing>
      <span class="t-caption muted" style={{ marginTop: 6 }}>{label}</span>
    </div>
  );
}
function Rate({ icon, bytes }: { icon: IconName; bytes: number | undefined }) {
  return <span class="row gap6"><span class="accent"><Icon name={icon} size={16} /></span><span class="t-strong tabular">{bytes === undefined ? '—' : rateText(bytes)}</span></span>;
}

/** A graph of the last samples that flows: each new sample slides in from the right as the rest move along. */
export function Graph({ samples, color, height, top = null, at = null }: { samples: number[]; color: string; height: number; top?: number | null; at?: number | null }) {
  const [w, setW] = useState(300); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth); return () => ro.disconnect(); }, []);
  const id = useMemo(() => 'g' + Math.random().toString(36).slice(2, 8), []);
  const known = samples.map((v) => (v < 0 ? 0 : v));
  if (known.length < 2) return <div ref={ref} style={{ height }} />;
  const high = Math.max(top ?? Math.max(...known) * 1.15, 1); const step = w / (known.length - 1);
  const y = (v: number) => height - Math.max(0, Math.min(1, v / high)) * height * 0.92;
  const line = known.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const fill = `${line} L${((known.length - 1) * step).toFixed(1)},${height} L0,${height} Z`;
  const lastY = y(known[known.length - 1]);
  return (
    <div ref={ref} style={{ height, position: 'relative', overflow: 'hidden' }}>
      <svg width={w} height={height} style={{ display: 'block' }} aria-hidden="true">
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color={color} stop-opacity="0.28" /><stop offset="1" stop-color={color} stop-opacity="0" /></linearGradient></defs>
        <g key={samples.length + ':' + samples[samples.length - 1]} class="flow" style={{ '--step': `${step}px` }}>
          <path d={fill} fill={`url(#${id})`} />
          <path d={line} fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <circle cx={w} cy={lastY} r="6" fill={color} opacity="0.3" /><circle cx={w} cy={lastY} r="3" fill={color} />
        </g>
        {at !== null && at >= 0 && at < known.length && <g><line x1={at * step} x2={at * step} y1="0" y2={height} stroke="var(--text)" stroke-opacity="0.35" /><circle cx={at * step} cy={y(known[at])} r="7" fill={color} opacity="0.3" /><circle cx={at * step} cy={y(known[at])} r="3.5" fill={color} /></g>}
      </svg>
    </div>
  );
}

/** The PC's battery (island 0.23): its level, charging and for how long, the power going in or out, its health and its last day. */
function BatteryPanel({ b }: { b: PcBattery }) {
  const colour = b.charging ? 'var(--good)' : b.percent >= 0 && b.percent <= 20 ? 'var(--danger)' : 'var(--accent)';
  const watts = Math.abs(b.rateMw) / 1000;
  const facts: string[] = [];
  if (b.health >= 0) facts.push(`Health ${Math.round(b.health * 100)}%` + (b.healthBefore >= 0 && Math.abs(b.health - b.healthBefore) >= 0.0005 ? `, ${(b.health - b.healthBefore >= 0 ? '+' : '−')}${Math.abs((b.health - b.healthBefore) * 100).toFixed(1)} this week` : ''));
  if (b.cycles > 0) facts.push(`${b.cycles} cycles`);
  if (b.temperatureDeciK > 0) facts.push(`${(b.temperatureDeciK / 10 - 273.15).toFixed(1)}°C`);
  if (b.fullMwh > 0) facts.push(`${(b.remainingMwh / 1000).toFixed(1)} of ${(b.fullMwh / 1000).toFixed(1)} Wh`);
  if (b.voltageMv > 0) facts.push(`${(b.voltageMv / 1000).toFixed(2)} V`);
  const who = [b.manufacturer, b.name].filter((x) => x.trim()).join(' '); if (who) facts.push(who);
  return (
    <GlassPanel class="col" style={{ padding: 18 }}>
      <div class="row gap14">
        <ProgressRing fraction={b.percent >= 0 ? b.percent / 100 : 0} color={colour} size={92} stroke={7}>
          <span class="col" style={{ alignItems: 'center' }}>{b.percent >= 0 ? <RollingDigits text={`${b.percent}%`} class="t-headline" /> : <span class="t-headline faint">—</span>}{b.charging && <span class="good"><Icon name="bolt" size={16} /></span>}</span>
        </ProgressRing>
        <div class="col grow">
          <div class="t-headline">{b.charging && b.minutesToFull > 0 ? `Full in ${span(b.minutesToFull * 60)}` : b.charging ? 'Charging' : b.online ? 'On power' : b.minutesLeft > 0 ? `${span(b.minutesLeft * 60)} left` : 'On battery'}</div>
          {watts > 0.05 && <div class="t-caption muted">{b.rateMw > 0 ? `${watts.toFixed(1)} W going in` : `Using ${watts.toFixed(1)} W`}</div>}
          {b.saver && <div class="t-caption warn">Battery saver is on</div>}
        </div>
      </div>
      {b.day.length >= 2 && <BatteryDay day={b.day} />}
      <div class="row wrap gap6" style={{ marginTop: 10 }}>{facts.map((f) => <GlassChip key={f} label={f} />)}</div>
    </GlassPanel>
  );
}
function BatteryDay({ day }: { day: [number, number, boolean][] }) {
  const [w, setW] = useState(300); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); return () => ro.disconnect(); }, []);
  const h = 54; const first = day[0][0]; const spanS = Math.max(1, day[day.length - 1][0] - first);
  const pt = (i: number) => [((day[i][0] - first) / spanS) * w, h - (day[i][1] / 100) * h * 0.94];
  const fill = `M0,${h} ` + day.map((_, i) => `L${pt(i)[0].toFixed(1)},${pt(i)[1].toFixed(1)}`).join(' ') + ` L${w},${h} Z`;
  return (
    <div ref={ref} style={{ marginTop: 14 }} aria-label="The battery over the last day">
      <svg width={w} height={h} style={{ display: 'block' }} aria-hidden="true">
        <defs><linearGradient id="bday" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0.25" /><stop offset="1" stop-color="var(--accent)" stop-opacity="0" /></linearGradient></defs>
        <path d={fill} fill="url(#bday)" />
        {day.slice(1).map((d, i) => { const [x1, y1] = pt(i), [x2, y2] = pt(i + 1); return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={d[2] ? 'var(--good)' : 'var(--accent)'} stroke-width="2" stroke-linecap="round" />; })}
      </svg>
      <div class="row t-micro faint"><span class="grow">A day ago</span><span>Now</span></div>
    </div>
  );
}

/** The PC's numbers in full: live graphs for the processor, graphics and network, and what the PC is. */
function StatsSheet({ visible: open, s, onDismiss }: { visible: boolean; s: PcStats | null; onDismiss: () => void }) {
  const trail = statsTrail.value; const now = Date.now();
  const series = (pick: (p: StatsPoint) => number, history: number[]): [number, number][] =>
    trail.length >= history.length && trail.length >= 10 ? trail.map((p) => [p.at, pick(p)]) : history.map((v, i) => [now - (history.length - 1 - i) * 1000, v]);
  return (
    <GlassSheet visible={open} onDismiss={onDismiss} class="sheet-max" label="Your PC's numbers">
      {s && <div class="sheet-scroll" style={{ width: '100%' }}>
        <div class="t-title">{s.name || 'Your PC'}</div>{s.model && <div class="t-caption muted">{s.model}</div>}
        <div style={{ height: 16 }} />
        <BigGraph title="Processor" now={s.cpu >= 0 ? `${Math.round(s.cpu)}%` : '—'} series={series((p) => p.cpu, s.cpuHistory)} color="var(--accent)" top={100} detail={s.cpuName ? `${s.cpuName}  ·  ${s.logical} threads` : null} format={(v) => `${Math.round(v)}%`} />
        <BigGraph title="Graphics" now={s.gpu >= 0 ? `${Math.round(s.gpu)}%` : '—'} series={series((p) => p.gpu, s.gpuHistory)} color="var(--accent2)" top={100} detail={s.gpuName || null} format={(v) => (v < 0 ? '—' : `${Math.round(v)}%`)} />
        <BigGraph title="Downloading" now={rateText(s.download)} series={series((p) => p.download, s.downloadHistory)} color="var(--good)" top={null} detail={`Sending ${rateText(s.upload)}`} format={(v) => rateText(v)} />
        <GlassPanel style={{ marginTop: 4, padding: '4px 0' }}>
          <Fact icon="memory" title="Memory" value={`${s.ramUsedGiB.toFixed(1)} of ${s.ramTotalGiB.toFixed(1)} GB  ·  ${Math.round(s.ramPercent)}%`} />
          {s.diskUsedPercent >= 0 && <><Hairline /><Fact icon="storage" title="Disk" value={`${Math.round(s.diskFreeGiB)} GB free of ${Math.round(s.diskTotalGiB)} GB`} /></>}
          {s.battery >= 0 && <><Hairline /><Fact icon={s.charging ? 'batteryChargingFull' : 'batteryFull'} title="Battery" value={`${s.battery}%${s.charging ? '  ·  charging' : s.batteryMinutes > 0 ? `  ·  ${span(s.batteryMinutes * 60)} left` : ''}`} /></>}
          <Hairline /><Fact icon="timer" title="On for" value={span(s.uptime)} />
          {s.os && <><Hairline /><Fact icon="desktopWindows" title="Windows" value={s.os} /></>}
        </GlassPanel>
        <div style={{ height: 8 }} />
      </div>}
    </GlassSheet>
  );
}
function BigGraph({ title, now, series, color, top, detail, format }: { title: string; now: string; series: [number, number][]; color: string; top: number | null; detail: string | null; format: (v: number) => string }) {
  const samples = series.map((p) => p[1]); const [at, setAt] = useState<number | null>(null); const ref = useRef<HTMLDivElement>(null);
  const scale = top === null ? null : [10, 25, 50, 75, 100].find((t) => t >= Math.min(100, Math.max(0, ...samples) * 1.15)) ?? 100;
  const index = (x: number) => { const r = ref.current!.getBoundingClientRect(); return samples.length < 2 ? null : Math.max(0, Math.min(samples.length - 1, Math.round(((x - r.left) / r.width) * (samples.length - 1)))); };
  const ago = at !== null ? Math.max(0, Math.floor((Date.now() - series[at][0]) / 1000)) : 0;
  const spanS = series.length >= 2 ? Math.max(1, Math.floor((series[series.length - 1][0] - series[0][0]) / 1000)) : 0;
  return (
    <GlassPanel style={{ marginBottom: 10, padding: 16 }}>
      <div class="row" style={{ alignItems: 'flex-end' }}><span class="t-strong grow">{title}</span><RollingDigits text={now} class="t-headline" style={{ color }} /></div>
      {detail && <div class="t-caption muted clamp2">{detail}</div>}
      <div ref={ref} class="no-drag" style={{ marginTop: 10, height: 84, position: 'relative', touchAction: 'none' }}
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setAt(index(e.clientX)); haptic('tick'); }}
        onPointerMove={(e) => { if (at === null) return; const i = index(e.clientX); if (i !== at) { setAt(i); if (i !== null && i % 5 === 0) haptic('tick'); } }}
        onPointerUp={() => setAt(null)} onPointerCancel={() => setAt(null)}>
        <Graph samples={samples} color={color} height={84} top={scale} at={at} />
        {scale !== null && at === null && <span class="t-micro faint" style={{ position: 'absolute', right: 0, top: 0 }}>{scale}%</span>}
        {at !== null && <span class="t-micro graph-tip">{format(samples[at])}  ·  {ago < 2 ? 'now' : ago < 90 ? `${ago} s ago` : `${Math.floor(ago / 60)} min ago`}</span>}
      </div>
      {series.length >= 2 && <div class="row t-micro faint" style={{ marginTop: 2 }}><span class="grow">{spanS < 90 ? `${spanS} s ago` : `${Math.floor(spanS / 60)} min ago`}</span><span>Now</span></div>}
    </GlassPanel>
  );
}
function Fact({ icon, title, value }: { icon: IconName; title: string; value: string }) {
  return <div class="row" style={{ padding: '12px 16px', gap: 12 }}><span class="accent"><Icon name={icon} size={20} /></span><span class="t-body grow">{title}</span><span class="t-caption muted" style={{ textAlign: 'right' }}>{value}</span></div>;
}

// ---- controls ----
function ControlsPanel({ c }: { c: PcControls | null }) {
  if (!c) return <GlassPanel style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Radar size={40} /></GlassPanel>;
  const set = (control: number, on: boolean, seen: (x: PcControls) => PcControls) => setControl(control, on ? 1 : 0, seen);
  return (
    <div class="col gap10">
      <div class="row gap10">
        <SwitchTile on="wifi" off="wifiOff" label="Wi-Fi" state={c.wifi} busy={(c.busy & 1) !== 0} onChange={(on) => set(IslandWire.WIFI, on, (x) => ({ ...x, wifi: on ? 1 : 0, busy: x.busy | 1 }))} />
        <SwitchTile on="bluetooth" off="bluetoothDisabled" label="Bluetooth" state={c.bluetooth} busy={(c.busy & 2) !== 0} onChange={(on) => set(IslandWire.BLUETOOTH, on, (x) => ({ ...x, bluetooth: on ? 1 : 0, busy: x.busy | 2 }))} />
        <SwitchTile on="airplanemodeActive" off="airplanemodeInactive" label="Airplane" state={c.wifi < -1 && c.bluetooth < -1 ? -2 : airplane(c) ? 1 : 0} busy={(c.busy & 4) !== 0}
          onChange={(on) => set(IslandWire.AIRPLANE, on, (x) => ({ ...x, wifi: on ? 0 : 1, bluetooth: x.bluetooth < -1 ? x.bluetooth : on ? 0 : 1, busy: x.busy | 4 }))} />
      </div>
      <div class="row gap10">
        <SwitchTile on="darkMode" off="lightMode" label="Dark mode" state={c.dark} busy={(c.busy & 8) !== 0} onChange={(on) => set(IslandWire.DARK, on, (x) => ({ ...x, dark: on ? 1 : 0, busy: x.busy | 8 }))} />
        <SwitchTile on="micOff" off="mic" label="Mic muted" state={!c.micAvailable ? -2 : c.micMuted ? 1 : 0} busy={false} onChange={(on) => set(IslandWire.MIC, on, (x) => ({ ...x, micMuted: on }))} />
        <SwitchTile on="volumeOff" off="volumeUp" label="Muted" state={c.muted ? 1 : 0} busy={false} onChange={(on) => set(IslandWire.MUTE, on, (x) => ({ ...x, muted: on }))} />
      </div>
      <GlassPanel class="col" style={{ padding: '14px 18px' }}>
        {c.brightness >= 0 && <><Level icon="lightMode" label="Brightness" value={c.brightness} onDone={(v) => setControl(IslandWire.BRIGHTNESS, v, (x) => ({ ...x, brightness: v }))} /><div style={{ height: 12 }} /></>}
        <Level icon={c.muted || c.volume === 0 ? 'volumeOff' : 'volumeUp'} label="Volume" value={c.volume} onDone={(v) => setControl(IslandWire.VOLUME, v, (x) => ({ ...x, volume: v }))} />
        <div class="row gap10" style={{ marginTop: 10 }}>
          <span class="t-caption muted grow">Volume</span>
          <StepButton icon="remove" description="Volume down" size={40} onStep={() => { const v = Math.max(0, (pcControls.value?.volume ?? c.volume) - 5); setControl(IslandWire.VOLUME, v, (x) => ({ ...x, volume: v, muted: false })); }} />
          <StepButton icon="add" description="Volume up" size={40} onStep={() => { const v = Math.min(100, (pcControls.value?.volume ?? c.volume) + 5); setControl(IslandWire.VOLUME, v, (x) => ({ ...x, volume: v, muted: false })); }} />
        </div>
      </GlassPanel>
    </div>
  );
}
/** A switch as a glass tile: lit when on; a small radar while it's changing on the PC; dimmed when the PC has no such thing. */
function SwitchTile({ on, off, label, state, busy, onChange }: { on: IconName; off: IconName; label: string; state: number; busy: boolean; onChange: (on: boolean) => void }) {
  const lit = state === 1, none = state < -1;
  return (
    <button type="button" role="switch" aria-checked={lit} aria-label={`${label}, ${none ? 'not on this PC' : busy ? 'changing' : lit ? 'on' : 'off'}`} disabled={none || busy || state < 0}
      class={`switch-tile press tile-press ${glassClass('control', 'card', lit)}`} onClick={() => { haptic('click'); onChange(!lit); }}>
      <span style={{ position: 'relative', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', color: none ? 'var(--faint)' : lit ? 'var(--accent)' : 'var(--text)' }}>
        {busy && <span style={{ position: 'absolute', inset: 0 }}><Radar size={30} /></span>}
        <Icon name={lit ? on : off} size={20} />
      </span>
      <span class="col" style={{ alignItems: 'flex-start' }}>
        <span class={`t-caption ellipsis ${none ? 'faint' : ''}`} style={{ maxWidth: '100%' }}>{label}</span>
        <span class="t-micro muted" style={{ textTransform: 'none', letterSpacing: 0 }}>{none ? 'Not here' : busy ? 'Changing…' : state === -1 ? '…' : lit ? 'On' : 'Off'}</span>
      </span>
    </button>
  );
}
function Level({ icon, label, value, onDone }: { icon: IconName; label: string; value: number; onDone: (v: number) => void }) {
  const [moving, setMoving] = useState<number | null>(null); const shown = moving ?? value / 100;
  return (
    <div class="row gap12">
      <span class="accent"><Icon name={icon} size={20} /></span>
      <GlassSlider value={shown} onChange={setMoving} onDone={(v) => { setMoving(null); onDone(Math.round(v * 100)); }} class="grow" description={label} />
      <span class="t-caption muted tabular" style={{ minWidth: 38, textAlign: 'right' }}>{Math.round(shown * 100)}%</span>
    </div>
  );
}

// ---- focus ----
/** The island's focus clock: running on here from the PC's last word, with focus, break and stopwatch to start. */
function FocusPanel({ c }: { c: PcControls | null }) {
  const now = useNow(250, !!c?.focusRunning);
  if (!c) return null;
  const gone = c.focusRunning ? Math.max(0, now - controlsAt.value) / 1000 : 0;
  const stopwatch = c.focusMode === 2;
  const shown = stopwatch ? c.focusShown + gone : Math.max(0, c.focusShown - gone);
  const fraction = stopwatch ? (shown % 60) / 60 : c.focusDuration > 0 ? shown / c.focusDuration : 0;
  const stateText = c.focusFinished ? 'Done' : c.focusRunning ? 'Running' : stopwatch ? (shown > 0.5 ? 'Paused' : 'Ready') : shown < c.focusDuration - 0.5 ? 'Paused' : 'Ready';
  return (
    <GlassPanel class="col">
      <div class="row" style={{ padding: 18, gap: 18 }}>
        <ProgressRing fraction={fraction} color={c.focusMode === 1 ? 'var(--good)' : 'var(--accent)'} size={104} stroke={7}>
          <span class="col" style={{ alignItems: 'center' }}><RollingDigits text={clock(shown)} class="t-headline" /><span class="t-micro muted">{c.focusMode === 1 ? 'Break' : c.focusMode === 2 ? 'Stopwatch' : 'Focus'}</span></span>
        </ProgressRing>
        <div class="col grow">
          <span class="t-strong">{stateText}</span>
          <span class="t-caption muted">{stopwatch ? 'Counting up on your PC' : 'On your PC’s island'}</span>
          <div class="row gap8" style={{ marginTop: 10 }}>
            <GlassIconButton icon={c.focusRunning ? 'pause' : 'playArrow'} description={c.focusRunning ? 'Pause' : 'Start'} prominent onClick={() => setControl(IslandWire.FOCUS_TOGGLE, 0, (x) => ({ ...x, focusRunning: !x.focusRunning, focusShown: shown }))} />
            <GlassIconButton icon="replay" description="Reset" onClick={() => setControl(IslandWire.FOCUS_RESET, 0, (x) => ({ ...x, focusRunning: false, focusShown: x.focusMode === 2 ? 0 : x.focusDuration }))} />
            <GlassIconButton icon="timer" description="Stopwatch" onClick={() => setControl(IslandWire.STOPWATCH, 0, (x) => ({ ...x, focusMode: 2, focusRunning: true, focusShown: 0 }))} />
          </div>
        </div>
      </div>
      <div class="row gap8" style={{ padding: '0 18px 18px' }}>
        {[15, 25, 45].map((m) => <GlassButton key={m} onClick={() => setControl(IslandWire.FOCUS, m, (x) => ({ ...x, focusMode: 0, focusDuration: m * 60, focusShown: m * 60, focusRunning: true }))} pad="10px 0" style={{ flex: 1 }}><span class="t-caption">{m} min</span></GlassButton>)}
        <GlassButton onClick={() => setControl(IslandWire.BREAK, 5, (x) => ({ ...x, focusMode: 1, focusDuration: 300, focusShown: 300, focusRunning: true }))} pad="10px 0" style={{ flex: 1 }}><span class="t-caption">Break</span></GlassButton>
      </div>
    </GlassPanel>
  );
}

// ---- the command bar ----
/** The PC's command bar: what's typed is asked as it's typed; a row runs on the PC (asking first where the island would). */
function CommandPanel({ pcName, onConfirm }: { pcName: string; onConfirm: (c: Confirm) => void }) {
  const [text, setText] = useState(''); const [rows, setRows] = useState<CommandRow[]>([]); const [asked, setAsked] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let gone = false;
    const t = setTimeout(async () => { const r = await queryCommands(text); if (r && !gone) { setRows(r.rows); setAsked(text); } }, text ? 180 : 0);
    return () => { gone = true; clearTimeout(t); };
  }, [text]);
  const run = async (i: number, row: CommandRow, confirmed: boolean) => {
    const o = await runCommand(asked, i, row.title, confirmed);
    if (o?.outcome === 0) { haptic('confirm'); say({ kind: 'info', title: o.message, detail: `On ${pcName}` }); field.current?.blur(); if ([12, 13, 14, 36].includes(row.kind)) setText(''); }
    else if (o?.outcome === 1) {
      const q = o.message; const cut = q.indexOf('? ');
      const title = (cut > 0 ? q.slice(0, cut + 1) : q).replace('the PC', pcName); const detail = cut > 0 ? q.slice(cut + 2).replace(/\.+$/, '') + '.' : `On ${pcName}`;
      field.current?.blur(); onConfirm({ title, detail, action: row.title.split(' ')[0] || 'Go ahead', danger: [32, 34, 35].includes(row.kind), run: () => void run(i, row, true) });
    } else if (o?.outcome === 3) { const r = await queryCommands(asked); if (r) setRows(r.rows); say({ kind: 'info', title: o.message }); }
    else say({ kind: 'failed', title: o?.message ?? `${pcName} didn't answer` });
  };
  return (
    <GlassPanel style={{ padding: '6px 0' }}>
      <label class={`row ${glassClass('control', 'capsule')}`} style={{ margin: '8px 12px', padding: '13px 16px', gap: 10 }}>
        <span class="muted"><Icon name="search" size={20} /></span>
        <input ref={field} value={text} onInput={(e) => setText(e.currentTarget.value.slice(0, 160))} placeholder="An app, a file, a setting, “timer 10”…" enterKeyHint="go" autoComplete="off" spellcheck={false}
          aria-label={`Run on ${pcName}`} class="t-body grow" style={{ background: 'none', border: 0, padding: 0, minWidth: 0 }}
          onKeyDown={(e) => { if (e.key === 'Enter' && rows[0]) { e.preventDefault(); void run(0, rows[0], false); } }}
          onFocus={(e) => setTimeout(() => (e.target as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' }), 350)} />
        {text && <button type="button" aria-label="Clear" class="muted" onClick={() => setText('')}><Icon name="close" size={20} /></button>}
      </label>
      {rows.slice(0, 6).map((row, i) => (
        <div key={row.title + i}>
          {i > 0 && <Hairline />}
          <div role="button" tabIndex={0} class="row" style={{ padding: '11px 16px', gap: 12, cursor: 'pointer' }} onClick={() => { haptic('tick'); void run(i, row, false); }}>
            <span class="rowicon" style={{ width: 34, height: 34, borderRadius: 10 }}><Icon name={kindIcon(row.kind)} size={19} /></span>
            <span class="col grow"><span class="t-strong ellipsis">{row.title}</span>{row.detail && <span class="t-caption muted ellipsis">{row.detail}</span>}</span>
            {row.answer && <span class="t-strong accent">{row.answer}</span>}
          </div>
        </div>
      ))}
    </GlassPanel>
  );
}
/** The island's CommandKind, as an icon. */
function kindIcon(kind: number): IconName {
  const m: Record<number, IconName> = {
    1: 'volumeUp', 2: 'volumeUp', 4: 'volumeUp', 3: 'volumeOff', 5: 'playArrow', 6: 'pause', 7: 'skipNext', 8: 'skipPrevious', 9: 'timer', 10: 'timer', 11: 'timerOff', 12: 'apps', 13: 'search', 14: 'settings',
    15: 'dashboard', 16: 'dashboard', 17: 'dashboard', 18: 'contentPaste', 27: 'contentPaste', 19: 'clearAll', 20: 'lock', 21: 'micOff', 22: 'mic', 23: 'mic', 24: 'screenshot', 25: 'textFields', 26: 'palette', 38: 'palette',
    28: 'darkMode', 29: 'bluetooth', 30: 'wifi', 31: 'airplanemodeActive', 32: 'deleteSweep', 33: 'bedtime', 34: 'restartAlt', 35: 'powerSettingsNew', 36: 'description', 37: 'currencyExchange', 39: 'cloud', 40: 'musicNote', 41: 'shuffle', 42: 'devices',
  };
  return m[kind] ?? 'bolt';
}

// ---- power ----
function PowerPanel({ pcName, onConfirm }: { pcName: string; onConfirm: (c: Confirm) => void }) {
  const power = (control: number, title: string, detail: string, action: string, danger: boolean) => onConfirm({ title, detail, action, danger, run: () => setControl(control, 1) });
  return (
    <>
      <div class="row gap10">
        <Action icon="lock" label="Lock" onClick={() => setControl(IslandWire.LOCK, 1)} />
        <Action icon="bedtime" label="Sleep" onClick={() => power(IslandWire.SLEEP, `Put ${pcName} to sleep?`, 'It wakes when you open it or press a key.', 'Sleep', false)} />
        <Action icon="restartAlt" label="Restart" onClick={() => power(IslandWire.RESTART, `Restart ${pcName}?`, 'Anything unsaved there may be lost.', 'Restart', true)} />
        <Action icon="powerSettingsNew" label="Shut down" onClick={() => power(IslandWire.SHUT_DOWN, `Shut down ${pcName}?`, 'Anything unsaved there may be lost.', 'Shut down', true)} />
      </div>
      <GlassPanel style={{ marginTop: 10 }}>
        <GlassRow icon="deleteSweep" title="Empty the recycle bin" detail={`For good, on ${pcName}`} onClick={() => power(IslandWire.EMPTY_BIN, 'Empty the recycle bin?', `What's in it on ${pcName} is deleted for good.`, 'Empty', true)} />
      </GlassPanel>
    </>
  );
}
function Action({ icon, label, onClick, height = 78 }: { icon: IconName; label: string; onClick: () => void; height?: number }) {
  return (
    <button type="button" class={`press tile-press col ${glassClass('control', 'card')}`} style={{ flex: 1, height, borderRadius: 20, alignItems: 'center', justifyContent: 'center', padding: 10, minWidth: 0 }} onClick={() => { haptic('click'); onClick(); }}>
      <Icon name={icon} size={22} /><span class="t-micro muted ellipsis" style={{ marginTop: 6, maxWidth: '100%', textTransform: 'none', letterSpacing: 0.2 }}>{label}</span>
    </button>
  );
}

// ---- sound output, pages ----
function OutputsPanel({ outputs: list, settings }: { outputs: AudioOutput[]; settings: IslandSettings | null }) {
  const direct = settings?.items.find((i) => i.key === 'directAudio');
  return (
    <GlassPanel>
      {list.map((o, i) => (
        <div key={o.id}>{i > 0 && <Hairline />}
          <GlassRow icon={o.form === 3 ? 'headphones' : o.form === 4 ? 'settingsVoice' : 'speaker'} title={o.name} detail={o.current ? 'Playing here' : null} tint={o.current ? 'var(--accent)' : 'var(--muted)'}
            onClick={() => { if (!o.current) selectOutput(o.id); }} trailing={o.current && <span class="accent" aria-label="Chosen"><Icon name="check" /></span>} />
        </div>
      ))}
      {direct && direct.value === 0 && <><Hairline /><GlassRow icon="swapHoriz" title={direct.title} detail="Needed to switch from here" tint="var(--warn)" trailing={<GlassSwitch checked={false} onChange={() => setIslandSetting('directAudio', 1)} />} /></>}
    </GlassPanel>
  );
}
function PagesPanel() {
  const icons: IconName[] = ['home', 'musicNote', 'speed', 'centerFocusStrong', 'settings', 'inventory2', 'equalizer', 'toggleOn'];
  return (
    <div class="col gap10">
      {[[0, 1, 2, 3], [5, 6, 7, 4]].map((row, r) => <div key={r} class="row gap10">{row.map((i) => <Action key={i} icon={icons[i]} label={IslandWire.PAGES[i]} height={70} onClick={() => openIslandPage(i)} />)}</div>)}
      <GlassButton onClick={() => closeIsland()} pad="11px 0" style={{ width: '100%', marginTop: 2 }}><Icon name="closeFullscreen" size={18} /><span class="t-caption">Close the island</span></GlassButton>
    </div>
  );
}

// ---- settings ----
const sectionIcons: IconName[] = ['tune', 'viewAgenda', 'palette', 'animation', 'shortText', 'musicNote', 'batteryChargingFull', 'home', 'privacyTip', 'info'];
const shownItem = (i: IslandSetting) => !(i.control === 5 && [1, 16].includes(i.action));
function SettingsPanel({ s, onOpen }: { s: IslandSettings | null; onOpen: (i: number) => void }) {
  if (!s) return <GlassPanel style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Radar size={34} /></GlassPanel>;
  const rows: ComponentChildren[] = [];
  s.sections.forEach((name, i) => {
    const count = s.items.filter((it) => it.section === i && shownItem(it)).length; if (!count) return;
    if (rows.length) rows.push(<Hairline key={'h' + i} />);
    rows.push(<GlassRow key={i} icon={sectionIcons[i] ?? 'tune'} title={name} detail={`${count} setting${count === 1 ? '' : 's'}`} onClick={() => onOpen(i)} trailing={<span class="muted"><Icon name="chevronRight" /></span>} />);
  });
  return <GlassPanel>{rows}</GlassPanel>;
}
/** Switching these off cuts this device off from the PC: asked first. */
const lifelines: Record<string, string> = {
  sharing: 'This iPhone loses its connection to the PC until sharing is turned back on there.', phoneControl: 'This iPhone can’t control the PC until that’s turned back on there.',
  relay: 'This iPhone reaches the PC only through the internet: it can’t, until that’s turned back on there.',
};
function SectionSheet({ section, s, onConfirm, onDismiss }: { section: number | null; s: IslandSettings | null; onConfirm: (c: Confirm) => void; onDismiss: () => void }) {
  return (
    <GlassSheet visible={section !== null && !!s} onDismiss={onDismiss} class="sheet-max" label="Island settings">
      {section !== null && s && <>
        <div class="t-title" style={{ alignSelf: 'flex-start' }}>{s.sections[section] ?? ''}</div>
        <div class="t-caption muted" style={{ alignSelf: 'flex-start', marginTop: 4, marginBottom: 14 }}>On your PC’s island, as its Settings has it</div>
        <div class="sheet-scroll col gap10">{s.items.filter((i) => i.section === section && shownItem(i)).map((item) => <SettingCard key={item.key + item.title} item={item} onConfirm={onConfirm} />)}<div style={{ height: 12 }} /></div>
      </>}
    </GlassSheet>
  );
}
function SettingCard({ item, onConfirm }: { item: IslandSetting; onConfirm: (c: Confirm) => void }) {
  const [moving, setMoving] = useState<number | null>(null);
  const head = <div class="col grow"><span class="t-strong">{item.title}</span>{item.detail && <span class="t-caption muted">{item.detail}</span>}</div>;
  const spanV = Math.max(1, item.hi - item.lo);
  const snap = (f: number) => { const raw = item.lo + Math.round(f * spanV); const step = Math.max(1, item.step); return Math.max(item.lo, Math.min(item.hi, item.lo + Math.floor((raw - item.lo + step / 2) / step) * step)); };
  const shown = moving ?? item.value;
  return (
    <GlassPanel class="col" style={{ padding: '14px 16px' }}>
      {item.control === 0 && <div class="row gap12">{head}<GlassSwitch checked={item.value !== 0} label={item.title} onChange={(on) => { const warn = lifelines[item.key]; if (!on && warn) onConfirm({ title: `Turn off “${item.title}”?`, detail: warn, action: 'Turn off', danger: true, run: () => setIslandSetting(item.key, 0) }); else setIslandSetting(item.key, on ? 1 : 0); }} /></div>}
      {item.control === 1 && <>
        <div class="row gap12">{head}<span class="t-strong accent tabular">{shown}{item.unit}</span></div>
        <GlassSlider value={(shown - item.lo) / spanV} onChange={(f) => setMoving(snap(f))} onDone={(f) => { const v = snap(f); setMoving(null); setIslandSetting(item.key, v); }} description={item.title} class="full" />
      </>}
      {item.control === 2 && <>
        <div class="row">{head}</div>
        <div class="row wrap gap8" style={{ marginTop: 10 }}>{item.options.map((o, i) => <GlassChip key={o} label={o} selected={item.value === i} onClick={() => { if (item.value !== i) setIslandSetting(item.key, i); }} />)}</div>
      </>}
      {item.control === 3 && <div class="row gap8">{head}
        <GlassIconButton icon="remove" description="Less" size={38} enabled={item.value > item.lo} onClick={() => setIslandSetting(item.key, Math.max(item.lo, item.value - item.step))} />
        <span class="t-strong" style={{ padding: '0 6px' }}>{item.options[item.value - item.lo] ?? `${item.value}${item.unit}`}</span>
        <GlassIconButton icon="add" description="More" size={38} enabled={item.value < item.hi} onClick={() => setIslandSetting(item.key, Math.min(item.hi, item.value + item.step))} />
      </div>}
      {item.control === 4 && <>
        <div class="row">{head}</div>
        <div class="row gap12" style={{ marginTop: 12 }}>{item.colours.map((c, i) => {
          const chosen = item.value === i;
          return <button key={i} type="button" role="radio" aria-checked={chosen} aria-label={(item.options[i] ?? `Colour ${i + 1}`) + (chosen ? ', chosen' : '')} class={`swatch ${chosen ? 'on' : ''}`}
            onClick={() => { haptic('tick'); if (!chosen) setIslandSetting(item.key, i); }}><i style={{ background: `#${(c & 0xffffff).toString(16).padStart(6, '0')}` }} /></button>;
        })}</div>
      </>}
      {item.control === 5 && (() => {
        const verb = [2, 6].includes(item.action) ? 'Reset' : [4, 12, 14, 17].includes(item.action) ? 'Clear' : item.action === 18 ? 'Check' : 'Open';
        const ask = item.action === 2 ? 'The island on your PC goes back to how it came.' : item.action === 6 ? 'The island’s pages go back to where they started.' : [4, 12, 14, 17].includes(item.action) ? 'It can’t be undone.' : null;
        return <div class="row gap12">{head}<GlassButton onClick={() => { if (ask) onConfirm({ title: `${item.title}?`, detail: ask, action: verb, danger: true, run: () => islandSettingAction(item.action, item.title) }); else islandSettingAction(item.action, item.title); }} pad="9px 16px"><span class="t-caption">{verb}</span></GlassButton></div>;
      })()}
    </GlassPanel>
  );
}
