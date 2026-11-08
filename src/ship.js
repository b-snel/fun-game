import * as THREE from 'three';
import { clamp, damp, rand } from './util.js';
import { makeFrame } from './track.js';
import { Trail, FX } from './fx.js';

export const PLAYER_COLORS = [new THREE.Color(0.2, 0.85, 1.0), new THREE.Color(1.0, 0.55, 0.12)];
export const PLAYER_HEX = ['#38d9ff', '#ff8c1f'];

const LAT_SPEED = 44;
const VERT_SPEED = 28;

function hullGeometry() {
  const V = {
    N: [0, 0.0, -3.7], A: [0, 0.44, -0.7], B: [0, 0.34, 1.9],
    L1: [-0.9, 0, -0.3], R1: [0.9, 0, -0.3], L2: [-0.72, 0.05, 2.1], R2: [0.72, 0.05, 2.1],
    C: [0, -0.34, -0.3], D: [0, -0.24, 2.0], T: [0, 0.1, 2.35],
  };
  const tris = [
    ['N', 'A', 'L1'], ['A', 'B', 'L1'], ['L1', 'B', 'L2'],
    ['N', 'R1', 'A'], ['A', 'R1', 'B'], ['R1', 'R2', 'B'],
    ['L2', 'B', 'T'], ['B', 'R2', 'T'], ['L2', 'T', 'D'], ['T', 'R2', 'D'],
    ['N', 'L1', 'C'], ['L1', 'L2', 'C'], ['C', 'L2', 'D'],
    ['N', 'C', 'R1'], ['R1', 'C', 'R2'], ['C', 'D', 'R2'],
  ];
  const center = new THREE.Vector3(0, 0.02, 0.4);
  const pos = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  for (const t of tris) {
    a.fromArray(V[t[0]]); b.fromArray(V[t[1]]); c.fromArray(V[t[2]]);
    n.subVectors(b, a).cross(m.subVectors(c, a));
    m.copy(a).add(b).add(c).divideScalar(3).sub(center);
    if (n.dot(m) < 0) pos.push(...a.toArray(), ...c.toArray(), ...b.toArray());
    else pos.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function buildShipMesh(color) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const metal = new THREE.MeshStandardMaterial({ color: 0xa8b0ba, metalness: 0.6, roughness: 0.35, flatShading: true, envMapIntensity: 4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.75, roughness: 0.4, flatShading: true, side: THREE.DoubleSide, envMapIntensity: 3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x05080c, metalness: 1, roughness: 0.08, emissive: color, emissiveIntensity: 0.08, flatShading: true });
  const glowMat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.4) });
  const accentMat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.2) });

  body.add(new THREE.Mesh(hullGeometry(), metal));
  const canopy = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), glass);
  canopy.scale.set(0.3, 0.2, 0.95);
  canopy.position.set(0, 0.36, -0.95);
  body.add(canopy);

  const wingShape = new THREE.Shape();
  wingShape.moveTo(0.5, -0.3);
  wingShape.lineTo(3.0, 1.3);
  wingShape.lineTo(3.0, 1.85);
  wingShape.lineTo(0.5, 1.75);
  wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.08, bevelEnabled: false });
  wingGeo.rotateX(Math.PI / 2);
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(wingGeo, dark);
    w.scale.x = side;
    w.position.y = 0.04;
    w.rotation.z = side * -0.06;
    body.add(w);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.6), accentMat);
    tip.position.set(side * 3.0, -0.13, 1.55);
    body.add(tip);
    // fins
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(1.0, 0);
    finShape.lineTo(1.25, 0.75);
    finShape.lineTo(0.85, 0.75);
    finShape.closePath();
    const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, { depth: 0.06, bevelEnabled: false }), dark);
    fin.rotation.y = Math.PI / 2;
    fin.position.set(side * 0.5, 0.2, 2.2);
    fin.rotation.z = side * 0.25;
    body.add(fin);
    // engine
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 1.2, 10), metal);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(side * 0.42, 0.02, 1.95);
    body.add(eng);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.22, 12), glowMat);
    glow.position.set(side * 0.42, 0.02, 2.56);
    body.add(glow);
    // side accent strip
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 2.0), accentMat);
    strip.position.set(side * 0.8, 0.03, 0.8);
    body.add(strip);
  }
  // exhaust flames (additive cones)
  const flameMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uPow: { value: 1 }, uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `uniform vec3 uColor; uniform float uPow; uniform float uTime; varying vec2 vUv;
      void main(){ float t = vUv.y; float flick = 1.0;
        vec3 c = mix(uColor*3.0, vec3(4.0,4.0,4.5), pow(t, 4.0));
        gl_FragColor = vec4(c * pow(t, 1.5) * uPow * flick, 1.0); }`,
  });
  const flameGeo = new THREE.ConeGeometry(0.24, 1, 12, 1, true);
  flameGeo.translate(0, -0.5, 0);
  flameGeo.rotateX(-Math.PI / 2);
  const flames = [];
  for (const side of [-1, 1]) {
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.position.set(side * 0.42, 0.02, 2.6);
    f.scale.set(1, 1, 2.5);
    body.add(f);
    flames.push(f);
  }
  group.userData = { body, flames, flameMat, metal, glowMat, accentMat };
  return group;
}

