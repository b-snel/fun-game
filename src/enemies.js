import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, damp, rand, randSign, distPointSegment } from './util.js';
import { FX } from './fx.js';
import { makeFrame } from './track.js';

function droneGeometry() {
  const parts = [];
  const core = new THREE.OctahedronGeometry(1.3, 0);
  core.scale(1.25, 0.6, 1.5);
  parts.push(core);
  for (const s of [-1, 1]) {
    const blade = new THREE.BoxGeometry(2.2, 0.12, 0.9);
    blade.translate(s * 1.9, 0, 0.2);
    blade.rotateZ(s * 0.25);
    parts.push(blade);
    const pod = new THREE.CylinderGeometry(0.35, 0.35, 1.6, 6);
    pod.rotateX(Math.PI / 2);
    pod.translate(s * 2.9, -0.35, 0.3);
    parts.push(pod);
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  g.computeVertexNormals();
  return g;
}

const DRONE_GEO = droneGeometry();
const EYE_GEO = new THREE.SphereGeometry(0.42, 10, 8);
const TURRET_BASE = new THREE.BoxGeometry(2.6, 2.6, 2.6);
const TURRET_GUN = new THREE.CylinderGeometry(0.22, 0.3, 3.2, 8).rotateX(Math.PI / 2).translate(0, 0, -1.8);
const MINE_GEO = new THREE.IcosahedronGeometry(1.2, 0);
const ROCK_GEO = new THREE.DodecahedronGeometry(1, 0);

const DRONE_MAT = new THREE.MeshStandardMaterial({ color: 0x24272c, metalness: 0.9, roughness: 0.3, flatShading: true });
const EYE_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(10, 0.8, 0.4) });
const EYE_MAT_CHARGER = new THREE.MeshBasicMaterial({ color: new THREE.Color(10, 6, 0.4) });
const MINE_MAT = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.8, roughness: 0.4, emissive: 0xff1a00, emissiveIntensity: 1, flatShading: true });
const ROCK_MAT = new THREE.MeshStandardMaterial({ color: 0x3d3835, roughness: 0.95, flatShading: true, emissive: 0x401000, emissiveIntensity: 0.4 });

const SCORES = { hunter: 100, sweeper: 100, charger: 120, diver: 150, turret: 250, mine: 60, rock: 0 };

export class Enemies {
  constructor(scene, track) {
    this.scene = scene;
    this.track = track;
    this.list = [];
    this.hazards = []; // falling rocks / shells
    this.fr = makeFrame();
    // warning rings for falling hazards
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.6, 0.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  }

  clear() {
    for (const e of this.list) this.scene.remove(e.mesh);
    for (const h of this.hazards) { this.scene.remove(h.mesh); this.scene.remove(h.ring); }
    this.list = [];
    this.hazards = [];
  }

  _makeMesh(kind) {
    const g = new THREE.Group();
    if (kind === 'turret') {
      const base = new THREE.Mesh(TURRET_BASE, DRONE_MAT);
      const head = new THREE.Group();
      head.add(new THREE.Mesh(new THREE.SphereGeometry(1.3, 10, 8), DRONE_MAT));
      head.add(new THREE.Mesh(TURRET_GUN, DRONE_MAT));
      const eye = new THREE.Mesh(EYE_GEO, EYE_MAT);
      eye.position.set(0, 0.5, -1.0);
      head.add(eye);
      g.add(base, head);
      g.userData.head = head;
    } else if (kind === 'mine') {
      g.add(new THREE.Mesh(MINE_GEO, MINE_MAT));
    } else {
      g.add(new THREE.Mesh(DRONE_GEO, DRONE_MAT));
      const eye = new THREE.Mesh(EYE_GEO, kind === 'charger' ? EYE_MAT_CHARGER : EYE_MAT);
      eye.position.set(0, -0.1, -1.7);
      g.add(eye);
      if (kind === 'charger') g.scale.setScalar(0.8);
    }
    this.scene.add(g);
    return g;
  }

