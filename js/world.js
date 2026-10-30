/* ============================================================
   PRIMAL ISLE — procedural island, sky, foliage, landmarks
   ============================================================ */
(function () {
  'use strict';
  const U = window.U;
  const T = THREE;

  const COL = {
    sand: 0xd8bd82,
    sandWet: 0xb99f6d,
    grass: 0x5b8a3e,
    grassDark: 0x3f6b33,
    rock: 0x79766c,
    rockDark: 0x565750,
    underwater: 0x3c5b52,
    trunk: 0x7d5a35,
    trunkDark: 0x5b3f27,
    leaf: 0x4d8f45,
    leafDark: 0x2f6b35,
    bush: 0x3d6d36,
    berry: 0xd44a4a,
    flint: 0x8e8a7d,
  };

  function lin(hex) {
    return new T.Color(hex).convertSRGBToLinear();
  }
  function lambert(color, extra) {
    const opts = Object.assign({ color: lin(color) }, extra || {});
    if (opts.emissive != null) opts.emissive = lin(opts.emissive);
    return new T.MeshLambertMaterial(opts);
  }
  function flat(color, extra) {
    const opts = Object.assign({ color: lin(color), flatShading: true }, extra || {});
    if (opts.emissive != null) opts.emissive = lin(opts.emissive);
    return new T.MeshLambertMaterial(opts);
  }
  function basic(color, extra) {
    return new T.MeshBasicMaterial(Object.assign({ color: color }, extra || {}));
  }

  function mergeGeometries(geoms) {
    const list = geoms.map((g) => (g.index ? g.toNonIndexed() : g));
    let total = 0;
    for (const g of list) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3);
    const norm = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    let offset = 0;
    for (const g of list) {
      const count = g.attributes.position.count;
      pos.set(g.attributes.position.array, offset * 3);
      norm.set(g.attributes.normal.array, offset * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, offset * 2);
      offset += count;
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(norm, 3));
    out.setAttribute('uv', new T.BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    return out;
  }

  function palmCrownGeometry() {
    const geos = [];
    for (let i = 0; i < 9; i++) {
      const g = new T.ConeGeometry(0.52, 3.1, 4, 1, false);
      g.translate(0, 1.55, 0);
      g.rotateZ(-(Math.PI / 2 - 0.18 + (i % 3) * 0.1));
      g.rotateY((i / 9) * Math.PI * 2 + (i % 2) * 0.19);
      g.translate(0, 5.0, 0);
      geos.push(g);
    }
    const lower = new T.ConeGeometry(0.38, 2.2, 4, 1, false);
    lower.translate(0, 1.1, 0);
    lower.rotateZ(-(Math.PI / 2 + 0.4));
    lower.rotateY(0.7);
    lower.translate(0, 4.55, 0);
    geos.push(lower);
    return mergeGeometries(geos);
  }

  function berryBushGeometry() {
    const geos = [];
    const base = new T.IcosahedronGeometry(0.92, 1);
    base.scale(1.15, 0.82, 1.05);
    geos.push(base);
    const rng = U.mulberry32(7781);
    for (let i = 0; i < 9; i++) {
      const s = new T.SphereGeometry(0.07 + rng() * 0.05, 5, 4);
      const a = rng() * Math.PI * 2;
      const p = 0.55 + rng() * 0.4;
      s.translate(Math.cos(a) * Math.sin(p) * 1.02, 0.28 + Math.cos(p) * 0.55, Math.sin(a) * Math.sin(p) * 0.95);
      geos.push(s);
    }
    return mergeGeometries(geos);
  }

  function berryBushBerryGeometry() {
    const geos = [];
    const rng = U.mulberry32(7781);
    const base = new T.IcosahedronGeometry(0.92, 1);
    base.scale(1.15, 0.82, 1.05);
    geos.push(base);
    for (let i = 0; i < 9; i++) {
      const s = new T.IcosahedronGeometry(0.09 + rng() * 0.045, 0);
      const a = rng() * Math.PI * 2;
      const p = 0.55 + rng() * 0.4;
      s.translate(Math.cos(a) * Math.sin(p) * 1.05, 0.3 + Math.cos(p) * 0.57, Math.sin(a) * Math.sin(p) * 1.0);
      geos.push(s);
    }
    return mergeGeometries(geos);
  }

  function grassGeometry() {
    const pos = [];
    const rng = U.mulberry32(419);
    for (let i = 0; i < 9; i++) {
      const a = rng() * Math.PI * 2;
      const h = 0.35 + rng() * 0.55;
      const w = 0.045 + rng() * 0.035;
      const dx = Math.cos(a) * 0.16;
      const dz = Math.sin(a) * 0.16;
      pos.push(-w, 0, 0, w, 0, 0, dx, h, dz);
      pos.push(-w, 0, 0, dx, h * 0.75, dz * 0.7, 0, h * 0.45, 0);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    const normals = new Float32Array(pos.length);
    for (let i = 0; i < normals.length; i += 3) {
      normals[i] = 0;
      normals[i + 1] = 1;
      normals[i + 2] = 0;
    }
    g.setAttribute('normal', new T.BufferAttribute(normals, 3));
    g.computeBoundingSphere();
    return g;
  }

  class World {
    constructor(scene, seed) {
      this.scene = scene;
      this.seed = (seed >>> 0) || 1337;
      this.rng = U.mulberry32(this.seed);
      this.noise = new Noise(this.seed);
      this.coastNoise = new Noise(this.seed + 911);
      this.detailNoise = new Noise(this.seed + 277);
      this.group = new T.Group();
      this.group.name = 'world';
      scene.add(this.group);
      this.nodes = [];
      this.colliders = [];
      this.campfires = [];
      this.crates = [];
      this.elapsed = 0;
      this.dayTime = 0.34;
      this.dayFactor = 1;
      this.sunDir = new T.Vector3(0.5, 0.8, 0.2).normalize();
      this.tmpMatrix = new T.Matrix4();
      this.tmpQuat = new T.Quaternion();
      this.tmpEuler = new T.Euler();
      this.tmpScale = new T.Vector3();

      this.spawn = this.findSpawn();
      this.buildLights();
      this.buildSky();
      this.buildTerrain();
      this.buildWater();
      this.buildTrees();
      this.buildRocks();
      this.buildBushes();
      this.buildGrass();
      this.buildClouds();
      this.buildBirds();
      this.buildFireflies();
      this.buildObelisk();
      this.buildCrates();
      this.buildMap();
      this.setDayTime(0.34);
      this.update(0, 0, null);
    }

    /* ------------------------- terrain ------------------------- */
    coastScale(x, z) {
      const a = Math.atan2(z, x);
      return 1 + (this.coastNoise.fbm(Math.cos(a) * 1.8 + 5.3, Math.sin(a) * 1.8 + 2.1, 3) - 0.5) * 0.26;
    }

    heightAt(x, z) {
      const d = Math.hypot(x, z);
      const t = Math.min(1, d / (166 * this.coastScale(x, z)));
      const fall = 1 - U.smoothstep(0.54, 0.995, t);
      const ridge = this.noise.fbm(x * 0.0062 + 3.1, z * 0.0062 + 7.7, 4);
      const detail = this.detailNoise.fbm(x * 0.028 + 11, z * 0.028 + 5, 3);
      let h = 2.1 + fall * (6.5 + 22 * ridge + 5.5 * detail) - 9.2 * U.smoothstep(0.58, 1.0, t);
      const cd = Math.hypot(x, z);
      if (cd < 20) {
        const plateau = this.noise.fbm(1.2, 2.4, 2) * 2.6;
        h = U.lerp(h, h * 0.55 + plateau + 10.5, U.smoothstep(22, 8, cd));
      }
      return h;
    }

    slopeAt(x, z) {
      const e = 0.65;
      const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
      const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
      return Math.hypot(dx, dz);
    }

    findSpawn() {
      const candidates = [0.5, 0.9, 1.7, 2.4, 3.0, 3.8, 4.6, 5.3];
      for (const a of candidates) {
        let r = 90;
        let coast = -1;
        for (; r < 170; r += 1) {
          const h = this.heightAt(Math.cos(a) * r, Math.sin(a) * r);
          if (h < 0.35) {
            coast = r;
            break;
          }
        }
        if (coast < 0) continue;
        let best = null;
        for (let rr = coast - 14; rr <= coast - 4; rr += 1) {
          const x = Math.cos(a) * rr;
          const z = Math.sin(a) * rr;
          const h = this.heightAt(x, z);
          const s = this.slopeAt(x, z);
          if (h > 0.9 && h < 3.6 && s < 0.55) {
            best = { x: x, z: z, y: h, r: rr, angle: a };
            if (h > 1.2 && h < 2.6) break;
          }
        }
        if (best) return best;
      }
      return { x: 0, z: 118, y: 2, r: 118, angle: Math.PI / 2 };
    }

    randomLandPoint(minR, maxR, minH, maxH, avoidSpawn) {
      minH = minH == null ? 1.6 : minH;
      maxH = maxH == null ? 16 : maxH;
      for (let i = 0; i < 90; i++) {
        const a = this.rng() * Math.PI * 2;
        const r = minR + this.rng() * (maxR - minR);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const h = this.heightAt(x, z);
        if (h < minH || h > maxH) continue;
        if (avoidSpawn && Math.hypot(x - this.spawn.x, z - this.spawn.z) < avoidSpawn) continue;
        return { x, z, y: h };
      }
      return { x: this.spawn.x, z: this.spawn.z, y: this.spawn.y };
    }

    /* -------------------------- lights ------------------------- */
    buildLights() {
      this.hemi = new T.HemisphereLight(0xbfe3ff, 0x3c3424, 0.8);
      this.group.add(this.hemi);
      this.sun = new T.DirectionalLight(0xffe6bc, 1.15);
      this.sun.position.set(60, 100, 30);
      this.group.add(this.sun);
      this.fill = new T.DirectionalLight(0x88aaff, 0.18);
      this.fill.position.set(-50, 40, -40);
      this.group.add(this.fill);
    }

    /* --------------------------- sky --------------------------- */
    buildSky() {
      this.skyUniforms = {
        uTop: { value: new T.Color(0x2d6fae) },
        uHorizon: { value: new T.Color(0xcfe7ee) },
        uSunColor: { value: new T.Color(0xffe7b0) },
        uSunDir: { value: new T.Vector3(0.5, 0.8, 0.2) },
        uCloudTint: { value: new T.Color(0xffffff) },
      };
      const skyMat = new T.ShaderMaterial({
        uniforms: this.skyUniforms,
        side: T.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: `
          varying vec3 vWorld;
          void main(){
            vec4 wp = modelMatrix * vec4(position,1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `
          uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunColor; uniform vec3 uSunDir;
          varying vec3 vWorld;
          void main(){
            vec3 dir = normalize(vWorld - cameraPosition);
            float h = clamp(dir.y, -0.12, 1.0);
            float grad = pow(clamp(h,0.0,1.0), 0.52);
            vec3 col = mix(uHorizon, uTop, grad);
            float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
            float disc = smoothstep(0.9986, 0.9995, sunDot);
            float glow = pow(sunDot, 18.0) * 0.34 + pow(sunDot, 200.0) * 0.9;
            col += uSunColor * glow;
            col = mix(col, uSunColor * 1.35, disc * 0.85);
            float horizon = 1.0 - smoothstep(-0.05, 0.18, h);
            col = mix(col, uHorizon * 0.72, horizon * 0.55);
            gl_FragColor = vec4(col, 1.0);
          }`,
      });
      this.sky = new T.Mesh(new T.SphereGeometry(390, 32, 20), skyMat);
      this.sky.renderOrder = -50;
      this.sky.frustumCulled = false;
      this.group.add(this.sky);

      this.skyGroup = new T.Group();
      this.group.add(this.skyGroup);

      // sun disc
      this.sunDisc = new T.Mesh(
        new T.SphereGeometry(7.5, 16, 12),
        basic(0xfff5d4, { toneMapped: false, fog: false, transparent: true, opacity: 0.96 })
      );
      this.sunDisc.renderOrder = -40;
      this.skyGroup.add(this.sunDisc);

      // moon
      this.moon = new T.Mesh(
        new T.SphereGeometry(4.2, 16, 12),
        basic(0xdfeaff, { toneMapped: false, fog: false, transparent: true, opacity: 0 })
      );
      this.moon.renderOrder = -40;
      this.skyGroup.add(this.moon);
      this.moonGlow = new T.Mesh(
        new T.SphereGeometry(9.5, 16, 12),
        basic(0x8fb5ff, { toneMapped: false, fog: false, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false })
      );
      this.skyGroup.add(this.moonGlow);

      // stars
      const starPos = [];
      const srng = U.mulberry32(this.seed + 55);
      for (let i = 0; i < 680; i++) {
        const a = srng() * Math.PI * 2;
        const y = srng() * 0.92 + 0.04;
        const rad = Math.sqrt(1 - y * y);
        const r = 345;
        starPos.push(Math.cos(a) * rad * r, y * r, Math.sin(a) * rad * r);
      }
      const starGeo = new T.BufferGeometry();
      starGeo.setAttribute('position', new T.Float32BufferAttribute(starPos, 3));
      this.starMat = new T.PointsMaterial({
        color: 0xe8f1ff,
        size: 2.1,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      });
      this.stars = new T.Points(starGeo, this.starMat);
      this.stars.renderOrder = -45;
      this.skyGroup.add(this.stars);
    }

    /* -------------------------- terrain ------------------------ */
    buildTerrain() {
      const size = 340;
      const seg = 148;
      const geo = new T.PlaneGeometry(size, size, seg, seg);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        pos.setY(i, this.heightAt(x, z));
      }
      geo.computeVertexNormals();
      const norm = geo.attributes.normal;
      const colors = new Float32Array(pos.count * 3);
      const cSand = new T.Color(COL.sand);
      const cWet = new T.Color(COL.sandWet);
      const cGrass = new T.Color(COL.grass);
      const cGrassDark = new T.Color(COL.grassDark);
      const cRock = new T.Color(COL.rock);
      const cRockDark = new T.Color(COL.rockDark);
      const cUnder = new T.Color(COL.underwater);
      const c = new T.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const y = pos.getY(i);
        const slope = 1 - norm.getY(i);
        const varn = this.detailNoise.fbm(x * 0.13, z * 0.13, 2);
        c.copy(cWet).lerp(cSand, U.smoothstep(-0.4, 1.4, y));
        c.lerp(cGrass, U.smoothstep(1.9, 3.6, y));
        c.lerp(cGrassDark, U.clamp(varn * 0.9 - 0.18, 0, 0.55));
        c.lerp(cRock, U.smoothstep(0.34, 0.7, slope));
        c.lerp(cRockDark, U.smoothstep(0.58, 0.95, slope) * 0.65);
        c.lerp(cRock, U.smoothstep(19.5, 25.5, y) * 0.8);
        c.lerp(cUnder, U.smoothstep(0.2, -4.5, y));
        c.convertSRGBToLinear();
        const shade = 0.88 + varn * 0.24;
        colors[i * 3] = c.r * shade;
        colors[i * 3 + 1] = c.g * shade;
        colors[i * 3 + 2] = c.b * shade;
      }
      geo.setAttribute('color', new T.BufferAttribute(colors, 3));
      const mat = new T.MeshLambertMaterial({ vertexColors: true });
      this.terrain = new T.Mesh(geo, mat);
      this.terrain.receiveShadow = false;
      this.group.add(this.terrain);
    }

    /* --------------------------- water ------------------------- */
    buildWater() {
      const geo = new T.PlaneGeometry(380, 380, 64, 64);
      geo.rotateX(-Math.PI / 2);
      this.waterUniforms = {
        uTime: { value: 0 },
        uDeep: { value: new T.Color(0x0b4256) },
        uShallow: { value: new T.Color(0x3c98a6) },
        uSunColor: { value: new T.Color(0xffe6b0) },
        uSunDir: { value: new T.Vector3(0.5, 0.8, 0.2) },
        uFogColor: { value: new T.Color(0xcfe7ee) },
        uFogNear: { value: 55 },
        uFogFar: { value: 260 },
      };
      const mat = new T.ShaderMaterial({
        uniforms: this.waterUniforms,
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        vertexShader: `
          uniform float uTime;
          varying vec3 vWorld;
          varying float vWave;
          void main(){
            vec3 p = position;
            float w1 = sin(p.x * 0.115 + uTime * 0.85) * 0.12;
            float w2 = sin(p.z * 0.085 - uTime * 0.66) * 0.16;
            float w3 = sin((p.x + p.z) * 0.042 + uTime * 0.48) * 0.22;
            p.y += w1 + w2 + w3;
            vWave = w1 + w2 + w3;
            vec4 wp = modelMatrix * vec4(p,1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `
          uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSunColor;
          uniform vec3 uSunDir; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
          varying vec3 vWorld; varying float vWave;
          void main(){
            vec3 viewDir = normalize(cameraPosition - vWorld);
            float fres = pow(1.0 - max(viewDir.y, 0.0), 2.4);
            vec3 col = mix(uDeep, uShallow, fres * 0.82 + 0.12);
            vec3 n = normalize(vec3(vWave * 2.2, 1.0, vWave * 1.6));
            float spec = pow(max(dot(reflect(-normalize(uSunDir), n), viewDir), 0.0), 90.0);
            col += uSunColor * spec * 0.55;
            float ripples = sin(vWorld.x * 1.3 + uTime * 1.7) * sin(vWorld.z * 1.1 - uTime * 1.3);
            col += ripples * 0.012;
            float dist = length(cameraPosition - vWorld);
            float fog = smoothstep(uFogNear, uFogFar, dist);
            col = mix(col, uFogColor, fog * 0.78);
            gl_FragColor = vec4(col, 0.88 - fog * 0.18);
          }`,
      });
      this.water = new T.Mesh(geo, mat);
      this.water.position.y = 0;
      this.water.renderOrder = 2;
      this.group.add(this.water);
    }

    /* --------------------------- trees ------------------------- */
    buildTrees() {
      const positions = [];
      const avoid = (x, z) => Math.hypot(x - this.spawn.x, z - this.spawn.z) < 8 || Math.hypot(x, z) < 13;
      for (let i = 0; i < 190 && positions.length < 118; i++) {
        const a = this.rng() * Math.PI * 2;
        const r = 20 + Math.sqrt(this.rng()) * 132;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const h = this.heightAt(x, z);
        if (h < 1.3 || h > 18.5) continue;
        if (this.slopeAt(x, z) > 0.82) continue;
        if (avoid(x, z)) continue;
        positions.push({ x, z, h });
      }
      // guaranteed palms near the spawn beach
      const inward = new T.Vector2(-this.spawn.x, -this.spawn.z).normalize();
      const perp = new T.Vector2(-inward.y, inward.x);
      for (let i = 0; i < 5; i++) {
        for (let tries = 0; tries < 12; tries++) {
          const d = 7 + this.rng() * 11;
          const side = (this.rng() - 0.5) * 24;
          const x = this.spawn.x + inward.x * d + perp.x * side;
          const z = this.spawn.z + inward.y * d + perp.y * side;
          const h = this.heightAt(x, z);
          if (h > 1.25 && h < 7 && this.slopeAt(x, z) < 0.8 && Math.hypot(x - this.spawn.x, z - this.spawn.z) > 5.5) {
            positions.push({ x, z, h });
            break;
          }
        }
      }

      const trunkGeo = new T.CylinderGeometry(0.17, 0.44, 5.1, 7, 1);
      trunkGeo.translate(0, 2.55, 0);
      const crownGeo = palmCrownGeometry();
      const trunkMat = flat(0xffffff);
      const crownMat = flat(0xffffff, { side: T.DoubleSide });
      const trunks = new T.InstancedMesh(trunkGeo, trunkMat, positions.length);
      const crowns = new T.InstancedMesh(crownGeo, crownMat, positions.length);
      trunks.frustumCulled = false;
      crowns.frustumCulled = false;
      const cTrunk = new T.Color();
      const cLeaf = new T.Color();
      const m = new T.Matrix4();
      const q = new T.Quaternion();
      const s = new T.Vector3();
      const p = new T.Vector3();
      const e = new T.Euler();
      positions.forEach((pnt, i) => {
        const scale = 0.75 + this.rng() * 0.65;
        e.set((this.rng() - 0.5) * 0.13, this.rng() * Math.PI * 2, (this.rng() - 0.5) * 0.13);
        q.setFromEuler(e);
        s.set(scale, scale * (0.9 + this.rng() * 0.3), scale);
        p.set(pnt.x, pnt.h - 0.15, pnt.z);
        m.compose(p, q, s);
        trunks.setMatrixAt(i, m);
        crowns.setMatrixAt(i, m);
        cTrunk.setHex(0x7a5632).multiplyScalar(0.78 + this.rng() * 0.34);
        cLeaf.setHex(0x4c8b43).multiplyScalar(0.75 + this.rng() * 0.4);
        if (this.rng() < 0.18) cLeaf.setHex(0x6d9c3c);
        cTrunk.convertSRGBToLinear();
        cLeaf.convertSRGBToLinear();
        trunks.setColorAt(i, cTrunk);
        crowns.setColorAt(i, cLeaf);
        const node = {
          type: 'tree',
          kind: 'tree',
          name: 'Palmeira',
          x: pnt.x,
          z: pnt.z,
          y: pnt.h,
          scale: scale,
          hp: 38,
          maxHp: 38,
          alive: true,
          respawn: 0,
          idx: i,
          mesh: trunks,
          extra: crowns,
          baseMatrix: m.clone(),
          radius: 0.55 * scale,
          height: 5.2 * scale,
        };
        this.nodes.push(node);
        this.colliders.push({ x: pnt.x, z: pnt.z, r: 0.42 * scale });
      });
      trunks.instanceMatrix.needsUpdate = true;
      crowns.instanceMatrix.needsUpdate = true;
      this.treesTrunk = trunks;
      this.treesCrown = crowns;
      this.group.add(trunks, crowns);
    }

    /* --------------------------- rocks ------------------------- */
    buildRocks() {
      const count = 58;
      const geo = new T.DodecahedronGeometry(1, 0);
      const mat = flat(0xffffff);
      const mesh = new T.InstancedMesh(geo, mat, count);
      mesh.frustumCulled = false;
      const m = new T.Matrix4();
      const q = new T.Quaternion();
      const s = new T.Vector3();
      const p = new T.Vector3();
      const e = new T.Euler();
      const c = new T.Color();
      let made = 0;
      for (let i = 0; i < 800 && made < count; i++) {
        const a = this.rng() * Math.PI * 2;
        const r = 16 + Math.sqrt(this.rng()) * 136;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const h = this.heightAt(x, z);
        if (h < 0.8 || h > 24) continue;
        if (Math.hypot(x - this.spawn.x, z - this.spawn.z) < 7) continue;
        if (Math.hypot(x, z) < 14) continue;
        const sc = 0.55 + this.rng() * 1.7;
        e.set(this.rng() * 0.6, this.rng() * Math.PI * 2, this.rng() * 0.6);
        q.setFromEuler(e);
        s.set(sc * (0.8 + this.rng() * 0.5), sc * (0.55 + this.rng() * 0.6), sc * (0.8 + this.rng() * 0.5));
        p.set(x, h + sc * 0.25, z);
        m.compose(p, q, s);
        mesh.setMatrixAt(made, m);
        c.setHex(0x7c7a70).multiplyScalar(0.62 + this.rng() * 0.45);
        c.convertSRGBToLinear();
        mesh.setColorAt(made, c);
        const node = {
          type: 'rock',
          kind: 'rock',
          name: 'Rocha',
          x,
          z,
          y: h,
          scale: sc,
          hp: 46,
          maxHp: 46,
          alive: true,
          respawn: 0,
          idx: made,
          mesh,
          baseMatrix: m.clone(),
          radius: sc * 0.8,
          height: sc * 0.9,
        };
        this.nodes.push(node);
        this.colliders.push({ x, z, r: sc * 0.85 });
        made++;
      }
      mesh.count = made;
      mesh.instanceMatrix.needsUpdate = true;
      this.rocks = mesh;
      this.group.add(mesh);
    }

    /* -------------------------- bushes ------------------------- */
    buildBushes() {
      const positions = [];
      const avoid = (x, z) => Math.hypot(x - this.spawn.x, z - this.spawn.z) < 6 || Math.hypot(x, z) < 10;
      for (let i = 0; i < 300 && positions.length < 82; i++) {
        const a = this.rng() * Math.PI * 2;
        const r = 14 + Math.sqrt(this.rng()) * 128;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const h = this.heightAt(x, z);
        if (h < 1.15 || h > 15.5) continue;
        if (this.slopeAt(x, z) > 0.95) continue;
        if (avoid(x, z)) continue;
        positions.push({ x, z, h });
      }
      const inward = new T.Vector2(-this.spawn.x, -this.spawn.z).normalize();
      const perp = new T.Vector2(-inward.y, inward.x);
      for (let i = 0; i < 4; i++) {
        for (let tries = 0; tries < 15; tries++) {
          const d = 6 + this.rng() * 14;
          const side = (this.rng() - 0.5) * 20;
          const x = this.spawn.x + inward.x * d + perp.x * side;
          const z = this.spawn.z + inward.y * d + perp.y * side;
          const h = this.heightAt(x, z);
          if (h > 1.1 && h < 8 && this.slopeAt(x, z) < 0.9 && Math.hypot(x - this.spawn.x, z - this.spawn.z) > 4.5) {
            positions.push({ x, z, h });
            break;
          }
        }
      }
      const bushGeo = berryBushGeometry();
      const berryGeo = berryBushBerryGeometry();
      const bushMat = flat(0xffffff, { side: T.DoubleSide });
      const berryMat = flat(0xffffff, { emissive: 0x200000 });
      const bushes = new T.InstancedMesh(bushGeo, bushMat, positions.length);
      const berries = new T.InstancedMesh(berryGeo, berryMat, positions.length);
      bushes.frustumCulled = false;
      berries.frustumCulled = false;
      const m = new T.Matrix4();
      const q = new T.Quaternion();
      const s = new T.Vector3();
      const p = new T.Vector3();
      const e = new T.Euler();
      positions.forEach((pnt, i) => {
        const sc = 0.75 + this.rng() * 0.7;
        e.set(0, this.rng() * Math.PI * 2, 0);
        q.setFromEuler(e);
        s.set(sc, sc, sc);
        p.set(pnt.x, pnt.h + 0.36 * sc, pnt.z);
        m.compose(p, q, s);
        bushes.setMatrixAt(i, m);
        berries.setMatrixAt(i, m);
        const c = new T.Color(0x467a39).multiplyScalar(0.8 + this.rng() * 0.3);
        bushes.setColorAt(i, c.convertSRGBToLinear());
        berries.setColorAt(i, new T.Color(0xd8514c).multiplyScalar(0.8 + this.rng() * 0.4).convertSRGBToLinear());
        const node = {
          type: 'bush',
          kind: 'bush',
          name: 'Frutas silvestres',
          x: pnt.x,
          z: pnt.z,
          y: pnt.h,
          scale: sc,
          hp: 24,
          maxHp: 24,
          alive: true,
          respawn: 0,
          idx: i,
          mesh: bushes,
          extra: berries,
          baseMatrix: m.clone(),
          radius: 0.8 * sc,
          height: 1.2 * sc,
        };
        this.nodes.push(node);
      });
      bushes.instanceMatrix.needsUpdate = true;
      berries.instanceMatrix.needsUpdate = true;
      this.bushes = bushes;
      this.bushBerries = berries;
      this.group.add(bushes, berries);
    }

    /* --------------------------- grass ------------------------- */
    buildGrass() {
      const count = 1500;
      const geo = grassGeometry();
      const mat = new T.MeshLambertMaterial({ color: 0xffffff, side: T.DoubleSide });
      const mesh = new T.InstancedMesh(geo, mat, count);
      mesh.frustumCulled = false;
      const m = new T.Matrix4();
      const q = new T.Quaternion();
      const s = new T.Vector3();
      const p = new T.Vector3();
      const c = new T.Color();
      let made = 0;
      for (let i = 0; i < 9000 && made < count; i++) {
        const a = this.rng() * Math.PI * 2;
        const r = 10 + Math.sqrt(this.rng()) * 142;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const h = this.heightAt(x, z);
        if (h < 2 || h > 17.5) continue;
        if (this.slopeAt(x, z) > 1) continue;
        const sc = 0.6 + this.rng() * 1.25;
        q.setFromAxisAngle(new T.Vector3(0, 1, 0), this.rng() * Math.PI * 2);
        s.set(sc, sc * (0.7 + this.rng() * 0.7), sc);
        p.set(x, h + 0.02, z);
        m.compose(p, q, s);
        mesh.setMatrixAt(made, m);
        c.setHex(0x5f8a3c).multiplyScalar(0.65 + this.rng() * 0.55);
        if (this.rng() < 0.12) c.setHex(0x7f9a3f);
        c.convertSRGBToLinear();
        mesh.setColorAt(made, c);
        made++;
      }
      mesh.count = made;
      mesh.instanceMatrix.needsUpdate = true;
      this.grass = mesh;
      this.group.add(mesh);
    }

    /* -------------------------- clouds ------------------------- */
    buildClouds() {
      this.clouds = [];
      const mat = new T.MeshLambertMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        flatShading: true,
        fog: false,
      });
      this.cloudMat = mat;
      const geo = new T.IcosahedronGeometry(1, 1);
      for (let i = 0; i < 11; i++) {
        const g = new T.Group();
        const parts = 3 + ((this.rng() * 3) | 0);
        for (let k = 0; k < parts; k++) {
          const m = new T.Mesh(geo, mat);
          const sc = 8 + this.rng() * 13;
          m.scale.set(sc * (0.9 + this.rng() * 0.5), sc * 0.32, sc * (0.8 + this.rng() * 0.4));
          m.position.set((this.rng() - 0.5) * sc * 1.7, (this.rng() - 0.5) * 2.5, (this.rng() - 0.5) * sc * 0.9);
          g.add(m);
        }
        const a = this.rng() * Math.PI * 2;
        const r = 60 + this.rng() * 170;
        g.position.set(Math.cos(a) * r, 52 + this.rng() * 32, Math.sin(a) * r);
        g.userData.speed = 0.5 + this.rng() * 1.1;
        this.group.add(g);
        this.clouds.push(g);
      }
    }

    /* --------------------------- birds ------------------------- */
    buildBirds() {
      this.birds = [];
      const mat = new T.MeshBasicMaterial({ color: 0x1c2624, side: T.DoubleSide, fog: false });
      for (let i = 0; i < 7; i++) {
        const g = new T.Group();
        const wingGeo = new T.PlaneGeometry(1.4, 0.22);
        const l = new T.Mesh(wingGeo, mat);
        l.rotation.z = 0.3;
        l.position.x = -0.68;
        const r = new T.Mesh(wingGeo, mat);
        r.rotation.z = -0.3;
        r.position.x = 0.68;
        g.add(l, r);
        g.userData = {
          radius: 25 + this.rng() * 65,
          height: 28 + this.rng() * 24,
          speed: 0.055 + this.rng() * 0.06,
          phase: this.rng() * Math.PI * 2,
          cx: (this.rng() - 0.5) * 40,
          cz: (this.rng() - 0.5) * 40,
          wings: [l, r],
        };
        g.scale.setScalar(0.8 + this.rng() * 0.5);
        this.group.add(g);
        this.birds.push(g);
      }
    }

    /* ------------------------- fireflies ----------------------- */
    buildFireflies() {
      const count = 100;
      const pos = [];
      this.fireflyPhase = [];
      for (let i = 0; i < count; i++) {
        const a = this.rng() * Math.PI * 2;
        const r = 18 + Math.sqrt(this.rng()) * 120;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const h = this.heightAt(x, z);
        if (h < 1.2) {
          i--;
          continue;
        }
        pos.push(x, h + 0.7 + this.rng() * 2.4, z);
        this.fireflyPhase.push(this.rng() * Math.PI * 2);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      this.fireflyMat = new T.PointsMaterial({
        color: 0xffe98a,
        size: 0.3,
        transparent: true,
        opacity: 0,
        blending: T.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        sizeAttenuation: true,
      });
      this.fireflies = new T.Points(geo, this.fireflyMat);
      this.fireflies.frustumCulled = false;
      this.group.add(this.fireflies);
    }

    /* -------------------------- obelisk ------------------------ */
    buildObelisk() {
      const y = this.heightAt(0, 0);
      const g = new T.Group();
      g.position.set(0, y, 0);
      const stone = flat(0x676a62);
      const base = new T.Mesh(new T.CylinderGeometry(9, 11.5, 2.2, 9), stone);
      base.position.y = 0.2;
      g.add(base);
      const step = new T.Mesh(new T.CylinderGeometry(5.2, 6.3, 1.4, 9), flat(0x7b7c70));
      step.position.y = 1.7;
      g.add(step);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const pillar = new T.Mesh(new T.BoxGeometry(1.1, 4.6, 1.1), flat(0x5e615a));
        pillar.position.set(Math.cos(a) * 6.6, 3.4, Math.sin(a) * 6.6);
        pillar.rotation.y = -a;
        g.add(pillar);
      }
      this.crystal = new T.Mesh(
        new T.OctahedronGeometry(2.3, 0),
        new T.MeshBasicMaterial({ color: 0x5ce8e0, transparent: true, opacity: 0.8, toneMapped: false })
      );
      this.crystal.scale.set(1, 3.1, 1);
      this.crystal.position.y = 11.5;
      g.add(this.crystal);
      this.crystalCore = new T.Mesh(
        new T.OctahedronGeometry(1.1, 0),
        new T.MeshBasicMaterial({ color: 0xd7ffff, transparent: true, opacity: 0.95, toneMapped: false })
      );
      this.crystalCore.scale.set(1, 3.4, 1);
      this.crystalCore.position.y = 11.5;
      g.add(this.crystalCore);

      const beamMat = new T.MeshBasicMaterial({
        color: 0x6bf3e4,
        transparent: true,
        opacity: 0.085,
        blending: T.AdditiveBlending,
        depthWrite: false,
        side: T.DoubleSide,
        fog: false,
        toneMapped: false,
      });
      const beam = new T.Mesh(new T.CylinderGeometry(1.1, 3.1, 110, 12, 1, true), beamMat);
      beam.position.y = 62;
      g.add(beam);
      const core = new T.Mesh(new T.CylinderGeometry(0.32, 0.7, 110, 8, 1, true), beamMat.clone());
      core.material.opacity = 0.22;
      core.position.y = 62;
      g.add(core);
      const light = new T.PointLight(0x62f0e4, 1.3, 42, 2);
      light.position.y = 10;
      g.add(light);
      this.obeliskLight = light;

      this.obeliskOrbit = [];
      for (let i = 0; i < 6; i++) {
        const m = new T.Mesh(new T.OctahedronGeometry(0.35 + this.rng() * 0.4, 0), this.crystal.material);
        m.userData = { phase: this.rng() * Math.PI * 2, radius: 4.5 + this.rng() * 3.5, y: 6 + this.rng() * 6, speed: 0.2 + this.rng() * 0.3 };
        g.add(m);
        this.obeliskOrbit.push(m);
      }
      this.obelisk = g;
      this.obeliskPos = { x: 0, z: 0, y };
      this.group.add(g);
    }

    /* -------------------------- crates ------------------------- */
    buildCrates() {
      const placements = [];
      const inward = new T.Vector2(-this.spawn.x, -this.spawn.z).normalize();
      const perp = new T.Vector2(-inward.y, inward.x);
      for (let i = 0; i < 10 && placements.length < 1; i++) {
        const d = 10 + i * 1.5;
        const x = this.spawn.x + inward.x * d + perp.x * (i % 2 ? 4 : -4);
        const z = this.spawn.z + inward.y * d + perp.y * (i % 2 ? 4 : -4);
        const h = this.heightAt(x, z);
        if (h > 1.2 && h < 8) placements.push({ x, z, y: h });
      }
      for (let i = 0; i < 2; i++) {
        const pt = this.randomLandPoint(40, 120, 2.2, 16, 40);
        placements.push(pt);
      }
      const bodyMat = flat(0x5b4529, { emissive: 0x0d0903 });
      const trimMat = new T.MeshLambertMaterial({ color: lin(0xd5a94f), emissive: lin(0x3a2606) });
      placements.forEach((pt, i) => {
        const g = new T.Group();
        g.position.set(pt.x, pt.y + 1.0, pt.z);
        const body = new T.Mesh(new T.BoxGeometry(1.25, 1.25, 1.25), bodyMat);
        g.add(body);
        for (const ax of [-1, 1]) {
          for (const az of [-1, 1]) {
            const post = new T.Mesh(new T.BoxGeometry(0.1, 1.4, 0.1), trimMat);
            post.position.set(ax * 0.66, 0, az * 0.66);
            g.add(post);
          }
        }
        const band = new T.Mesh(new T.BoxGeometry(1.35, 0.12, 1.35), trimMat);
        g.add(band);
        const glow = new T.Mesh(
          new T.BoxGeometry(1.02, 0.5, 1.02),
          new T.MeshBasicMaterial({ color: 0xffd88a, transparent: true, opacity: 0.3, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false })
        );
        g.add(glow);
        const ring = new T.Mesh(
          new T.RingGeometry(0.95, 1.4, 24),
          new T.MeshBasicMaterial({ color: 0xffce6b, transparent: true, opacity: 0.45, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = -0.95;
        g.add(ring);
        const beam = new T.Mesh(
          new T.CylinderGeometry(0.16, 0.7, 22, 8, 1, true),
          new T.MeshBasicMaterial({ color: 0xffc95e, transparent: true, opacity: 0.16, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false })
        );
        beam.position.y = 10.5;
        g.add(beam);
        g.userData = { ring, beam, glow, phase: i * 1.7, baseY: pt.y + 1.0 };
        this.group.add(g);
        this.crates.push({
          id: 'crate' + i,
          name: 'Suprimento',
          x: pt.x,
          z: pt.z,
          y: pt.y,
          group: g,
          looted: false,
          respawn: 0,
          radius: 1.2,
        });
      });
    }

    /* --------------------------- map --------------------------- */
    buildMap() {
      const size = 220;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(size, size);
      for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
          const x = (px / size - 0.5) * 360;
          const z = (py / size - 0.5) * 360;
          const h = this.heightAt(x, z);
          let r, g, b;
          if (h < 0) {
            const d = U.clamp(-h / 9, 0, 1);
            r = 12 + (1 - d) * 18;
            g = 52 + (1 - d) * 34;
            b = 68 + (1 - d) * 22;
          } else if (h < 1.9) {
            r = 178; g = 154; b = 104;
          } else if (h < 15) {
            const t = U.clamp((h - 1.9) / 13, 0, 1);
            r = 62 + t * 22; g = 104 - t * 12; b = 52 + t * 4;
            if (this.detailNoise.fbm(x * 0.12 + 9, z * 0.12, 2) > 0.66) { r = 94; g = 92; b = 82; }
          } else {
            const t = U.clamp((h - 15) / 12, 0, 1);
            r = 84 + t * 17; g = 82 + t * 16; b = 72 + t * 15;
          }
          const shade = 0.92 + this.detailNoise.fbm(x * 0.09, z * 0.09, 2) * 0.16;
          const idx = (py * size + px) * 4;
          img.data[idx] = U.clamp(r * shade, 0, 255);
          img.data[idx + 1] = U.clamp(g * shade, 0, 255);
          img.data[idx + 2] = U.clamp(b * shade, 0, 255);
          if (h < 0) img.data[idx + 3] = 235;
          else img.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      this.mapCanvas = canvas;
    }

    /* ------------------------- day / night --------------------- */
    setDayTime(t) {
      this.dayTime = ((t % 1) + 1) % 1;
      const angle = (this.dayTime - 0.25) * Math.PI * 2;
      const dir = new T.Vector3(Math.cos(angle) * 0.78, Math.sin(angle), Math.sin(angle * 0.5) * 0.22 + 0.18).normalize();
      this.sunDir.copy(dir);
      const elev = dir.y;
      const day = U.smoothstep(-0.14, 0.2, elev);
      const warm = U.clamp(1 - Math.abs(elev) / 0.3, 0, 1) * U.smoothstep(-0.32, 0.02, elev);
      this.dayFactor = day;
      this.warmFactor = warm;

      const nightTop = new T.Color(0x030711);
      const nightHor = new T.Color(0x07142a);
      const dayTop = new T.Color(0x2c6ca8);
      const dayHor = new T.Color(0xcbe6ef);
      const warmTop = new T.Color(0x40406f);
      const warmHor = new T.Color(0xff8f54);

      const top = nightTop.clone().lerp(dayTop, day).lerp(warmTop, warm * 0.62);
      const hor = nightHor.clone().lerp(dayHor, day).lerp(warmHor, warm * 0.9);
      this.skyUniforms.uTop.value.copy(top);
      this.skyUniforms.uHorizon.value.copy(hor);
      this.skyUniforms.uSunDir.value.copy(dir);
      this.skyUniforms.uSunColor.value.setHex(0xffd9a0).lerp(new T.Color(0xfff4d8), day).lerp(new T.Color(0xff9a55), warm * 0.75);

      this.scene.fog.color.copy(hor).multiplyScalar(0.9);
      this.waterUniforms.uFogColor.value.copy(this.scene.fog.color);
      this.waterUniforms.uSunDir.value.copy(dir);
      this.waterUniforms.uSunColor.value.copy(this.skyUniforms.uSunColor.value);
      this.waterUniforms.uDeep.value.setHex(0x0a3448).lerp(new T.Color(0x061723), 1 - day);
      this.waterUniforms.uShallow.value.setHex(0x3c98a6).lerp(new T.Color(0x0b2b37), 1 - day * 0.8);

      const sunColor = new T.Color(0xff9b5a).lerp(new T.Color(0xfff0d0), day);
      this.sun.color.copy(sunColor);
      this.sun.intensity = 1.28 * day + 0.04;
      this.sun.position.copy(dir).multiplyScalar(130);
      this.fill.intensity = 0.1 + 0.12 * day;
      this.fill.color.setHex(0x89a8ff);
      this.hemi.color.copy(top).lerp(new T.Color(0xbfd9ff), 0.5);
      this.hemi.groundColor.setHex(0x39301f).lerp(new T.Color(0x0a1117), 1 - day);
      this.hemi.intensity = 0.22 + 0.58 * day;

      this.cloudMat.color.copy(new T.Color(0x2e3c52).lerp(new T.Color(0xfff4e4), day)).lerp(new T.Color(0xffb27a), warm * 0.5);
      this.cloudMat.opacity = 0.5 + 0.24 * day;

      this.sunDisc.position.copy(dir).multiplyScalar(300);
      this.sunDisc.visible = elev > -0.08;
      this.sunDisc.material.color.copy(new T.Color(0xffcf8a).lerp(new T.Color(0xfff8e0), day));
      this.moon.position.copy(dir).multiplyScalar(-300);
      this.moonGlow.position.copy(this.moon.position);
      this.moon.material.opacity = U.clamp(-elev * 5, 0, 0.95);
      this.moonGlow.material.opacity = U.clamp(-elev * 3, 0, 0.22);
      this.starMat.opacity = U.clamp((0.18 - elev) * 3.4, 0, 0.9);

      this.obeliskLight.intensity = 1.0 + (1 - day) * 0.8;
      if (this.fireflies) this.fireflyMat.opacity = U.clamp((0.2 - elev) * 2.4, 0, 0.85);
      if (this.birds) {
        for (const b of this.birds) b.visible = day > 0.35;
      }
    }

    /* --------------------------- update ------------------------ */
    update(dt, elapsed, camera) {
      this.elapsed = elapsed;
      if (camera) {
        this.sky.position.copy(camera.position);
        this.skyGroup.position.copy(camera.position);
        this.skyGroup.position.y = Math.max(camera.position.y, -2);
      }
      for (const cf of this.campfires) {
        const t = elapsed * 9 + cf.phase;
        const flick = 0.86 + Math.sin(t) * 0.09 + Math.sin(t * 2.3) * 0.05;
        cf.light.intensity = 1.7 * flick;
        if (cf.flames) {
          cf.flames.forEach((f, i) => {
            f.scale.y = 0.8 + Math.sin(t * 1.3 + i) * 0.16;
            f.scale.x = 0.9 + Math.sin(t * 1.7 + i * 2) * 0.12;
            f.position.y = (i === 0 ? 0.62 : 0.9) + Math.sin(t + i) * 0.05;
          });
        }
      }
      for (const b of this.birds) {
        const d = b.userData;
        const a = elapsed * d.speed + d.phase;
        b.position.set(d.cx + Math.cos(a) * d.radius, d.height + Math.sin(a * 2) * 1.5, d.cz + Math.sin(a) * d.radius);
        b.rotation.y = -a;
        const flap = Math.sin(elapsed * 9 + d.phase) * 0.35;
        d.wings[0].rotation.z = 0.3 + flap;
        d.wings[1].rotation.z = -0.3 - flap;
      }
      for (const c of this.clouds) {
        c.position.x += c.userData.speed * dt;
        if (c.position.x > 250) c.position.x = -250;
      }
      if (this.crystal) {
        this.crystal.rotation.y += dt * 0.35;
        this.crystalCore.rotation.y -= dt * 0.6;
        const pulse = 1 + Math.sin(elapsed * 1.7) * 0.06;
        this.crystal.scale.set(pulse, 3.1 * pulse, pulse);
        this.crystalCore.scale.set(pulse, 3.4 * pulse, pulse);
      }
      if (this.obeliskOrbit) {
        for (const m of this.obeliskOrbit) {
          const d = m.userData;
          const a = elapsed * d.speed + d.phase;
          m.position.set(Math.cos(a) * d.radius, d.y + Math.sin(a * 1.4) * 1.2, Math.sin(a) * d.radius);
          m.rotation.y += dt * 0.7;
          m.rotation.x += dt * 0.3;
        }
      }
      for (const crate of this.crates) {
        if (crate.looted) continue;
        const g = crate.group;
        g.position.y = g.userData.baseY + Math.sin(elapsed * 1.2 + g.userData.phase) * 0.13;
        g.rotation.y += dt * 0.35;
        g.userData.ring.rotation.z = elapsed * 0.5 + g.userData.phase;
        g.userData.beam.material.opacity = 0.12 + Math.sin(elapsed * 2 + g.userData.phase) * 0.035;
      }
      if (this.waterUniforms) this.waterUniforms.uTime.value = elapsed;
      if (this.fireflies) {
        const arr = this.fireflies.geometry.attributes.position.array;
        for (let i = 0; i < arr.length; i += 3) {
          const ph = this.fireflyPhase[i / 3];
          arr[i] += Math.sin(elapsed * 0.7 + ph) * dt * 0.35;
          arr[i + 1] += Math.sin(elapsed * 1.1 + ph * 1.7) * dt * 0.16;
          arr[i + 2] += Math.cos(elapsed * 0.6 + ph) * dt * 0.35;
        }
        this.fireflies.geometry.attributes.position.needsUpdate = true;
        this.fireflies.rotation.y = elapsed * 0.004;
      }
      // respawn resources
      if (this.elapsed > 0) {
        for (const node of this.nodes) {
          if (!node.alive && node.respawn > 0 && this.elapsed >= node.respawn) {
            this.restoreNode(node);
          }
        }
      }
    }

    /* ------------------------ interactions --------------------- */
    setNodeScale(node, scale) {
      const m = node.baseMatrix.clone();
      if (scale <= 0.001) {
        m.scale(new T.Vector3(0.0001, 0.0001, 0.0001));
      }
      node.mesh.setMatrixAt(node.idx, m);
      node.mesh.instanceMatrix.needsUpdate = true;
      if (node.extra) {
        node.extra.setMatrixAt(node.idx, m);
        node.extra.instanceMatrix.needsUpdate = true;
      }
    }

    depleteNode(node) {
      node.alive = false;
      node.respawn = this.elapsed + (node.kind === 'bush' ? 55 : 110);
      this.setNodeScale(node, 0);
    }

    restoreNode(node) {
      node.alive = true;
      node.hp = node.maxHp;
      node.respawn = 0;
      node.mesh.setMatrixAt(node.idx, node.baseMatrix);
      node.mesh.instanceMatrix.needsUpdate = true;
      if (node.extra) {
        node.extra.setMatrixAt(node.idx, node.baseMatrix);
        node.extra.instanceMatrix.needsUpdate = true;
      }
    }

    addCampfire(x, z) {
      const y = this.heightAt(x, z);
      const g = new T.Group();
      g.position.set(x, y, z);
      const stoneMat = flat(0x716f63);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const rock = new T.Mesh(new T.DodecahedronGeometry(0.24 + this.rng() * 0.1, 0), stoneMat);
        rock.position.set(Math.cos(a) * 0.78, 0.1, Math.sin(a) * 0.78);
        rock.rotation.set(this.rng(), this.rng(), this.rng());
        g.add(rock);
      }
      const logMat = flat(0x4a3320);
      for (let i = 0; i < 4; i++) {
        const log = new T.Mesh(new T.CylinderGeometry(0.08, 0.1, 1.25, 5), logMat);
        log.rotation.z = Math.PI / 2;
        log.rotation.y = (i / 4) * Math.PI;
        log.position.y = 0.2;
        g.add(log);
      }
      const flameMat = new T.MeshBasicMaterial({ color: 0xff8a32, transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false });
      const flameMat2 = new T.MeshBasicMaterial({ color: 0xffd86a, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false });
      const f1 = new T.Mesh(new T.ConeGeometry(0.36, 1.0, 6), flameMat);
      f1.position.y = 0.65;
      const f2 = new T.Mesh(new T.ConeGeometry(0.2, 0.8, 5), flameMat2);
      f2.position.y = 0.9;
      const light = new T.PointLight(0xff9a45, 1.7, 20, 2);
      light.position.set(0, 1.4, 0);
      g.add(f1, f2, light);
      this.group.add(g);
      const fire = { x, z, y, group: g, light, flames: [f1, f2], phase: this.rng() * 6.28, cookTimer: 0 };
      this.campfires.push(fire);
      return fire;
    }

    removeCampfire(fire) {
      const i = this.campfires.indexOf(fire);
      if (i >= 0) this.campfires.splice(i, 1);
      this.group.remove(fire.group);
    }

    offsetPosition(x, z, dist) {
      const len = Math.hypot(x, z) || 1;
      return { x: x + (x / len) * dist, z: z + (z / len) * dist };
    }

    dispose() {
      this.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
      this.scene.remove(this.group);
    }
  }

  window.World = World;
})();
