// director.js — the haunting itself. One-shot triggers, timelines, the
// looping hallway, the phone, the sightings, and the blackout finale.

import { CELL, regionAtWorld } from './map.js';

export class Director {
  constructor({ world, player, entity, audio, ui, onWin, onDeath }) {
    this.world = world;
    this.player = player;
    this.entity = entity;
    this.audio = audio;
    this.ui = ui;
    this.onWin = onWin;
    this.onDeath = onDeath;

    this.fuses = 0;
    this.phase = 'explore';   // explore | blackout | arrived | done
    this.fired = new Set();
    this.timers = [];          // {t, fn}
    this.time = 0;
    this.elevatorTimer = 0;
    this.elevatorTotal = 70;
    this.hallwayLoops = 0;
    this.hallwayArmed = true;
    this.ambientT = 18;
    this.cameoCheck = null;

    entity.onKill = () => this._kill();
    entity.onSeared = () => {
      this.audio.screech();
      this.ui.subtitle('it does not like the light.');
    };

    this._registerInteractables();
  }

  _after(sec, fn) { this.timers.push({ t: this.time + sec, fn }); }

  _once(key, fn) {
    if (this.fired.has(key)) return false;
    this.fired.add(key);
    fn();
    return true;
  }

  start() {
    this.ui.objective('the elevator is dead. find 3 fuses.');
    this._after(2.5, () => this.ui.subtitle('3:33 am. the floor hums. everyone is gone.'));
    this._after(9, () => this.ui.subtitle('you don’t remember staying this late.'));
  }

  // ------------------------------------------------------------ interactables
  _registerInteractables() {
    const w = this.world, m = w.markers;

    w.pickups.forEach(p => {
      const pos = { x: p.mesh.position.x, z: p.mesh.position.z };
      w.addInteract({
        x: pos.x, z: pos.z, r: 1.9,
        label: p.kind === 'fuse' ? '[E] take fuse' : '[E] take battery',
        visible: () => !p.taken,
        use: () => {
          p.taken = true;
          p.mesh.visible = false;
          this.audio.pickup();
          if (p.kind === 'battery') {
            this.player.addBattery(55);
          } else {
            this.fuses++;
            this.ui.fuses(this.fuses);
            this._onFuse(p.idx);
          }
        },
      });
    });

    // the desk phone
    w.addInteract({
      x: m.phone.x + 0.8, z: m.phone.z - 0.6, r: 1.8,
      label: '[E] answer',
      visible: () => w.phoneRinging,
      use: () => this._answerPhone(),
    });

    // breaker panel by the elevator
    w.addInteract({
      x: w.panelPos.x, z: w.panelPos.z, r: 2.0,
      label: () => this.fuses >= 3 ? '[E] insert fuses' : 'needs 3 fuses',
      visible: () => this.phase === 'explore',
      usable: () => this.fuses >= 3,
      use: () => this._restorePower(),
    });
  }

  // ------------------------------------------------------------ fuse beats
  _onFuse(idx) {
    if (this.fuses >= 3) {
      this.ui.objective('return to the elevator.');
      this.audio.whisper(0);
      this.world.globalUnease = 0.10;
      this._after(1.5, () => this.ui.subtitle('the building knows.'));
      return;
    }
    this.ui.objective(`find ${3 - this.fuses} more fuse${this.fuses === 2 ? '' : 's'}.`);

    if (idx === 0) {
      // cubicle fuse → the phone starts ringing behind you
      this._after(2.5, () => {
        this.world.phoneRinging = true;
        const m = this.world.markers.phone;
        this.audio.phoneStart(() => this._panTo(m.x, m.z));
        this._after(30, () => {
          if (this.world.phoneRinging) { this.world.phoneRinging = false; this.audio.phoneStop(); }
        });
      });
    }

    if (idx === 1) {
      // server fuse → the room dies, racks turn red, something waits in the corridor
      this.world.regionOn.server = false;
      this.world.setLedRed();
      this.audio.slam(0.4, 0);
      this.ui.subtitle('the servers are still warm.');
      const ex = 82, ez = 12.5 * CELL; // standing in the long hallway
      this.entity.placeCameo(ex, ez, this.player.pos.x, this.player.pos.z);
      this.audio.setPower(true);
      this._watchCameo(6, 0.7);
    }
  }

