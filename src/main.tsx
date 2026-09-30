// Arnav Island for iPhone: the island's companion as a Home Screen web app.
import { render } from 'preact';
import './ui/styles.css';
import './ui/screens.css';
import { App } from './app';
import { boot } from './state/hub';
import { installSprings } from './ui/motion';
import { unlockAudio } from './sheets/Sheets';

installSprings();
// iOS plays sound only after a first touch: the app's audio is readied on it.
window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
// The offline shell: the app opens instantly, with or without a network.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}); });
}
render(<App />, document.getElementById('app')!);
void boot();
