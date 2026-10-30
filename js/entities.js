/* ============================================================
   PRIMAL ISLE — creatures, labels, particles, rider
   ============================================================ */
(function () {
  'use strict';
  const U = window.U;
  const T = THREE;

  function lin(hex) {
    return new T.Color(hex).convertSRGBToLinear();
  }
  function mat(color, extra) {
    const opts = Object.assign({ color: lin(color), flatShading: true }, extra || {});
    if (opts.emissive != null) opts.emissive = lin(opts.emissive);
    return new T.MeshLambertMaterial(opts);
  }
  function sphere(r, color, x, y, z, sx, sy, sz, extra) {
    const m = new T.Mesh(new T.SphereGeometry(r, 10, 8), mat(color, extra));
    m.position.set(x, y, z);
    m.scale.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
    return m;
  }
  function box(w, h, d, color, x, y, z, extra) {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat(color, extra));
    m.position.set(x, y, z);
    return m;
  }
  function cyl(rt, rb, h, color, x, y, z, seg, extra) {
    const m = new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg || 6), mat(color, extra));
    m.position.set(x, y, z);
    return m;
  }
  function cone(r, h, color, x, y, z, seg, extra) {
    const m = new T.Mesh(new T.ConeGeometry(r, h, seg || 6), mat(color, extra));
    m.position.set(x, y, z);
    return m;
  }

  const DINO_CONFIG = {
    parasaur: {
      name: 'Parassauro',
      hp: 125,
      labelY: 4.25,
      radius: 1.5,
      speed: 1.55,
      followSpeed: 5.1,
      xp: 0,
      hostile: false,
      detect: 0,
    },
    raptor: {
      name: 'Raptor',
      hp: 135,
      labelY: 2.95,
      radius: 1.05,
      speed: 5.0,
      xp: 70,
      hostile: true,
      detect: 25,
      dmg: 12,
      drops: { hide: 3, meat: 4 },
    },
    dodo: {
      name: 'Dodô',
      hp: 26,
      labelY: 1.72,
      radius: 0.7,
      speed: 1.0,
      xp: 14,
      hostile: false,
      detect: 0,
      drops: { meat: 2, hide: 1, fiber: 2 },
    },
  };

  /* ------------------------- name tag ------------------------- */
  class NameTag {
    constructor(title, color) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 512;
      this.canvas.height = 128;
      this.ctx = this.canvas.getContext('2d');
      this.texture = new T.CanvasTexture(this.canvas);
      this.texture.minFilter = T.LinearFilter;
      this.texture.magFilter = T.LinearFilter;
      this.material = new T.SpriteMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      });
      this.sprite = new T.Sprite(this.material);
      this.sprite.scale.set(4.6, 1.15, 1);
      this.sprite.renderOrder = 4;
      this.title = title;
      this.color = color || '#ffe7b5';
      this.sub = '';
      this.progress = null;
      this.hostile = false;
      this.draw();
    }
    draw() {
      const c = this.ctx;
      const w = 512;
      const h = 128;
      c.clearRect(0, 0, w, h);
      c.fillStyle = this.hostile ? 'rgba(34,9,7,.78)' : 'rgba(5,18,16,.74)';
      const x = 18;
      const y = 14;
      const ww = w - 36;
      const hh = this.progress != null ? 94 : 74;
      c.beginPath();
      c.moveTo(x + 10, y);
      c.lineTo(x + ww, y);
      c.lineTo(x + ww - 10, y + hh);
      c.lineTo(x, y + hh);
      c.closePath();
      c.fill();
      c.strokeStyle = this.hostile ? 'rgba(239,91,80,.55)' : 'rgba(230,192,123,.42)';
      c.lineWidth = 2;
      c.stroke();
      c.fillStyle = this.color;
      c.font = '600 27px "Chakra Petch", sans-serif';
      c.textAlign = 'left';
      c.fillText(this.title.toUpperCase(), x + 18, y + 36);
      c.fillStyle = this.hostile ? 'rgba(255,170,160,.75)' : 'rgba(205,226,211,.68)';
      c.font = '500 17px "Chakra Petch", sans-serif';
      c.fillText(this.sub, x + 18, y + 61);
      if (this.progress != null) {
        const bx = x + 18;
        const by = y + 71;
        const bw = ww - 36;
        c.fillStyle = 'rgba(0,0,0,.55)';
        c.fillRect(bx, by, bw, 9);
        c.fillStyle = this.progress >= 100 ? '#79e6d7' : '#e6c07b';
        c.fillRect(bx, by, (bw * U.clamp(this.progress, 0, 100)) / 100, 9);
      }
      this.texture.needsUpdate = true;
    }
    set(title, sub, progress, hostile, color) {
      this.title = title;
      this.sub = sub;
      this.progress = progress;
      this.hostile = !!hostile;
      if (color) this.color = color;
      this.draw();
    }
  }

  /* -------------------------- dino --------------------------- */
  class Dino {
    constructor(game, type, x, z, opts) {
      opts = opts || {};
      this.game = game;
      this.world = game.world;
      this.type = type;
      this.cfg = DINO_CONFIG[type];
      this.group = new T.Group();
      this.model = new T.Group();
      this.group.add(this.model);
      this.parts = {};
      this.materials = [];
      this.x = x;
      this.z = z;
      this.y = this.world.heightAt(x, z);
      this.yaw = opts.yaw != null ? opts.yaw : Math.random() * Math.PI * 2;
      this.home = { x: x, z: z };
      this.hp = this.cfg.hp;
      this.maxHp = this.cfg.hp;
      this.radius = this.cfg.radius;
      this.dead = false;
      this.deadTimer = 0;
      this.tamed = !!opts.tamed;
      this.taming = opts.taming || 0;
      this.name = opts.name || this.cfg.name;
      this.saddle = false;
      this.mounted = false;
      this.state = 'idle';
      this.stateTimer = U.rand(0.5, 3);
      this.target = null;
      this.attackCd = 0;
      this.feedPause = 0;
      this.hitFlash = 0;
      this.walkPhase = Math.random() * 10;
      this.speedFactor = 0;
      this.lookYaw = this.yaw;
      this.roarCd = U.rand(4, 10);
      this.aggro = false;
      this.build();
      this.group.position.set(x, this.y, z);
      this.group.rotation.y = this.yaw;
      this.label = new NameTag(this.name, type === 'raptor' ? '#ffb3a8' : '#ffe7b5');
      this.label.sprite.position.y = this.cfg.labelY;
      this.group.add(this.label.sprite);
      this.refreshLabel();
      game.scene.add(this.group);
    }

    registerMat(m) {
      this.materials.push(m);
      return m;
    }

    build() {
      if (this.type === 'parasaur') this.buildParasaur();
      else if (this.type === 'raptor') this.buildRaptor();
      else this.buildDodo();
    }

    buildParasaur() {
      const body = sphere(1.1, 0x4f8b62, 0, 1.72, 0, 1.05, 0.94, 1.72);
      this.model.add(body);
      const belly = sphere(1.02, 0x7ba575, 0, 1.45, 0.08, 0.9, 0.55, 1.42);
      this.model.add(belly);
      const back = sphere(0.62, 0x3f7350, 0, 2.34, -0.35, 0.8, 0.38, 1.0);
      this.model.add(back);
      for (let i = 0; i < 4; i++) {
        const s = cone(0.16, 0.34, 0x2d583d, 0, 2.55 - i * 0.03, 0.7 - i * 0.55, 4);
        this.model.add(s);
      }

      const neck = new T.Group();
      neck.position.set(0, 2.15, 1.1);
      neck.rotation.x = 0.48;
      const neckMesh = cyl(0.3, 0.42, 1.35, 0x4f8b62, 0, 0.64, 0, 7);
      neck.add(neckMesh);
      const head = new T.Group();
      head.position.set(0, 1.3, 0.05);
      const skull = sphere(0.44, 0x59956a, 0, 0, 0.05, 1.0, 0.92, 1.3);
      head.add(skull);
      const snout = box(0.42, 0.32, 0.55, 0x6aa276, 0, -0.09, 0.62);
      head.add(snout);
      const crest = box(0.1, 0.6, 0.72, 0xdd8b3c, 0, 0.36, -0.3);
      crest.rotation.x = -0.45;
      head.add(crest);
      const crest2 = box(0.07, 0.22, 0.5, 0xe9a052, 0, 0.55, -0.62);
      crest2.rotation.x = -0.72;
      head.add(crest2);
      const eyeL = sphere(0.075, 0x0a1210, 0.32, 0.1, 0.26);
      const eyeR = sphere(0.075, 0x0a1210, -0.32, 0.1, 0.26);
      head.add(eyeL, eyeR);
      const beak = cone(0.15, 0.3, 0xc6a266, 0, -0.11, 0.95, 4);
      beak.rotation.x = Math.PI / 2;
      head.add(beak);
      neck.add(head);
      this.model.add(neck);
      this.parts.neck = neck;
      this.parts.head = head;

      this.parts.legs = [];
      const legPos = [
        [-0.68, 1.38, 0.92],
        [0.68, 1.38, 0.92],
        [-0.68, 1.38, -0.94],
        [0.68, 1.38, -0.94],
      ];
      for (let i = 0; i < 4; i++) {
        const p = legPos[i];
        const leg = new T.Group();
        leg.position.set(p[0], p[1], p[2]);
        const upper = cyl(0.17, 0.14, 0.85, 0x477e58, 0, -0.42, 0, 6);
        const lower = cyl(0.115, 0.1, 0.58, 0x3c6c4c, 0, -1.05, 0.04, 6);
        const foot = box(0.32, 0.16, 0.48, 0x315a40, 0, -1.38, 0.12);
        leg.add(upper, lower, foot);
        this.model.add(leg);
        this.parts.legs.push(leg);
      }

      const tail = new T.Group();
      tail.position.set(0, 1.7, -1.62);
      tail.rotation.x = 0.18;
      const seg1 = new T.Mesh(new T.ConeGeometry(0.46, 2.1, 6), mat(0x4a8459));
      seg1.geometry.translate(0, 1.05, 0);
      seg1.geometry.rotateX(-Math.PI / 2);
      tail.add(seg1);
      this.model.add(tail);
      this.parts.tail = tail;

      const saddle = new T.Group();
      const leather = mat(0x684325);
      const pad = box(1.15, 0.18, 1.25, 0x684325, 0, 2.55, -0.15);
      const strapL = box(0.09, 0.5, 1.0, 0x3d2616, 0.6, 2.3, -0.15);
      const strapR = box(0.09, 0.5, 1.0, 0x3d2616, -0.6, 2.3, -0.15);
      const horn = box(0.12, 0.22, 0.12, 0xc9a361, 0, 2.72, 0.35);
      saddle.add(pad, strapL, strapR, horn);
      saddle.visible = false;
      this.model.add(saddle);
      this.parts.saddle = saddle;

      // simple dark eyes glow off, feathers on arms
      const armL = box(0.1, 0.28, 0.6, 0x3f7350, 0.85, 1.85, 0.65);
      armL.rotation.z = 0.3;
      const armR = box(0.1, 0.28, 0.6, 0x3f7350, -0.85, 1.85, 0.65);
      armR.rotation.z = -0.3;
      this.model.add(armL, armR);
    }

    buildRaptor() {
      const body = sphere(0.75, 0x53613c, 0, 1.12, 0, 0.82, 0.8, 1.45);
      this.model.add(body);
      const chest = sphere(0.55, 0x6b7248, 0, 1.0, 0.72, 0.75, 0.72, 0.85);
      this.model.add(chest);
      const neck = new T.Group();
      neck.position.set(0, 1.4, 0.8);
      neck.rotation.x = 0.45;
      neck.add(cyl(0.24, 0.32, 0.8, 0x59643f, 0, 0.38, 0, 6));
      const head = new T.Group();
      head.position.set(0, 0.82, 0.05);
      const skull = sphere(0.36, 0x6a7447, 0, 0, 0.05, 0.95, 0.9, 1.3);
      head.add(skull);
      const snout = box(0.34, 0.28, 0.75, 0x7b7f4f, 0, -0.06, 0.55);
      head.add(snout);
      const jaw = box(0.32, 0.11, 0.6, 0x3e452c, 0, -0.22, 0.55);
      head.add(jaw);
      const eyeMat = new T.MeshBasicMaterial({ color: 0xffc35e, toneMapped: false });
      const eyeL = new T.Mesh(new T.SphereGeometry(0.055, 6, 5), eyeMat);
      eyeL.position.set(0.22, 0.11, 0.28);
      const eyeR = eyeL.clone();
      eyeR.position.x = -0.22;
      head.add(eyeL, eyeR);
      for (let i = 0; i < 4; i++) {
        const tooth = cone(0.025, 0.12, 0xe6dfc4, 0.12 - (i % 2) * 0.24, -0.2, 0.32 + (i >> 1) * 0.26, 3);
        tooth.rotation.x = Math.PI;
        head.add(tooth);
      }
      neck.add(head);
      this.model.add(neck);
      this.parts.head = head;
      this.parts.neck = neck;

      for (let i = 0; i < 3; i++) {
        const stripe = box(0.55, 0.08, 0.18, 0xc87b3e, 0, 1.5 - i * 0.12, 0.45 - i * 0.42);
        this.model.add(stripe);
      }
      const feather = cone(0.1, 0.45, 0x803e2a, 0, 1.62, 0.4, 4);
      feather.rotation.x = -0.7;
      this.model.add(feather);

      this.parts.legs = [];
      for (const side of [-1, 1]) {
        const leg = new T.Group();
        leg.position.set(side * 0.48, 0.98, -0.12);
        const upper = cyl(0.16, 0.13, 0.62, 0x4d5836, 0.02 * side, -0.28, 0.08, 5);
        upper.rotation.x = -0.3;
        const lower = cyl(0.1, 0.08, 0.52, 0x475130, -0.02 * side, -0.68, -0.05, 5);
        lower.rotation.x = 0.42;
        const foot = box(0.22, 0.12, 0.48, 0x3b432c, 0, -0.94, 0.12);
        const claw = cone(0.04, 0.28, 0xd8c9a2, 0, -0.94, 0.3, 4);
        claw.rotation.x = 1.7;
        leg.add(upper, lower, foot, claw);
        this.model.add(leg);
        this.parts.legs.push(leg);

        const arm = box(0.09, 0.22, 0.42, 0x5b6540, side * 0.52, 1.12, 0.6);
        arm.rotation.z = side * 0.3;
        this.model.add(arm);
      }

      const tail = new T.Group();
      tail.position.set(0, 1.15, -1.25);
      const t1 = new T.Mesh(new T.ConeGeometry(0.32, 1.7, 6), mat(0x53613c));
      t1.geometry.translate(0, 0.85, 0);
      t1.geometry.rotateX(-Math.PI / 2);
      tail.add(t1);
      this.model.add(tail);
      this.parts.tail = tail;
    }

    buildDodo() {
      const body = sphere(0.62, 0x8c846c, 0, 0.72, 0, 1.0, 1.0, 1.12);
      this.model.add(body);
      const chest = sphere(0.45, 0xa9a086, 0, 0.68, 0.3, 0.86, 0.9, 0.9);
      this.model.add(chest);
      const head = new T.Group();
      head.position.set(0, 1.22, 0.38);
      head.add(sphere(0.33, 0x9b9277, 0, 0, 0, 1, 1, 1));
      const beak = cone(0.14, 0.48, 0xdda23d, 0, -0.02, 0.42, 5);
      beak.rotation.x = Math.PI / 2;
      head.add(beak);
      const eyeL = sphere(0.065, 0x10130e, 0.19, 0.1, 0.22);
      const eyeR = sphere(0.065, 0x10130e, -0.19, 0.1, 0.22);
      head.add(eyeL, eyeR);
      this.model.add(head);
      this.parts.head = head;
      for (const side of [-1, 1]) {
        const wing = box(0.08, 0.32, 0.55, 0x726a54, side * 0.56, 0.75, -0.02);
        wing.rotation.z = side * 0.18;
        this.model.add(wing);
        const leg = cyl(0.05, 0.06, 0.45, 0xcf9b45, side * 0.22, 0.28, 0.02, 5);
        this.model.add(leg);
      }
      const tail = new T.Group();
      tail.position.set(0, 0.9, -0.55);
      for (let i = 0; i < 4; i++) {
        const f = cone(0.1, 0.55, 0x6f6752, (i - 1.5) * 0.12, 0.05, -0.1, 4);
        f.rotation.x = -1.05;
        f.rotation.z = (i - 1.5) * 0.18;
        tail.add(f);
      }
      this.model.add(tail);
      this.parts.tail = tail;
    }

    setSaddled(v) {
      this.saddle = !!v;
      if (this.parts.saddle) this.parts.saddle.visible = !!v;
      this.refreshLabel();
    }

    refreshLabel() {
      if (!this.label) return;
      if (this.type === 'parasaur') {
        if (this.tamed) {
          this.label.set(
            this.name,
            this.saddle ? 'Domesticado · pronto para montar' : 'Domesticado · precisa de sela',
            null,
            false,
            '#a9f0db'
          );
        } else {
          this.label.set('Parassauro', 'Selvagem · ofereça frutas', this.taming, false, '#ffe7b5');
        }
      } else if (this.type === 'raptor') {
        this.label.set('Raptor', this.aggro ? 'Caçando você' : 'Predador', null, true, '#ffb3a8');
      } else {
        this.label.set('Dodô', 'Presa fácil', null, false, '#e8dfc4');
      }
    }

    setPosition(x, z, yaw) {
      this.x = x;
      this.z = z;
      this.y = this.world.heightAt(x, z);
      this.group.position.set(x, this.y, z);
      if (yaw != null) {
        this.yaw = yaw;
        this.group.rotation.y = yaw;
      }
    }

    takeDamage(amount, fromPlayer) {
      if (this.dead) return;
      this.hp -= amount;
      this.hitFlash = 0.16;
      this.materials.forEach((m) => {
        if (m.emissive && m.emissive.getHex() !== 0x200000) {
          m._baseEmissive = m.emissive.getHex();
          m.emissive.setHex(0x5a120c);
        }
      });
      if (this.type === 'raptor') {
        this.aggro = true;
        this.state = 'chase';
        if (this.roarCd <= 0) {
          window.Sfx.roar();
          this.roarCd = 7;
        }
      }
      if (this.type === 'dodo') {
        this.state = 'flee';
        this.stateTimer = 4;
      }
      if (this.hp <= 0) this.die();
    }

    die() {
      if (this.dead) return;
      this.dead = true;
      this.deadTimer = 0;
      this.label.sprite.visible = false;
      if (this.game.onDinoDeath) this.game.onDinoDeath(this);
    }

    update(dt, player) {
      if (this.dead) {
        this.deadTimer += dt;
        this.group.rotation.z = U.damp(this.group.rotation.z, Math.PI / 2 - 0.2, 5, dt);
        this.group.position.y = U.damp(this.group.position.y, this.y + 0.55, 3, dt);
        return;
      }
      this.attackCd -= dt;
      this.stateTimer -= dt;
      this.feedPause -= dt;
      this.hitFlash -= dt;
      this.roarCd -= dt;
      if (this.hitFlash <= 0) {
        this.materials.forEach((m) => {
          if (m._baseEmissive != null) {
            m.emissive.setHex(m._baseEmissive);
            m._baseEmissive = null;
          }
        });
      }
      const distToPlayer = Math.hypot(player.x - this.x, player.z - this.z);
      const night = this.world.dayFactor < 0.25;

      if (this.mounted) {
        this.animate(dt);
        this.group.position.set(this.x, this.y, this.z);
        this.group.rotation.y = this.yaw;
        return;
      }

      if (this.tamed) {
        if (distToPlayer > 4.4 && player.alive) {
          this.moveToward(player.x, player.z, this.cfg.followSpeed, dt);
          this.state = 'follow';
        } else {
          this.speedFactor = U.damp(this.speedFactor, 0, 8, dt);
          if (distToPlayer < 7) {
            this.lookYaw = Math.atan2(player.x - this.x, player.z - this.z);
            this.yaw = U.angleLerp(this.yaw, this.lookYaw, 1 - Math.exp(-2.5 * dt));
          }
        }
        this.animate(dt);
        return;
      }

      if (this.type === 'raptor') {
        this.roarCd -= dt;
        if (this.roarCd <= 0 && night) {
          window.Sfx.roar();
          this.roarCd = 12 + Math.random() * 12;
        }
        const detect = night ? 36 : this.cfg.detect;
        if (player.alive && distToPlayer < detect) {
          this.aggro = true;
        }
        if (this.aggro && player.alive && distToPlayer > 48) this.aggro = false;
        if (this.aggro && player.alive) {
          if (distToPlayer > 2.8) {
            this.moveToward(player.x, player.z, this.cfg.speed * (night ? 1.12 : 1), dt);
          } else {
            this.speedFactor = U.damp(this.speedFactor, 0, 8, dt);
            this.yaw = U.angleLerp(this.yaw, Math.atan2(player.x - this.x, player.z - this.z), 1 - Math.exp(-8 * dt));
            if (this.attackCd <= 0) {
              this.attackCd = 1.15;
              this.attackAnim = 0.38;
              window.Sfx.hit();
              if (this.game.damagePlayer) this.game.damagePlayer(this.cfg.dmg, 'raptor');
            }
          }
          if (this.roarCd <= 0) {
            window.Sfx.roar();
            this.roarCd = 8 + Math.random() * 6;
          }
        } else {
          this.wander(dt, 1.3);
        }
        if (this.attackAnim > 0) {
          this.attackAnim -= dt;
          const k = Math.sin((1 - this.attackAnim / 0.38) * Math.PI);
          this.parts.head.position.z = 0.05 + k * 0.35;
        } else {
          this.parts.head.position.z = 0.05;
        }
        this.animate(dt);
        return;
      }

      if (this.type === 'dodo' && player.alive && distToPlayer < 5.5) {
        this.state = 'flee';
        this.stateTimer = 2.5;
        const dx = this.x - player.x;
        const dz = this.z - player.z;
        this.moveToward(this.x + dx * 3, this.z + dz * 3, 2.2, dt);
        this.animate(dt);
        return;
      }

      if (this.feedPause > 0) {
        this.speedFactor = U.damp(this.speedFactor, 0, 8, dt);
        this.yaw = U.angleLerp(this.yaw, Math.atan2(player.x - this.x, player.z - this.z), 1 - Math.exp(-3 * dt));
        if (this.parts.head) this.parts.head.position.y = U.damp(this.parts.head.position.y, -0.06, 4, dt);
        this.animate(dt);
        return;
      }
      this.wander(dt, this.cfg.speed);
      this.animate(dt);
    }

    wander(dt, speed) {
      if (this.state !== 'wander' || this.stateTimer <= 0) {
        if (this.state === 'wander' && this.stateTimer <= 0) {
          this.state = 'idle';
          this.stateTimer = 1.5 + Math.random() * 3.5;
          this.speedFactor = U.damp(this.speedFactor, 0, 5, dt);
        } else if (this.state === 'idle') {
          if (this.stateTimer <= 0) {
            const a = Math.random() * Math.PI * 2;
            const r = 3 + Math.random() * 8;
            this.target = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r };
            this.state = 'wander';
            this.stateTimer = 5 + Math.random() * 6;
          }
        } else {
          this.state = 'idle';
          this.stateTimer = 2 + Math.random() * 3;
        }
      }
      if (this.state === 'wander' && this.target) {
        const d = Math.hypot(this.target.x - this.x, this.target.z - this.z);
        if (d < 0.8) {
          this.state = 'idle';
          this.stateTimer = 2 + Math.random() * 4;
          this.speedFactor = 0;
        } else {
          this.moveToward(this.target.x, this.target.z, speed, dt);
        }
      } else {
        this.speedFactor = U.damp(this.speedFactor, 0, 6, dt);
      }
    }

    moveToward(tx, tz, speed, dt) {
      const dx = tx - this.x;
      const dz = tz - this.z;
      const dist = Math.hypot(dx, dz) || 1;
      const nx = this.x + (dx / dist) * speed * dt;
      const nz = this.z + (dz / dist) * speed * dt;
      const h = this.world.heightAt(nx, nz);
      if (h < 0.15) {
        // don't enter deep water
        this.state = 'idle';
        this.stateTimer = 1 + Math.random() * 2;
        return;
      }
      this.x = nx;
      this.z = nz;
      this.y = h;
      const targetYaw = Math.atan2(dx, dz);
      this.yaw = U.angleLerp(this.yaw, targetYaw, 1 - Math.exp(-8 * dt));
      this.group.position.set(this.x, this.y, this.z);
      this.group.rotation.y = this.yaw;
      this.speedFactor = U.damp(this.speedFactor, speed / 4, 6, dt);
      this.walkPhase += dt * (4.5 + speed * 1.3);
    }

    animate(dt) {
      const sf = U.clamp(this.speedFactor, 0, 2);
      if (this.parts.legs) {
        this.parts.legs.forEach((leg, i) => {
          const off = i === 0 || i === 3 ? 0 : Math.PI;
          leg.rotation.x = Math.sin(this.walkPhase + off) * 0.62 * sf;
        });
      }
      if (this.parts.tail) {
        this.parts.tail.rotation.y = Math.sin(this.walkPhase * 0.5 + 1) * 0.16 + Math.sin(this.walkPhase * 0.2) * 0.08;
        this.parts.tail.rotation.x = (this.type === 'raptor' ? 0.05 : 0.18) + Math.sin(this.walkPhase * 0.5) * 0.04;
      }
      if (this.parts.head && this.type !== 'raptor') {
        this.parts.head.rotation.z = Math.sin(this.walkPhase * 0.5) * 0.03 * sf;
      }
      if (this.parts.neck) {
        this.parts.neck.rotation.x = (this.type === 'raptor' ? 0.45 : 0.48) + Math.sin(this.walkPhase * 0.5) * 0.025 * sf;
      }
      this.model.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.035 * sf + (this.type === 'dodo' ? Math.abs(Math.sin(this.walkPhase * 1.4)) * 0.03 : 0);
      if (this.type === 'dodo') {
        this.model.rotation.z = Math.sin(this.walkPhase) * 0.08 * sf;
      }
    }

    dispose() {
      this.game.scene.remove(this.group);
      this.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
      if (this.label) {
        this.label.texture.dispose();
        this.label.material.dispose();
      }
    }
  }

  /* ------------------------ particles ------------------------ */
  class Particles {
    constructor(scene, max) {
      this.max = max || 300;
      this.pool = [];
      const pos = new Float32Array(this.max * 3);
      const col = new Float32Array(this.max * 3);
      const alpha = new Float32Array(this.max);
      const size = new Float32Array(this.max);
      for (let i = 0; i < this.max; i++) {
        this.pool.push({ active: false, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, grav: 1, size: 1, r: 1, g: 1, b: 1 });
        pos[i * 3 + 1] = -999;
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new T.BufferAttribute(col, 3));
      geo.setAttribute('aAlpha', new T.BufferAttribute(alpha, 1));
      geo.setAttribute('aSize', new T.BufferAttribute(size, 1));
      this.geo = geo;
      const material = new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader: `
          attribute vec3 aColor;
          attribute float aAlpha;
          attribute float aSize;
          varying vec3 vColor;
          varying float vAlpha;
          void main(){
            vColor = aColor;
            vAlpha = aAlpha;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * (260.0 / max(1.0, -mv.z));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          varying vec3 vColor;
          varying float vAlpha;
          void main(){
            vec2 d = gl_PointCoord - vec2(0.5);
            float a = smoothstep(0.5, 0.12, length(d));
            if (a < 0.03) discard;
            gl_FragColor = vec4(vColor, vAlpha * a);
          }`,
      });
      this.points = new T.Points(geo, material);
      this.points.frustumCulled = false;
      this.points.renderOrder = 10;
      scene.add(this.points);
    }

    burst(x, y, z, color, count, speed, opts) {
      opts = opts || {};
      const c = new T.Color(color);
      let spawned = 0;
      for (let i = 0; i < this.max && spawned < count; i++) {
        const p = this.pool[i];
        if (p.active) continue;
        p.active = true;
        p.x = x + (Math.random() - 0.5) * (opts.spread || 0.2);
        p.y = y + (Math.random() - 0.5) * (opts.spread || 0.2);
        p.z = z + (Math.random() - 0.5) * (opts.spread || 0.2);
        const a = Math.random() * Math.PI * 2;
        const up = opts.up != null ? opts.up : 1.5;
        const sp = speed * (0.4 + Math.random() * 0.8);
        p.vx = Math.cos(a) * sp;
        p.vz = Math.sin(a) * sp;
        p.vy = up * (0.5 + Math.random() * 0.8);
        p.maxLife = (opts.life || 0.8) * (0.7 + Math.random() * 0.6);
        p.life = p.maxLife;
        p.grav = opts.grav != null ? opts.grav : 6;
        p.size = (opts.size || 0.9) * (0.7 + Math.random() * 0.7);
        p.r = c.r * (0.8 + Math.random() * 0.4);
        p.g = c.g * (0.8 + Math.random() * 0.4);
        p.b = c.b * (0.8 + Math.random() * 0.4);
        spawned++;
      }
    }

    update(dt) {
      const pos = this.geo.attributes.position.array;
      const col = this.geo.attributes.aColor.array;
      const alpha = this.geo.attributes.aAlpha.array;
      const size = this.geo.attributes.aSize.array;
      for (let i = 0; i < this.max; i++) {
        const p = this.pool[i];
        if (!p.active) {
          alpha[i] = 0;
          continue;
        }
        p.life -= dt;
        if (p.life <= 0) {
          p.active = false;
          alpha[i] = 0;
          pos[i * 3 + 1] = -999;
          continue;
        }
        p.vy -= p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vx *= 1 - dt * 1.4;
        p.vz *= 1 - dt * 1.4;
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.y;
        pos[i * 3 + 2] = p.z;
        col[i * 3] = p.r;
        col[i * 3 + 1] = p.g;
        col[i * 3 + 2] = p.b;
        alpha[i] = U.clamp(p.life / p.maxLife, 0, 1) * 0.9;
        size[i] = p.size;
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
    }
  }

  /* -------------------------- rider -------------------------- */
  function buildRider() {
    const g = new T.Group();
    const skin = mat(0xb9855c);
    const shirt = mat(0x2d5c58);
    const pants = mat(0x3a3327);
    const hair = mat(0x2a1c14);
    const torso = new T.Mesh(new T.BoxGeometry(0.48, 0.68, 0.3), shirt);
    torso.position.y = 0.34;
    const head = new T.Mesh(new T.SphereGeometry(0.22, 8, 7), skin);
    head.position.y = 0.9;
    const hairMesh = new T.Mesh(new T.SphereGeometry(0.235, 8, 6), hair);
    hairMesh.position.set(0, 0.94, -0.03);
    hairMesh.scale.set(1, 0.8, 1);
    const armL = new T.Mesh(new T.BoxGeometry(0.12, 0.52, 0.14), skin);
    armL.position.set(0.32, 0.42, 0);
    armL.rotation.z = -0.25;
    const armR = armL.clone();
    armR.position.x = -0.32;
    armR.rotation.z = 0.25;
    const legL = new T.Mesh(new T.BoxGeometry(0.16, 0.55, 0.2), pants);
    legL.position.set(0.17, 0.02, 0.12);
    legL.rotation.x = 0.6;
    const legR = legL.clone();
    legR.position.x = -0.17;
    g.add(torso, head, hairMesh, armL, armR, legL, legR);
    g.scale.setScalar(0.95);
    return g;
  }

  window.Dino = Dino;
  window.Particles = Particles;
  window.buildRider = buildRider;
  window.DINO_CONFIG = DINO_CONFIG;
})();
