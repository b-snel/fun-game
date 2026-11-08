import * as THREE from 'three';
import { PLAYER_COLORS } from './ship.js';

const ARCS = 3;
const K = 22;

export class TetherFX {
  constructor(scene) {
    this.uniforms = {
      uTime: { value: 0 },
      uA: { value: PLAYER_COLORS[0].clone() },
      uB: { value: PLAYER_COLORS[1].clone() },
      uStrain: { value: 0 },
      uAlpha: { value: 1 },
      uLen: { value: 30 },
    };
    const mat = (width) =>
      new THREE.ShaderMaterial({
        uniforms: { ...this.uniforms, uW: { value: width } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth;
          void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vDepth = -mv.z; gl_Position = projectionMatrix*mv; }`,
        fragmentShader: `uniform float uTime; uniform vec3 uA; uniform vec3 uB; uniform float uStrain; uniform float uAlpha; uniform float uLen; uniform float uW;
          varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth;
          void main(){
            float y = vUv.y;
            vec3 c = mix(uA, uB, smoothstep(0.15, 0.85, y));
            c = mix(c, vec3(1.0, 0.12, 0.08), uStrain);
            float pulse = 0.55 + 0.45*sin(y*uLen*0.9 - uTime*50.0);
            float pulse2 = 0.5 + 0.5*sin(y*uLen*0.23 + uTime*17.0);
            float rim = abs(dot(vN, vV));
            float core = uW < 0.5 ? pow(rim, 0.6) : pow(rim, 2.5) * 0.45;
            float flick = 1.0 - uStrain * step(0.6, fract(sin(uTime*91.0)*43758.5));
            vec3 col = (uW < 0.5 ? mix(c, vec3(1.0), 0.45) * 1.5 : c * 1.1) * core * (0.6 + 0.4*pulse + 0.3*pulse2) * flick;
            gl_FragColor = vec4(col * uAlpha * smoothstep(2.0, 9.0, vDepth), 1.0);
          }`,
      });
    const geo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    this.core = new THREE.Mesh(geo, mat(0.1));
    this.glow = new THREE.Mesh(geo, mat(1.0));
    for (const m of [this.core, this.glow]) {
      m.frustumCulled = false;
      m.renderOrder = 7;
      scene.add(m);
    }
    // lightning arcs
    this.arcs = [];
    const arcMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: `attribute float aT; varying float vT; varying float vDepth; void main(){ vT = aT; vec4 mv = modelViewMatrix*vec4(position,1.0); vDepth = -mv.z; gl_Position = projectionMatrix*mv;} `,
      fragmentShader: `uniform vec3 uA; uniform vec3 uB; uniform float uStrain; uniform float uAlpha; varying float vT; varying float vDepth;
        void main(){ vec3 c = mix(uA, uB, vT); c = mix(c, vec3(1.0,0.2,0.1), uStrain); gl_FragColor = vec4((c*1.2+0.4) * 0.9 * uAlpha * smoothstep(2.0, 9.0, vDepth), 1.0);} `,
    });
    for (let a = 0; a < ARCS; a++) {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(K * 4 * 3);
      const aT = new Float32Array(K * 4);
      const idx = [];
      for (let i = 0; i < K; i++) for (let j = 0; j < 4; j++) aT[i * 4 + j] = i / (K - 1);
      for (let i = 0; i < K - 1; i++) {
        const b = i * 4;
        idx.push(b, b + 1, b + 4, b + 1, b + 5, b + 4);
        idx.push(b + 2, b + 3, b + 6, b + 3, b + 7, b + 6);
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, arcMat);
      m.frustumCulled = false;
      m.renderOrder = 8;
      scene.add(m);
      this.arcs.push(m);
    }
    this.visible = true;
  }

  update(a, b, state, time, dt) {
    // state: { on, strain, form } form 0..1 (reconnect animation)
    const on = state.on || state.form > 0.01;
    for (const m of [this.core, this.glow, ...this.arcs]) m.visible = on;
    if (!on) return;
    _d.subVectors(b, a);
    const len = _d.length();
    const visLen = state.on ? len : len * state.form;
    _mid.copy(a).addScaledVector(_d, visLen / len / 2);
    _q.setFromUnitVectors(_y, _d.clone().normalize());
    const pulse = 1 + Math.sin(time * 30) * 0.1;
    this.core.position.copy(_mid);
    this.core.quaternion.copy(_q);
    this.core.scale.set(0.09 * pulse, visLen, 0.09 * pulse);
    this.glow.position.copy(_mid);
    this.glow.quaternion.copy(_q);
    const gw = 0.38 + state.strain * 0.5 + (state.sync ? 1.2 : 0);
    this.glow.scale.set(gw, visLen, gw);
    this.uniforms.uTime.value = time;
    this.uniforms.uStrain.value = state.strain * state.strain;
    this.uniforms.uLen.value = len;
    this.uniforms.uAlpha.value = state.on ? 1 : state.form * 0.6;

    // arcs
    _dir.copy(_d).normalize();
    _p1.set(0, 1, 0);
    if (Math.abs(_dir.y) > 0.9) _p1.set(1, 0, 0);
    _p1.cross(_dir).normalize();
    _p2.crossVectors(_dir, _p1).normalize();
    const amp = 0.5 + state.strain * 2.2 + (state.sync ? 1.5 : 0);
    for (let k = 0; k < ARCS; k++) {
      const arr = this.arcs[k].geometry.attributes.position.array;
      const w = 0.05;
      for (let i = 0; i < K; i++) {
        const t = i / (K - 1);
        const env = Math.sin(Math.PI * t);
        const ox = (Math.random() * 2 - 1) * amp * env;
        const oy = (Math.random() * 2 - 1) * amp * env;
        _p.copy(a).addScaledVector(_d, t * (visLen / len)).addScaledVector(_p1, ox).addScaledVector(_p2, oy);
        const o = i * 12;
        arr[o] = _p.x + _p1.x * w; arr[o + 1] = _p.y + _p1.y * w; arr[o + 2] = _p.z + _p1.z * w;
        arr[o + 3] = _p.x - _p1.x * w; arr[o + 4] = _p.y - _p1.y * w; arr[o + 5] = _p.z - _p1.z * w;
        arr[o + 6] = _p.x + _p2.x * w; arr[o + 7] = _p.y + _p2.y * w; arr[o + 8] = _p.z + _p2.z * w;
        arr[o + 9] = _p.x - _p2.x * w; arr[o + 10] = _p.y - _p2.y * w; arr[o + 11] = _p.z - _p2.z * w;
      }
      this.arcs[k].geometry.attributes.position.needsUpdate = true;
      this.arcs[k].visible = Math.random() < 0.75;
    }
  }
}

const _d = new THREE.Vector3(), _mid = new THREE.Vector3(), _q = new THREE.Quaternion(), _y = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _p = new THREE.Vector3();
