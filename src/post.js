import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uAberr: { value: 0 },
    uDamage: { value: 0 },
    uFlash: { value: 0 },
    uStatic: { value: 0 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uAspect: { value: 1 },
    uAlarm: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uSpeed; uniform float uAberr;
    uniform float uDamage; uniform float uFlash; uniform float uStatic; uniform vec3 uTint; uniform float uAspect; uniform float uAlarm;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime*7.0) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - vec2(0.5, 0.52);
      float r = length(c * vec2(uAspect, 1.0));
      // radial speed blur
      vec3 col = vec3(0.0);
      float blur = uSpeed * smoothstep(0.35, 1.0, r) * 0.012;
      float ab = uAberr * 0.0025 * r;
      for (int i = 0; i < 6; i++) {
        float k = float(i) / 5.0;
        vec2 o = c * blur * k;
        col.r += texture2D(tDiffuse, uv - o - c * ab).r;
        col.g += texture2D(tDiffuse, uv - o).g;
        col.b += texture2D(tDiffuse, uv - o + c * ab).b;
      }
      col /= 6.0;
      col *= uTint;
      // signal-lost static
      if (uStatic > 0.0) {
        // calm desaturate + dim instead of strobing TV static
        col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))), uStatic * 0.85);
        col *= 1.0 - 0.35 * uStatic;
      }
      // damage & alarm edge
      float edge = smoothstep(0.35, 0.95, r);
      col = mix(col, vec3(0.8, 0.05, 0.02), edge * (uDamage * 0.4 + uAlarm * 0.18));
      // vignette
      col *= 1.0 - smoothstep(0.45, 1.15, r) * 0.65;
      // grain
      col += (hash(uv * 1000.0) - 0.5) * 0.01;
      col = mix(col, vec3(1.0), min(uFlash, 0.6));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class ViewPost {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.renderToScreen = true;
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.25, 0.15, 0.95);
    this.output = new OutputPass();
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.final);
    this.u = this.final.uniforms;
  }
  setCamera(cam) {
    this.renderPass.camera = cam;
  }
  setSize(w, h) {
    this.composer.setSize(w, h);
    this.u.uAspect.value = w / h;
  }
  render(dt) {
    this.composer.render(dt);
  }
}
