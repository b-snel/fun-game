import * as THREE from 'three';
import { distPointSegment, distSegmentSegment, rand } from './util.js';
import { FX } from './fx.js';
import { PLAYER_COLORS } from './ship.js';

const P_MAX = 400, E_MAX = 300, M_MAX = 40;

export class Weapons {
  constructor(scene) {
    const boltGeo = new THREE.BoxGeometry(0.14, 0.14, 5);
    this.pMesh = new THREE.InstancedMesh(boltGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), P_MAX);
    this.pMesh.frustumCulled = false;
    this.pBolts = [];
    for (let i = 0; i < P_MAX; i++) {
      this.pBolts.push({ p: new THREE.Vector3(), prev: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, owner: 0 });
      this.pMesh.setMatrixAt(i, _zero);
      this.pMesh.setColorAt(i, PLAYER_COLORS[0]);
    }
    this.pCursor = 0;
    const eGeo = new THREE.SphereGeometry(0.42, 8, 6);
    eGeo.scale(1, 1, 4.5);
    this.eMesh = new THREE.InstancedMesh(eGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 1.6, 0.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), E_MAX);
    this.eMesh.frustumCulled = false;
    this.eBolts = [];
    for (let i = 0; i < E_MAX; i++) {
      this.eBolts.push({ p: new THREE.Vector3(), prev: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, dmg: 7 });
      this.eMesh.setMatrixAt(i, _zero);
    }
    this.eCursor = 0;
    // missiles
    const mGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 8);
    mGeo.rotateX(Math.PI / 2);
    this.mMesh = new THREE.InstancedMesh(mGeo, new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.8, roughness: 0.4, emissive: 0xff2010, emissiveIntensity: 0.6 }), M_MAX);
    this.mMesh.frustumCulled = false;
    this.missiles = [];
    for (let i = 0; i < M_MAX; i++) {
      this.missiles.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, target: null, lock: true, radius: 1.8, alive: false });
      this.mMesh.setMatrixAt(i, _zero);
    }
    scene.add(this.pMesh, this.eMesh, this.mMesh);
    this.side = [0, 0];
  }

  clear() {
    for (const b of this.pBolts) b.life = 0;
    for (const b of this.eBolts) b.life = 0;
    for (const m of this.missiles) { m.life = 0; m.alive = false; }
  }

  firePlayer(pl, game) {
    const b = this.pBolts[this.pCursor];
    this.pCursor = (this.pCursor + 1) % P_MAX;
    this.side[pl.id] ^= 1;
    const sx = this.side[pl.id] ? 1.1 : -1.1;
    const body = pl.mesh.userData.body;
    b.p.set(sx, -0.05, -1.5).applyMatrix4(body.matrixWorld);
    b.prev.copy(b.p);
    const speed = 460;
    // auto-aim: lead the locked target
    const tgt = pl.target;
    if (tgt && tgt.alive) {
      const dist = tgt.pos.distanceTo(b.p);
      const t = dist / speed;
      _aim.copy(tgt.pos).addScaledVector(tgt.vel, t).addScaledVector(pl.vel, -t);
      _dir.subVectors(_aim, b.p).normalize();
    } else {
      _dir.set(0, 0, -1).applyQuaternion(body.getWorldQuaternion(_q)).normalize();
    }
    b.v.copy(_dir).multiplyScalar(speed).add(pl.vel);
    b.life = 0.85;
    b.owner = pl.id;
    this.pMesh.setColorAt(this.pCursor === 0 ? P_MAX - 1 : this.pCursor - 1, _col.copy(PLAYER_COLORS[pl.id]).multiplyScalar(1.3).addScalar(0.25));
    this.pMesh.instanceColor.needsUpdate = true;
    FX.spark(b.p, pl.vel, _col.copy(PLAYER_COLORS[pl.id]).multiplyScalar(4), 1.4, 0.06, { drag: 0 });
    game.audio.shoot(pl.id);
    game.input.rumble(pl.dev, 0.0, 0.15, 40);
  }

  fireEnemy(from, fromVel, targetPos, targetVel, speed = 120, dmg = 7, spread = 0.02) {
    const b = this.eBolts[this.eCursor];
    this.eCursor = (this.eCursor + 1) % E_MAX;
    b.p.copy(from);
    b.prev.copy(from);
    const dist = from.distanceTo(targetPos);
    const t = dist / speed;
    // aim at where target will be relative to the shooter's frame
    _aim.copy(targetPos).addScaledVector(targetVel, t).addScaledVector(fromVel, -t);
    _dir.subVectors(_aim, from).normalize();
    _dir.x += rand(-spread, spread); _dir.y += rand(-spread, spread); _dir.z += rand(-spread, spread);
    _dir.normalize();
    b.v.copy(_dir).multiplyScalar(speed).add(fromVel);
    b.life = 3;
    b.dmg = dmg;
    FX.spark(from, fromVel, _col.setRGB(8, 1.5, 0.4), 2.2, 0.08, { drag: 0 });
  }

  fireMissile(from, vel, target) {
    const m = this.missiles.find((x) => !x.alive);
    if (!m) return;
    m.alive = true;
    m.p.copy(from);
    m.v.copy(vel).add(_dir.set(rand(-20, 20), rand(25, 45), rand(-10, 10)));
    m.life = 7;
    m.target = target;
    m.lock = true;
    m.age = 0;
  }

  update(dt, game) {
    const enemies = game.enemies.list;
    // player bolts
    for (let i = 0; i < P_MAX; i++) {
      const b = this.pBolts[i];
      if (b.life <= 0) continue;
      b.life -= dt;
      b.prev.copy(b.p);
      b.p.addScaledVector(b.v, dt);
      let hit = false;
      for (const e of enemies) {
        if (!e.alive) continue;
        if (distPointSegment(e.pos, b.prev, b.p) < e.radius) {
          game.enemies.hit(e, 1, game, game.players[b.owner]);
          FX.sparkBurst(b.p, _dir.copy(b.v).normalize().negate(), 8, _col.setRGB(5, 3.5, 1.5), 30, 0.8, e.vel);
          hit = true;
          break;
        }
      }
      if (!hit) {
        for (const m of this.missiles) {
          if (m.alive && distPointSegment(m.p, b.prev, b.p) < m.radius) {
            this._killMissile(m, game, true);
            hit = true;
            break;
          }
        }
      }
      if (!hit && game.boss && game.boss.active) hit = game.boss.bulletHit(b, game);
      if (hit) b.life = 0;
    }
    // enemy bolts
    const T = game.tetherState;
    for (let i = 0; i < E_MAX; i++) {
      const b = this.eBolts[i];
      if (b.life <= 0) continue;
      b.life -= dt;
      b.prev.copy(b.p);
      b.p.addScaledVector(b.v, dt);
      for (const pl of game.players) {
        if (pl.downed) continue;
        if (distPointSegment(pl.pos, b.prev, b.p) < 1.7) {
          if (pl.vulnerable) {
            pl.damage(b.dmg, game);
            b.life = 0;
          } else if (pl.rolling && !b.grazed) {
            b.grazed = true;
            game.onGraze(pl);
          }
          break;
        }
      }
      if (b.life > 0 && T.on && distSegmentSegment(b.prev, b.p, game.players[0].pos, game.players[1].pos) < 1.0) {
        b.life = 0;
        FX.sparkBurst(b.p, _dir.copy(b.v).normalize().negate(), 10, _col.setRGB(3, 5, 7), 25, 1);
        game.onTetherBlock(b.p);
      }
    }
    // missiles
    for (let i = 0; i < M_MAX; i++) {
      const m = this.missiles[i];
      if (!m.alive) continue;
      m.life -= dt;
      m.age += dt;
      const tg = m.target;
      if (tg && !tg.downed && m.lock && m.age > 0.6) {
        _dir.subVectors(tg.pos, m.p);
        const dist = _dir.length();
        if (tg.rolling && dist < 30) {
          m.lock = false; // dodged!
          game.onGraze(tg);
        }
        _dir.normalize().multiplyScalar(dist > 40 ? 150 : 110);
        _dir.add(tg.vel);
        m.v.lerp(_dir, 1 - Math.exp(-2.4 * dt));
        if (dist < 2.8) {
          tg.damage(16, game);
          this._killMissile(m, game, false);
          continue;
        }
      }
      m.p.addScaledVector(m.v, dt);
      if (m.life <= 0) { this._killMissile(m, game, false); continue; }
      FX.smoke.spawn(m.p.x, m.p.y, m.p.z, 0, 1, 0, 0.15, 0.14, 0.13, 1.2, 0.9, { grow: 2.5, alpha: 0.5 });
      FX.spark(m.p, _dir.copy(m.v).multiplyScalar(0.2), _col.setRGB(9, 3, 0.8), 1.6, 0.08, { drag: 0 });
      if (T.on && distPointSegment(m.p, game.players[0].pos, game.players[1].pos) < 1.5) {
        this._killMissile(m, game, true);
      }
    }
    this._updateMeshes();
  }

  _killMissile(m, game, byPlayer) {
    m.alive = false;
    FX.explosion(m.p, 0.6, m.v.clone().multiplyScalar(0.3));
    game.audio.explode(0.5);
    if (byPlayer) game.addScore(50, 'MISSILE');
  }

  _updateMeshes() {
    for (let i = 0; i < P_MAX; i++) {
      const b = this.pBolts[i];
      if (b.life <= 0) { this.pMesh.setMatrixAt(i, _zero); continue; }
      _look.copy(b.p).add(b.v);
      _m.lookAt(b.p, _look, _up);
      _m.setPosition(b.p);
      this.pMesh.setMatrixAt(i, _m);
    }
    for (let i = 0; i < E_MAX; i++) {
      const b = this.eBolts[i];
      if (b.life <= 0) { this.eMesh.setMatrixAt(i, _zero); continue; }
      _look.copy(b.p).add(b.v);
      _m.lookAt(b.p, _look, _up);
      _m.setPosition(b.p);
      this.eMesh.setMatrixAt(i, _m);
    }
    for (let i = 0; i < M_MAX; i++) {
      const m = this.missiles[i];
      if (!m.alive) { this.mMesh.setMatrixAt(i, _zero); continue; }
      _look.copy(m.p).add(m.v);
      _m.lookAt(m.p, _look, _up);
      _m.setPosition(m.p);
      this.mMesh.setMatrixAt(i, _m);
    }
    this.pMesh.instanceMatrix.needsUpdate = true;
    this.eMesh.instanceMatrix.needsUpdate = true;
    this.mMesh.instanceMatrix.needsUpdate = true;
  }
}

const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _aim = new THREE.Vector3(), _dir = new THREE.Vector3(), _look = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _col = new THREE.Color();