  _watchCameo(vanishDist, litTime) {
    let litFor = 0;
    this.cameoCheck = (dt) => {
      if (this.entity.state !== 'cameo') { this.cameoCheck = null; return; }
      const e = this.entity.pos, p = this.player.pos;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (this.player.flashlightLit(e.clone().setY(2.2), 24)) litFor += dt;
      if (d < vanishDist || litFor > litTime) {
        this.entity.vanish();
        this.audio.stinger(0.9);
        this.player.flashFlickerT = 0.35;
        this.ui.subtitle('it was looking at you.');
        this.cameoCheck = null;
      }
    };
  }

  _answerPhone() {
    this.world.phoneRinging = false;
    this.audio.phoneStop();
    this.audio.pickup();
    this._after(0.8, () => {
      this.audio.whisper(0);
      this.ui.subtitle('“…still… here…”');
    });
    this._after(2.6, () => {
      // every light in the cubicle farm sputters, then a door slams
      const fx = this.world.fixturesIn('cubicles');
      fx.forEach(f => { f.flicker = 0.9; });
      this.audio.buzz(1.5);
      this._after(1.6, () => {
        fx.forEach(f => { f.flicker = f.broken ? f.flicker : 0.1; });
        this.audio.slam(0.7, this._panTo(this.player.pos.x - 8, this.player.pos.z));
      });
    });
  }

  _panTo(x, z) {
    // crude stereo pan from player facing
    const fwd = this.player.forward();
    const dx = x - this.player.pos.x, dz = z - this.player.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    return Math.max(-1, Math.min(1, (fwd.z * (dx / d) - fwd.x * (dz / d))));
  }

  // ------------------------------------------------------------ finale
  _restorePower() {
    if (this.fuses < 3) { this.audio.buzz(0.7); this.ui.subtitle('not enough fuses.'); return; }
    this.phase = 'blackout';
    this.elevatorTimer = this.elevatorTotal + 1.4; // counts through the dramatic pause below
    this.audio.pickup();
    this.ui.objective('');
    // one second of glory…
    this.world.fixtures.forEach(f => { f.flicker = 0; f.broken = false; });
    this.audio.ding();
    this.world.setDisplay('7', '#cfb');
    this._after(1.4, () => {
      // …then everything dies.
      this.world.blackout();
      this.audio.setPower(false);
      this.audio.setBlackout(true);
      this.audio.slam(0.9, 0);
      this.ui.objective('survive. the elevator is coming.');
      this.ui.subtitle('the floor below has noticed the power draw.');
      this._after(5, () => this.entity.startHunt(this.player.pos));
    });
  }

  _arrive() {
    this.phase = 'arrived';
    this.audio.ding();
    this.audio.rumble(2.2);
    this.world.setDisplay('B1', '#cfb');
    this.world.elevatorArrive();
    this.ui.objective('get in.');
    this.ui.subtitle('ding.');
  }

  _kill() {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.audio.screech();
    this.onDeath();
  }

  _win() {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.entity.stopHunt();
    this.world.doorTarget = 0;
    this.audio.rumble(3.0);
    this.onWin();
  }

  // ------------------------------------------------------------ ambient dread
  _ambient() {
    const roll = Math.random();
    const p = this.player.pos;
    if (roll < 0.3) {
      this.audio.slam(0.18 + Math.random() * 0.2, (Math.random() - 0.5) * 1.6);
    } else if (roll < 0.55 && this.fuses >= 1) {
      this.audio.whisper((Math.random() - 0.5) * 1.4);
    } else if (roll < 0.8) {
      // nearest fixture sputters
      const near = this.world.fixtures
        .filter(f => f.bright > 0.1)
        .sort((a, b) => ((a.x - p.x) ** 2 + (a.z - p.z) ** 2) - ((b.x - p.x) ** 2 + (b.z - p.z) ** 2))[0];
      if (near) {
        const old = near.flicker;
        near.flicker = 0.95;
        this.audio.buzz(1);
        this._after(1.2, () => { near.flicker = old; });
      }
    } else if (this.fuses >= 2) {
      // footsteps that are not yours
      let i = 0;
      const step = () => {
        if (i++ < 4) { this.audio.footstep(false); this._after(0.32, step); }
      };
      step();
    }
  }

