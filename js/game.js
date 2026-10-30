import * as THREE from 'three';
import { mergeGeometries } from '../vendor/addons/utils/BufferGeometryUtils.js';

/* ============================================================
   PRIMAL ISLE — a compact ARK-inspired survival game for touch
   ============================================================ */

// ------------------------------------------------------------ utils
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const rr = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const C = hex => new THREE.Color(hex);

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const RNG = mulberry32(20261030);

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(
    lerp(hash2(xi, yi), hash2(xi + 1, yi), u),
    lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
}
function fbm(x, y, oct = 4) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * freq, y * freq);
    norm += amp; amp *= 0.5; freq *= 2.03;
  }
  return sum / norm;
}
function damp(current, target, lambda, dt) { return lerp(current, target, 1 - Math.exp(-lambda * dt)); }

// ------------------------------------------------------------ dom
const $ = id => document.getElementById(id);
const canvas = $('game');
const isTouch = matchMedia('(hover: none), (pointer: coarse)').matches;
const isSmall = innerWidth < 760;

// ------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isSmall ? 1.65 : 1.9));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe6e2, 90, 520);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.08, 1400);
scene.add(camera);
camera.position.set(18, 13, 101);

// ------------------------------------------------------------ world constants
const WORLD = 260;
const HALF = WORLD / 2;
const SEG = 176;
const STEP = WORLD / SEG;
const WATER_Y = 0;
const SPAWN = { x: 4, z: 84 };

const heights = new Float32Array((SEG + 1) * (SEG + 1));

function islandHeight(x, z) {
  const r = Math.hypot(x, z);
  const fall = Math.max(0, 1 - Math.pow(r / 112, 2.08));
  const big = fbm(x * 0.0155 + 13.7, z * 0.0155 - 6.2, 5);
  const detail = fbm(x * 0.052 - 2.1, z * 0.052 + 9.4, 3);
  let h = fall * (14.2 + 8.4 * (big - 0.5)) - 5.0;
  h += fall * detail * 2.1;
  const peak = Math.exp(-((x + 30) ** 2 + (z + 38) ** 2) / 1180);
  h += peak * fall * 25.5;
  const peak2 = Math.exp(-((x - 38) ** 2 + (z + 12) ** 2) / 780);
  h += peak2 * fall * 12.5;
  const peak3 = Math.exp(-((x + 62) ** 2 + (z - 52) ** 2) / 1000);
  h += peak3 * fall * 42;
  const peak4 = Math.exp(-((x + 86) ** 2 + (z + 22) ** 2) / 620);
  h += peak4 * fall * 16;
  // soft dunes / rocky ridge
  h += Math.max(0, fbm(x * 0.028 + 31, z * 0.028 + 4, 3) - 0.62) * 15 * fall;
  return h;
}

function heightAt(x, z) {
  const gx = clamp((x + HALF) / STEP, 0, SEG - 0.0001);
  const gz = clamp((z + HALF) / STEP, 0, SEG - 0.0001);
  const ix = gx | 0, iz = gz | 0;
  const fx = gx - ix, fz = gz - iz;
  const i = iz * (SEG + 1) + ix;
  const a = heights[i], b = heights[i + 1], c = heights[i + SEG + 1], d = heights[i + SEG + 2];
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}
function slopeAt(x, z) {
  const e = 1.1;
  const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
  const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  return Math.hypot(dx, dz);
}
function normalAt(x, z) {
  const e = 0.8;
  return V3(
    (heightAt(x - e, z) - heightAt(x + e, z)) / (2 * e),
    1,
    (heightAt(x, z - e) - heightAt(x, z + e)) / (2 * e)
  ).normalize();
}