  spawn(kind, opts, game) {
    const sRef = game.sRef;
    const hw = this.track.hw(sRef + 200);
    const e = {
      kind,
      alive: true,
      s: opts.s ?? sRef + (opts.ds ?? 330),
      x: opts.x ?? rand(-hw + 6, hw - 6),
      y: opts.y ?? rand(4, 18),
      ds: opts.ds ?? rand(50, 120),
      tx: 0, ty: 0,
      hp: { hunter: 3, sweeper: 14, charger: 2, diver: 3, turret: 6, mine: 1 }[kind],
      radius: kind === 'turret' ? 2.2 : kind === 'mine' ? 1.8 : 2.6,
      fireCd: rand(1.2, 2.6),
      retarget: 0,
      t: 0,
      side: opts.side ?? randSign(),
      speed: opts.speed ?? 18,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      prev: new THREE.Vector3(),
      mesh: this._makeMesh(kind),
      flash: 0,
    };
    e.tx = e.x; e.ty = e.y;
    if (kind === 'sweeper') e.ds = opts.ds ?? 80;
    if (kind === 'diver') { e.s = sRef - 40; e.y = 32; e.ds = rand(50, 90); }
    if (kind === 'turret') { e.y = opts.y ?? rand(5, 18); e.x = e.side * (this.track.hw(e.s) - 0.2); }
    this.track.toWorld(e.s, e.x, e.y, e.pos);
    e.prev.copy(e.pos);
    this.list.push(e);
    return e;
  }

  // A horizontal line of drones crossing the track: the tether's favourite meal.
  spawnSweepLine(game, n = 5, ds = 90) {
    const side = randSign();
    const y = rand(4, 14);
    const hw = this.track.hw(game.sRef + 300);
    for (let i = 0; i < n; i++) {
      this.spawn('sweeper', { ds, x: side * (hw + 6 + i * 7), y: y + (i % 2) * 1.5, side: -side, speed: 16 }, game);
    }
  }