  // ------------------------------------------------------------ update
  update(dt) {
    this.time += dt;
    // collect due timers first — firing them may schedule new ones via _after
    const due = [];
    this.timers = this.timers.filter(tm => tm.t > this.time ? true : (due.push(tm), false));
    due.forEach(tm => tm.fn());
    if (this.cameoCheck) this.cameoCheck(dt);

    const p = this.player.pos;
    const region = regionAtWorld(p.x, p.z);

    // -- first time entering the long hallway: lights die toward you
    if (region === 'corridor' && p.z < 26 * CELL && p.z > 7 * CELL) {
      this._once('corridorCascade', () => {
        const fx = this.world.fixtures
          .filter(f => f.region === 'corridor' && f.cx >= 20 && f.cy <= 16)
          .sort((a, b) => a.cy - b.cy); // far (north) first
        fx.forEach((f, i) => this._after(0.5 + i * 0.22, () => { f.on = false; this.audio.buzz(0.8); }));
        this._after(0.5 + fx.length * 0.22 + 2.2, () => {
          fx.forEach(f => { f.on = true; });
          this.audio.buzz(1.2);
          this.ui.subtitle('the dark is patient.');
        });
      });
    }

    // -- the hallway that loops (before the server fuse is taken)
    if (this.hallwayArmed && this.fuses < 2 && !this.world.pickups[1].taken) {
      const inHall = p.x > 79 && p.x < 89 && p.z > 7.5 * CELL && p.z < 16 * CELL;
      const movingNorth = this.player.vel.y < -0.5;
      if (inHall && movingNorth && p.z < 10 * CELL) {
        if (this.hallwayLoops < 2) {
          this.hallwayLoops++;
          this.player.pos.z += 4 * CELL;          // period-aligned with the fixtures
          this.player.flashFlickerT = 0.18;       // mask the seam
          if (this.hallwayLoops === 2) this.audio.whisper(0);
        } else {
          this.hallwayArmed = false;
          this.ui.subtitle('the hallway is longer than it should be.');
        }
      }
    }

    // -- storage: lights die one by one, something at the far end
    if (region === 'storage') {
      this._once('storageGreeting', () => {
        const fx = this.world.fixturesIn('storage').sort((a, b) => b.cx - a.cx);
        fx.forEach((f, i) => {
          if (i < fx.length - 1) this._after(1.0 + i * 0.5, () => { f.on = false; this.audio.buzz(0.9); });
        });
        this._after(1.2, () => {
          this.entity.placeCameo(36.5 * CELL, 21.5 * CELL, p.x, p.z);
          this._watchCameo(7, 0.6);
        });
        this._after(7, () => {
          this.entity.vanish();
          fx.forEach(f => { f.on = true; });
          this.audio.slam(0.6, 0.4);
        });
      });
    }

    // -- break room: the hum stops
    if (region === 'break') {
      this._once('breakSilence', () => {
        this._after(2, () => {
          this.audio.duck(2.2);
          this.ui.subtitle('the hum stops. you notice it for the first time.');
        });
      });
    }

    // -- blackout finale
    if (this.phase === 'blackout') {
      this.elevatorTimer -= dt;
      const floor = Math.max(1, Math.ceil(this.elevatorTimer / (this.elevatorTotal / 7)));
      this.world.setDisplay(String(floor), '#a33');
      if (this.elevatorTimer <= 0) this._arrive();
    }
    if (this.phase === 'arrived' && this.world.inElevator(p.x, p.z)) this._win();

    // -- ambient dread on a drifting timer
    if (this.phase === 'explore') {
      this.ambientT -= dt;
      if (this.ambientT <= 0) {
        this._ambient();
        this.ambientT = 20 + Math.random() * 25 - this.fuses * 4;
      }
    }
  }
}
