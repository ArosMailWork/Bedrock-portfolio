// Post-processing. The scene renders into a 4x MSAA half-float target, then:
//   1. Bloom (like bruno-simon.com: threshold 1, strength 0.25): soft-threshold prefilter, a 5-level
//      dual-filter downsample chain, then upsampling back while adding each level.
//   2. Composite: tilt-shift edge blur / transition haze / camera motion blur, bloom, exposure, violet vignette,
//      conversion to sRGB, then colour grading in display space (contrast, saturation, split toning:
//      violet shadows / warm highlights, after Bruno's day palette).
// POST_SETTINGS is mutable (settings panel); POST_CONTROLS describes the sliders. To add an effect:
// add a uniform + GLSL in the composite pass, a default in POST_DEFAULTS and a row in POST_CONTROLS.
import * as THREE from 'three';

export const POST_DEFAULTS = {
  enabled: true,
  bloomStrength: 0.25, bloomThreshold: 1.0, bloomRadius: 0.75,
  exposure: 1.0, contrast: 1.06, saturation: 1.15,
  shadowTint: 0.35, highlightTint: 0.25, vignette: 0.45,
};
export const POST_SETTINGS = { ...POST_DEFAULTS };
export const POST_CONTROLS = [
  { key: 'bloomStrength', label: 'Bloom strength', min: 0, max: 1.5, step: 0.01 },
  { key: 'bloomThreshold', label: 'Bloom threshold', min: 0.2, max: 2, step: 0.01 },
  { key: 'bloomRadius', label: 'Bloom radius', min: 0, max: 1, step: 0.01 },
  { key: 'exposure', label: 'Exposure', min: 0.5, max: 1.6, step: 0.01 },
  { key: 'contrast', label: 'Contrast', min: 0.7, max: 1.4, step: 0.01 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01 },
  { key: 'shadowTint', label: 'Violet shadows', min: 0, max: 1, step: 0.01 },
  { key: 'highlightTint', label: 'Warm highlights', min: 0, max: 1, step: 0.01 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01 },
];
// Split-toning colours (sRGB): Bruno's day shadowColor and lightColor.
export const GRADE_COLORS = { shadow: 0x6d3fff, highlight: 0xffd2c2 };

const BLOOM_LEVELS = 5;
const srgb = (hex) => new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
const VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const pass = (fragmentShader, uniforms) => new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader, depthTest: false, depthWrite: false });
// Dual-filter downsample: centre x4 + four diagonal taps, read at 1 texel of the source.
const DOWN = `
  uniform sampler2D tInput; uniform vec2 uTexel; varying vec2 vUv;
  vec3 down() {
    vec3 c = texture2D(tInput, vUv).rgb * 4.0;
    c += texture2D(tInput, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tInput, vUv + uTexel * vec2(1.0, -1.0)).rgb;
    c += texture2D(tInput, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tInput, vUv + uTexel * vec2(1.0, 1.0)).rgb;
    return c / 8.0;
  }`;

