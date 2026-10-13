// Parametric, rounded, toddler-friendly animal characters.
// Every species is assembled from the same kit (torso, legs, big head, Face,
// ears, muzzle, tail ...) so the whole cast shares one consistent style.
import * as THREE from 'three';
import { Face, placeOnSphere } from './face.js';
import { mergeStatic } from './merge.js';
import { clamp, hash, smooth, TAU } from './util.js';

const matCache = {};
export function fur(color, rough = 0.75, map = null) {
  const key = color + ':' + rough + ':' + (map ? map.uuid : '');
  if (!matCache[key]) matCache[key] = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, map });
  return matCache[key];
}
const SPH = new THREE.SphereGeometry(1, 24, 16);
const SPH_LO = new THREE.SphereGeometry(1, 12, 8);
function ball(m, sx, sy = sx, sz = sx, lo = false) {
  const mesh = new THREE.Mesh(lo ? SPH_LO : SPH, m);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
function capsule(m, r, len) {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), m);
  mesh.castShadow = true;
  return mesh;
}
function cone(m, r, h, seg = 18) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), m);
  mesh.castShadow = true;
  return mesh;
}

// --------------------------------------------------------------- textures
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 1;
  return t;
}
const TEX = {};
function stripes(base, ink, vertical, count, seed) {
  const key = ['st', base, ink, vertical, count, seed].join();
  if (TEX[key]) return TEX[key];
  return TEX[key] = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.fillStyle = ink;
    for (let i = 0; i < count; i++) {
      const p = (i + 0.5) / count;
      g.beginPath();
      const width = (0.28 + 0.2 * hash(seed + i)) / count;
      for (let k = 0; k <= 32; k++) {
        const q = k / 32;
        const wob = Math.sin(q * 9 + i * 2.1) * 0.012;
        const x = (p + wob - width / 2), y = q;
        vertical ? g.lineTo(x * w, y * h) : g.lineTo(y * w, x * h);
      }
      for (let k = 32; k >= 0; k--) {
        const q = k / 32;
        const taper = 0.55 + 0.45 * Math.sin(q * Math.PI);
        const wob = Math.sin(q * 9 + i * 2.1) * 0.012;
        const x = (p + wob + width / 2 * taper), y = q;
        vertical ? g.lineTo(x * w, y * h) : g.lineTo(y * w, x * h);
      }
      g.closePath(); g.fill();
    }
  });
}
function spots(base, ink, seed) {
  const key = ['sp', base, ink, seed].join();
  if (TEX[key]) return TEX[key];
  return TEX[key] = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.fillStyle = ink;
    const n = 7;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const cx = (i + 0.5 + (hash(seed + i * 13 + j) - 0.5) * 0.4) / n * w;
      const cy = (j + 0.5 + (hash(seed + i * 7 + j * 3) - 0.5) * 0.4) / n * h;
      const r = w / n * 0.36;
      g.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = k / 7 * TAU;
        const rr = r * (0.8 + 0.35 * hash(seed + i + j * 5 + k));
        k ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 1.1) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 1.1);
      }
      g.closePath(); g.fill();
    }
  });
}

