// The director: given absolute time t, poses the train, the cast, the world
// and the camera.  It reads the story beats produced by pipeline/story.py so
// picture and soundtrack stay locked together.
import * as THREE from 'three';
import { Animal } from './animals.js';
import { CAR_ORDER, Train } from './train.js';
import { clamp, easeIn, easeOut, easeOutBack, glide, hash, hop, lerp, pulse, ramp, smooth, smoother, TAU } from './util.js';

const BLEND = 1.1;                  // seconds of camera blend between beats
const STOPS = [50, 100, 150];       // hiding-bush positions in every episode
const CAB = -3.65;                  // cab seat relative to the engine front
const DANCE_MOVES = {
  elephant: ['trunk', 'stomp', 'clap', 'spin', 'hop'],
  zebra: ['gallop', 'wiggle', 'clap', 'hop', 'hop'],
  panda: ['wiggle', 'roll', 'clap', 'sway', 'hop'],
  giraffe: ['stretch', 'sway', 'clap', 'spin', 'hop'],
  lion: ['hop', 'shake', 'roar', 'spin', 'hop'],
  penguin: ['wiggle', 'flap', 'clap', 'slide', 'hop'],
};
const TRAIN_DANCE = ['rock', 'hop', 'rock', 'wheelie', 'hop'];

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Director {
  constructor(scene, world, camera, tl) {
    this.scene = scene; this.world = world; this.camera = camera; this.tl = tl;
    this.train = new Train(scene);
    this.fam = tl.families;
    this.mommy = {}; this.babies = {}; this.friends = {};
    this.fam.forEach((f, i) => {
      this.mommy[f.id] = new Animal(scene, f.id, { seed: 10 + i });
      this.babies[f.id] = new Animal(scene, f.id, { baby: true, seed: 30 + i });
      for (const fr of f.friends) if (!this.friends[fr]) this.friends[fr] = new Animal(scene, fr, { seed: 50 + Object.keys(this.friends).length });
    });
    this.all = [...Object.values(this.mommy), ...Object.values(this.babies), ...Object.values(this.friends)];
    this.beats = {};
    for (const b of tl.beats) (this.beats[b.sec] ||= []).push(b);
    this.secs = tl.sections;
    for (const f of this.fam) world.station(f.id, f.station, { elephant: 0xe53935, zebra: 0xfb8c00, panda: 0x43a047, giraffe: 0xff7043, lion: 0x8e24aa, penguin: 0x1e88e5 }[f.id]);
    world.station('home', 'Sunshine Station', 0xe53935);
    world.station('learning', 'Learning Station', 0x8e24aa);
    this.fadeColor = new THREE.Color(1, 1, 1);
    this.fadeAlpha = 0;
  }

  // ------------------------------------------------------------------ data
  mouth(who, t) {
    const s = this.tl.mouth[who];
    if (!s) return 0;
    const i = Math.floor(t * this.tl.fps);
    return i >= 0 && i < s.length ? (s.charCodeAt(i) - 48) / 9 : 0;
  }
  sounding(who, t) {
    for (const s of this.tl.sounds) if (s.who === who && t >= s.start - 0.05 && t <= s.end + 0.1) return 1;
    return 0;
  }
  speechOf(who, a, b) { return this.tl.speech.filter((s) => s.who === who && s.start >= a - 1e-3 && s.start < b); }
  B(sec, name) { return (this.beats[sec] || []).find((b) => b.name === name); }
  beatAt(sec, t) {
    const list = this.beats[sec] || [];
    let cur = list[0], prev = null;
    for (let i = 0; i < list.length; i++) if (t >= list[i].start) { cur = list[i]; prev = list[i - 1] || null; }
    return { cur, prev };
  }

  // ------------------------------------------------------------------ main
  apply(t) {
    const sec = this.secs.find((s) => t >= s.start && t < s.end) || this.secs[this.secs.length - 1];
    for (const a of this.all) a.root.visible = false;
    this.world.hideFx();
    this.fadeAlpha = 0;
    this.fadeColor.setRGB(1, 1, 1);
    const fn = { opening: this.opening, learning: this.learning, recap: this.recap, goodbye: this.goodbye }[sec.id] || this.episode;
    fn.call(this, t, sec);
    // generic section fades (white wipes between sections)
    const fin = 1 - smooth((t - sec.start) / 0.7);
    const fout = smooth((t - (sec.end - 0.7)) / 0.7);
    if (sec.id !== 'opening') this.fadeAlpha = Math.max(this.fadeAlpha, fin);
    if (sec.id !== 'goodbye') this.fadeAlpha = Math.max(this.fadeAlpha, fout);
    if (sec.id === 'opening') { this.fadeAlpha = Math.max(this.fadeAlpha, 1 - smooth(t / 1.5)); if (t < 1.5) this.fadeColor.setRGB(0, 0, 0); }
  }

  // camera: shots are functions of t; blend from the previous beat's shot
  shoot(sec, t, shotFn) {
    const { cur, prev } = this.beatAt(sec, t);
    let s = shotFn(cur, t);
    if (prev && !s.cut && t - cur.start < BLEND) {
      const p = shotFn(prev, t);
      const k = smoother((t - cur.start) / BLEND);
      s = { pos: p.pos.clone().lerp(s.pos, k), look: p.look.clone().lerp(s.look, k), fov: lerp(p.fov || 38, s.fov || 38, k) };
    }
    this.camera.position.copy(s.pos);
    this.camera.lookAt(s.look);
    const fov = s.fov || 38;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    return s;
  }

  // families riding in their coloured carriages
  riders(t, trainX, ids, o = {}) {
    for (const id of ids) {
      const ci = CAR_ORDER.indexOf(this.fam.find((f) => f.id === id).color);
      const car = this.train.cars[ci];
      const by = car.body.position.y;
      const big = id === 'giraffe' ? 0.55 : id === 'elephant' ? 0.68 : 0.74;
      const m = this.mommy[id], b = this.babies[id];
      const pm = this.train.carSeat(ci, 0), pb = this.train.carSeat(ci, 1);
      const sing = o.sing ? this.mouth('kids', t) : 0;
      const msnd = this.mouth('mommy_' + id, t);
      const bob = o.bpm ? Math.abs(Math.sin((t * o.bpm / 60) * Math.PI)) * 0.08 : 0;
      const wave = typeof o.wave === 'function' ? o.wave(id) : o.wave || 0;
      m.update({ t, x: trainX + pm.x, y: pm.y + by + bob, z: pm.z, yaw: o.yaw ?? 0.35, scale: big / 1, mood: 0.9,
        open: Math.max(sing * 0.8, msnd), sound: msnd > 0.05 ? 1 : 0, trunkUp: msnd, wave, sway: o.sway ? Math.sin(t * 2 + ci) * 0.08 : 0,
        neckBend: id === 'giraffe' ? 0.2 : 0 });
      b.update({ t, x: trainX + pb.x, y: pb.y + by + bob * 1.4, z: pb.z + 0.15, yaw: (o.yaw ?? 0.35) + 0.1, scale: 0.92, mood: 1,
        open: sing * 0.8, wave: wave ? 1 : 0, hop: o.hopping ? hop(((t * 1.3 + ci * 0.3) % 1.4), 0, 0.45, 0.25) : 0,
        sway: o.sway ? Math.sin(t * 2.4 + ci + 1) * 0.1 : 0 });
    }
  }

  trainState(t, x, xAt, extra = {}) {
    const v = Math.abs(xAt(t + 0.05) - xAt(t - 0.05)) / 0.1;
    const mv = clamp(v / 4);
    const wh = this.sounding('train', t);
    this.train.update(Object.assign({ t, x, xAt, moving: mv, mouth: this.mouth('train', t), mood: 0.85,
      whistle: wh, cars: 6 }, extra));
    return mv;
  }

  // ======================================================== OPENING 0:00-1:30
  opening(t, sec) {
    const W = this.world;
    const song = this.B('opening', 'song');
    const wake = this.B('opening', 'wake');
    const s0 = song.start;
    const xAt = (tt) => tt < s0 + 1 ? 0 : (tt < s0 + 7 ? 7 * (tt - s0 - 1) ** 2 / 12 : 3.5 + 7 * (tt - s0 - 7));
    const x = xAt(t);
    const todK = 1 - smooth((t - 1) / 11);
    W.update({ t, focusX: x, theme: 'home', tod: 'dawn', todK });
    const st = W.station('home');
    st.visible = true; st.position.x = 0;
    const sleep = t < wake.start + 0.6 ? 1 : 1 - smooth((t - wake.start - 0.6) / 0.5);
    const yawn = pulse(t, wake.start + 1.0, wake.start + 3.2, 0.4);
    const inSong = t >= s0;
    const songBeat = (t - s0) * 132 / 60;
    this.trainState(t, x, xAt, { sleep, stretch: yawn, squint: inSong ? 0.15 : 0,
      dance: inSong && x < 2 ? null : null, look: inSong ? [0.2, 0.1] : [0, 0] });
    W.zzzAt(t, sleep > 0.5, V(x + 0.2, 2.6, 0.6));
    W.notesAt(t, inSong, V(x + 0.6, 2.8, 0.8));
    const shots = (b, tt) => {
      const xx = xAt(tt);
      switch (b.name) {
        case 'sleep': return { pos: V(5.5 - tt * 0.05, 2.0, 6.5), look: V(-0.6, 1.8, 0), fov: 34 };
        case 'wake': return { pos: V(5.2, 2.0, 6.2), look: V(-0.6, 1.9, 0), fov: 34 };
        case 'hello': return { pos: V(7.5 + Math.sin(tt * 0.3) * 0.5, 2.6, 8.5), look: V(-1.0, 1.8, 0.3), fov: 36 };
        default: {
          const k = Math.floor((tt - s0) / 14.5);
          const lt = tt - s0 - k * 14.5;
          const fx = xx;
          switch (k % 5) {
            case 0: return { pos: V(fx + 5 + lt * 0.1, 2.2, 7), look: V(fx - 1.5, 1.8, 0), fov: 38, cut: true };
            case 1: return { pos: V(fx - 8 + lt * 0.4, 4.5, 19), look: V(fx - 9, 1.6, 0), fov: 40, cut: true };
            case 2: return { pos: V(fx + 9.5, 1.5, 1.3), look: V(fx - 1, 1.8, 0), fov: 38, cut: true };
            case 3: return { pos: V(fx - 4, 12, 26), look: V(fx - 8, 0, -4), fov: 42, cut: true };
            default: return { pos: V(fx + 7, 2.4, 7.5), look: V(fx - 1, 1.9, 0), fov: 36, cut: true };
          }
        }
      }
    };
    this.shoot('opening', t, (b, tt) => {
      if (b.name === 'song' && tt >= s0) {
        const k = Math.floor((tt - s0) / 14.5);
        const sh = shots(b, tt);
        sh.cut = k > 0 && (tt - s0 - k * 14.5) < 1e-6 ? true : sh.cut && k > 0;
        return sh;
      }
      return shots(b, tt);
    });
    // camera blend into the song: cuts every 14.5 s
    if (t >= s0) {
      const k = Math.floor((t - s0) / 14.5);
      if (k === 0 && t - s0 < BLEND) {
        const a = shots({ name: 'hello' }, t), b = shots(song, t);
        const kk = smoother((t - s0) / BLEND);
        this.camera.position.copy(a.pos.lerp(b.pos, kk));
        this.camera.lookAt(a.look.lerp(b.look, kk));
      }
    }
  }

  // ======================================================= EPISODE (x6)
  episode(t, sec) {
    const W = this.world;
    const idx = this.fam.findIndex((f) => f.id === sec.id);
    const F = this.fam[idx];
    const id = F.id;
    const bt = (n) => this.B(id, n);
    const baby = this.babies[id], mom = this.mommy[id];
    const fr = F.friends.map((f) => this.friends[f]);
    const guests = [fr[0], fr[1], mom];
    const keys = ['friend1', 'friend2', 'mommy'];
    const arrive = bt('arrive'), ask = bt('ask'), reunion = bt('reunion'), cheer = bt('cheer'), dance = bt('dance');
    const board = bt('board'), depart = bt('depart');
    const go = [0, 1, 2].map((k) => bt('go' + k));
    const stopX = STOPS.map((x) => x - 2.0);
    // ---- train path
    const xAt = (tt) => {
      if (tt < arrive.start + 8) return lerp(-62, -1, easeOut(ramp(tt, arrive.start, arrive.start + 8)) ** 0.9);
      let x = -1;
      for (let k = 0; k < 3; k++) {
        const g = go[k];
        const a = g.start + 0.4, b = g.end - 0.3;
        if (tt >= a) x = glide(tt, a, b, k === 0 ? -1 : stopX[k - 1], stopX[k]);
      }
      if (tt >= depart.start + 0.5) {
        const d = tt - depart.start - 0.5;
        x = stopX[2] + 0.18 * d * d * (d < 6 ? 1 : 0) + (d >= 6 ? 0.18 * 36 + 2.16 * (d - 6) : 0);
      }
      return x;
    };
    const x = xAt(t);
    W.update({ t, focusX: this.camera.position.x, theme: F.theme, tod: 'day' });
    const st = W.station(id);
    st.visible = true; st.position.x = 0;
    // ---- bushes
    const heights = guests.map((g) => g.height);
    for (let k = 0; k < 3; k++) {
      const b = W.bushes[k];
      const gone = k < 2 ? (t > go[k + 1].start && x > STOPS[k] + 25) : t >= depart.start;
      b.g.visible = !gone;
      const s = Math.max(1, heights[k] / 2.4);
      b.g.position.set(STOPS[k], 0, 4.3);
      const shake = this.sounding(keys[k], t) && t < bt('reveal' + k).start ? 1 : 0;
      b.inner.scale.set(s * (1 + 0.04 * Math.sin(t * 30) * shake), s * (1 + 0.06 * Math.sin(t * 25 + 1) * shake), s);
      b.inner.rotation.z = shake * 0.06 * Math.sin(t * 20);
      if (shake) W.ringsAt(t, true, V(STOPS[k], 2.4 * s, 5.0));
    }
    // ---- which families already ride with us
    const riding = this.fam.slice(0, idx).map((f) => f.id);
    const afterBoard = t >= depart.start;
    // ---- dance state
    const inDance = t >= dance.start && t < dance.end;
    const dBeat = (t - dance.start) * 126 / 60;
    const callIdx = Math.min(4, Math.floor((t - dance.start) / 4));
    const moveName = DANCE_MOVES[id][callIdx];
    const danceState = inDance ? { beat: dBeat, move: TRAIN_DANCE[callIdx] } : null;
    const cheerMood = t >= bt('reveal2').start ? 1 : 0;
    this.trainState(t, x, xAt, { dance: danceState, mood: cheerMood ? 1 : 0.8,
      look: t < ask.end ? [0.6, -0.2] : [0.3, 0], surprise: pulse(t, bt('intro').start, bt('intro').start + 2) * 0.6 });
    if (riding.length) this.riders(t, x, riding, { yaw: 0.3, bpm: inDance ? 126 : 0, sway: true });
    // ---- baby
    const plat = V(2.6, 0.45, 2.9);
    const hopT = (() => {
      const sp = this.speechOf('train', ask.start, ask.end)[0];
      return sp ? sp.end + 0.1 : ask.start + 3;
    })();
    const cab = (tt) => V(xAt(tt) + CAB, 1.0 + this.train.body.position.y, 0.15);
    const cabScale = id === 'giraffe' ? 0.75 : 0.9;
    const Xm = STOPS[2] + 6.2;          // reunion spot, clear of the bush
    let bp = { t, visible: true, mood: 0.5, open: this.mouth('baby', t) };
    const babyCry = t < hopT;
    if (t < hopT) {
      Object.assign(bp, { x: plat.x, y: plat.y, z: plat.z, yaw: -0.25, mood: -1, cry: t > bt('intro').start + 1.5,
        nod: 0.15, sound: this.sounding('baby', t) });
      if (this.sounding('baby', t)) bp.trunkUp = 1;
    } else if (t < hopT + 0.8) {
      const k = (t - hopT) / 0.8;
      const c = cab(t);
      Object.assign(bp, { x: lerp(plat.x, c.x, k), y: lerp(plat.y, c.y, k) + hop(t, hopT, 0.8, 1.8), z: lerp(plat.z, c.z, k),
        yaw: -0.8, mood: 0.2, scale: lerp(1, cabScale, k) });
    } else if (t < reunion.start) {
      const c = cab(t);
      const { cur } = this.beatAt(id, t);
      const k = cur ? +cur.name.slice(-1) : 0;
      const isSound = cur && cur.name.startsWith('sound');
      const isPause = cur && (cur.name.startsWith('pause') || cur.name.startsWith('question'));
      const notMine = this.speechOf('baby', cur.start, cur.end)[0];
      const shaking = notMine && t >= notMine.start && t <= notMine.end && cur.name.startsWith('reveal') && !cur.correct;
      const happy = t >= bt('reveal2').start;
      Object.assign(bp, { x: c.x, y: c.y, z: c.z, yaw: isSound || isPause ? 0.9 : 0.4, scale: cabScale,
        mood: happy ? 1 : shaking ? -0.6 : -0.15, shake: shaking ? 1 : 0, look: isSound ? [0.8, 0] : [0, 0],
        surprise: isSound ? 0.6 : 0, hop: happy ? hop((t - bt('reveal2').start) % 0.7, 0, 0.5, 0.35) : 0 });
    } else if (t < dance.start) {
      const c = cab(reunion.start);
      const k = ramp(t, reunion.start, reunion.start + 0.9);
      const target = V(Xm - 2.3, 0, 4.6);
      const hug = t < cheer.start;
      Object.assign(bp, { x: lerp(c.x, target.x, k), y: lerp(c.y, 0, k) + hop(t, reunion.start, 0.9, 1.6), z: lerp(c.z, target.z, k),
        yaw: hug ? Math.PI / 2 - 0.45 : 0, mood: 1, scale: lerp(cabScale, 1, k),
        tilt: hug ? 0.15 : 0, lean: hug ? -0.1 : 0,
        hop: hug ? 0 : hop((t - cheer.start) % 0.6, 0, 0.45, 0.4), clap: hug ? 0 : 0.6, rear: hug ? 0.3 : 0.3 });
    } else if (t < board.end) {
      Object.assign(bp, this.dancePose(t, dance, moveName, Xm - 1.3, 6.6, 0.2, inDance), { mood: 1 });
      if (!inDance) Object.assign(bp, { walk: 0.6, yaw: -1.2, x: lerp(Xm - 1.3, Xm - 4, ramp(t, board.start, board.end)), hop: hop((t - board.start) % 0.6, 0, 0.5, 0.25) });
    } else bp.visible = false;
    if (!afterBoard || t < depart.start) baby.update(bp);
    // ---- friends + mommy hidden behind bushes
    for (let k = 0; k < 3; k++) {
      const g = guests[k];
      const hideB = bt('hide' + k), rev = bt('reveal' + k);
      const flyer = g.def.kind === 'bird';
      const hidden = V(STOPS[k] + 0.15, flyer ? 0.8 : 0, 2.35);
      const out = flyer ? V(STOPS[k] + 0.2, 2.45 * Math.max(1, heights[k] / 2.4), 4.3) : V(STOPS[k] + 3.1, 0, 4.0);
      if (t < hideB.start - 2) continue;
      const p = { t, visible: true, mood: 0.85, open: this.mouth(keys[k], t), sound: this.sounding(keys[k], t) };
      p.trunkUp = p.sound;
      if (t < rev.start) Object.assign(p, { x: hidden.x, y: hidden.y, z: hidden.z, yaw: 0, hop: p.sound ? hop((t * 1.4) % 1, 0, 0.6, 0.15) : 0 });
      else {
        const kk = clamp((t - rev.start) / 0.6);
        Object.assign(p, { x: lerp(hidden.x, out.x, kk), y: lerp(hidden.y, out.y, kk) + hop(t, rev.start, 0.6, 1.4), z: lerp(hidden.z, out.z, kk),
          yaw: -0.35, surprise: pulse(t, rev.start, rev.start + 1.2) * 0.8, flap: flyer ? pulse(t, rev.start, rev.start + 1.4) : 0,
          wave: k < 2 ? pulse(t, rev.start + 0.8, rev.start + 3.0, 0.3) : 0 });
        if (k < 2) {
          const bye = this.speechOf(keys[k], rev.start, rev.end)[0];
          if (bye && t > bye.start) p.wave = pulse(t, bye.start, bye.end + 0.5, 0.3);
        }
        if (k === 2 && t >= reunion.start) {
          const hug = t < cheer.start;
          const wk = ramp(t, reunion.start - 0.2, reunion.start + 0.9);
          Object.assign(p, { x: lerp(out.x, Xm, wk), y: 0, z: lerp(out.z, 4.4, wk), walk: wk > 0 && wk < 1 ? 0.8 : 0, yaw: hug ? -Math.PI / 2 + 0.45 : 0, mood: 1,
            neckBend: hug ? 0.35 : 0, nod: hug ? 0.25 : 0, tilt: hug ? -0.12 : 0,
            hop: hug ? 0 : hop((t - cheer.start + 0.3) % 0.6, 0, 0.45, 0.3), surprise: 0 });
          if (hug) W.heartsAt(t, reunion.start + 0.8, V(Xm - 1.2, 2.4, 4.8));
          else W.confettiAt(t, cheer.start, V(Xm - 1, 0, 4.5), 6);
        }
        if (t >= dance.start && t < board.end) {
          const dx = [Xm - 5.6, Xm + 3.0, Xm + 0.9][k];
          Object.assign(p, this.dancePose(t, dance, moveName, dx, 6.6, k * 0.3, inDance), { mood: 1, open: p.open });
          if (!inDance) {
            if (k === 2) Object.assign(p, { walk: 0.6, yaw: -1.2, x: lerp(Xm + 0.9, Xm - 2.5, ramp(t, board.start, board.end)) });
            else Object.assign(p, { wave: 1, yaw: -0.4 });
          }
          if (flyer) p.y = (inDance ? 0 : 0) + p.y;
        }
        if (t >= board.end) p.visible = false;
      }
      g.update(p);
    }
    if (afterBoard) this.riders(t, x, [...riding, id], { yaw: 0.3, sway: true, wave: () => pulse(t, depart.start, depart.start + 6) });
    // ---- camera (tall families such as the giraffes get a taller, wider frame)
    const xs = (tt) => xAt(tt);
    const hf = Math.max(1, mom.height / 2.3);
    const bs = Math.max(1, heights[2] / 2.4);
    this.shoot(id, t, (b, tt) => {
      const X = xs(tt);
      const n = b.name, k = +n.slice(-1);
      if (n === 'arrive') {
        if (tt - b.start < 4.5) return { pos: V(X + 10, 1.5, 1.6), look: V(X - 1, 1.9, 0), fov: 38 };   // head-on arrival
        return { pos: V(6.5, 2.6, 11), look: V(-0.5, 1.6, 0.8), fov: 40, cut: true };
      }
      if (n === 'intro') return { pos: V(6.4 - (tt - b.start) * 0.1, 2.4, 9.5), look: V(1.6, 1.2, 2.2), fov: 36 };
      if (n === 'babysound') return { pos: V(4.6, 1.6, 6.8 - (tt - b.start) * 0.08), look: V(2.6, 1.0, 2.9), fov: 34 };
      if (n === 'ask') return { pos: V(6.5, 2.6, 10.5), look: V(0.2, 1.6, 1.4), fov: 38 };
      if (n.startsWith('go')) {
        const lt = tt - b.start;
        if (k === 0) return { pos: V(X + 3.5 + Math.sin(lt * 0.2) * 1.0, 2.3, 8.5), look: V(X - 3, 1.7, 0), fov: 40 };
        if (k === 1) {
          if (lt < 9) return { pos: V(X + 9.5, 1.5, 1.4), look: V(X - 1, 1.8, 0), fov: 38 };      // head-on: train rolls toward us
          return { pos: V(X + 2, 7.5, 16), look: V(X - 6, 0.8, -1), fov: 42 };
        }
        if (lt < 9) return { pos: V(X + 6.5, 1.3, 4.8), look: V(X - 2, 1.9, -0.3), fov: 40 };
        return { pos: V(X + 9.5, 1.5, -1.6), look: V(X - 1, 1.8, 0), fov: 38 };
      }
      if (n.startsWith('hide') || n.startsWith('pause')) {
        const S = STOPS[k];
        const push = n.startsWith('pause') ? (tt - b.start) * 0.4 : 0;
        return { pos: V(S - 3.5, 4.4, 15.5 - push), look: V(S - 1.8, 1.5, 2.0), fov: 40 };
      }
      if (n.startsWith('sound')) {
        const S = STOPS[k];
        const sc = Math.max(1, heights[k] / 2.4);
        return { pos: V(S + 0.8, 2.6 * sc, 11.5 + (sc - 1) * 9 - (tt - b.start) * 0.25), look: V(S, 1.7 * sc, 3.8), fov: 36 };
      }
      if (n.startsWith('question')) {
        const S = STOPS[k];
        return { pos: V(S + 1.8, 2.5, 9.0), look: V(S - 4.0, 1.7, 0.4), fov: 38 };
      }
      if (n.startsWith('reveal')) {
        const S = STOPS[k];
        const lt = tt - b.start;
        const hk = k === 2 ? hf : Math.max(1, heights[k] / 2.3);
        if (lt < 4.2 || k === 2) return { pos: V(S + 4.2, 2.3 * hk, 11.2 + (hk - 1) * 7), look: V(S + 2.4, 1.4 * hk, 3.6), fov: 38 };
        return { pos: V(S + 1.5, 3.0, 13.5), look: V(S - 2.0, 1.5, 2.2), fov: 40 };
      }
      if (n === 'reunion') return { pos: V(Xm - 1.0 + Math.sin(tt * 0.25) * 0.4, 2.2 * hf, 11.5 + (hf - 1) * 8), look: V(Xm - 1.1, 1.2 * hf, 4.5), fov: 36 };
      if (n === 'cheer') return { pos: V(Xm - 0.2, 2.9 * hf, 13 + (hf - 1) * 8), look: V(Xm - 0.8, 1.4 * hf, 4.4), fov: 38 };
      if (n === 'dance') {
        const lt = tt - b.start;
        return { pos: V(Xm - 1.3 + Math.sin(lt * 0.35) * 2.5, 3.0 * hf + Math.sin(lt * 0.5) * 0.4, 17 + (hf - 1) * 8), look: V(Xm - 1.3, 1.4 * hf, 5.5), fov: 40, cut: true };
      }
      if (n === 'board') return { pos: V(Xm - 1, 3.4, 15), look: V(Xm - 3.5, 1.4, 3.5), fov: 40 };
      if (n === 'depart') {
        const lt = tt - b.start;
        return { pos: V(X - 4 - Math.min(lt, 8) * 0.6, 3.4, 13.5), look: V(X - 9, 1.5, 0), fov: 40, cut: true };
      }
      return { pos: V(X + 8, 3, 14), look: V(X - 3, 1.5, 0) };
    });
  }

  dancePose(t, dance, move, x, z, phase, inDance) {
    const beat = (t - dance.start) * 126 / 60 + phase;
    const b = Math.abs(Math.sin(beat * Math.PI));
    const p = { t, visible: true, x, y: 0, z, yaw: 0, mood: 1 };
    if (!inDance) return p;
    switch (move) {
      case 'trunk': Object.assign(p, { trunkUp: 0.5 + 0.5 * Math.sin(beat * Math.PI), sway: 0.12 * Math.sin(beat * Math.PI), hop: b * 0.15 }); break;
      case 'stomp': Object.assign(p, { hop: b * 0.25, squash: (1 - b) * 0.5, sway: 0.05 * Math.sin(beat * TAU) }); break;
      case 'clap': Object.assign(p, { rear: 0.55, clap: 1, hop: b * 0.1 }); break;
      case 'spin': Object.assign(p, { spin: ((beat % 4) / 4) * TAU, hop: b * 0.3 }); break;
      case 'gallop': Object.assign(p, { walk: 1, hop: b * 0.35, lean: 0.06 * Math.sin(beat * TAU) }); break;
      case 'wiggle': Object.assign(p, { lean: 0.22 * Math.sin(beat * TAU), hop: b * 0.12, yaw: 0.25 * Math.sin(beat * Math.PI) }); break;
      case 'roll': Object.assign(p, { lean: 0.45 * Math.sin(beat * Math.PI * 0.5), hop: b * 0.1 }); break;
      case 'stretch': Object.assign(p, { stretch: 0.5 + 0.5 * Math.sin(beat * Math.PI), hop: b * 0.1 }); break;
      case 'sway': Object.assign(p, { sway: 0.22 * Math.sin(beat * Math.PI * 0.5), hop: b * 0.1 }); break;
      case 'shake': Object.assign(p, { shake: 0.8, sway: 0.1 * Math.sin(beat * Math.PI), hop: b * 0.2 }); break;
      case 'roar': Object.assign(p, { sound: 1, open: 0.8 * b, hop: b * 0.3 }); break;
      case 'flap': Object.assign(p, { flap: 1, hop: b * 0.35, wave: 0 }); break;
      case 'slide': Object.assign(p, { x: x + Math.sin(beat * Math.PI * 0.25) * 1.2, lean: 0.25 * Math.cos(beat * Math.PI * 0.25) }); break;
      default: Object.assign(p, { hop: b * 0.45 });
    }
    return p;
  }

  // ======================================================= LEARNING STATION
  learning(t, sec) {
    const W = this.world;
    const X = 14;
    const xAt = (tt) => tt < sec.start + 4 ? lerp(-30, X, easeOut(ramp(tt, sec.start, sec.start + 4))) : X;
    const x = xAt(t);
    W.update({ t, focusX: 0, theme: 'learning', tod: 'day' });
    const st = W.station('learning');
    st.visible = true; st.position.x = 0;
    W.bunting.visible = true;
    const ev = (k) => this.tl.events.find((e) => e.kind === k);
    const colors = ev('colors'), count = ev('count'), fast = ev('count_fast'), animals = ev('animals');
    const carIdx = (fid) => CAR_ORDER.indexOf(this.fam.find((f) => f.id === fid).color);
    // which car is highlighted (colours segment)
    let hl = null, hlK = 0;
    for (const it of colors.items) if (t >= it.q && t < it.end + 1.2) { hl = CAR_ORDER.indexOf(it.color); hlK = t >= it.a ? 1 : 0.3; }
    for (const r of colors.recap || []) if (t >= r.t && t < r.t + 0.9) { hl = CAR_ORDER.indexOf(r.color); hlK = 1; }
    let focusFam = null, waveFam = null, soundFam = null;
    for (const it of animals.items) if (t >= it.q && t < it.end + 1.5) { focusFam = it.family; if (t >= it.a) waveFam = it.family; }
    this.trainState(t, x, xAt, { highlight: hl, highlightK: hlK, mood: 1 });
    this.riders(t, x, this.fam.map((f) => f.id), { yaw: 0.25, sway: true, wave: (fid) => (fid === waveFam ? 1 : 0) });
    // balloons
    const bal = this.world.balloons;
    const countB = this.B('learning', 'count_intro');
    for (let i = 0; i < 10; i++) {
      const it = count.items[i];
      const g = bal[i];
      if (t < it.t - 0.05) { g.visible = false; continue; }
      g.visible = true;
      const k = easeOutBack(ramp(t, it.t, it.t + 0.5));
      const bx = -8.1 + i * 1.8, by = 7.4 + (i % 2) * 0.9;
      let bump = 0;
      if (fast) for (const f of fast.items) if (f.n === i + 1) bump = pulse(t, f.t, f.t + 0.5, 0.15) * 0.5;
      g.position.set(bx, by + Math.sin(t * 1.5 + i) * 0.15 + bump, 1.0 + Math.cos(i * 1.7) * 0.4);
      g.scale.setScalar(Math.max(0.01, k * (1 + bump * 0.4)));
      g.rotation.z = Math.sin(t * 1.1 + i) * 0.08;
    }
    const balloonsGone = t > this.B('learning', 'animals_intro').start;
    if (balloonsGone) for (const g of bal) { g.position.y += (t - this.B('learning', 'animals_intro').start) * 3; if (g.position.y > 40) g.visible = false; }
    const outro = this.B('learning', 'outro');
    if (t > outro.start) W.confettiAt(t, outro.start, V(0, 0, 3), 7);
    this.shoot('learning', t, (b, tt) => {
      const n = b.name;
      const carX = (i) => x + this.train.carX(i);
      if (n === 'intro') return { pos: V(2 + (tt - b.start) * 0.15, 5.2, 24), look: V(0, 2.4, 0), fov: 42 };
      if (n === 'colors_intro' || n === 'colors_recap') return { pos: V(-1, 4.2, 21), look: V(-1.5, 1.6, 0), fov: 44 };
      if (n === 'colors' || n === 'colors_recap') return { pos: V(-1, 4.2, 21), look: V(-1.5, 1.6, 0), fov: 44 };
      if (n.startsWith('count')) return { pos: V(0, 5.2, 22), look: V(0, 5.0, 0), fov: 44 };
      if (n === 'animals_intro' || n === 'animals') {
        const it = animals.items.find((a) => tt >= a.q - 0.3 && tt < a.end + 1.5) || animals.items[0];
        const cx = carX(carIdx(it.family));
        return { pos: V(cx + 2.4, 2.6, 7.8), look: V(cx, 1.6, 0), fov: 36, cut: true };
      }
      return { pos: V(0, 5, 22), look: V(0, 2, 0), fov: 42 };
    });
    // colour questions: follow each car
    const cq = colors.items.find((it) => t >= it.q - 0.2 && t < it.end + 1.2);
    if (cq && this.beatAt('learning', t).cur.name === 'colors_intro') {
      const ci = CAR_ORDER.indexOf(cq.color);
      const cx = x + this.train.carX(ci);
      const pos = V(cx + 2.0, 2.8, 9.5), look = V(cx, 1.3, 0);
      const k = smoother((t - cq.q + 0.2) / 0.8);
      this.camera.position.lerp(pos, k);
      this.camera.lookAt(look);
    }
    // animal-name segment: per-animal cut with soft push
    const am = animals.items.find((a) => t >= a.q - 0.3 && t < a.end + 1.5);
    if (am && t >= animals.items[0].q - 0.3) {
      const cx = x + this.train.carX(carIdx(am.family));
      const lt = t - am.q;
      this.camera.position.set(cx + 2.4, 2.5, 8.2 - lt * 0.08);
      this.camera.lookAt(cx, 1.6, 0);
    }
  }

  // ======================================================= RECAP SONG
  recap(t, sec) {
    const W = this.world;
    const song = this.B('recap', 'song');
    const verses = song.verses;
    const speed = 6;
    const xAt = (tt) => (tt - sec.start) * speed;
    const x = xAt(t);
    const v = verses.find((vv) => t >= vv.start && t < vv.end);
    const theme = v ? this.fam.find((f) => f.id === v.family).theme : 'home';
    W.update({ t, focusX: x - 10, theme, tod: 'day' });
    const beat = (t - sec.start) * 2;          // 120 bpm
    this.trainState(t, x, xAt, { mood: 1, dance: { beat, move: 'sing' } });
    this.riders(t, x, this.fam.map((f) => f.id), { yaw: 0.3, sing: true, bpm: 120, sway: true });
    W.notesAt(t, true, V(x + 0.6, 2.8, 0.8));
    // white flash between landscapes
    const edges = [verses[0].start, ...verses.map((vv) => vv.end)];
    for (const e of edges) this.fadeAlpha = Math.max(this.fadeAlpha, 1 - smooth(Math.abs(t - e) / 0.4));
    const carIdx = (fid) => CAR_ORDER.indexOf(this.fam.find((f) => f.id === fid).color);
    let shot;
    if (v) {
      const lt = t - v.start;
      const cx = x + this.train.carX(carIdx(v.family));
      if (t >= v.hook - 0.3 && t < v.hook + 3) shot = { pos: V(cx + 2.0, 2.3, 6.8), look: V(cx, 1.7, 0), fov: 36 };
      else if (lt < 8) shot = { pos: V(cx + 3 - lt * 0.1, 2.8, 9), look: V(cx, 1.5, 0), fov: 38 };
      else if (lt < 16) shot = { pos: V(x + 7, 2.2, 8), look: V(x - 2, 1.8, 0), fov: 40 };
      else shot = { pos: V(x - 6, 6, 22), look: V(x - 11, 1.2, 0), fov: 42 };
    } else {
      const lt = t - sec.start;
      const k = Math.floor(lt / 8) % 3;
      if (k === 0) shot = { pos: V(x + 8, 2.5, 9), look: V(x - 2, 1.8, 0), fov: 38 };
      else if (k === 1) shot = { pos: V(x - 8, 7, 24), look: V(x - 12, 1, 0), fov: 42 };
      else shot = { pos: V(x - 14, 2.6, 9), look: V(x - 12, 1.4, 0), fov: 40 };
    }
    this.camera.position.copy(shot.pos);
    this.camera.lookAt(shot.look);
    if (this.camera.fov !== shot.fov) { this.camera.fov = shot.fov; this.camera.updateProjectionMatrix(); }
  }

  // ======================================================= GOODBYE
  goodbye(t, sec) {
    const W = this.world;
    const xAt = (tt) => lerp(-45, 0, easeOut(ramp(tt, sec.start, sec.start + 7)));
    const x = xAt(t);
    W.update({ t, focusX: x, theme: 'home', tod: 'sunset', todK: 1 });
    const st = W.station('home');
    st.visible = true; st.position.x = 0;
    const lull = this.B('goodbye', 'lullaby');
    const sleepy = smooth(ramp(t, sec.end - 9, sec.end - 3));
    this.trainState(t, x, xAt, { mood: 0.9, squint: 0.35 + sleepy * 0.4, sleep: sleepy > 0.9 ? 1 : 0, noSmoke: sleepy > 0.6 });
    this.riders(t, x, this.fam.map((f) => f.id), { yaw: 0.3, sing: t >= lull.start, sway: true,
      wave: () => (t > lull.start + 30 ? 1 : 0.0) });
    W.notesAt(t, t >= lull.start && sleepy < 0.5, V(x + 0.6, 2.8, 0.8));
    W.zzzAt(t, sleepy > 0.95, V(x + 0.2, 2.6, 0.6));
    const lt = t - sec.start;
    const pos = lt < 8 ? V(x + 9, 3, 13) : V(-6 + lt * 0.12, 4 + lt * 0.03, 20 + lt * 0.12);
    const look = lt < 8 ? V(x - 3, 1.6, 0) : V(-8, 1.6, 0);
    if (lt >= 8 && lt < 9.2) {
      const k = smoother((lt - 8) / 1.2);
      this.camera.position.copy(V(x + 9, 3, 13).lerp(pos, k));
      this.camera.lookAt(V(x - 3, 1.6, 0).lerp(look, k));
    } else { this.camera.position.copy(pos); this.camera.lookAt(look); }
    if (this.camera.fov !== 40) { this.camera.fov = 40; this.camera.updateProjectionMatrix(); }
    const fade = smooth(ramp(t, sec.end - 2.5, sec.end - 0.2));
    if (fade > 0) { this.fadeAlpha = Math.max(this.fadeAlpha, fade); this.fadeColor.setRGB(0, 0, 0); }
  }
}
