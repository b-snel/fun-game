// Input: Xbox / standard gamepads + two keyboard halves, with per-device binding and rumble.

const DEAD = 0.16;

const KB = {
  kbL: {
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    fire: ['KeyF', 'Space'], boost: ['ShiftLeft', 'KeyG'], roll: ['KeyR', 'KeyE'], brake: ['KeyQ'],
    join: ['Space', 'KeyF'], start: ['Escape'],
  },
  kbR: {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    fire: ['Slash', 'Numpad0', 'KeyL'], boost: ['Period', 'ShiftRight', 'KeyK'], roll: ['Comma', 'KeyJ'], brake: ['KeyM', 'ControlRight'],
    join: ['Enter', 'NumpadEnter', 'Slash'], start: ['Backspace', 'KeyP'],
  },
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.justPressed = new Set();
    this.pads = [];
    this.prevPadButtons = {};
    this.lastRumble = {};
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.justPressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => {
      this.onConnect?.(e.gamepad);
    });
  }

  poll() {
    this.pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  }

  endFrame() {
    this.justPressed.clear();
    for (const p of this.pads) {
      if (p) this.prevPadButtons[p.index] = p.buttons.map((b) => b.pressed);
    }
  }

  keyDown(codes) {
    return codes.some((c) => this.keys.has(c));
  }
  keyPressed(codes) {
    return codes.some((c) => this.justPressed.has(c));
  }
  pad(i) {
    const p = this.pads[i];
    return p && p.connected ? p : null;
  }
  padPressed(i, b) {
    const p = this.pad(i);
    if (!p || !p.buttons[b]) return false;
    const prev = this.prevPadButtons[i];
    return p.buttons[b].pressed && !(prev && prev[b]);
  }
  padDown(i, b) {
    const p = this.pad(i);
    return !!(p && p.buttons[b] && p.buttons[b].pressed);
  }
  padValue(i, b) {
    const p = this.pad(i);
    return p && p.buttons[b] ? p.buttons[b].value : 0;
  }

  // Returns list of device ids that pressed "join" this frame.
  joinPresses() {
    const out = [];
    for (const id of ['kbL', 'kbR']) if (this.keyPressed(KB[id].join)) out.push(id);
    for (const p of this.pads) {
      if (!p) continue;
      if (this.padPressed(p.index, 0)) out.push('pad' + p.index);
    }
    return out;
  }
  startPressed(dev) {
    if (!dev) return false;
    if (dev.startsWith('pad')) return this.padPressed(+dev.slice(3), 9);
    return this.keyPressed(KB[dev].start);
  }
  anyStartPressed() {
    if (this.keyPressed(['Escape', 'Enter', 'KeyP'])) return true;
    return this.pads.some((p) => p && this.padPressed(p.index, 9));
  }
  pressed(dev, action) {
    if (!dev || dev === 'ai') return false;
    if (dev.startsWith('pad')) {
      const i = +dev.slice(3);
      const map = { confirm: [0], back: [1], invert: [3], roll: [1, 5], boost: [0, 4], start: [9], view: [8] };
      return (map[action] || []).some((b) => this.padPressed(i, b));
    }
    const k = KB[dev];
    const map = { confirm: k.join, back: k.roll, invert: ['KeyI'], roll: k.roll, boost: k.boost, start: k.start, view: ['Tab'] };
    return this.keyPressed(map[action] || []);
  }

  // Read a control state for a bound device.
  read(dev, out) {
    out.mx = 0; out.my = 0; out.fire = false; out.boost = false; out.brake = 0;
    out.rollPressed = false; out.boostPressed = false; out.aimX = 0; out.aimY = 0;
    if (!dev || dev === 'ai') return out;
    if (dev.startsWith('pad')) {
      const i = +dev.slice(3);
      const p = this.pad(i);
      if (!p) return out;
      let x = p.axes[0] || 0, y = p.axes[1] || 0;
      const m = Math.hypot(x, y);
      if (m < DEAD) { x = 0; y = 0; } else {
        const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
        x *= k; y *= k;
      }
      // D-pad also steers.
      if (this.padDown(i, 14)) x = -1;
      if (this.padDown(i, 15)) x = 1;
      if (this.padDown(i, 12)) y = -1;
      if (this.padDown(i, 13)) y = 1;
      out.mx = x;
      out.my = -y;
      const rx = p.axes[2] || 0, ry = p.axes[3] || 0;
      out.aimX = Math.abs(rx) > DEAD ? rx : 0;
      out.aimY = Math.abs(ry) > DEAD ? -ry : 0;
      out.fire = this.padValue(i, 7) > 0.25 || this.padDown(i, 2);
      out.brake = this.padValue(i, 6);
      out.boost = this.padDown(i, 0) || this.padDown(i, 4);
      out.boostPressed = this.padPressed(i, 0) || this.padPressed(i, 4);
      out.rollPressed = this.padPressed(i, 1) || this.padPressed(i, 5);
      return out;
    }
    const k = KB[dev];
    out.mx = (this.keyDown(k.right) ? 1 : 0) - (this.keyDown(k.left) ? 1 : 0);
    out.my = (this.keyDown(k.up) ? 1 : 0) - (this.keyDown(k.down) ? 1 : 0);
    out.fire = this.keyDown(k.fire) || this.keyPressed(k.fire);
    out.boost = this.keyDown(k.boost) || this.keyPressed(k.boost);
    out.boostPressed = this.keyPressed(k.boost);
    out.rollPressed = this.keyPressed(k.roll);
    out.brake = this.keyDown(k.brake) ? 1 : 0;
    return out;
  }

  rumble(dev, strong, weak, ms) {
    if (!dev || !dev.startsWith('pad')) return;
    const i = +dev.slice(3);
    const p = this.pad(i);
    const act = p && p.vibrationActuator;
    if (!act || !act.playEffect) return;
    const now = performance.now();
    const last = this.lastRumble[i];
    // Don't let a weak effect stomp a strong one that is still playing.
    if (last && now < last.until && last.strong > strong + 0.05) return;
    this.lastRumble[i] = { until: now + ms, strong };
    act.playEffect('dual-rumble', {
      startDelay: 0,
      duration: ms,
      strongMagnitude: Math.min(1, strong),
      weakMagnitude: Math.min(1, weak),
    }).catch(() => {});
  }

  static deviceLabel(dev) {
    if (!dev) return '';
    if (dev === 'ai') return 'AI WINGMAN';
    if (dev === 'kbL') return 'KEYBOARD (WASD)';
    if (dev === 'kbR') return 'KEYBOARD (ARROWS)';
    return 'CONTROLLER ' + (+dev.slice(3) + 1);
  }
}