// --------------------------------------------------------------- species
// kind: quad | biped | bird | penguin | seal
export const SPECIES = {
  elephant: { kind: 'quad', color: 0xa9b8cc, body: [0.95, 0.82, 1.1], leg: [0.27, 0.42], head: 0.78, ears: 'elephant', trunk: true, tail: 'tuft', foot: 0xe9eef4, muzzle: null },
  zebra: { kind: 'quad', longMuzzle: true, color: 0xffffff, stripes: '#24242e', body: [0.62, 0.62, 0.95], leg: [0.16, 0.62], head: 0.6, ears: 'pointy', mane: 0x24242e, tail: 'tuft', foot: 0x2a2a30, muzzle: [0x5a5a66, 0.42] },
  horse: { kind: 'quad', longMuzzle: true, forelock: true, bigMane: true, color: 0xc07a4c, body: [0.64, 0.64, 0.98], leg: [0.17, 0.65], head: 0.6, ears: 'pointy', mane: 0x5a3220, tail: 'bushy', tailColor: 0x5a3220, foot: 0x3d2a20, muzzle: [0xd69a70, 0.44] },
  donkey: { kind: 'quad', longMuzzle: true, color: 0x9d968d, body: [0.6, 0.6, 0.9], leg: [0.16, 0.55], head: 0.6, ears: 'long', mane: 0x4a4440, tail: 'tuft', foot: 0x3a3532, muzzle: [0xeeeae4, 0.44] },
  goat: { kind: 'quad', color: 0xf3ece0, body: [0.58, 0.58, 0.82], leg: [0.15, 0.5], head: 0.56, ears: 'side', horns: true, beard: true, tail: 'puff', foot: 0x5a4a40, muzzle: [0xffe6dc, 0.5] },
  sheep: { kind: 'quad', color: 0xfffdf7, fluffy: true, body: [0.72, 0.68, 0.9], leg: [0.13, 0.42], head: 0.55, ears: 'side', earColor: 0xf3d9c8, face: 0xf7e2d2, tail: 'puff', foot: 0x5d4a44, legColor: 0xf3d9c8, muzzle: null },
  dog: { kind: 'quad', color: 0xeec089, body: [0.58, 0.55, 0.8], leg: [0.15, 0.42], head: 0.62, ears: 'floppy', earColor: 0x9a5c2c, tail: 'wag', foot: 0xfff2e0, muzzle: [0xfff2e0, 0.55], patch: 0x9a5c2c },
  lion: { kind: 'quad', ruff: 0xf7c46a, color: 0xeea444, body: [0.68, 0.62, 0.95], leg: [0.19, 0.48], head: 0.66, ears: 'round', tail: 'tuft', tailTuft: 0x9b5a24, foot: 0xf6dfb4, muzzle: [0xfbe8c4, 0.5] },
  lion_male: { kind: 'quad', color: 0xe9ad55, body: [0.72, 0.66, 0.98], leg: [0.2, 0.5], head: 0.66, ears: 'round', mane: 'lion', maneColor: 0xb4581e, tail: 'tuft', tailTuft: 0x9b5a24, foot: 0xf6dfb4, muzzle: [0xfbe8c4, 0.5] },
  tiger: { kind: 'quad', color: 0xff9a2e, stripes: '#2a1d18', body: [0.68, 0.62, 0.98], leg: [0.19, 0.48], head: 0.66, ears: 'round', tail: 'long', foot: 0xfff6ea, muzzle: [0xfff6ea, 0.52] },
  giraffe: { kind: 'quad', longMuzzle: true, color: 0xf7c95c, spots: '#b7692c', body: [0.62, 0.6, 0.85], leg: [0.15, 1.05], head: 0.55, neck: 1.45, ears: 'pointy', ossicones: true, tail: 'tuft', foot: 0x6a3d1e, muzzle: [0xfde6b0, 0.42], mane: 0xb7692c },
  panda: { kind: 'quad', color: 0xffffff, body: [0.78, 0.72, 0.9], leg: [0.24, 0.36], head: 0.74, ears: 'round', earColor: 0x24242a, legColor: 0x24242a, panda: true, tail: 'puff', tailColor: 0xffffff, foot: 0x24242a, muzzle: [0xffffff, 0.45] },
  mouse: { kind: 'quad', color: 0xb9bdd0, body: [0.5, 0.48, 0.66], leg: [0.11, 0.22], head: 0.6, ears: 'mouse', earColor: 0xffb6c8, tail: 'thin', foot: 0xffb6c8, muzzle: [0xd8dbe8, 0.42], whiskers: true, nose: 0xff7fa0 },
  monkey: { kind: 'biped', color: 0x8b5a3c, body: [0.55, 0.62, 0.5], leg: [0.14, 0.38], head: 0.64, ears: 'monkey', earColor: 0xf1c79b, face: 0xf1c79b, tail: 'curl', foot: 0xf1c79b },
  bird: { kind: 'bird', color: 0x48b6ff, belly: 0xffe066, head: 0.45, beak: 0xffa53a },
  seagull: { kind: 'bird', color: 0xffffff, belly: 0xffffff, wing: 0xb8c4d0, head: 0.45, beak: 0xffd33a, legs: 0xff9a3a, big: true },
  penguin: { kind: 'penguin', color: 0x262a3a, belly: 0xffffff, head: 0.55, beak: 0xffa31a },
  seal: { kind: 'seal', color: 0x8f9cad, belly: 0xc6d0dc, head: 0.55 },
};

export class Animal {
  constructor(scene, species, { baby = false, seed = 1, scale = 1 } = {}) {
    this.species = species;
    this.def = SPECIES[species];
    this.baby = baby;
    this.seed = seed;
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    scene.add(this.root);
    this.legs = []; this.arms = []; this.wings = []; this.trunk = []; this.ears = [];
    this.tail = null;
    const d = this.def;
    const builder = { quad: this.buildQuad, biped: this.buildBiped, bird: this.buildBird, penguin: this.buildPenguin, seal: this.buildSeal }[d.kind];
    builder.call(this, d);
    if (this.torso) this.torso.userData.keep = true;
    mergeStatic(this.root);
    const s = (baby ? 0.56 : 1) * scale;
    this.baseScale = s;
    this.root.scale.setScalar(s);
    this.root.visible = false;
  }