export class Player {
  constructor(id, scene, track) {
    this.id = id;
    this.track = track;
    this.color = PLAYER_COLORS[id];
    this.mesh = buildShipMesh(this.color);
    scene.add(this.mesh);
    this.light = new THREE.PointLight(this.color, 12, 22, 1.6);
    scene.add(this.light);
    this.trails = [new Trail(scene, this.color.clone().multiplyScalar(1.1), 0.22, 22), new Trail(scene, this.color.clone().multiplyScalar(1.1), 0.22, 22),
      new Trail(scene, new THREE.Color(0.6, 0.65, 0.7), 0.06, 26), new Trail(scene, new THREE.Color(0.6, 0.65, 0.7), 0.06, 26)];
    this.frame = makeFrame();
    // green rescue beacon shown while downed
    const bGeo = new THREE.CylinderGeometry(0.5, 0.5, 60, 8, 1, true);
    bGeo.translate(0, 30, 0);
    this.beacon = new THREE.Mesh(bGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.9, 0.3), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.beacon.visible = false;
    this.beacon.frustumCulled = false;
    scene.add(this.beacon);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.12, 6, 40), this.beacon.material);
    this.ring.visible = false;
    scene.add(this.ring);
    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.3, 2200);
    this.dev = null;
    this.ctrl = {};
    this.reset(40, id === 0 ? -6 : 6, 5);
  }

  reset(s, x, y) {
    this.s = s; this.x = x; this.y = y;
    this.vs = 0; this.vx = 0; this.vy = 0;
    this.hull = 100;
    this.energy = 60;
    this.boosting = false;
    this.syncT = 0;
    this.rollT = 0; this.rollDir = 1; this.rollCd = 0; this.rollAngle = 0;
    this.fireCd = 0;
    this.downed = false;
    this.reviveT = 0;
    this.invuln = 0;
    this.hitFlash = 0;
    this.shake = 0;
    this.scrapeCd = 0;
    this.bank = 0; this.pitch = 0;
    this.boostPressT = -10;
    this.boostPressPrev = -20;
    this.prevS = s;
    this.camS = s - 12; this.camX = x; this.camY = y + 3;
    this.fovKick = 0;
    this.target = null;
    this.lastHitT = -10;
    this.mesh.visible = true;
    this._place(0);
    this.prevPos.copy(this.pos);
    for (const t of this.trails) t.reset(this.pos);
  }

  get rolling() {
    return this.rollT > 0;
  }
  get vulnerable() {
    return !this.downed && this.rollT <= 0 && this.invuln <= 0 && this.syncT <= 0;
  }

  damage(amount, game, srcPos) {
    if (!this.vulnerable) return false;
    this.hull -= amount;
    this.hitFlash = 1;
    this.shake = Math.min(1.2, this.shake + amount / 25);
    this.invuln = 0.25;
    this.lastHitT = game.time;
    game.input.rumble(this.dev, 0.9, 0.6, 180 + amount * 6);
    game.audio.hit();
    FX.sparkBurst(this.pos, this.up, 18, _c.setRGB(4, 2.5, 1), 30, 1.2, this.vel);
    if (this.hull <= 0) {
      this.hull = 0;
      game.onPlayerDowned(this);
    }
    return true;
  }

  update(dt, game) {
    const c = this.ctrl;
    const tr = this.track;
    const sec = tr.section(this.s);
    this.rollCd -= dt; this.invuln -= dt; this.fireCd -= dt; this.scrapeCd -= dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.5);
    this.shake = Math.max(0, this.shake - dt * 2.8);
    if (this.syncT > 0) this.syncT -= dt;

    if (this.downed) {
      this.prevS = this.s;
      this._updateDowned(dt, game);
      return;
    }

    // boost
    const canBoost = this.energy > 1 && game.controlsLive;
    const wasBoosting = this.boosting;
    this.boosting = c.boost && canBoost;
    if (this.boosting) {
      this.energy -= 24 * dt;
      if (!wasBoosting) {
        game.audio.boost();
        game.input.rumble(this.dev, 0.4, 0.6, 250);
      }
    } else this.energy = Math.min(100, this.energy + 3.5 * dt);
    if (c.boostPressed) { this.boostPressPrev = this.boostPressT; this.boostPressT = game.time; }

    // roll (dodge)
    if (c.rollPressed && this.rollCd <= 0 && game.controlsLive) {
      this.rollT = 0.42;
      this.rollCd = 0.85;
      this.rollDir = c.mx !== 0 ? Math.sign(c.mx) : this.rollDir * -1;
      this.vx += this.rollDir * 34;
      game.audio.roll();
      game.input.rumble(this.dev, 0.2, 0.5, 120);
    }
    if (this.rollT > 0) {
      this.rollT -= dt;
      this.rollAngle = (1 - Math.max(0, this.rollT) / 0.42) * Math.PI * 2 * -this.rollDir;
    } else this.rollAngle = 0;

    // speed
    const live = game.controlsLive ? 1 : 0;
    const base = game.started ? sec.speed * game.speedScale : 0;
    const target = base + (this.boosting ? 48 : 0) + (this.syncT > 0 ? 100 : 0) - c.brake * 42 * live;
    this.vs = damp(this.vs, target, target > this.vs ? 1.6 : 2.6, dt);

    // steering in track space
    const mx = c.mx * live, my = c.my * live;
    this.vx = damp(this.vx, mx * LAT_SPEED, this.rollT > 0 ? 2 : 7, dt);
    this.vy = damp(this.vy, my * VERT_SPEED, 6, dt);
    this.prevS = this.s;
    this.s += this.vs * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // bounds
    const hw = tr.hw(this.s) - 2.4;
    const ceil = Math.min(tr.ceil(this.s) - 2.2, 62);
    if (Math.abs(this.x) > hw) {
      const side = Math.sign(this.x);
      this.x = side * hw;
      const impact = Math.abs(this.vx);
      this.vx = -side * Math.max(6, impact * 0.35);
      this._scrape(game, _v.copy(this.right).multiplyScalar(side), impact);
    }
    if (this.y < 1.4) {
      this.y = 1.4;
      if (this.vy < -8) this._scrape(game, _v.copy(this.up).negate(), -this.vy);
      this.vy = Math.max(0, this.vy);
    }
    if (this.y > ceil) {
      this.y = ceil;
      if (this.vy > 8 && ceil < 60) this._scrape(game, _v.copy(this.up), this.vy);
      this.vy = Math.min(0, this.vy);
    }

    // weapons
    if (c.fire && this.fireCd <= 0 && game.controlsLive) {
      this.fireCd = 1 / 13;
      game.weapons.firePlayer(this, game);
    }

    // visuals
    const targetBank = -this.vx / LAT_SPEED * 0.85;
    this.bank = damp(this.bank, targetBank, 8, dt);
    this.pitch = damp(this.pitch, this.vy / VERT_SPEED * 0.3, 6, dt);
    this._place(dt);
    this._updateCamera(dt, game);
    this._updateFx(dt, game);
  }

  _scrape(game, normal, impact) {
    if (this.scrapeCd > 0) return;
    this.scrapeCd = 0.12;
    const dmg = impact > 20 ? 6 : 2;
    if (this.vulnerable) {
      this.hull -= dmg;
      if (this.hull <= 0) { this.hull = 0; game.onPlayerDowned(this); }
    }
    this.vs *= 0.97;
    this.shake = Math.min(0.6, this.shake + 0.15);
    _p.copy(this.pos).addScaledVector(normal, 1.2);
    FX.sparkBurst(_p, _n.copy(normal).negate().addScaledVector(this.forward, -1.2), 22, _c.setRGB(6, 3.5, 1.2), 35, 0.7, this.vel);
    game.input.rumble(this.dev, 0.6, 0.9, 120);
    game.audio.scrape();
  }

  _place(dt) {
    const fr = this.track.sample(this.s, this.frame);
    this.prevPos.copy(this.pos);
    this.pos.copy(fr.pos).addScaledVector(fr.right, this.x).addScaledVector(fr.up, this.y);
    if (dt > 0) this.vel.subVectors(this.pos, this.prevPos).divideScalar(dt);
    this.forward.copy(fr.tan);
    this.right.copy(fr.right);
    this.up.copy(fr.up);
    _m.makeBasis(fr.right, fr.up, _back.copy(fr.tan).negate());
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.setFromRotationMatrix(_m);
    const body = this.mesh.userData.body;
    body.rotation.set(this.pitch, 0, this.bank + this.rollAngle, 'YXZ');
    if (this.downed) body.rotation.z += performance.now() * 0.002;
    this.light.position.copy(this.pos).addScaledVector(fr.up, -1);
    this.beacon.visible = this.ring.visible = this.downed;
    if (this.downed) {
      this.beacon.position.copy(this.pos);
      this.beacon.quaternion.copy(this.mesh.quaternion);
      this.ring.position.copy(this.pos);
      this.ring.quaternion.copy(this.mesh.quaternion);
      this.ring.rotateX(Math.PI / 2);
      this.ring.scale.setScalar(1 + 0.15 * Math.sin(performance.now() * 0.004));
    }
  }

  _updateCamera(dt, game) {
    const boost = (this.boosting ? 1 : 0) + (this.syncT > 0 ? 1.4 : 0);
    const dist = 11 + boost * 2.5 + this.vs * 0.012;
    this.camS = this.s - dist;
    this.camX = damp(this.camX, this.x * 0.82, 6, dt);
    this.camY = damp(this.camY, this.y * 0.85 + 3.4, 5, dt);
    const tr = this.track;
    const hw = tr.hw(this.camS) - 1;
    const cx = clamp(this.camX, -hw, hw);
    const cy = clamp(this.camY, 1.2, tr.ceil(this.camS) - 1.2);
    tr.toWorld(this.camS, cx, cy, this.camera.position);
    tr.toWorld(this.s + 30, this.x * 0.55, this.y * 0.7 + 1.2, _look);
    // shake
    // smooth, low-frequency shake (no per-frame random jitter)
    const sh = this.shake * this.shake * 0.35 + game.globalShake * 0.5;
    if (sh > 0.001) {
      const t = game.time;
      this.camera.position.addScaledVector(this.right, sh * (Math.sin(t * 13.1) * 0.6 + Math.sin(t * 7.3 + 1.7) * 0.4));
      this.camera.position.addScaledVector(this.up, sh * (Math.sin(t * 11.7 + 0.5) * 0.6 + Math.sin(t * 5.9 + 2.3) * 0.4));
    }
    tr.sample(this.camS + 6, _fr2);
    this.camera.up.copy(_fr2.up).addScaledVector(_fr2.right, -this.bank * 0.12);
    this.camera.lookAt(_look);
    this.fovKick = damp(this.fovKick, boost, 4, dt);
  }

  updateProjection(aspect) {
    const hfov = 96 + this.fovKick * 7 + Math.max(0, this.vs - 80) * 0.04;
    const v = 2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / aspect) * (180 / Math.PI);
    this.camera.fov = clamp(v, 30, 78 + this.fovKick * 8);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  _updateFx(dt, game) {
    const ud = this.mesh.userData;
    const boost = this.boosting ? 1 : 0;
    const pow = 0.35 + boost * 0.5 + (this.syncT > 0 ? 0.6 : 0);
    ud.flameMat.uniforms.uPow.value = pow;
    ud.flameMat.uniforms.uTime.value = game.time;
    for (const f of ud.flames) f.scale.set(1 + boost * 0.3, 1 + boost * 0.3, 1.8 + boost * 3.5 + (this.syncT > 0 ? 4 : 0));
    // engine trails (world space)
    const body = ud.body;
    body.updateWorldMatrix(true, false);
    for (let i = 0; i < 2; i++) {
      _p.set(i ? 0.42 : -0.42, 0.02, 2.7).applyMatrix4(body.matrixWorld);
      this.trails[i].push(_p, this.up, 0.3 + boost * 0.4 + (this.syncT > 0 ? 0.5 : 0));
    }
    for (let i = 0; i < 2; i++) {
      _p.set(i ? 3.0 : -3.0, -0.13, 1.8).applyMatrix4(body.matrixWorld);
      const lat = Math.min(1, Math.abs(this.vx) / 30 + Math.abs(this.vy) / 40 + boost * 0.5);
      this.trails[2 + i].push(_p, this.up, lat * 0.9);
    }
    this.light.intensity = 10 + pow * 6;
    if (this.hull < 35 && Math.random() < (35 - this.hull) / 35) {
      FX.smoke.spawn(this.pos.x, this.pos.y, this.pos.z, this.vel.x * 0.6, this.vel.y * 0.6 + 2, this.vel.z * 0.6, 0.08, 0.08, 0.08, 1.4, 0.8, { grow: 2, alpha: 0.6 });
      if (Math.random() < 0.3) FX.spark(this.pos, _v.copy(this.vel).multiplyScalar(0.8), _c.setRGB(5, 2, 0.5), 0.5, 0.3);
    }
  }

  _updateDowned(dt, game) {
    const partner = game.players[1 - this.id];
    // drift alongside, a little behind and below the partner
    const ts = partner.downed ? this.s + this.vs * dt : partner.s - 6;
    this.vs = partner.downed ? Math.max(0, this.vs - 30 * dt) : partner.vs;
    this.s = partner.downed ? ts : Math.max(damp(this.s, ts, 3, dt), partner.s - 22);
    this.y = damp(this.y, 5, 1, dt);
    this.vx = 0; this.vy = 0;
    this.boosting = false;
    this.bank += dt * 1.5;
    this.pitch = Math.sin(game.time * 2) * 0.2;
    this._place(dt);
    this._updateCamera(dt, game);
    this.mesh.userData.flameMat.uniforms.uPow.value = 0.15;
    for (const t of this.trails) t.push(this.pos, this.up, 0);
    if (Math.random() < 0.7) {
      FX.smoke.spawn(this.pos.x, this.pos.y, this.pos.z, this.vel.x * 0.7, this.vel.y * 0.7 + 3, this.vel.z * 0.7, 0.06, 0.06, 0.06, 2, 1.4, { grow: 2.5, alpha: 0.7 });
      FX.spark(this.pos, _v.copy(this.vel).multiplyScalar(0.8).add(_n.randomDirection().multiplyScalar(6)), _c.setRGB(6, 2, 0.4), 0.7, 0.4);
    }
    this.light.intensity = 15 + 10 * Math.sin(game.time * 3);
  }
}

const _v = new THREE.Vector3(), _p = new THREE.Vector3(), _n = new THREE.Vector3(), _look = new THREE.Vector3(), _back = new THREE.Vector3();
const _m = new THREE.Matrix4(), _c = new THREE.Color();
const _fr2 = makeFrame();
