/* ============================================================
   PRIMAL ISLE — main game controller
   ============================================================ */
(function () {
  'use strict';

  const T = THREE;
  const U = window.U;
  const PI = window.PI;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }
  function lin(hex) {
    return new T.Color(hex).convertSRGBToLinear();
  }
  function mat(color, extra) {
    const opts = Object.assign({ color: lin(color), flatShading: true }, extra || {});
    if (opts.emissive != null) opts.emissive = lin(opts.emissive);
    return new T.MeshLambertMaterial(opts);
  }
  function box(w, h, d, color) {
    return new T.Mesh(new T.BoxGeometry(w, h, d), mat(color));
  }
  function cyl(rt, rb, h, color, seg) {
    return new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg || 7), mat(color));
  }
  function sph(r, color, seg) {
    return new T.Mesh(new T.SphereGeometry(r, seg || 9, Math.max(6, (seg || 9) - 2)), mat(color));
  }
  function ri(a, b) {
    return a + Math.floor(Math.random() * (b - a + 1));
  }

  class Game {
    constructor() {
      this.canvas = document.getElementById('scene');
      this.settings = this.loadSettings();
      this.saveMeta = this.readSave();

      this.player = this.createPlayer();
      this.inv = this.emptyInventory();
      this.tools = { hatchet: false, pickaxe: false, spear: false, torch: false };
      this.crafted = { saddle: false };
      this.selected = 0;
      this.dinos = [];
      this.mounted = null;
      this.particles = null;

      this.time = PI.DAY_START;
      this.day = 1;
      this.questIndex = 0;
      this.activated = false;
      this.quests = [
        {
          text: 'Colete 6 madeira e 4 pedra na praia.',
          done: 'Recursos básicos garantidos. A ilha começa a ceder.',
          reward: 25,
          test: () => this.inv.wood >= 6 && this.inv.stone >= 4,
        },
        {
          text: 'Crie um machado de pedra na mochila.',
          done: 'Machado pronto. As palmeiras não são mais um problema.',
          reward: 35,
          test: () => this.tools.hatchet,
        },
        {
          text: 'Crie e acenda uma fogueira para passar a noite.',
          done: 'A fogueira crepita. A noite parece menos hostil.',
          reward: 50,
          test: () => this.world && this.world.campfires.length > 0,
        },
        {
          text: 'Domestique um parassauro oferecendo frutas.',
          done: 'O parassauro confia em você. Agora ele segue seus passos.',
          reward: 80,
          test: () => this.dinos.some((d) => d.type === 'parasaur' && d.tamed && !d.dead),
        },
        {
          text: 'Crie uma sela e monte o parassauro.',
          done: 'Montaria conquistada. A ilha ficou muito menor.',
          reward: 110,
          test: () => !!this.mounted || this.dinos.some((d) => d.type === 'parasaur' && d.tamed && d.saddle && !d.dead),
        },
        {
          text: 'Sobreviva até o amanhecer do Dia 2.',
          done: 'A primeira noite terminou. Você ainda está vivo.',
          reward: 140,
          test: () => this.day >= 2,
        },
        {
          text: 'Siga o feixe turquesa e ative o obelisco no centro da ilha.',
          done: 'O obelisco despertou. A ilha inteira parece observá-lo.',
          reward: 300,
          test: () => this.activated,
        },
      ];

      this.keys = {};
      this.move = { x: 0, y: 0 };
      this.joy = null;
      this.lookPtr = null;
      this.sprint = false;
      this.moving = false;
      this.actionHeld = false;
      this.actionCd = 0;
      this.target = null;
      this.uiTimer = 0.15;
      this.targetTimer = 0;
      this.shake = 0;
      this.tiltRaw = null;
      this.tiltZero = null;
      this.tiltBaseYaw = 0;
      this.tiltBasePitch = -0.14;
      this.tiltListening = false;

      this.started = false;
      this.ready = false;
      this.playing = false;
      this.paused = false;
      this.dead = false;
      this.introTimer = null;
      this.yaw = 0;
      this.pitch = -0.14;
      this.zoom = 1;
      this.worldElapsed = 0;
      this.titleElapsed = 0;
      this.cookTimer = 0;
      this.autosave = 20;
      this.nightSpawnTimer = 20;
      this.nightWarned = false;
      this.lastSaveAt = 0;
      this.lastFrame = 0;
      this.camSmooth = new T.Vector3(0, 20, 20);
      this.camSnap = true;

      this.initRenderer();
      this.buildPlayerVisual();
      this.ui = new GameUI(this);
      this.ui.syncSettings(this.settings, this);
      this.ui.updateMenu(this.saveMeta);
      this.bindGlobalEvents();
      this.loopBound = this.loop.bind(this);
      this.boot();
      window.game = this;
    }

    /* ------------------------- basic state ------------------------ */
    createPlayer() {
      return {
        x: 0,
        y: 0,
        z: 0,
        renderY: 0,
        hp: 100,
        maxHp: 100,
        stamina: 100,
        maxStamina: 100,
        food: 100,
        water: 100,
        level: 1,
        xp: 0,
        air: 0,
        vy: 0,
        grounded: true,
        yaw: 0,
        alive: true,
        combat: 0,
        sprinting: false,
        stepPhase: 0,
        walkPhase: 0,
      };
    }

    emptyInventory() {
      const inv = {};
      Object.keys(PI.RES).forEach((k) => { inv[k] = 0; });
      return inv;
    }

    xpForNext() {
      return 100 + (this.player.level - 1) * 75;
    }

    inward() {
      const s = this.world ? this.world.spawn : { x: 0, z: 118 };
      const len = Math.hypot(s.x, s.z) || 1;
      return { x: -s.x / len, z: -s.z / len };
    }

    /* ------------------------- renderer --------------------------- */
    initRenderer() {
      this.scene = new T.Scene();
      this.scene.background = new T.Color(0x061110);
      this.scene.fog = new T.Fog(0xcfe7ee, 65, 340);

      this.camera = new T.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 900);
      this.camera.position.set(0, 24, 24);

      this.renderer = new T.WebGLRenderer({
        canvas: this.canvas,
        antialias: this.settings.quality !== 'low',
        powerPreference: 'high-performance',
      });
      this.renderer.setPixelRatio(this.pixelRatio());
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      if (T.sRGBEncoding) this.renderer.outputEncoding = T.sRGBEncoding;
      if (T.ACESFilmicToneMapping) {
        this.renderer.toneMapping = T.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.12;
      }
      this.renderer.shadowMap.enabled = false;

      this.torchLight = new T.PointLight(0xffa14d, 0, 15, 2);
      this.scene.add(this.torchLight);
    }

    pixelRatio() {
      const dpr = window.devicePixelRatio || 1;
      const q = this.settings.quality;
      if (q === 'high') return Math.min(dpr, 2.5);
      if (q === 'medium') return Math.min(dpr, 1.75);
      if (q === 'low') return 1;
      return U.isCoarse() ? Math.min(dpr, 1.6) : Math.min(dpr, 2);
    }

    applyQuality() {
      if (!this.renderer) return;
      this.renderer.setPixelRatio(this.pixelRatio());
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    }

    /* ------------------------- survivor model --------------------- */
    buildPlayerVisual() {
      const g = new T.Group();
      const model = new T.Group();
      g.add(model);

      const torso = box(0.5, 0.64, 0.3, 0x2f6e66);
      torso.position.y = 1.12;
      const belt = box(0.54, 0.1, 0.33, 0x4b3820);
      belt.position.y = 0.82;
      const chest = box(0.4, 0.25, 0.32, 0x3a7f73);
      chest.position.set(0, 1.24, 0.01);
      const neck = cyl(0.08, 0.1, 0.12, 0xb98255, 6);
      neck.position.y = 1.47;

      const head = sph(0.225, 0xc08a5e, 10);
      head.position.y = 1.62;
      const hair = sph(0.238, 0x2a1c14, 10);
      hair.position.set(0, 1.66, -0.025);
      hair.scale.set(1, 0.78, 1.02);
      const band = box(0.45, 0.09, 0.02, 0xd7a94e);
      band.position.set(0, 1.55, 0.21);
      const eyeL = box(0.035, 0.05, 0.02, 0x17110c);
      eyeL.position.set(0.08, 1.64, 0.212);
      const eyeR = eyeL.clone();
      eyeR.position.x = -0.08;
      const ponytail = cyl(0.07, 0.03, 0.26, 0x2a1c14, 5);
      ponytail.position.set(0, 1.5, -0.22);
      ponytail.rotation.x = -0.4;

      const pack = box(0.36, 0.42, 0.2, 0x5b4529);
      pack.position.set(0, 1.14, -0.23);
      const packTrim = box(0.38, 0.06, 0.21, 0xb58a48);
      packTrim.position.set(0, 1.24, -0.235);

      model.add(torso, belt, chest, neck, head, hair, band, eyeL, eyeR, ponytail, pack, packTrim);

      const armL = new T.Group();
      armL.position.set(-0.33, 1.38, 0);
      const upperL = box(0.13, 0.38, 0.15, 0x2f6e66);
      upperL.position.y = -0.18;
      const handL = sph(0.085, 0xc08a5e, 7);
      handL.position.y = -0.4;
      armL.add(upperL, handL);
      const armR = new T.Group();
      armR.position.set(0.33, 1.38, 0);
      const upperR = box(0.13, 0.38, 0.15, 0x2f6e66);
      upperR.position.y = -0.18;
      const handR = sph(0.085, 0xc08a5e, 7);
      handR.position.y = -0.4;
      armR.add(upperR, handR);
      model.add(armL, armR);

      const legL = new T.Group();
      legL.position.set(-0.135, 0.8, 0);
      const thighL = box(0.17, 0.38, 0.2, 0x3a3226);
      thighL.position.y = -0.18;
      const shinL = box(0.15, 0.36, 0.18, 0x2e2a21);
      shinL.position.y = -0.54;
      const footL = box(0.18, 0.12, 0.3, 0x241e17);
      footL.position.set(0, -0.74, 0.06);
      legL.add(thighL, shinL, footL);
      const legR = new T.Group();
      legR.position.set(0.135, 0.8, 0);
      const thighR = thighL.clone();
      thighR.position.y = -0.18;
      const shinR = shinL.clone();
      shinR.position.y = -0.54;
      const footR = footL.clone();
      footR.position.set(0, -0.74, 0.06);
      legR.add(thighR, shinR, footR);
      model.add(legL, legR);

      this.playerGroup = g;
      this.playerModel = model;
      this.playerArmL = armL;
      this.playerArmR = armR;
      this.playerLegL = legL;
      this.playerLegR = legR;
      this.scene.add(g);
      g.visible = false;

      this.buildHeldTools(model);
      this.buildPlayerShadow();
      this.rider = window.buildRider();
      this.rider.visible = false;
      this.scene.add(this.rider);
    }

    buildHeldTools(model) {
      const held = new T.Group();
      held.position.set(0.39, 0.94, 0.2);
      held.rotation.set(-0.12, 0, -0.12);
      model.add(held);
      this.heldGroup = held;
      this.heldItems = {};

      const hatchet = new T.Group();
      const haft = cyl(0.032, 0.038, 0.7, 0x6b4a2a, 6);
      const head = box(0.26, 0.14, 0.075, 0x8b8a7d);
      head.position.set(0.07, 0.32, 0);
      const blade = box(0.12, 0.19, 0.055, 0xa6a496);
      blade.position.set(0.2, 0.32, 0);
      hatchet.add(haft, head, blade);
      hatchet.visible = false;

      const pickaxe = new T.Group();
      const shaft = cyl(0.032, 0.038, 0.74, 0x6b4a2a, 6);
      const bar = box(0.6, 0.085, 0.085, 0x8b8a7d);
      bar.position.y = 0.34;
      const tipL = new T.Mesh(new T.ConeGeometry(0.07, 0.26, 4), mat(0xb0ae9f));
      tipL.position.set(-0.36, 0.34, 0);
      tipL.rotation.z = Math.PI / 2;
      const tipR = tipL.clone();
      tipR.position.x = 0.36;
      tipR.rotation.z = -Math.PI / 2;
      pickaxe.add(shaft, bar, tipL, tipR);
      pickaxe.visible = false;

      const spear = new T.Group();
      const shaftS = cyl(0.026, 0.034, 1.75, 0x7a5835, 6);
      shaftS.position.y = 0.12;
      const spearTip = new T.Mesh(new T.ConeGeometry(0.085, 0.34, 5), mat(0xc7c5b4));
      spearTip.position.y = 1.12;
      const wrap = box(0.06, 0.13, 0.06, 0xc99a4c);
      wrap.position.y = 0.92;
      spear.add(shaftS, spearTip, wrap);
      spear.visible = false;

      const torch = new T.Group();
      const torchStick = cyl(0.032, 0.042, 0.55, 0x5a3d24, 6);
      torchStick.position.y = -0.05;
      const flame = new T.Mesh(
        new T.ConeGeometry(0.14, 0.38, 6),
        new T.MeshBasicMaterial({ color: 0xffa23d, transparent: true, opacity: 0.95, toneMapped: false })
      );
      flame.position.y = 0.4;
      const flameCore = new T.Mesh(
        new T.ConeGeometry(0.075, 0.24, 5),
        new T.MeshBasicMaterial({ color: 0xffe9a1, transparent: true, opacity: 0.95, toneMapped: false })
      );
      flameCore.position.y = 0.43;
      torch.add(torchStick, flame, flameCore);
      torch.visible = false;

      held.add(hatchet, pickaxe, spear, torch);
      this.heldItems.hatchet = hatchet;
      this.heldItems.pickaxe = pickaxe;
      this.heldItems.spear = spear;
      this.heldItems.torch = torch;
    }

    buildPlayerShadow() {
      const shadowMat = new T.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
      });
      const shadow = new T.Mesh(new T.CircleGeometry(0.52, 18), shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.renderOrder = 1;
      shadow.visible = false;
      this.playerShadow = shadow;
      this.scene.add(shadow);
    }

    /* --------------------------- boot ----------------------------- */
    async boot() {
      try {
        this.ui.bootText('GERANDO A ILHA…');
        await nextFrame();
        await sleep(40);
        this.world = new World(this.scene, 20261030);
        this.world.colliders.push({ x: 0, z: 0, r: 10.8 });

        this.ui.bootText('PLANTANDO PALMEIRAS…');
        await nextFrame();
        await sleep(55);
        this.particles = new Particles(this.scene, 320);
        this.spawnDefaultDinos();
        this.placePlayerAtSpawn();

        this.ui.bootText('ACORDANDO OS DINOSSAUROS…');
        await nextFrame();
        await sleep(70);
        this.enterTitleMode();

        this.ui.bootText('POLINDO O OBELISCO…');
        await nextFrame();
        await sleep(110);

        this.ready = true;
        this.lastFrame = performance.now();
        requestAnimationFrame(this.loopBound);
        this.ui.el.boot.classList.add('fade');
        setTimeout(() => this.ui.el.boot.classList.add('hidden'), 720);
      } catch (err) {
        console.error('[Primal Isle] Falha ao iniciar:', err);
        this.ui.bootText('NÃO FOI POSSÍVEL GERAR A ILHA. RECARREGUE A PÁGINA.');
      }
    }

    spawnDinoAt(type, pos, opts) {
      const dino = new Dino(this, type, pos.x, pos.z, opts || {});
      this.dinos.push(dino);
      return dino;
    }

    findWildPoint(minDist, maxDist) {
      const s = this.world.spawn;
      for (let i = 0; i < 90; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = minDist + Math.random() * (maxDist - minDist);
        const x = s.x + Math.cos(a) * d;
        const z = s.z + Math.sin(a) * d;
        const h = this.world.heightAt(x, z);
        if (h < 1.5 || h > 15) continue;
        if (this.world.slopeAt(x, z) > 1.05) continue;
        if (Math.hypot(x, z) < 16) continue;
        if (Math.hypot(x - s.x, z - s.z) < minDist * 0.8) continue;
        return { x, z, h };
      }
      return null;
    }

    spawnDefaultDinos() {
      this.clearDinos();
      const s = this.world.spawn;
      const inward = this.inward();
      const perp = { x: -inward.z, z: inward.x };
      const pos = (dist, side) => {
        let x = s.x + inward.x * dist + perp.x * side;
        let z = s.z + inward.z * dist + perp.z * side;
        let h = this.world.heightAt(x, z);
        if (h < 1.1 || h > 13) {
          const p = this.findWildPoint(8, 26);
          if (p) {
            x = p.x;
            z = p.z;
            h = p.h;
          }
        }
        return { x, z, h };
      };

      this.spawnDinoAt('parasaur', pos(18, 6), { name: 'Parassauro', taming: 0, yaw: Math.random() * 6.28 });
      this.spawnDinoAt('parasaur', pos(25, -9), { name: 'Parassauro', taming: 0, yaw: Math.random() * 6.28 });
      for (let i = 0; i < 4; i++) {
        this.spawnDinoAt('dodo', pos(6 + i * 4.2, (i % 2 ? 1 : -1) * (3.5 + i * 1.8)), { yaw: Math.random() * 6.28 });
      }
      for (let i = 0; i < 2; i++) {
        const p = this.findWildPoint(34, 72) || this.findWildPoint(20, 46) || pos(18, i ? 12 : -12);
        this.spawnDinoAt('raptor', p, { yaw: Math.random() * 6.28 });
      }
    }

    clearDinos() {
      this.mounted = null;
      if (this.rider) this.rider.visible = false;
      this.dinos.forEach((d) => d.dispose());
      this.dinos = [];
    }

    clearCampfires() {
      if (!this.world) return;
      this.world.campfires.slice().forEach((f) => this.world.removeCampfire(f));
    }

    placePlayerAtSpawn() {
      if (!this.world) return;
      const s = this.world.spawn;
      const p = this.player;
      p.x = s.x;
      p.z = s.z;
      p.y = this.world.heightAt(s.x, s.z);
      p.renderY = p.y;
      p.air = 0;
      p.vy = 0;
      p.grounded = true;
      const inward = this.inward();
      p.yaw = Math.atan2(-inward.z, inward.x) + 0.18;
      this.yaw = p.yaw;
      this.pitch = -0.14;
    }

    /* -------------------------- title ----------------------------- */
    enterTitleMode() {
      this.playing = false;
      this.paused = false;
      this.dead = false;
      this.player.alive = true;
      this.actionHeld = false;
      this.sprint = false;
      if (this.mounted) this.dismount(false);
      this.endJoystick();
      this.playerGroup.visible = false;
      this.playerShadow.visible = false;
      this.rider.visible = false;
      this.ui.setHUD(false);
      this.ui.hide('pause');
      this.ui.hide('craft');
      this.ui.hide('death');
      this.ui.show('menu');
      this.ui.hideIntro();
      this.ui.setTarget(null);
      this.ui.setAction({ icon: '✊', label: 'COLETAR', disabled: true });
      this.dinos.forEach((d) => {
        if (d.label) d.label.sprite.visible = !d.dead;
      });
      this.world.setDayTime(0.715);
      this.titleElapsed = 0;
      this.camera.fov = 55;
      this.camera.updateProjectionMatrix();
      this.updateTitleCamera(0, true);
    }

    updateTitleCamera(dt, snap) {
      if (!this.world) return;
      this.titleElapsed += dt;
      const s = this.world.spawn;
      const inward = this.inward();
      const perp = { x: -inward.z, z: inward.x };
      const sway = Math.sin(this.titleElapsed * 0.07) * 9 + Math.sin(this.titleElapsed * 0.023) * 5;
      const desired = new T.Vector3(
        s.x - inward.x * 34 + perp.x * sway,
        Math.max(7.4, s.y + 6.4),
        s.z - inward.z * 34 + perp.z * sway
      );
      const look = new T.Vector3(
        s.x + inward.x * 25,
        s.y + 5.4 + Math.sin(this.titleElapsed * 0.09) * 0.7,
        s.z + inward.z * 25
      );
      if (snap) this.camera.position.copy(desired);
      else this.camera.position.lerp(desired, 1 - Math.exp(-1.25 * dt));
      this.camera.lookAt(look);
    }

    /* ------------------------ game states ------------------------- */
    startPlaying() {
      this.ui.hide('menu');
      this.ui.hide('pause');
      this.ui.hide('craft');
      this.ui.hide('death');
      this.playing = true;
      this.paused = false;
      this.dead = false;
      this.started = true;
      this.player.alive = true;
      this.playerGroup.visible = true;
      this.playerShadow.visible = true;
      this.ui.setHUD(true);
      this.ui.showIntro(this.day);
      clearTimeout(this.introTimer);
      this.introTimer = setTimeout(() => this.ui.hideIntro(), 2900);
      this.world.setDayTime(this.time);
      this.dinos.forEach((d) => {
        if (d.label) d.label.sprite.visible = !d.dead && !d.mounted;
      });
      this.camera.fov = 58;
      this.camera.updateProjectionMatrix();
      this.camSnap = true;
      this.updateCamera(0.016);
      this.updateTarget();
      this.ui.updateHUD(this);
      this.lastFrame = performance.now();
      if (this.settings.sound) Sfx.init();
      Sfx.setMuted(!this.settings.sound);
      Sfx.chime();
    }

    newGame() {
      if (this.saveMeta) {
        const ok = window.confirm('Começar uma nova expedição? O progresso salvo será apagado.');
        if (!ok) return;
      }
      try { localStorage.removeItem(PI.SAVE_KEY); } catch (e) {}
      this.saveMeta = null;
      this.ui.updateMenu(null);
      this.resetState();
      this.startPlaying();
      this.ui.toast('Nova expedição. Colete madeira e pedra na praia.', 'good');
      this.saveGame(false);
    }

    continueGame() {
      const save = this.readSave();
      if (!save) {
        this.ui.updateMenu(null);
        this.ui.toast('Nenhuma expedição salva encontrada.', 'bad');
        return;
      }
      this.applySaveState(save);
      this.startPlaying();
      this.ui.toast('Expedição restaurada. O Dia ' + this.day + ' continua.', 'good');
    }

    applySaveState(save) {
      this.clearDinos();
      this.clearCampfires();
      this.mounted = null;
      if (this.rider) this.rider.visible = false;

      this.inv = this.emptyInventory();
      if (save.inv && typeof save.inv === 'object') {
        Object.keys(this.inv).forEach((k) => {
          const n = Number(save.inv[k]);
          if (isFinite(n) && n > 0) this.inv[k] = Math.floor(n);
        });
      }
      this.tools = { hatchet: false, pickaxe: false, spear: false, torch: false };
      if (save.tools) Object.keys(this.tools).forEach((k) => { this.tools[k] = !!save.tools[k]; });
      this.crafted = { saddle: !!(save.crafted && save.crafted.saddle) };
      this.selected = U.clamp(Math.floor(Number(save.selected) || 0), 0, PI.HOTBAR.length - 1);

      this.time = Number(save.time);
      if (!isFinite(this.time) || this.time < 0 || this.time >= 1) this.time = PI.DAY_START;
      this.day = Math.max(1, Math.floor(Number(save.day) || 1));
      this.questIndex = U.clamp(Math.floor(Number(save.questIndex) || 0), 0, this.quests.length);
      this.activated = !!save.activated;

      const p = this.createPlayer();
      p.level = Math.max(1, Math.floor(Number(save.level) || 1));
      p.xp = Math.max(0, Number(save.xp) || 0);
      p.maxHp = 100 + (p.level - 1) * 8;
      p.maxStamina = 100 + (p.level - 1) * 4;
      p.hp = U.clamp(Number(save.hp) || p.maxHp, 1, p.maxHp);
      p.stamina = U.clamp(Number(save.stamina) || p.maxStamina, 0, p.maxStamina);
      p.food = U.clamp(Number(save.food != null ? save.food : 100), 0, 100);
      p.water = U.clamp(Number(save.water != null ? save.water : 100), 0, 100);
      p.alive = true;
      this.player = p;

      const px = Number(save.px);
      const pz = Number(save.pz);
      if (isFinite(px) && isFinite(pz) && this.world.heightAt(px, pz) > -0.4) {
        p.x = px;
        p.z = pz;
        p.y = this.world.heightAt(px, pz);
      } else {
        this.placePlayerAtSpawn();
      }
      const inward = this.inward();
      p.yaw = Math.atan2(-inward.z, inward.x) + 0.18;
      this.yaw = p.yaw;
      this.pitch = -0.14;

      this.world.nodes.forEach((n) => {
        if (!n.alive) this.world.restoreNode(n);
      });
      const looted = Array.isArray(save.crates) ? save.crates : [];
      this.world.crates.forEach((c) => {
        c.looted = looted.indexOf(c.id) >= 0;
        c.group.visible = !c.looted;
      });

      if (Array.isArray(save.dinos) && save.dinos.length) {
        save.dinos.forEach((sd) => {
          if (!sd || ['parasaur', 'raptor', 'dodo'].indexOf(sd.type) < 0) return;
          const d = this.spawnDinoAt(sd.type, { x: Number(sd.x) || 0, z: Number(sd.z) || 0 }, {
            name: sd.name,
            tamed: !!sd.tamed,
            taming: U.clamp(Number(sd.taming) || 0, 0, 100),
            yaw: Number(sd.yaw) || 0,
          });
          if (Number(sd.hp) > 0) d.hp = Math.min(d.maxHp, Number(sd.hp));
          if (sd.saddle) d.setSaddled(true);
          d.refreshLabel();
        });
      } else {
        this.spawnDefaultDinos();
      }

      if (Array.isArray(save.campfires)) {
        save.campfires.forEach((cf) => {
          if (cf && isFinite(cf.x) && isFinite(cf.z)) this.world.addCampfire(Number(cf.x), Number(cf.z));
        });
      }

      this.world.setDayTime(this.time);
      this.cookTimer = 0;
      this.autosave = 20;
      this.lastSaveAt = Number(save.at) || Date.now();
      this.saveMeta = save;
      this.playerGroup.visible = false;
      this.playerShadow.visible = false;
      this.ui.updateMenu(save);
    }

    resetState() {
      if (this.mounted) this.dismount(false);
      this.clearDinos();
      this.clearCampfires();
      this.inv = this.emptyInventory();
      this.tools = { hatchet: false, pickaxe: false, spear: false, torch: false };
      this.crafted = { saddle: false };
      this.selected = 0;
      this.player = this.createPlayer();
      this.time = PI.DAY_START;
      this.day = 1;
      this.questIndex = 0;
      this.activated = false;
      this.cookTimer = 0;
      this.autosave = 20;
      this.nightSpawnTimer = 20;
      this.nightWarned = false;
      this.lastSaveAt = 0;
      this.started = false;
      this.world.nodes.forEach((n) => {
        if (!n.alive) this.world.restoreNode(n);
      });
      this.world.crates.forEach((c) => {
        c.looted = false;
        c.group.visible = true;
      });
      this.spawnDefaultDinos();
      this.placePlayerAtSpawn();
      this.playerGroup.visible = false;
      this.playerShadow.visible = false;
      this.rider.visible = false;
      this.mounted = null;
      this.saveMeta = null;
      this.ui.updateMenu(null);
    }

    /* --------------------------- save ----------------------------- */
    saveGame(silent) {
      if ((!this.started && !this.playing) || this.dead) return;
      const p = this.player;
      const save = {
        v: 2,
        at: Date.now(),
        day: this.day,
        time: this.time,
        level: p.level,
        xp: p.xp,
        hp: p.hp,
        stamina: p.stamina,
        food: p.food,
        water: p.water,
        px: p.x,
        pz: p.z,
        selected: this.selected,
        inv: Object.assign({}, this.inv),
        tools: Object.assign({}, this.tools),
        crafted: Object.assign({}, this.crafted),
        questIndex: this.questIndex,
        activated: this.activated,
        crates: this.world.crates.filter((c) => c.looted).map((c) => c.id),
        campfires: this.world.campfires.map((c) => ({ x: c.x, z: c.z })),
        dinos: this.dinos
          .filter((d) => !d.dead)
          .map((d) => ({
            type: d.type,
            name: d.name,
            tamed: !!d.tamed,
            taming: d.taming || 0,
            saddle: !!d.saddle,
            hp: d.hp,
            x: d.x,
            z: d.z,
            yaw: d.yaw,
          })),
      };
      try {
        localStorage.setItem(PI.SAVE_KEY, JSON.stringify(save));
        this.saveMeta = save;
        this.lastSaveAt = save.at;
        this.autosave = 20;
        this.ui.updateMenu(save);
        this.ui.saveNote();
        if (!silent) this.ui.toast('Progresso salvo.', 'good');
      } catch (e) {
        if (!silent) this.ui.toast('Não foi possível salvar neste dispositivo.', 'bad');
      }
    }

    readSave() {
      try {
        const raw = localStorage.getItem(PI.SAVE_KEY);
        if (!raw) return null;
        const save = JSON.parse(raw);
        if (!save || save.v !== 2) return null;
        return save;
      } catch (e) {
        return null;
      }
    }

    /* ------------------------- settings --------------------------- */
    loadSettings() {
      const def = { sens: 1, tilt: false, sound: true, quality: 'auto', haptic: true };
      try {
        const raw = localStorage.getItem(PI.SETTINGS_KEY);
        if (raw) {
          const s = JSON.parse(raw);
          if (s && typeof s === 'object') {
            if (isFinite(s.sens)) def.sens = U.clamp(Number(s.sens), 0.4, 2);
            if (typeof s.sound === 'boolean') def.sound = s.sound;
            if (['auto', 'high', 'medium', 'low'].indexOf(s.quality) >= 0) def.quality = s.quality;
            if (typeof s.haptic === 'boolean') def.haptic = s.haptic;
          }
        }
      } catch (e) {}
      def.tilt = false;
      return def;
    }

    saveSettings() {
      try {
        localStorage.setItem(PI.SETTINGS_KEY, JSON.stringify({
          sens: this.settings.sens,
          sound: this.settings.sound,
          quality: this.settings.quality,
          haptic: this.settings.haptic,
        }));
      } catch (e) {}
    }

    setSensitivity(v) {
      this.settings.sens = U.clamp(v || 1, 0.4, 2);
      this.ui.el.sensOut.textContent = Number(this.settings.sens).toFixed(1) + '×';
      this.saveSettings();
    }

    setQuality(q) {
      if (['auto', 'high', 'medium', 'low'].indexOf(q) < 0) return;
      this.settings.quality = q;
      this.applyQuality();
      this.saveSettings();
      this.ui.syncSettings(this.settings, this);
      this.ui.toast('Qualidade gráfica: ' + q.toUpperCase(), 'good');
      Sfx.ui();
    }

    setSound(on) {
      this.settings.sound = !!on;
      if (this.settings.sound) Sfx.init();
      Sfx.setMuted(!this.settings.sound);
      this.saveSettings();
      this.ui.setToggle(this.ui.el.sound, this.settings.sound);
      Sfx.ui();
    }

    setHaptic(on) {
      this.settings.haptic = !!on;
      this.saveSettings();
      this.ui.setToggle(this.ui.el.haptic, this.settings.haptic);
      if (this.settings.haptic) U.vibrate(20);
    }

    async toggleTilt() {
      Sfx.init();
      if (this.settings.tilt) {
        window.removeEventListener('deviceorientation', this.onDeviceOrientation);
        this.tiltListening = false;
        this.settings.tilt = false;
        this.saveSettings();
        this.ui.setTiltUI(this.settings, 'Inclinação desligada. O arraste continua funcionando.');
        this.ui.toast('Inclinação desligada.', 'good');
        return;
      }
      if (typeof window.DeviceOrientationEvent === 'undefined') {
        this.ui.setTiltUI(this.settings, 'Este dispositivo não expõe sensores de inclinação.');
        this.ui.toast('Giroscópio não disponível neste dispositivo.', 'bad');
        return;
      }
      try {
        if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
          const answer = await window.DeviceOrientationEvent.requestPermission();
          if (answer !== 'granted') {
            this.ui.setTiltUI(this.settings, 'Permissão de movimento negada. A inclinação continua desligada.');
            this.ui.toast('Permissão de movimento negada.', 'bad');
            return;
          }
        }
      } catch (e) {
        this.ui.setTiltUI(this.settings, 'Não foi possível pedir permissão de movimento.');
        this.ui.toast('Permissão de movimento indisponível.', 'bad');
        return;
      }
      if (!this.tiltListening) {
        this.onDeviceOrientation = this.onDeviceOrientation || ((e) => this.handleOrientation(e));
        window.addEventListener('deviceorientation', this.onDeviceOrientation, true);
        this.tiltListening = true;
      }
      this.settings.tilt = true;
      this.saveSettings();
      this.calibrateTilt(true);
      this.ui.setTiltUI(this.settings);
      this.ui.toast('Inclinação ativada. Incline o aparelho para olhar.', 'good');
      Sfx.chime();
    }

    handleOrientation(e) {
      if (e.beta == null && e.gamma == null) return;
      let gamma = Number(e.gamma) || 0;
      let beta = Number(e.beta) || 0;
      const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      let x = gamma;
      let y = beta;
      if (angle === 90) {
        x = beta;
        y = -gamma;
      } else if (angle === -90 || angle === 270) {
        x = -beta;
        y = gamma;
      } else if (angle === 180) {
        x = -gamma;
        y = -beta;
      }
      this.tiltRaw = { x: x, y: y };
      if (!this.tiltZero) this.calibrateTilt(true);
    }

    calibrateTilt(silent) {
      const raw = this.tiltRaw || { x: 0, y: 0 };
      this.tiltZero = { x: raw.x, y: raw.y };
      this.tiltBaseYaw = this.yaw;
      this.tiltBasePitch = this.pitch;
      if (!silent) {
        this.ui.toast('Inclinação centralizada.', 'good');
        Sfx.ui();
      }
    }

    updateTilt(dt) {
      if (!this.settings.tilt || !this.tiltRaw || !this.tiltZero) return;
      const dx = this.tiltRaw.x - this.tiltZero.x;
      const dy = this.tiltRaw.y - this.tiltZero.y;
      const targetYaw = this.tiltBaseYaw + U.clamp(dx, -55, 55) * 0.018;
      const targetPitch = U.clamp(this.tiltBasePitch - U.clamp(dy, -55, 55) * 0.012, -0.68, 0.5);
      const k = 1 - Math.exp(-9 * dt);
      this.yaw = U.angleLerp(this.yaw, targetYaw, k);
      this.pitch = U.damp(this.pitch, targetPitch, 9, dt);
    }

    /* ------------------------- overlays --------------------------- */
    openPause() {
      if (this.dead) return;
      Sfx.init();
      Sfx.ui();
      this.wasPlaying = this.playing;
      if (this.playing) this.paused = true;
      this.actionUp();
      this.sprint = false;
      this.ui.el.btnSprint.classList.remove('on');
      this.endJoystick();
      this.ui.syncSettings(this.settings, this);
      this.ui.show('pause');
      if (this.playing) this.ui.updateHUD(this);
    }

    closePause() {
      this.ui.hide('pause');
      if (this.playing) this.paused = false;
      this.lastFrame = performance.now();
      Sfx.ui();
      if (this.playing && !this.ui.el.craft.classList.contains('hidden')) this.paused = true;
      if (this.playing) this.updateTarget();
    }

    getTameDino() {
      const p = this.player;
      const paras = this.dinos.filter((d) => d.type === 'parasaur' && !d.dead);
      if (!paras.length) return null;
      const tamed = paras.find((d) => d.tamed);
      if (tamed) return tamed;
      return paras.reduce((a, b) => {
        const da = p ? Math.hypot(a.x - p.x, a.z - p.z) : 0;
        const db = p ? Math.hypot(b.x - p.x, b.z - p.z) : 0;
        return db < da ? b : a;
      });
    }

    openCraft() {
      if (!this.playing || this.dead) return;
      Sfx.ui();
      this.paused = true;
      this.actionUp();
      this.endJoystick();
      this.ui.renderCraft(this);
      this.ui.show('craft');
    }

    closeCraft() {
      this.ui.hide('craft');
      if (this.playing && this.ui.el.pause.classList.contains('hidden')) this.paused = false;
      this.lastFrame = performance.now();
      Sfx.ui();
      if (this.playing) this.updateTarget();
    }

    returnToTitle() {
      if (!this.playing) {
        this.closePause();
        return;
      }
      if (this.mounted) this.dismount(false);
      this.saveGame(false);
      clearTimeout(this.introTimer);
      this.enterTitleMode();
      this.ui.updateMenu(this.readSave());
      Sfx.ui();
    }

    wipeProgress() {
      const ok = window.confirm('Apagar todo o progresso salvo? Esta ação não pode ser desfeita.');
      if (!ok) return;
      try { localStorage.removeItem(PI.SAVE_KEY); } catch (e) {}
      this.saveMeta = null;
      this.started = false;
      this.playing = false;
      this.paused = false;
      this.dead = false;
      this.lastSaveAt = 0;
      this.ui.updateMenu(null);
      this.resetState();
      this.enterTitleMode();
      this.ui.updateMenu(null);
      this.ui.toast('Progresso apagado. A ilha espera por um novo sobrevivente.', 'bad');
    }

    /* --------------------------- input ---------------------------- */
    bindGlobalEvents() {
      window.addEventListener('resize', () => this.resize());
      window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 220));
      window.addEventListener('keydown', (e) => this.onKeyDown(e));
      window.addEventListener('keyup', (e) => this.onKeyUp(e));
      window.addEventListener('pointerdown', (e) => this.onPointerDown(e));
      window.addEventListener('pointermove', (e) => this.onPointerMove(e), { passive: false });
      window.addEventListener('pointerup', (e) => this.onPointerUp(e));
      window.addEventListener('pointercancel', (e) => this.onPointerUp(e));
      window.addEventListener('blur', () => {
        this.keys = {};
        this.sprint = false;
        this.ui.el.btnSprint.classList.remove('on');
        this.actionUp();
        this.endJoystick();
        this.lookPtr = null;
      });
      window.addEventListener('contextmenu', (e) => {
        if (this.playing) e.preventDefault();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          if (this.playing) this.saveGame(true);
        } else {
          this.lastFrame = performance.now();
        }
      });
      window.addEventListener('pagehide', () => {
        if (this.started) this.saveGame(true);
      });
      const unlock = () => {
        Sfx.init();
        if (!this.settings.sound) Sfx.setMuted(true);
      };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    }

    resize() {
      if (!this.renderer || !this.camera) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(this.pixelRatio());
      this.renderer.setSize(w, h, false);
      this.lastFrame = performance.now();
    }

    onKeyDown(e) {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      const code = e.code;
      if (code === 'Escape') {
        e.preventDefault();
        if (!this.ui.el.death.classList.contains('hidden')) return;
        if (!this.ui.el.craft.classList.contains('hidden')) return this.closeCraft();
        if (!this.ui.el.pause.classList.contains('hidden')) return this.closePause();
        if (this.playing) this.openPause();
        return;
      }
      if (code === 'KeyC' || code === 'KeyB') {
        if (e.repeat) return;
        e.preventDefault();
        if (!this.playing || this.dead) return;
        if (!this.ui.el.craft.classList.contains('hidden')) this.closeCraft();
        else this.openCraft();
        return;
      }
      if (!this.playing || this.paused || this.dead) return;
      if (code === 'KeyW' || code === 'ArrowUp' || code === 'KeyA' || code === 'ArrowLeft' ||
          code === 'KeyS' || code === 'ArrowDown' || code === 'KeyD' || code === 'ArrowRight') {
        this.keys[code] = true;
        e.preventDefault();
      } else if (code === 'KeyE' || code === 'KeyF') {
        if (!e.repeat) this.actionDown();
        e.preventDefault();
      } else if (code === 'Space') {
        if (!e.repeat) this.jump();
        e.preventDefault();
      } else if (code === 'ShiftLeft' || code === 'ShiftRight') {
        this.setSprint(true);
        e.preventDefault();
      } else if (/^Digit[1-8]$/.test(code)) {
        this.selectSlot(parseInt(code.slice(5), 10) - 1);
        e.preventDefault();
      }
    }

    onKeyUp(e) {
      const code = e.code;
      if (code === 'KeyW' || code === 'ArrowUp' || code === 'KeyA' || code === 'ArrowLeft' ||
          code === 'KeyS' || code === 'ArrowDown' || code === 'KeyD' || code === 'ArrowRight') {
        this.keys[code] = false;
      } else if (code === 'KeyE' || code === 'KeyF') {
        this.actionUp();
      } else if (code === 'ShiftLeft' || code === 'ShiftRight') {
        this.setSprint(false);
      }
    }

    onPointerDown(e) {
      if (!this.playing || this.paused || this.dead) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const target = e.target;
      if (target && target.closest && target.closest('button, .screen, #hotbar, input, select, textarea')) return;
      Sfx.init();
      if (!this.settings.sound) Sfx.setMuted(true);
      const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
      if (touch && target && target.closest && target.closest('#joy-zone')) {
        this.startJoystick(e);
        e.preventDefault();
        return;
      }
      if (this.lookPtr) return;
      this.lookPtr = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: touch };
      if (this.canvas) this.canvas.style.cursor = 'grabbing';
      if (touch) e.preventDefault();
    }

    onPointerMove(e) {
      if (this.lookPtr && this.lookPtr.id === e.pointerId) {
        const dx = e.clientX - this.lookPtr.x;
        const dy = e.clientY - this.lookPtr.y;
        this.lookPtr.x = e.clientX;
        this.lookPtr.y = e.clientY;
        this.applyLook(dx, dy, this.lookPtr.touch);
        if (e.cancelable) e.preventDefault();
      } else if (this.joy && this.joy.id === e.pointerId) {
        this.moveJoystick(e.clientX, e.clientY);
        if (e.cancelable) e.preventDefault();
      }
    }

    onPointerUp(e) {
      if (this.lookPtr && this.lookPtr.id === e.pointerId) {
        this.lookPtr = null;
        if (this.canvas) this.canvas.style.cursor = '';
      }
      if (this.joy && this.joy.id === e.pointerId) this.endJoystick();
    }

    applyLook(dx, dy, touch) {
      const sens = this.settings.sens * (touch ? 0.0044 : 0.0031);
      this.yaw += dx * sens;
      this.pitch = U.clamp(this.pitch - dy * sens, -0.68, 0.5);
      if (this.settings.tilt && this.tiltRaw) {
        this.tiltZero = { x: this.tiltRaw.x, y: this.tiltRaw.y };
        this.tiltBaseYaw = this.yaw;
        this.tiltBasePitch = this.pitch;
      }
    }

    startJoystick(e) {
      const el = this.ui.el.joystick;
      const size = el.offsetWidth || 108;
      const cx = U.clamp(e.clientX, size / 2 + 8, window.innerWidth - size / 2 - 8);
      const cy = U.clamp(e.clientY, size / 2 + 8, window.innerHeight - size / 2 - 8);
      el.style.left = cx - size / 2 + 'px';
      el.style.top = cy - size / 2 + 'px';
      el.style.bottom = 'auto';
      el.classList.remove('hidden');
      el.classList.add('active');
      const knob = el.querySelector('.joy-knob');
      if (knob) knob.style.transform = 'translate(0px,0px)';
      this.joy = { id: e.pointerId, baseX: cx, baseY: cy, radius: size * 0.34, el: el, knob: knob };
      this.move.x = 0;
      this.move.y = 0;
    }

    moveJoystick(x, y) {
      const joy = this.joy;
      if (!joy) return;
      const dx = x - joy.baseX;
      const dy = y - joy.baseY;
      const len = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(len, joy.radius);
      const k = clamped / len;
      if (joy.knob) joy.knob.style.transform = 'translate(' + dx * k + 'px,' + dy * k + 'px)';
      let mx = dx / joy.radius;
      let my = -dy / joy.radius;
      const mag = Math.hypot(mx, my);
      if (mag > 1) {
        mx /= mag;
        my /= mag;
      }
      this.move.x = mx;
      this.move.y = my;
    }

    endJoystick() {
      if (!this.joy) return;
      const el = this.joy.el;
      const knob = this.joy.knob;
      if (knob) knob.style.transform = 'translate(0px,0px)';
      el.classList.remove('active');
      el.classList.add('hidden');
      this.joy = null;
      this.move.x = 0;
      this.move.y = 0;
    }

    getMoveInput() {
      let x = this.move.x;
      let y = this.move.y;
      if (this.keys.KeyW || this.keys.ArrowUp) y += 1;
      if (this.keys.KeyS || this.keys.ArrowDown) y -= 1;
      if (this.keys.KeyD || this.keys.ArrowRight) x += 1;
      if (this.keys.KeyA || this.keys.ArrowLeft) x -= 1;
      let mag = Math.hypot(x, y);
      if (mag > 1) {
        x /= mag;
        y /= mag;
        mag = 1;
      }
      return { x: x, y: y, mag: mag };
    }

    setSprint(on) {
      this.sprint = !!on;
      this.ui.el.btnSprint.classList.toggle('on', this.sprint);
    }

    jump() {
      if (!this.playing || this.paused || this.dead) return;
      const p = this.player;
      if (this.mounted) return;
      if (!p.grounded) return;
      p.vy = 6.3;
      p.grounded = false;
      p.stamina = Math.max(0, p.stamina - 6);
      if (this.settings.haptic) U.vibrate(12);
      Sfx.step(this.world.heightAt(p.x, p.z) < 2.1 ? 'sand' : 'grass');
    }

    /* ------------------------- movement --------------------------- */
    resolveCollisions(x, z, radius) {
      const list = this.world.colliders;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const dx = x - c.x;
        const dz = z - c.z;
        const min = c.r + radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min) {
          const d = Math.sqrt(d2) || 0.0001;
          x = c.x + (dx / d) * min;
          z = c.z + (dz / d) * min;
        }
      }
      return { x: x, z: z };
    }

    updateMovement(dt) {
      const p = this.player;
      const input = this.getMoveInput();
      const moving = input.mag > 0.08 && !this.dead;
      this.moving = moving;
      const sprinting = this.sprint && moving && p.stamina > 1;
      p.sprinting = sprinting;

      const fwdX = Math.sin(this.yaw);
      const fwdZ = Math.cos(this.yaw);
      const rightX = Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);

      if (this.mounted) {
        const d = this.mounted;
        const speed = sprinting ? 11.2 : 6.9;
        if (moving) {
          const dirX = fwdX * input.y + rightX * input.x;
          const dirZ = fwdZ * input.y + rightZ * input.x;
          const nx = d.x + dirX * speed * dt;
          const nz = d.z + dirZ * speed * dt;
          if (this.world.heightAt(nx, nz) > 0.28) {
            const res = this.resolveCollisions(nx, nz, 1.35);
            if (this.world.heightAt(res.x, res.z) > 0.28) {
              d.x = res.x;
              d.z = res.z;
              d.y = this.world.heightAt(res.x, res.z);
              d.yaw = U.angleLerp(d.yaw, Math.atan2(dirX, dirZ), 1 - Math.exp(-9 * dt));
              d.speedFactor = U.damp(d.speedFactor, speed / 4, 7, dt);
              d.walkPhase += dt * (4.8 + speed * 1.15);
              d.group.position.set(d.x, d.y, d.z);
              d.group.rotation.y = d.yaw;
            }
          }
        } else {
          d.speedFactor = U.damp(d.speedFactor, 0, 8, dt);
        }
        p.x = d.x;
        p.z = d.z;
        p.y = d.y;
        p.renderY = d.y;
        p.yaw = d.yaw;
        p.air = 0;
        p.grounded = true;
      } else {
        let speed = sprinting ? 7.0 : 4.45;
        const ground = this.world.heightAt(p.x, p.z);
        const water = ground < 0.42;
        if (water) speed *= 0.62;
        if (moving) {
          const dirX = fwdX * input.y + rightX * input.x;
          const dirZ = fwdZ * input.y + rightZ * input.x;
          const nx = p.x + dirX * speed * dt;
          const nz = p.z + dirZ * speed * dt;
          if (this.world.heightAt(nx, nz) > -0.5) {
            const res = this.resolveCollisions(nx, nz, 0.38);
            if (this.world.heightAt(res.x, res.z) > -0.55) {
              p.x = res.x;
              p.z = res.z;
              p.y = this.world.heightAt(res.x, res.z);
              p.yaw = U.angleLerp(p.yaw, Math.atan2(dirX, dirZ), 1 - Math.exp(-13 * dt));
            }
          }
          p.stepPhase += speed * dt;
          if (p.stepPhase > 1.65 && p.grounded) {
            p.stepPhase = 0;
            const surface = p.y < 2.0 ? 'sand' : ground < 0.3 ? 'water' : 'grass';
            Sfx.step(surface);
          }
        }
        if (!p.grounded) {
          p.vy -= 18 * dt;
          p.air += p.vy * dt;
          if (p.air <= 0) {
            p.air = 0;
            p.vy = 0;
            p.grounded = true;
          }
        }
        p.renderY = p.y + p.air;
      }

      if (sprinting && moving) {
        p.stamina = Math.max(0, p.stamina - (this.mounted ? 8 : 15) * dt);
      } else {
        p.stamina = Math.min(p.maxStamina, p.stamina + (moving ? 8 : 21) * dt);
      }
    }

    updatePlayerVisual(dt) {
      const p = this.player;
      if (this.mounted) {
        const d = this.mounted;
        this.playerGroup.visible = false;
        this.rider.visible = !this.dead;
        this.rider.position.set(d.x, d.y + 2.45 + Math.abs(Math.sin(d.walkPhase)) * 0.035 * Math.min(1, d.speedFactor), d.z);
        this.rider.rotation.y = d.yaw;
        this.playerShadow.visible = !this.dead;
        this.playerShadow.position.set(d.x, d.y + 0.05, d.z);
        this.playerShadow.scale.setScalar(2.6);
        this.updateTorch();
        return;
      }
      this.rider.visible = false;
      this.playerShadow.scale.setScalar(1);
      this.playerGroup.visible = this.playing && !this.dead;
      this.playerShadow.visible = this.playing && !this.dead;
      this.playerGroup.position.set(p.x, p.renderY, p.z);
      this.playerGroup.rotation.y = p.yaw;
      this.playerShadow.position.set(p.x, p.y + 0.045, p.z);
      this.playerShadow.scale.setScalar(U.clamp(1 - p.air * 0.08, 0.55, 1));

      const speed = this.moving ? (p.sprinting ? 13 : 9) : 0;
      if (speed > 0) p.walkPhase += dt * speed;
      const swing = this.moving ? Math.sin(p.walkPhase) * 0.62 : 0;
      const k = 1 - Math.exp(-13 * dt);
      this.playerLegL.rotation.x = U.lerp(this.playerLegL.rotation.x, swing, k);
      this.playerLegR.rotation.x = U.lerp(this.playerLegR.rotation.x, -swing, k);
      this.playerArmL.rotation.x = U.lerp(this.playerArmL.rotation.x, -swing * 0.75, k);
      this.playerArmR.rotation.x = U.lerp(this.playerArmR.rotation.x, swing * 0.55, k);
      this.playerModel.position.y = this.moving && p.grounded
        ? Math.abs(Math.sin(p.walkPhase)) * 0.04
        : Math.sin(this.worldElapsed * 1.8) * 0.008;
      this.playerModel.rotation.z = this.moving ? Math.sin(p.walkPhase) * 0.025 : 0;
      this.updateHeldTool();
      this.updateTorch();
    }

    updateHeldTool() {
      const item = PI.HOTBAR[this.selected];
      Object.keys(this.heldItems).forEach((key) => { this.heldItems[key].visible = false; });
      if (!item || item.kind !== 'tool' || item.id === 'hand') return;
      if (!this.tools[item.id] || !this.playerGroup.visible) return;
      const held = this.heldItems[item.id];
      if (held) held.visible = true;
    }

    updateTorch() {
      const item = PI.HOTBAR[this.selected];
      const on = this.playing && !this.dead && !this.mounted && item && item.id === 'torch' && this.tools.torch;
      const p = this.player;
      this.torchLight.position.set(p.x, p.renderY + 1.55, p.z);
      if (!on) {
        this.torchLight.intensity = 0;
        return;
      }
      const flicker = 1.25 + Math.sin(this.worldElapsed * 16.5) * 0.16 + Math.sin(this.worldElapsed * 7.3) * 0.08;
      this.torchLight.intensity = flicker;
    }

    /* -------------------------- camera ---------------------------- */
    updateCamera(dt) {
      if (!this.world) return;
      const p = this.player;
      const mounted = !!this.mounted;
      const target = new T.Vector3(p.x, p.renderY + (mounted ? 2.55 : 1.42), p.z);
      const dist = (mounted ? 7.1 : 5.1) * this.zoom;
      const horiz = Math.cos(this.pitch) * dist;
      const desired = new T.Vector3(
        target.x - Math.sin(this.yaw) * horiz,
        target.y + 0.35 - Math.sin(this.pitch) * dist,
        target.z - Math.cos(this.yaw) * horiz
      );
      for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        const x = U.lerp(target.x, desired.x, t);
        const z = U.lerp(target.z, desired.z, t);
        const clearance = this.world.heightAt(x, z) + (i === 6 ? 0.72 : 0.5);
        if (desired.y < clearance) desired.y = clearance;
      }
      if (desired.y < 0.65) desired.y = 0.65;

      const k = this.camSnap ? 1 : 1 - Math.exp(-11 * dt);
      this.camSmooth.lerp(desired, k);
      this.camSnap = false;

      const shake = this.shake;
      this.shake = Math.max(0, this.shake - dt * 2.1);
      this.camera.position.set(
        this.camSmooth.x + (Math.random() - 0.5) * shake,
        this.camSmooth.y + (Math.random() - 0.5) * shake * 0.7,
        this.camSmooth.z + (Math.random() - 0.5) * shake
      );
      this.camera.lookAt(target);
    }

    /* ---------------------- targets / action ---------------------- */
    toolId() {
      const item = PI.HOTBAR[this.selected];
      if (item && item.kind === 'tool' && (item.id === 'hand' || this.tools[item.id])) return item.id;
      return 'hand';
    }

    computeTarget() {
      if (!this.world || !this.playing || this.dead) return null;
      if (this.mounted) {
        return {
          kind: 'dismount',
          ref: this.mounted,
          name: this.mounted.name,
          hint: 'Montaria ativa · toque em DESCER para apear',
          icon: '🐾',
          label: 'DESCER',
          available: true,
          hostile: false,
        };
      }
      const p = this.player;
      const fwdX = Math.sin(this.yaw);
      const fwdZ = Math.cos(this.yaw);
      let best = null;
      let bestScore = Infinity;

      const consider = (target, score) => {
        if (score < bestScore) {
          bestScore = score;
          best = target;
        }
      };

      this.dinos.forEach((d) => {
        if (d.dead || d.mounted) return;
        const dx = d.x - p.x;
        const dz = d.z - p.z;
        const dist = Math.hypot(dx, dz) || 0.001;
        const maxDist = d.type === 'parasaur' ? 4.8 : 4.0;
        if (dist > maxDist) return;
        const dot = (dx * fwdX + dz * fwdZ) / dist;
        if (dot < -0.32 && dist > 1.95) return;
        const score = dist - dot * 0.8 + (d.type === 'parasaur' ? -0.35 : -0.1);
        let target;
        if (d.type === 'parasaur') {
          if (d.tamed) {
            if (!d.saddle) {
              if ((this.inv.saddle || 0) > 0) {
                target = {
                  kind: 'saddle', ref: d, name: d.name,
                  hint: 'Toque para selar · sela pronta', icon: '🪢', label: 'SELAR',
                  available: true, hostile: false,
                };
              } else {
                target = {
                  kind: 'blocked', ref: d, name: d.name,
                  hint: 'Domesticado · crie uma sela de couro', icon: '🪢', label: 'SELAR',
                  available: false, blockedMsg: 'Crie uma sela de couro na mochila.', hostile: false,
                };
              }
            } else {
              target = {
                kind: 'mount', ref: d, name: d.name,
                hint: 'Toque para montar · ' + d.hp + '/' + d.maxHp + ' de vida', icon: '🐾', label: 'MONTAR',
                available: true, hostile: false,
              };
            }
          } else {
            const sel = PI.HOTBAR[this.selected];
            if (sel && sel.kind === 'food' && sel.res === 'berry' && (this.inv.berry || 0) > 0) {
              target = {
                kind: 'tame', ref: d, name: 'Parassauro',
                hint: 'Segure para oferecer fruta · ' + Math.round(d.taming || 0) + '% domesticado',
                icon: '🫐', label: 'OFERECER', available: true, hostile: false,
              };
            } else {
              target = {
                kind: 'blocked', ref: d, name: 'Parassauro',
                hint: 'Selvagem · selecione frutas no atalho', icon: '🫐', label: 'OFERECER',
                available: false, blockedMsg: 'Selecione frutas no atalho para domesticar.', hostile: false,
              };
            }
          }
        } else {
          target = {
            kind: 'attack', ref: d, name: d.type === 'raptor' ? 'Raptor' : 'Dodô',
            hint: (d.type === 'raptor' ? 'Predador · ' : 'Presa · ') + 'vida ' + Math.ceil(d.hp) + '/' + d.maxHp,
            icon: PI.HOTBAR[this.selected] && PI.HOTBAR[this.selected].kind === 'tool' ? PI.HOTBAR[this.selected].icon : '✊',
            label: 'ATACAR', available: true, hostile: d.type === 'raptor',
          };
        }
        target.score = score;
        consider(target, score);
      });

      if (this.world.nodes) {
        for (let i = 0; i < this.world.nodes.length; i++) {
          const n = this.world.nodes[i];
          if (!n.alive) continue;
          const dx = n.x - p.x;
          const dz = n.z - p.z;
          const dist = Math.hypot(dx, dz) || 0.001;
          if (dist > 4.0) continue;
          const dot = (dx * fwdX + dz * fwdZ) / dist;
          if (dot < -0.38 && dist > 1.8) continue;
          const score = dist - dot * 0.5 + 0.28;
          let hint = 'Segure para coletar';
          if (n.kind === 'tree') hint = 'Segure para bater · madeira e fibra';
          else if (n.kind === 'rock') hint = 'Segure para minerar · pedra e sílex';
          else hint = 'Segure para colher · frutas e fibra';
          const item = PI.HOTBAR[this.selected];
          consider({
            kind: 'node', ref: n, name: n.name, hint: hint,
            icon: item && item.kind === 'tool' ? item.icon : '✊',
            label: 'COLETAR', available: true, hostile: false, score: score,
          }, score);
        }
      }

      this.world.crates.forEach((c) => {
        if (c.looted) return;
        const dx = c.x - p.x;
        const dz = c.z - p.z;
        const dist = Math.hypot(dx, dz) || 0.001;
        if (dist > 3.4) return;
        const dot = (dx * fwdX + dz * fwdZ) / dist;
        if (dot < -0.4 && dist > 1.9) return;
        const score = dist - dot * 0.6 + 0.1;
        consider({
          kind: 'crate', ref: c, name: 'Caixa de suprimentos', hint: 'Toque para saquear · recursos raros',
          icon: '🎁', label: 'ABRIR', available: true, hostile: false, score: score,
        }, score);
      });

      if (!this.activated) {
        const dist = Math.hypot(p.x, p.z);
        if (dist < 8.5) {
          const dot = (-p.x * fwdX - p.z * fwdZ) / Math.max(1, dist);
          const score = dist / 3 - dot * 0.4;
          consider({
            kind: 'obelisk', name: 'Obelisco', hint: 'Toque para ativar o feixe turquesa',
            icon: '🔷', label: 'ATIVAR', available: true, hostile: false, score: score,
          }, score);
        }
      }

      return best;
    }

    updateTarget() {
      if (!this.playing) return;
      this.target = this.computeTarget();
      this.refreshActionUI();
    }

    refreshActionUI() {
      if (!this.playing || this.dead) {
        this.ui.setAction({ icon: '✊', label: 'COLETAR', disabled: true });
        this.ui.setTarget(null);
        return;
      }
      if (this.mounted) {
        this.ui.setAction({ icon: '🐾', label: 'DESCER', pulse: true });
        this.ui.setTarget({ name: this.mounted.name, hint: 'Montaria ativa · toque em DESCER para apear', hostile: false });
        return;
      }
      const t = this.target;
      if (t) {
        this.ui.setAction({
          icon: t.icon,
          label: t.label,
          disabled: !t.available,
          pulse: t.available,
        });
        this.ui.setTarget({ name: t.name, hint: t.hint, hostile: t.hostile });
        return;
      }
      const item = PI.HOTBAR[this.selected];
      if (item && item.kind === 'food') {
        const count = this.inv[item.res] || 0;
        this.ui.setAction({
          icon: item.icon,
          label: item.res === 'coconut' ? 'BEBER' : 'COMER',
          disabled: count <= 0,
        });
      } else if (item && item.kind === 'tool') {
        this.ui.setAction({ icon: item.icon, label: 'COLETAR', disabled: true });
      } else {
        this.ui.setAction({ icon: '✊', label: 'COLETAR', disabled: true });
      }
      this.ui.setTarget(null);
    }

    actionDown() {
      if (!this.playing || this.paused || this.dead) return;
      Sfx.init();
      this.updateTarget();
      const t = this.target;
      if (t && !t.available) {
        if (t.blockedMsg) this.ui.toast(t.blockedMsg, 'bad');
        return;
      }
      if (!t) {
        const item = PI.HOTBAR[this.selected];
        if (item && item.kind === 'food' && (this.inv[item.res] || 0) > 0) {
          this.useFood(item);
          return;
        }
        return;
      }
      this.actionHeld = true;
      this.performAction();
    }

    actionUp() {
      this.actionHeld = false;
    }

    performAction() {
      if (!this.playing || this.paused || this.dead) return;
      if (this.actionCd > 0) return;
      const t = this.target;
      if (!t) return;
      switch (t.kind) {
        case 'node':
          this.harvestNode(t.ref);
          break;
        case 'attack':
          this.attackDino(t.ref);
          break;
        case 'tame':
          this.feedDino(t.ref);
          break;
        case 'saddle':
          this.saddleDino(t.ref);
          this.actionHeld = false;
          this.updateTarget();
          break;
        case 'mount':
          this.mountDino(t.ref);
          this.actionHeld = false;
          break;
        case 'dismount':
          this.dismount(true);
          this.actionHeld = false;
          break;
        case 'crate':
          this.lootCrate(t.ref);
          this.actionHeld = false;
          this.updateTarget();
          break;
        case 'obelisk':
          this.activateObelisk();
          this.actionHeld = false;
          break;
        case 'blocked':
          if (t.blockedMsg) this.ui.toast(t.blockedMsg, 'bad');
          break;
      }
    }

    /* --------------------------- slots ---------------------------- */
    isSlotAvailable(item) {
      if (!item) return false;
      if (item.kind === 'tool') return item.id === 'hand' || !!this.tools[item.id];
      if (item.kind === 'food') return (this.inv[item.res] || 0) > 0;
      return true;
    }

    selectSlot(index) {
      const item = PI.HOTBAR[index];
      if (!item) return;
      if (!this.isSlotAvailable(item)) {
        this.ui.toast(
          item.kind === 'food' ? 'Você não tem ' + item.name.toLowerCase() + '.' : 'Crie ' + item.name + ' na mochila.',
          'bad'
        );
        return;
      }
      if (this.selected === index && item.kind === 'food') {
        this.useFood(item);
        return;
      }
      this.selected = index;
      this.ui.updateHotbar(this);
      this.ui.setAction({ icon: item.icon, label: 'COLETAR', disabled: true });
      this.updateTarget();
      Sfx.ui();
    }

    useSlot(index) {
      const item = PI.HOTBAR[index];
      if (!item) return;
      if (this.selected === index && item.kind === 'food') this.useFood(item);
      else this.selectSlot(index);
    }

    useFood(item) {
      if (!item || item.kind !== 'food') return;
      const count = this.inv[item.res] || 0;
      if (count <= 0) {
        this.ui.toast('Você não tem ' + item.name.toLowerCase() + '.', 'bad');
        return;
      }
      const data = PI.FOOD[item.res];
      if (!data) return;
      this.inv[item.res] = count - 1;
      const p = this.player;
      p.food = U.clamp(p.food + data.food, 0, 100);
      p.water = U.clamp(p.water + data.water, 0, 100);
      if (data.health) p.hp = U.clamp(p.hp + data.health, 0, p.maxHp);
      this.actionHeld = false;
      const bits = [];
      if (data.food) bits.push('+' + data.food + ' 🍖');
      if (data.water) bits.push('+' + data.water + ' 💧');
      if (data.health) bits.push('+' + data.health + ' ❤');
      this.ui.floatText(bits.join('  '), new T.Vector3(p.x, p.renderY + 1.8, p.z), 'good');
      Sfx.eat();
      if (this.settings.haptic) U.vibrate(14);
      this.ui.updateHotbar(this);
      this.refreshActionUI();
      if (!this.ui.el.craft.classList.contains('hidden')) this.ui.renderCraft(this);
    }

    /* --------------------------- craft ---------------------------- */
    isRecipeOwned(recipe) {
      if (!recipe) return false;
      if (recipe.type === 'tool') return !!this.tools[recipe.id];
      if (recipe.type === 'saddle') return !!this.crafted.saddle;
      return false;
    }

    canAfford(cost) {
      return Object.keys(cost).every((k) => (this.inv[k] || 0) >= cost[k]);
    }

    campfireSpot() {
      const p = this.player;
      const fwdX = Math.sin(this.yaw);
      const fwdZ = Math.cos(this.yaw);
      const tries = [
        { x: p.x + fwdX * 2.1, z: p.z + fwdZ * 2.1 },
        { x: p.x + fwdX * 1.35, z: p.z + fwdZ * 1.35 },
        { x: p.x, z: p.z },
      ];
      for (const spot of tries) {
        const h = this.world.heightAt(spot.x, spot.z);
        if (h > 0.35 && this.world.slopeAt(spot.x, spot.z) < 1.35) return { x: spot.x, z: spot.z, h: h };
      }
      return null;
    }

    craft(id) {
      const recipe = PI.RECIPES.find((r) => r.id === id);
      if (!recipe) return;
      if (this.isRecipeOwned(recipe) && !recipe.repeat) return;
      if (!this.canAfford(recipe.cost)) {
        this.ui.toast('Faltam recursos para ' + recipe.name + '.', 'bad');
        Sfx.ui();
        return;
      }
      let spot = null;
      if (recipe.type === 'campfire') {
        spot = this.campfireSpot();
        if (!spot) {
          this.ui.toast('Não há espaço seco para a fogueira aqui.', 'bad');
          return;
        }
      }
      Object.keys(recipe.cost).forEach((k) => { this.inv[k] -= recipe.cost[k]; });
      let toastMsg = recipe.name + ' criado.';
      if (recipe.type === 'tool') {
        this.tools[recipe.id] = true;
        const idx = PI.HOTBAR.findIndex((h) => h.id === recipe.id);
        if (idx >= 0) this.selected = idx;
        toastMsg = recipe.name + ' equipado.';
      } else if (recipe.type === 'saddle') {
        this.inv.saddle = (this.inv.saddle || 0) + 1;
        this.crafted.saddle = true;
        toastMsg = 'Sela pronta. Aproxime-se do parassauro domesticado.';
      } else if (recipe.type === 'campfire') {
        if (this.placeCampfire(spot.x, spot.z)) toastMsg = 'Fogueira acesa. Fique perto para curar e assar carne.';
      } else if (recipe.type === 'heal') {
        this.player.hp = U.clamp(this.player.hp + 35, 0, this.player.maxHp);
        this.ui.floatText('+35 ❤', new T.Vector3(this.player.x, this.player.renderY + 1.8, this.player.z), 'good');
        toastMsg = 'Curativo aplicado. +35 de vida.';
      }
      this.gainXP(8, true);
      this.ui.toast(toastMsg, 'good');
      if (recipe.type === 'campfire') Sfx.place();
      else if (recipe.type === 'heal') Sfx.chime();
      else Sfx.craft();
      if (this.settings.haptic) U.vibrate(18);
      this.ui.renderCraft(this);
      this.ui.updateHUD(this);
      this.refreshActionUI();
      this.checkQuests();
      this.saveGame(true);
    }

    placeCampfire(x, z) {
      const fire = this.world.addCampfire(x, z);
      if (!fire) return false;
      if (this.particles) {
        this.particles.burst(x, fire.y + 0.7, z, 0xff9a3d, 22, 1.5, { up: 1.8, life: 0.7, size: 1.1, grav: -0.4 });
      }
      this.cookTimer = 2;
      return true;
    }

    /* ------------------------- harvesting ------------------------- */
    addResource(key, n) {
      if (!n || n <= 0) return 0;
      this.inv[key] = (this.inv[key] || 0) + n;
      return n;
    }

    harvestNode(node) {
      if (!node || !node.alive) {
        this.updateTarget();
        return;
      }
      const p = this.player;
      const tool = this.toolId();
      const weak = p.stamina < 4;
      let dmg = PI.TOOL_DAMAGE[tool] || 9;
      if (weak) dmg *= 0.65;
      node.hp -= dmg;
      p.stamina = Math.max(0, p.stamina - (weak ? 0 : 4));
      this.actionCd = weak ? 0.9 : tool === 'hatchet' ? 0.42 : 0.5;
      p.yaw = Math.atan2(node.x - p.x, node.z - p.z);

      const gains = {};
      const add = (key, n) => {
        if (!n) return;
        this.addResource(key, n);
        gains[key] = (gains[key] || 0) + n;
      };

      if (node.kind === 'tree') {
        if (tool === 'hatchet') {
          add('wood', 2);
          if (Math.random() < 0.65) add('fiber', 1);
        } else if (tool === 'pickaxe') {
          add('wood', 1);
        } else {
          add('wood', 1);
          if (Math.random() < 0.35) add('fiber', 1);
        }
        if (Math.random() < 0.16) add('coconut', 1);
      } else if (node.kind === 'rock') {
        if (tool === 'pickaxe') {
          add('stone', 2);
          if (Math.random() < 0.6) add('flint', 1);
        } else {
          add('stone', 1);
          if (Math.random() < (tool === 'hatchet' ? 0.25 : 0.15)) add('flint', 1);
        }
      } else {
        add('berry', 1);
        add('fiber', 1);
        if (Math.random() < 0.25) add('berry', 1);
      }

      const center = new T.Vector3(
        node.x,
        node.y + (node.kind === 'tree' ? 2.1 : node.kind === 'rock' ? 0.8 : 0.7),
        node.z
      );
      const color = node.kind === 'tree' ? 0x8b6238 : node.kind === 'rock' ? 0xb8b4a4 : 0xd8514c;
      if (this.particles) {
        this.particles.burst(center.x, center.y, center.z, color, 10, 1.25, {
          up: 1.4, life: 0.65, size: 0.75, spread: 0.5, grav: 5,
        });
      }
      Sfx.harvest(node.kind);
      if (this.settings.haptic) U.vibrate(10);

      if (node.hp <= 0) {
        node.hp = 0;
        this.world.depleteNode(node);
        if (node.kind === 'tree') add('wood', 1);
        else if (node.kind === 'rock') add('stone', 1);
        else add('berry', 1);
        this.gainXP(5, true);
        this.updateTarget();
        if (this.particles) {
          this.particles.burst(center.x, center.y, center.z, color, 24, 2.0, {
            up: 2.2, life: 0.9, size: 1.1, spread: 0.8, grav: 4,
          });
        }
        Sfx.chime();
      }

      const parts = Object.keys(gains).map((k) => '+' + gains[k] + ' ' + PI.RES[k].icon);
      if (parts.length) this.ui.floatText(parts.join('  '), center, 'gold');
      this.ui.updateHUD(this);
      this.checkQuests();
    }

    /* --------------------------- combat --------------------------- */
    attackDino(dino) {
      if (!dino || dino.dead || dino.type === 'parasaur') return;
      const p = this.player;
      const tool = this.toolId();
      const weak = p.stamina < 4;
      let dmg = PI.TOOL_DAMAGE[tool] || 9;
      if (weak) dmg *= 0.6;
      p.stamina = Math.max(0, p.stamina - (weak ? 0 : 7));
      this.actionCd = weak ? 0.95 : tool === 'spear' ? 0.62 : 0.55;
      p.yaw = Math.atan2(dino.x - p.x, dino.z - p.z);
      dino.takeDamage(dmg, true);
      Sfx.swing();
      Sfx.hit();
      this.shake = Math.min(0.45, this.shake + 0.14);
      if (this.settings.haptic) U.vibrate(20);
      if (this.particles) {
        this.particles.burst(dino.x, dino.y + 1.2, dino.z, 0xc84a3a, 14, 1.8, {
          up: 1.6, life: 0.55, size: 0.85, spread: 0.4, grav: 6,
        });
      }
      this.ui.floatText('-' + Math.round(dmg), new T.Vector3(dino.x, dino.y + 1.9, dino.z), 'bad');
      this.ui.updateHUD(this);
      if (dino.dead) this.updateTarget();
    }

    onDinoDeath(dino) {
      if (!dino || dino.rewarded) return;
      dino.rewarded = true;
      const xp = dino.cfg.xp || 0;
      this.gainXP(xp, true);
      const bits = [];
      const drops = dino.cfg.drops || {};
      Object.keys(drops).forEach((k) => {
        const n = drops[k];
        this.addResource(k, n);
        if (PI.RES[k]) bits.push('+' + n + ' ' + PI.RES[k].icon);
      });
      if (bits.length) {
        this.ui.floatText(bits.join('  '), new T.Vector3(dino.x, dino.y + 2.1, dino.z), 'gold');
      }
      const label = dino.cfg.name;
      this.ui.toast(label + ' abatido' + (xp ? ' · +' + xp + ' XP' : '') + '.', 'good');
      Sfx.loot();
      if (this.settings.haptic) U.vibrate(28);
      if (this.particles) {
        this.particles.burst(dino.x, dino.y + 1.1, dino.z, 0xc84a3a, 18, 1.9, {
          up: 1.8, life: 0.7, size: 0.9, spread: 0.6, grav: 5,
        });
      }
      this.ui.updateHUD(this);
      this.checkQuests();
    }

    damagePlayer(amount, source) {
      if (this.dead || !this.playing) return;
      const p = this.player;
      let dmg = Math.max(1, amount);
      if (this.mounted) dmg *= 0.65;
      p.hp = Math.max(0, p.hp - dmg);
      p.combat = 6;
      this.shake = Math.min(0.6, this.shake + 0.3);
      this.ui.flashDamage();
      this.ui.floatText('-' + Math.round(dmg), new T.Vector3(p.x, p.renderY + 1.5, p.z), 'bad');
      Sfx.hurt();
      if (this.settings.haptic) U.vibrate(55);
      if (p.hp <= 0) {
        this.die(source === 'raptor' ? 'O raptor foi mais rápido.' : 'A ilha cobrou seu preço.');
      }
    }

    /* ------------------------ taming / mount ---------------------- */
    feedDino(dino) {
      if (!dino || dino.dead || dino.tamed) return;
      if ((this.inv.berry || 0) <= 0) {
        this.ui.toast('Sem frutas. Colha arbustos na ilha.', 'bad');
        return;
      }
      const p = this.player;
      p.yaw = Math.atan2(dino.x - p.x, dino.z - p.z);
      this.inv.berry -= 1;
      dino.taming = Math.min(100, (dino.taming || 0) + 18);
      dino.feedPause = 1.6;
      dino.refreshLabel();
      this.actionCd = 1.05;
      this.ui.floatText('+' + Math.round(Math.min(18, 100 - (dino.taming - 18))) + '% domesticado',
        new T.Vector3(dino.x, dino.y + 3.4, dino.z), 'good');
      if (this.particles) {
        this.particles.burst(dino.x, dino.y + 2.8, dino.z, 0xff8fb0, 16, 1.1, {
          up: 2.3, life: 1.1, size: 0.9, spread: 0.7, grav: -0.8,
        });
      }
      Sfx.chime();
      if (this.settings.haptic) U.vibrate(18);
      this.ui.updateHotbar(this);
      this.ui.updateHUD(this);
      if (dino.taming >= 100) {
        dino.tamed = true;
        dino.taming = 100;
        dino.refreshLabel();
        this.gainXP(80, true);
        this.ui.toast('Parassauro domesticado! Ele agora segue você.', 'good');
        Sfx.tame();
        this.ui.whiteFlash();
        this.checkQuests();
        this.saveGame(true);
      } else {
        this.ui.toast('O parassauro aceitou a fruta. ' + Math.round(dino.taming) + '% domesticado.', 'good');
      }
      if (!this.ui.el.craft.classList.contains('hidden')) this.ui.renderCraft(this);
      this.updateTarget();
    }

    saddleDino(dino) {
      if (!dino || !dino.tamed || dino.saddle) return;
      if ((this.inv.saddle || 0) <= 0) {
        this.ui.toast('Crie uma sela de couro na mochila.', 'bad');
        return;
      }
      this.inv.saddle -= 1;
      dino.setSaddled(true);
      this.actionCd = 0.5;
      this.ui.toast('Sela equipada. Toque para montar.', 'good');
      Sfx.craft();
      this.ui.updateHUD(this);
      this.updateTarget();
      this.checkQuests();
    }

    mountDino(dino) {
      if (!dino || !dino.tamed || !dino.saddle || dino.dead || this.mounted) return;
      this.mounted = dino;
      dino.mounted = true;
      dino.speedFactor = 0;
      if (dino.label) dino.label.sprite.visible = false;
      const p = this.player;
      p.x = dino.x;
      p.z = dino.z;
      p.y = dino.y;
      p.renderY = dino.y;
      p.air = 0;
      p.vy = 0;
      p.grounded = true;
      p.yaw = dino.yaw;
      this.yaw = dino.yaw;
      this.playerGroup.visible = false;
      this.playerShadow.visible = true;
      this.rider.visible = true;
      this.ui.el.mounted.textContent = '🐾 ' + dino.name.toUpperCase();
      this.ui.el.mounted.classList.remove('hidden');
      this.camera.fov = 62;
      this.camera.updateProjectionMatrix();
      this.camSnap = true;
      this.updateCamera(0.016);
      this.actionUp();
      this.updateTarget();
      Sfx.chime();
      if (this.settings.haptic) U.vibrate(22);
      this.ui.toast('Montaria pronta. O parassauro acelera com o direcional.', 'good');
    }

    dismount(showToast) {
      const dino = this.mounted;
      if (!dino) return false;
      dino.mounted = false;
      if (dino.label) dino.label.sprite.visible = !dino.dead;
      const rightX = Math.cos(dino.yaw);
      const rightZ = -Math.sin(dino.yaw);
      let x = dino.x + rightX * 2.1;
      let z = dino.z + rightZ * 2.1;
      if (this.world.heightAt(x, z) < -0.35) {
        x = dino.x - rightX * 2.1;
        z = dino.z - rightZ * 2.1;
      }
      const res = this.resolveCollisions(x, z, 0.38);
      if (this.world.heightAt(res.x, res.z) < -0.4) {
        x = dino.x;
        z = dino.z;
      } else {
        x = res.x;
        z = res.z;
      }
      const p = this.player;
      p.x = x;
      p.z = z;
      p.y = this.world.heightAt(x, z);
      p.renderY = p.y;
      p.air = 0;
      p.vy = 0;
      p.grounded = true;
      p.yaw = dino.yaw;
      this.mounted = null;
      this.rider.visible = false;
      this.playerGroup.visible = !this.dead;
      this.playerShadow.visible = !this.dead;
      this.ui.el.mounted.classList.add('hidden');
      this.camera.fov = 58;
      this.camera.updateProjectionMatrix();
      this.camSnap = true;
      if (showToast) this.ui.toast('Você desceu da montaria.', 'good');
      Sfx.ui();
      if (this.playing) this.updateTarget();
      return true;
    }

    /* --------------------------- loot ----------------------------- */
    lootCrate(crate) {
      if (!crate || crate.looted) return;
      crate.looted = true;
      crate.group.visible = false;
      const loot = {
        wood: ri(8, 16),
        stone: ri(6, 13),
        fiber: ri(6, 12),
        berry: ri(2, 4),
        flint: ri(2, 4),
        cooked: ri(1, 2),
      };
      const bits = [];
      Object.keys(loot).forEach((k) => {
        this.addResource(k, loot[k]);
        bits.push('+' + loot[k] + ' ' + PI.RES[k].icon);
      });
      this.gainXP(25, true);
      this.actionCd = 0.45;
      this.ui.toast('Suprimentos saqueados! ' + bits.join(' '), 'good');
      this.ui.floatText('SUPRIMENTOS!', new T.Vector3(crate.x, crate.y + 2.1, crate.z), 'gold');
      Sfx.loot();
      if (this.settings.haptic) U.vibrate(30);
      if (this.particles) {
        this.particles.burst(crate.x, crate.y + 1.4, crate.z, 0xffd47a, 26, 2.0, {
          up: 2.3, life: 0.9, size: 1.1, spread: 0.6, grav: 4,
        });
      }
      this.ui.updateHUD(this);
      this.checkQuests();
      this.saveGame(true);
    }

    activateObelisk() {
      if (this.activated) return;
      this.activated = true;
      this.ui.whiteFlash();
      Sfx.levelup();
      this.gainXP(300, true);
      const y = this.world.obeliskPos ? this.world.obeliskPos.y + 11 : 12;
      if (this.particles) {
        this.particles.burst(0, y, 0, 0x79e6d7, 60, 2.2, {
          up: 3.2, life: 1.8, size: 1.4, spread: 1.3, grav: -0.45,
        });
      }
      this.ui.toast('O OBELISCO DESPERTOU. +300 XP', 'good');
      if (this.settings.haptic) U.vibrate([30, 40, 60]);
      this.ui.updateHUD(this);
      this.checkQuests();
      this.saveGame(true);
    }

    /* ------------------------ survival / time --------------------- */
    gainXP(amount, silent) {
      if (!amount || amount <= 0) return;
      const p = this.player;
      p.xp += amount;
      let levels = 0;
      while (p.xp >= this.xpForNext()) {
        p.xp -= this.xpForNext();
        p.level += 1;
        p.maxHp += 8;
        p.maxStamina += 4;
        p.hp = Math.min(p.maxHp, p.hp + 20);
        p.stamina = p.maxStamina;
        levels++;
      }
      if (levels > 0) {
        this.ui.toast('NÍVEL ' + p.level + '! Vida e fôlego aumentaram.', 'xp');
        this.ui.floatText('NÍVEL ' + p.level, new T.Vector3(p.x, p.renderY + 2.0, p.z), 'gold');
        Sfx.levelup();
        this.ui.whiteFlash();
      }
      if (!silent) this.ui.toast('+' + Math.round(amount) + ' XP', 'xp');
      this.ui.updateHUD(this);
    }

    checkQuests() {
      if (!this.playing || !this.world) return;
      let advanced = false;
      let guard = 0;
      while (this.questIndex < this.quests.length && guard++ < this.quests.length) {
        const q = this.quests[this.questIndex];
        if (!q.test()) break;
        this.questIndex++;
        advanced = true;
        this.gainXP(q.reward, true);
        this.ui.toast('OBJETIVO CONCLUÍDO · ' + q.done, 'good');
        Sfx.chime();
        if (this.questIndex >= this.quests.length) {
          this.ui.whiteFlash();
          this.ui.toast('A ILHA ESTÁ SUA. Explore, cace e monte até o fim dos dias.', 'xp');
        }
      }
      if (advanced) {
        this.ui.updateHUD(this);
        this.saveGame(true);
      }
    }

    getQuestText() {
      if (!this.quests) return '';
      if (this.questIndex >= this.quests.length) {
        return 'Ilha dominada. Explore, cace, monte e sobreviva à noite.';
      }
      return this.quests[this.questIndex].text;
    }

    updateCampfires(dt) {
      const p = this.player;
      let near = null;
      for (let i = 0; i < this.world.campfires.length; i++) {
        const f = this.world.campfires[i];
        if (Math.hypot(f.x - p.x, f.z - p.z) < 4.6) {
          near = f;
          break;
        }
      }
      this.nearFire = near;
      if (!near) {
        this.cookTimer = Math.min(this.cookTimer, 1.5);
        return;
      }
      this.cookTimer -= dt;
      if (this.cookTimer <= 0) {
        if ((this.inv.meat || 0) > 0) {
          this.inv.meat -= 1;
          this.inv.cooked = (this.inv.cooked || 0) + 1;
          this.cookTimer = 7;
          this.ui.floatText('🍗 assando…', new T.Vector3(near.x, near.y + 1.6, near.z), 'good');
          Sfx.fire();
          this.ui.updateHUD(this);
        } else {
          this.cookTimer = 2;
        }
      }
    }

    updateSurvival(dt) {
      const p = this.player;
      p.combat = Math.max(0, p.combat - dt);
      const drain = p.sprinting && this.moving ? 1.7 : 1;
      p.food = Math.max(0, p.food - 0.15 * drain * dt);
      p.water = Math.max(0, p.water - 0.2 * drain * dt);

      let starving = false;
      let dehydrated = false;
      if (p.food <= 0) {
        starving = true;
        p.hp -= 1.15 * dt;
      }
      if (p.water <= 0) {
        dehydrated = true;
        p.hp -= 1.45 * dt;
      }
      if (!starving && !dehydrated) {
        if (this.nearFire) p.hp = Math.min(p.maxHp, p.hp + 2.0 * dt);
        else if (p.food > 55 && p.water > 55 && p.combat <= 0) p.hp = Math.min(p.maxHp, p.hp + 0.42 * dt);
      }
      p.hp = U.clamp(p.hp, 0, p.maxHp);
      if (p.hp <= 0 && !this.dead) {
        this.die(dehydrated ? 'A sede venceu. A ilha guarda seus ossos.' : starving ? 'A fome venceu. A ilha guarda seus ossos.' : 'A ilha cobrou seu preço.');
      }
    }

    updateTime(dt) {
      this.time += dt / PI.DAY_LENGTH;
      while (this.time >= 1) {
        this.time -= 1;
        this.day += 1;
        this.onNewDay();
      }
      this.lightTimer = (this.lightTimer || 0) - dt;
      if (this.lightTimer <= 0) {
        this.lightTimer = 0.14;
        this.world.setDayTime(this.time);
      }
    }

    onNewDay() {
      this.nightWarned = false;
      this.nightSpawnTimer = 18;
      Sfx.chime();
      this.ui.toast('DIA ' + this.day + ' · Você sobreviveu à noite.', 'good');
      this.ui.updateHUD(this);
      this.checkQuests();
      this.saveGame(true);
    }

    updateSpawning(dt) {
      const night = this.world.dayFactor < 0.24;
      if (!night) {
        if (this.nightWarned) this.nightWarned = false;
        this.nightSpawnTimer = Math.min(this.nightSpawnTimer, 18);
        return;
      }
      if (!this.nightWarned) {
        this.nightWarned = true;
        this.ui.toast('A noite caiu. Algo grande está caçando.', 'bad');
        Sfx.roar();
      }
      this.nightSpawnTimer -= dt;
      if (this.nightSpawnTimer > 0) return;
      const raptors = this.dinos.filter((d) => d.type === 'raptor' && !d.dead).length;
      if (raptors >= 3 || this.dinos.length > 16) {
        this.nightSpawnTimer = 15;
        return;
      }
      const p = this.player;
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 28 + Math.random() * 22;
        const x = p.x + Math.cos(a) * d;
        const z = p.z + Math.sin(a) * d;
        const h = this.world.heightAt(x, z);
        if (h < 1.5 || h > 15 || this.world.slopeAt(x, z) > 1.05) continue;
        this.spawnDinoAt('raptor', { x, z, h }, { yaw: Math.random() * 6.28 });
        Sfx.roar();
        this.nightSpawnTimer = 28 + Math.random() * 18;
        return;
      }
      this.nightSpawnTimer = 9;
    }

    cleanupDinos() {
      for (let i = this.dinos.length - 1; i >= 0; i--) {
        const d = this.dinos[i];
        if (!d.dead || d.deadTimer < 9) continue;
        if (d === this.mounted) this.dismount(false);
        d.dispose();
        this.dinos.splice(i, 1);
      }
    }

    die(reason) {
      if (this.dead) return;
      if (this.mounted) this.dismount(false);
      const p = this.player;
      p.hp = 0;
      p.alive = false;
      this.dead = true;
      this.paused = true;
      this.actionHeld = false;
      this.sprint = false;
      this.endJoystick();
      this.ui.el.btnSprint.classList.remove('on');
      this.playerGroup.visible = false;
      this.playerShadow.visible = false;
      this.ui.setTarget(null);
      this.ui.setAction({ icon: '✊', label: 'COLETAR', disabled: true });
      this.ui.el.mounted.classList.add('hidden');

      const lostParts = [];
      let total = 0;
      ['wood', 'stone', 'fiber', 'flint', 'berry', 'coconut', 'hide', 'meat', 'cooked'].forEach((k) => {
        const n = Math.floor((this.inv[k] || 0) / 2);
        if (n > 0) {
          this.inv[k] -= n;
          total += n;
          lostParts.push(n + ' ' + PI.RES[k].name);
        }
      });
      const lost = total > 0 ? lostParts.slice(0, 3).join(', ') : '—';
      this.ui.showDeath({
        reason: reason || 'A ilha cobrou seu preço.',
        day: this.day,
        level: p.level,
        lost: lost,
      });
      this.ui.updateHUD(this);
      Sfx.hurt();
      if (this.settings.haptic) U.vibrate([40, 50, 90]);
    }

    respawn() {
      if (!this.dead) return;
      this.ui.hide('death');
      const p = this.player;
      this.dead = false;
      this.paused = false;
      p.alive = true;
      p.hp = p.maxHp * 0.65;
      p.stamina = p.maxStamina;
      p.food = Math.max(48, p.food);
      p.water = Math.max(48, p.water);
      p.combat = 0;
      p.air = 0;
      p.vy = 0;
      p.grounded = true;
      this.placePlayerAtSpawn();
      const inward = this.inward();
      this.yaw = Math.atan2(inward.x, inward.z);
      this.pitch = -0.14;
      this.mounted = null;
      this.rider.visible = false;
      this.playerGroup.visible = true;
      this.playerShadow.visible = true;
      this.ui.el.mounted.classList.add('hidden');
      this.camera.fov = 58;
      this.camera.updateProjectionMatrix();
      this.camSnap = true;
      this.updateCamera(0.016);
      this.dinos.forEach((d) => {
        if (d.type === 'raptor' && !d.dead) {
          d.aggro = false;
          d.state = 'idle';
          d.stateTimer = 2 + Math.random() * 3;
          d.speedFactor = 0;
        }
      });
      this.lastFrame = performance.now();
      this.ui.setHUD(true);
      this.ui.updateHUD(this);
      this.ui.toast('Você renasceu na praia. Suas ferramentas continuam com você.', 'good');
      Sfx.chime();
      this.saveGame(true);
      this.updateTarget();
    }

    /* --------------------------- update --------------------------- */
    updateUI(dt) {
      this.uiTimer -= dt;
      if (this.uiTimer <= 0) {
        this.uiTimer = 0.12;
        this.ui.updateHUD(this);
      }
      this.targetTimer -= dt;
      if (this.targetTimer <= 0) {
        this.targetTimer = 0.1;
        this.updateTarget();
      }
    }

    updatePlay(dt) {
      if (!this.playing || this.paused || this.dead) return;
      this.updateTilt(dt);
      this.updateMovement(dt);
      for (let i = 0; i < this.dinos.length; i++) this.dinos[i].update(dt, this.player);
      if (this.dead) return;
      this.updatePlayerVisual(dt);

      this.actionCd = Math.max(0, this.actionCd - dt);
      if (this.actionHeld && this.actionCd <= 0) this.performAction();

      this.updateUI(dt);
      this.updateCampfires(dt);
      this.updateSurvival(dt);
      if (this.dead) return;
      this.updateTime(dt);
      this.updateSpawning(dt);
      this.cleanupDinos();
      this.updateCamera(dt);

      this.autosave -= dt;
      if (this.autosave <= 0) this.saveGame(true);
    }

    idleDinos(dt) {
      const far = { x: 99999, z: 99999, alive: false };
      for (let i = 0; i < this.dinos.length; i++) this.dinos[i].update(dt, far);
    }

    loop(now) {
      if (!this.ready) return;
      requestAnimationFrame(this.loopBound);
      let dt = (now - this.lastFrame) / 1000;
      this.lastFrame = now;
      if (!isFinite(dt) || dt < 0) dt = 0;
      dt = Math.min(dt, 0.05);

      if (this.playing) {
        if (!this.paused && !this.dead) this.updatePlay(dt);
      } else {
        this.worldElapsed += dt;
        this.updateTitleCamera(dt);
        this.idleDinos(dt);
      }

      const simDt = this.playing ? (this.paused || this.dead ? 0 : dt) : dt;
      if (!this.playing) this.world.update(dt, this.worldElapsed, this.camera);
      else this.world.update(simDt, this.worldElapsed, this.camera);
      if (this.particles) this.particles.update(simDt);
      Sfx.update(simDt, this.world.dayFactor < 0.25);
      this.renderer.render(this.scene, this.camera);
    }
  }

  window.Game = Game;
  window.game = new Game();
})();