export function createPost(renderer) {
  const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
  const rt = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const downs = Array.from({ length: BLOOM_LEVELS }, rt), ups = Array.from({ length: BLOOM_LEVELS }, rt);

  const prefilter = pass(`${DOWN}
    uniform float uThreshold;
    void main() {
      vec3 c = down();
      float b = max(c.r, max(c.g, c.b)), knee = uThreshold * 0.5 + 1e-4;
      float soft = clamp(b - uThreshold + knee, 0.0, 2.0 * knee);
      soft = soft * soft / (4.0 * knee);
      gl_FragColor = vec4(c * max(soft, b - uThreshold) / max(b, 1e-4), 1.0);
    }`, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 } });
  const downsample = pass(`${DOWN}\nvoid main() { gl_FragColor = vec4(down(), 1.0); }`,
    { tInput: { value: null }, uTexel: { value: new THREE.Vector2() } });
  // Tent upsample of the smaller level, added onto the current level.
  const upsample = pass(`
    uniform sampler2D tInput, tBase; uniform vec2 uTexel; uniform float uRadius; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tInput, vUv + uTexel * vec2(-2.0, 0.0)).rgb + texture2D(tInput, vUv + uTexel * vec2(2.0, 0.0)).rgb;
      c += texture2D(tInput, vUv + uTexel * vec2(0.0, -2.0)).rgb + texture2D(tInput, vUv + uTexel * vec2(0.0, 2.0)).rgb;
      c += (texture2D(tInput, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tInput, vUv + uTexel * vec2(1.0, -1.0)).rgb
          + texture2D(tInput, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tInput, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 2.0;
      gl_FragColor = vec4(texture2D(tBase, vUv).rgb + c / 12.0 * uRadius, 1.0);
    }`, { tInput: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.75 } });

  const uniforms = {
    tScene: { value: target.texture }, tBloom: { value: ups[0].texture },
    uTexel: { value: new THREE.Vector2() },
    uTilt: { value: 1 }, uHaze: { value: 0 },
    // Camera motion blur (transitions): uMotion = screen-space smear (UV), uZoomBlur = radial smear.
    uMotion: { value: new THREE.Vector2() }, uZoomBlur: { value: 0 }, uNoVignette: { value: 0 },
    uEnabled: { value: 1 }, uBloom: { value: 0.25 }, uExposure: { value: 1 }, uContrast: { value: 1 }, uSaturation: { value: 1 },
    uShadowTint: { value: 0 }, uHighlightTint: { value: 0 }, uVignette: { value: 0.45 },
    uShadowColor: { value: srgb(GRADE_COLORS.shadow) }, uHighlightColor: { value: srgb(GRADE_COLORS.highlight) },
  };
  const composite = pass(`
    uniform sampler2D tScene, tBloom; uniform vec2 uTexel;
    uniform vec2 uMotion; uniform float uZoomBlur, uNoVignette;
    uniform float uTilt, uHaze, uEnabled, uBloom, uExposure, uContrast, uSaturation, uShadowTint, uHighlightTint, uVignette;
    uniform vec3 uShadowColor, uHighlightColor;
    varying vec2 vUv;
    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
    void main() {
      float band = smoothstep(0.2, 0.5, abs(vUv.y - 0.55)) * uTilt;
      float radius = band * 7.0 + uHaze * 12.0;              // blur radius in pixels
      vec4 c = texture2D(tScene, vUv);
      if (radius > 0.3) {
        vec4 sum = c;
        for (int i = 0; i < 16; i++) {                          // golden-angle disc taps
          float a = float(i) * 2.39996, d = sqrt((float(i) + 0.5) / 16.0);
          sum += texture2D(tScene, vUv + vec2(cos(a), sin(a)) * d * radius * uTexel);
        }
        c = sum / 17.0;
      }
      if (length(uMotion) + abs(uZoomBlur) > 0.0005) {
        vec4 sum = vec4(0.0);
        for (int i = 0; i < 12; i++) {
          float t = float(i) / 11.0 - 0.5;
          sum += texture2D(tScene, vUv + uMotion * t + (vUv - 0.5) * uZoomBlur * t);
        }
        c = sum / 12.0;
      }
      vec3 col = c.rgb;
      if (uEnabled > 0.5) col = (col + texture2D(tBloom, vUv).rgb * uBloom) * uExposure;
      float v = length((vUv - 0.5) * vec2(1.0, 0.85));
      float shade = smoothstep(0.95, 0.35, v);
      float vignette = (uEnabled > 0.5 ? uVignette : 0.45) + uHaze * 0.5;
      if (uNoVignette < 0.5) col = mix(col * vec3(0.55, 0.5, 0.7), col, mix(1.0, shade, vignette));
      vec3 o = linearToOutputTexel(vec4(col, 1.0)).rgb;    // display (sRGB) space from here on
      if (uEnabled > 0.5) {
        o = (o - 0.5) * uContrast + 0.5;
        float l = dot(o, LUMA);
        o = mix(vec3(l), o, uSaturation);
        o = mix(o, o * uShadowColor, (1.0 - smoothstep(0.0, 0.55, l)) * uShadowTint);
        o = mix(o, o * uHighlightColor * 1.12, smoothstep(0.45, 1.0, l) * uHighlightTint);
      }
      gl_FragColor = vec4(clamp(o, 0.0, 1.0), 1.0);
    }`, uniforms);

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), composite);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene(), quadCamera = new THREE.Camera();
  quadScene.add(quad);
  const draw = (material, output) => { quad.material = material; renderer.setRenderTarget(output); renderer.render(quadScene, quadCamera); };
  const texel = (rtarget) => new THREE.Vector2(1 / rtarget.width, 1 / rtarget.height);

  function applySettings() {
    const s = POST_SETTINGS;
    uniforms.uEnabled.value = s.enabled ? 1 : 0;
    uniforms.uBloom.value = s.bloomStrength;
    uniforms.uExposure.value = s.exposure;
    uniforms.uContrast.value = s.contrast;
    uniforms.uSaturation.value = s.saturation;
    uniforms.uShadowTint.value = s.shadowTint;
    uniforms.uHighlightTint.value = s.highlightTint;
    uniforms.uVignette.value = s.vignette;
  }

  return {
    uniforms,
    settings: POST_SETTINGS,
    setSize(width, height) {
      const ratio = renderer.getPixelRatio(), w = Math.round(width * ratio), h = Math.round(height * ratio);
      target.setSize(w, h);
      uniforms.uTexel.value.set(1 / w, 1 / h);
      downs.forEach((d, i) => { const s = 2 ** (i + 1); d.setSize(Math.max(1, Math.round(w / s)), Math.max(1, Math.round(h / s))); });
      ups.forEach((u, i) => u.setSize(downs[i].width, downs[i].height));
    },
    render(scene, camera) {
      const s = POST_SETTINGS;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      if (s.enabled && s.bloomStrength > 0) {
        prefilter.uniforms.tInput.value = target.texture;
        prefilter.uniforms.uTexel.value.set(uniforms.uTexel.value.x, uniforms.uTexel.value.y);
        prefilter.uniforms.uThreshold.value = s.bloomThreshold;
        draw(prefilter, downs[0]);
        for (let i = 1; i < BLOOM_LEVELS; i++) {
          downsample.uniforms.tInput.value = downs[i - 1].texture;
          downsample.uniforms.uTexel.value.copy(texel(downs[i - 1]));
          draw(downsample, downs[i]);
        }
        // Smallest level seeds the upsample chain (base = itself, nothing added).
        upsample.uniforms.uRadius.value = 0;
        upsample.uniforms.tInput.value = downs[BLOOM_LEVELS - 1].texture;
        upsample.uniforms.tBase.value = downs[BLOOM_LEVELS - 1].texture;
        upsample.uniforms.uTexel.value.copy(texel(downs[BLOOM_LEVELS - 1]));
        draw(upsample, ups[BLOOM_LEVELS - 1]);
        upsample.uniforms.uRadius.value = s.bloomRadius;
        for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
          upsample.uniforms.tInput.value = ups[i + 1].texture;
          upsample.uniforms.tBase.value = downs[i].texture;
          upsample.uniforms.uTexel.value.copy(texel(ups[i + 1]));
          draw(upsample, ups[i]);
        }
      }
      applySettings();
      draw(composite, null);
    },
    // Colour-grade a texture into `output` like the screen (no blur, bloom or vignette): the baked map.
    grade(texture, output) {
      applySettings();
      const saved = [uniforms.tScene.value, uniforms.uTilt.value, uniforms.uHaze.value, uniforms.uMotion.value.clone(), uniforms.uZoomBlur.value];
      Object.assign(uniforms.tScene, { value: texture });
      uniforms.uTilt.value = 0; uniforms.uHaze.value = 0; uniforms.uMotion.value.set(0, 0); uniforms.uZoomBlur.value = 0;
      uniforms.uBloom.value = 0; uniforms.uNoVignette.value = 1;
      draw(composite, output);
      [uniforms.tScene.value, uniforms.uTilt.value, uniforms.uHaze.value] = saved;
      uniforms.uMotion.value.copy(saved[3]); uniforms.uZoomBlur.value = saved[4];
      uniforms.uNoVignette.value = 0;
    },
  };
}
