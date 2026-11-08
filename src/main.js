import * as THREE from 'three';
import { Track, SECTIONS, sectionAt, sectionById, makeFrame } from './track.js';
import { World } from './world.js';
import { FX } from './fx.js';
import { Player } from './ship.js';
import { TetherFX } from './tether.js';
import { Weapons } from './weapons.js';
import { Enemies } from './enemies.js';
import { Warden } from './boss.js';
import { HUD } from './hud.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { ViewPost } from './post.js';
import { clamp, damp, rand, pick, randSign } from './util.js';

const TETHER_MAX = 80;
const TETHER_STRAIN_START = 48;
const TETHER_RELINK = 42;
const REVIVE_RADIUS = 16;

class Game {
  constructor() {
    this.REVIVE_TIME = 1.5;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.autoClear = true;
    document.body.prepend(renderer.domElement);

    this.scene = new THREE.Scene();
    this.track = new Track();
    this.track.build(this.scene);
    this.world = new World(this.scene, renderer);
    FX.init(this.scene);
    this.players = [new Player(0, this.scene, this.track), new Player(1, this.scene, this.track)];
    this.tetherFX = new TetherFX(this.scene);
    this.weapons = new Weapons(this.scene);
    this.enemies = new Enemies(this.scene, this.track);
    this.boss = new Warden(this.scene, this.track);
    this.hud = new HUD();
    this.audio = new Audio();
    this.input = new Input();
    this._buildGates();
    this.posts = [new ViewPost(renderer, this.scene, this.players[0].camera), new ViewPost(renderer, this.scene, this.players[1].camera)];
    this.titleCam = new THREE.PerspectiveCamera(60, 1, 0.3, 2200);

    this.slots = [null, null];
    this.invert = [false, false];
    this.split = 'h';
    this.state = 'title';
    this.time = 0;
    this.timeScale = 1;
    this.slowT = 0;
    this.slowTarget = 1;
    this.globalShake = 0;
    this.flash = 0;
    this.difficulty = 1;
    this.speedScale = 1;
    this.tetherState = { on: true, strain: 0, form: 1, overT: 0, sync: false };
    this.titleS = 900;
    this.paused = false;
    this.alarm = 0;
    this.collapseDist = 9999;
    this.resetStats();

    const unlock = () => {
      this.audio.init();
      this.audio.setMusic(true, this.state === 'title' ? 1 : this.audio.intensity, this.state === 'title');
      setTimeout(() => this._audioNote(), 100);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('resize', () => this.layout());
    this.layout();
    document.getElementById('loading').remove();
    this.enterTitle();
    this.lastNow = performance.now();
    renderer.setAnimationLoop(() => this.frame());
  }

  _audioNote() {
    const n = document.getElementById('audioNote');
    if (n) n.style.display = this.audio.ctx && this.audio.ctx.state === 'running' ? 'none' : 'block';
  }

  resetStats() {
    this.score = 0;
    this.combo = 0;
    this.comboT = 0;
    this.maxCombo = 0;
    this.stats = { kills: 0, tetherKills: 0, syncs: 0, revives: 0, downs: 0, blocks: 0, grazes: 0, retries: 0 };
    this.runTime = 0;
  }

  // ---------------- layout & rendering ----------------
  get solo() {
    return this.slots[1] === 'ai' || this.slots[0] === 'ai';
  }
  layout() {
    const W = window.innerWidth, H = window.innerHeight;
    this.renderer.setSize(W, H);
    this.W = W; this.H = H;
    const single = this.state === 'title' || this.solo;
    let rects;
    if (single) rects = [{ x: 0, y: 0, w: W, h: H }, null];
    else if (this.split === 'h') rects = [{ x: 0, y: 0, w: W, h: Math.floor(H / 2) - 1 }, { x: 0, y: Math.ceil(H / 2) + 1, w: W, h: Math.floor(H / 2) - 1 }];
    else rects = [{ x: 0, y: 0, w: Math.floor(W / 2) - 1, h: H }, { x: Math.ceil(W / 2) + 1, y: 0, w: Math.floor(W / 2) - 1, h: H }];
    if (this.solo && this.slots[0] === 'ai') rects = [null, { x: 0, y: 0, w: W, h: H }];
    this.rects = rects;
    rects.forEach((r, i) => r && this.posts[i].setSize(r.w, r.h));
    document.body.classList.toggle('vsplit', !single && this.split === 'v');
    this.hud.setLayout(rects, single);
  }

  render() {
    const r = this.renderer;
    r.setScissorTest(true);
    if (this.state === 'title') {
      const rc = this.rects[0] || this.rects[1];
      const post = this.posts[0];
      post.setCamera(this.titleCam);
      this.titleCam.aspect = rc.w / rc.h;
      this.titleCam.updateProjectionMatrix();
      r.setViewport(0, 0, this.W, this.H);
      r.setScissor(0, 0, this.W, this.H);
      FX.viewH = rc.h * r.getPixelRatio();
      post.u.uSpeed.value = 0.25;
      post.u.uAberr.value = 0.1;
      post.u.uDamage.value = 0;
      post.u.uStatic.value = 0;
      post.u.uFlash.value = 0;
      post.u.uAlarm.value = 0;
      post.u.uTime.value = this.time;
      post.render();
      post.setCamera(this.players[0].camera);
      return;
    }
    for (let i = 0; i < 2; i++) {
      const rc = this.rects[i];
      if (!rc) continue;
      const p = this.players[i];
      p.updateProjection(rc.w / rc.h);
      const gy = this.H - rc.y - rc.h;
      r.setViewport(rc.x, gy, rc.w, rc.h);
      r.setScissor(rc.x, gy, rc.w, rc.h);
      FX.viewH = rc.h * r.getPixelRatio();
      const u = this.posts[i].u;
      const boost = (p.boosting ? 0.6 : 0) + (p.syncT > 0 ? 1 : 0);
      u.uSpeed.value = clamp((p.vs - 70) / 110, 0, 1) * 0.8 + boost;
      u.uAberr.value = p.hitFlash * 1.5 + (p.syncT > 0 ? 0.8 : 0) + boost * 0.3;
      u.uDamage.value = p.hitFlash * 0.9 + (p.hull < 30 && !p.downed ? (0.25 + 0.2 * Math.sin(this.time * 8)) : 0);
      u.uStatic.value = p.downed ? 0.55 + Math.random() * 0.15 : (this.state === 'failed' ? 0.8 : 0);
      u.uFlash.value = this.flash;
      u.uAlarm.value = this.alarm || 0;
      u.uTime.value = this.time;
      this.posts[i].render();
    }
  }

  // ---------------- state transitions ----------------
  enterTitle() {
    this.state = 'title';
    this.paused = false;
    this.slots = [null, null];
    this.joinT = -1;
    this.enemies.clear();
    this.weapons.clear();
    this.boss.reset();
    FX.clear();
    this.world.setMood('trench');
    this.hud.show(false);
    for (const id of ['results', 'fail', 'pause']) document.getElementById(id).classList.remove('on');
    document.getElementById('title').classList.add('on');
    this._renderSlots();
    this.layout();
    this.audio.setMusic(true, 1, true);
    this.players.forEach((p) => p.reset(this.titleS + 30, p.id ? 6 : -6, 8));
    this._audioNote();
  }

  _renderSlots() {
    for (let i = 0; i < 2; i++) {
      const el = document.getElementById('slot' + i);
      const dev = this.slots[i];
      el.classList.toggle('joined', !!dev);
      el.querySelector('.dev').textContent = dev ? Input.deviceLabel(dev) + (this.invert[i] ? ' · INVERTED' : '') : '';
      el.querySelector('.st').innerHTML = dev
        ? 'READY'
        : `PRESS <span class="glyph">A</span> / ${i === 0 ? 'SPACE' : 'ENTER'} TO JOIN`;
    }
  }

  startRun() {
    document.getElementById('title').classList.remove('on');
    this.resetStats();
    this.difficulty = this.solo ? 0.85 : 1;
    this.players.forEach((p, i) => { p.dev = this.slots[i]; });
    this.state = 'countdown';
    this.layout();
    this.hud.show(true);
    this.startFromCheckpoint('hangar');
  }

  startFromCheckpoint(id) {
    const sec = sectionById(id);
    this.checkpoint = id;
    const s0 = id === 'hangar' ? 40 : sec.start + 30;
    this.enemies.clear();
    this.weapons.clear();
    this.boss.reset();
    FX.clear();
    for (const p of this.players) p.reset(s0, p.id === 0 ? -7 : 7, 5);
    this.tetherState = { on: true, strain: 0, form: 1, overT: 0, sync: false };
    this.collapseS = s0 - (id === 'hangar' ? 900 : 420);
    this.collapseActive = false;
    this.collapseDist = 9999;
    this.alarm = 0;
    this.curSection = null;
    this.extraction = false;
    this.finishS = Infinity;
    this.syncCd = 0;
    this.speedScale = 1;
    this.flash = 0;
    this.timeScale = 1;
    this.slowT = 0;
    this.events = this._buildEvents();
    this.eventIdx = this.events.findIndex((e) => e.s >= s0);
    if (this.eventIdx < 0) this.eventIdx = this.events.length;
    this.state = 'countdown';
    this.countT = id === 'hangar' ? 3.6 : 2.6;
    this.lastCount = -1;
    this.started = false;
    this.controlsLive = false;
    this.paused = false;
    this.rockT = 0;
    this.wallBoomT = 0;
    for (const o of ['fail', 'results', 'pause']) document.getElementById(o).classList.remove('on');
    this.world.setMood(id === 'hangar' ? 'hangar' : id);
    this.audio.setMusic(true, 0.5, false);
    this.sRef = s0;
    this.refSpeed = 0;
  }

  // ---------------- events / pacing ----------------
  _buildEvents() {
    const ev = [];
    const E = (s, fn) => ev.push({ s, fn });
    const H = (s, text, dur = 6) => E(s, (g) => g.hud.showHint(text, dur));
    const cap = (g) => g.enemies.list.length < 26;
    const waves = {
      sweep: (g) => g.enemies.spawnSweepLine(g, 5 + ((Math.random() * 3) | 0), rand(70, 110)),
      hunters: (g) => { for (let i = 0; i < 3; i++) g.enemies.spawn('hunter', { ds: 300 + i * 25 }, g); },
      chargers: (g) => { for (let i = 0; i < 3; i++) setTimeout(() => g.state === 'play' && g.enemies.spawn('charger', { ds: 280 }, g), i * 400); },
      divers: (g) => { for (let i = 0; i < 2; i++) g.enemies.spawn('diver', { x: (i ? 1 : -1) * 12 }, g); g.hud.flashWarning('BOGEYS ON YOUR SIX'); },
      mixed: (g) => { g.enemies.spawnSweepLine(g, 4, 120); g.enemies.spawn('hunter', {}, g); g.enemies.spawn('hunter', {}, g); },
      mines: (g) => { const hw = g.track.hw(g.sRef + 300); for (let i = 0; i < 8; i++) g.enemies.spawn('mine', { s: g.sRef + 300 + i * 22, x: rand(-hw + 4, hw - 4), y: rand(3, 16) }, g); },
    };
    const W = (s, list) => E(s, (g) => { if (cap(g)) waves[pick(list)](g); });

    // THE TRENCH
    H(650, 'THE <b>TETHER</b> BETWEEN YOU SLICES THROUGH ANYTHING — <b>FLANK</b> THE DRONES', 6.5);
    E(950, (g) => waves.sweep(g));
    E(1400, (g) => g.enemies.spawnSweepLine(g, 6, 95));
    H(1550, '<k>RT</k> FIRE &nbsp; <k>A</k> BOOST &nbsp; <k>B</k> BARREL ROLL &nbsp; <k>LT</k> AIR-BRAKE', 6);
    E(1700, (g) => waves.hunters(g));
    E(2250, (g) => g.hud.showHint(g.solo ? '<b>DOUBLE-TAP</b> <k>A</k> → <b>SYNC BURST</b> WITH YOUR WINGMAN' : 'HIT <k>A</k> <b>AT THE SAME TIME</b> → <b>SYNC BURST</b>', 6));
    E(2350, (g) => { waves.hunters(g); waves.sweep(g); });
    H(2900, 'THE TETHER ALSO <b>BLOCKS ENEMY FIRE</b> — COVER EACH OTHER', 5);
    for (let s = 3100; s < 5300; s += 260 + Math.random() * 80) W(s, ['sweep', 'hunters', 'chargers', 'mixed', 'divers']);

    // UNDERCITY
    H(5480, 'BEAMS: FLY <b>OVER</b> OR <b>UNDER</b> &nbsp;·&nbsp; LASERS: <k>B</k> <b>ROLL THROUGH</b>', 6);
    let side = 1;
    for (let s = 5900; s < 10000; s += 170 + Math.random() * 90) {
      const ts = s;
      side = -side;
      const sd = side;
      E(ts - 320, (g) => g.enemies.spawn('turret', { s: ts, side: sd, y: rand(5, 20) }, g));
    }
    for (let s = 6100; s < 10100; s += 520 + Math.random() * 200) W(s, ['hunters', 'chargers', 'sweep', 'divers']);

    // COLLAPSE
    H(10300, 'THE WHOLE TRENCH IS COMING DOWN — <b>DO NOT STOP</b>', 5);
    for (let s = 10500; s < 15700; s += 210 + Math.random() * 70) W(s, ['sweep', 'hunters', 'chargers', 'mixed', 'mines', 'divers', 'sweep']);

    // THE WARDEN
    E(16050, (g) => g.startBoss());
    H(16300, 'ITS CORES ARE SHIELDED — <b>CUT THEM WITH THE TETHER</b> ON THE LOW PASS', 8);
    ev.sort((a, b) => a.s - b.s);
    return ev;
  }

  startBoss() {
    this.boss.start(this);
    this.boss.onPhase = (p) => {
      if (p === 'pass') {
        this.hud.flashWarning('LOW PASS — GET UNDER IT AND CUT THE CORES');
        for (const pl of this.players) this.input.rumble(pl.dev, 0.5, 0.3, 300);
      }
    };
    this.hud.banner_('THE WARDEN', 'WARNING — HEAVY GUNSHIP');
    this.collapseActive = false;
  }

  // ---------------- callbacks from entities ----------------
  addScore(n, why) {
    this.score += Math.round(n);
  }

  onKill(e, how, byPlayer, base) {
    if (this.state !== 'play') return;
    this.combo = this.comboT > 0 ? Math.min(10, this.combo + 1) : 1;
    this.comboT = 2.8;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const tether = how === 'tether';
    const mult = this.combo * (tether ? 2 : 1);
    const pts = base * mult;
    this.score += pts;
    this.stats.kills++;
    if (tether) {
      this.stats.tetherKills++;
      this._frameSevers = (this._frameSevers || 0) + 1;
      for (const p of this.players) {
        if (!p.downed) p.energy = Math.min(100, p.energy + 10);
        this.input.rumble(p.dev, 0.55, 0.9, 140);
      }
      this.audio.tetherKill();
    } else if (byPlayer) {
      byPlayer.energy = Math.min(100, byPlayer.energy + 5);
      this.hud.popup(byPlayer.id, `+${pts}`, 'small');
      this.input.rumble(byPlayer.dev, 0.35, 0.3, 90);
    } else if (how === 'ram') {
      this.hud.popup(byPlayer ? byPlayer.id : 0, `RAMMED +${pts}`, 'good');
    }
  }

  onPlayerDowned(p) {
    if (p.downed) return;
    p.downed = true;
    p.reviveT = 0;
    p.boosting = false;
    this.stats.downs++;
    FX.explosion(p.pos, 2, p.vel);
    this.audio.explode(2);
    this.input.rumble(p.dev, 1, 1, 600);
    this.tetherState.on = false;
    this.tetherState.form = 0;
    const other = this.players[1 - p.id];
    if (other.downed) {
      this.fail();
    } else {
      this.hud.popup(other.id, `P${p.id + 1} DOWN — FLY CLOSE TO REVIVE`, 'warn');
      this.hud.bigMsg(`P${p.id + 1} DOWN`, 'red', 1.4);
    }
  }

  onGraze(p) {
    this.stats.grazes++;
    this.score += 50;
    this.hud.popup(p.id, 'CLOSE CALL +50', 'small');
  }

  onTetherBlock() {
    this.stats.blocks++;
    this.score += 20;
    this.audio.ping();
    if (this.time - (this._lastBlockPop || 0) > 0.8) {
      this._lastBlockPop = this.time;
      for (const p of this.players) this.hud.popup(p.id, 'BLOCKED', 'small');
    }
  }

  onShielded() {
    if (this.time - (this._lastShieldMsg || 0) > 5) {
      this._lastShieldMsg = this.time;
      this.hud.flashWarning('SHIELDED — CUT IT WITH THE TETHER');
    }
  }

  onCoreCutting(c, progress) {
    this.hud.coreCut(progress);
    for (const p of this.players) this.input.rumble(p.dev, 0.6, 1, 60);
  }

  onCoreDestroyed(left) {
    this.score += 5000 * Math.max(1, this.combo);
    this.hud.bigMsg(left ? `CORE SEVERED · ${left} LEFT` : 'ALL CORES SEVERED', 'sync', 2);
    this.slow(0.25, 0.7);
    this.globalShake = 0.8;
    this.world.flash = 1;
    for (const p of this.players) this.input.rumble(p.dev, 1, 1, 700);
  }

  onBossDying() {
    this.hud.showHint('IT\'S GOING DOWN — <b>STAY CLEAR</b>', 4);
  }

  onBossDead(pos) {
    this.score += 25000;
    this.slow(0.2, 1.4);
    this.globalShake = 1.6;
    this.flash = 0.45;
    this.world.flash = 1.2;
    for (const p of this.players) this.input.rumble(p.dev, 1, 1, 1500);
    this.hud.bigMsg('WARDEN DOWN', 'sync', 2.5);
    setTimeout(() => {
      if (this.state !== 'play') return;
      this.extraction = true;
      this.finishS = this.sRef + 1800;
      this.speedScale = 1.3;
      this.world.setMood('dawn');
      this.hud.banner_('EXTRACTION', 'DAYLIGHT AHEAD');
      this.hud.showHint('<b>PUNCH IT</b> — HOLD <k>A</k> AND GET OUT OF HERE', 6);
      this.enemies.clear();
    }, 2200);
  }

  slow(scale, dur) {
    this.slowTarget = scale;
    this.slowT = dur;
  }

  fail() {
    this.state = 'failed';
    this.failT = 0;
    this.slow(0.3, 1.2);
    this.stats.retries++;
    this.audio.setMusic(true, 0, true);
    setTimeout(() => this.state === 'failed' && document.getElementById('fail').classList.add('on'), 900);
  }

  victory() {
    this.state = 'victory';
    this.controlsLive = false;
    const timeBonus = Math.max(0, Math.round((330 - this.runTime) * 150));
    const final = this.score + timeBonus;
    const rank = final > 160000 ? 'S' : final > 110000 ? 'A' : final > 70000 ? 'B' : 'C';
    const t = this.runTime;
    const el = document.getElementById('results');
    el.innerHTML = `
      <h2>EXTRACTED</h2>
      <div class="rank">${rank}</div>
      <table>
        <tr><td>SCORE</td><td>${this.score.toLocaleString()}</td></tr>
        <tr><td>TIME BONUS</td><td>+${timeBonus.toLocaleString()}</td></tr>
        <tr><td><b>FINAL</b></td><td><b>${final.toLocaleString()}</b></td></tr>
        <tr><td>TIME</td><td>${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}</td></tr>
        <tr><td>KILLS</td><td>${this.stats.kills}</td></tr>
        <tr><td>TETHER SEVERS</td><td>${this.stats.tetherKills}</td></tr>
        <tr><td>SYNC BURSTS</td><td>${this.stats.syncs}</td></tr>
        <tr><td>SHOTS BLOCKED</td><td>${this.stats.blocks}</td></tr>
        <tr><td>MAX COMBO</td><td>×${this.maxCombo}</td></tr>
        <tr><td>REVIVES</td><td>${this.stats.revives}</td></tr>
      </table>
      <div class="cont">PRESS <span class="glyph">A</span> / SPACE TO FLY AGAIN</div>`;
    setTimeout(() => el.classList.add('on'), 900);
    this.audio.setMusic(true, 1, true);
  }

  // ---------------- main loop ----------------
  frame() {
    const now = performance.now();
    const rawDt = Math.min(0.05, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.input.poll();
    // global toggles
    if (this.input.keyPressed(['Tab']) || this.slots.some((d) => d && d.startsWith('pad') && this.input.padPressed(+d.slice(3), 8))) {
      this.split = this.split === 'h' ? 'v' : 'h';
      this.layout();
    }

    if (this.slowT > 0) {
      this.slowT -= rawDt;
      this.timeScale = damp(this.timeScale, this.slowTarget, 18, rawDt);
    } else this.timeScale = damp(this.timeScale, 1, 4, rawDt);
    const dt = this.paused ? 0 : rawDt * this.timeScale;
    this.time += dt;
    this.globalShake = Math.max(0, this.globalShake - rawDt * 1.2);
    this.flash = Math.max(0, this.flash - rawDt * (this.state === 'victory' ? -0.6 : 1.8));
    if (this.state === 'victory') this.flash = Math.min(0.85, this.flash);

    if (this.state === 'title') this.updateTitle(rawDt);
    else this.updateGame(dt, rawDt);

    this.track.beaconMat.color.setScalar(Math.sin(this.time * 3) > 0.6 ? 8 : 0.4).multiply(_red);
    this.render();
    this.input.endFrame();
  }

  updateTitle(dt) {
    // joins
    for (const dev of this.input.joinPresses()) {
      if (this.slots.includes(dev)) continue;
      const free = this.slots.indexOf(null);
      if (free < 0) break;
      this.slots[free] = dev;
      this.audio.init();
      this.audio.beep(free ? 660 : 880, 0.12, 0.1);
      this._renderSlots();
      this._audioNote();
    }
    for (let i = 0; i < 2; i++) {
      if (this.slots[i] && this.input.pressed(this.slots[i], 'invert')) {
        this.invert[i] = !this.invert[i];
        this._renderSlots();
      }
    }
    const joined = this.slots.filter(Boolean).length;
    if (joined === 2) {
      if (this.joinT < 0) this.joinT = 0.7;
      this.joinT -= dt;
      if (this.joinT <= 0) this.startRun();
    } else if (joined === 1 && (this.input.keyPressed(['KeyP', 'Escape']) || this.input.pads.some((p) => p && this.input.padPressed(p.index, 9)))) {
      const free = this.slots.indexOf(null);
      this.slots[free] = 'ai';
      this.startRun();
      return;
    }
    // attract-mode flythrough
    this.titleS += 70 * dt;
    if (this.titleS > 5000) this.titleS = 900;
    const t = performance.now() / 1000;
    const tr = this.track;
    for (const p of this.players) {
      p.s = this.titleS + 26 + Math.sin(t * 0.5 + p.id) * 4;
      p.x = (p.id ? 1 : -1) * (9 + Math.sin(t * 0.7) * 5);
      p.y = 8 + Math.sin(t * 0.9 + p.id * 2) * 3;
      p.vs = 70;
      p.bank = Math.sin(t * 0.7 + p.id) * 0.3;
      p._place(dt);
      p.boosting = false;
      p._updateFx(dt, this);
    }
    tr.toWorld(this.titleS, Math.sin(t * 0.21) * 12, 13 + Math.sin(t * 0.33) * 5, this.titleCam.position);
    tr.toWorld(this.titleS + 60, 0, 7, _v);
    tr.sample(this.titleS, _fr);
    this.titleCam.up.copy(_fr.up);
    this.titleCam.lookAt(_v);
    this.tetherFX.update(this.players[0].pos, this.players[1].pos, { on: true, strain: 0, form: 1, sync: false }, this.time, dt);
    FX.update(dt);
    _mid.addVectors(this.players[0].pos, this.players[1].pos).multiplyScalar(0.5);
    this.world.update(dt, this.time, _mid, _v.copy(this.players[0].forward).multiplyScalar(70), false);
  }

  updateGame(dt, rawDt) {
    const input = this.input;
    const P = this.players;

    // pause
    if (this.state === 'play' || this.state === 'countdown') {
      const anyStart = this.slots.some((d) => d && d !== 'ai' && input.startPressed(d)) || input.keyPressed(['Escape']);
      if (anyStart) {
        this.paused = !this.paused;
        document.getElementById('pause').classList.toggle('on', this.paused);
        this.audio.setMusic(true, this.audio.intensity, this.paused);
      }
      if (this.paused) {
        const pads = this.slots.filter((d) => d && d.startsWith('pad')).map((d) => +d.slice(3));
        const pressedPad = (b) => pads.some((i) => input.padPressed(i, b));
        if (pressedPad(0) || input.keyPressed(['Space', 'Enter'])) { this.paused = false; document.getElementById('pause').classList.remove('on'); this.audio.setMusic(true, this.audio.intensity, false); }
        else if (pressedPad(2) || input.keyPressed(['KeyR'])) { this.stats.retries++; this.startFromCheckpoint(this.checkpoint); }
        else if (pressedPad(1) || input.keyPressed(['KeyQ'])) this.enterTitle();
        return;
      }
    }
    if (this.state === 'failed') {
      this.failT += rawDt;
      if (this.failT > 1.2 && this.slots.some((d) => input.pressed(d, 'confirm'))) this.startFromCheckpoint(this.checkpoint);
    }
    if (this.state === 'victory') {
      if (document.getElementById('results').classList.contains('on') && this.slots.some((d) => input.pressed(d, 'confirm'))) this.enterTitle();
    }

    // countdown
    if (this.state === 'countdown') {
      this.countT -= dt;
      const n = Math.ceil(this.countT - 0.6);
      if (n !== this.lastCount && n >= 1 && n <= 3) {
        this.lastCount = n;
        this.hud.bigMsg(String(n), 'count', 0.9);
        this.audio.beep(440, 0.15, 0.15);
        for (const p of P) input.rumble(p.dev, 0.2, 0.2, 100);
      }
      if (this.countT <= 0.6 && !this.started) {
        this.started = true;
        this.controlsLive = true;
        this.state = 'play';
        this.hud.bigMsg('GO', 'count sync', 1);
        this.audio.beep(880, 0.4, 0.18);
        this.audio.sweep();
        for (const p of P) { input.rumble(p.dev, 0.8, 0.8, 400); p.vs = 40; }
      }
    }

    if (this.state === 'play') this.runTime += dt;

    // controls
    for (let i = 0; i < 2; i++) {
      const p = P[i];
      const dev = this.slots[i];
      if (dev === 'ai') this.aiControl(p, P[1 - i], dt);
      else {
        input.read(dev, p.ctrl);
        if (this.invert[i]) p.ctrl.my = -p.ctrl.my;
      }
      if (this.state !== 'play') { p.ctrl.fire = false; p.ctrl.rollPressed = false; p.ctrl.boostPressed = false; p.ctrl.boost = false; }
    }

    // reference point
    const alive = P.filter((p) => !p.downed);
    this.sRef = alive.length ? alive.reduce((a, p) => a + p.s, 0) / alive.length : P[0].s;
    this.refSpeed = alive.length ? alive.reduce((a, p) => a + p.vs, 0) / alive.length : 0;

    // targeting & player physics
    for (const p of P) {
      p.target = p.downed ? null : this.enemies.findTarget(p);
      p.update(dt, this);
      p.s = Math.min(p.s, this.track.length - 60);
    }
    this._checkSync();
    this._updateTether(dt);
    this._checkObstacles(dt);
    this._updateGates(dt);
    this._updateRevive(dt);

    // sections
    const sec = sectionAt(this.sRef);
    if (sec.id !== this.curSection && this.state !== 'victory') {
      const first = this.curSection === null;
      this.curSection = sec.id;
      if (!this.extraction) this.world.setMood(sec.id);
      if (sec.id !== 'hangar') {
        this.checkpoint = sec.id;
        if (!first || this.checkpoint !== 'hangar') this.hud.banner_(sec.name, sec.subtitle);
        if (!first) this.audio.sweep();
        for (const p of P) if (!p.downed) p.hull = Math.max(p.hull, 70);
      }
      this.collapseActive = ['trench', 'undercity', 'collapse'].includes(sec.id);
    }
    // events
    while (this.state === 'play' && this.eventIdx < this.events.length && this.sRef >= this.events[this.eventIdx].s) {
      this.events[this.eventIdx].fn(this);
      this.eventIdx++;
    }
    if (this.state === 'play') this._updateCollapse(dt, sec);
    if (this.state === 'play' && sec.id === 'collapse') this._collapseSetPiece(dt);

    // entities
    this.enemies.update(dt, this);
    if (this.controlsLive || this.state !== 'countdown') this._frameSevers = 0;
    if (this.tetherState.on && this.state === 'play') {
      this.enemies.tetherCut(P[0].pos, P[1].pos, this, this.tetherState.sync ? 2.5 : 0);
      this._reportSevers();
    }
    this.weapons.update(dt, this);
    this.boss.update(dt, this);
    FX.update(dt);

    // combo decay
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    if (this.syncCd > 0) this.syncCd -= dt;
    this.syncReady = P.every((p) => !p.downed && p.energy >= 30) && this.syncCd <= 0;

    // boss escape
    if (this.state === 'play' && this.boss.active && !this.boss.dead && this.sRef > this.track.length - 900) {
      this.hud.bigMsg('THE WARDEN ESCAPED', 'red', 2);
      this.fail();
    }
    // finish
    if (this.state === 'play' && this.extraction && this.sRef >= this.finishS) {
      this.flash = 0.01;
      this.victory();
    }
    if (this.state === 'victory') { for (const p of P) { p.ctrl.mx = -p.x / 20; p.ctrl.my = (8 - p.y) / 10; } }

    // world, audio, hud
    _mid.addVectors(P[0].pos, P[1].pos).multiplyScalar(0.5);
    _v.addVectors(P[0].vel, P[1].vel).multiplyScalar(0.5);
    const inTunnel = this.track.ceil(this.sRef) < 1e8;
    this.world.update(dt, this.time, _mid, _v, inTunnel);
    this.tetherFX.update(P[0].pos, P[1].pos, this.tetherState, this.time, dt);
    for (const p of P) this.audio.setEngine(p.id, clamp(p.vs / 180, 0, 1), p.boosting ? 1 : p.syncT > 0 ? 1.5 : 0, !p.downed && this.state !== 'title');
    this.audio.setTether(this.tetherState.on && !this.paused, this.tetherState.strain);
    this.audio.setAlarm(this.state === 'play' ? this.alarm : 0);
    const intensity = this.state !== 'play' ? (this.state === 'countdown' ? 0.5 : 1) : { hangar: 1, trench: 2, undercity: 2, collapse: 3, warden: 3 }[sec.id] || 2;
    if (this.state === 'play' && !this.paused) this.audio.setMusic(true, intensity, P.some((p) => p.downed) && false);
    this.hud.update(rawDt, this);
  }

  // ---------------- systems ----------------
  _checkSync() {
    const [a, b] = this.players;
    if (this.state !== 'play' || a.downed || b.downed || this.syncCd > 0) return;
    const window = 0.35;
    const pressedNow = (p) => p.ctrl.boostPressed;
    if ((pressedNow(a) || pressedNow(b)) && Math.abs(a.boostPressT - b.boostPressT) < window && a.energy >= 30 && b.energy >= 30) {
      this.triggerSync();
    }
  }

  triggerSync() {
    const P = this.players;
    this.syncCd = 4;
    this.stats.syncs++;
    for (const p of P) {
      p.syncT = 3;
      p.energy -= 30;
      this.input.rumble(p.dev, 1, 1, 800);
    }
    this.audio.sync();
    this.slow(0.3, 0.35);
    this.flash = 0.55;
    this.hud.bigMsg('SYNC BURST', 'sync', 1.6);
    this.tetherState.on = true;
    this.tetherState.form = 1;
    // shockwave
    let n = 0;
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      if (P.some((p) => p.pos.distanceTo(e.pos) < 55)) { this.enemies.kill(e, this, 'tether'); n++; }
    }
    for (const b of this.weapons.eBolts) if (b.life > 0 && P.some((p) => p.pos.distanceTo(b.p) < 60)) b.life = 0;
    for (const p of P) {
      FX.shell(p.pos, p.id ? 0xff9a40 : 0x40d0ff, 55, 0.7);
      FX.light(p.pos, p.id ? 0xff9a40 : 0x40d0ff, 3000, 0.8);
    }
    this.score += n * 200;
    this._frameSevers = 0;
  }

  _reportSevers() {
    const n = this._frameSevers || 0;
    if (!n) return;
    const label = n >= 4 ? `MEGA SEVER ×${n}` : n === 3 ? 'TRIPLE SEVER' : n === 2 ? 'DOUBLE SEVER' : 'SEVERED';
    for (const p of this.players) this.hud.popup(p.id, label, 'sev');
    if (n >= 2) {
      this.slow(0.4, 0.12 * n);
      this.score += n * 300;
    }
    this._frameSevers = 0;
  }

  _updateTether(dt) {
    const T = this.tetherState;
    const [a, b] = this.players;
    const d = a.pos.distanceTo(b.pos);
    T.sync = a.syncT > 0 || b.syncT > 0;
    T.strain = clamp((d - TETHER_STRAIN_START) / (TETHER_MAX - TETHER_STRAIN_START), 0, 1);
    this.tetherDist = d;
    if (T.on) {
      if (a.downed || b.downed) { T.on = false; T.form = 0; return; }
      if (d > TETHER_MAX && !T.sync) {
        T.overT += dt;
        for (const p of this.players) this.input.rumble(p.dev, 0.15, 0.5, 60);
        if (T.overT > 0.7) this._snap();
      } else T.overT = 0;
      // linked: slow hull regen
      for (const p of this.players) if (this.time - p.lastHitT > 3 && p.hull < 100) p.hull = Math.min(100, p.hull + 2 * dt);
    } else {
      if (!a.downed && !b.downed && d < TETHER_RELINK) {
        T.form += dt * 2.2;
        if (T.form >= 1) {
          T.form = 1;
          T.on = true;
          T.overT = 0;
          this.audio.connect();
          for (const p of this.players) { this.hud.popup(p.id, 'TETHER LINKED', 'good'); this.input.rumble(p.dev, 0.3, 0.6, 150); }
        }
      } else T.form = Math.max(0, T.form - dt * 1.5);
    }
  }

  _snap() {
    const T = this.tetherState;
    T.on = false;
    T.form = 0;
    T.overT = 0;
    this.audio.snap();
    const [a, b] = this.players;
    for (let i = 0; i <= 10; i++) {
      _v.lerpVectors(a.pos, b.pos, i / 10);
      FX.sparkBurst(_v, _v2.randomDirection(), 8, _c.setRGB(4, 4, 6), 25, 1);
    }
    for (const p of this.players) {
      p.damage(6, this);
      this.hud.popup(p.id, 'TETHER SNAPPED', 'warn');
      this.input.rumble(p.dev, 1, 0.8, 350);
    }
  }

  _crash(p, obsPos, dmg) {
    if (p.syncT > 0) {
      // sync burst smashes through
      FX.explosion(obsPos, 1.4, p.vel);
      return false;
    }
    if (p.invuln > 0.3) return false;
    p.hull -= p.rolling ? dmg * 0.6 : dmg;
    p.hitFlash = 1;
    p.shake = 2.2;
    p.invuln = 0.6;
    p.lastHitT = this.time;
    p.vs *= 0.55;
    FX.explosion(obsPos, 0.9, p.vel);
    FX.sparkBurst(p.pos, _v.copy(p.forward).negate(), 40, _c.setRGB(6, 3.5, 1.2), 45, 0.9, p.vel);
    this.audio.hit();
    this.audio.explode(0.9);
    this.input.rumble(p.dev, 1, 1, 450);
    this.hud.popup(p.id, 'IMPACT', 'warn');
    if (p.hull <= 0) { p.hull = 0; this.onPlayerDowned(p); }
    return true;
  }

  _checkObstacles() {
    const tr = this.track;
    for (const p of this.players) {
      if (p.downed) continue;
      tr.queryObstacles(p.s - 4, p.s + 4, _obs);
      for (const o of _obs) {
        const ds = Math.abs(p.s - o.s);
        if (o.type === 'pillar') {
          const dx = p.x - o.x;
          if (ds < o.r + 1.0 && Math.abs(dx) < o.r + 1.4) {
            tr.toWorld(o.s, o.x, p.y, _v);
            if (this._crash(p, _v, 28)) {
              const side = Math.sign(dx) || 1;
              p.x = o.x + side * (o.r + 1.6);
              p.vx = side * 22;
            }
          }
        } else if (o.type === 'beam') {
          const dy = p.y - o.y;
          if (ds < o.r * 1.2 + 1.0 && Math.abs(dy) < o.r + 0.9) {
            tr.toWorld(o.s, p.x, o.y, _v);
            if (this._crash(p, _v, 30)) {
              const side = Math.sign(dy) || 1;
              p.y = o.y + side * (o.r + 1.3);
              p.vy = side * 15;
            }
          }
        }
      }
    }
  }

  _buildGates() {
    this.gateMeshes = [];
    const emitMat = new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.8, roughness: 0.4, emissive: 0xff2000, emissiveIntensity: 0.5 });
    const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(12, 0.8, 0.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 0.12, 0.05), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 6), beamMat);
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1, 8), glowMat);
      const e1 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), emitMat);
      const e2 = e1.clone();
      g.add(beam, glow, e1, e2);
      g.visible = false;
      g.userData = { beam, glow, e1, e2 };
      this.scene.add(g);
      this.gateMeshes.push(g);
    }
  }

  _gateBeam(g, s) {
    const tr = this.track;
    const hw = tr.hw(g.s);
    const ceil = Math.min(tr.ceil(g.s), 28);
    const k = 0.5 + 0.5 * Math.sin(this.time * g.speed + g.phase);
    if (g.kind === 'h') return { y: 2.5 + k * (ceil - 6), x: 0, hw };
    return { x: (k * 2 - 1) * (hw - 3), y: 0, hw, ceil };
  }

  _updateGates() {
    const tr = this.track;
    const near = tr.gates.filter((g) => g.s > this.sRef - 30 && g.s < this.sRef + 500);
    this.gateMeshes.forEach((m, i) => {
      const g = near[i];
      m.visible = !!g;
      if (!g) return;
      const b = this._gateBeam(g);
      const { beam, glow, e1, e2 } = m.userData;
      tr.frameMatrix(g.s, 0, 0, _m);
      m.position.setFromMatrixPosition(_m);
      m.quaternion.setFromRotationMatrix(_m);
      if (g.kind === 'h') {
        for (const o of [beam, glow]) { o.rotation.set(0, 0, Math.PI / 2); o.position.set(0, b.y, 0); o.scale.set(1, b.hw * 2, 1); }
        e1.position.set(-b.hw, b.y, 0); e2.position.set(b.hw, b.y, 0);
      } else {
        const h = Math.min(b.ceil, 40);
        for (const o of [beam, glow]) { o.rotation.set(0, 0, 0); o.position.set(b.x, h / 2, 0); o.scale.set(1, h, 1); }
        e1.position.set(b.x, 0.4, 0); e2.position.set(b.x, h, 0);
      }
      glow.material.opacity = 0.6 + Math.random() * 0.4;
      // crossing test
      for (const p of this.players) {
        if (p.downed) continue;
        if (!(p.prevS <= g.s && p.s >= g.s)) continue;
        const hit = g.kind === 'h' ? Math.abs(p.y - b.y) < 1.4 : Math.abs(p.x - b.x) < 1.6;
        if (!hit) continue;
        if (g.hitBy && g.hitBy[p.id]) continue;
        g.hitBy = g.hitBy || {};
        g.hitBy[p.id] = true;
        setTimeout(() => { if (g.hitBy) g.hitBy[p.id] = false; }, 600);
        if (p.rolling || p.syncT > 0) this.onGraze(p);
        else {
          p.damage(20, this);
          p.vs *= 0.8;
          this.hud.popup(p.id, 'LASER', 'warn');
        }
      }
    });
  }

  _updateRevive(dt) {
    for (const p of this.players) {
      if (!p.downed) continue;
      const other = this.players[1 - p.id];
      if (other.downed) continue;
      const d = p.pos.distanceTo(other.pos);
      if (d < REVIVE_RADIUS) {
        p.reviveT += dt;
        if (Math.random() < 0.5) {
          _v.lerpVectors(other.pos, p.pos, Math.random());
          FX.spark(_v, other.vel, _c.setRGB(1, 6, 2), 1, 0.3, { drag: 0 });
        }
        this.input.rumble(other.dev, 0.1, 0.3, 60);
        if (p.reviveT >= this.REVIVE_TIME) {
          p.downed = false;
          p.hull = 55;
          p.invuln = 2.5;
          p.energy = Math.max(p.energy, 40);
          p.vs = other.vs;
          p.y = Math.max(p.y, 3);
          this.stats.revives++;
          this.audio.revive();
          this.score += 1000;
          this.hud.popup(p.id, 'REVIVED', 'good');
          this.hud.popup(other.id, 'PARTNER REVIVED +1000', 'good');
          this.input.rumble(p.dev, 0.6, 0.8, 400);
          this.input.rumble(other.dev, 0.6, 0.8, 400);
        }
      } else p.reviveT = Math.max(0, p.reviveT - dt * 0.5);
    }
  }

  _updateCollapse(dt, sec) {
    if (!this.collapseActive || this.extraction) { this.alarm = 0; this.collapseDist = 9999; return; }
    const leash = { trench: 520, undercity: 420, collapse: 240 }[sec.id] || 500;
    const factor = { trench: 0.88, undercity: 0.88, collapse: 0.95 }[sec.id] || 0.9;
    const alive = this.players.filter((p) => !p.downed);
    if (!alive.length) return;
    const minS = Math.min(...alive.map((p) => p.s));
    this.collapseS += sec.speed * factor * dt;
    this.collapseS = Math.max(this.collapseS, minS - leash);
    this.collapseDist = minS - this.collapseS;
    this.alarm = clamp((150 - this.collapseDist) / 110, 0, 1);
    // caught by the collapse
    for (const p of alive) {
      if (p.s - this.collapseS < 10) {
        if (p.vulnerable || p.rolling) {
          p.hull -= 45 * dt;
          p.hitFlash = Math.max(p.hitFlash, 0.6);
          p.lastHitT = this.time;
          if (p.hull <= 0) { p.hull = 0; this.onPlayerDowned(p); }
        }
        p.shake = Math.max(p.shake, 1.6);
        p.vs = Math.max(p.vs, sec.speed);
        this.input.rumble(p.dev, 0.9, 0.9, 100);
        if (Math.random() < 0.1) this.hud.popup(p.id, 'GET OUT OF THERE', 'warn');
      }
    }
    // visible destruction rolling up behind
    if (this.collapseDist < 220) {
      this.wallBoomT -= dt;
      if (this.wallBoomT <= 0) {
        this.wallBoomT = 0.06 + this.collapseDist / 1500;
        const s = this.collapseS + rand(-5, 40);
        const hw = this.track.hw(s);
        this.track.toWorld(s, randSign() * (hw + rand(0, 6)), rand(3, 45), _v);
        FX.explosion(_v, rand(1.5, 3));
        if (Math.random() < 0.3) this.audio.explode(1.6);
        // debris hurled forward overhead
        this.track.sample(s, _fr);
        for (let k = 0; k < 3; k++) {
          const d = FX.debrisData[FX.debrisCursor];
          FX.debrisCursor = (FX.debrisCursor + 1) % FX.debrisMax;
          d.p.copy(_v);
          d.v.copy(_fr.tan).multiplyScalar(rand(110, 170)).addScaledVector(_fr.up, rand(10, 30)).addScaledVector(_fr.right, rand(-15, 15));
          d.spin.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
          d.life = rand(1.5, 2.5);
          d.s = rand(1.5, 3.5);
        }
        this.world.flash = Math.max(this.world.flash, 0.4 * (1 - this.collapseDist / 220));
      }
      for (const p of alive) p.shake = Math.max(p.shake, (1 - this.collapseDist / 220) * 0.8);
      this.globalShake = Math.max(this.globalShake, (1 - this.collapseDist / 220) * 0.15);
    }
  }

  _collapseSetPiece(dt) {
    this.rockT -= dt;
    if (this.rockT <= 0) {
      this.rockT = rand(0.5, 1.1);
      this.enemies.spawnRock(this, rand(140, 260));
    }
    // walls detonating ahead
    if (Math.random() < dt * 2.5) {
      const s = this.sRef + rand(120, 350);
      const hw = this.track.hw(s);
      this.track.toWorld(s, randSign() * (hw + 4), rand(15, 70), _v);
      FX.explosion(_v, rand(2.5, 4));
      this.audio.explode(0.8);
    }
  }

  // ---------------- AI wingman ----------------
  aiControl(p, partner, dt) {
    const c = p.ctrl;
    c.fire = false; c.boost = false; c.boostPressed = false; c.rollPressed = false; c.brake = 0; c.mx = 0; c.my = 0;
    if (p.downed) return;
    const tr = this.track;
    const hw = tr.hw(p.s) - 4;
    const ceil = Math.min(tr.ceil(p.s) - 4, 30);
    let tx, ty;
    // pick a target to sandwich with the tether
    let best = null, bd = Infinity;
    for (const e of this.enemies.list) {
      if (!e.alive || e.kind === 'turret' || e.kind === 'mine') continue;
      const ds = e.s - partner.s;
      if (ds < 0 || ds > 140) continue;
      const sc = ds + Math.abs(e.x - partner.x) * 0.5;
      if (sc < bd) { bd = sc; best = e; }
    }
    if (this.boss.active && !this.boss.dead && this.boss.phase === 'pass') {
      const core = this.boss.cores.find((k) => k.alive);
      if (core) {
        tr.worldToTrack(core.pos, this.boss.s, _tc);
        tx = 2 * _tc.x - partner.x;
        ty = 2 * _tc.y - partner.y;
        if (Math.abs(tx - partner.x) < 12) tx = _tc.x + Math.sign(_tc.x - partner.x || 1) * 12;
      }
    }
    if (tx === undefined && best) {
      tx = 2 * best.x - partner.x;
      ty = 2 * best.y - partner.y;
      if (Math.abs(tx - partner.x) < 10) tx = partner.x + (partner.x > 0 ? -16 : 16);
    }
    if (tx === undefined) {
      tx = partner.x + (partner.x > 0 ? -18 : 18);
      ty = partner.y + Math.sin(this.time * 0.7) * 3;
    }
    tx = clamp(tx, -hw, hw);
    ty = clamp(ty, 3, ceil);
    // obstacle avoidance
    tr.queryObstacles(p.s, p.s + 80, _obs);
    for (const o of _obs) {
      if (o.type === 'pillar' && Math.abs(tx - o.x) < o.r + 4) tx = o.x + (tx > o.x ? 1 : -1) * (o.r + 5);
      if (o.type === 'beam' && Math.abs(ty - o.y) < o.r + 4) ty = o.y > 12 ? 4 : o.y + 6;
    }
    for (const h of this.enemies.hazards) {
      const ds = h.s - p.s;
      if (ds > 0 && ds < 90 && Math.abs(tx - h.x) < 9) tx = h.x + (tx > h.x ? 10 : -10);
    }
    tx = clamp(tx, -hw, hw);
    c.mx = clamp((tx - p.x) / 7, -1, 1);
    c.my = clamp((ty - p.y) / 5, -1, 1);
    // pace
    const ds = partner.s - p.s;
    if (ds < -5) c.brake = clamp(-ds / 12, 0, 1);
    if (ds > 10 && p.energy > 35) c.boost = true;
    if (partner.syncT <= 0 && this.time - partner.boostPressT < 0.12 && partner.boostPressT - partner.boostPressPrev < 0.4 && p.energy >= 30 && this.syncCd <= 0) {
      c.boostPressed = true;
      c.boost = true;
      p.boostPressT = this.time;
    }
    if (this.extraction) c.boost = p.energy > 5;
    c.fire = !!p.target;
    // dodge: incoming bolts or gates
    for (const b of this.weapons.eBolts) {
      if (b.life > 0 && b.p.distanceTo(p.pos) < 18 && Math.random() < 0.08) { c.rollPressed = true; break; }
    }
    for (const g of tr.gates) if (g.s - p.s > 0 && g.s - p.s < 12) c.rollPressed = true;
  }
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _mid = new THREE.Vector3(), _m = new THREE.Matrix4(), _c = new THREE.Color();
const _red = new THREE.Color(1, 0.06, 0.04);
const _fr = makeFrame();
const _obs = [];
const _tc = {};

window.game = new Game();
window.game.__FX = FX; // debug handle
