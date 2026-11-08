import * as THREE from 'three';
import { PLAYER_HEX } from './ship.js';
import { clamp } from './util.js';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};

export class HUD {
  constructor() {
    this.root = document.getElementById('hud');
    this.views = [0, 1].map((i) => this._makeView(i));
    this.center = el('div', 'center-stats', this.root);
    this.scoreEl = el('div', 'score', this.center, '0');
    this.comboEl = el('div', 'combo', this.center, '');
    this.timeEl = el('div', 'time', this.center, '0:00.0');
    this.collapseEl = el('div', 'collapse', this.root, '');
    this.banner = el('div', 'banner', this.root);
    this.hint = el('div', 'hint', this.root);
    this.boss = el('div', 'bossbar', this.root, '<div class="bname">THE WARDEN</div><div class="segs"><i></i><i></i><i></i><i></i></div><div class="bphase"></div>');
    this.bossSegs = this.boss.querySelectorAll('i');
    this.bossPhase = this.boss.querySelector('.bphase');
    this.divider = document.getElementById('divider');
    this.big = el('div', 'bigmsg', this.root);
    this.bannerT = 0;
    this.hintT = 0;
    this.bigT = 0;
    this.warnT = 0;
  }

  _makeView(i) {
    const v = el('div', 'view', this.root);
    v.style.setProperty('--pc', PLAYER_HEX[i]);
    const o = {
      root: v,
      tag: el('div', 'ptag', v, `P${i + 1}`),
      reticle: el('div', 'reticle', v, '<b></b><b></b><b></b><b></b>'),
      lock: el('div', 'lock', v),
      partner: el('div', 'partner', v, `<div class="dia"></div><span></span>`),
      arrow: el('div', 'parrow', v, `<div></div><span>P${2 - i}</span>`),
      bars: el('div', 'bars', v, `
        <div class="lbl">HULL</div><div class="bar hull"><div></div></div>
        <div class="lbl">BOOST</div><div class="bar energy"><div></div><span class="mark"></span></div>`),
      speed: el('div', 'speed', v, '<b>0</b><small>KM/H</small>'),
      tether: el('div', 'tether', v, ''),
      pops: el('div', 'pops', v),
      downed: el('div', 'downed', v, '<div class="t1">HULL BREACHED</div><div class="t2">PARTNER: FLY CLOSE TO REVIVE</div><div class="bar rv"><div></div></div>'),
      warn: el('div', 'vwarn', v, ''),
      cut: el('div', 'cut', v, '<div class="t">CUTTING CORE</div><div class="bar"><div></div></div>'),
      sync: el('div', 'syncready', v, 'SYNC READY'),
    };
    o.hullFill = o.bars.querySelector('.hull > div');
    o.energyFill = o.bars.querySelector('.energy > div');
    o.speedNum = o.speed.querySelector('b');
    o.partnerLabel = o.partner.querySelector('span');
    o.arrowInner = o.arrow.querySelector('div');
    o.rvFill = o.downed.querySelector('.rv > div');
    o.cutFill = o.cut.querySelector('.bar > div');
    o.lastHull = -1;
    o.cutT = 0;
    return o;
  }

