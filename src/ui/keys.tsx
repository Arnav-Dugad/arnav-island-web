// The keys a phone's keyboard lacks, and a field whose typing goes straight to the PC (shared by the trackpad and the PC's
// screen). On an iPad with a keyboard, its keys (arrows, Esc, Tab, ⌘ shortcuts as Ctrl) go to the PC as they are.
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { Frames } from '../link/island';
import { GlassChip, Icon, type IconName, glassClass } from './components';
import { haptic } from './motion';

/** Windows virtual-key codes. */
export const Vk = { BACK: 0x08, TAB: 0x09, RETURN: 0x0d, SHIFT: 0x10, CONTROL: 0x11, ALT: 0x12, ESCAPE: 0x1b, PRIOR: 0x21, NEXT: 0x22, END: 0x23, HOME: 0x24, LEFT: 0x25, UP: 0x26, RIGHT: 0x27, DOWN: 0x28, DELETE: 0x2e, WIN: 0x5b };

/** Where keys and typing go: the trackpad's session, or the PC's screen shown here. */
export interface Typist { key(vk: number, ...modifiers: number[]): void; frame(f: Uint8Array): void }
export function pressKey(t: Typist, vk: number, ...modifiers: number[]) {
  for (const m of modifiers) t.frame(Frames.key(m, 1));
  t.frame(Frames.key(vk, 2));
  for (const m of [...modifiers].reverse()) t.frame(Frames.key(m, 0));
}

/** What typing changed in the field: the backspaces to send, then the text to type (autocorrect is a few of each). */
export function typedDiff(old: string, next: string): [number, string] {
  let p = 0; const n = Math.min(old.length, next.length);
  while (p < n && old[p] === next[p]) p++;
  return [old.length - p, next.slice(p)];
}

const KEYS: { label: string; icon?: IconName; send: (t: Typist) => void }[] = [
  { label: 'Esc', send: (t) => t.key(Vk.ESCAPE) }, { label: 'Tab', send: (t) => t.key(Vk.TAB) },
  { label: 'Left', icon: 'keyboardArrowLeft', send: (t) => t.key(Vk.LEFT) }, { label: 'Up', icon: 'keyboardArrowUp', send: (t) => t.key(Vk.UP) },
  { label: 'Down', icon: 'keyboardArrowDown', send: (t) => t.key(Vk.DOWN) }, { label: 'Right', icon: 'keyboardArrowRight', send: (t) => t.key(Vk.RIGHT) },
  { label: 'Backspace', icon: 'backspace', send: (t) => t.key(Vk.BACK) }, { label: 'Del', send: (t) => t.key(Vk.DELETE) },
  { label: 'Enter', send: (t) => t.key(Vk.RETURN) }, { label: 'Start', send: (t) => t.key(Vk.WIN) }, { label: 'Switch app', send: (t) => t.key(Vk.TAB, Vk.ALT) },
  { label: 'Copy', send: (t) => t.key(0x43, Vk.CONTROL) }, { label: 'Paste', send: (t) => t.key(0x56, Vk.CONTROL) }, { label: 'Undo', send: (t) => t.key(0x5a, Vk.CONTROL) },
  { label: 'Desktop', send: (t) => t.key(0x44, Vk.WIN) }, { label: 'Home', send: (t) => t.key(Vk.HOME) }, { label: 'End', send: (t) => t.key(Vk.END) },
  { label: 'Page up', send: (t) => t.key(Vk.PRIOR) }, { label: 'Page down', send: (t) => t.key(Vk.NEXT) },
];

