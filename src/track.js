import * as THREE from 'three';
import { clamp, lerp, smoothstep, mulberry32, fbm3, canvasTexture } from './util.js';

export const DS = 2; // sample spacing (m)

// Course layout. Distances in metres along the track.
export const SECTIONS = [
  { id: 'hangar', name: 'LAUNCH BAY', start: 0, hw: 16, ceil: 20, canyon: 0, wallH: 20, speed: 72,
    light: [1.0, 0.95, 0.85], subtitle: '' },
  { id: 'trench', name: 'THE TRENCH', start: 520, hw: 34, ceil: 0, canyon: 1, wallH: 85, speed: 90,
    light: [0.35, 0.85, 1.0], subtitle: 'SECTOR 01' },
  { id: 'undercity', name: 'UNDERCITY', start: 5400, hw: 24, ceil: 30, canyon: 0, wallH: 30, speed: 84,
    light: [1.0, 0.55, 0.18], subtitle: 'SECTOR 02' },
  { id: 'collapse', name: 'COLLAPSE', start: 10200, hw: 40, ceil: 0, canyon: 1, wallH: 95, speed: 98,
    light: [1.0, 0.22, 0.12], subtitle: 'SECTOR 03' },
  { id: 'warden', name: 'THE WARDEN', start: 15800, hw: 54, ceil: 0, canyon: 1, wallH: 60, speed: 82,
    light: [0.75, 0.85, 1.0], subtitle: 'FINAL SECTOR' },
];
export const TRACK_LENGTH = 34000;

export function sectionAt(s) {
  let sec = SECTIONS[0];
  for (const x of SECTIONS) if (s >= x.start) sec = x;
  return sec;
}
export function sectionById(id) {
  return SECTIONS.find((x) => x.id === id);
}

export class Track {
  constructor() {
    this.length = TRACK_LENGTH;
    this.n = Math.floor(this.length / DS) + 1;
    this.obstacles = [];
    this.gates = [];
    this._buildCurve();
    this._buildProfileData();
    this._buildObstacles();
  }

