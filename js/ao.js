'use strict';
/* ==========================================================================
   ao.js · light the camera sees, worked out from the depth the scene pass has
   already written (no second render of the scene, so leaves and grass cut out
   by their alpha behave exactly as they look):
   - ambient occlusion: the soft shadow a crease, a corner, a body on the ground
     holds in any light
   - sun shafts: when the low sun is in view, its light streams round whatever
     stands against the sky (columns, trees, Ariel himself)
   - depth of field in cutscenes: like a film lens, the background softens
     behind whoever the camera is on
   ========================================================================== */

const AO_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

class AOPass {
  constructor(camera) {
    this.enabled = true; this.needsSwap = true; this.clear = false; this.renderToScreen = false;
    this.camera = camera;
    this.shafts = true;
    const half = () => {
      const t = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
      t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
      return t;
    };
    this.rt = half(); this.rtS = half();
    const common = { tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 1000 }, uProjInv: { value: new THREE.Matrix4() } };
    // occlusion at half resolution: a spiral of samples round each pixel, a hemisphere about the surface normal
    this.aoMat = new THREE.ShaderMaterial({
      uniforms: { ...common, uRes: { value: new THREE.Vector2(1, 1) }, uScale: { value: 1 }, uRadius: { value: 0.7 }, uFade: { value: new THREE.Vector2(30, 70) } },
      vertexShader: AO_VERT, depthTest: false, depthWrite: false,
      fragmentShader: `
        uniform sampler2D tDepth; uniform mat4 uProjInv; uniform vec2 uRes, uFade; uniform float uNear, uFar, uScale, uRadius;
        varying vec2 vUv;
        vec3 viewPos(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
          return v.xyz / v.w;
        }
        void main() {
          float d = texture2D(tDepth, vUv).x;
          if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
          vec3 P = viewPos(vUv);
          float dist = -P.z;
          if (dist > uFade.y) { gl_FragColor = vec4(1.0); return; }
          // the normal from the neighbours on whichever side lies on the same surface (no halo at silhouettes)
          vec2 px = 1.0 / uRes;
          vec3 r = viewPos(vUv + vec2(px.x, 0.0)), l = viewPos(vUv - vec2(px.x, 0.0));
          vec3 u = viewPos(vUv + vec2(0.0, px.y)), b = viewPos(vUv - vec2(0.0, px.y));
          vec3 dx = abs(r.z - P.z) < abs(P.z - l.z) ? r - P : P - l;
          vec3 dy = abs(u.z - P.z) < abs(P.z - b.z) ? u - P : P - b;
          vec3 n = normalize(cross(dx, dy));
          // a different turn of the spiral at every pixel (interleaved gradient noise); the blur evens it out
          float rot = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          float rpx = clamp(uRadius * uScale / dist, 3.0, 70.0);
          float occ = 0.0;
          const int N = 12;
          for (int i = 0; i < N; i++) {
            float t = (float(i) + 0.5) / float(N);
            float a = float(i) * 2.39996 + rot;
            vec2 suv = vUv + vec2(cos(a), sin(a)) * (t * t * rpx + 1.0) * px;
            vec3 v = viewPos(suv) - P;
            float len = length(v);
            // only what lies above the surface and within reach occludes it
            occ += max(0.0, dot(n, v) / (len + 1e-4) - 0.12) * (1.0 - smoothstep(uRadius * 0.6, uRadius * 1.6, len));
          }
          float vis = clamp(1.0 - occ / float(N) * 1.9, 0.0, 1.0);
          vis = mix(vis, 1.0, smoothstep(uFade.x, uFade.y, dist));
          gl_FragColor = vec4(vis, vis, vis, 1.0);
        }`,
    });
    // sun shafts at half resolution: march from each pixel toward the sun, gathering the open sky it crosses
    this.shaftMat = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null }, tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 } },
      vertexShader: AO_VERT, depthTest: false, depthWrite: false,
      fragmentShader: `
        uniform sampler2D tDepth, tDiffuse; uniform vec2 uSun; uniform float uAspect;
        varying vec2 vUv;
        float sky(vec2 uv) {
          if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
          if (texture2D(tDepth, uv).x < 0.99999) return 0.0;
          vec2 d = (uv - uSun) * vec2(uAspect, 1.0);
          // the sky near the sun, weighted by how bright it actually is there (cloud blocks it)
          float l = dot(texture2D(tDiffuse, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
          return smoothstep(0.55, 0.0, length(d)) * clamp(l, 0.0, 2.5);
        }
        void main() {
          const int N = 40;
          vec2 delta = (uSun - vUv) / float(N) * 0.92;
          float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          vec2 uv = vUv + delta * jit;
          float acc = 0.0, w = 1.0;
          for (int i = 0; i < N; i++) { acc += sky(uv) * w; w *= 0.965; uv += delta; }
          acc /= float(N) * 0.42;
          gl_FragColor = vec4(vec3(acc), 1.0);
        }`,
    });
    // composite: the occlusion blurred on the way up (only across the same surface), the shafts added
    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        ...common, tDiffuse: { value: null }, tAO: { value: this.rt.texture }, tShaft: { value: this.rtS.texture }, uAORes: { value: new THREE.Vector2(1, 1) },
        uStrength: { value: 0.85 }, uShaft: { value: 0 }, uShaftColor: { value: new THREE.Color(1.0, 0.72, 0.42) },
        uDof: { value: 0 }, uFocus: { value: 3 }, uRes: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: AO_VERT, depthTest: false, depthWrite: false,
      fragmentShader: `
        #include <packing>
        uniform sampler2D tDiffuse, tAO, tShaft, tDepth; uniform vec2 uAORes, uRes; uniform float uNear, uFar, uStrength, uShaft, uDof, uFocus; uniform vec3 uShaftColor;
        varying vec2 vUv;
        float lz(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
        // the lens: how many pixels across a point at depth z is smeared, focused at uFocus (far away much more than near)
        float coc(float z) { float c = (z - uFocus) / max(z, 0.01); return uDof * (c > 0.0 ? c * 11.0 : -c * 4.0); }
        void main() {
          vec4 col = texture2D(tDiffuse, vUv);
          if (uDof > 0.0) {
            float r = coc(lz(vUv));
            if (r > 0.6) {
              // a disc of samples (golden spiral); a sample nearer than the focus can't bleed sharp-edged onto this one
              vec3 acc = col.rgb; float wsum = 1.0;
              for (int i = 0; i < 20; i++) {
                float t = (float(i) + 0.5) / 20.0, a = float(i) * 2.39996;
                vec2 uv = vUv + vec2(cos(a), sin(a)) * sqrt(t) * r / uRes;
                float w = clamp(coc(lz(uv)) / r, 0.0, 1.0);
                acc += texture2D(tDiffuse, uv).rgb * w; wsum += w;
              }
              col.rgb = mix(col.rgb, acc / wsum, smoothstep(0.6, 2.0, r));
            }
          }
          if (uStrength > 0.0) {
            float zc = lz(vUv);
            vec2 tx = 1.0 / uAORes;
            float sum = 0.0, wsum = 0.0;
            for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
              vec2 o = vec2(float(x), float(y)) * tx;
              float w = (x == 0 && y == 0 ? 1.0 : 0.6) / (0.002 * zc + abs(lz(vUv + o) - zc));
              sum += texture2D(tAO, vUv + o).r * w; wsum += w;
            }
            float ao = sum / wsum;
            // light itself is never shadowed: bright sky, fire and lightning keep their full strength
            float lum = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
            ao = mix(ao, 1.0, smoothstep(1.2, 3.0, lum));
            col.rgb *= mix(1.0, ao, uStrength);
          }
          if (uShaft > 0.0) col.rgb += texture2D(tShaft, vUv).r * uShaft * uShaftColor;
          gl_FragColor = col;
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.aoMat);
    this.quad.frustumCulled = false;
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._v = new THREE.Vector3();
    this.shaftK = 0;
  }
  setSize(w, h) {
    const hw = Math.max(1, Math.floor(w / 2)), hh = Math.max(1, Math.floor(h / 2));
    this.rt.setSize(hw, hh); this.rtS.setSize(hw, hh);
    this.aoMat.uniforms.uRes.value.set(w, h);
    this.compMat.uniforms.uAORes.value.set(hw, hh);
    this.compMat.uniforms.uRes.value.set(w, h);
    this.dofScale = h / 720;
    this.shaftMat.uniforms.uAspect.value = w / h;
  }
  /** where the sun is on screen, and how much of its light can stream into the shot (0 when behind the camera) */
  sunOnScreen() {
    if (G.activeScene !== G.scene || !World.ready) return 0;
    const cam = this.camera, p = this._v.copy(World.sunDir).multiplyScalar(5000).add(cam.position).project(cam);
    const fwd = cam.getWorldDirection(new THREE.Vector3()).dot(World.sunDir);
    if (fwd <= 0.05) return 0;
    this.shaftMat.uniforms.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    // full strength with the sun in frame, fading out as it leaves the edges
    const off = Math.max(Math.abs(p.x), Math.abs(p.y));
    return smooth(1.6, 0.9, off) * smooth(0.05, 0.35, fwd);
  }
  render(renderer, writeBuffer, readBuffer, dt) {
    const depth = readBuffer.depthTexture, cam = this.camera;
    const set = (m) => { m.uniforms.tDepth.value = depth; if (m.uniforms.uNear) { m.uniforms.uNear.value = cam.near; m.uniforms.uFar.value = cam.far; m.uniforms.uProjInv.value.copy(cam.projectionMatrixInverse); } };
    const C = this.compMat.uniforms;
    if (this.ao !== false) {
      set(this.aoMat);
      // pixels per metre at a metre away, so the sampling radius is a fixed size in the world
      this.aoMat.uniforms.uScale.value = this.aoMat.uniforms.uRes.value.y / (2 * Math.tan((cam.fov * Math.PI) / 360));
      this.quad.material = this.aoMat;
      renderer.setRenderTarget(this.rt);
      renderer.render(this.quad, this.ortho);
      C.uStrength.value = 0.85;
    } else C.uStrength.value = 0;
    const want = this.shafts ? this.sunOnScreen() : 0;
    this.shaftK = damp(this.shaftK, want, 4, Math.min(0.1, dt || 0.016));
    if (this.shaftK > 0.005) {
      set(this.shaftMat);
      this.shaftMat.uniforms.tDiffuse.value = readBuffer.texture;
      this.quad.material = this.shaftMat;
      renderer.setRenderTarget(this.rtS);
      renderer.render(this.quad, this.ortho);
    }
    C.uShaft.value = this.shaftK * (G.shaftStrength ?? 0.42);
    // in a cutscene, focus on whatever the camera looks at; the closer the shot, the softer the background
    const look = G.state === 'cutscene' && Cutscene.active ? (Cutscene.tween ? Cutscene.tween.look : Cutscene.lastLook) : null;
    const focus = look ? cam.position.distanceTo(look) : 0;
    this.dofK = damp(this.dofK || 0, look && this.dof !== false ? smooth(14, 3, focus) : 0, 3, Math.min(0.1, dt || 0.016));
    if (look) C.uFocus.value = focus;
    C.uDof.value = this.dofK * (this.dofScale || 1);
    set(this.compMat);
    C.tDiffuse.value = readBuffer.texture;
    this.quad.material = this.compMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    renderer.render(this.quad, this.ortho);
  }
  dispose() { this.rt.dispose(); this.rtS.dispose(); this.aoMat.dispose(); this.shaftMat.dispose(); this.compMat.dispose(); }
}
