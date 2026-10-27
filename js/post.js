// Single full-screen pass: tilt-shift edge blur (top/bottom bands), vignette and the
// short transition haze. Replaces the old CSS blur, which forced costly compositing.
import * as THREE from 'three';

export function createPost(renderer) {
  const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
  const uniforms = {
    tScene: { value: target.texture },
    uTexel: { value: new THREE.Vector2() },
    uTilt: { value: 1 },
    uHaze: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tScene; uniform vec2 uTexel; uniform float uTilt, uHaze;
      varying vec2 vUv;
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
        // Small HDR bloom: only luminous surfaces spill light onto neighbours.
        vec3 glow = vec3(0.0);
        for (int i = 0; i < 16; i++) {
          float a = float(i) * 2.39996;
          float d = sqrt((float(i) + 0.5) / 16.0);
          vec3 sampleColor = texture2D(tScene, vUv + vec2(cos(a), sin(a)) * d * 18.0 * uTexel).rgb;
          glow += max(sampleColor - vec3(1.15), vec3(0.0));
        }
        c.rgb += glow * (0.3 / 16.0);
        float v = length((vUv - 0.5) * vec2(1.0, 0.85));
        float shade = smoothstep(0.95, 0.35, v);
        c.rgb = mix(c.rgb * vec3(0.55, 0.5, 0.7), c.rgb, mix(1.0, shade, 0.45 + uHaze * 0.5));
        gl_FragColor = linearToOutputTexel(vec4(c.rgb, 1.0));
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const quadScene = new THREE.Scene(), quadCamera = new THREE.Camera();
  quadScene.add(quad);
  return {
    uniforms,
    setSize(width, height) {
      const ratio = renderer.getPixelRatio();
      target.setSize(Math.round(width * ratio), Math.round(height * ratio));
      uniforms.uTexel.value.set(1 / (width * ratio), 1 / (height * ratio));
    },
    render(scene, camera) {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(quadScene, quadCamera);
    },
  };
}