  // ---------------------------------------------------------- quadruped
  buildQuad(d) {
    const baby = this.baby;
    const headK = baby ? 1.25 : 1;
    const legLen = d.leg[1] * (baby ? 0.85 : 1);
    const legR = d.leg[0];
    const [bx, by, bz] = d.body;
    let skinMap = null;
    if (d.stripes) skinMap = stripes('#' + d.color.toString(16).padStart(6, '0'), d.stripes, true, d.color === 0xffffff ? 14 : 10, 3);
    if (d.spots) skinMap = spots('#' + d.color.toString(16).padStart(6, '0'), d.spots, 5);
    const skin = fur(d.color, 0.78, skinMap);
    const legMap = d.stripes ? stripes('#' + d.color.toString(16).padStart(6, '0'), d.stripes, false, 6, 9) : skinMap;
    const legMat = d.legColor ? fur(d.legColor) : fur(d.color, 0.78, legMap);
    const footMat = fur(d.foot || 0x333333, 0.6);
    const bodyY = legLen + by * 0.75;
    this.hipY = legLen;
    const body = this.body = new THREE.Group();
    body.position.y = bodyY;
    this.pivot.add(body);
    const torso = ball(skin, bx, by, bz);
    body.add(torso);
    this.torso = torso;
    if (d.fluffy) {
      for (let i = 0; i < 26; i++) {
        const a = hash(i * 3.1) * TAU, b = (hash(i * 7.7) - 0.3) * 1.4;
        const p = new THREE.Vector3(Math.cos(a) * Math.cos(b) * bx, Math.sin(b) * by, Math.sin(a) * Math.cos(b) * bz);
        const f = ball(skin, 0.32, 0.32, 0.32, true);
        f.position.copy(p.multiplyScalar(0.92));
        body.add(f);
      }
    }
    if (d.panda) {
      const band = ball(fur(0x24242a), bx * 1.03, by * 0.9, bz * 0.42);
      band.position.set(0, -by * 0.08, bz * 0.3);
      body.add(band);
    }
    if (d.patch) {
      const p = ball(fur(d.patch), bx * 0.5, by * 0.5, bz * 0.45);
      p.position.set(bx * 0.6, by * 0.35, -bz * 0.2);
      body.add(p);
    }
    // legs (pivot at the hip)
    const lx = bx * 0.55, lz = bz * 0.58;
    for (const [x, z, front] of [[-lx, lz, 1], [lx, lz, 1], [-lx, -lz, 0], [lx, -lz, 0]]) {
      const hip = new THREE.Group();
      hip.position.set(x, legLen + 0.05, z);
      const leg = capsule(legMat, legR, legLen * 0.75);
      leg.position.y = -legLen * 0.5;
      const foot = ball(footMat, legR * 1.12, legR * 0.55, legR * 1.2);
      foot.position.set(0, -legLen + legR * 0.35, legR * 0.15);
      hip.add(leg, foot);
      this.pivot.add(hip);
      this.legs.push({ hip, front, side: Math.sign(x) });
    }
    // neck + head
    const hr = d.head * headK;
    this.headR = hr;
    const neck = this.neck = new THREE.Group();
    neck.position.set(0, by * 0.45, bz * 0.62);
    body.add(neck);
    let headY = hr * 0.55, headZ = hr * 0.35;
    if (d.neck) {
      const nl = d.neck * (baby ? 0.75 : 1);
      const nm = capsule(skin, bx * 0.36, nl);
      nm.position.set(0, nl * 0.5, 0.08);
      nm.rotation.x = 0.12;
      neck.add(nm);
      if (d.mane) {
        for (let i = 0; i < 8; i++) {
          const m = ball(fur(d.mane), 0.07, 0.11, 0.09, true);
          m.position.set(0, 0.25 + i * nl / 8, -bx * 0.3 + 0.02 * i);
          neck.add(m);
        }
      }
      headY = nl + hr * 0.4; headZ = 0.3;
    }
    const head = this.head = new THREE.Group();
    head.position.set(0, headY, headZ);
    neck.add(head);
    const faceMat = d.face ? fur(d.face) : skin;
    const skull = ball(d.stripes ? fur(d.color, 0.78, stripes('#' + d.color.toString(16).padStart(6, '0'), d.stripes, true, 10, 4)) : faceMat, hr, hr * 0.95, hr * 0.92);
    head.add(skull);
    if (d.fluffy) {
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI - Math.PI / 2;
        const f = ball(fur(d.color), hr * 0.32, hr * 0.32, hr * 0.32, true);
        f.position.set(Math.sin(a) * hr * 0.75, hr * 0.72 + Math.cos(a) * hr * 0.12, -hr * 0.1 + Math.cos(a) * hr * 0.15);
        head.add(f);
      }
    }
    // muzzle
    let mouthSphere = null;
    if (d.muzzle) {
      const [mc, mk] = d.muzzle;
      const mr = hr * mk;
      const L = d.longMuzzle;
      const mz = ball(fur(mc, 0.7), mr * (L ? 0.95 : 1.05), mr * (L ? 0.82 : 0.78), mr * (L ? 1.3 : 0.85));
      const center = new THREE.Vector3(0, -hr * (L ? 0.4 : 0.32), hr * (L ? 0.78 : 0.62));
      mz.position.copy(center);
      head.add(mz);
      if (L) {
        for (const s of [-1, 1]) {
          const n = ball(fur(0x3a2a2a, 0.4), mr * 0.12, mr * 0.16, mr * 0.08);
          n.position.set(s * mr * 0.35, center.y + mr * 0.25, center.z + mr * 1.18);
          head.add(n);
        }
      } else {
        const nose = ball(fur(d.nose || 0x2b2228, 0.35), mr * 0.28, mr * 0.2, mr * 0.18);
        nose.position.set(0, center.y + mr * 0.42, center.z + mr * 0.72);
        head.add(nose);
      }
      mouthSphere = L ? { R: mr * 1.1, center: center.clone().add(new THREE.Vector3(0, 0, mr * 0.15)), pitch: -0.3 }
        : { R: mr * 0.82, center, pitch: -0.32 };
      if (d.whiskers) {
        for (const s of [-1, 1]) for (const k of [-1, 0, 1]) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, hr * 0.7), fur(0x555566, 0.5));
          w.rotation.z = Math.PI / 2 + k * 0.18 * s;
          w.position.set(s * (mr * 0.9 + hr * 0.3), center.y + k * 0.05, center.z + mr * 0.45);
          head.add(w);
        }
      }
      if (d.blaze) {
        const bl = ball(fur(0xffffff), hr * 0.13, hr * 0.38, hr * 0.06);
        placeOnSphere(bl, hr, 0, 0.42, -0.03);
        head.add(bl);
      }
    }
    if (d.panda) {
      for (const s of [-1, 1]) {
        const p = ball(fur(0x24242a, 0.6), hr * 0.24, hr * 0.3, hr * 0.12);
        placeOnSphere(p, hr, s * 0.34, 0.06, -0.02);
        p.rotation.z += s * 0.5;
        head.add(p);
      }
    }
    this.face = new Face(head, {
      R: hr, eye: hr * (d.panda ? 0.2 : 0.23), spread: d.trunk ? 0.4 : 0.36, eyeUp: d.muzzle ? 0.2 : 0.14,
      mouthDown: d.trunk ? -0.5 : -0.3, mouthW: hr * 0.17, brow: d.panda ? 0x24242a : 0x4a3426,
      seed: this.seed, mouthSphere, cheekUp: d.muzzle ? -0.05 : -0.2, cheekSpread: 0.36,
      pupil: d.panda ? 0x111111 : 0x1a1a2e,
    });
    // ears
    const earMat = fur(d.earColor || d.color, 0.8), inner = fur(0xffb8c6, 0.8);
    for (const s of [-1, 1]) {
      const ear = new THREE.Group();
      let mesh;
      switch (d.ears) {
        case 'elephant': {
          mesh = ball(earMat, hr * 0.62, hr * 0.7, hr * 0.12);
          const inn = ball(fur(0xf0b9c8), hr * 0.46, hr * 0.53, hr * 0.08);
          ear.position.set(s * hr * 0.92, hr * 0.12, -hr * 0.1);
          ear.rotation.y = s * 0.5;
          mesh.position.x = s * hr * 0.35;
          inn.position.set(s * hr * 0.35, 0, hr * 0.06);
          ear.add(mesh, inn);
          break;
        }
        case 'pointy': case 'long': {
          const L = d.ears === 'long' ? hr * 0.95 : hr * 0.62;
          mesh = cone(earMat, hr * 0.18, L);
          mesh.position.y = L / 2;
          const inn = cone(inner, hr * 0.1, L * 0.7);
          inn.position.set(0, L * 0.42, hr * 0.06);
          ear.add(mesh, inn);
          const tight = d.forelock ? 0.7 : 1;
          ear.position.set(s * hr * 0.45 * tight, hr * 0.72, -hr * 0.05);
          ear.rotation.z = -s * 0.35 * (d.forelock ? 0.3 : 1);
          break;
        }
        case 'round': case 'mouse': case 'monkey': {
          const r = d.ears === 'mouse' ? hr * 0.48 : d.ears === 'monkey' ? hr * 0.3 : hr * 0.26;
          mesh = ball(earMat, r, r, r * 0.4);
          const inn = ball(d.ears === 'round' ? fur(d.panda ? 0x3a3a44 : 0xf6d3a8) : inner, r * 0.65, r * 0.65, r * 0.3);
          inn.position.z = r * 0.18;
          ear.add(mesh, inn);
          if (d.ears === 'monkey') ear.position.set(s * hr * 0.98, 0.05, 0);
          else ear.position.set(s * hr * 0.62, hr * 0.72, -hr * 0.05);
          if (d.ears === 'monkey') ear.rotation.y = s * 1.2;
          break;
        }
        case 'floppy': case 'side': {
          mesh = ball(earMat, hr * 0.2, hr * (d.ears === 'floppy' ? 0.45 : 0.3), hr * 0.12);
          mesh.position.y = -hr * 0.25;
          ear.add(mesh);
          ear.position.set(s * hr * 0.82, hr * 0.38, -hr * 0.05);
          ear.rotation.z = s * (d.ears === 'floppy' ? 0.25 : 1.1);
          break;
        }
      }
      head.add(ear);
      this.ears.push({ ear, s, rz: ear.rotation.z });
    }
    if (d.ossicones) {
      for (const s of [-1, 1]) {
        const o = capsule(skin, hr * 0.07, hr * 0.32);
        o.position.set(s * hr * 0.22, hr * 0.95, -hr * 0.1);
        const knob = ball(fur(0xa0582a), hr * 0.11, hr * 0.11, hr * 0.11);
        knob.position.set(s * hr * 0.22, hr * 1.18, -hr * 0.1);
        head.add(o, knob);
      }
    }
    if (d.horns) {
      for (const s of [-1, 1]) {
        const h = cone(fur(0xd8c6a2, 0.5), hr * 0.08, hr * 0.45, 10);
        h.position.set(s * hr * 0.3, hr * 0.9, -hr * 0.15);
        h.rotation.set(-0.5, 0, -s * 0.25);
        head.add(h);
      }
    }
    if (d.beard) {
      const b = cone(fur(0xffffff), hr * 0.12, hr * 0.35, 10);
      b.rotation.x = Math.PI;
      b.position.set(0, -hr * 0.85, hr * 0.55);
      head.add(b);
    }
    if (d.mane === 'lion') {
      const mm = fur(d.maneColor, 0.85);
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU;
        const b = ball(mm, hr * 0.38, hr * 0.38, hr * 0.3, true);
        b.position.set(Math.cos(a) * hr * 1.0, Math.sin(a) * hr * 0.98, -hr * 0.28);
        head.add(b);
      }
    } else if (d.ruff) {
      // soft fluffy cheek ruff so mom and cub read clearly as lions
      const rm = fur(d.ruff, 0.9);
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU;
        if (Math.sin(a) > 0.6) continue;
        const b = ball(rm, hr * 0.24, hr * 0.24, hr * 0.2, true);
        b.position.set(Math.cos(a) * hr * 0.95, Math.sin(a) * hr * 0.9 - hr * 0.05, -hr * 0.2);
        head.add(b);
      }
    } else if (d.mane && !d.neck) {
      const mk = d.bigMane ? 1.5 : 1;
      for (let i = 0; i < (d.bigMane ? 8 : 6); i++) {
        const m = ball(fur(d.mane), hr * 0.16 * mk, hr * 0.24 * mk, hr * 0.2 * mk, true);
        m.position.set(0, hr * (0.92 - i * 0.12), -hr * (0.1 + i * 0.24));
        head.add(m);
      }
      if (d.forelock) {
        const f = ball(fur(d.mane), hr * 0.3, hr * 0.2, hr * 0.18, true);
        f.position.set(0, hr * 0.78, hr * 0.42);
        f.rotation.x = 0.5;
        head.add(f);
      }
    }
    if (d.trunk) {
      let parent = head;
      const n = 6;
      for (let i = 0; i < n; i++) {
        const seg = new THREE.Group();
        const r = hr * (0.27 - i * 0.022);
        seg.position.set(0, i === 0 ? -hr * 0.12 : -hr * 0.2, i === 0 ? hr * 0.82 : 0);
        const m = ball(skin, r, hr * 0.17, r);
        m.position.y = -hr * 0.08;
        seg.add(m);
        parent.add(seg);
        this.trunk.push(seg);
        parent = seg;
      }
      const tip = ball(fur(0xc9d4e2), hr * 0.11, hr * 0.06, hr * 0.11);
      tip.position.y = -hr * 0.18;
      parent.add(tip);
    }
    this.buildTail(d, skin, bz, by);
  }

  buildTail(d, skin, bz, by) {
    const tail = this.tail = new THREE.Group();
    tail.position.set(0, by * 0.3, -bz * 0.95);
    this.body.add(tail);
    const tm = fur(d.tailColor || d.color, 0.8);
    switch (d.tail) {
      case 'tuft': case 'long': case 'thin': case 'wag': {
        const L = d.tail === 'thin' ? 1.0 : d.tail === 'long' ? 0.8 : 0.55;
        const r = d.tail === 'thin' ? 0.035 : 0.06;
        const map = d.stripes ? stripes('#' + d.color.toString(16).padStart(6, '0'), d.stripes, false, 5, 11) : null;
        const c = capsule(d.tail === 'thin' ? fur(0xffb6c8) : fur(d.color, 0.8, map), r, L);
        c.position.y = -L / 2;
        tail.add(c);
        tail.rotation.x = d.tail === 'wag' ? -2.4 : -0.5;
        if (d.tail === 'tuft') {
          const t = ball(fur(d.tailTuft || d.mane || 0x333333), 0.11, 0.17, 0.11);
          t.position.y = -L - 0.05;
          tail.add(t);
        }
        break;
      }
      case 'bushy': {
        const t = ball(tm, 0.14, 0.42, 0.14);
        t.position.y = -0.38;
        tail.add(t);
        tail.rotation.x = -0.6;
        break;
      }
      case 'puff': {
        const t = ball(fur(d.tailColor || d.color), 0.16, 0.16, 0.16, true);
        tail.add(t);
        break;
      }
      case 'curl': {
        const pts = [];
        for (let i = 0; i <= 30; i++) {
          const k = i / 30;
          const a = k * TAU * 1.1;
          pts.push(new THREE.Vector3(0, k * 0.8 + Math.sin(a) * 0.18 * k, -0.2 - Math.cos(a) * 0.18 * k - k * 0.3));
        }
        const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.05, 8);
        const m = new THREE.Mesh(g, tm); m.castShadow = true;
        tail.add(m);
        break;
      }
    }
  }

  // ---------------------------------------------------------- monkey
  buildBiped(d) {
    const headK = this.baby ? 1.2 : 1;
    const skin = fur(d.color), face = fur(d.face);
    const legLen = d.leg[1];
    const body = this.body = new THREE.Group();
    body.position.y = legLen + d.body[1] * 0.85;
    this.hipY = legLen;
    this.pivot.add(body);
    body.add(ball(skin, ...d.body));
    const belly = ball(face, d.body[0] * 0.7, d.body[1] * 0.7, d.body[2] * 0.5);
    belly.position.z = d.body[2] * 0.5;
    body.add(belly);
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.22, legLen + 0.05, 0);
      const leg = capsule(skin, d.leg[0], legLen * 0.7);
      leg.position.y = -legLen * 0.5;
      const foot = ball(face, 0.16, 0.08, 0.22);
      foot.position.set(0, -legLen + 0.05, 0.08);
      hip.add(leg, foot);
      this.pivot.add(hip);
      this.legs.push({ hip, front: 0, side: s });
      const sh = new THREE.Group();
      sh.position.set(s * d.body[0] * 0.95, d.body[1] * 0.45, 0);
      const arm = capsule(skin, 0.11, 0.7);
      arm.position.y = -0.42;
      const hand = ball(face, 0.14, 0.14, 0.14);
      hand.position.y = -0.85;
      sh.add(arm, hand);
      sh.rotation.z = s * 0.25;
      body.add(sh);
      this.arms.push({ sh, s });
    }
    const hr = d.head * headK;
    this.headR = hr;
    const neck = this.neck = new THREE.Group();
    neck.position.set(0, d.body[1] * 0.8, 0.05);
    body.add(neck);
    const head = this.head = new THREE.Group();
    head.position.set(0, hr * 0.8, 0);
    neck.add(head);
    head.add(ball(skin, hr, hr * 0.95, hr * 0.92));
    const mask = ball(face, hr * 0.78, hr * 0.68, hr * 0.5);
    mask.position.set(0, -hr * 0.12, hr * 0.52);
    head.add(mask);
    for (const s of [-1, 1]) {
      const r = hr * 0.34;
      const ear = new THREE.Group();
      const m = ball(skin, r, r, r * 0.45);
      const inn = ball(face, r * 0.65, r * 0.65, r * 0.3); inn.position.z = r * 0.2;
      ear.add(m, inn);
      ear.position.set(s * hr * 1.0, 0.02, 0);
      ear.rotation.y = s * 1.2;
      head.add(ear);
      this.ears.push({ ear, s, rz: 0 });
    }
    const nose = ball(fur(0x5a3a2a, 0.4), hr * 0.12, hr * 0.08, hr * 0.06);
    nose.position.set(0, -hr * 0.1, hr * 0.98);
    head.add(nose);
    this.face = new Face(head, { R: hr, eye: hr * 0.22, spread: 0.3, eyeUp: 0.16, mouthDown: -0.38,
      mouthW: hr * 0.2, brow: 0x4a2a1a, seed: this.seed, center: new THREE.Vector3(0, 0, 0.04) });
    this.buildTail(d, skin, d.body[2], d.body[1]);
    this.tail.position.set(0, -d.body[1] * 0.5, -d.body[2] * 0.9);
  }

  // ---------------------------------------------------------- birds
  buildBird(d) {
    const big = !!d.big;
    const K = big ? 1.25 : 1;
    const body = this.body = new THREE.Group();
    body.position.y = 0.55 * K;
    this.hipY = 0.25 * K;
    this.pivot.add(body);
    const bm = fur(d.color, 0.6), belly = fur(d.belly, 0.6), wingM = fur(d.wing || d.color, 0.6);
    const torso = ball(bm, 0.42 * K, 0.4 * K, big ? 0.6 : 0.46);
    body.add(torso);
    const bl = ball(belly, 0.34 * K, 0.32 * K, 0.3 * K);
    bl.position.set(0, -0.06 * K, 0.18 * K);
    body.add(bl);
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.38 * K, 0.08 * K, -0.05);
      const w = ball(wingM, 0.08 * K, 0.3 * K, big ? 0.48 : 0.32);
      w.position.set(s * 0.05, -0.12 * K, -0.05);
      sh.add(w);
      body.add(sh);
      this.wings.push({ sh, s });
      const hip = new THREE.Group();
      hip.position.set(s * 0.14 * K, 0.27 * K, 0);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.26 * K), fur(d.legs || 0xff9a3a));
      leg.position.y = -0.13 * K;
      const foot = ball(fur(d.legs || 0xff9a3a), 0.08, 0.025, 0.1);
      foot.position.set(0, -0.26 * K, 0.04);
      hip.add(leg, foot);
      this.pivot.add(hip);
      this.legs.push({ hip, front: 0, side: s });
    }
    const tail = this.tail = new THREE.Group();
    tail.position.set(0, 0.05, -0.42 * K);
    const tf = cone(wingM, 0.14 * K, 0.4 * K, 8);
    tf.rotation.x = -Math.PI / 2 - 0.4;
    tf.position.z = -0.15;
    tail.add(tf);
    body.add(tail);
    const hr = d.head * K * (this.baby ? 1.2 : 1);
    this.headR = hr;
    const neck = this.neck = new THREE.Group();
    neck.position.set(0, 0.3 * K, 0.2 * K);
    body.add(neck);
    const head = this.head = new THREE.Group();
    head.position.set(0, hr * 0.6, 0.05);
    neck.add(head);
    head.add(ball(bm, hr, hr * 0.95, hr * 0.95));
    this.buildBeak(head, hr, d.beak, 0.38);
    this.face = new Face(head, { R: hr, eye: hr * 0.25, spread: 0.42, eyeUp: 0.18, mouth: false,
      brow: 0x334455, seed: this.seed, cheekUp: -0.12 });
  }

  buildBeak(head, hr, color, len) {
    const bm = fur(color, 0.4);
    const top = cone(bm, hr * 0.22, hr * len * 1.6, 12);
    top.rotation.x = Math.PI / 2;
    top.scale.set(1, 1, 0.55);
    const upper = new THREE.Group();
    upper.position.set(0, -hr * 0.12, hr * 0.88);
    top.position.z = hr * len * 0.6;
    upper.add(top);
    const bot = cone(bm, hr * 0.17, hr * len * 1.2, 12);
    bot.rotation.x = Math.PI / 2;
    bot.scale.set(1, 1, 0.45);
    const lower = new THREE.Group();
    lower.position.set(0, -hr * 0.2, hr * 0.85);
    bot.position.z = hr * len * 0.45;
    lower.add(bot);
    head.add(upper, lower);
    this.beak = { upper, lower };
  }

  // ---------------------------------------------------------- penguin
  buildPenguin(d) {
    const baby = this.baby;
    const bm = fur(baby ? 0x9aa3b5 : d.color, baby ? 0.95 : 0.55);
    const belly = fur(baby ? 0xe8ecf4 : d.belly, 0.6);
    const body = this.body = new THREE.Group();
    body.position.y = 0.95;
    this.hipY = 0.15;
    this.pivot.add(body);
    body.add(ball(bm, 0.62, 0.85, 0.58));
    const bl = ball(belly, 0.48, 0.68, 0.36);
    bl.position.set(0, -0.08, 0.28);
    body.add(bl);
    if (baby) {
      for (let i = 0; i < 12; i++) {
        const a = hash(i + 4) * TAU, b = (hash(i * 3 + 1) - 0.5) * 2;
        const f = ball(bm, 0.18, 0.18, 0.18, true);
        f.position.set(Math.cos(a) * 0.56, b * 0.6, Math.sin(a) * 0.5 - 0.05);
        if (f.position.z > 0.2 && Math.abs(f.position.x) < 0.3) continue;
        body.add(f);
      }
    }
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.58, 0.25, 0);
      const w = ball(bm, 0.1, 0.48, 0.24);
      w.position.y = -0.38;
      sh.add(w);
      sh.rotation.z = s * 0.25;
      body.add(sh);
      this.wings.push({ sh, s });
      const hip = new THREE.Group();
      hip.position.set(s * 0.24, 0.12, 0.1);
      const foot = ball(fur(d.beak, 0.5), 0.17, 0.06, 0.24);
      foot.position.set(0, -0.07, 0.12);
      hip.add(foot);
      this.pivot.add(hip);
      this.legs.push({ hip, front: 0, side: s });
    }
    const hr = d.head * (baby ? 1.2 : 1);
    this.headR = hr;
    const neck = this.neck = new THREE.Group();
    neck.position.set(0, 0.7, 0.02);
    body.add(neck);
    const head = this.head = new THREE.Group();
    head.position.set(0, hr * 0.65, 0);
    neck.add(head);
    head.add(ball(bm, hr, hr * 0.95, hr * 0.92));
    const facePatch = ball(fur(baby ? 0xffffff : 0xffffff, 0.6), hr * 0.78, hr * 0.62, hr * 0.5);
    facePatch.position.set(0, -hr * 0.05, hr * 0.5);
    head.add(facePatch);
    this.buildBeak(head, hr, d.beak, 0.4);
    this.face = new Face(head, { R: hr, eye: hr * 0.22, spread: 0.36, eyeUp: 0.15, mouth: false,
      brow: 0x222233, seed: this.seed, cheekUp: -0.15, center: new THREE.Vector3(0, 0, 0.05) });
    this.tail = new THREE.Group();
  }

  // ---------------------------------------------------------- seal
  buildSeal(d) {
    const bm = fur(d.color, 0.45), belly = fur(d.belly, 0.5);
    const body = this.body = new THREE.Group();
    body.position.y = 0.55;
    this.hipY = 0;
    this.pivot.add(body);
    const torso = ball(bm, 0.6, 0.55, 1.05);
    torso.rotation.x = -0.25;
    body.add(torso);
    const bl = ball(belly, 0.45, 0.4, 0.8);
    bl.position.set(0, -0.15, 0.15);
    bl.rotation.x = -0.25;
    body.add(bl);
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.5, -0.25, 0.35);
      const f = ball(bm, 0.12, 0.08, 0.32);
      f.position.set(s * 0.18, -0.08, 0.1);
      f.rotation.y = s * 0.6;
      sh.add(f);
      body.add(sh);
      this.wings.push({ sh, s });
    }
    const tail = this.tail = new THREE.Group();
    tail.position.set(0, -0.4, -1.0);
    for (const s of [-1, 1]) {
      const f = ball(bm, 0.22, 0.06, 0.3);
      f.position.set(s * 0.18, 0, -0.12);
      f.rotation.y = s * 0.5;
      tail.add(f);
    }
    body.add(tail);
    const hr = d.head * (this.baby ? 1.2 : 1);
    this.headR = hr;
    const neck = this.neck = new THREE.Group();
    neck.position.set(0, 0.45, 0.65);
    body.add(neck);
    const head = this.head = new THREE.Group();
    head.position.set(0, hr * 0.55, 0.1);
    neck.add(head);
    head.add(ball(bm, hr, hr * 0.92, hr * 0.95));
    const muz = ball(belly, hr * 0.5, hr * 0.36, hr * 0.4);
    const center = new THREE.Vector3(0, -hr * 0.28, hr * 0.7);
    muz.position.copy(center);
    head.add(muz);
    const nose = ball(fur(0x2b2b33, 0.3), hr * 0.14, hr * 0.1, hr * 0.08);
    nose.position.set(0, center.y + hr * 0.18, center.z + hr * 0.36);
    head.add(nose);
    for (const s of [-1, 1]) for (const k of [-1, 0, 1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, hr * 0.8), fur(0xffffff, 0.4));
      w.rotation.z = Math.PI / 2 + k * 0.15 * s;
      w.position.set(s * hr * 0.55, center.y + k * 0.05, center.z + hr * 0.2);
      head.add(w);
    }
    this.face = new Face(head, { R: hr, eye: hr * 0.27, spread: 0.36, eyeUp: 0.2, mouthW: hr * 0.12,
      brow: 0x334, seed: this.seed, mouthSphere: { R: hr * 0.36, center, pitch: -0.5 }, cheekUp: -0.08 });
  }

  // ===================================================================== pose
  /**
   * p: { t, x, y, z, yaw, visible, mood, open (mouth), cry, sleep, look, surprise, squint,
   *      walk (phase rate 0..1), hop (height), lean, tilt, nod, shake, wave (0..1), rear (0..1),
   *      clap (0..1), sway, spin, stretch, squash, flap (0..1), trunkUp (0..1), wag, scale, sound (0..1) }
   */
  update(p) {
    const t = p.t;
    const r = this.root;
    r.visible = p.visible !== false;
    if (!r.visible) return;
    r.position.set(p.x || 0, (p.y || 0), p.z || 0);
    r.rotation.set(0, (p.yaw || 0) + (p.spin || 0), 0);
    r.scale.setScalar(this.baseScale * (p.scale ?? 1));
    const pv = this.pivot;
    const seed = this.seed;
    const breath = Math.sin(t * 2.2 + seed) * 0.02;
    const walk = p.walk || 0;
    const wph = t * 9 + seed;
    pv.position.y = (p.hop || 0) + walk * Math.abs(Math.sin(wph)) * 0.08;
    pv.rotation.z = (p.sway || 0) + (p.lean || 0);
    pv.rotation.x = -(p.rear || 0) * 0.75;
    if (p.rear) pv.position.y += (p.rear) * 0.25;
    const sq = 1 + (p.stretch || 0) * 0.18 - (p.squash || 0) * 0.15;
    pv.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    if (this.torso) this.torso.scale.y = this.def.body ? this.def.body[1] * (1 + breath) : this.torso.scale.y;
    // legs
    const hopTuck = clamp((p.hop || 0) * 1.5);
    for (const L of this.legs) {
      const phase = (L.front ? 0 : Math.PI) + (L.side > 0 ? Math.PI : 0);
      let rx = walk * 0.55 * Math.sin(wph + phase) + hopTuck * (L.front ? -0.5 : 0.5);
      let rz = 0;
      if (L.front && p.rear) rx += -p.rear * 0.4;
      if (L.front && L.side > 0 && p.wave) { rx = -1.9 * p.wave; rz = -0.45 * Math.sin(t * 9) * p.wave; }
      if (L.front && p.clap) { rx = -1.3 * p.clap; rz = L.side * (0.25 + 0.3 * Math.sin(t * 12)) * p.clap * -1; }
      L.hip.rotation.set(rx, 0, rz);
    }
    for (const A of this.arms) {
      let rz = A.s * 0.25 + Math.sin(t * 2 + seed) * 0.05, rx = walk * 0.5 * Math.sin(wph + (A.s > 0 ? 0 : Math.PI));
      if (A.s > 0 && p.wave) { rz = A.s * (2.4 + 0.4 * Math.sin(t * 9)) * p.wave + A.s * 0.25 * (1 - p.wave); }
      if (p.clap) { rx = -1.4 * p.clap; rz = A.s * (0.35 + 0.35 * Math.sin(t * 12)) * p.clap; }
      if (p.flap) rz = A.s * (1.2 + 0.9 * Math.sin(t * 16)) * p.flap;
      A.sh.rotation.set(rx, 0, rz);
    }
    for (const W of this.wings) {
      const f = p.flap || 0;
      W.sh.rotation.z = W.s * (0.25 + f * (0.9 + 0.8 * Math.sin(t * 22))) + W.s * (p.wave && W.s > 0 ? 1.5 * p.wave * (0.6 + 0.4 * Math.sin(t * 9)) : 0)
        + (p.clap ? -W.s * 0.6 * p.clap * Math.abs(Math.sin(t * 10)) : 0);
    }
    // head
    const h = this.head;
    const shake = p.shake ? Math.sin(t * 14) * 0.35 * p.shake : 0;
    h.rotation.set(-(p.nod || 0) + Math.sin(t * 1.3 + seed) * 0.03 - (p.sound || 0) * 0.25,
      shake + (p.headYaw || 0) + Math.sin(t * 0.9 + seed * 2) * 0.05, (p.tilt || 0));
    if (this.neck) this.neck.rotation.x = -(p.sound || 0) * 0.15 + (p.cry ? 0.12 : 0) + (p.neckBend || 0);
    for (const E of this.ears) {
      E.ear.rotation.z = E.rz + E.s * Math.sin(t * 3 + seed) * 0.06 * (this.def.ears === 'elephant' ? 2 : 1)
        + (p.sound ? E.s * 0.2 * Math.sin(t * 20) * p.sound : 0);
    }
    if (this.tail) {
      const wag = p.wag ?? 0.3;
      this.tail.rotation.y = Math.sin(t * (this.def.tail === 'wag' ? 14 : 4) + seed) * 0.35 * (wag + 0.2);
    }
    // elephant trunk curls
    if (this.trunk.length) {
      const up = p.trunkUp || 0;
      const sw = Math.sin(t * 1.7 + seed) * 0.08;
      this.trunk.forEach((seg, i) => {
        const rest = i === 0 ? 0.0 : 0.12 + (i > 3 ? 0.22 : 0);
        const lift = i === 0 ? -0.9 : -0.42;
        seg.rotation.x = rest * (1 - up) + lift * up + sw;
      });
    }
    // beak talking
    let open = clamp(p.open || 0);
    if (this.beak) {
      this.beak.lower.rotation.x = open * 0.6;
      this.beak.upper.rotation.x = -open * 0.15;
    }
    this.face.update({ t, mood: p.mood ?? 0.7, open, cry: p.cry, sleep: p.sleep, look: p.look,
      surprise: p.surprise, squint: p.squint, blink: p.blink });
  }

  // world height of the top of the head (for hearts / labels)
  get height() {
    return (this.def.neck ? 3.6 : this.def.kind === 'quad' ? 2.2 : 2) * this.baseScale;
  }
}