  setLayout(rects, single) {
    this.views.forEach((v, i) => {
      const r = rects[i];
      v.root.style.display = r ? 'block' : 'none';
      if (!r) return;
      Object.assign(v.root.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      v.rect = r;
    });
    this.divider.style.display = single ? 'none' : 'block';
    this.root.classList.toggle('single', single);
    this.root.classList.toggle('vertical', !single && rects[1] && rects[1].x > 0);
  }

  show(on) {
    this.root.style.display = on ? 'block' : 'none';
    if (!on) this.divider.style.display = 'none';
  }

  banner_(title, sub) {
    this.banner.innerHTML = `<div class="sub">${sub || ''}</div><div class="ttl">${title}</div>`;
    this.banner.classList.remove('on');
    void this.banner.offsetWidth;
    this.banner.classList.add('on');
    this.bannerT = 3.2;
  }

  showHint(text, dur = 5) {
    this.hint.innerHTML = text;
    this.hint.classList.add('on');
    this.hintT = dur;
  }

  bigMsg(text, cls = '', dur = 1.6) {
    this.big.innerHTML = text;
    this.big.className = 'bigmsg on ' + cls;
    void this.big.offsetWidth;
    this.bigT = dur;
  }

  flashWarning(text) {
    for (const v of this.views) {
      v.warn.textContent = text;
      v.warn.classList.add('on');
    }
    this.warnT = 2.2;
  }

  popup(i, text, cls = '') {
    const v = this.views[i];
    const p = el('div', 'pop ' + cls, v.pops, text);
    setTimeout(() => p.remove(), 1300);
    while (v.pops.children.length > 5) v.pops.firstChild.remove();
  }

  coreCut(progress) {
    for (const v of this.views) {
      v.cutT = 0.2;
      v.cutFill.style.width = clamp(progress, 0, 1) * 100 + '%';
    }
  }

  update(dt, game) {
    this.bannerT -= dt;
    if (this.bannerT <= 0) this.banner.classList.remove('on');
    this.hintT -= dt;
    if (this.hintT <= 0) this.hint.classList.remove('on');
    this.bigT -= dt;
    if (this.bigT <= 0) this.big.classList.remove('on');
    this.warnT -= dt;
    if (this.warnT <= 0) for (const v of this.views) v.warn.classList.remove('on');

    this.scoreEl.textContent = game.score.toLocaleString();
    this.comboEl.textContent = game.combo > 1 ? `×${game.combo}` : '';
    this.comboEl.style.opacity = game.combo > 1 ? clamp(game.comboT / 1.0, 0.3, 1) : 0;
    const t = game.runTime;
    this.timeEl.textContent = `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

    // collapse proximity
    const cd = game.collapseDist;
    if (game.collapseActive && cd < 260) {
      this.collapseEl.style.display = 'block';
      this.collapseEl.textContent = `COLLAPSE  ${Math.max(0, cd | 0)}M`;
      this.collapseEl.classList.toggle('danger', cd < 110);
    } else this.collapseEl.style.display = 'none';

    // boss bar
    const b = game.boss;
    if (b.active && !b.dead) {
      this.boss.style.display = 'block';
      this.bossSegs.forEach((s, i) => s.classList.toggle('dead', !b.cores[i].alive));
      const ph = { intro: 'INCOMING', barrage: 'BARRAGE — WAIT FOR THE LOW PASS', pass: 'LOW PASS — CUT THE CORES', stagger: 'STAGGERED' }[b.phase] || '';
      this.bossPhase.textContent = ph;
      this.bossPhase.classList.toggle('hot', b.phase === 'pass');
    } else this.boss.style.display = 'none';

    for (let i = 0; i < 2; i++) this._updateView(i, game, dt);
  }

  _updateView(i, game, dt) {
    const v = this.views[i];
    if (!v.rect || v.root.style.display === 'none') return;
    const p = game.players[i];
    const other = game.players[1 - i];
    const cam = p.camera;
    const W = v.rect.w, H = v.rect.h;

    if (v.lastHull !== (p.hull | 0)) {
      v.hullFill.style.width = p.hull + '%';
      v.hullFill.classList.toggle('low', p.hull < 35);
      v.lastHull = p.hull | 0;
    }
    v.energyFill.style.width = p.energy + '%';
    v.energyFill.classList.toggle('ok', p.energy >= 30);
    v.speedNum.textContent = Math.round(p.vs * 3.6);
    v.root.classList.toggle('boosting', p.boosting || p.syncT > 0);
    v.root.classList.toggle('hit', p.hitFlash > 0.5);
    v.sync.classList.toggle('on', game.syncReady && !p.downed && game.started);

    // reticle: project a point ahead of the ship
    _v.copy(p.pos).addScaledVector(p.forward, 60);
    const rp = this._project(_v, cam, W, H);
    if (rp) { v.reticle.style.transform = `translate(${rp.x}px, ${rp.y}px)`; v.reticle.style.display = p.downed ? 'none' : 'block'; }
    // lock box
    if (p.target && p.target.alive && !p.downed) {
      const lp = this._project(p.target.pos, cam, W, H);
      if (lp) {
        v.lock.style.display = 'block';
        v.lock.style.transform = `translate(${lp.x}px, ${lp.y}px)`;
      } else v.lock.style.display = 'none';
    } else v.lock.style.display = 'none';

    // partner marker
    const dist = p.pos.distanceTo(other.pos);
    _v.copy(other.pos);
    const pp = this._project(_v, cam, W, H, true);
    const label = other.downed ? 'DOWN!' : `${dist | 0}M`;
    if (pp && pp.on) {
      v.partner.style.display = 'block';
      v.arrow.style.display = 'none';
      v.partner.style.transform = `translate(${pp.x}px, ${pp.y - 26}px)`;
      v.partnerLabel.textContent = `P${2 - i} ${label}`;
      v.partner.classList.toggle('down', other.downed);
    } else if (pp) {
      v.partner.style.display = 'none';
      v.arrow.style.display = 'block';
      const cx = W / 2, cy = H / 2;
      const ang = Math.atan2(pp.y - cy, pp.x - cx);
      const ex = clamp(cx + Math.cos(ang) * W, 40, W - 40);
      const ey = clamp(cy + Math.sin(ang) * H, 40, H - 40);
      v.arrow.style.transform = `translate(${ex}px, ${ey}px)`;
      v.arrowInner.style.transform = `rotate(${ang}rad)`;
      v.arrow.classList.toggle('down', other.downed);
    }

    // tether status
    const T = game.tetherState;
    let ts = '', cls = '';
    if (T.on) {
      if (T.strain > 0.55) { ts = 'TETHER STRAIN'; cls = 'strain'; } else { ts = 'TETHER LINKED'; cls = 'ok'; }
    } else { ts = 'TETHER SNAPPED — CLOSE IN'; cls = 'off'; }
    if (v.tether.textContent !== ts) v.tether.textContent = ts;
    v.tether.className = 'tether ' + cls;

    // downed overlay
    v.downed.classList.toggle('on', p.downed);
    if (p.downed) v.rvFill.style.width = (p.reviveT / game.REVIVE_TIME) * 100 + '%';
    v.cutT -= dt;
    v.cut.classList.toggle('on', v.cutT > 0);
  }

  _project(world, cam, W, H, allowOff = false) {
    _v2.copy(world).applyMatrix4(cam.matrixWorldInverse);
    const behind = _v2.z > 0;
    _v2.applyMatrix4(cam.projectionMatrix);
    let x = (_v2.x * 0.5 + 0.5) * W, y = (-_v2.y * 0.5 + 0.5) * H;
    if (behind) {
      if (!allowOff) return null;
      x = W - x; y = H * 1.5;
    }
    const on = !behind && x > 10 && x < W - 10 && y > 10 && y < H - 10;
    if (!allowOff && !on) return null;
    return { x, y, on };
  }
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
