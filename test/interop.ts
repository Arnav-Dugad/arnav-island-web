// The web app's link against the island's own engine (share_peer, the Windows ShareService), live over the internet through
// the public relay: pairing with a code and the QR key, the remote, the whole island, the Shelf both ways, files both ways,
// music, find my phone, pages both ways, the trackpad and the PC's screen. Run: node test/run.mjs (bundles this with esbuild).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Link, type LinkEvent, type LinkStore, type StoredPeer } from '../src/link/link';
import { pairLink } from '../src/link/relay';
import { Proto } from '../src/link/proto';
import { Frames } from '../src/link/island';
import { Bytes, Reader } from '../src/link/bytes';

const EXE = process.env.SHARE_PEER ?? 'C:\\Users\\rduga\\Desktop\\Arnav Island\\build\\share_peer.exe';
const QA = process.env.QA_DIR!;
const LOSE = Number(process.env.RELAY_LOSE ?? '0');
let failures = 0, passes = 0;
const check = (ok: boolean, what: string) => { if (ok) { passes++; console.log('  ok   ' + what); } else { failures++; console.log('  FAIL ' + what); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- the made-up PC ----
mkdirSync(join(QA, 'pc'), { recursive: true });
const cover = join(QA, 'cover.jpg');
if (!existsSync(cover)) writeFileSync(cover, Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(600).fill(0x41), 0xff, 0xd9]));
const peer = spawn(EXE, ['47990', join(QA, 'pc'), cover, 'Web Test PC', '--relay', ...(LOSE ? [`--relay-lose=${LOSE}`] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
const lines: string[] = []; const waiters: { re: RegExp; resolve: (m: RegExpMatchArray | null) => void; from: number }[] = [];
let buffered = '';
peer.stdout.on('data', (d: Buffer) => {
  buffered += d.toString('utf8');
  let i; while ((i = buffered.indexOf('\n')) >= 0) {
    const line = buffered.slice(0, i).replace(/\r$/, ''); buffered = buffered.slice(i + 1);
    lines.push(line); if (process.env.VERBOSE) console.log('    pc: ' + line);
    for (const w of [...waiters]) { const m = line.match(w.re); if (m) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); } }
  }
});
let mark = 0;
const say = (cmd: string) => { if (process.env.VERBOSE) console.log('    > ' + cmd); mark = lines.length; peer.stdin.write(cmd + '\n'); };
/** A line matching [re] since the last command (or [since]). */
function expect(re: RegExp, ms = 30_000, since = mark): Promise<RegExpMatchArray | null> {
  for (let i = since; i < lines.length; i++) { const m = lines[i].match(re); if (m) return Promise.resolve(m); }
  return new Promise((resolve) => { const w = { re, resolve, from: since }; waiters.push(w); setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); resolve(null); } }, ms); });
}

// ---- the web app ----
class Memory implements LinkStore {
  identity: { id: Uint8Array; pub: Uint8Array; key: CryptoKey } | null = null; peers: StoredPeer[] = [];
  async loadIdentity() { return this.identity; }
  async saveIdentity(id: Uint8Array, pub: Uint8Array, key: CryptoKey) { this.identity = { id, pub, key }; return true; }
  async loadPeers() { return this.peers; }
  async savePeers(p: StoredPeer[]) { this.peers = p; }
}
const events: LinkEvent[] = []; const eventWaiters: { f: (e: LinkEvent) => boolean; resolve: (e: LinkEvent | null) => void }[] = [];
function onEvent(e: LinkEvent) {
  events.push(e); if (process.env.VERBOSE && e.kind !== 'progress' && e.kind !== 'peers') console.log('    web: ' + e.kind + ' ' + JSON.stringify(e, (k, v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : k === 'files' ? undefined : v)).slice(0, 200));
  for (const w of [...eventWaiters]) if (w.f(e)) { eventWaiters.splice(eventWaiters.indexOf(w), 1); w.resolve(e); }
}
function nextEvent<K extends LinkEvent['kind']>(kind: K, ms = 30_000, f: (e: Extract<LinkEvent, { kind: K }>) => boolean = () => true): Promise<Extract<LinkEvent, { kind: K }> | null> {
  return new Promise((resolve) => {
    const w = { f: (e: LinkEvent) => e.kind === kind && f(e as Extract<LinkEvent, { kind: K }>), resolve: resolve as (e: LinkEvent | null) => void };
    eventWaiters.push(w); setTimeout(() => { const k = eventWaiters.indexOf(w); if (k >= 0) { eventWaiters.splice(k, 1); resolve(null); } }, ms);
  });
}

