// "Choo-Choo", the blue / red / yellow toy train.  One fixed design used in
// every shot: engine with a smiling face + six coloured open carriages.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Face } from './face.js';
import { mergeStatic } from './merge.js';
import { clamp, hash, smooth, TAU } from './util.js';

export const COLORS = {
  blue: 0x2f7de1, red: 0xe53935, yellow: 0xffc928, cream: 0xfff1d0, dark: 0x2b2f45, gold: 0xf2b632,
  car: { red: 0xe53935, yellow: 0xfdd835, green: 0x43a047, orange: 0xfb8c00, purple: 0x8e24aa, blue: 0x1e88e5 },
};
export const CAR_ORDER = ['red', 'yellow', 'green', 'orange', 'purple', 'blue'];
const ENGINE_LEN = 4.7, CAR_LEN = 3.5, GAP = 0.45;

const plastic = (c, r = 0.32) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.04 });

function box(w, h, d, m, r = 0.12) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), m);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
function cyl(rt, rb, h, m, seg = 28) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

function makeWheel(r, m, hub) {
  const g = new THREE.Group();
  const tire = cyl(r, r, 0.2, m, 32);
  tire.rotation.x = Math.PI / 2;
  const h = cyl(r * 0.35, r * 0.35, 0.24, hub, 16);
  h.rotation.x = Math.PI / 2;
  g.add(tire, h);
  for (let i = 0; i < 4; i++) {           // spokes make the rotation readable
    const sp = new THREE.Mesh(new THREE.BoxGeometry(r * 1.7, r * 0.14, 0.22), hub);
    sp.rotation.z = i * Math.PI / 4;
    g.add(sp);
  }
  return g;
}

export class Train {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const blue = plastic(COLORS.blue), red = plastic(COLORS.red), yellow = plastic(COLORS.yellow, 0.3);
    const dark = plastic(COLORS.dark, 0.5), cream = plastic(COLORS.cream, 0.4), gold = plastic(COLORS.gold, 0.25);
    gold.metalness = 0.35;
    this.mats = { blue, red, yellow, dark, cream, gold };