// ------------------------------------------------------------ sky
const skyUniforms = {
  uTop: { value: C(0x3f9cd4) },
  uHorizon: { value: C(0xc9ece6) },
  uSunColor: { value: C(0xffe3b0) },
  uSunDir: { value: V3(0.5, 0.6, 0.2) },
};
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main(){
      vDir = normalize(position);
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p.xyww;
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunColor; uniform vec3 uSunDir;
    varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir);
      float h = clamp(d.y, 0.0, 1.0);
      vec3 col = mix(uHorizon, uTop, pow(h, 0.58));
      float sd = max(dot(d, normalize(uSunDir)), 0.0);
      col += uSunColor * (pow(sd, 950.0) * 2.4 + pow(sd, 22.0) * 0.16);
      float below = smoothstep(0.0, -0.25, d.y);
      col = mix(col, uHorizon * 0.72, below * 0.55);
      gl_FragColor = vec4(col, 1.0);
    }`
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), skyMat);
sky.renderOrder = -20;
scene.add(sky);

// stars
const starGeo = new THREE.BufferGeometry();
{
  const p = [];
  for (let i = 0; i < 700; i++) {
    const a = rr(0, TAU), e = Math.asin(rr(0.04, 1));
    const r = 820;
    p.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
}
const starMat = new THREE.PointsMaterial({ color: 0xdff1ff, size: 1.7, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: false, fog: false });
const stars = new THREE.Points(starGeo, starMat);
stars.renderOrder = -19;
scene.add(stars);

// lights
const hemi = new THREE.HemisphereLight(0xbfe8ff, 0x4a5a34, 0.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe2b4, 2.2);
sun.position.set(70, 85, 38);
sun.castShadow = true;
sun.shadow.mapSize.set(isSmall ? 1024 : 1536, isSmall ? 1024 : 1536);
sun.shadow.camera.near = 5;
sun.shadow.camera.far = 240;
sun.shadow.camera.left = -62;
sun.shadow.camera.right = 62;
sun.shadow.camera.top = 62;
sun.shadow.camera.bottom = -62;
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.025;
scene.add(sun);
scene.add(sun.target);
const fill = new THREE.DirectionalLight(0x9ed5ff, 0.26);
fill.position.set(-60, 40, -80);
scene.add(fill);

// clouds
const cloudMat = new THREE.MeshBasicMaterial({ color: 0xf8fdff, transparent: true, opacity: 0.82, depthWrite: false, fog: true });
const clouds = [];
function makeCloud(sx, sy, sz, x, y, z, scale) {
  const geos = [];
  const n = 4 + ((RNG() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const g = new THREE.IcosahedronGeometry(rr(0.7, 1.2), 0).toNonIndexed();
    g.scale(sx * rr(0.6, 1.25), sy * rr(0.35, 0.7), sz * rr(0.5, 1.15));
    g.translate(rr(-1.7, 1.7) * sx, rr(-0.2, 0.35) * sy, rr(-0.9, 0.9) * sz);
    const cols = new Float32Array(g.attributes.position.count * 3);
    for (let k = 0; k < cols.length; k += 3) { cols[k] = 0.93; cols[k + 1] = 0.97; cols[k + 2] = 1; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geos.push(g);
  }
  const merged = mergeGeometries(geos);
  const m = new THREE.Mesh(merged, cloudMat);
  m.position.set(x, y, z);
  m.scale.setScalar(scale);
  m.userData.baseX = x;
  scene.add(m);
  clouds.push(m);
  geos.forEach(g => g.dispose());
}
makeCloud(6, 2.4, 4, 95, 74, -125, 2.1);
makeCloud(7, 2.8, 5, -128, 82, -92, 2.4);
makeCloud(5, 2, 3.5, 18, 92, -178, 2);
makeCloud(6.5, 2.2, 4.5, 150, 69, 42, 1.8);
makeCloud(5.5, 2.4, 4, -92, 78, 132, 1.7);
makeCloud(7.5, 2.6, 5, -195, 86, 55, 2.2);
makeCloud(5.5, 2.1, 3.6, -155, 74, -110, 1.7);
makeCloud(6.2, 2.3, 4.2, 30, 96, 210, 1.8);

// distant islands (atmosphere)
function distantIsland(x, z, radius, height, color) {
  const geos = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.ConeGeometry(radius * rr(0.35, 0.75), height * rr(0.5, 1), 6, 1);
    g.translate(rr(-radius, radius) * 0.7, rr(0, height * 0.25), rr(-radius, radius) * 0.4);
    geos.push(g.toNonIndexed());
  }
  const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ color, flatShading: true }));
  m.position.set(x, -3, z);
  scene.add(m);
}
distantIsland(250, -300, 55, 34, 0x7f9c9b);
distantIsland(-300, -140, 46, 27, 0x8aa3a0);

// ------------------------------------------------------------ sky / time
const DAY_LENGTH = 760; // seconds per 24h
const state = {
  playing: false,
  paused: false,
  dead: false,
  started: false,
  mounted: null,
  time: 9.35,
  day: 1,
  elapsed: 0,
  uiT: 0,
  mapT: 0,
  audioOn: true,
  quality: isSmall ? 1 : 2,
  shake: 0,
  damageFlash: 0,
  quest: 0,
  armor: false,
  crafted: { spear: false, campfire: false, torch: false, armor: false },
  gathered: { wood: 0, stone: 0, fiber: 0, berries: 0, meat: 0 },
  kills: 0,
  tamed: 0,
  campfires: [],
  tameTarget: null,
  target: null,
  context: null,
  cinematic: true,
  cameraMode: 0, // 0 third person, 1 first person
  tilt: false,
  tiltZero: { beta: 0, gamma: 0 },
  tiltRaw: { beta: 0, gamma: 0 },
  tiltActive: false,
  key: {},
  joystick: { x: 0, y: 0, active: false },
  pointer: { look: false, x: 0, y: 0, id: -1 },
  sprint: false,
  attackCD: 0,
  actionCD: 0,
  cookCD: 0,
  lastDamage: -99,
  nightToast: false,
  inv: { wood: 0, stone: 0, thatch: 0, fiber: 0, berries: 3, meat: 0, cookedMeat: 0, hide: 0, flint: 0 },
  selected: 'axe',
};
const player = {
  pos: V3(SPAWN.x, 0, SPAWN.z),
  yaw: 1.5,
  pitch: -0.15,
  vy: 0,
  grounded: true,
  moving: false,
  health: 100,
  stamina: 100,
  food: 100,
  water: 100,
  xp: 0,
  level: 1,
  walkT: 0,
  lastGround: 0,
};

const palette = {
  dayTop: C(0x3d9bd6), dayHorizon: C(0xc6eae4),
  duskTop: C(0x384f78), duskHorizon: C(0xf59a66),
  nightTop: C(0x020711), nightHorizon: C(0x102436),
  sunDay: C(0xfff2d2), sunDusk: C(0xff9d5e), moon: C(0x9fc4ff),
};
const tmpColor = new THREE.Color();
const sunDir = V3(0, 1, 0);

function updateSky(dt) {
  state.time += dt / (DAY_LENGTH / 24);
  if (state.time >= 24) { state.time -= 24; state.day++; state.nightToast = false; }
  const ang = (state.time - 6) / 12 * Math.PI;
  sunDir.set(Math.cos(ang), Math.sin(ang) * 0.95 + 0.02, 0.33).normalize();
  const elev = sunDir.y;
  const dusk = smoothstep(0.38, -0.16, elev);
  const night = smoothstep(0.05, -0.28, elev);

  tmpColor.copy(palette.dayTop).lerp(palette.duskTop, dusk).lerp(palette.nightTop, night);
  skyUniforms.uTop.value.copy(tmpColor);
  tmpColor.copy(palette.dayHorizon).lerp(palette.duskHorizon, dusk).lerp(palette.nightHorizon, night);
  skyUniforms.uHorizon.value.copy(tmpColor);
  scene.fog.color.copy(tmpColor);
  skyUniforms.uSunDir.value.copy(sunDir);
  skyUniforms.uSunColor.value.copy(palette.sunDay).lerp(palette.sunDusk, dusk);
  if (night > 0.7) skyUniforms.uSunColor.value.copy(palette.moon);

  const daylight = smoothstep(-0.12, 0.28, elev);
  if (elev > -0.02) {
    sun.position.copy(sunDir).multiplyScalar(105);
    sun.position.x += player.pos.x; sun.position.z += player.pos.z;
    sun.target.position.set(player.pos.x, 0, player.pos.z);
    sun.intensity = (0.16 + Math.pow(Math.max(0, elev), 0.7) * 2.15) * lerp(1, 0.74, dusk);
    sun.color.copy(palette.sunDay).lerp(palette.sunDusk, dusk * 0.9);
  } else {
    sun.position.set(-sunDir.x * 80 + player.pos.x, 70, -sunDir.z * 80 + player.pos.z);
    sun.target.position.set(player.pos.x, 0, player.pos.z);
    sun.intensity = 0.5;
    sun.color.copy(palette.moon);
  }
  hemi.intensity = lerp(0.44, 0.78, daylight);
  fill.intensity = lerp(0.22, 0.24, daylight);
  starMat.opacity = clamp(night * 1.15, 0, 0.85) * (1 - daylight * 0.4);
  stars.rotation.y += dt * 0.0025;
  cloudMat.color.setHex(0xf8fdff).lerp(C(0x253849), night * 0.82).lerp(C(0xffb08a), dusk * 0.22);
  if (state.audioOn) {
    const targetAmb = lerp(0.25, 1, daylight);
    ambience.gain.gain.value = damp(ambience.gain.gain.value, targetAmb, 1.5, dt);
  }
  if (state.time > 19.4 && !state.nightToast && state.playing) { state.nightToast = true; toast('A noite chegou. Fique perto do fogo.', 'warn', 'fire'); }
  // cloud drift
  for (const c of clouds) {
    c.position.x += dt * 0.42;
    if (c.position.x > 230) c.position.x = -230;
  }
}

// ------------------------------------------------------------ terrain
{
  const verts = (SEG + 1) * (SEG + 1);
  const positions = new Float32Array(verts * 3);
  const colors = new Float32Array(verts * 3);
  for (let iz = 0; iz <= SEG; iz++) {
    for (let ix = 0; ix <= SEG; ix++) {
      const i = iz * (SEG + 1) + ix;
      const x = -HALF + ix * STEP;
      const z = -HALF + iz * STEP;
      const h = islandHeight(x, z);
      heights[i] = h;
      positions[i * 3] = x;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = z;
    }
  }
  const indices = [];
  for (let iz = 0; iz < SEG; iz++) {
    for (let ix = 0; ix < SEG; ix++) {
      const a = iz * (SEG + 1) + ix, b = a + 1, c = a + SEG + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const sand = C(0xd7c795), sandWet = C(0xb7a77a), grass = C(0x68883d), grassDark = C(0x4b6e33);
  const grassLight = C(0x86a04a), rock = C(0x716c5e), rockHigh = C(0x928b7b), under = C(0x2c5b55);
  for (let iz = 0; iz <= SEG; iz++) {
    for (let ix = 0; ix <= SEG; ix++) {
      const i = iz * (SEG + 1) + ix;
      const x = positions[i * 3], z = positions[i * 3 + 2], h = heights[i];
      const ixm = clamp(ix, 1, SEG - 1), izm = clamp(iz, 1, SEG - 1);
      const dx = (heights[izm * (SEG + 1) + ixm + 1] - heights[izm * (SEG + 1) + ixm - 1]) / (2 * STEP);
      const dz = (heights[(izm + 1) * (SEG + 1) + ixm] - heights[(izm - 1) * (SEG + 1) + ixm]) / (2 * STEP);
      const slope = Math.hypot(dx, dz);
      const n = fbm(x * 0.21, z * 0.21, 2);
      let col;
      if (h < -0.4) {
        col = under.clone().lerp(sandWet, clamp((h + 6) / 6, 0, 0.7));
      } else if (h < 1.35) {
        col = sandWet.clone().lerp(sand, smoothstep(-0.2, 1.2, h)).lerp(grass, smoothstep(1.15, 1.8, h) * 0.35);
      } else if (h < 2.6) {
        col = sand.clone().lerp(grass, smoothstep(1.35, 2.7, h));
      } else {
        col = grass.clone().lerp(grassDark, smoothstep(4, 17, h) * 0.7).lerp(grassLight, (n - 0.5) * 0.7 + 0.34);
        if (h > 18) col.lerp(rock, smoothstep(18, 25, h));
      }
      if (slope > 0.62) col.lerp(rock, smoothstep(0.62, 1.4, slope) * 0.92);
      if (h > 25) col.lerp(rockHigh, smoothstep(25, 32, h) * 0.8);
      const j = 0.93 + n * 0.13;
      colors[i * 3] = col.r * j; colors[i * 3 + 1] = col.g * j; colors[i * 3 + 2] = col.b * j;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, flatShading: false });
  const terrain = new THREE.Mesh(geo, mat);
  terrain.receiveShadow = true;
  terrain.castShadow = false;
  scene.add(terrain);
}

// height data texture for water foam
let heightTex;
{
  const N = 384;
  const floatLinear = !!renderer.getContext().getExtension('OES_texture_float_linear');
  const data = floatLinear ? new Float32Array(N * N) : new Uint8Array(N * N);
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const x = -HALF + (ix + 0.5) / N * WORLD;
      const z = -HALF + (iz + 0.5) / N * WORLD;
      const h = islandHeight(x, z);
      const v = clamp((h + 7) / 45, 0, 1);
      data[iz * N + ix] = floatLinear ? v : Math.round(v * 255);
    }
  }
  heightTex = new THREE.DataTexture(data, N, N, THREE.RedFormat, floatLinear ? THREE.FloatType : THREE.UnsignedByteType);
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.needsUpdate = true;
}

// ------------------------------------------------------------ water
const waterUniforms = {
  uTime: { value: 0 },
  uHeight: { value: heightTex },
  uDeep: { value: C(0x0b5666) },
  uShallow: { value: C(0x2fb9b1) },
  uFoam: { value: C(0xe9fff8) },
  uSunDir: { value: V3(0.4, 0.8, 0.2) },
  uSunColor: { value: C(0xfff0cc) },
  uHorizon: { value: C(0xc6eae4) },
  uNight: { value: 0 },
  uWorld: { value: HALF },
};
const waterMat = new THREE.ShaderMaterial({
  uniforms: waterUniforms,
  transparent: true,
  depthWrite: false,
  vertexShader: /* glsl */`
    varying vec3 vWorld;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime; uniform sampler2D uHeight;
    uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam;
    uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uHorizon;
    uniform float uNight; uniform float uWorld;
    varying vec3 vWorld;
    void main(){
      vec2 p = vWorld.xz;
      vec2 uv = (p + uWorld) / (uWorld * 2.0);
      float terrainH = texture2D(uHeight, clamp(uv, 0.0, 1.0)).r * 45.0 - 7.0;
      float depth = clamp(-terrainH, 0.0, 18.0);

      float w1 = sin(p.x * 0.33 + uTime * 1.05) + sin(p.y * 0.28 - uTime * 0.86) + sin((p.x + p.y) * 0.16 + uTime * 0.53);
      float w2 = sin(p.x * 0.91 - uTime * 2.0) * sin(p.y * 0.76 + uTime * 1.55);
      float ripple = w1 * 0.5 + w2 * 0.4;

      vec3 n = normalize(vec3(
        -0.055 * cos(p.x * 0.33 + uTime * 1.05) - 0.028 * cos(p.x * 0.91 - uTime * 2.0) * sin(p.y * 0.76 + uTime * 1.55),
        1.0,
        -0.048 * cos(p.y * 0.28 - uTime * 0.86) - 0.028 * sin(p.x * 0.91 - uTime * 2.0) * cos(p.y * 0.76 + uTime * 1.55)
      ));
      vec3 viewDir = normalize(cameraPosition - vWorld);
      float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
      float shallowMix = smoothstep(14.0, 0.0, depth);
      vec3 col = mix(uDeep, uShallow, shallowMix * 0.88 + 0.05);
      col = mix(col, uHorizon, fres * 0.45);
      vec3 halfV = normalize(normalize(uSunDir) + viewDir);
      float spec = pow(max(dot(n, halfV), 0.0), 220.0) * 2.1;
      col += uSunColor * spec * (1.0 - uNight * 0.75);

      float shoreline = smoothstep(-0.55, -0.06, terrainH) * (1.0 - smoothstep(0.02, 0.32, terrainH));
      float washBand = smoothstep(-1.15, -0.15, terrainH) * (1.0 - smoothstep(0.0, 0.1, terrainH));
      float foamNoise = sin(p.x * 1.9 + uTime * 1.6) * sin(p.y * 1.7 - uTime * 1.3);
      float lap = 0.5 + 0.5 * sin(uTime * 1.1 + p.x * 0.2 + p.y * 0.16);
      float foam = shoreline * (0.55 + 0.45 * foamNoise) * lap + washBand * 0.14;
      col = mix(col, uFoam, clamp(foam * 0.9, 0.0, 0.85));
      col += vec3(0.035, 0.09, 0.085) * w2 * 0.22;

      float dist = length(cameraPosition - vWorld);
      col = mix(col, uHorizon, smoothstep(150.0, 720.0, dist) * 0.92);
      float alpha = mix(0.94, 0.99, smoothstep(0.0, 3.2, depth)) + fres * 0.04;
      gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    }`
});
const water = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500, 1, 1), waterMat);
water.rotation.x = -Math.PI / 2;
water.position.y = WATER_Y;
water.renderOrder = 1;
scene.add(water);

// ------------------------------------------------------------ materials & geometry helpers
const foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true, side: THREE.DoubleSide, emissive: C(0x1b2b12), emissiveIntensity: 0.5 });
const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, flatShading: true });
const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true });
const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, flatShading: true });

function paintGeometry(geo, hex, variance = 0.05) {
  if (geo.index) geo = geo.toNonIndexed();
  const base = C(hex);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    const j = 1 + (RNG() - 0.5) * variance * 2;
    colors[i] = clamp(base.r * j, 0, 1);
    colors[i + 1] = clamp(base.g * j, 0, 1);
    colors[i + 2] = clamp(base.b * j, 0, 1);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}
function part(geo, color, variance = 0.05) {
  return paintGeometry(geo, color, variance);
}
function transformed(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  m.compose(V3(x, y, z), q, V3(sx, sy, sz));
  geo.applyMatrix4(m);
  return geo;
}

// ------------------------------------------------------------ foliage builders
function frondGeometry(length, width, droop, colorA, colorB) {
  const segs = 5;
  const positions = [], colors = [], indices = [];
  const ca = C(colorA), cb = C(colorB);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = width * (1 - t * 0.82) * (i === 0 ? 0.4 : 1);
    const x = t * length;
    const y = Math.sin(t * Math.PI * 0.85) * length * 0.14 - t * t * droop;
    positions.push(x, y, -w, x, y + 0.05, 0, x, y, w);
    const c = ca.clone().lerp(cb, t);
    for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 3;
    indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
    indices.push(a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g = g.toNonIndexed();
  return g;
}

function makePalm(scale = 1) {
  const g = [];
  const segs = 6;
  let x = 0;
  const lean = rr(-0.25, 0.25);
  const top = 3.9 * scale;
  for (let i = 0; i < segs; i++) {
    const h = (top / segs) * 1.02;
    const r0 = lerp(0.24, 0.15, i / segs) * scale;
    const r1 = lerp(0.24, 0.15, (i + 1) / segs) * scale;
    const t = i / segs;
    x += lean * (0.05 + t * 0.13) * scale;
    const geo = new THREE.CylinderGeometry(r1, r0, h, 5, 1);
    transformed(geo, x, h / 2 + i * h * 0.97, 0, 0, 0, lean * 0.09 * scale);
    g.push(part(geo, i % 2 ? 0x7d5b3c : 0x8b6642, 0.1));
  }
  const topX = x, topY = top;
  const fronds = 10;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * TAU + rr(-0.12, 0.12);
    const len = rr(2.2, 3.0) * scale;
    const f = frondGeometry(len, 0.45 * scale, rr(0.8, 1.35) * scale, 0x4c8a3a, 0x9abb54);
    transformed(f, topX, topY - 0.08, 0, rr(-0.16, 0.1), a, 0);
    g.push(f);
    const f2 = frondGeometry(len * 0.78, 0.33 * scale, rr(1.1, 1.8) * scale, 0x427c35, 0x84a949);
    transformed(f2, topX, topY - 0.22, 0, rr(-0.05, 0.2), a + 0.22, 0);
    g.push(f2);
  }
  for (let i = 0; i < 3; i++) {
    const co = new THREE.SphereGeometry(0.13 * scale, 6, 4);
    transformed(co, topX + Math.cos(i * 2.1) * 0.22 * scale, topY - 0.36, Math.sin(i * 2.1) * 0.22 * scale);
    g.push(part(co, 0x6a5a2d, 0.1));
  }
  const merged = mergeGeometries(g);
  g.forEach(x => x.dispose());
  return merged;
}

function makeJungleTree(scale = 1) {
  const g = [];
  const h = rr(3.6, 5.4) * scale;
  const trunk = new THREE.CylinderGeometry(0.2 * scale, 0.38 * scale, h, 6, 1);
  transformed(trunk, 0, h / 2, 0);
  g.push(part(trunk, 0x6c5136, 0.12));
  for (let i = 0; i < 3; i++) {
    const b = new THREE.CylinderGeometry(0.09 * scale, 0.14 * scale, h * 0.42, 5, 1);
    transformed(b, 0, h * 0.72, 0, rr(-0.7, 0.7), rr(0, TAU), rr(0.6, 0.95));
    g.push(part(b, 0x5e472f, 0.1));
  }
  const blobs = 3 + ((RNG() * 3) | 0);
  for (let i = 0; i < blobs; i++) {
    const r = rr(0.95, 1.6) * scale;
    const blob = new THREE.IcosahedronGeometry(r, 1);
    transformed(blob, rr(-1, 1) * scale, h + rr(-0.1, 1.2) * scale, rr(-0.9, 0.9) * scale, 0, rr(0, TAU), 0, 1, rr(0.55, 0.8), 1);
    const cols = [0x3e6d31, 0x4c7c37, 0x5a8b3d, 0x6c9b45];
    g.push(part(blob, pick(cols), 0.13));
  }
  const merged = mergeGeometries(g);
  g.forEach(x => x.dispose());
  return merged;
}

function makeBush(kind = 'fiber') {
  const g = [];
  const blobs = 2 + ((RNG() * 3) | 0);
  for (let i = 0; i < blobs; i++) {
    const geo = new THREE.IcosahedronGeometry(rr(0.35, 0.7), 1);
    transformed(geo, rr(-0.35, 0.35), rr(0.25, 0.6), rr(-0.3, 0.3), 0, rr(0, TAU), 0, 1.15, rr(0.65, 0.95), 1.15);
    g.push(part(geo, pick([0x446f34, 0x527e39, 0x5f8c40]), 0.13));
  }
  const ferns = 5;
  for (let i = 0; i < ferns; i++) {
    const f = frondGeometry(rr(0.5, 0.85), 0.16, rr(0.2, 0.45), 0x4a7836, 0x7fa148);
    transformed(f, 0, 0.35, 0, rr(-0.35, 0.15), (i / ferns) * TAU, 0);
    g.push(f);
  }
  if (kind === 'berry') {
    for (let i = 0; i < 4; i++) {
      const b = new THREE.SphereGeometry(0.09, 6, 4);
      transformed(b, rr(-0.4, 0.4), rr(0.35, 0.7), rr(-0.3, 0.3));
      g.push(part(b, 0xc2434b, 0.12));
    }
  }
  const merged = mergeGeometries(g);
  g.forEach(x => x.dispose());
  return merged;
}

function makeRock(scale = 1) {
  const g = [];
  const chunks = 2 + ((RNG() * 2) | 0);
  for (let i = 0; i < chunks; i++) {
    const geo = new THREE.IcosahedronGeometry(rr(0.5, 0.95) * scale, 0);
    transformed(geo, rr(-0.5, 0.5) * scale, rr(0.15, 0.55) * scale, rr(-0.45, 0.45) * scale, rr(0, TAU), rr(0, TAU), rr(0, TAU), rr(0.8, 1.3), rr(0.55, 1), rr(0.8, 1.3));
    g.push(part(geo, pick([0x767369, 0x817d70, 0x6a685f, 0x8b877a]), 0.09));
  }
  const merged = mergeGeometries(g);
  g.forEach(x => x.dispose());
  return merged;
}

// ------------------------------------------------------------ resources
const resources = [];
const colliders = [];
const resourceData = {
  palm: { label: 'PALMEIRA', yieldName: 'Madeira', yields: [['wood', 1, 2], ['thatch', 0, 1]], hp: 3, radius: 0.5 },
  tree: { label: 'ÁRVORE', yieldName: 'Madeira', yields: [['wood', 1, 2], ['thatch', 0, 1]], hp: 4, radius: 0.55 },
  rock: { label: 'PEDRA', yieldName: 'Pedra', yields: [['stone', 1, 2], ['flint', 0, 1]], hp: 4, radius: 0.9 },
  bush: { label: 'ARBUSTO', yieldName: 'Fibras', yields: [['fiber', 1, 3], ['berries', 0, 1]], hp: 2, radius: 0.45 },
  berry: { label: 'ARBUSTO DE FRUTAS', yieldName: 'Frutas', yields: [['berries', 2, 3], ['fiber', 1, 2]], hp: 2, radius: 0.45 },
};

function addResource(kind, x, z, scale = 1, rot = rr(0, TAU)) {
  const data = resourceData[kind];
  let geo, mat;
  if (kind === 'palm') { geo = makePalm(scale); mat = foliageMat; }
  else if (kind === 'tree') { geo = makeJungleTree(scale); mat = foliageMat; }
  else if (kind === 'rock') { geo = makeRock(scale); mat = rockMat; }
  else { geo = makeBush(kind); mat = foliageMat; }
  const mesh = new THREE.Mesh(geo, mat);
  const y = heightAt(x, z);
  mesh.position.set(x, y - 0.05, z);
  mesh.rotation.y = rot;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  const r = {
    kind, mesh, x, z, y, radius: data.radius * (kind === 'rock' ? scale : 1),
    hp: data.hp, maxHp: data.hp, respawn: 0, dead: false,
    baseY: y - 0.05, baseScale: 1, shake: 0,
    yieldName: data.yieldName, collider: null, baseRot: rot,
  };
  resources.push(r);
  if (kind !== 'bush' && kind !== 'berry') {
    const col = { x, z, r: r.radius + 0.3, res: r };
    colliders.push(col);
    r.collider = col;
  }
  return r;
}

function landOk(x, z, minH = 1.2) {
  const h = heightAt(x, z);
  return h > minH && h < 26 && slopeAt(x, z) < 1.35;
}

// spawn area framing palms
addResource('palm', -16, 72, 1.24, 0.8);
addResource('palm', -34, 64, 1.32, 2.4);
addResource('palm', -52, 64, 1.08, 4.1);
addResource('palm', -26, 72, 1.15, 5.5);
addResource('palm', 8, 66, 1.22, 2.0);
addResource('palm', -44, 52, 1.05, 5.0);
addResource('palm', 14, 74, 0.98, 1.4);
addResource('berry', -8, 74, 1.1, 0.5);
addResource('bush', 6.6, 68.5, 1.1, 3.2);
addResource('rock', -6, 62, 0.8, 1.2);

// scattered island foliage
{
  let tries = 0, palms = 0, trees = 0, rocks = 0, bushes = 0, berries = 0;
  while (tries++ < 900 && (palms < 30 || trees < 30 || rocks < 22 || bushes < 24 || berries < 14)) {
    const a = rr(0, TAU);
    const rad = rr(13, 102);
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    if (dist2(x, z, SPAWN.x, SPAWN.z) < 90) continue;
    if (!landOk(x, z, 1.5)) continue;
    const h = heightAt(x, z);
    const near = resources.some(r => dist2(x, z, r.x, r.z) < (r.kind === 'rock' ? 16 : 20));
    if (near) continue;
    if (h < 4.2 && palms < 30) { addResource('palm', x, z, rr(0.85, 1.35)); palms++; }
    else if (h >= 3.4 && trees < 30) { addResource('tree', x, z, rr(0.85, 1.25)); trees++; }
    else if (rocks < 22 && slopeAt(x, z) > 0.18 && h > 5) { addResource('rock', x, z, rr(0.8, 1.5)); rocks++; }
    else if (bushes < 24 && h < 12) { addResource('bush', x, z, rr(0.8, 1.2)); bushes++; }
    else if (berries < 14 && h < 8) { addResource('berry', x, z, rr(0.8, 1.15)); berries++; }
  }
}

// ------------------------------------------------------------ beach dressing
{
  const propMat = rockMat;
  function place(geo, x, z, rot = 0, yOff = 0) {
    const mesh = new THREE.Mesh(geo, propMat);
    mesh.position.set(x, heightAt(x, z) + yOff, z);
    mesh.rotation.y = rot;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  function driftwood(x, z, rot, s = 1) {
    const pieces = [];
    const trunk = new THREE.CylinderGeometry(0.14 * s, 0.22 * s, 2.9 * s, 6, 1);
    transformed(trunk, 0, 0.19 * s, 0, 0, 0, Math.PI / 2 - 0.06, 1, 1, 1);
    pieces.push(part(trunk, pick([0x8a7961, 0x796a55, 0x9a8871]), 0.13));
    const branch = new THREE.CylinderGeometry(0.06 * s, 0.1 * s, 1.2 * s, 5, 1);
    transformed(branch, 0.25 * s, 0.33 * s, 0.15 * s, 0.4, 0.7, 1.2);
    pieces.push(part(branch, 0x7d6d58, 0.12));
    const stub = new THREE.CylinderGeometry(0.05 * s, 0.09 * s, 0.7 * s, 5, 1);
    transformed(stub, -0.7 * s, 0.28 * s, -0.1 * s, -0.3, 0.2, -1.4);
    pieces.push(part(stub, 0x8a7961, 0.12));
    place(mergeGeometries(pieces), x, z, rot, 0.02);
  }

  function starfish(x, z, rot) {
    const arms = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      const arm = new THREE.CylinderGeometry(0.035, 0.085, 0.42, 4, 1);
      transformed(arm, Math.cos(a) * 0.22, 0.025, Math.sin(a) * 0.22, Math.PI / 2, -a + Math.PI / 2, 0);
      arms.push(part(arm, pick([0xd2694b, 0xc9553f, 0xe0875d]), 0.12));
    }
    const disc = new THREE.SphereGeometry(0.1, 6, 4);
    transformed(disc, 0, 0.03, 0, 0, 0, 0, 1, 0.4, 1);
    arms.push(part(disc, 0xdc7a55, 0.1));
    place(mergeGeometries(arms), x, z, rot, 0.01);
  }

  function seashell(x, z, rot, color) {
    const shell = new THREE.SphereGeometry(0.11, 7, 4);
    transformed(shell, 0, 0.015, 0, 0, 0, 0, 1, 0.32, 1.15);
    place(part(shell, color, 0.07), x, z, rot, 0.01);
  }

  // driftwood along the high-tide line
  driftwood(17.5, 87.4, 0.55, 1.05);
  driftwood(-13.5, 89.2, 2.35, 0.9);
  driftwood(31, 83.6, 4.6, 0.75);
  // starfish + shells
  starfish(8.6, 89.1, 0.4);
  starfish(24.3, 88.4, 2.1);
  seashell(-2.5, 89.6, 0.8, 0xf0ddc4);
  seashell(0.4, 89.1, 2.6, 0xe8c9c0);
  seashell(14.2, 88.6, 4.1, 0xf3e7d2);
  seashell(27.5, 87.2, 1.4, 0xe6d2ae);
  seashell(-20.5, 87.8, 5.2, 0xf0ddc4);
  // waterline stones
  place(part(new THREE.IcosahedronGeometry(0.3, 0), 0x6e6b61, 0.09), 35.5, 89.8, 0.7, 0.12);
  place(part(new THREE.IcosahedronGeometry(0.22, 0), 0x7a776c, 0.09), 36.4, 89.2, 2.2, 0.05);
  place(part(new THREE.IcosahedronGeometry(0.26, 0), 0x646158, 0.09), -25.2, 90.1, 1.4, 0.08);

  // dune grass: thin salt-tolerant tufts near the shore
  {
    const tuft = [];
    for (let i = 0; i < 5; i++) {
      const f = frondGeometry(rr(0.5, 0.95), 0.045, 0.55, 0x6f8a45, 0xb4b876);
      transformed(f, 0, 0, 0, 0, (i / 5) * TAU + rr(-0.4, 0.4), 0);
      tuft.push(f);
    }
    const merged = mergeGeometries(tuft);
    const inst = new THREE.InstancedMesh(merged, foliageMat, 210);
    inst.castShadow = false;
    inst.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let n = 0;
    RNG();
    for (let i = 0; i < 900 && n < 210; i++) {
      const a = rr(0, TAU), rad = rr(82, 96);
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const h = heightAt(x, z);
      if (h < 0.85 || h > 2.6) continue;
      if (dist2(x, z, SPAWN.x, SPAWN.z) < 12) continue;
      const s = rr(0.6, 1.25);
      q.setFromAxisAngle(V3(0, 1, 0), rr(0, TAU));
      m.compose(V3(x, h - 0.04, z), q, V3(s, s, s));
      inst.setMatrixAt(n++, m);
    }
    inst.count = n;
    scene.add(inst);
  }
}

// ------------------------------------------------------------ sea stacks / horizon
function makeSeaStack(x, z, s = 1) {
  const geos = [];
  let y = -2.2;
  const tiers = 3 + ((RNG() * 2) | 0);
  for (let i = 0; i < tiers; i++) {
    const r0 = (1.5 - i * 0.34) * s * rr(0.9, 1.1);
    const h = rr(1.8, 3.2) * s;
    const geo = new THREE.CylinderGeometry(r0 * 0.74, r0, h, 6, 1);
    transformed(geo, rr(-0.35, 0.35) * s, y + h / 2, rr(-0.35, 0.35) * s, 0, rr(0, TAU), rr(-0.06, 0.06));
    geos.push(part(geo, pick([0x6f6a5f, 0x7a7365, 0x5f5c54]), 0.12));
    y += h * 0.92;
  }
  const cap = new THREE.IcosahedronGeometry(0.85 * s, 0);
  transformed(cap, rr(-0.2, 0.2) * s, y + 0.2 * s, rr(-0.2, 0.2) * s, rr(0, TAU), rr(0, TAU), rr(0, TAU), 1.3, 0.8, 1.2);
  geos.push(part(cap, 0x7c7566, 0.1));
  const mesh = new THREE.Mesh(mergeGeometries(geos), rockMat);
  mesh.position.set(x, 0, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  geos.forEach(g => g.dispose());
}
makeSeaStack(-112, 112, 1.9);
makeSeaStack(-142, 88, 1.35);
makeSeaStack(-158, 126, 2.3);
makeSeaStack(96, 130, 1.5);
distantIsland(-310, 74, 52, 27, 0x7d989a);
distantIsland(-215, 190, 34, 18, 0x8aa3a0);

// ------------------------------------------------------------ seabirds
const birds = [];
{
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, -0.52, 0.06, -0.16, -0.46, 0.02, 0.24,
  ], 3));
  wing.computeVertexNormals();
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x33414a, side: THREE.DoubleSide, transparent: true, opacity: 0.82 });
  for (let i = 0; i < 11; i++) {
    const group = new THREE.Group();
    const left = new THREE.Mesh(wing, birdMat);
    const right = new THREE.Mesh(wing, birdMat);
    right.scale.x = -1;
    group.add(left, right);
    const flock = i < 6 ? 0 : 1;
    group.scale.setScalar(rr(0.75, 1.25) * (flock ? 1.15 : 1));
    scene.add(group);
    birds.push({
      group, wings: [left, right],
      phase: rr(0, TAU), radius: flock ? rr(64, 96) : rr(38, 62),
      y: flock ? rr(34, 46) : rr(26, 34),
      speed: (flock ? 0.026 : 0.034) * (RNG() < 0.5 ? 1 : 0.86),
      flapRate: rr(5.4, 7.2),
    });
  }
}
function updateBirds(t) {
  for (const b of birds) {
    const a = b.phase + t * b.speed;
    b.group.position.set(Math.cos(a) * b.radius, b.y + Math.sin(t * 1.4 + b.phase) * 1.3, Math.sin(a) * b.radius);
    b.group.rotation.y = Math.PI - a;
    const flap = Math.sin(t * b.flapRate + b.phase) * 0.55;
    b.wings[0].rotation.z = flap;
    b.wings[1].rotation.z = -flap;
  }
}

// extra grass tufts
{
  const tuftGeo = [];
  for (let i = 0; i < 3; i++) {
    const f = frondGeometry(rr(0.28, 0.5), 0.055, 0.28, 0x5e853a, 0x98b45a);
    transformed(f, 0, 0, 0, 0, (i / 3) * TAU + rr(-0.3, 0.3), 0);
    tuftGeo.push(f);
  }
  const merged = mergeGeometries(tuftGeo);
  const inst = new THREE.InstancedMesh(merged, foliageMat, 620);
  inst.castShadow = false;
  inst.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let count = 0;
  for (let i = 0; i < 1600 && count < 620; i++) {
    const a = rr(0, TAU), rad = rr(6, 92);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    const h = heightAt(x, z);
    if (h < 2.2 || h > 14 || slopeAt(x, z) > 0.6) continue;
    if (dist2(x, z, SPAWN.x, SPAWN.z) < 16) continue;
    const s = rr(0.7, 1.5);
    q.setFromAxisAngle(V3(0, 1, 0), rr(0, TAU));
    m.compose(V3(x, h - 0.04, z), q, V3(s, s, s));
    inst.setMatrixAt(count++, m);
  }
  inst.count = count;
  scene.add(inst);
}

// ------------------------------------------------------------ dynamic props
const campfireMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa33c, transparent: true, opacity: 0.88, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const flameMat2 = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

function createCampfire(x, z) {
  const group = new THREE.Group();
  const y = heightAt(x, z);
  const stones = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const g = new THREE.IcosahedronGeometry(rr(0.14, 0.21), 0);
    transformed(g, Math.cos(a) * 0.62, 0.08, Math.sin(a) * 0.62, 0, rr(0, TAU), 0, 1, 0.7, 1);
    stones.push(part(g, pick([0x74716a, 0x858075]), 0.08));
  }
  const merged = mergeGeometries(stones);
  const ring = new THREE.Mesh(merged, campfireMat);
  ring.castShadow = true; ring.receiveShadow = true;
  group.add(ring);
  for (let i = 0; i < 4; i++) {
    const log = new THREE.CylinderGeometry(0.075, 0.095, 1.05, 5);
    transformed(log, 0, 0.15, 0, Math.PI / 2 - 0.22, (i / 4) * Math.PI + 0.3, 0);
    const lm = new THREE.Mesh(part(log, 0x5a422c, 0.12), campfireMat);
    lm.castShadow = true;
    group.add(lm);
  }
  const flame = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(rr(0.13, 0.22), rr(0.55, 0.9), 5, 1, true), i === 1 ? flameMat2 : flameMat);
    f.position.set(rr(-0.1, 0.1), 0.4 + i * 0.13, rr(-0.1, 0.1));
    flame.add(f);
  }
  group.add(flame);
  group.position.set(x, y, z);
  scene.add(group);
  const light = new THREE.PointLight(0xff8a3d, 18, 16, 2);
  light.position.set(0, 1.1, 0);
  group.add(light);
  const embers = [];
  const camp = { group, x, z, flame, light, y, embers, t: 0 };
  state.campfires.push(camp);
  return camp;
}

// particles
const MAX_PARTICLES = 420;
const particleGeo = new THREE.BufferGeometry();
const particlePos = new Float32Array(MAX_PARTICLES * 3);
const particleCol = new Float32Array(MAX_PARTICLES * 3);
particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
particleGeo.setAttribute('color', new THREE.BufferAttribute(particleCol, 3));
const particleMat = new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true });
const particleSystem = new THREE.Points(particleGeo, particleMat);
particleSystem.frustumCulled = false;
scene.add(particleSystem);
const particles = [];
for (let i = 0; i < MAX_PARTICLES; i++) particles.push({ life: 0, x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, max: 1, gravity: 6, size: 1 });
let particleCursor = 0;

function burst(x, y, z, color, count = 10, spread = 2.2, up = 3.4, gravity = 7) {
  const c = C(color);
  for (let i = 0; i < count; i++) {
    const p = particles[particleCursor++ % MAX_PARTICLES];
    p.life = rr(0.35, 0.85); p.max = p.life;
    p.x = x + rr(-0.25, 0.25); p.y = y + rr(-0.1, 0.25); p.z = z + rr(-0.25, 0.25);
    p.vx = rr(-spread, spread); p.vy = rr(up * 0.3, up); p.vz = rr(-spread, spread);
    p.r = c.r; p.g = c.g; p.b = c.b; p.gravity = gravity; p.size = rr(0.6, 1.5);
  }
}
function heartBurst(x, y, z) {
  for (let i = 0; i < 8; i++) {
    const p = particles[particleCursor++ % MAX_PARTICLES];
    p.life = rr(1, 1.5); p.max = p.life;
    p.x = x + rr(-0.4, 0.4); p.y = y + rr(0.2, 0.8); p.z = z + rr(-0.4, 0.4);
    p.vx = rr(-0.3, 0.3); p.vy = rr(0.7, 1.3); p.vz = rr(-0.3, 0.3);
    p.r = 1; p.g = 0.28; p.b = 0.42; p.gravity = -0.25; p.size = 1.6;
  }
}
function updateParticles(dt) {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = particles[i];
    if (p.life > 0) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vy -= p.gravity * dt;
      if (p.y < heightAt(p.x, p.z) + 0.03) { p.y = heightAt(p.x, p.z) + 0.03; p.vy *= -0.18; p.vx *= 0.7; p.vz *= 0.7; }
      const t = clamp(p.life / p.max, 0, 1);
      particlePos[i * 3] = p.x; particlePos[i * 3 + 1] = p.y; particlePos[i * 3 + 2] = p.z;
      particleCol[i * 3] = p.r * (0.55 + t * 0.45); particleCol[i * 3 + 1] = p.g * (0.55 + t * 0.45); particleCol[i * 3 + 2] = p.b * (0.55 + t * 0.45);
    } else {
      particlePos[i * 3 + 1] = -100;
    }
  }
  particleGeo.attributes.position.needsUpdate = true;
  particleGeo.attributes.color.needsUpdate = true;
}

// ------------------------------------------------------------ player model
const playerGroup = new THREE.Group();
scene.add(playerGroup);
const pMats = {
  shirt: new THREE.MeshStandardMaterial({ color: 0x315d55, roughness: 0.92, flatShading: true }),
  shirt2: new THREE.MeshStandardMaterial({ color: 0x24443f, roughness: 0.92, flatShading: true }),
  pants: new THREE.MeshStandardMaterial({ color: 0x5c4933, roughness: 0.95, flatShading: true }),
  skin: new THREE.MeshStandardMaterial({ color: 0xc78f63, roughness: 0.82, flatShading: true }),
  hair: new THREE.MeshStandardMaterial({ color: 0x2a1b13, roughness: 0.98, flatShading: true }),
  leather: new THREE.MeshStandardMaterial({ color: 0x6b4d2f, roughness: 0.94, flatShading: true }),
  metal: new THREE.MeshStandardMaterial({ color: 0x9a9e97, roughness: 0.55, metalness: 0.5, flatShading: true }),
  tusk: new THREE.MeshStandardMaterial({ color: 0xd8d2b4, roughness: 0.7, flatShading: true }),
};
function pbox(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; return m;
}
const torso = pbox(0.5, 0.62, 0.3, pMats.shirt, 0, 1.22, 0);
playerGroup.add(torso);
playerGroup.add(pbox(0.52, 0.16, 0.32, pMats.leather, 0, 0.96, 0));
const hip = pbox(0.42, 0.2, 0.28, pMats.pants, 0, 0.9, 0);
playerGroup.add(hip);
const head = new THREE.Group();
head.position.set(0, 1.64, 0);
playerGroup.add(head);
const skull = new THREE.Mesh(new THREE.SphereGeometry(0.185, 8, 7), pMats.skin);
skull.castShadow = true; head.add(skull);
const hair = new THREE.Mesh(new THREE.SphereGeometry(0.195, 8, 6, 0, TAU, 0, Math.PI * 0.62), pMats.hair);
hair.position.y = 0.035; hair.rotation.x = -0.2; head.add(hair);
head.add(pbox(0.06, 0.06, 0.09, pMats.skin, 0, -0.015, -0.185));
const eyeGeo = new THREE.SphereGeometry(0.019, 5, 4);
const eyeMat = new THREE.MeshBasicMaterial({ color: 0x121313 });
for (const sx of [-1, 1]) {
  const e = new THREE.Mesh(eyeGeo, eyeMat); e.position.set(sx * 0.062, 0.03, -0.158); head.add(e);
}
// backpack
const pack = pbox(0.36, 0.4, 0.2, pMats.leather, 0, 1.3, 0.25);
playerGroup.add(pack);
playerGroup.add(pbox(0.3, 0.08, 0.21, pMats.leather, 0, 1.47, 0.25));
// arms
const armGroups = [];
for (const sx of [-1, 1]) {
  const g = new THREE.Group();
  g.position.set(sx * 0.32, 1.47, 0);
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.25, 3, 6), pMats.skin);
  upper.position.y = -0.15; upper.castShadow = true; g.add(upper);
  const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.24, 3, 6), pMats.skin);
  lower.position.y = -0.4; lower.castShadow = true; g.add(lower);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.11, 6), pMats.shirt2);
  cuff.position.y = -0.28; g.add(cuff);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.078, 6, 5), pMats.skin);
  hand.position.y = -0.55; g.add(hand);
  playerGroup.add(g);
  armGroups.push(g);
}
// legs
const legGroups = [];
for (const sx of [-1, 1]) {
  const g = new THREE.Group();
  g.position.set(sx * 0.13, 0.82, 0);
  const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.3, 3, 6), pMats.pants);
  thigh.position.y = -0.2; thigh.castShadow = true; g.add(thigh);
  const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.32, 3, 6), pMats.pants);
  shin.position.y = -0.56; shin.castShadow = true; g.add(shin);
  const boot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.13, 0.25), pMats.leather);
  boot.position.set(0, -0.76, -0.035); boot.castShadow = true; g.add(boot);
  playerGroup.add(g);
  legGroups.push(g);
}

// axe + spear in hand
function makeHandAxe() {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.042, 0.75, 5), pMats.leather);
  handle.position.y = -0.22; g.add(handle);
  const headM = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.32), pMats.metal);
  headM.position.set(0, -0.58, -0.11); headM.rotation.x = -0.16; g.add(headM);
  const lash = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.014, 4, 6), pMats.tusk);
  lash.position.set(0, -0.48, 0); lash.rotation.x = Math.PI / 2; g.add(lash);
  g.position.set(0, -0.54, -0.05); g.rotation.x = 0.2;
  return g;
}
const handAxe = makeHandAxe();
armGroups[1].add(handAxe);
function makeHandSpear() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.033, 2.1, 5), pMats.leather);
  shaft.position.y = -0.35; g.add(shaft);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.42, 4), pMats.metal);
  tip.position.y = 0.88; tip.rotation.y = Math.PI / 4; g.add(tip);
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 5), pMats.tusk);
  wrap.position.y = 0.58; g.add(wrap);
  g.rotation.x = 0.22; g.rotation.z = 0.1;
  g.visible = false;
  return g;
}
const handSpear = makeHandSpear();
armGroups[1].add(handSpear);

// first person viewmodel
const viewModel = new THREE.Group();
viewModel.visible = false;
camera.add(viewModel);
{
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.38, 3, 6), pMats.skin);
  arm.position.set(0.34, -0.28, -0.42); arm.rotation.set(0.9, -0.2, 0.55); viewModel.add(arm);
  const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.26, 6), pMats.shirt);
  coat.position.set(0.5, -0.49, -0.36); coat.rotation.set(0.9, 0, 0.4); viewModel.add(coat);
  const axe = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.85, 5), pMats.leather);
  handle.rotation.set(0.8, -0.2, 0.35); handle.position.set(0.42, -0.33, -0.72); axe.add(handle);
  const headM = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.3), pMats.metal);
  headM.position.set(0.53, -0.06, -0.97); headM.rotation.set(0.4, -0.3, 0.2); axe.add(headM);
  viewModel.add(axe);
  viewModel.userData.axe = axe;
}

// ------------------------------------------------------------ player spawn
function findSpawn() {
  let best = { x: SPAWN.x, z: SPAWN.z, h: heightAt(SPAWN.x, SPAWN.z) };
  for (let i = 0; i < 18; i++) {
    const z = SPAWN.z - i * 1.4;
    const h = heightAt(SPAWN.x, z);
    if (h > 1.15) return { x: SPAWN.x, z, h };
  }
  return best;
}
const spawnPoint = findSpawn();
player.pos.set(spawnPoint.x, spawnPoint.h, spawnPoint.z);
playerGroup.position.copy(player.pos);
playerGroup.rotation.y = player.yaw;

// ------------------------------------------------------------ simple ambient audio
let audioCtx = null;
let ambience = { gain: { gain: { value: 0 } } };
let masterGain = null;
let noiseBuffer = null;
let birdsTimer = 4;
function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = state.audioOn ? 0.5 : 0;
    masterGain.connect(audioCtx.destination);
    noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ocean = audioCtx.createBufferSource(); ocean.buffer = noiseBuffer; ocean.loop = true;
    const lp = audioCtx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 480; lp.Q.value = 0.6;
    const g = audioCtx.createGain(); g.gain.value = 0.055;
    const lfo = audioCtx.createOscillator(); lfo.frequency.value = 0.09;
    const lfoGain = audioCtx.createGain(); lfoGain.gain.value = 0.025;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    ocean.connect(lp); lp.connect(g); g.connect(masterGain); ocean.start(); lfo.start();
    ambience.gain = g;
    const wind = audioCtx.createBufferSource(); wind.buffer = noiseBuffer; wind.loop = true;
    const bp = audioCtx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.4;
    const wg = audioCtx.createGain(); wg.gain.value = 0.012;
    wind.connect(bp); bp.connect(wg); wg.connect(masterGain); wind.start();
  } catch (e) { console.warn('audio unavailable', e); }
}
function sfx(type, volume = 0.5) {
  if (!audioCtx || !state.audioOn) return;
  const t = audioCtx.currentTime;
  const g = audioCtx.createGain();
  g.connect(masterGain);
  if (type === 'step') {
    const s = audioCtx.createBufferSource(); s.buffer = noiseBuffer;
    const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
    g.gain.setValueAtTime(volume * 0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    s.connect(f); f.connect(g); s.start(t); s.stop(t + 0.1);
  } else if (type === 'hit') {
    const o = audioCtx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(52, t + 0.16);
    g.gain.setValueAtTime(volume * 0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); o.start(t); o.stop(t + 0.22);
    const s = audioCtx.createBufferSource(); s.buffer = noiseBuffer;
    const f = audioCtx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700;
    const g2 = audioCtx.createGain(); g2.gain.setValueAtTime(volume * 0.25, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    s.connect(f); f.connect(g2); g2.connect(masterGain); s.start(t); s.stop(t + 0.13);
  } else if (type === 'pickup') {
    const o = audioCtx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(620, t); o.frequency.exponentialRampToValueAtTime(930, t + 0.1);
    g.gain.setValueAtTime(volume * 0.14, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g); o.start(t); o.stop(t + 0.15);
  } else if (type === 'roar') {
    const o = audioCtx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(rr(95, 150), t); o.frequency.exponentialRampToValueAtTime(rr(38, 60), t + 0.75);
    const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(volume * 0.5, t + 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    o.connect(f); f.connect(g); o.start(t); o.stop(t + 0.95);
  } else if (type === 'hurt') {
    const o = audioCtx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.18);
    g.gain.setValueAtTime(volume * 0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); o.start(t); o.stop(t + 0.22);
  } else if (type === 'level') {
    [523, 659, 784, 1046].forEach((freq, i) => {
      const o = audioCtx.createOscillator(); const gg = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      gg.gain.setValueAtTime(0.0001, t + i * 0.09); gg.gain.exponentialRampToValueAtTime(volume * 0.12, t + i * 0.09 + 0.02);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.32);
      o.connect(gg); gg.connect(masterGain); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.34);
    });
  }
}
function chirp() {
  if (!audioCtx || !state.audioOn) return;
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'sine';
  const base = rr(1700, 2600);
  o.frequency.setValueAtTime(base, t);
  o.frequency.exponentialRampToValueAtTime(base * rr(1.1, 1.5), t + 0.07);
  o.frequency.exponentialRampToValueAtTime(base * 0.85, t + 0.16);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.045, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.connect(g); g.connect(masterGain); o.start(t); o.stop(t + 0.24);
}

// ============================================================
//  DINOSAURS
// ============================================================
const DINO_SPECS = {
  parasaur: {
    name: 'PARASSAUR', body: [0.62, 0.72, 1.18], head: [0.32, 0.36, 0.5], legLen: 1.1, legR: 0.115,
    color: 0x84945a, belly: 0xcdc18f, accent: 0xc4794d, tailLen: 1.55, tailR: 0.24,
    hp: 120, speed: 2.0, run: 4.2, dmg: 0, aggro: 0, range: 0, quad: true,
    diet: 'HERBÍVORO', temper: 'PASSIVO', mountable: true, labelY: 3.25, xp: 35,
  },
  trike: {
    name: 'TRIKE', body: [0.86, 0.86, 1.34], head: [0.46, 0.44, 0.56], legLen: 0.92, legR: 0.16,
    color: 0x6f7b69, belly: 0xb9b195, accent: 0xd7cba6, tailLen: 1.4, tailR: 0.28,
    hp: 220, speed: 1.9, run: 3.5, dmg: 20, aggro: 0, range: 2.9, quad: true,
    diet: 'HERBÍVORO', temper: 'DEFENSIVO', mountable: true, labelY: 3.15, xp: 60,
  },
  raptor: {
    name: 'RAPTOR', body: [0.42, 0.5, 0.92], head: [0.3, 0.3, 0.47], legLen: 1.02, legR: 0.09,
    color: 0x8a4d34, belly: 0xbc8a64, accent: 0xd6b58e, tailLen: 1.6, tailR: 0.16,
    hp: 75, speed: 2.8, run: 5.5, dmg: 11, aggro: 19, range: 2.25, quad: false,
    diet: 'CARNÍVORO', temper: 'AGRESSIVO', mountable: false, labelY: 2.55, xp: 45,
  },
  rex: {
    name: 'REX', body: [1.16, 1.22, 2.08], head: [0.6, 0.62, 0.86], legLen: 1.86, legR: 0.25,
    color: 0x615a45, belly: 0xa89a75, accent: 0x35332a, tailLen: 3.0, tailR: 0.5,
    hp: 420, speed: 2.3, run: 4.7, dmg: 27, aggro: 22, range: 3.7, quad: false,
    diet: 'CARNÍVORO', temper: 'APEX', mountable: false, labelY: 6.35, xp: 180,
  },
  dodo: {
    name: 'DODO', body: [0.3, 0.34, 0.37], head: [0.24, 0.25, 0.26], legLen: 0.22, legR: 0.05,
    color: 0x9a8c6b, belly: 0xd4c49a, accent: 0xe0aa4d, tailLen: 0.25, tailR: 0.1,
    hp: 28, speed: 0.9, run: 1.9, dmg: 0, aggro: 0, range: 0, quad: false,
    diet: 'ONÍVORO', temper: 'PASSIVO', mountable: false, labelY: 1.2, xp: 12,
  },
};

const sphereGeo = new THREE.SphereGeometry(1, 8, 6);
const dinoMats = new Map();
function dmat(hex, opts = {}) {
  const key = hex + JSON.stringify(opts);
  if (!dinoMats.has(key)) dinoMats.set(key, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.92, metalness: 0, flatShading: true, ...opts }));
  return dinoMats.get(key);
}
const dinoEyeMat = new THREE.MeshBasicMaterial({ color: 0x0c0d0c });
const clawMat = new THREE.MeshStandardMaterial({ color: 0xd8cfb2, roughness: 0.7, flatShading: true });
const mouthMat = new THREE.MeshStandardMaterial({ color: 0x4a2521, roughness: 0.9, flatShading: true });

function labelTexture(name, level, temper, hpPct, tamed) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 140;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 140);
  ctx.textAlign = 'center';
  ctx.font = '700 34px "Chakra Petch", sans-serif';
  ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 10;
  ctx.fillStyle = tamed ? '#7bffe1' : '#f4fff9';
  ctx.fillText(name, 256, 38);
  ctx.shadowBlur = 0;
  ctx.font = '700 18px Rajdhani, sans-serif';
  ctx.fillStyle = tamed ? 'rgba(123,255,225,.8)' : 'rgba(230,245,240,.62)';
  ctx.fillText((tamed ? 'DOMADO' : temper) + '  ·  NV ' + level, 256, 62);
  ctx.fillStyle = 'rgba(0,0,0,.5)';
  ctx.fillRect(76, 76, 360, 12);
  const grad = ctx.createLinearGradient(76, 0, 436, 0);
  if (tamed) { grad.addColorStop(0, '#3fe0c0'); grad.addColorStop(1, '#9bffe8'); }
  else { grad.addColorStop(0, '#ff9466'); grad.addColorStop(1, '#e13b36'); }
  ctx.fillStyle = grad;
  ctx.fillRect(76, 76, 360 * clamp(hpPct, 0, 1), 12);
  ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1;
  ctx.strokeRect(76, 76, 360, 12);
  c.userData = {};
  return c;
}

function makeDinoLabel(d) {
  const canvas = labelTexture(d.spec.name, d.level, d.spec.temper, 1, d.tamed);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(4.4, 1.2, 1);
  sprite.position.y = d.spec.labelY + 0.8;
  sprite.renderOrder = 3;
  d.group.add(sprite);
  d.label = sprite;
  d.labelCanvas = canvas;
  d.labelTex = tex;
}
function refreshLabel(d) {
  if (!d.label) return;
  const canvas = labelTexture(d.spec.name, d.level, d.spec.temper, d.hp / d.maxHp, d.tamed);
  d.labelTex.image = canvas;
  d.labelTex.needsUpdate = true;
}

function buildDino(kind) {
  const S = DINO_SPECS[kind];
  const group = new THREE.Group();
  const B = S.body;
  const bodyY = S.legLen + B[1] * 0.86;
  const bodyMat = dmat(S.color);
  const bellyMat = dmat(S.belly);
  const accentMat = dmat(S.accent);
  const rig = { legs: [], tail: null, head: null, body: null, arms: [] };

  const body = new THREE.Mesh(sphereGeo, bodyMat);
  body.scale.set(B[0], B[1], B[2]);
  body.position.y = bodyY;
  body.castShadow = true; body.receiveShadow = false;
  group.add(body);
  rig.body = body;

  const chest = new THREE.Mesh(sphereGeo, bellyMat);
  chest.scale.set(B[0] * 0.67, B[1] * 0.55, B[2] * 0.42);
  chest.position.set(0, bodyY - B[1] * 0.28, -B[2] * 0.64);
  chest.castShadow = true;
  group.add(chest);

  // neck + head
  const headGroup = new THREE.Group();
  headGroup.position.set(0, bodyY + B[1] * (S.quad ? 0.46 : 0.72), -B[2] * 0.76);
  group.add(headGroup);
  rig.head = headGroup;

  const neck = new THREE.Mesh(sphereGeo, bodyMat);
  neck.scale.set(B[0] * 0.44, B[1] * 0.42, B[2] * 0.5);
  neck.position.set(0, -B[1] * 0.2, B[2] * 0.28);
  neck.rotation.x = -0.32;
  neck.castShadow = true;
  headGroup.add(neck);

  const head = new THREE.Mesh(sphereGeo, bodyMat);
  head.scale.set(S.head[0], S.head[1], S.head[2]);
  head.castShadow = true;
  headGroup.add(head);

  // snout / jaw for carnivores
  if (kind === 'raptor' || kind === 'rex') {
    const snout = new THREE.Mesh(new THREE.BoxGeometry(S.head[0] * 1.05, S.head[1] * 0.6, S.head[2] * 1.15), bodyMat);
    snout.position.set(0, -S.head[1] * 0.18, -S.head[2] * 0.85);
    snout.castShadow = true;
    headGroup.add(snout);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(S.head[0] * 0.9, S.head[1] * 0.3, S.head[2] * 1.05), bellyMat);
    jaw.position.set(0, -S.head[1] * 0.46, -S.head[2] * 0.76);
    headGroup.add(jaw);
    const teeth = kind === 'rex' ? 7 : 5;
    for (let i = 0; i < teeth; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.1, 3), clawMat);
      tooth.position.set((i / (teeth - 1) - 0.5) * S.head[0] * 0.78, -S.head[1] * 0.36, -S.head[2] * (1.02 + (i % 2) * 0.09));
      tooth.rotation.x = Math.PI;
      headGroup.add(tooth);
    }
  }
  if (kind === 'parasaur') {
    const crest = new THREE.Mesh(new THREE.ConeGeometry(S.head[0] * 0.55, 1.15, 5), accentMat);
    crest.position.set(0, S.head[1] * 0.45, S.head[2] * 0.55);
    crest.rotation.x = 1.18;
    crest.castShadow = true;
    headGroup.add(crest);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(S.head[0] * 0.34, 0.26, 4), accentMat);
    beak.position.set(0, -S.head[1] * 0.34, -S.head[2] * 1.02);
    beak.rotation.x = -Math.PI / 2;
    headGroup.add(beak);
  }
  if (kind === 'trike') {
    const frill = new THREE.Mesh(new THREE.CylinderGeometry(S.head[0] * 1.6, S.head[0] * 1.6, 0.09, 10), accentMat);
    frill.position.set(0, S.head[1] * 0.5, S.head[2] * 0.52);
    frill.rotation.x = Math.PI / 2;
    frill.scale.set(1.25, 1.25, 1.15);
    frill.castShadow = true;
    headGroup.add(frill);
    for (const sx of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.72, 5), clawMat);
      horn.position.set(sx * S.head[0] * 0.52, S.head[1] * 0.3, -S.head[2] * 1.02);
      horn.rotation.x = -Math.PI / 2 + 0.2;
      horn.castShadow = true;
      headGroup.add(horn);
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.42, 5), clawMat);
    nose.position.set(0, -S.head[1] * 0.05, -S.head[2] * 1.16);
    nose.rotation.x = -Math.PI / 2 + 0.65;
    headGroup.add(nose);
  }
  if (kind === 'dodo') {
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 4), accentMat);
    beak.position.set(0, -0.02, -S.head[2] * 1.1);
    beak.rotation.x = -Math.PI / 2;
    headGroup.add(beak);
    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(sphereGeo, bellyMat);
      wing.scale.set(0.12, 0.3, 0.34);
      wing.position.set(sx * B[0] * 1.02, bodyY - 0.02, 0.02);
      group.add(wing);
    }
  }
  // eyes
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 5, 4), dinoEyeMat);
    eye.position.set(sx * S.head[0] * 0.67, S.head[1] * 0.34, -S.head[2] * 0.63);
    headGroup.add(eye);
  }

  // tail
  const tailGroup = new THREE.Group();
  tailGroup.position.set(0, bodyY, B[2] * 0.82);
  tailGroup.rotation.x = 0.18;
  group.add(tailGroup);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(S.tailR, S.tailLen, 5), bodyMat);
  tail.rotation.x = Math.PI / 2;
  tail.position.z = S.tailLen / 2;
  tail.castShadow = true;
  tailGroup.add(tail);
  if (kind === 'rex' || kind === 'raptor') {
    for (let i = 0; i < 5; i++) {
      const spine = new THREE.Mesh(new THREE.ConeGeometry(0.06 + (kind === 'rex' ? 0.05 : 0), 0.26 + (kind === 'rex' ? 0.16 : 0), 4), accentMat);
      spine.position.set(0, bodyY + B[1] * (0.88 - i * 0.06), -B[2] * 0.5 + i * B[2] * 0.42);
      group.add(spine);
    }
  }
  rig.tail = tailGroup;

  // legs
  const hipY = S.quad ? bodyY - B[1] * 0.52 : bodyY - B[1] * 0.32;
  const legLen = hipY;
  const legs = [];
  if (S.quad) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) legs.push({ sx, sz, phase: (sz > 0 ? 0 : Math.PI) + (sx > 0 ? Math.PI : 0) });
  } else {
    legs.push({ sx: -1, sz: 0.06, phase: 0 }, { sx: 1, sz: 0.06, phase: Math.PI });
  }
  for (const l of legs) {
    const g = new THREE.Group();
    g.position.set(l.sx * B[0] * 0.56, hipY, l.sz * B[2] * (S.quad ? 0.58 : 0.15));
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(S.legR * 0.7, S.legR, legLen * 0.55, 5), bodyMat);
    thigh.position.y = -legLen * 0.275; thigh.castShadow = true; g.add(thigh);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(S.legR * 0.5, S.legR * 0.62, legLen * 0.5, 5), bodyMat);
    shin.position.y = -legLen * 0.72; shin.castShadow = true; g.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(S.legR * 2.1, S.legR * 0.6, S.legR * 3.2), accentMat);
    foot.position.set(0, -legLen + S.legR * 0.25, -S.legR * 0.5); g.add(foot);
    group.add(g);
    rig.legs.push({ group: g, phase: l.phase });
  }

  // little arms for bipeds
  if (!S.quad && kind !== 'dodo') {
    for (const sx of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(sx * B[0] * 0.88, bodyY + B[1] * 0.08, -B[2] * 0.55);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, kind === 'rex' ? 0.32 : 0.44, 5), bodyMat);
      arm.position.y = kind === 'rex' ? -0.16 : -0.22; arm.castShadow = true; g.add(arm);
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 3), clawMat);
      claw.position.y = kind === 'rex' ? -0.36 : -0.48; claw.rotation.x = 0.4; g.add(claw);
      g.rotation.x = kind === 'rex' ? 0.35 : 0.55;
      group.add(g);
      rig.arms.push(g);
    }
  }

  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = true; } });
  return { group, rig, bodyY };
}

const dinos = [];
function spawnDino(kind, x, z, yaw) {
  const S = DINO_SPECS[kind];
  const level = 1 + Math.floor(RNG() * 32);
  const scale = rr(0.92, 1.08);
  const built = buildDino(kind);
  const group = built.group;
  group.scale.setScalar(scale);
  const h = heightAt(x, z);
  group.position.set(x, h, z);
  group.rotation.y = yaw ?? rr(0, TAU);
  scene.add(group);
  const d = {
    kind, spec: S, group, rig: built.rig, level, scale,
    hp: S.hp * (1 + level * 0.012), maxHp: S.hp * (1 + level * 0.012),
    home: { x, z }, yaw: group.rotation.y, mode: 'wander', wanderT: rr(0, 4),
    target: null, attackCD: rr(0.6, 2), animT: rr(0, 10), speedNow: 0,
    dead: false, deathT: 0, respawnT: 0, tamed: false, mounted: false,
    tamedName: null, label: null, labelTex: null, labelCanvas: null,
    lastLabelHp: -1, provoked: 0,
  };
  makeDinoLabel(d);
  dinos.push(d);
  return d;
}

function landSpawn(kind, x, z, yaw) {
  let px = x, pz = z;
  for (let i = 0; i < 30; i++) {
    if (heightAt(px, pz) > 0.9) break;
    pz -= 4;
  }
  return spawnDino(kind, px, pz, yaw);
}

// herds and predators — framed for the opening view
landSpawn('parasaur', -18, 82, 2.5);
landSpawn('parasaur', -32, 88, 1.4);
landSpawn('parasaur', -45, 76, 3.2);
landSpawn('dodo', -9, 80, 0.4);
landSpawn('dodo', -30, 78, 2.2);
landSpawn('trike', -52, 84, 1.1);
landSpawn('raptor', -35, 25, 0.8);
landSpawn('raptor', 27, 10, 2.8);
landSpawn('parasaur', 46, 30, 4.0);
landSpawn('rex', -44, -34, 1.6);
landSpawn('raptor', -58, -7, 4.2);

function shortestAngle(a, b) {
  let d = (b - a + Math.PI) % TAU - Math.PI;
  if (d < -Math.PI) d += TAU;
  return d;
}
function dinoDistance(d) { return Math.hypot(d.group.position.x - player.pos.x, d.group.position.z - player.pos.z); }

function moveDino(d, tx, tz, speed, dt) {
  const dx = tx - d.group.position.x, dz = tz - d.group.position.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.15) { d.speedNow = damp(d.speedNow, 0, 6, dt); return; }
  const nx = dx / len, nz = dz / len;
  const desiredYaw = Math.atan2(-nx, -nz);
  d.yaw += clamp(shortestAngle(d.yaw, desiredYaw), -4.2 * dt, 4.2 * dt);
  const step = speed * dt;
  let px = d.group.position.x + nx * step * 0.36;
  let pz = d.group.position.z + nz * step * 0.36;
  const h = heightAt(px, pz);
  if (h < 0.45) {
    d.wanderT = 0;
    d.speedNow = damp(d.speedNow, 0, 6, dt);
    return;
  }
  d.group.position.x = px;
  d.group.position.z = pz;
  d.group.position.y = damp(d.group.position.y, h, 14, dt);
  d.group.rotation.y = d.yaw;
  d.speedNow = damp(d.speedNow, speed, 5, dt);
}

function updateDinoVisual(d, dt) {
  const S = d.spec;
  const speed = d.speedNow;
  d.animT += dt * (1.7 + speed * 1.55);
  const amp = clamp(speed / Math.max(1, S.run) * 0.9, 0.045, 0.72);
  for (const leg of d.rig.legs) {
    leg.group.rotation.x = Math.sin(d.animT * 1.7 + leg.phase) * amp;
  }
  if (d.rig.tail) d.rig.tail.rotation.y = Math.sin(d.animT * 0.55) * 0.22 + Math.sin(d.animT * 1.4) * 0.05;
  if (d.rig.head) {
    d.rig.head.rotation.x = Math.sin(d.animT * 0.7) * 0.035 - (d.mode === 'idle' ? 0.1 : 0);
    d.rig.head.rotation.y = Math.sin(d.animT * 0.33) * 0.05;
  }
  if (d.rig.body) d.rig.body.position.y = (S.legLen + S.body[1] * 0.86) + Math.sin(d.animT * 1.7) * 0.025 * amp * 8;
  for (const a of d.rig.arms) a.rotation.z = Math.sin(d.animT * 1.2) * 0.08;
  if (d.attackAnim > 0) {
    d.attackAnim -= dt;
    const k = Math.sin(clamp(1 - d.attackAnim / 0.28, 0, 1) * Math.PI);
    if (d.rig.head) d.rig.head.rotation.x -= k * 0.55;
    if (d.rig.body) d.rig.body.position.z = -k * 0.22;
  } else if (d.rig.body) {
    d.rig.body.position.z = damp(d.rig.body.position.z, 0, 8, dt);
  }
}

function updateDinoLabels() {
  for (const d of dinos) {
    if (!d.label) continue;
    const dist = dinoDistance(d);
    d.label.visible = state.playing && !d.dead && dist < 29;
    if (d.label.visible && Math.abs(d.hp - d.lastLabelHp) > 0.5) {
      refreshLabel(d);
      d.lastLabelHp = d.hp;
    }
  }
}

function updateDinos(dt) {
  for (const d of dinos) {
    if (d.dead) {
      d.deathT += dt;
      d.group.rotation.z = damp(d.group.rotation.z, 1.45, 4, dt);
      d.group.position.y = damp(d.group.position.y, heightAt(d.group.position.x, d.group.position.z) - 0.45, 1.5, dt);
      if (d.respawnT > 0) {
        d.respawnT -= dt;
        if (d.respawnT <= 0) respawnDino(d);
      }
      continue;
    }
    d.attackCD -= dt;
    if (d.provoked > 0) d.provoked -= dt;
    if (d.attackAnim === undefined) d.attackAnim = 0;
    if (d.attackAnim > 0) d.attackAnim = Math.max(0, d.attackAnim - dt);

    if (state.mounted === d) { updateDinoVisual(d, dt); continue; }

    const pd = dinoDistance(d);
    const S = d.spec;
    let moveSpeed = 0, targetX = null, targetZ = null;

    if (d.tamed) {
      // defenders & followers
      let enemy = null, ed = 17;
      for (const o of dinos) {
        if (o === d || o.dead || o.tamed) continue;
        if (!o.spec.aggro && o.provoked <= 0) continue;
        const od = Math.hypot(o.group.position.x - d.group.position.x, o.group.position.z - d.group.position.z);
        if (od < ed) { ed = od; enemy = o; }
      }
      if (enemy && !state.mounted) {
        if (ed < 2.9) {
          if (d.attackCD <= 0) { damageDino(enemy, 24 + d.level, 'tamed'); d.attackCD = 1.3; d.attackAnim = 0.28; sfx('hit', 0.35); }
        } else { moveSpeed = S.run; targetX = enemy.group.position.x; targetZ = enemy.group.position.z; }
      } else if (pd > 4.2) {
        moveSpeed = S.run * 0.9;
        targetX = player.pos.x; targetZ = player.pos.z;
      }
    } else if (pd < 30 && !state.dead && state.playing) {
      const hostile = S.aggro > 0 || d.provoked > 0;
      if (hostile) {
        if (pd < (S.aggro || 11) && (S.aggro > 0 || d.provoked > 0)) {
          d.mode = 'chase';
          if (pd < S.range) {
            if (d.attackCD <= 0) {
              hurtPlayer(S.dmg * (1 + d.level * 0.012), S.name);
              d.attackCD = S.aggro > 0 ? 1.35 : 1.8;
              d.attackAnim = 0.3;
              if (S.aggro > 0) sfx('roar', 0.3);
            }
          } else {
            moveSpeed = S.run; targetX = player.pos.x; targetZ = player.pos.z;
          }
        }
      } else if (pd < 5.2 && d.provoked > 0) {
        d.mode = 'flee';
        const a = Math.atan2(d.group.position.x - player.pos.x, d.group.position.z - player.pos.z);
        targetX = d.group.position.x + Math.sin(a) * 12;
        targetZ = d.group.position.z + Math.cos(a) * 12;
        moveSpeed = S.run;
      }
    }

    if (targetX === null && !d.tamed) {
      if (d.mode === 'flee') d.mode = 'wander';
      d.wanderT -= dt;
      if (d.wanderT <= 0) {
        d.wanderT = rr(3.5, 8);
        const a = rr(0, TAU), r = rr(2, 13);
        d.wanderTarget = { x: clamp(d.home.x + Math.cos(a) * r, -95, 95), z: clamp(d.home.z + Math.sin(a) * r, -95, 95) };
      }
      if (d.wanderTarget) {
        const wd = Math.hypot(d.wanderTarget.x - d.group.position.x, d.wanderTarget.z - d.group.position.z);
        if (wd > 1) {
          moveSpeed = S.speed * 0.55;
          targetX = d.wanderTarget.x; targetZ = d.wanderTarget.z;
        } else {
          d.wanderTarget = null;
        }
      }
    }

    if (moveSpeed > 0 && targetX !== null) moveDino(d, targetX, targetZ, moveSpeed, dt);
    else { d.speedNow = damp(d.speedNow, 0, 5, dt); d.group.rotation.y = damp(d.group.rotation.y, d.yaw, 5, dt); }
    d.group.position.y = damp(d.group.position.y, heightAt(d.group.position.x, d.group.position.z), 14, dt);
    updateDinoVisual(d, dt);
  }
}

function respawnDino(d) {
  d.dead = false;
  d.group.visible = true;
  d.group.rotation.set(0, rr(0, TAU), 0);
  d.hp = d.maxHp;
  d.tamed = false;
  d.provoked = 0;
  const a = rr(0, TAU), r = rr(4, 16);
  let x = d.home.x + Math.cos(a) * r;
  let z = d.home.z + Math.sin(a) * r;
  if (heightAt(x, z) < 0.9) { x = d.home.x; z = d.home.z; }
  d.group.position.set(x, heightAt(x, z), z);
  refreshLabel(d);
}

function damageDino(d, amount, source = 'player') {
  if (d.dead) return;
  d.hp -= amount;
  d.provoked = 12;
  refreshLabel(d);
  burst(d.group.position.x, d.group.position.y + d.spec.body[1] + 0.4, d.group.position.z, 0x9e2f20, 8, 1.4, 2.4);
  if (d.hp <= 0) {
    d.hp = 0;
    d.dead = true;
    d.deathT = 0;
    d.respawnT = d.spec.name === 'REX' ? 110 : 55;
    d.label.visible = false;
    d.speedNow = 0;
    if (d.tamed) {
      toast(d.spec.name + ' domado foi perdido.', 'bad', 'paw');
    } else if (source === 'player' || source === 'tamed') {
      const meat = d.kind === 'rex' ? 9 : d.kind === 'trike' ? 6 : d.kind === 'dodo' ? 1 : 4;
      const hide = d.kind === 'rex' ? 6 : d.kind === 'dodo' ? 1 : 3;
      addItem('meat', meat); addItem('hide', hide);
      state.kills++;
      addXP(d.spec.xp + d.level * 2);
      floatGain(`+${meat} carne · +${hide} couro`, 'meat');
      toast(`${d.spec.name} abatido. +${d.spec.xp + d.level * 2} XP`, 'ok', 'paw');
      sfx('roar', 0.4);
    }
  } else {
    sfx('hit', 0.48);
  }
}

// ============================================================
//  INVENTORY / CRAFTING
// ============================================================
const ITEM_META = {
  wood: { name: 'Madeira', icon: 'wood', weight: 0.6 },
  stone: { name: 'Pedra', icon: 'stone', weight: 1.1 },
  thatch: { name: 'Palha', icon: 'fiber', weight: 0.15 },
  fiber: { name: 'Fibras', icon: 'fiber', weight: 0.08 },
  berries: { name: 'Frutas', icon: 'berry', weight: 0.12 },
  meat: { name: 'Carne crua', icon: 'meat', weight: 0.5 },
  cookedMeat: { name: 'Carne assada', icon: 'food', weight: 0.45 },
  hide: { name: 'Couro', icon: 'hide', weight: 0.4 },
  flint: { name: 'Sílex', icon: 'flint', weight: 0.25 },
};
const RECIPES = [
  {
    id: 'spear', name: 'LANÇA DE PEDRA', icon: 'spear', tier: 'FERRAMENTA',
    desc: 'Causa muito mais dano. Essencial contra predadores.',
    cost: { wood: 8, stone: 6, fiber: 5 }, once: true,
  },
  {
    id: 'campfire', name: 'FOGUEIRA', icon: 'fire', tier: 'ESTRUTURA',
    desc: 'Aquece, ilumina a noite e assa carne crua.',
    cost: { wood: 10, stone: 8, thatch: 6 }, once: false,
  },
  {
    id: 'armor', name: 'ARMADURA DE COURO', icon: 'hide', tier: 'EQUIPAMENTO',
    desc: 'Reduz em 30% o dano recebido de dinossauros.',
    cost: { hide: 6, fiber: 10 }, once: true,
  },
  {
    id: 'torch', name: 'TOCHA', icon: 'torch', tier: 'FERRAMENTA',
    desc: 'Ilumina a escuridão. Segura na mão esquerda.',
    cost: { wood: 3, fiber: 4 }, once: true,
  },
];

function addItem(id, amount) {
  state.inv[id] = (state.inv[id] || 0) + amount;
  updateHotbar();
  if (!panel.classList.contains('hidden')) renderInventory();
  if (!panel.classList.contains('hidden')) renderRecipes();
}
function hasCost(cost) { return Object.entries(cost).every(([k, v]) => (state.inv[k] || 0) >= v); }
function spendCost(cost) { for (const [k, v] of Object.entries(cost)) state.inv[k] -= v; }
function invWeight() {
  let total = 0;
  for (const [k, v] of Object.entries(state.inv)) total += (ITEM_META[k]?.weight || 0) * v;
  return total;
}
function xpNeeded() { return 100 + (player.level - 1) * 85; }
function addXP(n) {
  player.xp += n;
  let leveled = false;
  while (player.xp >= xpNeeded()) {
    player.xp -= xpNeeded();
    player.level++;
    player.health = Math.min(100, player.health + 25);
    player.stamina = 100;
    leveled = true;
  }
  if (leveled) {
    sfx('level', 0.7);
    toast(`NÍVEL ${player.level} alcançado!`, 'ok', 'bolt');
    burst(player.pos.x, player.pos.y + 1, player.pos.z, 0x5ff2d0, 22, 2.8, 4.5, 2);
  }
  updateVitals();
}
function floatGain(text, icon = 'wood') {
  const el = document.createElement('div');
  el.className = 'float-gain';
  el.innerHTML = `<svg class="icon"><use href="#i-${icon}"/></svg><span>${text}</span>`;
  el.style.left = (48 + rr(-7, 7)) + '%';
  $('hud').appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

// recipes UI
function craftRecipe(recipe) {
  if (recipe.once && state.crafted[recipe.id]) return;
  if (!hasCost(recipe.cost)) { toast('Recursos insuficientes.', 'warn', 'bag'); return; }
  spendCost(recipe.cost);
  state.crafted[recipe.id] = true;
  if (recipe.id === 'spear') {
    addItem('spear', 1);
    state.selected = 'spear';
    toast('Lança de pedra criada. Equipada.', 'ok', 'spear');
  } else if (recipe.id === 'campfire') {
    const fx = player.pos.x - Math.sin(player.yaw) * 2.6;
    const fz = player.pos.z - Math.cos(player.yaw) * 2.6;
    createCampfire(fx, fz);
    toast('Fogueira acesa. Aproxime-se para assar carne.', 'ok', 'fire');
  } else if (recipe.id === 'armor') {
    state.armor = true;
    pMats.shirt.color.setHex(0x6b4b2f);
    toast('Armadura de couro equipada. Dano reduzido.', 'ok', 'hide');
  } else if (recipe.id === 'torch') {
    state.crafted.torch = true;
    attachTorch();
    toast('Tocha acesa. A noite já não é tão cega.', 'ok', 'torch');
  }
  addXP(18);
  state.crafted[recipe.id] = true;
  updateHotbar();
  renderInventory();
  renderRecipes();
  sfx('pickup', 0.6);
}

function attachTorch() {
  if (playerGroup.userData.torch) return;
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.033, 0.62, 5), pMats.leather);
  stick.position.y = -0.2; g.add(stick);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.26, 5), flameMat);
  flame.position.y = 0.17; g.add(flame);
  const glow = new THREE.PointLight(0xff9a45, 6.5, 13, 2);
  glow.position.set(0, 0.2, 0);
  g.add(glow);
  g.position.set(-0.1, 1.1, 0.03);
  playerGroup.add(g);
  playerGroup.userData.torch = g;
  playerGroup.userData.torchLight = glow;
}

const panel = $('panel');
const invGrid = $('inv-grid');
const recipeList = $('recipe-list');

function renderInventory() {
  invGrid.innerHTML = Object.entries(ITEM_META).map(([id, meta]) => {
    const n = state.inv[id] || 0;
    return `<div class="inv-item ${n ? '' : 'empty'}">
      <svg class="icon"><use href="#i-${meta.icon}"/></svg>
      <span class="inv-name">${meta.name}</span>
      <span class="inv-count">${n}</span>
    </div>`;
  }).join('');
  $('weight-label').textContent = `${invWeight().toFixed(1)} / 100 kg`;
}
function renderRecipes() {
  recipeList.innerHTML = RECIPES.map(r => {
    const made = r.once && state.crafted[r.id];
    const can = hasCost(r.cost) && !made;
    return `<div class="recipe ${made ? 'passive' : ''}">
      <div class="recipe-icon"><svg class="icon"><use href="#i-${r.icon}"/></svg></div>
      <div class="recipe-body">
        <div class="recipe-title"><b>${r.name}</b><span>${r.tier}</span></div>
        <div class="recipe-desc">${r.desc}</div>
        <div class="recipe-cost">${Object.entries(r.cost).map(([id, n]) => `<span class="cost ${(state.inv[id] || 0) < n ? 'missing' : ''}"><svg class="icon"><use href="#i-${ITEM_META[id].icon}"/></svg>${n}</span>`).join('')}</div>
      </div>
      <div class="recipe-action"><button class="craft-btn" data-craft="${r.id}" ${can ? '' : 'disabled'}>${made ? 'PRONTO' : 'CRIAR'}</button></div>
    </div>`;
  }).join('');
}
function updateGuide() {
  const g = document.getElementById('guide-panel');
  if (!g) return;
  g.innerHTML = `<h4>SOBREVIVÊNCIA</h4>
    <ul>
      <li><b>Vida</b> cai com ataques e fome. <b>Frutas</b> e <b>carne assada</b> recuperam alimentos.</li>
      <li>Colete <b>madeira</b> em palmeiras, <b>pedra</b> em rochas e <b>fibras/frutas</b> em arbustos.</li>
      <li>Crie uma <b>fogueira</b> e aproxime-se com carne crua para assar.</li>
      <li>Domestique um <b>Parasaur</b> com 5 frutas e monte nele para viajar rápido.</li>
      <li>Raptors caçam em matilha. Não enfrente à noite sem lança.</li>
    </ul>
    <h4>CONTROLES</h4>
    <ul>
      <li><b>Toque:</b> joystick à esquerda, arraste a tela para olhar.</li>
      <li><b>Inclinação:</b> incline o aparelho para olhar. No iOS, a permissão é solicitada ao ativar.</li>
      <li><b>Teclado:</b> WASD, mouse, E, Espaço, Shift, I, C, V.</li>
    </ul>
    <h4>DINOSSAUROS</h4>
    <ul>
      <li><b>Parasaur</b> e <b>Dodo</b>: passivos. <b>Trike</b>: reage se atacado. <b>Raptor</b>: predador veloz. <b>Rex</b>: apex do norte.</li>
    </ul>`;
}

function openPanel(tab = 'all') {
  if (state.dead) return;
  state.paused = true;
  document.exitPointerLock?.();
  panel.classList.remove('hidden');
  setTab(tab);
  renderInventory();
  renderRecipes();
  state.panelOpen = true;
}
function closePanel() {
  panel.classList.add('hidden');
  state.paused = false;
  state.panelOpen = false;
}
function setTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  const body = document.querySelector('.panel-body');
  if (body) body.classList.toggle('craft-focus', tab === 'craft');
  const inv = document.querySelector('.inv-col');
  const craft = document.querySelector('.craft-col');
  let guide = document.getElementById('guide-panel');
  if (tab === 'all') {
    inv.style.display = ''; craft.style.display = ''; if (guide) guide.remove();
  } else if (tab === 'craft') {
    inv.style.display = 'none'; craft.style.display = ''; if (guide) guide.remove();
  } else {
    inv.style.display = 'none'; craft.style.display = 'none';
    if (!guide) {
      guide = document.createElement('div');
      guide.id = 'guide-panel';
      guide.className = 'guide';
      document.querySelector('.panel-body').appendChild(guide);
    }
    updateGuide();
  }
}

// hotbar
const slotEls = [...document.querySelectorAll('.slot')];
function updateHotbar() {
  for (const el of slotEls) {
    const item = el.dataset.item;
    let count = 0, locked = false;
    if (item === 'axe') count = '∞';
    else if (item === 'spear') { count = state.crafted.spear ? 1 : 0; locked = !state.crafted.spear; }
    else { count = state.inv[item] || 0; locked = false; }
    const ce = $('count-' + item);
    if (ce) ce.textContent = count;
    el.classList.toggle('locked', locked);
    el.classList.toggle('selected', state.selected === item);
  }
  const axe = playerGroup.userData;
  handAxe.visible = state.selected === 'axe';
  handSpear.visible = state.selected === 'spear';
  if (viewModel.userData.axe) viewModel.userData.axe.visible = state.selected === 'axe';
}
function selectSlot(item) {
  if (item === 'spear' && !state.crafted.spear) { toast('Crie uma lança na bancada (C).', 'warn', 'spear'); return; }
  if (item === 'berries' || item === 'cookedMeat') { consume(item); return; }
  state.selected = item;
  updateHotbar();
  sfx('pickup', 0.25);
}
function consume(id) {
  if ((state.inv[id] || 0) <= 0) { toast('Você não tem ' + ITEM_META[id].name.toLowerCase() + '.', 'warn', ITEM_META[id].icon); return; }
  state.inv[id]--;
  if (id === 'berries') {
    player.food = Math.min(100, player.food + 9);
    player.water = Math.min(100, player.water + 7);
    player.health = Math.min(100, player.health + 2);
    floatGain('+9 fome · +7 sede', 'berry');
  } else {
    player.food = Math.min(100, player.food + 34);
    player.health = Math.min(100, player.health + 12);
    floatGain('+34 fome · +12 vida', 'food');
  }
  sfx('pickup', 0.42);
  updateHotbar();
  if (!panel.classList.contains('hidden')) renderInventory();
}

// ============================================================
//  RESOURCE HARVESTING / INTERACTION
// ============================================================
function nearestResource(maxDist = 4.2) {
  let best = null, bd = maxDist * maxDist;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  for (const r of resources) {
    if (r.dead) continue;
    const d = dist2(player.pos.x, player.pos.z, r.x, r.z);
    if (d < bd) {
      const dx = r.x - player.pos.x, dz = r.z - player.pos.z;
      const len = Math.sqrt(d) || 1;
      if (dx / len * fx + dz / len * fz < -0.35) continue;
      bd = d; best = r;
    }
  }
  return best;
}
function nearestDinoInteraction(maxDist = 4.6) {
  let best = null, bd = maxDist * maxDist;
  for (const d of dinos) {
    if (d.dead) continue;
    const dd = dist2(player.pos.x, player.pos.z, d.group.position.x, d.group.position.z);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}
function nearestCampfire(maxDist = 3.8) {
  let best = null, bd = maxDist * maxDist;
  for (const c of state.campfires) {
    const dd = dist2(player.pos.x, player.pos.z, c.x, c.z);
    if (dd < bd) { bd = dd; best = c; }
  }
  return best;
}
function computeContext() {
  if (state.mounted) return { type: 'dismount', label: 'DESCER', icon: 'paw', text: 'Descer da montaria' };
  const fire = nearestCampfire(3.8);
  if (fire && state.inv.meat > 0) return { type: 'cook', label: 'ASSAR', icon: 'fire', text: 'Assar carne na fogueira', fire };
  const d = nearestDinoInteraction(4.6);
  if (d) {
    if (d.tamed && d.spec.mountable) return { type: 'mount', label: 'MONTAR', icon: 'paw', text: 'Montar ' + (d.tamedName || d.spec.name), dino: d };
    if (!d.tamed && (d.spec.temper === 'PASSIVO' || d.spec.temper === 'DEFENSIVO')) {
      const can = state.inv.berries >= 5;
      return { type: can ? 'tame' : 'tameBlocked', label: 'DOMAR', icon: 'paw', text: can ? `Domar ${d.spec.name} · 5 frutas` : `Domar ${d.spec.name} · faltam frutas`, dino: d };
    }
    return { type: 'attack', label: 'ATACAR', icon: state.selected === 'spear' ? 'spear' : 'axe', text: 'Atacar ' + d.spec.name, dino: d };
  }
  const r = nearestResource(4.3);
  if (r) return { type: 'gather', label: 'COLETAR', icon: r.kind === 'rock' ? 'stone' : r.kind === 'bush' || r.kind === 'berry' ? 'fiber' : 'axe', text: 'Coletar ' + r.yieldName, resource: r };
  return { type: 'swing', label: 'GOLPEAR', icon: state.selected === 'spear' ? 'spear' : 'axe', text: 'Atacar' };
}

function harvestResource(r) {
  if (r.dead) return;
  const data = resourceData[r.kind];
  r.hp--;
  r.shake = 0.32;
  const px = r.x, pz = r.z;
  const py = heightAt(px, pz) + (r.kind === 'rock' ? 0.7 : 2.1);
  const color = r.kind === 'rock' ? 0x8c887c : r.kind === 'bush' || r.kind === 'berry' ? 0x6f9a45 : 0x8a6841;
  burst(px, py, pz, color, 12, 2.4, 3.6);
  sfx('hit', 0.35);
  for (const [id, min, max] of data.yields) {
    let n = Math.floor(rr(min, max + 1));
    if (r.kind === 'rock' && id === 'stone') n = Math.max(1, n);
    if (n <= 0) continue;
    addItem(id, n);
    state.gathered[id] = (state.gathered[id] || 0) + n;
    floatGain(`+${n} ${ITEM_META[id].name.toLowerCase()}`, ITEM_META[id].icon);
  }
  addXP(2);
  if (r.hp <= 0) {
    r.dead = true;
    r.respawn = 48 + rr(0, 22);
    r.mesh.visible = false;
    for (const c of colliders) if (c.res === r) c.r = -1;
  }
  updateQuest();
  if (!panel.classList.contains('hidden')) { renderInventory(); renderRecipes(); }
}

function updateResources(dt) {
  for (const r of resources) {
    if (r.dead) {
      r.respawn -= dt;
      if (r.respawn <= 0) {
        r.dead = false;
        r.hp = r.maxHp;
        r.mesh.visible = true;
        r.mesh.rotation.z = 0;
        r.mesh.scale.setScalar(1);
        if (r.collider) r.collider.r = r.radius + 0.3;
      }
      continue;
    }
    if (r.shake > 0) {
      r.shake = Math.max(0, r.shake - dt);
      const k = Math.sin(r.shake * 70) * r.shake;
      r.mesh.rotation.z = k * 0.13;
      r.mesh.scale.set(1 + k * 0.08, 1 - k * 0.05, 1 + k * 0.08);
      if (r.shake === 0) {
        r.mesh.rotation.z = 0;
        r.mesh.scale.setScalar(1);
      }
    }
  }
}

function doAction() {
  if (!state.playing || state.dead || state.paused) return;
  const ctx = state.context || computeContext();
  const needsCooldown = ctx.type === 'gather' || ctx.type === 'attack' || ctx.type === 'swing';
  if (needsCooldown) {
    if (state.attackCD > 0) return;
    state.attackCD = 0.44;
    state.swing = 0.3;
  }
  if (ctx.type === 'gather' && ctx.resource) { harvestResource(ctx.resource); return; }
  if (ctx.type === 'attack' && ctx.dino) {
    const dmg = state.selected === 'spear' ? 27 : 15;
    damageDino(ctx.dino, dmg, 'player');
    addXP(3);
    return;
  }
  if (ctx.type === 'tame' || ctx.type === 'tameBlocked') {
    if (state.inv.berries < 5) { toast('Você precisa de 5 frutas para domar.', 'warn', 'berry'); return; }
    if (!ctx.dino || ctx.dino.dead) return;
    state.inv.berries -= 5;
    ctx.dino.tamed = true;
    ctx.dino.tamedName = ctx.dino.spec.name;
    ctx.dino.mode = 'follow';
    state.tamed++;
    refreshLabel(ctx.dino);
    heartBurst(ctx.dino.group.position.x, ctx.dino.group.position.y + ctx.dino.spec.labelY * 0.5, ctx.dino.group.position.z);
    toast(`${ctx.dino.spec.name} DOMADO! Ele vai te seguir.`, 'ok', 'paw');
    addXP(60 + ctx.dino.level * 2);
    sfx('level', 0.6);
    updateHotbar();
    updateQuest();
    return;
  }
  if (ctx.type === 'mount' && ctx.dino) { mountDino(ctx.dino); return; }
  if (ctx.type === 'dismount') { dismountDino(); return; }
  if (ctx.type === 'cook') {
    if (state.inv.meat <= 0) return;
    if (state.cookCD > 0) return;
    state.cookCD = 0.8;
    state.inv.meat--;
    addItem('cookedMeat', 1);
    addXP(3);
    const f = ctx.fire;
    burst(f.x, f.y + 0.6, f.z, 0xffb35a, 8, 0.7, 2.2, -1);
    floatGain('+1 carne assada', 'food');
    sfx('pickup', 0.35);
    return;
  }
  // swing at air
  sfx('hit', 0.18);
}

function mountDino(d) {
  if (!d.tamed || !d.spec.mountable) return;
  state.mounted = d;
  d.mounted = true;
  playerGroup.visible = false;
  viewModel.visible = false;
  toast(`Montado em ${d.spec.name}. Use o joystick para cavalgar.`, 'ok', 'paw');
  addXP(8);
}
function dismountDino() {
  const d = state.mounted;
  if (!d) return;
  state.mounted = null;
  d.mounted = false;
  playerGroup.visible = state.cameraMode === 0;
  viewModel.visible = state.cameraMode === 1;
  const side = d.yaw + Math.PI / 2;
  let px = d.group.position.x - Math.sin(side) * 2.3;
  let pz = d.group.position.z - Math.cos(side) * 2.3;
  if (heightAt(px, pz) < 0.7) { px = d.group.position.x; pz = d.group.position.z + 2.3; }
  player.pos.set(px, heightAt(px, pz), pz);
  playerGroup.position.copy(player.pos);
}

// ============================================================
//  PLAYER
// ============================================================
function hurtPlayer(amount, cause) {
  if (state.dead || !state.playing) return;
  const dmg = amount * (state.armor ? 0.7 : 1);
  player.health -= dmg;
  state.lastDamage = state.elapsed;
  state.shake = Math.min(0.65, state.shake + 0.3);
  state.damageFlash = 0.16;
  $('damage-flash').classList.add('hit');
  setTimeout(() => $('damage-flash').classList.remove('hit'), 120);
  sfx('hurt', 0.65);
  if (player.health <= 0) {
    player.health = 0;
    die(cause);
  }
  updateVitals();
}
function die(cause) {
  state.dead = true;
  document.body.classList.add('dead');
  $('death-cause').textContent = cause ? `${cause} foi mais rápido que você.` : 'A ilha cobrou seu preço.';
  $('death').classList.remove('hidden');
  document.exitPointerLock?.();
  playerGroup.rotation.z = 0;
}
function respawn() {
  state.dead = false;
  document.body.classList.remove('dead');
  $('death').classList.add('hidden');
  player.health = 70; player.stamina = 100; player.food = 60; player.water = 60;
  player.pos.set(spawnPoint.x, spawnPoint.h, spawnPoint.z);
  player.vy = 0; player.yaw = 0; player.pitch = -0.13;
  playerGroup.position.copy(player.pos);
  playerGroup.rotation.z = 0;
  playerGroup.visible = state.cameraMode === 0;
  state.mounted = null;
  state.shake = 0;
  toast('Você renasceu na praia. Recupere o fôlego.', 'warn', 'heart');
}

function updatePlayer(dt) {
  const p = player;
  if (state.dead) return;
  p.attackCD = (p.attackCD || 0) - dt;
  state.attackCD = Math.max(0, state.attackCD - dt);
  state.cookCD = Math.max(0, state.cookCD - dt);

  let ix = 0, iy = 0;
  if (state.joystick.active) { ix = state.joystick.x; iy = state.joystick.y; }
  if (state.key['w'] || state.key['arrowup']) iy -= 1;
  if (state.key['s'] || state.key['arrowdown']) iy += 1;
  if (state.key['a'] || state.key['arrowleft']) ix -= 1;
  if (state.key['d'] || state.key['arrowright']) ix += 1;
  const il = Math.hypot(ix, iy);
  if (il > 1) { ix /= il; iy /= il; }
  const wantsMove = il > 0.06;

  const sprinting = state.sprint && wantsMove && p.stamina > 1 && p.food > 0;
  let speed = sprinting ? 7.0 : 4.05;
  if (p.food <= 0 || p.water <= 0) speed *= 0.6;
  if (state.mounted) {
    state.jumpQueued = false;
    const d = state.mounted;
    speed = d.spec.run * 1.22;
    if (wantsMove) {
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      const dx = (fx * -iy + rx * ix), dz = (fz * -iy + rz * ix);
      const len = Math.hypot(dx, dz) || 1;
      const nx = d.group.position.x + dx / len * speed * dt;
      const nz = d.group.position.z + dz / len * speed * dt;
      const h = heightAt(nx, nz);
      if (h > 0.5) {
        d.group.position.x = nx; d.group.position.z = nz; d.group.position.y = damp(d.group.position.y, h, 16, dt);
        const targetYaw = Math.atan2(-dx / len, -dz / len);
        d.yaw += clamp(shortestAngle(d.yaw, targetYaw), -5 * dt, 5 * dt);
        d.group.rotation.y = d.yaw;
        d.speedNow = damp(d.speedNow, speed, 8, dt);
        updateDinoVisual(d, dt);
      } else {
        d.speedNow = damp(d.speedNow, 0, 6, dt);
      }
    } else {
      d.speedNow = damp(d.speedNow, 0, 6, dt);
      d.yaw += clamp(shortestAngle(d.yaw, p.yaw), -2.4 * dt, 2.4 * dt);
      d.group.rotation.y = d.yaw;
      updateDinoVisual(d, dt);
    }
    p.pos.set(d.group.position.x, d.group.position.y + 2.1, d.group.position.z);
    p.yaw = p.yaw;
    p.moving = wantsMove;
    // stamina still drains a little while riding
    if (wantsMove) p.stamina = Math.max(0, p.stamina - 4 * dt);
    return;
  }

  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  let dx = fx * (-iy) + rx * ix;
  let dz = fz * (-iy) + rz * ix;
  const dl = Math.hypot(dx, dz);
  if (dl > 0.001) { dx /= dl; dz /= dl; }
  p.moving = wantsMove && dl > 0.001;

  if (p.moving) {
    let nx = p.pos.x + dx * speed * dt;
    let nz = p.pos.z + dz * speed * dt;
    // island edge / deep water
    const nh = heightAt(nx, nz);
    if (nh < -0.45) {
      state.deepWater = (state.deepWater || 0) + dt;
      if (state.deepWater > 1.4) { toast('A água é profunda demais. Volte para a costa.', 'warn', 'water'); state.deepWater = 0; }
      nx = p.pos.x; nz = p.pos.z;
    }
    // collider pushout
    for (const c of colliders) {
      if (c.r < 0) continue;
      const ddx = nx - c.x, ddz = nz - c.z;
      const dd = Math.hypot(ddx, ddz);
      const min = c.r + 0.35;
      if (dd < min && dd > 0.001) {
        nx = c.x + ddx / dd * min;
        nz = c.z + ddz / dd * min;
      }
    }
    const gh = heightAt(nx, nz);
    if (gh > -0.45) {
      p.pos.x = nx; p.pos.z = nz;
      if (!p.grounded) p.pos.y = Math.max(p.pos.y, gh);
    }
    if (sprinting) {
      p.stamina = Math.max(0, p.stamina - 19 * dt);
    }
    // footsteps
    p.walkT += dt * (sprinting ? 10 : 6.4);
    if (p.walkT > (sprinting ? 2.1 : 2.7)) {
      p.walkT = 0;
      const gh2 = heightAt(p.pos.x, p.pos.z);
      if (gh2 > -0.1) {
        sfx('step', 0.4);
        burst(p.pos.x, gh2 + 0.05, p.pos.z, gh2 < 1.4 ? 0xc9b78c : 0x7d8c52, 3, 0.5, 0.8, 3);
      }
    }
  } else {
    p.walkT = damp(p.walkT, 0, 4, dt);
  }

  // jump / gravity
  const ground = heightAt(p.pos.x, p.pos.z);
  if (p.grounded) {
    p.pos.y = damp(p.pos.y, ground, 22, dt);
    if (p.pos.y < ground + 0.02) p.pos.y = ground;
    if (state.jumpQueued) {
      p.vy = 5.6; p.grounded = false; state.jumpQueued = false;
      p.stamina = Math.max(0, p.stamina - 8);
      sfx('step', 0.5);
    }
  } else {
    p.vy -= 17 * dt;
    p.pos.y += p.vy * dt;
    if (p.pos.y <= ground) { p.pos.y = ground; p.vy = 0; p.grounded = true; }
  }

  // stamina regen
  if (!sprinting) p.stamina = Math.min(100, p.stamina + 13 * dt);
  if (!p.moving) p.stamina = Math.min(100, p.stamina + 4 * dt);

  // hunger / thirst / health
  p.food = Math.max(0, p.food - dt * 0.028);
  p.water = Math.max(0, p.water - dt * 0.04);
  if (p.food <= 0) p.health -= dt * 1.4;
  if (p.water <= 0) p.health -= dt * 1.8;
  if (state.elapsed - state.lastDamage > 9 && p.food > 15 && p.water > 15 && p.health < 120) {
    p.health = Math.min(100, p.health + dt * 0.7);
  }
  if (p.health <= 0 && !state.dead) die('A fome');

  // animation
  playerGroup.position.copy(p.pos);
  playerGroup.rotation.y = p.yaw;
  const moving = p.moving;
  const animSpeed = moving ? (sprinting ? 12 : 8.2) : 1.6;
  state.walkPhase = (state.walkPhase || 0) + dt * animSpeed;
  const swing = Math.sin(state.walkPhase);
  const amplitude = moving ? (sprinting ? 0.72 : 0.5) : 0.03;
  legGroups[0].rotation.x = swing * amplitude;
  legGroups[1].rotation.x = -swing * amplitude;
  armGroups[0].rotation.x = -swing * amplitude * 0.85;
  if (state.swing > 0) {
    state.swing = Math.max(0, state.swing - dt);
    const t = 1 - state.swing / 0.3;
    armGroups[1].rotation.x = -Math.sin(t * Math.PI) * 2.0;
    armGroups[1].rotation.z = Math.sin(t * Math.PI) * 0.35;
  } else {
    armGroups[1].rotation.x = damp(armGroups[1].rotation.x, moving ? swing * amplitude * 0.7 : 0.05, 12, dt);
    armGroups[1].rotation.z = damp(armGroups[1].rotation.z, 0, 10, dt);
  }
  torso.position.y = 1.22 + (moving ? Math.abs(Math.sin(state.walkPhase)) * 0.035 : Math.sin(state.elapsed * 1.4) * 0.008);
  head.position.y = 1.64 + (moving ? Math.abs(Math.sin(state.walkPhase)) * 0.035 : Math.sin(state.elapsed * 1.4) * 0.008);
  pack.position.y = 1.3 + (moving ? Math.abs(Math.sin(state.walkPhase)) * 0.035 : 0);
  if (playerGroup.userData.torch) {
    playerGroup.userData.torch.visible = true;
    playerGroup.userData.torchLight.intensity = state.time > 18.4 || state.time < 5.8 ? 7.5 : 2.2;
  }
}

// ============================================================
//  CAMERA / INPUT / TILT
// ============================================================
function updateCamera(dt) {
  if (state.cinematic || !state.started) {
    const t = state.elapsed * 0.032;
    const camX = 30 + Math.sin(t) * 2.6;
    const camZ = 96 + Math.cos(t * 0.7) * 2;
    camera.position.lerp(V3(camX, 4.6 + Math.sin(t * 0.6) * 0.3, camZ), 1 - Math.exp(-1.5 * dt));
    camera.lookAt(-18, camera.aspect < 0.85 ? 1.2 : 3.4, 88);
    sky.position.copy(camera.position);
    stars.position.copy(camera.position);
    return;
  }
  playerGroup.visible = state.cameraMode === 0 && !state.dead && !state.mounted;
  viewModel.visible = state.cameraMode === 1 && !state.mounted && !state.dead;
  handAxe.visible = state.selected === 'axe';
  handSpear.visible = state.selected === 'spear';

  let pivot, maxDist;
  if (state.mounted) {
    pivot = V3(state.mounted.group.position.x, state.mounted.group.position.y + state.mounted.spec.labelY * 0.55, state.mounted.group.position.z);
    maxDist = 8.4;
  } else {
    pivot = V3(player.pos.x, player.pos.y + 1.52, player.pos.z);
    maxDist = state.cameraMode === 1 ? 0 : (camera.aspect < 0.85 ? 6.5 : 5.7);
  }
  const forward = V3(
    -Math.sin(player.yaw) * Math.cos(player.pitch),
    Math.sin(player.pitch),
    -Math.cos(player.yaw) * Math.cos(player.pitch)
  );
  const shake = state.shake > 0.001 ? V3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).multiplyScalar(state.shake * 0.22) : V3(0, 0, 0);
  state.shake = damp(state.shake, 0, 7, dt);

  if (state.cameraMode === 1 && !state.mounted) {
    const bob = player.moving ? Math.sin(state.walkPhase) * 0.025 : 0;
    camera.position.copy(V3(player.pos.x, player.pos.y + 1.68 + bob, player.pos.z));
    const target = camera.position.clone().add(forward);
    camera.lookAt(target);
    camera.position.add(shake);
    if (viewModel.userData.axe) {
      viewModel.userData.axe.rotation.z = damp(viewModel.userData.axe.rotation.z, state.swing > 0 ? Math.sin((1 - state.swing / 0.3) * Math.PI) * 0.6 : 0, 18, dt);
    }
    return;
  }

  let dist = maxDist;
  for (let i = 1; i <= 9; i++) {
    const t = i / 9;
    const px = pivot.x - forward.x * maxDist * t;
    const pz = pivot.z - forward.z * maxDist * t;
    const py = pivot.y - forward.y * maxDist * t;
    if (py < heightAt(px, pz) + 0.42) { dist = Math.max(1.2, maxDist * t - 0.5); break; }
  }
  const ideal = pivot.clone().addScaledVector(forward, -dist).add(shake);
  const minY = heightAt(ideal.x, ideal.z) + 0.4;
  if (ideal.y < minY) ideal.y = minY;
  camera.position.lerp(ideal, 1 - Math.exp(-11 * dt));
  camera.lookAt(pivot.clone().addScaledVector(forward, 3.2));
  sky.position.copy(camera.position);
  stars.position.copy(camera.position);
}

function updateLookFromTilt(dt) {
  if (!state.tiltActive || state.pointer.look) return;
  const dead = 3.2;
  const g = state.tiltRaw.gamma - state.tiltZero.gamma;
  const b = state.tiltRaw.beta - state.tiltZero.beta;
  if (Math.abs(g) > dead) player.yaw -= clamp(g / 26, -1, 1) * 1.15 * dt;
  if (Math.abs(b) > dead + 1) player.pitch -= clamp(b / 30, -1, 1) * 0.72 * dt;
  player.pitch = clamp(player.pitch, -1.05, 0.72);
}

function onTilt(e) {
  if (e.beta === null) return;
  state.tiltRaw.beta = e.beta || 0;
  state.tiltRaw.gamma = e.gamma || 0;
  state.tiltActive = true;
}
function calibrateTilt() {
  state.tiltZero.beta = state.tiltRaw.beta;
  state.tiltZero.gamma = state.tiltRaw.gamma;
  toast('Inclinação calibrada.', 'ok', 'tilt');
}
function syncTiltUI() {
  for (const id of ['tilt-toggle', 'tilt-toggle-pause']) {
    const el = $(id); if (el) el.checked = state.tilt;
  }
  for (const id of ['btn-calibrate', 'btn-calibrate-pause']) {
    const el = $(id); if (el) el.classList.toggle('hidden', !state.tilt);
  }
}
async function setTilt(enabled) {
  if (state.tilt && enabled) { syncTiltUI(); return; }
  if (!enabled) {
    state.tilt = false; state.tiltActive = false;
    window.removeEventListener('deviceorientation', onTilt);
    syncTiltUI();
    saveSettings();
    return;
  }
  if (!('DeviceOrientationEvent' in window)) {
    toast('Este dispositivo não tem acelerômetro disponível.', 'bad', 'tilt');
    state.tilt = false; syncTiltUI(); return;
  }
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== 'granted') {
        toast('Permissão de movimento negada. A inclinação continua desligada.', 'warn', 'tilt');
        state.tilt = false; syncTiltUI(); return;
      }
    }
    state.tilt = true;
    window.addEventListener('deviceorientation', onTilt);
    syncTiltUI();
    setTimeout(calibrateTilt, 550);
    toast('Inclinação ativada. Incline para olhar.', 'ok', 'tilt');
    saveSettings();
  } catch (err) {
    toast('Não foi possível acessar o acelerômetro.', 'bad', 'tilt');
    state.tilt = false; syncTiltUI();
  }
}
function saveSettings() {
  try { localStorage.setItem('primal-settings', JSON.stringify({ tilt: $('tilt-toggle').checked, sound: state.audioOn })); } catch (e) { }
}
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('primal-settings') || '{}');
    if (s.sound === false) { state.audioOn = false; $('btn-sound').classList.add('off'); }
    if (s.tilt) $('tilt-toggle').checked = true;
  } catch (e) { }
}

// joystick
const joystickEl = $('joystick');
const knobEl = $('joystick-knob');
let joyId = null;
function joyMove(e) {
  const rect = joystickEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  let dx = e.clientX - cx, dy = e.clientY - cy;
  const max = rect.width * 0.34;
  const len = Math.hypot(dx, dy);
  if (len > max) { dx = dx / len * max; dy = dy / len * max; }
  knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  state.joystick.x = dx / max;
  state.joystick.y = dy / max;
}
joystickEl.addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  joyId = e.pointerId;
  try { joystickEl.setPointerCapture(joyId); } catch (err) { }
  joystickEl.classList.add('active');
  state.joystick.active = true;
  joyMove(e);
});
joystickEl.addEventListener('pointermove', e => {
  if (e.pointerId !== joyId) return;
  e.preventDefault();
  joyMove(e);
});
function joyEnd(e) {
  if (joyId !== null && e.pointerId !== joyId) return;
  joyId = null;
  joystickEl.classList.remove('active');
  state.joystick.active = false;
  state.joystick.x = 0; state.joystick.y = 0;
  knobEl.style.transform = '';
}
joystickEl.addEventListener('pointerup', joyEnd);
joystickEl.addEventListener('pointercancel', joyEnd);
joystickEl.addEventListener('lostpointercapture', joyEnd);

// look drag
let lookId = null;
canvas.addEventListener('pointerdown', e => {
  if (!state.playing || state.dead) return;
  if (e.pointerType === 'mouse' && !document.pointerLockElement) {
    canvas.requestPointerLock?.();
    return;
  }
  if (lookId !== null) return;
  lookId = e.pointerId;
  state.pointer.look = true;
  state.pointer.x = e.clientX; state.pointer.y = e.clientY;
  try { canvas.setPointerCapture?.(e.pointerId); } catch (err) { }
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerId !== lookId || !state.pointer.look) return;
  const dx = e.clientX - state.pointer.x;
  const dy = e.clientY - state.pointer.y;
  state.pointer.x = e.clientX; state.pointer.y = e.clientY;
  player.yaw -= dx * 0.0046;
  player.pitch = clamp(player.pitch - dy * 0.0038, -1.05, 0.72);
});
function lookEnd(e) {
  if (e.pointerId !== lookId) return;
  lookId = null;
  state.pointer.look = false;
}
canvas.addEventListener('pointerup', lookEnd);
canvas.addEventListener('pointercancel', lookEnd);
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement === canvas) {
    player.yaw -= e.movementX * 0.0023;
    player.pitch = clamp(player.pitch - e.movementY * 0.002, -1.05, 0.72);
  }
});
canvas.addEventListener('mousedown', e => {
  if (document.pointerLockElement === canvas && e.button === 0) doAction();
});

// keyboard
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  state.key[k] = true;
  if (k === 'escape') {
    if (!panel.classList.contains('hidden')) closePanel();
    else if (!state.dead) togglePause();
    document.exitPointerLock?.();
    return;
  }
  if (!state.started) {
    if (k === 'enter' || k === ' ') startGame();
    return;
  }
  if (state.dead) {
    if (k === 'enter' || k === ' ') respawn();
    return;
  }
  if (k === ' ') { e.preventDefault(); if (!state.mounted) state.jumpQueued = true; }
  if (k === 'e') doAction();
  if (k === 'i' || k === 'tab') { e.preventDefault(); panel.classList.contains('hidden') ? openPanel('all') : closePanel(); }
  if (k === 'c') { panel.classList.contains('hidden') ? openPanel('craft') : closePanel(); }
  if (k === 'v') toggleCamera();
  if (k === 'shift') state.sprint = true;
  if (k === '1') selectSlot('axe');
  if (k === '2') selectSlot('spear');
  if (k === '3') selectSlot('berries');
  if (k === '4') selectSlot('cookedMeat');
});
addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  state.key[k] = false;
  if (k === 'shift') state.sprint = false;
});

function toggleCamera() {
  state.cameraMode = state.cameraMode === 0 ? 1 : 0;
  toast(state.cameraMode === 0 ? 'Câmera em 3ª pessoa' : 'Câmera em 1ª pessoa', 'ok', 'camera');
  $('btn-camera').classList.toggle('on', state.cameraMode === 1);
  updateHotbar();
}
function togglePause() {
  if (state.dead) return;
  if (state.paused) {
    state.paused = false;
    $('pause').classList.add('hidden');
  } else {
    state.paused = true;
    state.panelOpen = false;
    panel.classList.add('hidden');
    $('pause-day').textContent = 'DIA ' + state.day;
    $('pause-level').textContent = 'NV ' + player.level;
    $('pause-kills').textContent = state.kills;
    $('pause').classList.remove('hidden');
    document.exitPointerLock?.();
  }
}

// UI buttons
$('btn-play').addEventListener('click', () => startGame());
$('btn-calibrate').addEventListener('click', e => { e.stopPropagation(); calibrateTilt(); });
$('btn-calibrate-pause').addEventListener('click', e => { e.stopPropagation(); calibrateTilt(); });
$('tilt-toggle').addEventListener('change', e => { setTilt(e.target.checked); });
$('tilt-toggle-pause').addEventListener('change', e => { setTilt(e.target.checked); });
$('btn-sound').addEventListener('click', () => {
  state.audioOn = !state.audioOn;
  if (masterGain) masterGain.gain.value = state.audioOn ? 0.5 : 0;
  $('btn-sound').classList.toggle('off', !state.audioOn);
  $('btn-sound').querySelector('use').setAttribute('href', state.audioOn ? '#i-sound' : '#i-muted');
  toast(state.audioOn ? 'Som ativado' : 'Som silenciado', 'ok', state.audioOn ? 'sound' : 'muted');
  saveSettings();
});
$('btn-settings').addEventListener('click', togglePause);
$('btn-close-panel').addEventListener('click', closePanel);
$('btn-bag').addEventListener('click', () => openPanel('all'));
$('btn-craft').addEventListener('click', () => openPanel('craft'));
$('btn-resume').addEventListener('click', togglePause);
$('btn-restart').addEventListener('click', () => location.reload());
$('btn-respawn').addEventListener('click', respawn);
$('btn-action').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); doAction(); });
$('btn-jump').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (state.started && !state.paused && !state.mounted) state.jumpQueued = true; });
$('btn-sprint').addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  state.sprint = !state.sprint;
  $('btn-sprint').classList.toggle('on', state.sprint);
});
$('btn-camera').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (state.started) toggleCamera(); });
panel.addEventListener('click', e => { if (e.target === panel) closePanel(); });
$('pause').addEventListener('click', e => { if (e.target === $('pause')) togglePause(); });
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
recipeList.addEventListener('click', e => {
  const btn = e.target.closest('[data-craft]');
  if (!btn) return;
  const recipe = RECIPES.find(r => r.id === btn.dataset.craft);
  if (recipe) craftRecipe(recipe);
});
slotEls.forEach(el => el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); selectSlot(el.dataset.item); }));

// ============================================================
//  HUD
// ============================================================
let toastId = 0;
function iconSvg(id) { return `<svg class="icon"><use href="#i-${id}"/></svg>`; }
function toast(text, type = 'ok', icon = 'bolt') {
  const wrap = $('toasts');
  while (wrap.children.length >= 3) wrap.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'warn' ? 'warn' : type === 'bad' ? 'bad' : '');
  el.innerHTML = iconSvg(icon) + `<span>${text}</span>`;
  wrap.appendChild(el);
  const my = ++toastId;
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 3000);
  return my;
}

function updateVitals() {
  const set = (id, v) => { const el = $(id); if (el) el.style.width = clamp(v, 0, 100) + '%'; };
  set('b-health', player.health);
  set('b-stamina', player.stamina);
  set('b-food', player.food);
  set('b-water', player.water);
  $('v-health').textContent = Math.ceil(player.health);
  $('v-stamina').textContent = Math.ceil(player.stamina);
  $('v-food').textContent = Math.ceil(player.food);
  $('v-water').textContent = Math.ceil(player.water);
  $('level-label').textContent = player.level;
  $('b-xp').style.width = clamp(player.xp / xpNeeded() * 100, 0, 100) + '%';
  $('xp-label').textContent = `${Math.floor(player.xp)} / ${xpNeeded()} XP`;
  $('day-label').textContent = 'DIA ' + state.day;
  const hh = Math.floor(state.time).toString().padStart(2, '0');
  const mm = Math.floor((state.time % 1) * 60).toString().padStart(2, '0');
  $('clock-time').textContent = hh + ':' + mm;
  const altitude = heightAt(player.pos.x, player.pos.z);
  const temp = Math.round(29 - Math.max(0, altitude - 2) * 0.32 - (state.time < 6 || state.time > 18.5 ? 8 : 0));
  $('clock-temp').textContent = temp + '°C';
  let region = 'PRAIA SUL';
  if (player.pos.z < -20) region = altitude > 14 ? 'MONTANHA NORTE' : 'VALE NORTE';
  else if (player.pos.z < 20) region = 'PLANÍCIE CENTRAL';
  else if (Math.abs(player.pos.x) > 55) region = player.pos.x > 0 ? 'COSTA LESTE' : 'COSTA OESTE';
  else if (altitude > 5) region = 'COLINAS';
  $('clock-region').textContent = region;
  $('coords').textContent = `${Math.round(player.pos.x).toString().padStart(2, '0')} · ${Math.round(player.pos.z).toString().padStart(2, '0')}`;
}
function updateQuest() {
  const quests = [
    { text: 'Colete 10 de madeira', target: 10, prog: () => state.gathered.wood, reward: 30 },
    { text: 'Crie uma lança de pedra', target: 1, prog: () => state.crafted.spear ? 1 : 0, reward: 40 },
    { text: 'Domestique um dinossauro', target: 1, prog: () => state.tamed, reward: 60 },
    { text: 'Acenda uma fogueira', target: 1, prog: () => state.campfires.length, reward: 50 },
    { text: 'Abata um predador', target: 1, prog: () => state.kills, reward: 80 },
    { text: 'Sobreviva e explore o norte', target: 1, prog: () => 0, reward: 0, final: true },
  ];
  while (state.quest < quests.length) {
    const q = quests[state.quest];
    if (q.final) break;
    if (q.prog() >= q.target) {
      toast('OBJETIVO CONCLUÍDO: ' + q.text, 'ok', 'bolt');
      state.quest++;
      addXP(q.reward);
    } else break;
  }
  const q = quests[Math.min(state.quest, quests.length - 1)];
  $('objective-text').textContent = q.text;
  $('objective-progress').textContent = q.final ? '∞' : `${Math.min(q.prog(), q.target)}/${q.target}`;
}

const mapBase = document.createElement('canvas');
mapBase.width = 224; mapBase.height = 224;
{
  const ctx = mapBase.getContext('2d');
  const img = ctx.createImageData(224, 224);
  const sand = [208, 190, 143], grass = [93, 124, 58], dark = [61, 88, 48], rock = [115, 109, 95], deep = [12, 54, 66], shore = [48, 123, 116];
  for (let py = 0; py < 224; py++) {
    for (let px = 0; px < 224; px++) {
      const x = -HALF + (px / 224) * WORLD;
      const z = -HALF + (py / 224) * WORLD;
      const h = heightAt(x, z);
      let c;
      if (h < -2.5) c = deep;
      else if (h < -0.1) c = shore;
      else if (h < 1.8) c = sand;
      else if (h < 16) c = grass;
      else if (h < 22) c = dark;
      else c = rock;
      const i = (py * 224 + px) * 4;
      const n = fbm(x * 0.2, z * 0.2, 2) * 0.18 + 0.91;
      img.data[i] = c[0] * n; img.data[i + 1] = c[1] * n; img.data[i + 2] = c[2] * n; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
const minimap = $('minimap');
const mapCtx = minimap.getContext('2d');
let mapPulse = 0;
function drawMinimap(dt) {
  mapPulse += dt;
  const W = 224;
  mapCtx.clearRect(0, 0, W, W);
  mapCtx.save();
  mapCtx.beginPath(); mapCtx.arc(W / 2, W / 2, W / 2 - 2, 0, TAU); mapCtx.clip();
  mapCtx.drawImage(mapBase, 0, 0);
  const g = mapCtx.createRadialGradient(W / 2, W / 2, W * 0.24, W / 2, W / 2, W * 0.52);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.5)');
  mapCtx.fillStyle = g; mapCtx.fillRect(0, 0, W, W);
  const toMap = (x, z) => [(x + HALF) / WORLD * W, (z + HALF) / WORLD * W];
  // campfires
  for (const c of state.campfires) {
    const [mx, my] = toMap(c.x, c.z);
    mapCtx.beginPath(); mapCtx.arc(mx, my, 4.5, 0, TAU); mapCtx.fillStyle = '#ffb44e'; mapCtx.fill();
    mapCtx.beginPath(); mapCtx.arc(mx, my, 8 + Math.sin(mapPulse * 2) * 2, 0, TAU); mapCtx.strokeStyle = 'rgba(255,180,78,.35)'; mapCtx.stroke();
  }
  for (const d of dinos) {
    if (d.dead) continue;
    const [mx, my] = toMap(d.group.position.x, d.group.position.z);
    mapCtx.beginPath();
    mapCtx.arc(mx, my, d.kind === 'rex' ? 4 : d.kind === 'dodo' ? 1.6 : 2.6, 0, TAU);
    mapCtx.fillStyle = d.tamed ? '#5ff2d0' : d.spec.aggro > 0 ? '#ff6b5c' : '#e6d56b';
    mapCtx.fill();
  }
  const [px, py] = toMap(player.pos.x, player.pos.z);
  mapCtx.save();
  mapCtx.translate(px, py);
  mapCtx.rotate(-player.yaw);
  mapCtx.beginPath(); mapCtx.moveTo(0, -10); mapCtx.lineTo(6, 7); mapCtx.lineTo(0, 4); mapCtx.lineTo(-6, 7); mapCtx.closePath();
  mapCtx.fillStyle = '#f2fffa'; mapCtx.shadowColor = '#5ff2d0'; mapCtx.shadowBlur = 10; mapCtx.fill();
  mapCtx.restore();
  mapCtx.beginPath(); mapCtx.arc(px, py, 12 + Math.sin(mapPulse * 2.4) * 3, 0, TAU);
  mapCtx.strokeStyle = 'rgba(95,242,208,.35)'; mapCtx.lineWidth = 1.5; mapCtx.stroke();
  mapCtx.restore();
}

let lastContextKey = '';
let lastPrompt = '';
function updateContextUI() {
  state.context = computeContext();
  const c = state.context;
  const label = c.label;
  if (label !== lastPrompt) {
    $('action-label').textContent = label;
    $('action-icon').querySelector('use').setAttribute('href', '#i-' + c.icon);
    lastPrompt = label;
  }
  $('btn-action').classList.toggle('pulse', c.type === 'tame' || c.type === 'mount');
  const prompt = $('prompt');
  if (state.playing && c.text && c.type !== 'swing' && !state.mounted) {
    prompt.classList.remove('hidden');
    $('prompt-text').textContent = c.text;
    $('prompt-key').textContent = 'AÇÃO';
  } else if (state.mounted) {
    prompt.classList.remove('hidden');
    $('prompt-text').textContent = 'Descer da montaria';
    $('prompt-key').textContent = 'AÇÃO';
  } else {
    prompt.classList.add('hidden');
  }
  // target panel
  let target = null, bd = 18 * 18;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  for (const d of dinos) {
    if (d.dead) continue;
    const dd = dist2(player.pos.x, player.pos.z, d.group.position.x, d.group.position.z);
    if (dd > bd) continue;
    const len = Math.sqrt(dd) || 1;
    const dot = (d.group.position.x - player.pos.x) / len * fx + (d.group.position.z - player.pos.z) / len * fz;
    if (dot < 0.15) continue;
    bd = dd; target = d;
  }
  state.target = target;
  const tp = $('target-panel');
  if (target) {
    tp.classList.remove('hidden');
    $('target-name').textContent = target.tamed ? (target.tamedName || target.spec.name) + ' · DOMADO' : target.spec.name;
    $('target-level').textContent = 'NV ' + target.level;
    $('target-fill').style.width = clamp(target.hp / target.maxHp * 100, 0, 100) + '%';
    $('target-sub').textContent = (target.tamed ? 'ALIADO' : target.spec.diet) + ' · ' + (target.tamed ? 'SEGUE VOCÊ' : target.spec.temper);
  } else {
    tp.classList.add('hidden');
  }
}

function updateHUD(dt) {
  state.uiT += dt;
  if (state.uiT > 0.14) {
    state.uiT = 0;
    updateVitals();
    updateQuest();
    updateContextUI();
    updateDinoLabels();
  }
  state.mapT += dt;
  if (state.mapT > 0.1) { state.mapT = 0; drawMinimap(dt * 7); }
}

// ============================================================
//  MAIN LOOP
// ============================================================
let lastTime = performance.now();
let startedAt = 0;
function startGame() {
  if (state.started) return;
  state.started = true;
  state.playing = true;
  state.cinematic = false;
  document.body.classList.add('playing');
  initAudio();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  if ($('tilt-toggle').checked && !state.tilt) setTilt(true);
  toast('Bem-vindo à Primal Isle. Colete madeira para começar.', 'ok', 'paw');
  setTimeout(() => toast('Dica: frutas saciam fome e sede.', 'ok', 'berry'), 4200);
  updateVitals();
  updateQuest();
  startedAt = performance.now();
  // snap the camera close to the player's shoulder immediately
  const forward = V3(-Math.sin(player.yaw), 0.13, -Math.cos(player.yaw));
  camera.position.set(player.pos.x - forward.x * 5.1, player.pos.y + 2.15, player.pos.z - forward.z * 5.1);
  camera.lookAt(player.pos.x, player.pos.y + 1.55, player.pos.z);
}

function frame(now) {
  const dt = Math.min(0.05, Math.max(0.0001, (now - lastTime) / 1000));
  lastTime = now;
  state.elapsed += dt;

  if (!state.paused) {
    updateSky(dt);
    updateBirds(state.elapsed);
    updateLookFromTilt(dt);
    updatePlayer(dt);
    updateDinos(dt);
    updateResources(dt);
    updateParticles(dt);
    updateCampfires(dt);
    if (playerGroup.userData.torchLight) {
      playerGroup.userData.torchLight.intensity = (state.time > 18.4 || state.time < 5.8) ? 8 : 2.2;
    }
  }
  waterUniforms.uTime.value = state.elapsed;
  waterUniforms.uSunDir.value.copy(sunDir);
  waterUniforms.uSunColor.value.copy(sun.color);
  waterUniforms.uHorizon.value.copy(scene.fog.color);
  waterUniforms.uNight.value = clamp(1 - smoothstep(-0.1, 0.25, sunDir.y), 0, 1);
  updateCamera(dt);
  updateHUD(dt);
  if (state.started) {
    const p = player;
    $('btn-action').classList.toggle('disabled', state.dead);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function updateCampfires(dt) {
  for (const c of state.campfires) {
    c.t += dt;
    const flick = 0.86 + Math.sin(c.t * 17) * 0.08 + Math.sin(c.t * 31) * 0.05;
    c.light.intensity = 15 * flick;
    c.flame.children.forEach((f, i) => {
      f.scale.y = 0.8 + Math.sin(c.t * (7 + i) + i) * 0.18;
      f.scale.x = 0.9 + Math.cos(c.t * (9 + i)) * 0.1;
      f.rotation.y += dt * (0.6 + i * 0.2);
    });
    if (Math.random() < dt * 8) {
      const p = particles[particleCursor++ % MAX_PARTICLES];
      p.life = rr(0.6, 1.3); p.max = p.life;
      p.x = c.x + rr(-0.2, 0.2); p.y = c.y + 0.5; p.z = c.z + rr(-0.2, 0.2);
      p.vx = rr(-0.2, 0.2); p.vy = rr(0.8, 1.8); p.vz = rr(-0.2, 0.2);
      p.r = 1; p.g = rr(0.4, 0.75); p.b = 0.16; p.gravity = -0.2; p.size = 1;
    }
  }
}

function fitCamera() {
  const aspect = innerWidth / innerHeight;
  camera.aspect = aspect;
  // portrait screens get a wider vertical FOV so the coast and horizon stay in frame
  camera.fov = aspect < 0.85 ? 76 : 62;
  camera.updateProjectionMatrix();
}

function resize() {
  fitCamera();
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isSmall ? 1.65 : 1.9));
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 250));

// restore light settings + first HUD paint
loadSettings();
fitCamera();
$('btn-sound').querySelector('use').setAttribute('href', state.audioOn ? '#i-sound' : '#i-muted');
updateHotbar();
updateVitals();
updateQuest();
renderInventory();
renderRecipes();
updateContextUI();

// debug handle
window.__primal = { state, player, heightAt, slopeAt, dinos, resources, camera, scene, renderer, spawnPoint };

// small pre-game cinematic bob
requestAnimationFrame(frame);