async function main() {
  const ready = await expect(/^READY (\w+)/, 20_000);
  check(!!ready, 'the made-up PC started');
  const store = new Memory();
  const link = new Link(store, 'Web Test iPhone', onEvent, { loseEvery: LOSE });
  check(await link.start(), 'the link started');
  check(await link.ready(20_000), `on the relay (${link.relayBroker})`);
  await sleep(3000); // the PC's brokers too

  // Pairing: a code and the QR key, so this side says yes at once.
  say('host');
  const code = await expect(/^CODE (\S+)/, 20_000); const linkLine = await expect(/^LINK (\S+)/, 5_000);
  check(!!code && !!linkLine, `the PC offers a code (${code?.[1]})`);
  const parsed = pairLink(linkLine![1]);
  check(!!parsed && parsed.key?.length === 10, 'its QR link is read, with the key print');
  const paired = nextEvent('paired', 60_000); const shown = nextEvent('pairCode', 60_000);
  check(link.pairWithCode(parsed!.code, parsed!.key), 'pairing starts');
  const pc = await shown; check(!!pc && pc.confirmed && pc.code >= 0, `both show ${String(pc?.code).padStart(6, '0')} (already confirmed here)`);
  const pcCode = await expect(/^PAIRCODE (\d+)/, 5_000); check(!!pcCode && Number(pcCode[1]) === pc?.code, 'the PC shows the same code');
  const done = await paired; check(!!done?.ok, `paired: ${done?.detail}`);
  const id = done!.peer;
  check(store.peers.length === 1 && store.peers[0].id === id, 'the pairing is kept');

  // Presence through the relay.
  let online = false; for (let i = 0; i < 60 && !online; i++) { online = link.peerViews().some((p) => p.id === id && p.online && p.revision >= 8); if (!online) await sleep(500); }
  check(online, 'the PC is online through the relay, revision 8');
  const webId = link.identity;
  say('peers'); const pres = await expect(new RegExp(`^PEER ${webId} 1 1 1`), 10_000); check(!!pres, 'the PC sees this device online through the internet');

  // The remote.
  const st = await link.status(id, null, null);
  check(!!st && st.title === 'Glass Horizons' && st.artist === 'Aurora Fields' && st.volume === 42 && st.cover?.length === readFileSync(cover).length, `status: ${st?.title} · ${st?.artist}, volume ${st?.volume}, cover ${st?.cover?.length} bytes`);
  const again = await link.status(id, st!.coverHash, st); check(!!again && again.cover === st!.cover, 'an unchanged cover isn\'t sent again');
  const vol = await link.remote(id, Proto.CMD_VOLUME, Uint8Array.of(64)); check(vol?.status === Proto.OK && !!(await expect(/^REMOTE volume 64/, 5_000)), 'volume');
  const media = await link.remote(id, Proto.CMD_MEDIA, Uint8Array.of(1)); check(media?.status === Proto.OK && !!(await expect(/^REMOTE media 1/, 5_000)), 'play/pause');
  const lock = await link.remote(id, Proto.CMD_LOCK); check(lock?.status === Proto.NOT_ALLOWED, 'lock (not allowed there) says so');
  const clip = await link.remote(id, Proto.CMD_CLIP_GET); check(!!clip && new Reader(clip.payload).string() === 'from pc ✓', 'the PC\'s clipboard');
  await link.remote(id, Proto.CMD_CLIP_SET, new Bytes().text('from web ✓').build()); check(!!(await expect(/^CLIP from web ✓/, 5_000)), 'to the PC\'s clipboard');
  const ly = await link.remote(id, Proto.CMD_LYRICS); check(ly?.status === Proto.OK, 'lyrics');
  const ring = await link.remote(id, Proto.CMD_RING_PC); check(ring?.status === Proto.OK && !!(await expect(/^RINGPC/, 5_000)), 'ring the PC');
  await link.remote(id, Proto.CMD_PAGE, Frames.page('https://example.com/article', 'An article', 0.42)); check(!!(await expect(/^PAGE 0\.420 https:\/\/example\.com\/article/, 5_000)), 'a page to the PC, where it was scrolled to');

  // The whole island.
  const stats = await link.stats(id); check(!!stats && stats.cores.length === 16 && stats.cpuHistory.length === 40 && stats.name === 'Web Test PC', `stats: CPU ${stats?.cpu.toFixed(0)}%, ${stats?.cores.length} cores`);
  const bat = await link.battery(id); check(!!bat && bat.percent === 82 && bat.day.length === 288 && bat.cycles === 187, `battery: ${bat?.percent}%, ${bat?.day.length} readings`);
  const sets = await link.islandSettings(id); check(!!sets && sets.sections.length === 10 && sets.items.length >= 8, `settings: ${sets?.items.length}`);
  const v = await link.setIslandSetting(id, 'hoverDelay', 9999); check(v === 700, 'a setting kept within its range');
  const ctl = await link.controls(id); check(!!ctl && ctl.wifi === 1 && ctl.brightness === 64, 'controls');
  const ctl2 = await link.setControl(id, 5, 30); check(!!ctl2 && ctl2.brightness === 30, 'brightness set');
  const cmds = await link.queryCommands(id, 'usd'); check(!!cmds && cmds.rows.some((r) => r.kind === 37), 'the command bar');
  const restart = await link.queryCommands(id, 'restart'); const out1 = await link.runCommand(id, 'restart', 0, 'Restart', false);
  check(!!restart && out1?.outcome === 1, 'a command that needs a yes asks for it');
  const outs = await link.outputs(id); check(!!outs && outs.length === 2, 'audio outputs');
  check((await link.selectOutput(id, 'buds')) === Proto.OK && !!(await expect(/^OUTPUT buds/, 5_000)), 'an output chosen');
  check(await link.openIslandPage(id, 2) && !!(await expect(/^ISLAND page 2/, 5_000)), 'an island page opened');

  // Notices: this device's battery and a notification.
  check(await link.notice(id, Frames.status(64, true)) && !!(await expect(/^PHONESTATUS 64 1/, 5_000)), 'battery to the island');
  check(await link.notice(id, Frames.notification('Messages', 'Sam', 'On my way', 'Web Test iPhone', false)) && !!(await expect(/^PHONENOTICE Messages\|Sam\|On my way/, 5_000)), 'a notification to the island');

  // Files: here to the PC's Shelf, with a picture.
  const bytes = new Uint8Array(700_000); for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + (i >> 9)) & 255;
  const sent = nextEvent('sent', 120_000);
  const preview = new Uint8Array([0xff, 0xd8, ...new Array(2000).fill(7), 0xff, 0xd9]);
  link.send(id, [{ rel: 'web-photo.bin', size: bytes.length, blob: new Blob([bytes]) }], 'web-photo.bin', { toShelf: true, preview });
  check(!!(await expect(/^OFFERPIC 2004 1 0/, 60_000)), 'the offer carries its picture');
  const s = await sent; check(!!s, `sent ${bytes.length} bytes to the Shelf`);
  const recv = await expect(/^RECEIVED /, 20_000); check(!!recv, 'the PC has it whole');
  check(existsSync(join(QA, 'pc', 'dl', 'web-photo.bin')) || lines.some((l) => l.includes('web-photo.bin')), 'kept on the PC');

  // The PC's Shelf, listed and taken.
  const shelfFile = join(QA, 'shelf-item.txt'); writeFileSync(shelfFile, 'shelf item from the pc '.repeat(4000));
  say(`shelf ${shelfFile}`); await sleep(500);
  const shelf = await link.shelf(id); check(shelf.items.some((i) => i.name === 'shelf-item.txt'), `the Shelf lists ${shelf.items.length}`);
  const idx = shelf.items.findIndex((i) => i.name === 'shelf-item.txt');
  const took = nextEvent('received', 60_000, (e) => e.taken);
  link.take(id, idx, 'shelf-item.txt');
  const t = await took; const text = t ? await t.files[0].blob.text() : '';
  check(!!t && text === readFileSync(shelfFile, 'utf8'), 'taken from the Shelf, whole');

  // Files: the PC to here.
  const pcFile = join(QA, 'to-web.txt'); writeFileSync(pcFile, 'hello web '.repeat(30000));
  const offered = nextEvent('offer', 30_000); say(`send ${webId} ${pcFile}`);
  const o = await offered; check(!!o && o.count === 1 && o.size === 300000, 'the PC offers a file');
  const got = nextEvent('received', 90_000, (e) => !e.taken); link.answer(o!.transfer, true);
  const g = await got; check(!!g && (await g.files[0].blob.text()) === readFileSync(pcFile, 'utf8'), 'it arrives whole');

  // Music handed over.
  const music = nextEvent('music', 30_000); say(`handoff ${webId} -`);
  const m = await music; check(!!m && m.music.title === 'Glass Horizons' && (m.music.cover?.length ?? 0) > 0, 'music handed here, with its cover');
  link.answerMusic(m!.transfer, 1); check(!!(await expect(/^HANDOFFANSWER 1/, 20_000)), 'the PC hears the answer');
  const hand = await link.handoff(id, { title: 'Web Song', artist: 'Web Artist', album: '', app: 'Safari', fileName: '', position: 30, duration: 200, playing: true, fileSize: 0, cover: null });
  check(hand === 1 && !!(await expect(/^HANDOFF Web Song\|30/, 10_000)), 'music handed to the PC');

  // Find my phone.
  const rung = nextEvent('ring', 30_000); say(`ring ${webId}`); check(!!(await rung) && !!(await expect(/^RANG/, 10_000)), 'the PC rings this device');

  // The clipboard, pushed.
  const clipEv = nextEvent('clipboard', 30_000); say(`clip ${webId} pushed text ✓`);
  const ce = await clipEv; check(!!ce && ce.text === 'pushed text ✓', 'the PC\'s clipboard pushed here');

  // Pages from the PC, and a photo asked for (this device has none: it says so).
  const queries: number[] = [];
  link.onQuery = async (_p, command, payload) => {
    queries.push(command);
    if (command === Proto.QUERY_PAGE) { const r = new Reader(payload); const f = r.f32(); const url = r.string(); return f !== null && url === 'https://example.org/read' ? new Uint8Array(0) : null; }
    if (command === Proto.QUERY_READINGS) return new Bytes().string('Battery\t64%').build();
    return null;
  };
  say(`page ${webId} 0.25 https://example.org/read A page to read`);
  await expect(/^OK page/, 10_000);
  for (let i = 0; i < 100 && !queries.includes(Proto.QUERY_PAGE); i++) await sleep(200);
  check(queries.includes(Proto.QUERY_PAGE), 'a page from the PC, where it was scrolled to');

  // The trackpad.
  const input = await link.openInput(id); check(!!input, 'the trackpad connects');
  await input!.send(Frames.move(12, -5)); await input!.send(Frames.button(0, 2)); await input!.send(Frames.text('hi'));
  check(!!(await expect(/^INPUT 600c00fbff/, 10_000)), 'a move arrives'); check(!!(await expect(/^INPUT 610002/, 5_000)), 'a click arrives'); check(!!(await expect(/^INPUT 636869/, 5_000)), 'text arrives');
  input!.close();

  // The PC's screen (a made-up moving picture, never the real one).
  const req = new Bytes().u8(Proto.SCREEN_REQUEST).u8(1).u16(1280).u16(720).u8(30).u32(0).build();
  const screen = await link.openScreen(id, req);
  check(!!screen, 'the PC\'s screen opens');
  if (screen) {
    const [ss, reply] = screen; const r = new Reader(reply, 1); const status = r.u8(); const w = r.u16(); const h = r.u16();
    check(status === 0 && !!w && !!h, `answered ${w}x${h}`);
    let frames = 0, keys = 0, bytesIn = 0; const until = Date.now() + 15_000;
    while (Date.now() < until && frames < 20) { const f = await ss.receive(1000); if (f && f[0] === Proto.SCREEN_VIDEO) { frames++; if (f[1] & 1) keys++; bytesIn += f.length; if (frames % 5 === 0) await ss.send(new Bytes().u8(Proto.SCREEN_FEEDBACK).u32(frames).u16(8).u32(3000).u8(30).build()); } }
    check(frames >= 5 && keys >= 1, `${frames} frames arrived (${keys} key), ${Math.round(bytesIn / 1024)} KB`);
    const tapAt = Date.now(); await ss.send(Uint8Array.of(Proto.SCREEN_INPUT, ...Frames.point(0.5, 0.5)));
    // Frames keep coming meanwhile (as they do while it shows), so the session stays read.
    let tapped: RegExpMatchArray | null | undefined; void expect(/^MIRROR input 65/, 20_000).then((m) => { tapped = m; });
    while (tapped === undefined && Date.now() - tapAt < 20_000) await ss.receive(200);
    check(!!tapped, `a tap on the PC's screen arrives (${((Date.now() - tapAt) / 1000).toFixed(1)} s)`);
    await ss.send(Uint8Array.of(Proto.SCREEN_STOP)); ss.close();
    check(!!(await expect(/^MIRROR ended/, 15_000)), 'the screen ends cleanly');
  }

  // Forgotten: the PC can't reach it any more.
  await link.forget(id); check(store.peers.length === 0 && link.peerViews().length === 0, 'forgotten');
  link.stop();
}

const watchdog = setTimeout(() => { console.log('  FAIL timed out'); failures++; finish(); }, 8 * 60_000);
function finish() { clearTimeout(watchdog); say('quit'); setTimeout(() => { peer.kill(); console.log(`\n${passes} passed, ${failures} failed`); process.exit(failures ? 1 : 0); }, 800); }
main().catch((e) => { console.log('  FAIL ' + (e?.stack ?? e)); failures++; }).finally(finish);