  _buildCurve() {
    const rng = mulberry32(1337);
    const pts = [];
    let p = new THREE.Vector3(0, 40, 0);
    let yaw = 0, pitch = 0, yawRate = 0;
    const step = 220;
    const total = Math.ceil(this.length / step) + 4;
    pts.push(p.clone().add(new THREE.Vector3(0, 0, step)));
    for (let i = 0; i < total; i++) {
      const s = i * step;
      const sec = sectionAt(s);
      let maxRate = 0.32, pitchAmp = 0.06;
      if (sec.id === 'hangar') { maxRate = 0; pitchAmp = 0; }
      if (sec.id === 'undercity') { maxRate = 0.22; pitchAmp = 0.04; }
      if (sec.id === 'collapse') { maxRate = 0.38; pitchAmp = 0.09; }
      if (sec.id === 'warden') { maxRate = 0.16; pitchAmp = 0.03; }
      yawRate = clamp(yawRate * 0.55 + (rng() - 0.5) * maxRate * 1.6, -maxRate, maxRate);
      yaw += yawRate;
      pitch = clamp(pitch * 0.6 + (rng() - 0.5) * pitchAmp * 2, -pitchAmp, pitchAmp);
      // keep altitude loosely bounded
      if (p.y > 120) pitch = -Math.abs(pitch);
      if (p.y < -60) pitch = Math.abs(pitch);
      pts.push(p.clone());
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      p = p.clone().addScaledVector(dir, step);
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    curve.arcLengthDivisions = 40000;
    const curveLen = curve.getLength();
    // first point is a lead-in behind the start; find its arc offset
    const lead = step;
    const n = this.n;
    this.px = new Float32Array(n * 3);
    this.tx = new Float32Array(n * 3);
    this.rx = new Float32Array(n * 3);
    this.ux = new Float32Array(n * 3);
    const tmp = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const u = clamp((lead + i * DS) / curveLen, 0, 1);
      curve.getPointAt(u, tmp);
      this.px[i * 3] = tmp.x; this.px[i * 3 + 1] = tmp.y; this.px[i * 3 + 2] = tmp.z;
    }
    // tangents
    const T = [];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const t = new THREE.Vector3(
        this.px[b * 3] - this.px[a * 3], this.px[b * 3 + 1] - this.px[a * 3 + 1], this.px[b * 3 + 2] - this.px[a * 3 + 2]
      ).normalize();
      T.push(t);
    }
    // yaw rate -> banking
    const k = new Float32Array(n);
    for (let i = 0; i < n - 1; i++) {
      k[i] = (T[i].z * T[i + 1].x - T[i].x * T[i + 1].z) / DS; // (T_i x T_i+1).y
    }
    const smooth = (arr, r) => {
      const out = new Float32Array(arr.length);
      let acc = 0;
      for (let i = -r; i < arr.length; i++) {
        const add = i + r < arr.length ? arr[i + r] : 0;
        const sub = i - r - 1 >= 0 ? arr[i - r - 1] : 0;
        acc += add - sub;
        if (i >= 0) out[i] = acc / (2 * r + 1);
      }
      return out;
    };
    const ks = smooth(smooth(k, 30), 30);
    this.bank = new Float32Array(n);
    const Y = new THREE.Vector3(0, 1, 0);
    const R = new THREE.Vector3(), U = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const t = T[i];
      R.crossVectors(t, Y).normalize();
      U.crossVectors(R, t).normalize();
      const b = clamp(-ks[i] * 110, -0.5, 0.5);
      this.bank[i] = b;
      const c = Math.cos(b), s = Math.sin(b);
      const rx = R.x * c - U.x * s, ry = R.y * c - U.y * s, rz = R.z * c - U.z * s;
      const ux = U.x * c + R.x * s, uy = U.y * c + R.y * s, uz = U.z * c + R.z * s;
      this.tx.set([t.x, t.y, t.z], i * 3);
      this.rx.set([rx, ry, rz], i * 3);
      this.ux.set([ux, uy, uz], i * 3);
    }
  }

  _buildProfileData() {
    const n = this.n;
    this.hwA = new Float32Array(n);
    this.ceilA = new Float32Array(n); // 0 = open sky
    this.canyonA = new Float32Array(n);
    this.wallHA = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = i * DS;
      // blend over 160 m into each section
      let idx = 0;
      for (let j = 0; j < SECTIONS.length; j++) if (s >= SECTIONS[j].start) idx = j;
      const cur = SECTIONS[idx], prev = SECTIONS[Math.max(0, idx - 1)];
      const t = idx === 0 ? 1 : smoothstep(cur.start, cur.start + 160, s);
      this.hwA[i] = lerp(prev.hw, cur.hw, t);
      this.canyonA[i] = lerp(prev.canyon, cur.canyon, t);
      this.wallHA[i] = lerp(prev.wallH, cur.wallH, t);
      this.ceilA[i] = cur.ceil; // hard switch: tunnel mouths
    }
  }

  _idx(s) {
    return clamp(s / DS, 0, this.n - 1.001);
  }
  hw(s) {
    const f = this._idx(s), i = f | 0;
    return lerp(this.hwA[i], this.hwA[i + 1], f - i);
  }
  ceil(s) {
    const c = this.ceilA[Math.round(this._idx(s))];
    return c > 0 ? c : 1e9;
  }
  section(s) {
    return sectionAt(s);
  }

  sample(s, out) {
    const f = this._idx(s), i = f | 0, t = f - i;
    const a = i * 3, b = a + 3;
    const L = (arr, o) => arr[a + o] + (arr[b + o] - arr[a + o]) * t;
    out.pos.set(L(this.px, 0), L(this.px, 1), L(this.px, 2));
    out.tan.set(L(this.tx, 0), L(this.tx, 1), L(this.tx, 2)).normalize();
    out.right.set(L(this.rx, 0), L(this.rx, 1), L(this.rx, 2)).normalize();
    out.up.set(L(this.ux, 0), L(this.ux, 1), L(this.ux, 2)).normalize();
    out.bank = this.bank[i] + (this.bank[Math.min(i + 1, this.n - 1)] - this.bank[i]) * t;
    return out;
  }

  toWorld(s, x, y, out) {
    const fr = this.sample(s, _fr);
    return out.copy(fr.pos).addScaledVector(fr.right, x).addScaledVector(fr.up, y);
  }

  // Matrix with basis (right, up, -tangent) at track coordinates.
  frameMatrix(s, x, y, out, sx = 1, sy = 1, sz = 1) {
    const fr = this.sample(s, _fr);
    _v.copy(fr.pos).addScaledVector(fr.right, x).addScaledVector(fr.up, y);
    _back.copy(fr.tan).negate();
    out.makeBasis(_r2.copy(fr.right).multiplyScalar(sx), _u2.copy(fr.up).multiplyScalar(sy), _back.multiplyScalar(sz));
    out.setPosition(_v);
    return out;
  }

  // Project a world position to approximate track coords (s near hint).
  worldToTrack(p, sHint, out) {
    let best = sHint, bestD = Infinity;
    for (let ds = -40; ds <= 40; ds += 4) {
      const s = clamp(sHint + ds, 0, this.length);
      this.sample(s, _fr);
      const d = _v.subVectors(p, _fr.pos).dot(_fr.tan);
      if (Math.abs(d) < bestD) { bestD = Math.abs(d); best = s + d; }
    }
    this.sample(best, _fr);
    _v.subVectors(p, _fr.pos);
    out.s = best;
    out.x = _v.dot(_fr.right);
    out.y = _v.dot(_fr.up);
    return out;
  }

  _buildObstacles() {
    const rng = mulberry32(4242);
    const obs = [];
    for (const sec of SECTIONS) {
      const next = SECTIONS[SECTIONS.indexOf(sec) + 1];
      const end = next ? next.start : this.length;
      if (sec.id === 'trench') {
        // tall signal masts, sparse
        for (let s = sec.start + 900; s < end - 200; s += 160 + rng() * 140) {
          const hw = this.hw(s);
          obs.push({ type: 'pillar', s, x: (rng() * 2 - 1) * (hw - 8), r: 1.6, deco: 'mast' });
        }
      } else if (sec.id === 'undercity') {
        let lastBeamY = 20;
        for (let s = sec.start + 320; s < end - 250; s += 38 + rng() * 34) {
          const hw = this.hw(s);
          const roll = rng();
          if (roll < 0.22) {
            lastBeamY = lastBeamY > 15 ? 4 + rng() * 3 : 21 + rng() * 4;
            obs.push({ type: 'beam', s, y: lastBeamY, r: 1.3 });
            s += 30;
          } else if (roll < 0.3) {
            // double pillar with a gap
            const gap = (rng() * 2 - 1) * (hw - 9);
            obs.push({ type: 'pillar', s, x: gap - 7, r: 2.0 });
            obs.push({ type: 'pillar', s, x: gap + 7, r: 2.0 });
          } else {
            obs.push({ type: 'pillar', s, x: (rng() * 2 - 1) * (hw - 4), r: 2.0 });
          }
        }
        for (let s = sec.start + 900; s < end - 400; s += 620 + rng() * 200) {
          this.gates.push({ s, kind: rng() < 0.5 ? 'h' : 'v', phase: rng() * 6.28, speed: 1.6 + rng() * 0.8 });
        }
      } else if (sec.id === 'collapse') {
        for (let s = sec.start + 500; s < end - 300; s += 120 + rng() * 120) {
          const hw = this.hw(s);
          obs.push({ type: 'pillar', s, x: (rng() * 2 - 1) * (hw - 6), r: 2.4, deco: 'rock' });
        }
        for (let s = sec.start + 1400; s < end - 400; s += 900 + rng() * 300) {
          this.gates.push({ s, kind: 'h', phase: rng() * 6.28, speed: 2.2 });
        }
      }
    }
    obs.sort((a, b) => a.s - b.s);
    this.obstacles = obs;
  }

  // Obstacles with s in [a, b]
  queryObstacles(a, b, out) {
    out.length = 0;
    const o = this.obstacles;
    let lo = 0, hi = o.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (o[m].s < a) lo = m + 1; else hi = m;
    }
    for (let i = lo; i < o.length && o[i].s <= b; i++) out.push(o[i]);
    return out;
  }

  // ---------- Visual construction ----------
  build(scene) {
    const tex = makeTextures();
    this.tex = tex;
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x8a9098, map: tex.floor, bumpMap: tex.floor, bumpScale: 1.2,
      roughness: 0.32, metalness: 0.55, roughnessMap: tex.floorRough, side: THREE.DoubleSide,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: tex.concrete, bumpMap: tex.concrete, bumpScale: 2.5,
      roughness: 0.92, metalness: 0.05, vertexColors: true, side: THREE.DoubleSide,
    });
    const ceilMat = new THREE.MeshStandardMaterial({
      color: 0x60646a, map: tex.concrete, bumpMap: tex.concrete, bumpScale: 2,
      roughness: 0.85, metalness: 0.2, side: THREE.DoubleSide,
    });
    this.group = new THREE.Group();
    scene.add(this.group);

    const RING = 4; // metres between rings
    const CHUNK = 120;
    const WALL_SEG = 12;
    const fr = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
    const v = new THREE.Vector3();
    for (let c0 = 0; c0 < this.length - 1; c0 += CHUNK) {
      const c1 = Math.min(this.length - 1, c0 + CHUNK);
      const rings = Math.round((c1 - c0) / RING) + 1;
      // ---- floor ----
      const FSEG = 6;
      const fPos = [], fUv = [], fIdx = [];
      // ---- walls ----
      const wPos = [], wUv = [], wCol = [], wIdx = [];
      for (let r = 0; r < rings; r++) {
        const s = c0 + (r / (rings - 1)) * (c1 - c0);
        this.sample(s, fr);
        const hw = this.hw(s);
        const i = Math.round(this._idx(s));
        const canyon = this.canyonA[i];
        const ceil = this.ceilA[i];
        const wallH = ceil > 0 ? ceil : this.wallHA[i];
        for (let k = 0; k <= FSEG; k++) {
          const x = -hw + (2 * hw * k) / FSEG;
          v.copy(fr.pos).addScaledVector(fr.right, x);
          fPos.push(v.x, v.y, v.z);
          fUv.push(x / 14, s / 14);
        }
        for (let side = -1; side <= 1; side += 2) {
          for (let k = 0; k <= WALL_SEG; k++) {
            const t = k / WALL_SEG;
            const h = t * wallH;
            let out = 0;
            // canyon: leaning rock face with noise; city: vertical with buttress ribs
            const nz = fbm3(s * 0.018, h * 0.05, side * 7.3, 4);
            const rock = Math.pow(t, 1.6) * 30 + nz * 16 + Math.max(0, nz - 0.55) * 30;
            const rib = (Math.floor((s + 6) / 24) % 2 === 0 ? 0 : 1.6) + (k === 0 ? 0 : 0.3);
            out = lerp(rib, rock, canyon);
            if (k === 0) out = 0;
            const x = side * (hw + out);
            v.copy(fr.pos).addScaledVector(fr.right, x).addScaledVector(fr.up, h + (k === WALL_SEG && canyon > 0.5 ? nz * 10 : 0));
            wPos.push(v.x, v.y, v.z);
            wUv.push((h + out * 0.5) / 10, s / 10);
            const shade = lerp(0.85, 0.5 + 0.6 * nz, canyon) * (0.75 + 0.25 * Math.sin(h * 0.35 + nz * 4) ** 2);
            const base = canyon > 0.5 ? [0.62, 0.6, 0.6] : [0.58, 0.6, 0.64];
            wCol.push(base[0] * shade, base[1] * shade, base[2] * shade);
          }
        }
      }
      for (let r = 0; r < rings - 1; r++) {
        for (let k = 0; k < FSEG; k++) {
          const a = r * (FSEG + 1) + k, b = a + 1, c = a + FSEG + 1, d = c + 1;
          fIdx.push(a, c, b, b, c, d);
        }
        const per = (WALL_SEG + 1) * 2;
        for (let side = 0; side < 2; side++) {
          for (let k = 0; k < WALL_SEG; k++) {
            const a = r * per + side * (WALL_SEG + 1) + k, b = a + 1, c = a + per, d = c + 1;
            if (side === 0) wIdx.push(a, b, c, b, d, c);
            else wIdx.push(a, c, b, b, c, d);
          }
        }
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(fPos, 3));
      fg.setAttribute('uv', new THREE.Float32BufferAttribute(fUv, 2));
      fg.setIndex(fIdx);
      fg.computeVertexNormals();
      fg.computeBoundingSphere();
      const fm = new THREE.Mesh(fg, floorMat);
      this.group.add(fm);
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
      wg.setAttribute('uv', new THREE.Float32BufferAttribute(wUv, 2));
      wg.setAttribute('color', new THREE.Float32BufferAttribute(wCol, 3));
      wg.setIndex(wIdx);
      wg.computeVertexNormals();
      wg.computeBoundingSphere();
      this.group.add(new THREE.Mesh(wg, wallMat));
    }

    // ---- ceilings (continuous runs) ----
    let runStart = -1;
    for (let i = 0; i <= this.n; i++) {
      const has = i < this.n && this.ceilA[i] > 0;
      if (has && runStart < 0) runStart = i;
      if (!has && runStart >= 0) {
        this._buildCeiling(runStart * DS, (i - 1) * DS, ceilMat);
        runStart = -1;
      }
    }
    this._buildDecor(scene, tex);
  }

  _buildCeiling(a, b, mat) {
    const fr = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
    const v = new THREE.Vector3();
    for (let c0 = a; c0 < b; c0 += 120) {
      const c1 = Math.min(b, c0 + 120);
      const rings = Math.max(2, Math.round((c1 - c0) / 4) + 1);
      const pos = [], uv = [], idx = [];
      const SEG = 4;
      for (let r = 0; r < rings; r++) {
        const s = c0 + (r / (rings - 1)) * (c1 - c0);
        this.sample(s, fr);
        const hw = this.hw(s) + 2;
        const h = this.ceil(s);
        for (let k = 0; k <= SEG; k++) {
          const x = -hw + (2 * hw * k) / SEG;
          v.copy(fr.pos).addScaledVector(fr.right, x).addScaledVector(fr.up, h);
          pos.push(v.x, v.y, v.z);
          uv.push(x / 12, s / 12);
        }
      }
      for (let r = 0; r < rings - 1; r++)
        for (let k = 0; k < SEG; k++) {
          const p = r * (SEG + 1) + k, q = p + 1, c = p + SEG + 1, d = c + 1;
          idx.push(p, q, c, q, d, c);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      this.group.add(new THREE.Mesh(g, mat));
    }
    // tunnel mouth frame
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.7 });
    const m = new THREE.Matrix4();
    for (const s of [a, b]) {
      const hw = this.hw(s), h = this.ceil(s);
      const top = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 10, 8, 6), frameMat);
      this.frameMatrix(s, 0, h + 3, m);
      top.applyMatrix4(m);
      this.group.add(top);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(5, h + 6, 6), frameMat);
        this.frameMatrix(s, side * (hw + 2.5), (h + 6) / 2 - 1, m);
        post.applyMatrix4(m);
        this.group.add(post);
      }
    }
  }

  _buildDecor(scene, tex) {
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const rng = mulberry32(99);

    // --- wall light strips ---
    const stripGeo = new THREE.BoxGeometry(0.35, 0.35, 9);
    const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 1.1, 1.1) });
    const strips = [];
    for (let s = 20; s < this.length - 20; s += 26) {
      const sec = sectionAt(s);
      const hw = this.hw(s);
      const ys = sec.ceil ? [3, sec.ceil - 4] : [2.5];
      for (const side of [-1, 1]) for (const y of ys) strips.push({ s, x: side * (hw + 0.1), y, c: sec.light });
    }
    const stripMesh = new THREE.InstancedMesh(stripGeo, stripMat, strips.length);
    strips.forEach((st, i) => {
      this.frameMatrix(st.s, st.x, st.y, m);
      stripMesh.setMatrixAt(i, m);
      stripMesh.setColorAt(i, col.setRGB(st.c[0], st.c[1], st.c[2]));
    });
    stripMesh.frustumCulled = false;
    scene.add(stripMesh);

    // --- floor edge lights & centre dashes ---
    const dotGeo = new THREE.BoxGeometry(0.5, 0.18, 1.6);
    const dashGeo = new THREE.BoxGeometry(0.35, 0.05, 5);
    const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 1.0, 1.0) });
    const dashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.18, 0.19, 0.2) });
    const dots = [], dashes = [];
    for (let s = 10; s < this.length - 10; s += 12) {
      const sec = sectionAt(s);
      const hw = this.hw(s);
      dots.push({ s, x: -(hw - 1.4), c: sec.light });
      dots.push({ s, x: hw - 1.4, c: sec.light });
      if (Math.floor(s / 12) % 2 === 0) dashes.push(s);
    }
    const dotMesh = new THREE.InstancedMesh(dotGeo, dotMat, dots.length);
    dots.forEach((d, i) => {
      this.frameMatrix(d.s, d.x, 0.1, m);
      dotMesh.setMatrixAt(i, m);
      dotMesh.setColorAt(i, col.setRGB(d.c[0], d.c[1], d.c[2]));
    });
    dotMesh.frustumCulled = false;
    scene.add(dotMesh);
    const dashMesh = new THREE.InstancedMesh(dashGeo, dashMat, dashes.length * 2);
    dashes.forEach((s, i) => {
      this.frameMatrix(s, -0.4, 0.03, m); dashMesh.setMatrixAt(i * 2, m);
      this.frameMatrix(s, 0.4, 0.03, m); dashMesh.setMatrixAt(i * 2 + 1, m);
    });
    dashMesh.frustumCulled = false;
    scene.add(dashMesh);

    // --- ceiling light panels (tunnels) ---
    const panels = [];
    for (let s = 8; s < this.length; s += 16) {
      const c = this.ceilA[Math.round(this._idx(s))];
      if (c > 0) panels.push(s);
    }
    const panelMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(6, 0.2, 2.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.95, 0.85) }), panels.length * 2);
    panels.forEach((s, i) => {
      const c = this.ceil(s);
      const hw = this.hw(s);
      this.frameMatrix(s, -hw * 0.45, c - 0.15, m); panelMesh.setMatrixAt(i * 2, m);
      this.frameMatrix(s, hw * 0.45, c - 0.15, m); panelMesh.setMatrixAt(i * 2 + 1, m);
    });
    panelMesh.frustumCulled = false;
    scene.add(panelMesh);

    // --- obstacles: pillars and beams ---
    const concreteMat = new THREE.MeshStandardMaterial({ color: 0x6d7076, map: tex.concrete, bumpMap: tex.concrete, bumpScale: 2, roughness: 0.8, metalness: 0.15 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4e4a48, map: tex.concrete, bumpMap: tex.concrete, bumpScale: 4, roughness: 0.95, flatShading: true });
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.45, metalness: 0.85 });
    const pillars = this.obstacles.filter((o) => o.type === 'pillar' && !o.deco);
    const masts = this.obstacles.filter((o) => o.deco === 'mast');
    const rocks = this.obstacles.filter((o) => o.deco === 'rock');
    const beams = this.obstacles.filter((o) => o.type === 'beam');
    const pillarMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), concreteMat, pillars.length);
    pillars.forEach((o, i) => {
      const h = this.ceil(o.s) < 1e8 ? this.ceil(o.s) : 40;
      this.frameMatrix(o.s, o.x, h / 2, m, o.r * 2, h, o.r * 2);
      pillarMesh.setMatrixAt(i, m);
    });
    scene.add(pillarMesh);
    pillarMesh.frustumCulled = false;
    const mastMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 1, 1, 8), mastMat, masts.length);
    masts.forEach((o, i) => {
      this.frameMatrix(o.s, o.x, 35, m, o.r * 1.4, 70, o.r * 1.4);
      mastMesh.setMatrixAt(i, m);
    });
    mastMesh.frustumCulled = false;
    scene.add(mastMesh);
    const rockGeo = new THREE.DodecahedronGeometry(1, 1);
    {
      const p = rockGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = 0.75 + 0.5 * fbm3(p.getX(i) * 2, p.getY(i) * 2, p.getZ(i) * 2, 2);
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
      }
      rockGeo.computeVertexNormals();
    }
    const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
    rocks.forEach((o, i) => {
      this.frameMatrix(o.s, o.x, 18, m, o.r * 1.3, 26, o.r * 1.3);
      rockMesh.setMatrixAt(i, m);
    });
    rockMesh.frustumCulled = false;
    scene.add(rockMesh);
    const beamMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), concreteMat, beams.length);
    beams.forEach((o, i) => {
      this.frameMatrix(o.s, 0, o.y, m, this.hw(o.s) * 2 + 6, o.r * 2, o.r * 2.4);
      beamMesh.setMatrixAt(i, m);
    });
    beamMesh.frustumCulled = false;
    scene.add(beamMesh);
    // warning lights on obstacles
    const warn = [];
    for (const o of pillars) for (const y of [6, 18]) for (const side of [-1, 1]) warn.push([o.s - o.r - 0.05, o.x + side * o.r * 0.6, y]);
    for (const o of masts) warn.push([o.s, o.x, 70.5], [o.s - o.r, o.x, 12]);
    for (const o of beams) {
      const hw = this.hw(o.s);
      for (let x = -hw + 2; x <= hw - 2; x += 4) warn.push([o.s - o.r * 1.2 - 0.05, x, o.y]);
    }
    const warnMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.5, 0.15), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 0.4, 0.15) }), warn.length);
    warn.forEach((w, i) => { this.frameMatrix(w[0], w[1], w[2], m); warnMesh.setMatrixAt(i, m); });
    warnMesh.frustumCulled = false;
    scene.add(warnMesh);

    // --- distant megastructure towers beyond canyon rims ---
    const towers = [];
    for (let s = 400; s < this.length; s += 45) {
      const i = Math.round(this._idx(s));
      if (this.canyonA[i] < 0.5) continue;
      for (const side of [-1, 1]) {
        if (rng() < 0.35) continue;
        const hw = this.hw(s);
        towers.push({ s, x: side * (hw + 70 + rng() * 260), h: 90 + rng() * 260, w: 14 + rng() * 34, d: 14 + rng() * 30 });
      }
    }
    const towerMat = new THREE.MeshStandardMaterial({
      color: 0x101216, roughness: 0.6, metalness: 0.6, emissive: 0xffffff, emissiveMap: tex.windows, emissiveIntensity: 0.7, map: tex.windows,
    });
    const towerMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), towerMat, towers.length);
    const beacons = new THREE.InstancedMesh(new THREE.SphereGeometry(1.2, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.2, 0.1) }), towers.length);
    towers.forEach((t, i) => {
      this.frameMatrix(t.s, t.x, t.h / 2 - 40, m, t.w, t.h, t.d);
      towerMesh.setMatrixAt(i, m);
      this.frameMatrix(t.s, t.x, t.h - 39, m);
      beacons.setMatrixAt(i, m);
    });
    towerMesh.frustumCulled = false;
    beacons.frustumCulled = false;
    scene.add(towerMesh, beacons);
    this.beaconMat = beacons.material;
  }
}