    // ------------------------------------------------------------- engine
    const eng = this.engine = new THREE.Group();
    this.group.add(eng);
    this.body = new THREE.Group();             // bounces/squashes
    eng.add(this.body);
    const B = this.body;
    const chassis = box(ENGINE_LEN - 0.1, 0.38, 1.75, red, 0.12);
    chassis.position.set(-ENGINE_LEN / 2, 0.68, 0);
    B.add(chassis);
    const boiler = cyl(0.86, 0.86, 2.15, blue, 40);
    boiler.rotation.z = Math.PI / 2;
    boiler.position.set(-2.05, 1.62, 0);
    B.add(boiler);
    for (const x of [-2.0, -2.95]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.87, 0.06, 10, 40), yellow);
      band.rotation.y = Math.PI / 2; band.position.set(x, 1.62, 0); band.castShadow = true;
      B.add(band);
    }
    // big domed face on the front of the boiler (the train's "head")
    const FR = 1.06;
    const faceCenter = new THREE.Vector3(-0.95, 1.66, 0);
    const skin = plastic(0xffe2c4, 0.45);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(FR, 48, 32), skin);
    dome.position.copy(faceCenter);
    dome.scale.set(0.62, 1, 1);
    dome.castShadow = true;
    B.add(dome);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.11, 12, 44), yellow);
    collar.rotation.y = Math.PI / 2; collar.position.set(-1.1, 1.62, 0); collar.castShadow = true;
    B.add(collar);
    const faceHolder = new THREE.Group();
    faceHolder.position.copy(faceCenter);
    faceHolder.rotation.y = Math.PI / 2;      // face +Z -> world +X
    faceHolder.scale.set(1, 1, 0.62);         // follow the squashed dome (local z = world x)
    B.add(faceHolder);
    this.face = new Face(faceHolder, { R: FR, eye: 0.29, spread: 0.32, eyeUp: 0.2, mouthDown: -0.4,
      mouthW: 0.3, cheekSpread: 0.28, cheekUp: -0.12, brow: 0x5a3b2a, seed: 11, iris: 0x2f9be0 });
    // little round nose
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 16), plastic(0xff9c8a, 0.4));
    nose.position.set(-0.95 + FR * 0.62 * Math.cos(0.05) + 0.03, 1.66 - 0.06, 0);
    nose.castShadow = true;
    B.add(nose);
    // cap peak above the face, like an engine driver's cap
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.98, 32, 16, 0, TAU, 0, Math.PI / 2.4), red);
    cap.position.set(-1.05, 2.32, 0); cap.scale.set(0.72, 0.6, 1.06); cap.castShadow = true;
    B.add(cap);
    const capButton = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), yellow);
    capButton.position.set(-0.55, 2.62, 0);
    B.add(capButton);
    // chimney, dome, whistle, lamp, bell
    const chim = cyl(0.36, 0.24, 0.8, red, 24);
    chim.position.set(-1.75, 2.75, 0);
    const chimTop = cyl(0.42, 0.42, 0.16, yellow, 24);
    chimTop.position.set(-1.75, 3.15, 0);
    B.add(chim, chimTop);
    this.chimneyLocal = new THREE.Vector3(-1.75, 3.3, 0);
    const sandDome = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 12, 0, TAU, 0, Math.PI / 2), yellow);
    sandDome.position.set(-2.45, 2.4, 0); sandDome.castShadow = true;
    B.add(sandDome);
    const whistle = cyl(0.08, 0.1, 0.35, gold, 12);
    whistle.position.set(-2.85, 2.6, 0);
    B.add(whistle);
    this.whistleLocal = new THREE.Vector3(-2.85, 2.8, 0);
    // cowcatcher
    const cc = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.55, 0.9, 3, 1), red);
    cc.rotation.set(0, 0, -Math.PI / 2); cc.scale.set(1, 1, 1.7);
    cc.position.set(0.05, 0.42, 0); cc.castShadow = true;
    B.add(cc);
    // cab: open sides so passengers can be seen
    const cabX = -3.75;
    const floor = box(1.75, 0.15, 1.75, red, 0.05);
    floor.position.set(cabX, 0.92, 0);
    B.add(floor);
    for (const z of [-0.8, 0.8]) {
      const wall = box(1.75, 0.55, 0.12, red, 0.05);
      wall.position.set(cabX, 1.2, z);
      B.add(wall);
      for (const x of [cabX - 0.8, cabX + 0.8]) {
        const post = box(0.14, 1.6, 0.14, red, 0.05);
        post.position.set(x, 2.1, z);
        B.add(post);
      }
    }
    const backWall = box(0.12, 0.9, 1.75, red, 0.05);
    backWall.position.set(cabX - 0.83, 1.4, 0);
    B.add(backWall);
    const roof = box(2.25, 0.22, 2.15, yellow, 0.1);
    roof.position.set(cabX, 3.02, 0);
    B.add(roof);
    const roofTop = box(1.6, 0.12, 1.7, yellow, 0.06);
    roofTop.position.set(cabX, 3.18, 0);
    B.add(roofTop);
    this.cabSeatLocal = new THREE.Vector3(cabX + 0.1, 1.0, 0.1);
    // wheels
    this.wheels = [];
    const wheelDefs = [[-0.7, 0.36], [-1.85, 0.5], [-3.05, 0.5], [-4.1, 0.36]];
    for (const [x, r] of wheelDefs) for (const z of [-0.92, 0.92]) {
      const w = makeWheel(r, yellow, red);
      w.position.set(x, r + 0.02, z);
      eng.add(w);
      this.wheels.push({ w, r });
    }
    this.rods = [];
    for (const z of [-1.05, 1.05]) {
      const rod = box(1.35, 0.1, 0.06, this.mats.dark, 0.03);
      eng.add(rod);
      this.rods.push({ rod, z });
    }

    // ------------------------------------------------------------ carriages
    this.cars = [];
    let x0 = -ENGINE_LEN - GAP;
    for (let i = 0; i < CAR_ORDER.length; i++) {
      const c = this.makeCar(COLORS.car[CAR_ORDER[i]]);
      c.group.position.x = x0 - CAR_LEN / 2;
      this.group.add(c.group);
      this.cars.push(c);
      const link = box(GAP + 0.4, 0.12, 0.2, dark, 0.04);
      link.position.set(x0 + GAP / 2, 0.62, 0);
      this.group.add(link);
      c.link = link;
      x0 -= CAR_LEN + GAP;
    }

    mergeStatic(this.group);

    // ------------------------------------------------------------ smoke
    this.puffs = [];
    const smokeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 1, transparent: true, opacity: 0.85, depthWrite: false });
    const sg = new THREE.SphereGeometry(0.32, 14, 10);
    this.smokeGroup = new THREE.Group();
    scene.add(this.smokeGroup);
    for (let i = 0; i < 26; i++) {
      const p = new THREE.Mesh(sg, smokeMat.clone());
      this.smokeGroup.add(p);
      this.puffs.push(p);
    }
    this.steam = [];
    for (let i = 0; i < 10; i++) {
      const p = new THREE.Mesh(sg, smokeMat.clone());
      this.smokeGroup.add(p);
      this.steam.push(p);
    }
  }

  makeCar(color) {
    const g = new THREE.Group();
    const body = new THREE.Group();
    g.add(body);
    const m = plastic(color);
    const yellow = this.mats.yellow, dark = this.mats.dark;
    const base = box(CAR_LEN, 0.3, 1.75, dark, 0.1);
    base.position.y = 0.66;
    body.add(base);
    const floor = box(CAR_LEN - 0.1, 0.12, 1.65, m, 0.05);
    floor.position.y = 0.85;
    body.add(floor);
    const h = 0.75;
    for (const z of [-0.82, 0.82]) {
      const wall = box(CAR_LEN, h, 0.12, m, 0.05);
      wall.position.set(0, 0.85 + h / 2, z);
      body.add(wall);
      const rail = box(CAR_LEN + 0.06, 0.1, 0.2, yellow, 0.04);
      rail.position.set(0, 0.85 + h, z);
      body.add(rail);
    }
    for (const x of [-CAR_LEN / 2 + 0.06, CAR_LEN / 2 - 0.06]) {
      const wall = box(0.12, h, 1.7, m, 0.05);
      wall.position.set(x, 0.85 + h / 2, 0);
      body.add(wall);
      const rail = box(0.2, 0.1, 1.76, yellow, 0.04);
      rail.position.set(x, 0.85 + h, 0);
      body.add(rail);
    }
    // a big yellow star decal on each side
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.13 : 0.3, a = i / 10 * TAU + Math.PI / 2;
      i ? star.lineTo(Math.cos(a) * r, Math.sin(a) * r) : star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const sgeo = new THREE.ExtrudeGeometry(star, { depth: 0.04, bevelEnabled: false });
    for (const z of [-0.9, 0.9]) {
      const s = new THREE.Mesh(sgeo, yellow);
      s.position.set(0, 1.2, z + (z > 0 ? 0 : -0.04));
      body.add(s);
    }
    const wheels = [];
    for (const x of [-1.05, 1.05]) for (const z of [-0.92, 0.92]) {
      const w = makeWheel(0.36, this.mats.blue, this.mats.red);
      w.position.set(x, 0.38, z);
      g.add(w);
      wheels.push({ w, r: 0.36 });
    }
    return { group: g, body, wheels, mat: m };
  }

  // local x of the centre of carriage i
  carX(i) { return -ENGINE_LEN - GAP - CAR_LEN / 2 - i * (CAR_LEN + GAP); }
  carSeat(i, slot) {           // slot 0 = mommy (back), 1 = baby (front)
    return new THREE.Vector3(this.carX(i) + (slot ? 0.75 : -0.55), 0.92, 0.05);
  }
  get length() { return ENGINE_LEN + CAR_LEN * 6 + GAP * 6; }

  /**
   * s: { t, x, xAt(t), moving (0..1), mouth, mood, sleep, squint, look, surprise, whistle (0..1),
   *      dance: {k, move, beat} | null, cars (number of carriages shown), yaw, lift }
   */
  update(s) {
    const t = s.t;
    const g = this.group;
    g.position.set(s.x, 0, s.z || 0);
    g.rotation.y = s.yaw || 0;
    const moving = s.moving ?? 0;
    // wheels roll exactly with distance travelled
    const ang = -s.x / 0.5;
    for (const { w, r } of this.wheels) w.rotation.z = ang * 0.5 / r;
    for (const c of this.cars) for (const { w, r } of c.wheels) w.rotation.z = ang * 0.5 / r;
    for (const { rod, z } of this.rods) {
      rod.position.set(-2.45 + Math.cos(ang) * 0.22, 0.52 + Math.sin(ang) * 0.22, z);
    }
    // body motion: chug vibration while moving, bounce when talking, dance moves
    const B = this.body;
    let y = 0, rz = 0, ry = 0, sq = 1;
    y += moving * 0.025 * Math.abs(Math.sin(t * 13));
    const talk = s.mouth || 0;
    y += talk * 0.05;
    if (s.dance) {
      const { beat, move } = s.dance;
      const b = beat % 1;
      const bounce = Math.abs(Math.sin(beat * Math.PI));
      if (move === 'hop') { y += bounce * 0.45; sq = 1 + 0.08 * Math.cos(beat * TAU); }
      else if (move === 'rock') { rz = 0.08 * Math.sin(beat * Math.PI); y += bounce * 0.15; }
      else if (move === 'wheelie') { rz = 0.12 * smooth(Math.sin(beat * Math.PI * 0.5) ** 2); y += bounce * 0.1; }
      else { y += bounce * 0.2; sq = 1 + 0.05 * Math.sin(beat * TAU); }
    }
    if (s.lift) y += s.lift;
    B.position.y = y;
    B.rotation.z = rz;
    B.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    if (s.stretch) B.scale.y *= 1 + s.stretch * 0.12;
    // carriages sway gently
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const vis = i < (s.cars ?? 6);
      c.group.visible = vis; c.link.visible = vis;
      const db = s.dance ? Math.abs(Math.sin((s.dance.beat - (i + 1) * 0.25) * Math.PI)) * 0.25 : 0;
      c.body.position.y = moving * 0.02 * Math.abs(Math.sin(t * 13 + i)) + db;
      c.body.rotation.x = moving * 0.015 * Math.sin(t * 3 + i);
      if (s.highlight != null) {
        const on = s.highlight === i ? s.highlightK || 0 : 0;
        c.body.position.y += on * 0.35 * Math.abs(Math.sin(t * 6));
        c.mat.emissive.setHex(c.mat.color.getHex()).multiplyScalar(on * 0.35);
      } else c.mat.emissive.setHex(0);
    }
    this.face.update({ t, mood: s.mood ?? 0.8, open: talk, sleep: s.sleep, squint: s.squint,
      look: s.look, surprise: s.surprise, blink: s.blink });
    this.updateSmoke(s);
  }

  updateSmoke(s) {
    const t = s.t, period = 0.3, life = 2.0;
    const xAt = s.xAt || (() => s.x);
    const n = this.puffs.length;
    const k0 = Math.floor(t / period);
    const amount = 0.35 + 0.65 * (s.moving ?? 0);
    for (let i = 0; i < n; i++) {
      const k = k0 - i;
      const te = k * period;
      const age = t - te;
      const p = this.puffs[i];
      if (age > life || s.sleep > 0.5 || s.noSmoke) { p.visible = false; continue; }
      p.visible = true;
      const ex = xAt(te) + this.chimneyLocal.x;
      const r = hash(k);
      const by = this.body.position.y;
      p.position.set(ex - age * 0.8 + (r - 0.5) * 0.3, this.chimneyLocal.y + by + age * 0.9,
        (hash(k + 7) - 0.5) * 0.6 * age + (s.z || 0));
      const sc = (0.5 + age * 0.55) * (0.6 + amount * 0.5) * (0.8 + r * 0.4);
      p.scale.setScalar(sc);
      p.material.opacity = 0.95 * (1 - (age / life) ** 1.5) * Math.min(1, age * 6) * amount;
    }
    // whistle steam jet
    const w = s.whistle || 0;
    for (let i = 0; i < this.steam.length; i++) {
      const p = this.steam[i];
      const ph = ((t * 2.2 + i / this.steam.length) % 1);
      p.visible = w > 0.02;
      if (!p.visible) continue;
      p.position.set(s.x + this.whistleLocal.x - ph * 0.3, this.whistleLocal.y + this.body.position.y + ph * 1.6,
        (hash(i) - 0.5) * 0.3 * ph + (s.z || 0));
      p.scale.setScalar(0.25 + ph * 0.9);
      p.material.opacity = 0.9 * w * (1 - ph);
    }
  }
}
