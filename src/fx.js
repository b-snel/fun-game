import * as THREE from 'three';
import { rand } from './util.js';

const PARTICLE_VS = /* glsl */ `
  attribute vec4 aColor; attribute float aSize;
  uniform float uScale;
  varying vec4 vColor;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.5, -mv.z);
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
  }`;
const ADD_FS = /* glsl */ `
  varying vec4 vColor;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a *= a;
    gl_FragColor = vec4(vColor.rgb * a * vColor.a, 1.0);
  }`;
const SMOKE_FS = /* glsl */ `
  varying vec4 vColor;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.1, d);
    gl_FragColor = vec4(vColor.rgb, a * vColor.a);
  }`;

class ParticlePool {
  constructor(scene, max, additive) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.baseCol = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.cursor = 0;
    this.additive = additive;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    this.uniforms = { uScale: { value: 500 } };
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: PARTICLE_VS,
        fragmentShader: additive ? ADD_FS : SMOKE_FS,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      })
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
    this.points.onBeforeRender = (r, s, cam) => {
      this.uniforms.uScale.value = (FX.viewH * 0.5) / Math.tan((cam.fov * Math.PI) / 360);
    };
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, size, life, opts = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.baseCol[i * 3] = r; this.baseCol[i * 3 + 1] = g; this.baseCol[i * 3 + 2] = b;
    this.size0[i] = size;
    this.grow[i] = opts.grow ?? 0;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.drag[i] = opts.drag ?? 1.5;
    this.grav[i] = opts.grav ?? 0;
    this.alpha0[i] = opts.alpha ?? 1;
  }

  update(dt) {
    const sizeArr = this.aSize.array;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (sizeArr[i] !== 0) sizeArr[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const k = Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      this.vel[j] *= k; this.vel[j + 1] = this.vel[j + 1] * k - this.grav[i] * dt; this.vel[j + 2] *= k;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      sizeArr[i] = this.size0[i] * (1 + this.grow[i] * (1 - t));
      const a = this.additive ? t * t * this.alpha0[i] : t * this.alpha0[i];
      this.col[i * 4] = this.baseCol[j]; this.col[i * 4 + 1] = this.baseCol[j + 1]; this.col[i * 4 + 2] = this.baseCol[j + 2];
      this.col[i * 4 + 3] = a;
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
  }
}

export class Trail {
  constructor(scene, color, width, n = 48) {
    this.n = n;
    this.width = width;
    this.pts = [];
    this.sides = [];
    for (let i = 0; i < n; i++) { this.pts.push(new THREE.Vector3()); this.sides.push(new THREE.Vector3()); }
    this.head = 0;
    this.filled = 0;
    const g = new THREE.BufferGeometry();
    this.posArr = new Float32Array(n * 2 * 3);
    const aT = new Float32Array(n * 2);
    const idx = [];
    for (let i = 0; i < n; i++) { aT[i * 2] = aT[i * 2 + 1] = i / (n - 1); }
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.aPos = new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    g.setIndex(idx);
    this.uniforms = { uColor: { value: new THREE.Color(color) }, uIntensity: { value: 1 } };
    this.mesh = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        vertexShader: `attribute float aT; varying float vT; varying float vD; void main(){ vT=aT; vec4 mv = modelViewMatrix*vec4(position,1.0); vD = -mv.z; gl_Position = projectionMatrix*mv;} `,
        fragmentShader: `uniform vec3 uColor; uniform float uIntensity; varying float vT; varying float vD; void main(){ float a = pow(1.0 - vT, 1.6) * smoothstep(4.0, 14.0, vD); gl_FragColor = vec4(uColor * a * uIntensity, 1.0);} `,
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
  }

  reset(p) {
    for (const v of this.pts) v.copy(p);
    this.filled = 0;
  }

  push(p, side, intensity) {
    this.head = (this.head + this.n - 1) % this.n;
    this.pts[this.head].copy(p);
    this.sides[this.head].copy(side);
    this.filled = Math.min(this.n, this.filled + 1);
    this.uniforms.uIntensity.value = intensity;
    for (let i = 0; i < this.n; i++) {
      const k = (this.head + Math.min(i, this.filled - 1)) % this.n;
      const p2 = this.pts[k], sd = this.sides[k];
      const w = this.width * (1 - i / this.n);
      this.posArr[i * 6] = p2.x + sd.x * w; this.posArr[i * 6 + 1] = p2.y + sd.y * w; this.posArr[i * 6 + 2] = p2.z + sd.z * w;
      this.posArr[i * 6 + 3] = p2.x - sd.x * w; this.posArr[i * 6 + 4] = p2.y - sd.y * w; this.posArr[i * 6 + 5] = p2.z - sd.z * w;
    }
    this.aPos.needsUpdate = true;
  }
}