const _fr = { pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), bank: 0 };
const _v = new THREE.Vector3(), _back = new THREE.Vector3(), _r2 = new THREE.Vector3(), _u2 = new THREE.Vector3();

export function makeFrame() {
  return { pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), bank: 0 };
}

function makeTextures() {
  const concrete = canvasTexture(512, (g, S) => {
    g.fillStyle = '#8a8a8a';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) {
      const v = (Math.random() * 90 + 80) | 0;
      g.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.25})`;
      const r = Math.random() * 3 + 0.5;
      g.fillRect(Math.random() * S, Math.random() * S, r, r);
    }
    // panel seams
    g.strokeStyle = 'rgba(20,20,20,0.7)';
    g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(0, i * 128); g.lineTo(S, i * 128); g.stroke();
    }
    for (let i = 0; i <= 2; i++) {
      g.beginPath(); g.moveTo(i * 256, 0); g.lineTo(i * 256, S); g.stroke();
    }
    // rain streaks / stains
    for (let i = 0; i < 160; i++) {
      const x = Math.random() * S, y = Math.random() * S, h = Math.random() * 140 + 20;
      const grd = g.createLinearGradient(x, y, x, y + h);
      grd.addColorStop(0, 'rgba(30,30,30,0.35)');
      grd.addColorStop(1, 'rgba(30,30,30,0)');
      g.fillStyle = grd;
      g.fillRect(x, y, Math.random() * 4 + 1, h);
    }
  });
  const floor = canvasTexture(512, (g, S) => {
    g.fillStyle = '#5a5d62';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 6000; i++) {
      const v = (Math.random() * 60 + 50) | 0;
      g.fillStyle = `rgba(${v},${v},${v + 4},${Math.random() * 0.3})`;
      g.fillRect(Math.random() * S, Math.random() * S, Math.random() * 6, Math.random() * 2);
    }
    g.strokeStyle = 'rgba(15,15,18,0.9)';
    g.lineWidth = 4;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(0, i * 128); g.lineTo(S, i * 128); g.stroke();
      g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, S); g.stroke();
    }
    g.fillStyle = 'rgba(200,200,205,0.25)';
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) {
      for (const [dx, dy] of [[10, 10], [118, 10], [10, 118], [118, 118]]) {
        g.beginPath(); g.arc(x * 128 + dx, y * 128 + dy, 3, 0, 6.28); g.fill();
      }
    }
    // tyre-ish scuffs
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(10,10,10,${Math.random() * 0.25})`;
      g.fillRect(Math.random() * S, 0, Math.random() * 18 + 4, S);
    }
  }, { srgb: true });
  const floorRough = canvasTexture(256, (g, S) => {
    g.fillStyle = '#666';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 50; i++) {
      // wet puddles = smoother patches
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      const x = Math.random() * S, y = Math.random() * S, r = Math.random() * 50 + 10;
      g.save(); g.translate(x, y); g.scale(r, r * 0.6);
      grd.addColorStop(0, 'rgba(20,20,20,0.9)'); grd.addColorStop(1, 'rgba(20,20,20,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(0, 0, 1, 0, 6.28); g.fill(); g.restore();
    }
  });
  concrete.colorSpace = THREE.SRGBColorSpace;
  const windows = canvasTexture(256, (g, S) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    for (let y = 2; y < S; y += 6) {
      for (let x = 2; x < S; x += 5) {
        if (Math.random() < 0.13) {
          const warm = Math.random() < 0.6;
          const a = Math.random() * 0.7 + 0.3;
          g.fillStyle = warm ? `rgba(255,${(170 + Math.random() * 50) | 0},110,${a})` : `rgba(150,200,255,${a})`;
          g.fillRect(x, y, 3, 3);
        }
      }
    }
  }, { srgb: true });
  windows.repeat.set(1, 1);
  return { concrete, floor, floorRough, windows };
}
