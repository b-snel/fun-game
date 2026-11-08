import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { damp } from './util.js';

const MOODS = {
  hangar: { fog: 0x0d0f12, density: 0.006, sky: 0x0a0d12, horizon: 0x1a2028, hemi: 0x6a7a90, rain: 0 },
  trench: { fog: 0x0a1418, density: 0.0042, sky: 0x03070b, horizon: 0x1b3440, hemi: 0x5a7a90, rain: 1 },
  undercity: { fog: 0x170e07, density: 0.0058, sky: 0x050302, horizon: 0x2a1608, hemi: 0x806040, rain: 0 },
  collapse: { fog: 0x1c0805, density: 0.005, sky: 0x080202, horizon: 0x5a1406, hemi: 0x904030, rain: 1 },
  warden: { fog: 0x0b1017, density: 0.0034, sky: 0x020408, horizon: 0x1e2a3a, hemi: 0x6070a0, rain: 1 },
  dawn: { fog: 0x6b4c3e, density: 0.0018, sky: 0x2c4a78, horizon: 0xffa060, hemi: 0xffd0a0, rain: 0 },
};

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.fogColor = new THREE.Color(MOODS.hangar.fog);
    scene.fog = new THREE.FogExp2(this.fogColor.getHex(), MOODS.hangar.density);
    scene.background = this.fogColor.clone();

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.28;

    this.hemi = new THREE.HemisphereLight(0x6a7a90, 0x0a0806, 0.9);
    scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0xb0c4ff, 1.1);
    this.moon.position.set(0.3, 1, 0.2);
    scene.add(this.moon, this.moon.target);

    // sky dome follows whichever camera renders it
    this.skyUniforms = {
      uTop: { value: new THREE.Color(MOODS.hangar.sky) },
      uHorizon: { value: new THREE.Color(MOODS.hangar.horizon) },
      uTime: { value: 0 },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1800, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop; uniform vec3 uHorizon; uniform float uTime; varying vec3 vDir;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
          float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
            return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
          void main(){
            float y = clamp(vDir.y, -0.2, 1.0);
            vec3 c = mix(uHorizon, uTop, pow(max(y,0.0), 0.45));
            vec2 uv = vDir.xz / (abs(vDir.y)+0.25) * 2.0 + vec2(uTime*0.02, 0.0);
            float cl = n(uv) * 0.6 + n(uv*2.3) * 0.3 + n(uv*5.1)*0.1;
            c = mix(c, uHorizon*1.3, smoothstep(0.45, 0.9, cl) * 0.35 * smoothstep(0.0, 0.3, y));
            gl_FragColor = vec4(c, 1.0);
          }`,
      })
    );
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    sky.onBeforeRender = (r, s, cam) => {
      sky.position.copy(cam.position);
      sky.updateMatrixWorld();
    };
    scene.add(sky);

    // rain streaks
    const N = 4000;
    const pos = new Float32Array(N * 2 * 3);
    const off = new Float32Array(N * 2 * 3);
    const end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random() * 220, y = Math.random() * 120, z = Math.random() * 220;
      for (let k = 0; k < 2; k++) {
        off.set([x, y, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k;
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rg.setAttribute('offset', new THREE.BufferAttribute(off, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rainUniforms = {
      uCenter: { value: new THREE.Vector3() },
      uVel: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uAlpha: { value: 0 },
    };
    this.rain = new THREE.LineSegments(
      rg,
      new THREE.ShaderMaterial({
        uniforms: this.rainUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec3 offset; attribute float aEnd;
          uniform vec3 uCenter; uniform vec3 uVel; uniform float uTime;
          varying float vA;
          void main(){
            vec3 size = vec3(220.0, 120.0, 220.0);
            vec3 base = offset + vec3(0.0, -uTime*70.0, 0.0);
            vec3 rel = mod(base - uCenter + size*0.5, size) - size*0.5;
            vec3 streak = (vec3(0.0,-70.0,0.0) - uVel) * 0.022;
            vec3 w = uCenter + rel + streak * aEnd;
            vA = (1.0 - aEnd*0.7);
            gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uAlpha; varying float vA;
          void main(){ gl_FragColor = vec4(vec3(0.55,0.65,0.8) * uAlpha * vA, 1.0); }`,
      })
    );
    this.rain.frustumCulled = false;
    scene.add(this.rain);

    this.mood = 'hangar';
    this.cur = { ...MOODS.hangar, fogC: new THREE.Color(MOODS.hangar.fog), skyC: new THREE.Color(MOODS.hangar.sky), horC: new THREE.Color(MOODS.hangar.horizon), hemiC: new THREE.Color(MOODS.hangar.hemi) };
    this.flash = 0; // collapse / explosion ambient flash
  }

  setMood(id) {
    if (MOODS[id]) this.mood = id;
  }

  update(dt, time, center, vel, inTunnel) {
    const m = MOODS[this.mood];
    const k = 1 - Math.exp(-0.9 * dt);
    this.cur.fogC.lerp(_c.set(m.fog), k);
    this.cur.skyC.lerp(_c.set(m.sky), k);
    this.cur.horC.lerp(_c.set(m.horizon), k);
    this.cur.hemiC.lerp(_c.set(m.hemi), k);
    this.cur.density = damp(this.cur.density, m.density, 0.9, dt);
    this.cur.rain = damp(this.cur.rain, inTunnel ? 0 : m.rain, 2.5, dt);
    this.flash = Math.max(0, this.flash - dt * 3);

    const fc = _c2.copy(this.cur.fogC);
    if (this.flash > 0) fc.lerp(_c.setRGB(0.5, 0.25, 0.1), Math.min(0.25, this.flash * 0.2));
    this.scene.fog.color.copy(fc);
    this.scene.fog.density = this.cur.density;
    this.scene.background.copy(fc);
    this.skyUniforms.uTop.value.copy(this.cur.skyC);
    this.skyUniforms.uHorizon.value.copy(this.cur.horC);
    this.skyUniforms.uTime.value = time;
    this.hemi.color.copy(this.cur.hemiC);
    this.hemi.intensity = 0.8 + this.flash * 0.3;
    this.moon.intensity = this.mood === 'dawn' ? 2.2 : 0.9;
    this.moon.color.set(this.mood === 'dawn' ? 0xffc890 : 0xb0c4ff);
    this.moon.target.position.copy(center);
    this.moon.position.copy(center).add(_v.set(120, 300, 80));

    this.rainUniforms.uCenter.value.copy(center);
    this.rainUniforms.uVel.value.copy(vel);
    this.rainUniforms.uTime.value = time;
    this.rainUniforms.uAlpha.value = this.cur.rain * 0.18;
    this.rain.visible = this.cur.rain > 0.01;
  }
}

const _c = new THREE.Color(), _c2 = new THREE.Color(), _v = new THREE.Vector3();