export const FX = {
  viewH: 540,
  init(scene) {
    this.scene = scene;
    this.sparks = new ParticlePool(scene, 7000, true);
    this.smoke = new ParticlePool(scene, 1600, false);
    // light pool
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xff8040, 0, 90, 1.6);
      l.userData.t = 0;
      scene.add(l);
      this.lights.push(l);
    }
    this.lightCursor = 0;
    // shockwave shells
    this.shells = [];
    const shellMat = () =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uA: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `uniform vec3 uColor; uniform float uA; varying vec3 vN; varying vec3 vV; void main(){ float f = 1.0 - abs(dot(vN, vV)); f = pow(f, 3.0); gl_FragColor = vec4(uColor * f * uA, 1.0); }`,
      });
    const shellGeo = new THREE.SphereGeometry(1, 24, 16);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(shellGeo, shellMat());
      m.visible = false;
      m.frustumCulled = false;
      m.userData = { t: 0, life: 1, r: 10 };
      scene.add(m);
      this.shells.push(m);
    }
    this.shellCursor = 0;
    // debris chunks
    this.debrisMax = 240;
    this.debris = new THREE.InstancedMesh(
      new THREE.TetrahedronGeometry(0.5, 0),
      new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.6, metalness: 0.7, emissive: 0xff5a1a, emissiveIntensity: 0.6 }),
      this.debrisMax
    );
    this.debris.frustumCulled = false;
    this.debrisData = [];
    for (let i = 0; i < this.debrisMax; i++) {
      this.debrisData.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), life: 0, s: 1 });
      this.debris.setMatrixAt(i, _zero);
    }
    this.debrisCursor = 0;
    scene.add(this.debris);
  },

  light(pos, color, intensity, dur) {
    const l = this.lights[this.lightCursor];
    this.lightCursor = (this.lightCursor + 1) % this.lights.length;
    l.position.copy(pos);
    l.color.set(color);
    l.userData.i = intensity;
    l.userData.t = dur;
    l.userData.d = dur;
    l.intensity = intensity;
  },

  shell(pos, color, radius, life) {
    const m = this.shells[this.shellCursor];
    this.shellCursor = (this.shellCursor + 1) % this.shells.length;
    m.position.copy(pos);
    m.material.uniforms.uColor.value.set(color);
    m.userData.t = 0;
    m.userData.life = life;
    m.userData.r = radius;
    m.visible = true;
  },

  spark(p, v, color, size = 0.6, life = 0.5, opts) {
    this.sparks.spawn(p.x, p.y, p.z, v.x, v.y, v.z, color.r, color.g, color.b, size, life, opts);
  },

  // Directional spark spray (wall scrapes, bullet impacts).
  sparkBurst(p, dir, n, color, speed = 40, spread = 0.6, base) {
    for (let i = 0; i < n; i++) {
      _v.set(dir.x + rand(-spread, spread), dir.y + rand(-spread, spread), dir.z + rand(-spread, spread)).normalize().multiplyScalar(speed * rand(0.4, 1.2));
      if (base) _v.add(base);
      this.sparks.spawn(p.x, p.y, p.z, _v.x, _v.y, _v.z, color.r, color.g, color.b, rand(0.25, 0.6), rand(0.2, 0.55), { drag: 2.5, grav: 25 });
    }
  },

  explosion(p, scale = 1, baseVel = null, hue = 'fire') {
    const bv = baseVel || _zv;
    const fire = hue === 'fire';
    const c1 = fire ? [6, 2.6, 0.8] : [1.5, 4, 8];
    const c2 = fire ? [4, 0.9, 0.2] : [0.6, 1.5, 6];
    // flash
    this.sparks.spawn(p.x, p.y, p.z, bv.x, bv.y, bv.z, 5, 3.5, 2, Math.min(24, 12 * scale), 0.15, { drag: 0 });
    // fireball
    const nFire = (30 * scale) | 0;
    for (let i = 0; i < nFire; i++) {
      _v.randomDirection().multiplyScalar(rand(4, 22) * scale);
      const c = Math.random() < 0.5 ? c1 : c2;
      this.sparks.spawn(p.x + _v.x * 0.05, p.y + _v.y * 0.05, p.z + _v.z * 0.05, _v.x + bv.x, _v.y + bv.y, _v.z + bv.z, c[0], c[1], c[2], rand(2.5, 6) * scale, rand(0.35, 0.9), { drag: 3.5, grow: 1.2 });
    }
    // sparks
    const nS = (60 * scale) | 0;
    for (let i = 0; i < nS; i++) {
      _v.randomDirection().multiplyScalar(rand(20, 90) * Math.sqrt(scale));
      this.sparks.spawn(p.x, p.y, p.z, _v.x + bv.x, _v.y + bv.y, _v.z + bv.z, 6, 3.4, 1.4, rand(0.25, 0.55), rand(0.4, 1.1), { drag: 1.6, grav: 30 });
    }
    // smoke
    const nSm = (14 * scale) | 0;
    for (let i = 0; i < nSm; i++) {
      _v.randomDirection().multiplyScalar(rand(2, 10) * scale);
      const g = rand(0.04, 0.09);
      this.smoke.spawn(p.x, p.y, p.z, _v.x + bv.x * 0.9, _v.y + bv.y * 0.9 + 3, _v.z + bv.z * 0.9, g, g, g * 1.05, rand(4, 8) * scale, rand(1.2, 2.2), { drag: 1.2, grow: 2.2, alpha: 0.75 });
    }
    // debris
    const nD = Math.min(20, (8 * scale) | 0);
    for (let i = 0; i < nD; i++) {
      const d = this.debrisData[this.debrisCursor];
      this.debrisCursor = (this.debrisCursor + 1) % this.debrisMax;
      d.p.copy(p);
      d.v.randomDirection().multiplyScalar(rand(15, 45) * Math.sqrt(scale)).add(bv);
      d.spin.set(rand(-12, 12), rand(-12, 12), rand(-12, 12));
      d.life = rand(1.2, 2.4);
      d.s = rand(0.5, 1.6) * Math.sqrt(scale);
    }
    this.light(p, fire ? 0xff7a30 : 0x60a0ff, Math.min(1600, 500 * scale), 0.4 + 0.15 * scale);
    this.shell(p, fire ? 0xff9050 : 0x80c0ff, 14 * scale, 0.45);
  },

  update(dt) {
    this.sparks.update(dt);
    this.smoke.update(dt);
    for (const l of this.lights) {
      if (l.userData.t > 0) {
        l.userData.t -= dt;
        l.intensity = l.userData.i * Math.max(0, l.userData.t / l.userData.d) ** 2;
      } else l.intensity = 0;
    }
    for (const m of this.shells) {
      if (!m.visible) continue;
      m.userData.t += dt;
      const t = m.userData.t / m.userData.life;
      if (t >= 1) { m.visible = false; continue; }
      const e = 1 - Math.pow(1 - t, 3);
      m.scale.setScalar(m.userData.r * (0.2 + e));
      m.material.uniforms.uA.value = (1 - t) * 3;
    }
    for (let i = 0; i < this.debrisMax; i++) {
      const d = this.debrisData[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { this.debris.setMatrixAt(i, _zero); continue; }
      d.v.y -= 30 * dt;
      d.v.multiplyScalar(Math.exp(-0.6 * dt));
      d.p.addScaledVector(d.v, dt);
      d.rot.x += d.spin.x * dt; d.rot.y += d.spin.y * dt; d.rot.z += d.spin.z * dt;
      _q.setFromEuler(d.rot);
      _m.compose(d.p, _q, _s.setScalar(d.s * Math.min(1, d.life * 2)));
      this.debris.setMatrixAt(i, _m);
      if (Math.random() < 0.3) this.sparks.spawn(d.p.x, d.p.y, d.p.z, 0, 0, 0, 3, 1.2, 0.3, 0.8, 0.25, { drag: 0 });
    }
    this.debris.instanceMatrix.needsUpdate = true;
  },

  clear() {
    this.sparks.clear();
    this.smoke.clear();
    for (const d of this.debrisData) d.life = 0;
    for (let i = 0; i < this.debrisMax; i++) this.debris.setMatrixAt(i, _zero);
    for (const s of this.shells) s.visible = false;
  },
};

const _v = new THREE.Vector3(), _zv = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
