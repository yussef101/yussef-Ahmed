// Expressive cartoon face shared by the train and every animal.
// Elements are placed on the surface of a sphere (radius R, centred on the
// head's origin) looking down +Z, so they hug the head's curvature.
import * as THREE from 'three';
import { clamp, hash, lerp, smooth } from './util.js';

const M = {};
function mat(key, color, opts = {}) {
  if (!M[key]) M[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0, ...opts });
  return M[key];
}
const G = {};
function geo(key, make) { return G[key] || (G[key] = make()); }

export function placeOnSphere(obj, R, yaw, pitch, lift = 0, center = null) {
  const r = R + lift;
  const n = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  obj.position.copy(n).multiplyScalar(r);
  if (center) obj.position.add(center);
  obj.lookAt(obj.position.clone().add(n));
}

export class Face {
  /**
   * @param parent group whose +Z is "forward"
   * @param o options: R, eye (size), spread (yaw of each eye), eyeUp (pitch), mouthDown, mouthW,
   *          brow color, cheek, skin, center (vector offset of the sphere)
   */
  constructor(parent, o = {}) {
    this.o = o = Object.assign({ R: 0.6, eye: 0.16, spread: 0.36, eyeUp: 0.18, mouthDown: -0.22, mouthW: 0.14,
      brow: 0x3a2a20, cheek: true, mouth: true, brows: true, center: new THREE.Vector3(), seed: 1, pupil: 0x1a1a2e }, o);
    const root = this.root = new THREE.Group();
    root.position.copy(o.center);
    parent.add(root);
    this.eyes = [];
    for (const side of [-1, 1]) {
      const holder = new THREE.Group();
      placeOnSphere(holder, o.R, side * o.spread, o.eyeUp, -o.eye * 0.25);
      const eye = new THREE.Group();
      const white = new THREE.Mesh(geo('eyeW', () => new THREE.SphereGeometry(1, 24, 16)), mat('eyeW', 0xffffff, { roughness: 0.2 }));
      white.scale.set(o.eye * 0.9, o.eye, o.eye * 0.55);
      const pupil = new THREE.Mesh(geo('eyeW', null), mat('pupil' + o.pupil, o.pupil, { roughness: 0.15 }));
      const ps = o.eye * (o.iris ? 0.36 : 0.62);
      pupil.scale.set(ps * 0.92, ps, ps * 0.5);
      pupil.position.z = o.eye * (o.iris ? 0.42 : 0.3);
      const hl = new THREE.Mesh(geo('eyeW', null), mat('hl', 0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6 }));
      hl.scale.setScalar(o.eye * 0.2);
      hl.position.set(o.eye * 0.22, o.eye * 0.25, o.eye * 0.5);
      const hl2 = hl.clone(); hl2.scale.setScalar(o.eye * 0.1); hl2.position.set(-o.eye * 0.18, -o.eye * 0.2, o.eye * 0.5);
      const pupGroup = new THREE.Group();
      pupGroup.add(pupil, hl, hl2);
      if (o.iris) {           // coloured iris ring behind the pupil
        const iris = new THREE.Mesh(geo('eyeW', null), mat('iris' + o.iris, o.iris, { roughness: 0.2 }));
        const is = o.eye * 0.66;
        iris.scale.set(is * 0.92, is, is * 0.45);
        iris.position.z = o.eye * 0.3;
        pupGroup.add(iris);
      }
      eye.add(white, pupGroup);
      holder.add(eye);
      root.add(holder);
      // closed-eye line (sleep / happy squint)
      const lidGeo = geo('lid', () => new THREE.TorusGeometry(1, 0.13, 8, 20, Math.PI));
      const lid = new THREE.Mesh(lidGeo, mat('lidLine', 0x2a1e1a));
      lid.scale.setScalar(o.eye * 0.75);
      lid.rotation.z = Math.PI; // U shape = peaceful closed eye
      lid.position.z = o.eye * 0.35;
      lid.visible = false;
      lid.userData.keep = true;
      holder.add(lid);
      let brow = null;
      if (o.brows) {
        brow = new THREE.Mesh(geo('brow', () => new THREE.CapsuleGeometry(0.22, 1, 4, 8)), mat('brow' + o.brow, o.brow));
        brow.scale.setScalar(o.eye * 0.55);
        brow.rotation.z = Math.PI / 2;
        brow.position.set(0, o.eye * 1.45, o.eye * 0.2);
        holder.add(brow);
      }
      this.eyes.push({ holder, eye, pupGroup, lid, brow, side });
    }
    // mouth
    if (o.mouth) {
      const mh = this.mouthHolder = new THREE.Group();
      if (o.mouthSphere) placeOnSphere(mh, o.mouthSphere.R, 0, o.mouthSphere.pitch, -0.005, o.mouthSphere.center);
      else placeOnSphere(mh, o.R, 0, o.mouthDown, -0.01);
      const arc = this.arc = new THREE.Mesh(geo('arc', () => new THREE.TorusGeometry(1, 0.16, 8, 24, Math.PI)), mat('mouthLine', 0x4a1f1f));
      arc.rotation.z = Math.PI;
      arc.scale.setScalar(o.mouthW);
      arc.userData.keep = true;
      const open = this.open = new THREE.Group();
      const hole = new THREE.Mesh(geo('eyeW', null), mat('mouthIn', 0x7a1f2b, { roughness: 0.6 }));
      hole.scale.set(1, 1, 0.35);
      const tongue = new THREE.Mesh(geo('eyeW', null), mat('tongue', 0xff7b8a, { roughness: 0.6 }));
      tongue.scale.set(0.62, 0.45, 0.3);
      tongue.position.set(0, -0.45, 0.12);
      open.add(hole, tongue);
      mh.add(arc, open);
      root.add(mh);
    }
    if (o.cheek) {
      this.cheeks = [];
      for (const side of [-1, 1]) {
        const c = new THREE.Mesh(geo('eyeW', null), mat('cheek', 0xff8fa3, { roughness: 0.8, transparent: true, opacity: 0.75 }));
        placeOnSphere(c, o.R, side * (o.spread + (o.cheekSpread ?? 0.32)), o.cheekUp ?? (o.mouthDown + 0.12), -0.02);
        c.scale.set(o.eye * 0.8, o.eye * 0.5, o.eye * 0.2);
        c.userData.keep = true;
        root.add(c);
        this.cheeks.push(c);
      }
    }
    // tears
    this.tears = [];
    for (const side of [-1, 1]) {
      const tg = new THREE.Group();
      placeOnSphere(tg, o.R, side * (o.spread + 0.06), o.eyeUp - 0.22, 0.02);
      const drop = new THREE.Mesh(geo('eyeW', null), mat('tear', 0x7fd4ff, { roughness: 0.05, transparent: true, opacity: 0.9, emissive: 0x2a7fbf, emissiveIntensity: 0.3 }).clone());
      drop.scale.set(o.eye * 0.28, o.eye * 0.4, o.eye * 0.2);
      drop.userData.keep = true;
      tg.add(drop);
      tg.visible = false;
      root.add(tg);
      this.tears.push({ tg, drop, side });
    }
  }

  /**
   * s: { t, mood (-1 sad .. 1 happy), open (0..1), blink (0..1 forced), sleep (0..1),
   *      look: [x, y] (-1..1), cry (bool), surprise (0..1), squint (0..1) }
   */
  update(s) {
    const o = this.o;
    const t = s.t;
    // automatic blinking, deterministic per face
    const per = 3.2 + hash(o.seed) * 1.6;
    const ph = ((t + hash(o.seed + 3) * per) % per) / per;
    const autoBlink = ph > 0.955 ? Math.sin((ph - 0.955) / 0.045 * Math.PI) : 0;
    const blink = clamp(Math.max(autoBlink, s.blink || 0));
    const sleep = clamp(s.sleep || 0);
    const squint = clamp(s.squint || 0);
    const surprise = clamp(s.surprise || 0);
    const mood = s.mood ?? 0.6;
    const look = s.look || [0, 0];
    for (const e of this.eyes) {
      const sy = (1 - blink * 0.92) * (1 - sleep) * (1 - squint * 0.45) * (1 + surprise * 0.15);
      e.eye.scale.set(1 + surprise * 0.1, Math.max(0.02, sy), 1);
      e.eye.visible = sleep < 0.95;
      e.lid.visible = sleep > 0.5;
      e.pupGroup.position.set(look[0] * o.eye * 0.28, look[1] * o.eye * 0.22, 0);
      if (e.brow) {
        const sad = clamp(-mood);
        e.brow.position.y = o.eye * (1.45 + surprise * 0.35 + 0.12 * Math.max(0, mood) - 0.1 * sad);
        e.brow.rotation.z = Math.PI / 2 + e.side * (-0.45 * sad + 0.12 * Math.max(0, mood));
      }
    }
    if (this.arc) {
      const open = clamp(s.open || 0);
      const m = clamp(mood, -1, 1);
      const sign = m >= 0 ? 1 : -1;
      const mag = 0.25 + 0.75 * Math.abs(m);
      this.arc.scale.set(o.mouthW * (1 + 0.15 * Math.abs(m)), o.mouthW * mag * sign, o.mouthW);
      this.arc.position.y = sign < 0 ? -o.mouthW * 0.6 : 0;
      this.arc.visible = open < 0.12;
      this.open.visible = open >= 0.12;
      const w = o.mouthW * (0.8 + 0.4 * open);
      this.open.scale.set(w, o.mouthW * (0.35 + 1.25 * open), w);
      this.open.position.y = -o.mouthW * 0.35 * open;
    }
    if (this.cheeks) for (const c of this.cheeks) c.visible = mood > -0.3;
    for (const tr of this.tears) {
      tr.tg.visible = !!s.cry;
      if (s.cry) {
        const k = ((t * 0.9 + (tr.side > 0 ? 0.45 : 0)) % 1);
        tr.drop.position.y = -k * o.R * 0.55;
        tr.drop.material.opacity = 0.9 * (1 - smooth(clamp((k - 0.7) / 0.3)));
      }
    }
  }
}
