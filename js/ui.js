/* ============================================================
   PRIMAL ISLE — HUD, menus, crafting and minimap
   ============================================================ */
(function () {
  'use strict';
  const U = window.U;
  const PI = window.PI;

  class GameUI {
    constructor(game) {
      this.game = game;
      const $ = (id) => document.getElementById(id);
      this.el = {
        hud: $('hud'),
        menu: $('menu'),
        pause: $('pause'),
        craft: $('craft'),
        death: $('death'),
        boot: $('boot'),
        bootText: $('boot-text'),
        intro: $('intro-card'),
        introDay: $('intro-day'),
        introSub: $('intro-sub'),
        levelNum: $('level-num'),
        statusSub: $('status-sub'),
        xpLabel: $('xp-label'),
        xpFill: $('xp-fill'),
        barHealth: $('bar-health'),
        barStamina: $('bar-stamina'),
        barFood: $('bar-food'),
        barWater: $('bar-water'),
        numHealth: $('num-health'),
        numStamina: $('num-stamina'),
        numFood: $('num-food'),
        numWater: $('num-water'),
        questText: $('quest-text'),
        clock: $('clock'),
        weatherIco: $('weather-ico'),
        weatherText: $('weather-text'),
        minimap: $('minimap'),
        targetLabel: $('target-label'),
        targetName: $('target-name'),
        targetHint: $('target-hint'),
        hotbar: $('hotbar'),
        actionIco: $('action-ico'),
        actionLabel: $('action-label'),
        btnAction: $('btn-action'),
        btnSprint: $('btn-sprint'),
        btnJump: $('btn-jump'),
        btnBag: $('btn-bag'),
        btnPause: $('btn-pause'),
        toasts: $('toasts'),
        floating: $('floating-layer'),
        vignette: $('fx-vignette'),
        damage: $('fx-damage'),
        flash: $('fx-flash'),
        joystick: $('joystick'),
        mounted: $('mounted-tag'),
        desktopHint: $('desktop-hint'),
        invStrip: $('inv-strip'),
        recipeList: $('recipe-list'),
        craftCount: $('craft-count'),
        tameStatus: $('tame-status'),
        tameCard: $('tame-card'),
        sens: $('set-sens'),
        sensOut: $('sens-out'),
        quality: $('set-quality'),
        sound: $('btn-sound'),
        tilt: $('btn-tilt'),
        calibrate: $('btn-calibrate'),
        tiltNote: $('tilt-note'),
        haptic: $('btn-haptic'),
        saveNote: $('save-note'),
        continueBtn: $('btn-continue'),
        continueMeta: $('continue-meta'),
        deviceHint: $('device-hint'),
        deathReason: $('death-reason'),
        deathDay: $('death-day'),
        deathLevel: $('death-level'),
        deathLost: $('death-lost'),
      };
      this.slots = [];
      this.toastList = [];
      this.btnCache = new Map();
      this.tameBar = null;
      this.buildHotbar();
      this.buildTameBar();
      this.bind();
      this.detectDevice();
    }

    /* ---------------------------- setup ---------------------------- */
    buildHotbar() {
      this.el.hotbar.innerHTML = '';
      this.slots = PI.HOTBAR.map((item, i) => {
        const btn = document.createElement('button');
        btn.className = 'slot';
        btn.type = 'button';
        btn.dataset.index = i;
        btn.innerHTML =
          '<span class="key">' + (i + 1) + '</span>' +
          '<span class="ico">' + item.icon + '</span>' +
          '<span class="nm">' + item.name + '</span>' +
          '<span class="cnt"></span>';
        btn.addEventListener('click', () => {
          this.game.selectSlot(i);
        });
        this.el.hotbar.appendChild(btn);
        return btn;
      });
    }

    buildTameBar() {
      const host = this.el.tameCard && this.el.tameCard.querySelector('div');
      if (!host) return;
      this.tameBar = document.createElement('div');
      this.tameBar.className = 'tame-bar';
      this.tameBar.innerHTML = '<i></i>';
      host.appendChild(this.tameBar);
    }

    bind() {
      const game = this.game;
      const on = (id, ev, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(ev, fn);
      };

      on('btn-continue', 'click', () => game.continueGame());
      on('btn-new', 'click', () => game.newGame());
      on('btn-settings', 'click', () => game.openPause());
      on('btn-pause', 'click', () => game.openPause());
      on('btn-resume', 'click', () => game.closePause());
      on('btn-resume-2', 'click', () => game.closePause());
      on('btn-title', 'click', () => game.returnToTitle());
      on('btn-wipe', 'click', () => game.wipeProgress());
      on('btn-craft-close', 'click', () => game.closeCraft());
      on('btn-respawn', 'click', () => game.respawn());
      on('btn-bag', 'click', () => game.openCraft());

      on('set-sens', 'input', (e) => game.setSensitivity(parseFloat(e.target.value)));
      on('set-quality', 'change', (e) => game.setQuality(e.target.value));
      on('btn-sound', 'click', () => game.setSound(!game.settings.sound));
      on('btn-haptic', 'click', () => game.setHaptic(!game.settings.haptic));
      on('btn-tilt', 'click', () => game.toggleTilt());
      on('btn-calibrate', 'click', () => game.calibrateTilt());

      // contextual action is hold-to-repeat
      this.el.btnAction.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        game.actionDown();
      });
      const actionUp = (e) => {
        if (e) e.stopPropagation();
        game.actionUp();
      };
      this.el.btnAction.addEventListener('pointerup', actionUp);
      this.el.btnAction.addEventListener('pointercancel', actionUp);
      this.el.btnAction.addEventListener('pointerleave', actionUp);

      this.el.btnSprint.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        game.setSprint(true);
      });
      const sprintUp = (e) => {
        if (e) e.stopPropagation();
        game.setSprint(false);
      };
      this.el.btnSprint.addEventListener('pointerup', sprintUp);
      this.el.btnSprint.addEventListener('pointercancel', sprintUp);
      this.el.btnSprint.addEventListener('pointerleave', sprintUp);

      this.el.btnJump.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        game.jump();
      });

      this.el.recipeList.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-recipe]');
        if (!btn) return;
        game.craft(btn.dataset.recipe);
      });

      [this.el.pause, this.el.craft].forEach((overlay) => {
        overlay.addEventListener('click', (e) => {
          if (e.target !== overlay) return;
          if (overlay === this.el.pause) game.closePause();
          else game.closeCraft();
        });
      });

      document.fonts && document.fonts.ready && document.fonts.ready.then(() => {
        if (this.game.dinos) this.game.dinos.forEach((d) => d.refreshLabel());
      });
    }

    detectDevice() {
      const coarse = U.isCoarse();
      this.el.deviceHint.textContent = coarse
        ? '📱 Direcional para andar · arraste para olhar'
        : '🖥️ WASD + mouse · E coleta · C cria · Shift corre';
      if (!coarse) this.el.desktopHint.classList.remove('hidden');
    }

    /* --------------------------- overlays --------------------------- */
    show(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('hidden');
      el.setAttribute('aria-hidden', 'false');
    }

    hide(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.add('hidden');
      el.setAttribute('aria-hidden', 'true');
    }

    setHUD(visible) {
      this.el.hud.classList.toggle('hidden', !visible);
    }

    bootText(text) {
      this.el.bootText.textContent = text;
    }

    /* --------------------------- feedback --------------------------- */
    toast(text, type) {
      const el = document.createElement('div');
      el.className = 'toast' + (type ? ' ' + type : '');
      el.textContent = text;
      this.el.toasts.appendChild(el);
      this.toastList.push(el);
      while (this.toastList.length > 4) {
        const old = this.toastList.shift();
        if (old && old.parentNode) old.remove();
      }
      setTimeout(() => {
        el.classList.add('out');
        setTimeout(() => el.remove(), 320);
      }, 2800);
    }

    floatText(text, pos, cls) {
      if (!pos || !this.game.camera) return;
      const screen = U.projectToScreen(pos, this.game.camera, window.innerWidth, window.innerHeight);
      if (!screen.visible) return;
      this.floatScreen(text, screen.x, screen.y, cls);
    }

    floatScreen(text, x, y, cls) {
      const el = document.createElement('span');
      el.className = 'floaty' + (cls ? ' ' + cls : '');
      el.textContent = text;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      this.el.floating.appendChild(el);
      setTimeout(() => el.remove(), 1250);
    }

    flashDamage() {
      this.el.damage.classList.remove('hit');
      void this.el.damage.offsetWidth;
      this.el.damage.classList.add('hit');
    }

    whiteFlash() {
      this.el.flash.classList.remove('flash');
      void this.el.flash.offsetWidth;
      this.el.flash.classList.add('flash');
    }

    /* ---------------------------- action ---------------------------- */
    setAction(action) {
      const a = action || { icon: '✊', label: 'COLETAR', disabled: true };
      if (this.el.actionIco.textContent !== a.icon) this.el.actionIco.textContent = a.icon;
      if (this.el.actionLabel.textContent !== a.label) this.el.actionLabel.textContent = a.label;
      this.el.btnAction.classList.toggle('disabled', !!a.disabled);
      this.el.btnAction.classList.toggle('pulse', !!a.pulse);
      this.el.btnAction.setAttribute('aria-disabled', a.disabled ? 'true' : 'false');
    }

    setTarget(target) {
      if (!target) {
        this.el.targetLabel.classList.add('hidden');
        return;
      }
      this.el.targetLabel.classList.remove('hidden');
      this.el.targetLabel.classList.toggle('hostile', !!target.hostile);
      this.el.targetName.textContent = target.name;
      this.el.targetHint.textContent = target.hint || '';
    }

    /* ----------------------------- HUD ----------------------------- */
    updateHUD(game) {
      const p = game.player;
      const hpPct = U.clamp((p.hp / p.maxHp) * 100, 0, 100);
      const stPct = U.clamp((p.stamina / p.maxStamina) * 100, 0, 100);
      this.el.barHealth.style.width = hpPct + '%';
      this.el.barStamina.style.width = stPct + '%';
      this.el.barFood.style.width = U.clamp(p.food, 0, 100) + '%';
      this.el.barWater.style.width = U.clamp(p.water, 0, 100) + '%';
      this.el.numHealth.textContent = Math.ceil(p.hp);
      this.el.numStamina.textContent = Math.ceil(p.stamina);
      this.el.numFood.textContent = Math.ceil(p.food);
      this.el.numWater.textContent = Math.ceil(p.water);
      this.el.levelNum.textContent = p.level;
      const need = game.xpForNext();
      this.el.xpLabel.textContent = Math.floor(p.xp) + ' / ' + need + ' XP';
      this.el.xpFill.style.width = U.clamp((p.xp / need) * 100, 0, 100) + '%';
      this.el.statusSub.textContent = 'Ilha desconhecida · Dia ' + game.day;
      this.el.questText.textContent = game.getQuestText();
      this.el.questText.classList.toggle('done', game.questIndex >= game.quests.length);

      const time = U.fmtClock(game.time);
      this.el.clock.innerHTML = 'DIA ' + game.day + ' <b>' + time + '</b>';
      const w = this.getWeather();
      this.el.weatherIco.textContent = w.icon;
      this.el.weatherText.textContent = w.text;
      this.el.vignette.classList.toggle('low', p.hp < p.maxHp * 0.3);
      this.el.mounted.classList.toggle('hidden', !game.mounted);
      this.updateHotbar(game);
      this.drawMinimap(game);
      if (!this.el.craft.classList.contains('hidden')) this.renderCraft(game);
      this.saveNote();
    }

    updateHotbar(game) {
      PI.HOTBAR.forEach((item, i) => {
        const btn = this.slots[i];
        if (!btn) return;
        const available = game.isSlotAvailable(item);
        const count = item.kind === 'food' ? game.inv[item.res] || 0 : 0;
        btn.classList.toggle('locked', !available);
        btn.classList.toggle('selected', game.selected === i);
        const cnt = btn.querySelector('.cnt');
        cnt.textContent = count > 0 ? count : '';
        btn.setAttribute('aria-label', item.name + (count > 0 ? ' (' + count + ')' : ''));
      });
    }

    saveNote() {
      if (!this.el.saveNote) return;
      if (this.game.lastSaveAt) {
        const d = new Date(this.game.lastSaveAt);
        this.el.saveNote.textContent =
          'Salvo automaticamente às ' + U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes()) + '.';
      }
    }

    getWeather() {
      const g = this.game;
      if (g.world && g.world.dayFactor < 0.18) return { icon: '🌙', text: 'NOITE FRIA' };
      if (g.world && g.world.warmFactor > 0.45) {
        return g.time > 0.5 ? { icon: '🌅', text: 'CREPÚSCULO' } : { icon: '🌄', text: 'AMANHECER' };
      }
      if (g.world && g.world.dayFactor < 0.55) return { icon: '🌤️', text: 'NUBLADO' };
      return { icon: '☀️', text: 'ENSOLARADO' };
    }

    /* ---------------------------- craft ---------------------------- */
    renderCraft(game) {
      const parts = [];
      Object.keys(PI.RES).forEach((key) => {
        const n = game.inv[key] || 0;
        if (n <= 0) return;
        const res = PI.RES[key];
        parts.push('<span class="inv-chip"><span>' + res.icon + '</span>' + res.name + ' <b>' + n + '</b></span>');
      });
      this.el.invStrip.innerHTML = parts.length
        ? parts.join('')
        : '<span class="inv-chip" style="opacity:.55">Sem recursos. Colete madeira, pedra e frutas na ilha.</span>';

      let owned = 0;
      this.el.recipeList.innerHTML = PI.RECIPES.map((r) => {
        const isOwned = game.isRecipeOwned(r);
        if (isOwned) owned++;
        const affordable = game.canAfford(r.cost);
        const maxed = isOwned && !r.repeat;
        const cost = Object.keys(r.cost).map((k) => {
          const have = game.inv[k] || 0;
          const need = r.cost[k];
          return '<span class="' + (have < need ? 'lack' : '') + '">' +
            PI.RES[k].icon + ' ' + have + '/' + need + '</span>';
        }).join('');
        let button;
        if (maxed) {
          button = '<button disabled>PRONTO</button>';
        } else {
          const label = r.type === 'campfire' ? 'COLOCAR' : r.type === 'heal' ? 'USAR' : 'CRIAR';
          button = '<button data-recipe="' + r.id + '" ' + (affordable ? '' : 'disabled') + '>' + label + '</button>';
        }
        return '<div class="recipe ' + (affordable ? 'affordable' : '') + ' ' + (maxed ? 'maxed' : '') + '">' +
          '<span class="r-ico">' + r.icon + '</span>' +
          '<div class="r-main"><strong>' + r.name + '</strong>' +
          '<span class="r-desc">' + r.desc + '</span>' +
          '<span class="cost">' + cost + '</span></div>' +
          button + '</div>';
      }).join('');
      this.el.craftCount.textContent = owned + ' / ' + PI.RECIPES.length + ' DESBLOQUEADAS';

      const dino = game.getTameDino();
      let text = 'Ainda selvagem. Ofertas de frutas podem conquistá-lo.';
      let pct = 0;
      if (dino) {
        if (dino.tamed) {
          pct = 100;
          if (dino.saddle) text = 'Domesticado e selado. Aproxime-se para montar.';
          else if ((game.inv.saddle || 0) > 0) text = 'Domesticado. Você tem uma sela: aproxime-se e sele.';
          else text = 'Domesticado. Crie uma sela de couro para montar.';
        } else {
          pct = dino.taming || 0;
          text = 'Domesticado ' + Math.round(pct) + '% · ofereça frutas (' + (game.inv.berry || 0) + ' na mochila).';
        }
      }
      this.el.tameStatus.textContent = text;
      if (this.tameBar) this.tameBar.querySelector('i').style.width = pct + '%';
    }

    /* ---------------------------- menu ---------------------------- */
    updateMenu(save) {
      if (save) {
        this.el.continueBtn.classList.remove('hidden');
        const level = save.level || 1;
        const day = save.day || 1;
        this.el.continueMeta.textContent = 'Dia ' + day + ' · Nível ' + level + ' · ' + U.fmtClock(save.time || PI.DAY_START);
      } else {
        this.el.continueBtn.classList.add('hidden');
      }
    }

    syncSettings(settings, game) {
      this.el.sens.value = settings.sens;
      this.el.sensOut.textContent = Number(settings.sens).toFixed(1) + '×';
      this.el.quality.value = settings.quality;
      this.setToggle(this.el.sound, settings.sound);
      this.setToggle(this.el.haptic, settings.haptic);
      this.setToggle(this.el.tilt, settings.tilt);
      this.el.calibrate.disabled = !settings.tilt;
      this.el.tiltNote.textContent = settings.tilt
        ? 'Inclinação ativa. Incline o aparelho para olhar; use “centralizar” se ficar torto.'
        : 'A inclinação é opcional e fica desligada por padrão.';
      if (!U.isCoarse()) this.el.desktopHint.classList.remove('hidden');
    }

    setToggle(el, on) {
      if (!el) return;
      el.classList.toggle('on', !!on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
      const span = el.querySelector('span');
      if (span) span.textContent = on ? 'ON' : 'OFF';
    }

    setTiltUI(settings, message) {
      this.setToggle(this.el.tilt, settings.tilt);
      this.el.calibrate.disabled = !settings.tilt;
      if (message) this.el.tiltNote.textContent = message;
      else if (settings.tilt) this.el.tiltNote.textContent = 'Inclinação ativa. Incline o aparelho para olhar; use “centralizar” se ficar torto.';
      else this.el.tiltNote.textContent = 'A inclinação é opcional e fica desligada por padrão.';
    }

    showDeath(info) {
      this.el.deathReason.textContent = info.reason;
      this.el.deathDay.textContent = info.day;
      this.el.deathLevel.textContent = info.level;
      this.el.deathLost.textContent = info.lost;
      this.show('death');
    }

    showIntro(day) {
      this.el.introDay.textContent = day;
      this.el.intro.classList.remove('hidden');
      void this.el.intro.offsetWidth;
      this.el.intro.classList.add('show');
    }

    hideIntro() {
      this.el.intro.classList.remove('show');
      setTimeout(() => {
        if (!this.el.intro.classList.contains('show')) this.el.intro.classList.add('hidden');
      }, 720);
    }

    /* --------------------------- minimap --------------------------- */
    drawMinimap(game) {
      const canvas = this.el.minimap;
      if (!canvas || !game.world || !game.world.mapCanvas) return;
      const ctx = canvas.getContext('2d');
      const size = canvas.width;
      const view = 150;
      const srcSize = (view / 360) * game.world.mapCanvas.width;
      const cx = ((game.player.x + 180) / 360) * game.world.mapCanvas.width;
      const cz = ((game.player.z + 180) / 360) * game.world.mapCanvas.height;

      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#07191c';
      ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        game.world.mapCanvas,
        cx - srcSize / 2,
        cz - srcSize / 2,
        srcSize,
        srcSize,
        0,
        0,
        size,
        size
      );

      const toMap = (wx, wz) => ({
        x: ((wx - game.player.x) / view + 0.5) * size,
        y: ((wz - game.player.z) / view + 0.5) * size,
      });

      // obelisk
      const ob = toMap(0, 0);
      ctx.save();
      ctx.translate(ob.x, ob.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#79e6d7';
      ctx.fillRect(-3.5, -3.5, 7, 7);
      ctx.restore();

      // campfires
      game.world.campfires.forEach((f) => {
        const p = toMap(f.x, f.z);
        ctx.fillStyle = '#ff9a45';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      });

      // crates
      game.world.crates.forEach((c) => {
        if (c.looted) return;
        const p = toMap(c.x, c.z);
        ctx.fillStyle = '#ffd47a';
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      });

      // dinosaurs
      game.dinos.forEach((d) => {
        if (d.dead) return;
        const p = toMap(d.x, d.z);
        if (p.x < -8 || p.y < -8 || p.x > size + 8 || p.y > size + 8) return;
        let color = '#9bc9a5';
        if (d.type === 'raptor') color = '#ff6b5e';
        else if (d.type === 'dodo') color = '#d8d1b6';
        else if (d.tamed) color = '#79e6d7';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, d.type === 'raptor' ? 3.2 : 2.5, 0, Math.PI * 2);
        ctx.fill();
      });

      // view ring
      ctx.strokeStyle = 'rgba(230,192,123,.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.36, 0, Math.PI * 2);
      ctx.stroke();

      // player arrow
      ctx.save();
      ctx.translate(size / 2, size / 2);
      ctx.rotate(Math.PI - game.yaw);
      ctx.fillStyle = '#ffe9bb';
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(5.5, 5.5);
      ctx.lineTo(0, 2.8);
      ctx.lineTo(-5.5, 5.5);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.restore();

      const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.32, size / 2, size / 2, size * 0.5);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,8,8,.42)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      ctx.restore();
    }
  }

  window.GameUI = GameUI;
})();
