# Arnav Island for iPhone

**Your PC's island, in your hand, on an iPhone or iPad.** A Home Screen web app that does what the [Android app](https://github.com/Arnav-Dugad/arnav-island-android) does, as far as iOS lets a web app, with the same liquid glass, springs and layout. It talks to [Arnav Island for Windows](https://github.com/Arnav-Dugad/arnav-island) 0.25 or later, end-to-end encrypted, from any network.

**Open it:** https://arnav-island.pages.dev, then Share › Add to Home Screen.

## What it does

**The remote.** What plays on your PC: its cover (which colours the whole app), a scrubber that ticks at each lyric line, play and skip, and the cover turning over to word-by-word lyrics. Its sound on a dial with a tick at every 5%, steps and presets. Chips for its battery, CPU and weather.

**The whole island.**
- Its numbers live: CPU, GPU and memory rings, a flowing graph, a bar for each core, network rates, and graphs you can scrub.
- Its battery in full, with the last day.
- Its controls (Wi-Fi, Bluetooth, airplane, dark mode, mic, mute, brightness, volume).
- The focus clock, the command bar, power (with a confirmation for anything that can't be undone), where its sound goes, its pages, and every one of its settings.

**Files, both ways.**
- Photos, videos and files to your PC, with a picture of the first for the island to show as it arrives.
- A photo taken for its Shelf.
- Its Shelf, taken here with a tap.
- Files it sends, kept here and saved or shared through the iPhone's own share sheet.
- On an iPad or Mac, drop or paste files anywhere to send them, AirDrop-style: each PC a glass bubble with a ring that fills as it goes.

**More.**
- Music handed over from the PC (continued in Apple Music, Spotify or YouTube Music, or played here from the song's own file, with lock-screen controls).
- The trackpad and keyboard.
- **Your PC's screen**, decoded by the iPhone's hardware video decoder, to touch like a touchscreen and pinch to zoom.
- **This iPhone's camera in a window on your PC.**
- The PC's clipboard both ways, links and pages both ways, find my PC, and find this iPhone (with its glowing, warming ring screen).

## What's only here

- **Face ID.** A passkey on this device locks the app. Where iOS gives the passkey a secret (iOS 18 and later), your pairings are sealed under it: without Face ID they can't be read at all.
- **A real app on the Home Screen:** full screen, launch screens for every iPhone and iPad, instant and offline.
- **Shortcuts and Siri:** lock your PC, find it, play or pause, or open a link, from a shortcut. Every action from a link asks first.
- **iPad and Mac:** keyboard shortcuts throughout, and your keyboard typing straight onto the PC (⌘ shortcuts as Ctrl).
- **Haptics** (iOS 18's system tick), **light that follows your tilt**, the screen kept awake while your PC's screen shows, and Safari's bars tinted by the album art.

## What iOS doesn't let a web app do

These are the Android app's: your phone's notifications on the island, the photo you just took appearing there, the hotspot, sharing this phone's screen, widgets and Quick Settings tiles, and staying reachable in the background. The web app reaches your PCs while it's open.

## Security

**It has no server.** The site is static files; everything runs on your device. It connects only to three free public MQTT relays (HiveMQ, EMQX, Eclipse Mosquitto), over secure WebSockets.

**The protocol is the island's own**, byte for byte:
- Static ECDH P-256 keys, and AES-256-GCM with a fresh nonce for every frame.
- Pairing with a code both sides show, or scanning the island's QR code, which pins that PC's key.
- Relay topics named from each pair's shared secret, and every relay message sealed again under a key from it. A relay sees random-looking topics and encrypted bytes.

**Your keys stay here.**
- This device's private key is a non-extractable WebCrypto key. No script can read it out, not even this app's own.
- Pairings, history and settings are sealed with AES-256-GCM under a vault key in IndexedDB (under Face ID's secret when that's on).

**The strictest headers a static site can send** (see [`public/_headers`](public/_headers)):
- A CSP allowing only this site's own scripts and styles and the three relays.
- No inline script, no third-party code, no cookies, no analytics.
- HSTS with preload, cross-origin isolation (COOP/COEP/CORP), framing denied, no referrer, and a Permissions-Policy that allows only the camera, motion, passkeys, wake lock and the clipboard.

## Build

```
npm install
npm run build        # type-checks, then builds dist/
node test/run.mjs    # the link against the island's engine, live over the relay (needs share_peer.exe)
```

The protocol test pairs with the Windows island's own engine (`share_peer` from the island's repository) through the public relays. It then drives everything: the remote, the whole island, files and the Shelf both ways, music, find my phone, the clipboard, pages, the trackpad and the PC's screen. `RELAY_LOSE=5` drops every fifth relay message to exercise resending.

Deployed to Cloudflare Pages: `npx wrangler pages deploy dist --project-name arnav-island`.

MIT licensed.
