import * as THREE from 'three';
import { clamp, damp, rand, distPointSegment } from './util.js';
import { FX } from './fx.js';

const CORE_X = [-22, -8, 8, 22];
const HANG = 15;

export class Warden {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.active = false;
    this._build();
  }

  _build() {
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x2c3036, metalness: 0.85, roughness: 0.38, flatShading: true });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.7, roughness: 0.5, flatShading: true });
    const redMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 0.8, 0.3) });
    const engMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3, 1.2) });
    const body = new THREE.Group();
    this.body = body;
    this.group.add(body);
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      body.add(m);
      return m;
    };
    // central spine
    add(new THREE.BoxGeometry(14, 8, 46), hullMat, 0, 0, 0);
    add(new THREE.BoxGeometry(10, 5, 20), darkMat, 0, 5, 4);
    add(new THREE.CylinderGeometry(0, 7, 16, 4), hullMat, 0, 0, -30, -Math.PI / 2, 0, Math.PI / 4);
    // wings
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(26, 3, 26), hullMat, s * 19, -1, 6, 0, s * -0.12, s * 0.06);
      add(new THREE.BoxGeometry(8, 7, 30), darkMat, s * 32, -1, 6);
      add(new THREE.BoxGeometry(2, 10, 14), darkMat, s * 32, 6, 14);
      // engines
      for (const z of [18, 24]) {
        add(new THREE.CylinderGeometry(2.2, 2.6, 6, 10), darkMat, s * 32, -1, z, Math.PI / 2);
        add(new THREE.CircleGeometry(1.9, 12), engMat, s * 32, -1, z + 3.05);
      }
      // running lights
      for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.6, 0.4, 1.4), redMat, s * (8 + i * 4.5), 0.8, -6 + i * 0.5);
    }
    // eye / sensor
    this.eye = add(new THREE.SphereGeometry(2.2, 16, 12), redMat, 0, -3.5, -24);
    // underside turrets
    this.guns = [];
    for (const x of [-14, 14]) {
      const g = add(new THREE.CylinderGeometry(0.6, 0.8, 5, 8), darkMat, x, -5, -12, Math.PI / 2);
      this.guns.push(g);
    }
    // cores + cables
    this.cores = [];
    const coreGeo = new THREE.IcosahedronGeometry(2.1, 1);
    const cableGeo = new THREE.CylinderGeometry(0.18, 0.18, 1, 6);
    cableGeo.translate(0, -0.5, 0);
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group();
      pivot.position.set(CORE_X[i], -4, 2);
      body.add(pivot);
      const cable = new THREE.Mesh(cableGeo, darkMat);
      cable.scale.y = HANG;
      pivot.add(cable);
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 4, 9) }));
      core.position.y = -HANG;
      pivot.add(core);
      const shield = new THREE.Mesh(
        new THREE.SphereGeometry(3.2, 20, 14),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.9, 2.5), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      core.add(shield);
      this.cores.push({ pivot, cable, core, shield, alive: true, cut: 0, pos: new THREE.Vector3(), flash: 0 });
    }
    this.light = new THREE.PointLight(0xff3010, 0, 140, 1.4);
    this.group.add(this.light);
    this.light.position.set(0, -6, 0);
  }

  reset() {
    this.active = false;
    this.dead = false;
    this.group.visible = false;
    for (const c of this.cores) {
      c.alive = true;
      c.cut = 0;
      c.pivot.visible = true;
    }
  }

  start(game) {
    this.reset();
    this.active = true;
    this.group.visible = true;
    this.s = game.sRef - 120; // swoops in from behind, overhead
    this.x = 0;
    this.y = 70;
    this.phase = 'intro';
    this.phaseT = 0;
    this.atkT = 3;
    this.dsTarget = 110;
    this.yTarget = 32;
    this.stagger = 0;
    this.time = 0;
    this.deathT = 0;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    game.audio.boom();
    game.globalShake = 0.6;
  }

  get coresLeft() {
    return this.cores.filter((c) => c.alive).length;
  }

  bulletHit(b, game) {
    for (const c of this.cores) {
      if (!c.alive) continue;
      if (distPointSegment(c.pos, b.prev, b.p) < 3.3) {
        c.flash = 1;
        FX.sparkBurst(b.p, _v.subVectors(b.p, c.pos).normalize(), 6, _c.setRGB(2, 5, 9), 25, 0.6, this.vel);
        game.onShielded();
        return true;
      }
    }
    // the hull soaks bullets
    if (b.p.distanceTo(this.pos) < 26) {
      FX.sparkBurst(b.p, _v.subVectors(b.p, this.pos).normalize(), 4, _c.setRGB(5, 3, 1), 20, 0.6, this.vel);
      return true;
    }
    return false;
  }

  update(dt, game) {
    if (!this.active) return;
    this.time += dt;
    this.phaseT += dt;
    const tr = this.track;
    const left = this.coresLeft;
    const rage = 1 + (4 - left) * 0.25;

    if (this.dead) {
      this._updateDeath(dt, game);
      return;
    }

    // phase machine: barrage (far, high) <-> strafe pass (close, low: cores reachable)
    if (this.phase === 'intro' && this.phaseT > 4) this._setPhase('barrage');
    if (this.phase === 'barrage' && this.phaseT > 9 / rage) this._setPhase('pass');
    if (this.phase === 'pass' && this.phaseT > 9) this._setPhase('barrage');
    if (this.phase === 'stagger' && this.phaseT > 3.5) this._setPhase(left ? 'barrage' : 'dying');

    if (this.phase === 'intro') { this.dsTarget = 90; this.yTarget = 34; }
    if (this.phase === 'barrage') { this.dsTarget = 115; this.yTarget = 34; }
    if (this.phase === 'pass') { this.dsTarget = 8 + Math.sin(this.phaseT * 0.8) * 10; this.yTarget = 26; }
    if (this.phase === 'stagger') { this.dsTarget = 150; this.yTarget = 46; }

    const want = game.sRef + this.dsTarget - this.s;
    const maxRel = this.phase === 'intro' ? 140 : 28;
    this.s += (game.refSpeed + clamp(want * 0.8, -maxRel, maxRel)) * dt;
    const hw = tr.hw(this.s);
    const xAmp = this.phase === 'pass' ? hw - 26 : hw - 30;
    this.x = damp(this.x, Math.sin(this.time * 0.37 * rage) * Math.max(0, xAmp), 1.2, dt);
    this.y = damp(this.y, this.yTarget, 0.8, dt);

    this.prev.copy(this.pos);
    tr.frameMatrix(this.s, this.x, this.y, _m);
    this.group.matrixAutoUpdate = true;
    this.group.position.setFromMatrixPosition(_m);
    this.group.quaternion.setFromRotationMatrix(_m);
    this.pos.copy(this.group.position);
    if (dt > 0) this.vel.subVectors(this.pos, this.prev).divideScalar(dt);
    this.stagger = Math.max(0, this.stagger - dt);
    this.body.rotation.set(
      Math.sin(this.time * 0.9) * 0.05 + (this.stagger > 0 ? Math.sin(this.time * 30) * 0.06 : 0),
      0,
      -Math.cos(this.time * 0.37 * rage) * 0.18 + (this.stagger > 0 ? Math.sin(this.time * 23) * 0.1 : 0)
    );
    this.group.updateMatrixWorld(true);
    this.light.intensity = 900 + Math.sin(this.time * 6) * 300;

    // cores swing & tether cutting
    const T = game.tetherState;
    const A = game.players[0].pos, B = game.players[1].pos;
    for (let i = 0; i < 4; i++) {
      const c = this.cores[i];
      if (!c.alive) continue;
      c.pivot.rotation.x = Math.sin(this.time * 1.7 + i) * 0.25 - Math.min(0.5, this.vel.length() * 0.0) ;
      c.pivot.rotation.z = Math.sin(this.time * 1.3 + i * 2) * 0.18;
      c.core.getWorldPosition(c.pos);
      c.core.rotation.y += dt * 2;
      c.flash = Math.max(0, c.flash - dt * 4);
      c.shield.material.opacity = 0.18 + c.flash * 0.5 + Math.random() * 0.05;
      if (T.on && distPointSegment(c.pos, A, B) < 3.4 + (T.sync ? 2.5 : 0)) {
        c.cut += dt * (T.sync ? 6 : 1);
        c.flash = 1;
        game.onCoreCutting(c, c.cut / 0.35);
        FX.sparkBurst(c.pos, _v.subVectors(game.players[0].pos, c.pos).normalize(), 6, _c.setRGB(3, 6, 10), 40, 1.2, this.vel);
        if (c.cut >= 0.35) this._destroyCore(c, game);
      }
    }

    // attacks
    this.atkT -= dt;
    if (this.atkT <= 0 && game.controlsLive && this.phase !== 'stagger' && this.phase !== 'intro') {
      const r = Math.random();
      const alive = game.players.filter((p) => !p.downed);
      if (!alive.length) return;
      if (this.phase === 'barrage') {
        if (r < 0.45) {
          const n = 3 + (4 - left);
          for (let k = 0; k < n; k++) {
            setTimeout(() => {
              if (!this.active || this.dead) return;
              _v.set((k % 2 ? 1 : -1) * 20, 2, 0).applyMatrix4(this.body.matrixWorld);
              game.weapons.fireMissile(_v, this.vel, alive[k % alive.length]);
              game.audio.beep(300, 0.08, 0.06);
            }, k * 160);
          }
          game.hud.flashWarning('MISSILES INBOUND — ROLL OR SHOOT THEM');
          this.atkT = 3.2 / rage;
        } else if (r < 0.8) {
          for (let k = 0; k < 4 + left; k++) setTimeout(() => this.active && !this.dead && game.enemies.spawnRock(game, rand(120, 220), true), k * 220);
          game.hud.flashWarning('ARTILLERY — WATCH THE FLOOR');
          this.atkT = 2.8 / rage;
        } else {
          game.enemies.spawnSweepLine(game, 4 + (4 - left), 100);
          game.enemies.spawn('hunter', {}, game);
          this.atkT = 2.6 / rage;
        }
      } else if (this.phase === 'pass') {
        // underside guns spray at players while low
        for (const g of this.guns) {
          g.getWorldPosition(_v);
          for (const p of alive) game.weapons.fireEnemy(_v, this.vel, p.pos, p.vel, 150, 6, 0.06);
        }
        this.atkT = 0.7 / rage;
      }
    }
  }

  _setPhase(p) {
    this.phase = p;
    this.phaseT = 0;
    this.atkT = p === 'pass' ? 1.2 : 1.5;
    this.onPhase?.(p);
  }

  _destroyCore(c, game) {
    c.alive = false;
    c.pivot.visible = false;
    FX.explosion(c.pos, 3, this.vel, 'plasma');
    FX.explosion(c.pos, 2, this.vel);
    game.audio.boom();
    this.stagger = 2.5;
    this._setPhase('stagger');
    game.onCoreDestroyed(this.coresLeft);
    for (let k = 0; k < 5; k++) {
      setTimeout(() => {
        if (!this.active) return;
        _v.set(rand(-30, 30), rand(-3, 4), rand(-20, 20)).applyMatrix4(this.body.matrixWorld);
        FX.explosion(_v, 1.5, this.vel);
        game.audio.explode(1.4);
      }, 200 + k * 260);
    }
    if (this.coresLeft === 0) {
      this.dead = true;
      this.deathT = 0;
      game.onBossDying();
    }
  }

  _updateDeath(dt, game) {
    this.deathT += dt;
    const tr = this.track;
    // limp forward, lose altitude, nose down, then slam into the floor ahead
    this.s += (game.refSpeed - 10) * dt;
    this.y -= (4 + this.deathT * 9) * dt;
    this.prev.copy(this.pos);
    tr.frameMatrix(this.s, this.x, Math.max(2, this.y), _m);
    this.group.position.setFromMatrixPosition(_m);
    this.group.quaternion.setFromRotationMatrix(_m);
    this.body.rotation.x = -this.deathT * 0.12;
    this.body.rotation.z += dt * 0.35;
    this.pos.copy(this.group.position);
    if (dt > 0) this.vel.subVectors(this.pos, this.prev).divideScalar(dt);
    this.group.updateMatrixWorld(true);
    if (Math.random() < dt * 9) {
      _v.set(rand(-34, 34), rand(-4, 6), rand(-25, 25)).applyMatrix4(this.body.matrixWorld);
      FX.explosion(_v, rand(1, 2.2), this.vel);
      game.audio.explode(1.5);
    }
    for (let k = 0; k < 3; k++) FX.smoke.spawn(this.pos.x + rand(-20, 20), this.pos.y, this.pos.z + rand(-10, 10), this.vel.x * 0.5, 4, this.vel.z * 0.5, 0.05, 0.05, 0.05, 9, 2.5, { grow: 2.5, alpha: 0.8 });
    if (this.y <= 4 && this.group.visible) {
      // final impact
      this.group.visible = false;
      this.active = false;
      for (let k = 0; k < 6; k++) {
        _v.copy(this.pos).add(_v2.set(rand(-25, 25), rand(0, 12), rand(-25, 25)));
        FX.explosion(_v, 4, this.vel.clone().multiplyScalar(0.3));
      }
      FX.light(this.pos, 0xffa050, 20000, 2.5);
      game.audio.boom();
      game.onBossDead(this.pos);
    }
  }
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _c = new THREE.Color();