  spawnRock(game, ds, shell = false) {
    const s = game.sRef + ds;
    const hw = this.track.hw(s);
    const x = rand(-hw + 5, hw - 5);
    const h = {
      s, x, y: 80, vy: shell ? -60 : -45, r: shell ? 3 : 3.5,
      shell,
      mesh: new THREE.Mesh(ROCK_GEO, shell ? MINE_MAT : ROCK_MAT),
      ring: new THREE.Mesh(this.ringGeo, this.ringMat),
      spin: new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2)),
      pos: new THREE.Vector3(),
    };
    h.mesh.scale.setScalar(h.r);
    this.track.frameMatrix(s, x, 0.15, _m, h.r * 2.2, 1, h.r * 2.2);
    h.ring.matrixAutoUpdate = false;
    h.ring.matrix.copy(_m);
    this.scene.add(h.mesh, h.ring);
    this.hazards.push(h);
  }

  findTarget(pl) {
    let best = null, bestScore = Infinity;
    for (const e of this.list) {
      if (!e.alive) continue;
      _d.subVectors(e.pos, pl.pos);
      const dist = _d.length();
      if (dist > 320 || dist < 4) continue;
      const cos = _d.dot(pl.forward) / dist;
      if (cos < 0.965) continue; // ~15 degree cone
      const sc = (1 - cos) * 900 + dist * 0.4;
      if (sc < bestScore) { bestScore = sc; best = e; }
    }
    return best;
  }

  hit(e, dmg, game, byPlayer) {
    if (!e.alive) return;
    e.hp -= dmg;
    e.flash = 1;
    game.audio.ping();
    if (e.hp <= 0) this.kill(e, game, byPlayer ? 'gun' : 'other', byPlayer);
  }

  kill(e, game, how, byPlayer) {
    if (!e.alive) return;
    e.alive = false;
    const scale = e.kind === 'turret' ? 1.5 : e.kind === 'mine' ? 1.3 : 1.1;
    FX.explosion(e.pos, scale, _v.copy(e.vel).multiplyScalar(0.7), how === 'tether' ? 'plasma' : 'fire');
    game.audio.explode(scale);
    game.onKill(e, how, byPlayer, SCORES[e.kind] || 100);
  }

  update(dt, game) {
    const tr = this.track;
    const sRef = game.sRef;
    const players = game.players;
    for (const e of this.list) {
      if (!e.alive) continue;
      e.t += dt;
      e.flash = Math.max(0, e.flash - dt * 6);
      e.prev.copy(e.pos);
      const hw = tr.hw(e.s);
      const refSpeed = game.refSpeed;
      if (e.kind === 'hunter' || e.kind === 'diver') {
        e.retarget -= dt;
        if (e.retarget <= 0) {
          e.retarget = rand(1.2, 2.6);
          e.tx = rand(-hw + 5, hw - 5);
          e.ty = rand(3, Math.min(22, tr.ceil(e.s) - 4));
          // hunters alternate between hanging back to shoot and slicing through the formation
          if (e.kind === 'hunter') e.ds = Math.random() < 0.4 ? rand(-6, 22) : rand(45, 115);
        }
        const want = sRef + e.ds - e.s;
        const rel = clamp(want * 1.2, e.kind === 'diver' ? -30 : -70, e.kind === 'diver' ? 110 : 45);
        e.s += (refSpeed + rel) * dt;
        e.x = damp(e.x, e.tx, 1.1, dt);
        e.y = damp(e.y, e.ty, e.kind === 'diver' && e.t < 2 ? 0.6 : 1.3, dt);
      } else if (e.kind === 'sweeper') {
        const want = sRef + e.ds - e.s;
        e.s += (refSpeed + clamp(want * 1.5, -80, 40)) * dt;
        if (Math.abs(want) < 40) {
          e.x += e.side * e.speed * dt;
          e.ds -= 19 * dt; // drift back through the players: tether bait
        }
        if (e.ds < -40) { e.alive = false; this.scene.remove(e.mesh); continue; }
        e.y += Math.sin(e.t * 2 + e.x) * dt * 2;
        if (Math.abs(e.x) > hw + 30) { e.alive = false; this.scene.remove(e.mesh); continue; }
      } else if (e.kind === 'charger') {
        // rush at the nearest player
        const tgt = this._nearestPlayer(players, e);
        if (tgt) {
          e.x = damp(e.x, tgt.x, 1.4, dt);
          e.y = damp(e.y, tgt.y, 1.4, dt);
        }
        e.s += (refSpeed - 55) * dt;
      } else if (e.kind === 'turret' || e.kind === 'mine') {
        // static in the world
      }
      tr.toWorld(e.s, e.x, e.y, e.pos);
      if (dt > 0) e.vel.subVectors(e.pos, e.prev).divideScalar(dt);

      // orientation: face nearest player
      const near = this._nearestPlayer(players, e);
      if (e.kind === 'turret') {
        tr.frameMatrix(e.s, e.x, e.y, _m);
        e.mesh.matrixAutoUpdate = true;
        e.mesh.position.copy(e.pos);
        e.mesh.quaternion.setFromRotationMatrix(_m);
        if (near) e.mesh.userData.head.lookAt(near.pos);
      } else {
        e.mesh.position.copy(e.pos);
        if (near) {
          e.mesh.lookAt(near.pos);
          e.mesh.rotateY(Math.PI);
        }
        if (e.kind === 'mine') e.mesh.rotation.set(e.t, e.t * 1.3, 0);
        else e.mesh.rotateZ(Math.sin(e.t * 3) * 0.3);
      }
      const sc = 1 + e.flash * 0.25;
      e.mesh.scale.setScalar((e.kind === 'charger' ? 0.8 : 1) * sc);

      // firing
      if (near && game.controlsLive) {
        const ahead = e.s - near.s;
        e.fireCd -= dt;
        if (e.fireCd <= 0 && ahead > 15 && ahead < 200) {
          if (e.kind === 'hunter' || e.kind === 'diver') {
            e.fireCd = rand(1.4, 2.6) / game.difficulty;
            game.weapons.fireEnemy(e.pos, e.vel, near.pos, near.vel, 115, 7);
          } else if (e.kind === 'turret') {
            e.fireCd = 1.6 / game.difficulty;
            for (let k = 0; k < 3; k++) setTimeout(() => e.alive && game.weapons.fireEnemy(e.pos, e.vel, near.pos, near.vel, 140, 6, 0.04), k * 110);
          } else if (e.kind === 'sweeper') {
            e.fireCd = rand(2.5, 4.5);
            if (Math.random() < 0.4) game.weapons.fireEnemy(e.pos, e.vel, near.pos, near.vel, 100, 6);
          }
        }
      }
      // collisions with players
      for (const pl of players) {
        if (pl.downed) continue;
        const dist = pl.pos.distanceTo(e.pos);
        if (e.kind === 'mine' && dist < 7) {
          pl.damage(18, game);
          this.kill(e, game, 'self');
          break;
        }
        if (dist < e.radius + 1.4) {
          if (pl.syncT > 0) { this.kill(e, game, 'ram', pl); break; }
          pl.damage(e.kind === 'charger' ? 22 : 12, game);
          this.kill(e, game, 'self');
          break;
        }
      }
      // left behind
      if (e.alive && e.s < sRef - 60) {
        e.alive = false;
        this.scene.remove(e.mesh);
      }
    }
    // remove dead
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (!this.list[i].alive) {
        this.scene.remove(this.list[i].mesh);
        this.list.splice(i, 1);
      }
    }

    // falling hazards
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.y += h.vy * dt;
      h.vy -= 20 * dt;
      tr.toWorld(h.s, h.x, h.y, h.pos);
      h.mesh.position.copy(h.pos);
      h.mesh.rotation.x += h.spin.x * dt;
      h.mesh.rotation.y += h.spin.y * dt;
      h.ring.material.opacity = 0.5 + 0.5 * Math.sin(game.time * 20);
      if (h.shell) FX.spark(h.pos, _v.set(0, 20, 0), _c.setRGB(8, 3, 0.6), 2.5, 0.12, { drag: 0 });
      else if (Math.random() < 0.5) FX.smoke.spawn(h.pos.x, h.pos.y, h.pos.z, 0, 5, 0, 0.1, 0.08, 0.07, 3, 1, { grow: 2, alpha: 0.6 });
      let gone = false;
      for (const pl of players) {
        if (!pl.downed && pl.pos.distanceTo(h.pos) < h.r + 1.6) {
          pl.damage(h.shell ? 18 : 24, game);
          gone = true;
        }
      }
      if (h.y <= h.r * 0.5 || gone || h.s < sRef - 60) {
        if (h.s > sRef - 60) {
          FX.explosion(h.pos, h.shell ? 1.6 : 1.3);
          game.audio.explode(1.2);
          for (const pl of players) {
            const d = pl.pos.distanceTo(h.pos);
            if (d < 30) { pl.shake = Math.min(2, pl.shake + (30 - d) / 25); game.input.rumble(pl.dev, 0.7 * (1 - d / 30), 0.4, 200); }
          }
          if (!h.shell) for (let k = 0; k < 12; k++) FX.smoke.spawn(h.pos.x, h.pos.y, h.pos.z, rand(-15, 15), rand(2, 10), rand(-15, 15), 0.12, 0.1, 0.09, 5, 2, { grow: 2.5, alpha: 0.7 });
        }
        this.scene.remove(h.mesh, h.ring);
        this.hazards.splice(i, 1);
      }
    }
  }

  // Tether sweep test. Returns number cut.
  tetherCut(a, b, game, widen = 0) {
    let n = 0;
    for (const e of this.list) {
      if (!e.alive) continue;
      if (distPointSegment(e.pos, a, b) < e.radius + 0.6 + widen) {
        this.kill(e, game, 'tether');
        n++;
      }
    }
    return n;
  }

  _nearestPlayer(players, e) {
    let best = null, bd = Infinity;
    for (const p of players) {
      if (p.downed) continue;
      const d = p.pos.distanceToSquared(e.pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
}

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Matrix4(), _c = new THREE.Color();