export function Keys({ input }: { input: Typist }) {
  return (
    <div class="hscroll no-drag" style={{ margin: 0, padding: 0, width: '100%' }}>
      {KEYS.map((k) => k.icon
        ? <button key={k.label} type="button" aria-label={k.label} class={`press ${glassClass('control', 'capsule')}`} style={{ width: 46, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', flex: 'none' }} onClick={() => { haptic('tick'); k.send(input); }}><Icon name={k.icon} size={20} /></button>
        : <GlassChip key={k.label} label={k.label} onClick={() => k.send(input)} />)}
    </div>
  );
}

/** A hardware key as a Windows key (with Ctrl for ⌘ and Ctrl), or null for keys typed as text. */
function hardwareKey(e: KeyboardEvent): [number, number[]] | null {
  const mods: number[] = [];
  if (e.ctrlKey || e.metaKey) mods.push(Vk.CONTROL); if (e.altKey) mods.push(Vk.ALT); if (e.shiftKey && (e.ctrlKey || e.metaKey || e.altKey || e.key.length > 1)) mods.push(Vk.SHIFT);
  const named: Record<string, number> = { Escape: Vk.ESCAPE, Tab: Vk.TAB, ArrowLeft: Vk.LEFT, ArrowRight: Vk.RIGHT, ArrowUp: Vk.UP, ArrowDown: Vk.DOWN, Delete: Vk.DELETE, Home: Vk.HOME, End: Vk.END, PageUp: Vk.PRIOR, PageDown: Vk.NEXT };
  if (named[e.key] !== undefined) return [named[e.key], mods];
  for (let i = 1; i <= 12; i++) if (e.key === `F${i}`) return [0x6f + i, mods];
  if ((e.ctrlKey || e.metaKey || e.altKey) && e.key.length === 1) { const c = e.key.toUpperCase().charCodeAt(0); if ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a)) return [c, mods]; }
  return null;
}

/** Typing goes straight to the PC: letters as they are typed, corrections as backspaces, Enter as Enter. */
export function Typing({ input, pcName, inputRef, style }: { input: Typist; pcName: string; inputRef?: (el: HTMLInputElement | null) => void; style?: JSX.CSSProperties }) {
  // A mark before the text: deleting it means a backspace with nothing left here.
  const MARK = '​';
  const [value, setValue] = useState(MARK);
  const el = useRef<HTMLInputElement | null>(null);
  const put = (v: string) => { setValue(v); if (el.current) { el.current.value = v; el.current.setSelectionRange(v.length, v.length); } };
  return (
    <label class={`row no-drag ${glassClass('control', 'capsule')}`} style={{ width: '100%', padding: '13px 16px', gap: 10, ...(style as object) }}>
      <span style={{ color: 'var(--muted)' }}><Icon name="keyboard" size={20} /></span>
      <span class="grow" style={{ position: 'relative', display: 'flex', minWidth: 0 }}>
      {value.length <= 1 && <span class="t-body faint ellipsis" style={{ position: 'absolute', left: 0, right: 0, pointerEvents: 'none' }}>Type on {pcName}</span>}
      <input ref={(e) => { el.current = e; inputRef?.(e); }} value={value} autoCapitalize="sentences" autoComplete="off" spellcheck={false} enterKeyHint="send"
        aria-label={`Type on ${pcName}`} class="t-body grow" style={{ background: 'none', border: 0, padding: 0, minWidth: 0, width: '100%' }}
        onFocus={(e) => { const t = e.currentTarget; setTimeout(() => t.setSelectionRange(t.value.length, t.value.length), 0); }}
        onSelect={(e) => { const t = e.currentTarget; if (t.selectionStart === 0 && t.value.startsWith(MARK) && t.value.length > 0) t.setSelectionRange(Math.max(1, t.selectionEnd ?? 1), Math.max(1, t.selectionEnd ?? 1)); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); input.key(Vk.RETURN); put(MARK); return; }
          if (e.key === 'Backspace' && (e.currentTarget.value === MARK || e.currentTarget.value === '')) { e.preventDefault(); input.key(Vk.BACK); put(MARK); return; }
          const hw = hardwareKey(e); if (hw) { e.preventDefault(); input.key(hw[0], ...hw[1]); }
        }}
        onInput={(e) => {
          const next = e.currentTarget.value; const old = value.replace(MARK, ''); const lostMark = !next.includes(MARK);
          const now = next.replace(MARK, '');
          const [back, typed] = typedDiff(old, now);
          for (let i = 0; i < back + (lostMark ? 1 : 0); i++) input.key(Vk.BACK);
          if (typed) typed.split('\n').forEach((part, i) => { if (i > 0) input.key(Vk.RETURN); if (part) input.frame(Frames.text(part)); });
          // What is kept here stays short; the PC has the rest.
          put(MARK + (now.length > 400 ? '' : now));
        }} />
      </span>
    </label>
  );
}
