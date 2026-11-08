// Interactive training run: one mechanic at a time, nothing can kill you except the scripted revive drill.

const glyph = (g) => `<k>${g}</k>`;

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('tut');
    this.active = false;
  }

  humans() {
    return this.game.players.filter((p) => this.game.slots[p.id] !== 'ai');
  }

  steps() {
    const g = this.game;
    const solo = g.solo;
    const down = this.downTarget();
    const helper = g.players[1 - down.id];
    return [
      {
        title: 'FLY',
        text: `Steer with the ${glyph('LEFT STICK')} (WASD / arrows). Left and right moves across the trench; up and down changes height. You always fly forward.`,
        each: (p, dt) => (Math.abs(p.ctrl.mx) > 0.3 || Math.abs(p.ctrl.my) > 0.3 ? dt : 0),
        need: 2.5,
      },
      {
        title: 'BOOST',
        text: `Hold ${glyph('A')} (Shift / .) to <b>BOOST</b>. The blue/orange bar bottom-left is your boost. It refills slowly, and faster when you destroy enemies.`,
        each: (p, dt) => (p.boosting ? dt : 0),
        need: 1.2,
        keepEnergy: true,
      },
      {
        title: 'BARREL ROLL',
        text: `Press ${glyph('B')} (R / ,) to <b>BARREL ROLL</b>: a quick sidestep. Nothing can hurt you while you're rolling, so use it to dodge shots and lasers.`,
        each: (p) => (p.rolling && !p._tutRoll ? 1 : 0),
        need: 2,
      },
      {
        title: 'GUNS',
        text: `Hold ${glyph('RT')} (F / slash) to <b>FIRE</b>. Your guns aim themselves at whatever is in front of you (red brackets). Shoot down the drones ahead.`,
        team: () => g.stats.kills - this.base.kills,
        need: 3,
        unit: 'DRONES',
        spawn: () => {
          if (g.enemies.list.length) return;
          for (let i = 0; i < 3; i++) {
            const e = g.enemies.spawn('hunter', { ds: 140 + i * 15, x: (i - 1) * 9, y: 7 }, g);
            e.ds = 70 + i * 10;
            e.retarget = 99;
          }
        },
      },
      {
        title: 'THE TETHER',
        text: `The glowing beam between your two ships is the <b>TETHER</b>. It destroys any enemy it touches. Spread apart and fly so the drones pass <b>between</b> you. These ones are armored, so guns barely hurt them.`,
        team: () => g.stats.tetherKills - this.base.tetherKills,
        need: 3,
        unit: 'SEVERED',
        spawn: () => {
          if (g.enemies.list.some((e) => e.kind === 'sweeper')) return;
          const y = (g.players[0].y + g.players[1].y) / 2;
          const side = Math.random() < 0.5 ? -1 : 1;
          const hw = g.track.hw(g.sRef + 200);
          for (let i = 0; i < 4; i++) g.enemies.spawn('sweeper', { ds: 110, x: side * (hw + 4 + i * 8), y, side: -side, speed: 9 }, g);
        },
      },
      {
        title: 'STAY TOGETHER',
        text: `The tether also <b>blocks enemy fire</b>, so it can shield you both. Don't drift too far apart: past about <b>80 m</b> it <b>SNAPS</b> (HUD bottom-centre). Fly back together and it relinks.`,
        timer: 8,
      },
      {
        title: 'SYNC BURST',
        text: solo
          ? `<b>Double-tap</b> ${glyph('A')} and your wingman boosts with you: a <b>SYNC BURST</b>. Huge speed, a shockwave that wipes nearby enemies, and 3 seconds of invulnerability. "SYNC READY" means you can do it.`
          : `Both press ${glyph('A')} at the <b>same moment</b> for a <b>SYNC BURST</b>: huge speed, a shockwave that wipes nearby enemies, and 3 seconds of invulnerability. "SYNC READY" means you both have enough boost.`,
        team: () => g.stats.syncs - this.base.syncs,
        need: 1,
        unit: 'SYNC',
        keepEnergy: true,
      },
      {
        title: 'REVIVE',
        text: `When a ship's hull hits zero it goes <b>DOWN</b> and drifts behind. <b>P${down.id + 1} is down</b> (green beacon). <b>P${helper.id + 1}</b>: fly right up to the wreck and <b>stay next to it</b> until the bar fills. If you're both down at once, you restart the sector.`,
        team: () => g.stats.revives - this.base.revives,
        need: 1,
        unit: 'REVIVE',
        enter: () => {
          setTimeout(() => {
            if (!this.active || this.stepIdx !== 7) return;
            this.allowDown = true;
            down.hull = 0;
            g.onPlayerDowned(down);
            this.allowDown = false;
          }, 2500);
        },
      },
      {
        title: 'READY',
        text: `Training complete. In the real mission the trench <b>collapses behind you</b>, so keep moving, and a boss waits at the end. <b>Press ${glyph('A')} (Space / Enter) to launch.</b>`,
        final: true,
      },
    ];
  }

  downTarget() {
    const g = this.game;
    // in solo, knock down the AI so the human practices the revive
    if (g.slots[1] === 'ai') return g.players[1];
    if (g.slots[0] === 'ai') return g.players[0];
    return g.players[1];
  }

  start() {
    this.active = true;
    this.list = this.steps();
    this.stepIdx = -1;
    this.el.classList.add('on');
    this.next();
  }

  stop() {
    this.active = false;
    this.el.classList.remove('on');
  }

  next() {
    const g = this.game;
    this.stepIdx++;
    this.step = this.list[this.stepIdx];
    this.prog = [0, 0];
    this.doneT = -1;
    this.stepT = 0;
    this.base = { kills: g.stats.kills, tetherKills: g.stats.tetherKills, syncs: g.stats.syncs, revives: g.stats.revives };
    g.enemies.clear();
    if (this.step.enter) this.step.enter();
    this.render();
  }

  update(dt) {
    const g = this.game;
    if (!this.active || g.state !== 'play') return;
    const st = this.step;
    this.stepT += dt;
    // loop the training stretch of trench
    if (g.sRef > 4700) this.wrap(-3800);
    for (const p of g.players) {
      if (st.keepEnergy && p.energy < 45) p.energy = 45;
      if (!p.downed && p.hull < 40) p.hull = 40;
    }
    if (st.final) {
      if (g.slots.some((d) => g.input.pressed(d, 'confirm'))) g.finishTraining();
      return;
    }
    if (this.doneT >= 0) {
      this.doneT -= dt;
      if (this.doneT < 0) this.next();
      return;
    }
    let complete = false;
    if (st.each) {
      for (const p of this.humans()) {
        this.prog[p.id] = Math.min(st.need, this.prog[p.id] + st.each(p, dt));
        p._tutRoll = p.rolling;
      }
      complete = this.humans().every((p) => this.prog[p.id] >= st.need);
    } else if (st.team) {
      st.spawn?.();
      this.teamVal = Math.min(st.need, st.team());
      complete = this.teamVal >= st.need;
    } else if (st.timer) {
      complete = this.stepT > st.timer;
    }
    if (complete) {
      this.doneT = 1.4;
      g.audio.revive();
      for (const p of g.players) g.input.rumble(p.dev, 0.3, 0.5, 150);
      try { localStorage.setItem('tether.trained', '1'); } catch (e) { /* ignore */ }
    }
    this.render();
  }

  wrap(ds) {
    const g = this.game;
    for (const p of g.players) {
      p.s += ds; p.prevS += ds; p.camS += ds;
      p._place(0);
      for (const t of p.trails) t.reset(p.pos);
    }
    g.enemies.clear();
    g.weapons.clear();
    g.sRef += ds;
  }

  render() {
    const st = this.step;
    if (!st) return;
    const n = this.list.length;
    let prog = '';
    if (st.each) {
      prog = this.humans().map((p) => {
        const f = this.prog[p.id] / st.need;
        return `<span class="tp p${p.id + 1}">P${p.id + 1} ${f >= 1 ? '✓' : `<i style="--f:${f}"></i>`}</span>`;
      }).join('');
    } else if (st.team) prog = `<span class="tp">${this.teamVal | 0} / ${st.need} ${st.unit}</span>`;
    else if (st.timer) prog = `<span class="tp"><i style="--f:${Math.min(1, this.stepT / st.timer)}"></i></span>`;
    const done = this.doneT >= 0 ? '<div class="tdone">✓ NICE</div>' : '';
    const html = `<div class="tstep">TRAINING ${this.stepIdx + 1}/${n} · ${st.title}</div><div class="ttext">${st.text}</div><div class="tprog">${prog}</div>${done}`;
    if (html !== this._last) {
      this.el.innerHTML = html;
      this._last = html;
    }
  }
}
