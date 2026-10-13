// Storybook landscapes: sky, sun, light, ground, track, scenery tiles,
// stations, hiding bushes and little effects (hearts, confetti, sound rings,
// balloons, snow, Zzz).  Scenery is instanced and tiled so the train can ride
// forever while keeping draw calls low (important for software rendering).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeStatic } from './merge.js';
import { clamp, hash, lerp, rng, smooth, TAU } from './util.js';

const TILE = 240;

export const THEMES = {
  meadow:    { ground: 0x7fd05a, hill: 0x68c04c, hill2: 0x9be070, skyTop: 0x4fa8ff, skyHor: 0xcdeeff, fog: 0xd2ecff, fogD: 0.0035, sun: 0xfff2d6 },
  savanna:   { ground: 0xe6c565, hill: 0xd9a74e, hill2: 0xeccf7a, skyTop: 0x5fb0ff, skyHor: 0xffe9b8, fog: 0xffefd0, fogD: 0.0035, sun: 0xffe6b8 },
  bamboo:    { ground: 0x7dc35f, hill: 0x5fae58, hill2: 0x8fd27a, skyTop: 0x86cdea, skyHor: 0xe6f7ea, fog: 0xdff3e4, fogD: 0.0075, sun: 0xfff6e0 },
  grassland: { ground: 0x98d64e, hill: 0x7cc844, hill2: 0xb8e266, skyTop: 0x47a2ff, skyHor: 0xd6efff, fog: 0xd8efff, fogD: 0.003, sun: 0xfff3d0 },
  jungle:    { ground: 0x4fae4a, hill: 0x3c9a46, hill2: 0x63bf55, skyTop: 0x5fbcff, skyHor: 0xd4f6e6, fog: 0xcff0e2, fogD: 0.006, sun: 0xfff0d0 },
  snow:      { ground: 0xf3f7ff, hill: 0xe4eefc, hill2: 0xffffff, skyTop: 0x7cc0ff, skyHor: 0xeaf5ff, fog: 0xeaf4ff, fogD: 0.004, sun: 0xffffff },
};
THEMES.home = THEMES.meadow;
THEMES.learning = THEMES.meadow;

const TOD = {      // time-of-day tints
  day:    { sky: [1, 1], sunI: 2.6, hemiI: 1.15, sunCol: null, elev: 0.95 },
  dawn:   { skyTop: 0x2e3a78, skyHor: 0xffb48a, sunI: 1.0, hemiI: 0.55, sunCol: 0xffb07a, elev: 0.12 },
  sunset: { skyTop: 0x5b5ab8, skyHor: 0xffa070, sunI: 1.6, hemiI: 0.75, sunCol: 0xffa060, elev: 0.18 },
  night:  { skyTop: 0x0f1640, skyHor: 0x3a3f7a, sunI: 0.15, hemiI: 0.3, sunCol: 0x8090ff, elev: -0.1 },
};

function m(color, rough = 0.8, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
}

// collects instance transforms per (geometry, material) and builds InstancedMeshes
class Scatter {
  constructor() { this.buckets = new Map(); }
  add(geo, mat, pos, rot = [0, 0, 0], scl = [1, 1, 1], color = null) {
    const k = geo.uuid + mat.uuid + ':' + Math.floor(pos[0] / 40);   // 40-unit chunks -> frustum culling
    if (!this.buckets.has(k)) this.buckets.set(k, { geo, mat, items: [] });
    const mtx = new THREE.Matrix4().compose(new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scl));
    this.buckets.get(k).items.push({ mtx, color });
  }
  build(shadow = true) {
    const g = new THREE.Group();
    for (const { geo, mat, items } of this.buckets.values()) {
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      items.forEach((it, i) => {
        im.setMatrixAt(i, it.mtx);
        if (it.color != null) im.setColorAt(i, new THREE.Color(it.color));
      });
      im.castShadow = shadow; im.receiveShadow = true;
      im.computeBoundingSphere();
      g.add(im);
    }
    return g;
  }
}

const GEO = {
  sphere: new THREE.SphereGeometry(1, 14, 9),
  sphereLo: new THREE.SphereGeometry(1, 8, 6),
  sphereHi: new THREE.SphereGeometry(1, 28, 18),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  cylTaper: new THREE.CylinderGeometry(0.7, 1, 1, 9),
  cone: new THREE.ConeGeometry(1, 1, 10),
  coneLo: new THREE.ConeGeometry(1, 1, 5),
  box: new RoundedBoxGeometry(1, 1, 1, 2, 0.12),
  prism: (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 3); g.rotateZ(Math.PI / 2); g.rotateX(-Math.PI / 2); return g; })(),
  hemi: new THREE.SphereGeometry(1, 20, 10, 0, TAU, 0, Math.PI / 2),
  disc: new THREE.CircleGeometry(1, 24),
};

function textTexture(text, { w = 1024, h = 256, bg = '#ffffff', fg = '#2b2f45', border = '#ffc928', size = 120 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const r = 50;
  g.fillStyle = border;
  g.beginPath(); g.roundRect(0, 0, w, h, r); g.fill();
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(16, 16, w - 32, h - 32, r - 12); g.fill();
  g.fillStyle = fg;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  let s = size;
  do { g.font = `700 ${s}px Fredoka, sans-serif`; s -= 4; } while (g.measureText(text).width > w - 90 && s > 20);
  g.fillText(text, w / 2, h / 2 + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 1;
  return t;
}

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    scene.fog = new THREE.FogExp2(0xd2ecff, 0.0035);
    this.buildSky();
    this.buildLights();
    this.buildGround();
    this.buildTrack();
    this.tiles = {};
    for (const th of ['meadow', 'savanna', 'bamboo', 'grassland', 'jungle', 'snow']) this.tiles[th] = this.buildTile(th);
    this.buildClouds();
    this.stations = {};
    this.buildBushes();
    this.buildFx();
    this.buildBalloons();
    this.buildBunting();
    this.theme = null;
  }

  // ------------------------------------------------------------------ sky
  buildSky() {
    // gradient baked into vertex colours (cheap in software rendering)
    const geo = new THREE.SphereGeometry(1500, 32, 24);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    this.skyGeo = geo;
    this.skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    this.skyKey = '';
    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(26, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff6c8, fog: false }));
    this.scene.add(this.sunDisc);
    const gc = document.createElement('canvas');
    gc.width = gc.height = 128;
    const g = gc.getContext('2d');
    const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,255,255,0.9)'); rg.addColorStop(0.25, 'rgba(255,255,255,0.35)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), transparent: true, depthWrite: false, fog: false, color: 0xfff2c0 }));
    this.sunGlow.scale.setScalar(420);
    this.scene.add(this.sunGlow);
  }

  paintSky(top, hor) {
    const key = top.getHexString() + hor.getHexString();
    if (key === this.skyKey) return;
    this.skyKey = key;
    const pos = this.skyGeo.attributes.position, col = this.skyGeo.attributes.color;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 1500;
      const h = Math.max(0, y);
      c.copy(hor).lerp(top, Math.pow(h, 0.38));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xdff2ff, 0x7aa860, 1.15);
    this.scene.add(this.hemi);
    const d = this.sun = new THREE.DirectionalLight(0xfff2d6, 2.6);
    d.castShadow = true;
    d.shadow.mapSize.set(2048, 2048);
    const c = d.shadow.camera;
    c.left = -30; c.right = 30; c.top = 30; c.bottom = -30; c.near = 1; c.far = 200;
    d.shadow.bias = -0.0004;
    d.shadow.normalBias = 0.03;
    d.shadow.radius = 4;
    this.scene.add(d, d.target);
  }

  buildGround() {
    const W = 4400, D = 700, sx = 440, sz = 90;
    const g = new THREE.PlaneGeometry(W, D, sx, sz);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // flat play area around the track, rolling hills further away
      const far = smooth(clamp((-z - 18) / 40)) + smooth(clamp((z - 45) / 40));
      const hgt = far * (6 * Math.sin(x * 0.021 + 1.3) * Math.sin(z * 0.035) + 4 * Math.sin(x * 0.047 + z * 0.02) + 7);
      pos.setY(i, Math.max(0, hgt) + Math.sin(x * 0.3) * Math.sin(z * 0.27) * 0.06);
      const v = 0.92 + 0.08 * Math.sin(x * 0.11 + z * 0.17) * Math.sin(z * 0.05 - x * 0.03) + far * 0.06;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const grass = document.createElement('canvas');
    grass.width = grass.height = 256;
    const gg = grass.getContext('2d');
    gg.fillStyle = '#ffffff'; gg.fillRect(0, 0, 256, 256);
    const R = rng(77);
    for (let i = 0; i < 2600; i++) {
      const v = Math.floor(200 + R() * 55);
      gg.strokeStyle = `rgba(${v - 20},${v},${v - 40},0.55)`;
      gg.lineWidth = 1 + R() * 1.5;
      const x = R() * 256, y = R() * 256, l = 3 + R() * 7, a = -Math.PI / 2 + (R() - 0.5) * 0.8;
      gg.beginPath(); gg.moveTo(x, y); gg.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); gg.stroke();
    }
    const gt = new THREE.CanvasTexture(grass);
    gt.wrapS = gt.wrapT = THREE.RepeatWrapping;
    gt.repeat.set(W / 5, D / 5);
    gt.colorSpace = THREE.SRGBColorSpace;
    gt.anisotropy = 1;           // anisotropic filtering is very slow in software GL
    this.groundMat = m(0x7fd05a, 0.95, { vertexColors: true, map: gt });
    this.ground = new THREE.Mesh(g, this.groundMat);
    this.ground.position.x = 1500;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
  }

  buildTrack() {
    const S = new Scatter();
    const wood = m(0x9a6a44, 0.9), steel = m(0x8a93a6, 0.35, { metalness: 0.5 }), bed = m(0xc9b79a, 0.95);
    const x0 = -400, x1 = 2000;
    const sleeper = new THREE.BoxGeometry(1, 1, 1);
    for (let x = x0; x < x1; x += 0.9) S.add(sleeper, wood, [x, 0.08, 0], [0, 0, 0], [0.42, 0.14, 2.6]);
    const g = S.build(false);
    for (const z of [-0.92, 0.92]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.14, 0.14), steel);
      rail.position.set((x0 + x1) / 2, 0.22, z);
      rail.receiveShadow = true;
      g.add(rail);
    }
    const ballast = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.06, 3.4), bed);
    ballast.position.set((x0 + x1) / 2, 0.02, 0);
    ballast.receiveShadow = true;
    g.add(ballast);
    this.trackMats = { bed };
    this.track = g;
    this.scene.add(g);
  }

  // ------------------------------------------------------------ scenery tiles
  buildTile(theme) {
    const T = THEMES[theme];
    const R = rng(theme.length * 977 + theme.charCodeAt(0));
    const S = new Scatter();
    const H = new Scatter();
    const half = TILE / 2;
    const rand = (a, b) => a + (b - a) * R();
    const zFar = () => rand(-70, -7);
    const zBack = () => rand(26, 60);
    const zAny = () => (R() < 0.8 ? zFar() : zBack());
    const trunk = m(0x8d5a36, 0.9), leafA = m(0x4caf50, 0.8), leafB = m(0x66c35a, 0.8), leafC = m(0x2e9a48, 0.8);
    const rock = m(0xa7a7b5, 0.9), white = m(0xffffff, 0.7);
    const flowerCols = [0xff5d8f, 0xffd23f, 0xffffff, 0xb57bff, 0xff7f3f, 0x6ec6ff];
    const flowerHead = m(0xffffff, 0.6), stem = m(0x3f9b3f, 0.8), center = m(0xffc928, 0.6);
    // distant hills
    for (let i = 0; i < 16; i++) {
      const x = -half + (i + R()) * TILE / 16;
      H.add(GEO.sphere, m(R() < 0.5 ? T.hill : T.hill2, 0.95), [x, -4, rand(-150, -95)], [0, 0, 0], [rand(25, 45), rand(12, 24), rand(18, 30)]);
    }
    const flower = (x, z, s = 1) => {
      const c = flowerCols[Math.floor(R() * flowerCols.length)];
      S.add(GEO.coneLo, stem, [x, 0.2 * s, z], [0, 0, 0], [0.03 * s, 0.4 * s, 0.03 * s]);
      S.add(GEO.sphereLo, flowerHead, [x, 0.42 * s, z], [0, 0, 0], [0.16 * s, 0.1 * s, 0.16 * s], c);
      S.add(GEO.sphereLo, center, [x, 0.47 * s, z], [0, 0, 0], [0.07 * s, 0.05 * s, 0.07 * s]);
    };
    const roundTree = (x, z, s) => {
      S.add(GEO.cylTaper, trunk, [x, 1.1 * s, z], [0, 0, 0], [0.28 * s, 2.2 * s, 0.28 * s]);
      const leaf = [leafA, leafB, leafC][Math.floor(R() * 3)];
      S.add(GEO.sphere, leaf, [x, 2.9 * s, z], [0, 0, 0], [1.5 * s, 1.35 * s, 1.5 * s]);
      S.add(GEO.sphere, leaf, [x + 0.9 * s, 2.4 * s, z + 0.3 * s], [0, 0, 0], [0.95 * s, 0.85 * s, 0.95 * s]);
      S.add(GEO.sphere, leaf, [x - 0.85 * s, 2.5 * s, z - 0.2 * s], [0, 0, 0], [1.0 * s, 0.9 * s, 1.0 * s]);
    };
    const tuft = (x, z, s, col) => {
      for (let k = 0; k < 3; k++) S.add(GEO.coneLo, col, [x + (k - 1) * 0.18 * s, 0.35 * s, z + (k % 2) * 0.1], [0, 0, (k - 1) * 0.3], [0.1 * s, 0.8 * s, 0.1 * s]);
    };
    const pineM = m(0x2f8a4a, 0.85), pineM2 = m(0x3f9d4f, 0.85);
    const pine = (x, z, s) => {
      S.add(GEO.cyl, trunk, [x, 0.5 * s, z], [0, 0, 0], [0.22 * s, 1 * s, 0.22 * s]);
      for (let k = 0; k < 3; k++) S.add(GEO.cone, k % 2 ? pineM2 : pineM, [x, (1.5 + k * 1.15) * s, z], [0, 0, 0], [(1.55 - k * 0.38) * s, 1.9 * s, (1.55 - k * 0.38) * s]);
    };
    if (theme === 'meadow') {
      for (let i = 0; i < 34; i++) roundTree(rand(-half, half), zAny(), rand(0.8, 1.5));
      for (let i = 0; i < 30; i++) pine(rand(-half, half), zAny(), rand(1.0, 1.8));
      for (let i = 0; i < 340; i++) flower(rand(-half, half), R() < 0.15 ? rand(16, 30) : rand(-30, -3.2), rand(0.8, 1.4));
      for (let i = 0; i < 30; i++) S.add(GEO.sphere, leafB, [rand(-half, half), 0.3, zFar()], [0, 0, 0], [rand(0.6, 1.2), rand(0.5, 0.8), rand(0.6, 1.0)]);
      const fenceW = m(0xffffff, 0.6);
      for (let x = -half; x < half; x += 2.2) {
        S.add(GEO.box, fenceW, [x, 0.5, -9], [0, 0, 0], [0.14, 1.0, 0.14]);
        S.add(GEO.box, fenceW, [x + 1.1, 0.75, -9], [0, 0, 0], [2.2, 0.12, 0.08]);
        S.add(GEO.box, fenceW, [x + 1.1, 0.45, -9], [0, 0, 0], [2.2, 0.12, 0.08]);
      }
      const mush = m(0xe94848, 0.5), stemW = m(0xfff3e0, 0.7);
      for (let i = 0; i < 14; i++) {
        const x = rand(-half, half), z = rand(-8, -4);
        S.add(GEO.cyl, stemW, [x, 0.2, z], [0, 0, 0], [0.1, 0.4, 0.1]);
        S.add(GEO.hemi, mush, [x, 0.38, z], [0, 0, 0], [0.32, 0.22, 0.32]);
      }
    } else if (theme === 'savanna') {
      const acaciaLeaf = m(0x6aa83c, 0.85);
      for (let i = 0; i < 34; i++) {
        const x = rand(-half, half), z = zAny(), s = rand(0.9, 1.6);
        S.add(GEO.cylTaper, m(0x7a4a2c, 0.9), [x, 1.6 * s, z], [0, 0, rand(-0.2, 0.2)], [0.22 * s, 3.2 * s, 0.22 * s]);
        S.add(GEO.sphere, acaciaLeaf, [x, 3.3 * s, z], [0, 0, 0], [2.8 * s, 0.55 * s, 2.2 * s]);
        S.add(GEO.sphere, acaciaLeaf, [x + 1.2 * s, 3.0 * s, z], [0, 0, 0], [1.4 * s, 0.4 * s, 1.2 * s]);
      }
      const gold = m(0xd9b44a, 0.9), gold2 = m(0xc79a36, 0.9);
      for (let i = 0; i < 380; i++) tuft(rand(-half, half), R() < 0.15 ? rand(16, 30) : rand(-40, -3.2), rand(0.7, 1.4), R() < 0.5 ? gold : gold2);
      const orock = m(0xc98b5a, 0.9);
      for (let i = 0; i < 24; i++) S.add(GEO.sphere, orock, [rand(-half, half), 0.2, zFar()], [0, rand(0, 3), 0], [rand(0.6, 2), rand(0.4, 1.0), rand(0.6, 1.5)]);
      for (let i = 0; i < 70; i++) flower(rand(-half, half), rand(-25, -4), 0.8);
    } else if (theme === 'bamboo') {
      const bam = m(0x7fcf5a, 0.55), bam2 = m(0x5fb848, 0.55), ring = m(0x4c9a3c, 0.6), leaf = m(0x58b84a, 0.8);
      for (let i = 0; i < 110; i++) {
        const cx = rand(-half, half), cz = R() < 0.85 ? rand(-40, -6) : rand(24, 40);
        const n = 3 + Math.floor(R() * 4);
        for (let k = 0; k < n; k++) {
          const x = cx + rand(-1, 1), z = cz + rand(-1, 1), h = rand(6, 11), r = rand(0.12, 0.2);
          const mat = R() < 0.5 ? bam : bam2;
          S.add(GEO.cyl, mat, [x, h / 2, z], [rand(-0.04, 0.04), 0, rand(-0.04, 0.04)], [r, h, r]);
          for (let y = 1.2; y < h; y += 1.3) S.add(GEO.cyl, ring, [x, y, z], [0, 0, 0], [r * 1.15, 0.08, r * 1.15]);
          for (let j = 0; j < 4; j++) S.add(GEO.sphere, leaf, [x + rand(-0.8, 0.8), h - rand(0, 2.5), z + rand(-0.6, 0.6)], [0, rand(0, 3), 0.4], [0.7, 0.08, 0.22]);
        }
      }
      for (let i = 0; i < 40; i++) S.add(GEO.sphere, rock, [rand(-half, half), 0.25, rand(-20, -4)], [0, rand(0, 3), 0], [rand(0.5, 1.4), rand(0.4, 0.8), rand(0.5, 1.2)]);
      const pond = m(0x6fd0ff, 0.15);
      for (let i = 0; i < 6; i++) S.add(GEO.disc, pond, [rand(-half, half), 0.04, rand(-22, -8)], [-Math.PI / 2, 0, 0], [rand(2, 4), rand(1.5, 3), 1]);
      for (let i = 0; i < 150; i++) flower(rand(-half, half), rand(-25, -3.5), 0.7);
    } else if (theme === 'grassland') {
      const g1 = m(0x8fcf44, 0.9), g2 = m(0xb5d957, 0.9);
      for (let i = 0; i < 420; i++) tuft(rand(-half, half), R() < 0.15 ? rand(16, 30) : rand(-40, -3.2), rand(0.9, 1.7), R() < 0.5 ? g1 : g2);
      for (let i = 0; i < 18; i++) roundTree(rand(-half, half), zAny(), rand(0.9, 1.4));
      for (let i = 0; i < 14; i++) pine(rand(-half, half), zAny(), rand(1.0, 1.6));
      for (let i = 0; i < 260; i++) flower(rand(-half, half), rand(-30, -3.2), rand(0.8, 1.2));
      for (let i = 0; i < 18; i++) S.add(GEO.sphere, rock, [rand(-half, half), 0.3, zFar()], [0, rand(0, 3), 0], [rand(0.6, 1.8), rand(0.4, 0.9), rand(0.6, 1.4)]);
    } else if (theme === 'jungle') {
      const palmT = m(0xa0703f, 0.85), palmL = m(0x3fae48, 0.75), big = m(0x2f9a4a, 0.75), big2 = m(0x57c25a, 0.75);
      for (let i = 0; i < 46; i++) {
        const x = rand(-half, half), z = zAny(), s = rand(0.9, 1.5), lean = rand(-0.25, 0.25);
        for (let k = 0; k < 6; k++) S.add(GEO.cylTaper, palmT, [x + Math.sin(lean) * k * 0.9 * s, (0.5 + k * 0.9) * s, z], [0, 0, -lean], [0.3 * s * (1 - k * 0.07), 0.95 * s, 0.3 * s * (1 - k * 0.07)]);
        const tx = x + Math.sin(lean) * 5.4 * s, ty = 5.6 * s;
        for (let k = 0; k < 7; k++) {
          const a = k / 7 * TAU;
          S.add(GEO.sphere, palmL, [tx + Math.cos(a) * 1.4 * s, ty - 0.3 * s, z + Math.sin(a) * 1.4 * s], [0, -a, -0.45], [1.8 * s, 0.1 * s, 0.45 * s]);
        }
        S.add(GEO.sphere, m(0x8a5a2a, 0.7), [tx, ty - 0.2 * s, z], [0, 0, 0], [0.3 * s, 0.3 * s, 0.3 * s]);
      }
      for (let i = 0; i < 120; i++) {
        const x = rand(-half, half), z = R() < 0.8 ? rand(-30, -4) : rand(24, 40), s = rand(0.7, 1.5);
        for (let k = 0; k < 5; k++) {
          const a = k / 5 * TAU + R();
          S.add(GEO.sphere, R() < 0.5 ? big : big2, [x + Math.cos(a) * 0.7 * s, 0.6 * s, z + Math.sin(a) * 0.7 * s], [0, -a, -0.6], [0.9 * s, 0.1 * s, 0.4 * s]);
        }
      }
      const jf = [0xff4f8b, 0xff8a3d, 0xffd23f, 0xc05bff];
      for (let i = 0; i < 160; i++) {
        const x = rand(-half, half), z = rand(-25, -3.3);
        S.add(GEO.sphere, flowerHead, [x, 0.5, z], [0, 0, 0], [0.28, 0.16, 0.28], jf[Math.floor(R() * 4)]);
        S.add(GEO.cyl, stem, [x, 0.25, z], [0, 0, 0], [0.04, 0.5, 0.04]);
      }
    } else if (theme === 'snow') {
      const pine = m(0x2f8a5a, 0.85), cap = m(0xffffff, 0.6);
      for (let i = 0; i < 60; i++) {
        const x = rand(-half, half), z = zAny(), s = rand(0.9, 1.6);
        S.add(GEO.cyl, m(0x7a4a2c, 0.9), [x, 0.5 * s, z], [0, 0, 0], [0.2 * s, 1 * s, 0.2 * s]);
        for (let k = 0; k < 3; k++) {
          S.add(GEO.cone, pine, [x, (1.4 + k * 1.1) * s, z], [0, 0, 0], [(1.5 - k * 0.38) * s, 1.7 * s, (1.5 - k * 0.38) * s]);
          S.add(GEO.cone, cap, [x, (1.75 + k * 1.1) * s, z], [0, 0, 0], [(0.9 - k * 0.22) * s, 1.0 * s, (0.9 - k * 0.22) * s]);
        }
      }
      const wallCols = [0xff8a80, 0x80d8ff, 0xffe082, 0xb9f6ca, 0xd1c4e9], roofM = m(0xffffff, 0.6), win = m(0xffe48a, 0.4, { emissive: 0xffc94a, emissiveIntensity: 0.5 });
      const wall = m(0xffffff, 0.7);
      for (let i = 0; i < 14; i++) {
        const x = rand(-half, half), z = rand(-26, -11), s = rand(1, 1.4);
        S.add(GEO.box, wall, [x, 1.1 * s, z], [0, 0, 0], [3 * s, 2.2 * s, 2.6 * s], wallCols[i % 5]);
        S.add(GEO.prism, roofM, [x, 2.75 * s, z], [0, 0, 0], [3.5 * s, 1.2 * s, 3.0 * s]);
        S.add(GEO.box, win, [x - 0.7 * s, 1.3 * s, z + 1.31 * s], [0, 0, 0], [0.6 * s, 0.6 * s, 0.05]);
        S.add(GEO.box, win, [x + 0.7 * s, 1.3 * s, z + 1.31 * s], [0, 0, 0], [0.6 * s, 0.6 * s, 0.05]);
        S.add(GEO.box, m(0x8d5a36, 0.8), [x, 0.6 * s, z + 1.31 * s], [0, 0, 0], [0.6 * s, 1.2 * s, 0.05]);
      }
      const ice = m(0xe8f6ff, 0.35);
      for (let i = 0; i < 8; i++) S.add(GEO.hemi, ice, [rand(-half, half), 0, rand(-20, -7)], [0, 0, 0], [1.8, 1.5, 1.8]);
      for (let i = 0; i < 40; i++) S.add(GEO.sphere, cap, [rand(-half, half), 0, R() < 0.85 ? rand(-35, -4) : rand(16, 26)], [0, 0, 0], [rand(0.8, 2.5), rand(0.4, 0.9), rand(0.8, 2)]);
      // friendly snowmen
      const coal = m(0x222222, 0.5), carrot = m(0xff8a1f, 0.6), scarf = m(0xe53935, 0.7);
      for (let i = 0; i < 6; i++) {
        const x = rand(-half, half), z = rand(-12, -5);
        S.add(GEO.sphere, cap, [x, 0.6, z], [0, 0, 0], [0.7, 0.65, 0.7]);
        S.add(GEO.sphere, cap, [x, 1.45, z], [0, 0, 0], [0.5, 0.48, 0.5]);
        S.add(GEO.sphere, cap, [x, 2.1, z], [0, 0, 0], [0.36, 0.36, 0.36]);
        S.add(GEO.cone, carrot, [x, 2.1, z + 0.45], [Math.PI / 2, 0, 0], [0.07, 0.35, 0.07]);
        S.add(GEO.sphere, coal, [x - 0.12, 2.2, z + 0.32], [0, 0, 0], [0.05, 0.05, 0.05]);
        S.add(GEO.sphere, coal, [x + 0.12, 2.2, z + 0.32], [0, 0, 0], [0.05, 0.05, 0.05]);
        S.add(GEO.cyl, scarf, [x, 1.82, z], [0, 0, 0], [0.4, 0.12, 0.4]);
      }
    }
    const tile = new THREE.Group();
    tile.add(S.build(false));
    tile.add(H.build(false));
    const a = tile, b = tile.clone();
    const g = new THREE.Group();
    g.add(a, b);
    g.visible = false;
    this.scene.add(g);
    return { g, a, b };
  }

  buildClouds() {
    const S = new Scatter();
    const c = m(0xffffff, 1, { emissive: 0xffffff, emissiveIntensity: 0.15 });
    const R = rng(42);
    for (let i = 0; i < 26; i++) {
      const x = (i / 26) * 600 - 300, y = 32 + R() * 26, z = -120 - R() * 120, s = 4 + R() * 5;
      for (let k = 0; k < 5; k++) S.add(GEO.sphere, c, [x + (k - 2) * s * 0.7, y + (k % 2) * s * 0.35, z + R() * 3], [0, 0, 0], [s * (0.8 + R() * 0.5), s * 0.65, s * 0.7]);
    }
    this.clouds = S.build(false);
    this.cloudMat = c;
    this.scene.add(this.clouds);
  }

  // ------------------------------------------------------------- stations
  station(key, name, roofColor = 0xe53935) {
    if (this.stations[key]) return this.stations[key];
    const g = new THREE.Group();
    const cream = m(0xfff3dc, 0.8), red = m(roofColor, 0.5), yellow = m(0xffc928, 0.5), blue = m(0x2f7de1, 0.5), wood = m(0xb07a4a, 0.8);
    const add = (geo, mat, p, s, r = [0, 0, 0]) => { const x = new THREE.Mesh(geo, mat); x.position.set(...p); x.scale.set(...s); x.rotation.set(...r); x.castShadow = x.receiveShadow = true; g.add(x); return x; };
    // platform on the camera side of the track
    add(GEO.box, m(0xe8d9bf, 0.9), [0, 0.22, 2.75], [12, 0.44, 2.3]);
    add(GEO.box, yellow, [0, 0.45, 1.68], [12, 0.06, 0.16]);
    // little station house behind the track
    add(GEO.box, cream, [0, 1.6, -5.2], [6, 3.2, 3.2]);
    add(GEO.prism, red, [0, 3.9, -5.2], [7, 1.6, 4]);
    add(GEO.box, blue, [0, 1.0, -3.58], [1.1, 2.0, 0.1]);
    for (const x of [-1.8, 1.8]) {
      add(GEO.box, m(0x9fdcff, 0.2, { emissive: 0x2a5a8a, emissiveIntensity: 0.15 }), [x, 1.8, -3.58], [1.0, 0.9, 0.08]);
      add(GEO.box, yellow, [x, 1.8, -3.55], [1.15, 0.12, 0.1]);
    }
    // sign
    const tex = textTexture(name);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.6), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    sign.position.set(0, 5.4, -3.55);
    g.add(sign);
    for (const x of [-2.4, 2.4]) add(GEO.cyl, wood, [x, 4.6, -3.65], [0.08, 1.6, 0.08]);
    // bench + lamp posts
    add(GEO.box, wood, [-3.4, 0.75, 3.4], [2.0, 0.12, 0.6]);
    add(GEO.box, wood, [-3.4, 1.05, 3.7], [2.0, 0.5, 0.1]);
    for (const x of [-5.7]) {
      add(GEO.cyl, m(0x2b2f45, 0.4), [x, 1.5, 3.7], [0.07, 2.2, 0.07]);
      add(GEO.sphere, m(0xfff2a8, 0.2, { emissive: 0xffd24a, emissiveIntensity: 0.6 }), [x, 2.75, 3.7], [0.22, 0.22, 0.22]);
    }
    // flower boxes on the platform edge
    for (const x of [-1.5, 4.8]) {
      add(GEO.box, m(0xb07a4a, 0.8), [x, 0.6, 3.75], [1.2, 0.3, 0.35]);
      for (let k = 0; k < 4; k++) add(GEO.sphere, m([0xff5d8f, 0xffd23f, 0xffffff, 0xb57bff][k], 0.6), [x - 0.45 + k * 0.3, 0.85, 3.75], [0.13, 0.1, 0.13]);
    }
    mergeStatic(g);
    g.visible = false;
    this.scene.add(g);
    this.stations[key] = g;
    return g;
  }

  // ------------------------------------------------------------- bushes
  buildBushes() {
    this.bushes = [];
    this.bushMat = m(0x47b04b, 0.85);
    this.bushMat2 = m(0x5cc45a, 0.85);
    this.berryMat = m(0xff5d8f, 0.5);
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const inner = new THREE.Group();
      g.add(inner);
      const R = rng(100 + i);
      const parts = [[0, 1.0, 0, 1.45], [-1.1, 0.75, 0.2, 1.05], [1.1, 0.8, 0.1, 1.1], [0, 1.9, -0.1, 1.0], [-0.6, 1.6, 0.4, 0.8], [0.7, 1.6, 0.35, 0.85]];
      for (const [x, y, z, r] of parts) {
        const s = new THREE.Mesh(GEO.sphereHi, R() < 0.5 ? this.bushMat : this.bushMat2);
        s.position.set(x, y, z); s.scale.set(r, r * 0.9, r);
        s.castShadow = s.receiveShadow = true;
        inner.add(s);
      }
      for (let k = 0; k < 7; k++) {
        const b = new THREE.Mesh(GEO.sphere, this.berryMat);
        const a = R() * Math.PI - Math.PI / 2;
        b.position.set(Math.sin(a) * 1.3, 0.6 + R() * 1.5, 0.9 + R() * 0.4);
        b.scale.setScalar(0.12);
        inner.add(b);
      }
      mergeStatic(inner);
      g.visible = false;
      this.scene.add(g);
      this.bushes.push({ g, inner });
    }
  }

  setBushStyle(theme) {
    const c = { meadow: [0x47b04b, 0x5cc45a, 0xff5d8f], savanna: [0x7da83c, 0x92b84a, 0xffd23f], bamboo: [0x3f9d4a, 0x56b85a, 0xffffff],
      grassland: [0x5fb83e, 0x7ccc4e, 0xffd23f], jungle: [0x2f9a4a, 0x3fae48, 0xff4f8b], snow: [0xffffff, 0xe8f2ff, 0x7fd4ff] }[theme] || [0x47b04b, 0x5cc45a, 0xff5d8f];
    this.bushMat.color.setHex(c[0]); this.bushMat2.color.setHex(c[1]); this.berryMat.color.setHex(c[2]);
  }

  // ------------------------------------------------------------- effects
  buildFx() {
    const heart = new THREE.Shape();
    heart.moveTo(0, -0.5);
    heart.bezierCurveTo(-0.15, -0.35, -0.6, -0.1, -0.6, 0.25);
    heart.bezierCurveTo(-0.6, 0.55, -0.25, 0.65, 0, 0.38);
    heart.bezierCurveTo(0.25, 0.65, 0.6, 0.55, 0.6, 0.25);
    heart.bezierCurveTo(0.6, -0.1, 0.15, -0.35, 0, -0.5);
    const hg = new THREE.ExtrudeGeometry(heart, { depth: 0.18, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 3 });
    hg.center();
    this.hearts = [];
    for (let i = 0; i < 10; i++) {
      const h = new THREE.Mesh(hg, m(i % 3 ? 0xff4f7b : 0xff8fb0, 0.35, { emissive: 0xff2050, emissiveIntensity: 0.25, transparent: true }));
      h.visible = false;
      this.scene.add(h);
      this.hearts.push(h);
    }
    const cg = new THREE.PlaneGeometry(0.16, 0.24);
    const cols = [0xff5d8f, 0xffd23f, 0x4fc3f7, 0x81c784, 0xba68c8, 0xff8a3d];
    this.confetti = [];
    for (let i = 0; i < 90; i++) {
      const c = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide, roughness: 0.6 }));
      c.visible = false;
      this.scene.add(c);
      this.confetti.push(c);
    }
    this.rings = [];
    for (let i = 0; i < 4; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
      r.visible = false;
      this.scene.add(r);
      this.rings.push(r);
    }
    this.notes = [];
    const noteTex = textTexture('♪', { w: 256, h: 256, bg: 'rgba(0,0,0,0)', border: 'rgba(0,0,0,0)', fg: '#ffffff', size: 200 });
    const zTex = textTexture('Z', { w: 256, h: 256, bg: 'rgba(0,0,0,0)', border: 'rgba(0,0,0,0)', fg: '#5b6bd8', size: 200 });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTex, color: cols[i], transparent: true, depthWrite: false }));
      s.visible = false;
      this.scene.add(s);
      this.notes.push(s);
    }
    this.zz = [];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTex, transparent: true, depthWrite: false }));
      s.visible = false;
      this.scene.add(s);
      this.zz.push(s);
    }
    // snowflakes
    const sg = new THREE.BufferGeometry();
    const N = 1500, p = new Float32Array(N * 3);
    const R = rng(9);
    for (let i = 0; i < N; i++) { p[i * 3] = R() * 120 - 60; p[i * 3 + 1] = R() * 30; p[i * 3 + 2] = R() * 70 - 50; }
    sg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.snowBase = p.slice();
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, transparent: true, opacity: 0.9 }));
    this.snow.visible = false;
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
  }

  buildBalloons() {
    this.balloons = [];
    const cols = [0xe53935, 0xfb8c00, 0xfdd835, 0x43a047, 0x1e88e5, 0x8e24aa, 0xec407a, 0x00acc1, 0xff7043, 0x7cb342];
    const stringM = m(0xffffff, 0.6);
    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(GEO.sphereHi, m(cols[i], 0.25, { metalness: 0.05 }));
      b.scale.set(0.75, 0.9, 0.75);
      b.castShadow = true;
      const knot = new THREE.Mesh(GEO.cone, m(cols[i], 0.3));
      knot.scale.set(0.12, 0.18, 0.12); knot.position.y = -0.95;
      const str = new THREE.Mesh(GEO.cyl, stringM);
      str.scale.set(0.012, 2.4, 0.012); str.position.y = -2.2;
      const hl = new THREE.Mesh(GEO.sphere, m(0xffffff, 0.1, { emissive: 0xffffff, emissiveIntensity: 0.5 }));
      hl.scale.set(0.12, 0.18, 0.06); hl.position.set(0.32, 0.38, 0.6);
      g.add(b, knot, str, hl);
      g.visible = false;
      this.scene.add(g);
      this.balloons.push(g);
    }
  }

  buildBunting() {
    const g = new THREE.Group();
    const cols = [0xe53935, 0xfdd835, 0x43a047, 0xfb8c00, 0x8e24aa, 0x1e88e5];
    const tri = new THREE.ConeGeometry(0.35, 0.6, 3);
    for (let i = 0; i < 24; i++) {
      const x = -12 + i;
      const y = 4.4 - Math.sin(i / 23 * Math.PI) * 0.8;
      const f = new THREE.Mesh(tri, m(cols[i % 6], 0.6));
      f.rotation.x = Math.PI; f.scale.z = 0.2;
      f.position.set(x, y, -3.4);
      g.add(f);
    }
    g.visible = false;
    this.bunting = g;
    this.scene.add(g);
  }

  // ------------------------------------------------------------- per frame
  setTheme(theme) {
    if (this.theme === theme) return;
    this.theme = theme;
    const T = THEMES[theme];
    const tileKey = { home: 'meadow', learning: 'meadow' }[theme] || theme;
    for (const [k, v] of Object.entries(this.tiles)) v.g.visible = k === tileKey;
    this.groundMat.color.setHex(T.ground);
    this.trackMats.bed.color.setHex(theme === 'snow' ? 0xdfe6f2 : 0xc9b79a);
    this.snow.visible = theme === 'snow';
    this.setBushStyle(tileKey);
  }

  /** env state: { t, focusX, theme, tod: name, todK: 0..1 blend from day } */
  update(s) {
    this.setTheme(s.theme);
    const T = THEMES[s.theme];
    const tod = TOD[s.tod || 'day'];
    const k = s.tod && s.tod !== 'day' ? clamp(s.todK ?? 1) : 0;
    const top = new THREE.Color(T.skyTop), hor = new THREE.Color(T.skyHor);
    if (k > 0) { top.lerp(new THREE.Color(tod.skyTop), k); hor.lerp(new THREE.Color(tod.skyHor), k); }
    this.paintSky(top, hor);
    const elev = lerp(0.95, tod.elev, k);
    const fx = s.focusX || 0;
    const sunDir = new THREE.Vector3(0.35, Math.sin(elev * 1.2), -0.9).normalize();
    if (k > 0) sunDir.set(0.25, Math.max(0.03, Math.sin(elev)), -1).normalize();
    const sunCol = new THREE.Color(T.sun);
    if (k > 0 && tod.sunCol) sunCol.lerp(new THREE.Color(tod.sunCol), k);
    this.sky.position.set(fx, 0, 0);
    this.sunDisc.position.set(fx + sunDir.x * 1200, sunDir.y * 1200, sunDir.z * 1200);
    this.sunDisc.material.color.copy(sunCol).lerp(new THREE.Color(0xffffff), 0.4 * (1 - k));
    this.sunDisc.visible = sunDir.y > -0.02;
    this.sunGlow.position.copy(this.sunDisc.position).multiplyScalar(0.98);
    this.sunGlow.material.color.copy(sunCol);
    this.sunGlow.material.opacity = 0.55 + 0.4 * k;
    this.sunGlow.visible = this.sunDisc.visible;
    // key light from the front-right so faces (toward +Z / +X) are well lit
    this.sun.color.copy(sunCol);
    this.sun.intensity = lerp(2.6, tod.sunI, k);
    const lightDir = new THREE.Vector3(0.45, lerp(1.0, 0.55, k), 0.75).normalize();
    this.sun.position.set(fx + lightDir.x * 60, lightDir.y * 60, lightDir.z * 60);
    this.sun.target.position.set(fx, 0, 2);
    this.hemi.intensity = lerp(1.15, tod.hemiI, k);
    this.hemi.color.copy(new THREE.Color(0xdff2ff).lerp(hor, 0.3));
    this.hemi.groundColor.setHex(T.ground).multiplyScalar(0.6);
    this.scene.fog.color.copy(hor);
    this.scene.fog.density = T.fogD;
    this.cloudMat.emissiveIntensity = 0.15 + 0.2 * k;
    this.cloudMat.color.copy(new THREE.Color(0xffffff).lerp(new THREE.Color(0xffd0c0), k * 0.6));
    // tiles follow the focus
    const tileKey = { home: 'meadow', learning: 'meadow' }[s.theme] || s.theme;
    const tl = this.tiles[tileKey];
    const kk = Math.floor((fx + TILE / 2) / TILE);
    const base = kk * TILE;
    const off = fx - base;
    tl.a.position.x = base;
    tl.b.position.x = base + (off > 0 ? TILE : -TILE);
    this.clouds.position.x = fx * 0.85 - ((s.t * 1.5) % 600) + 300 * Math.floor((fx * 0.15 + s.t * 1.5) / 600);
    // snow fall
    if (this.snow.visible) {
      const p = this.snow.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const b = this.snowBase;
        p.array[i * 3] = fx + ((b[i * 3] + Math.sin(s.t * 0.7 + i) * 0.6 - fx * 0 + 600) % 120) - 60;
        p.array[i * 3 + 1] = (b[i * 3 + 1] - s.t * 1.2 * (0.6 + (i % 5) * 0.12)) % 30;
        if (p.array[i * 3 + 1] < 0) p.array[i * 3 + 1] += 30;
        p.array[i * 3 + 2] = b[i * 3 + 2];
      }
      p.needsUpdate = true;
    }
  }

  hideFx() {
    for (const h of this.hearts) h.visible = false;
    for (const c of this.confetti) c.visible = false;
    for (const r of this.rings) r.visible = false;
    for (const n of this.notes) n.visible = false;
    for (const z of this.zz) z.visible = false;
    for (const b of this.balloons) b.visible = false;
    for (const b of this.bushes) b.g.visible = false;
    for (const st of Object.values(this.stations)) st.visible = false;
    this.bunting.visible = false;
  }

  heartsAt(t, t0, pos, n = 6) {
    const age = t - t0;
    for (let i = 0; i < this.hearts.length; i++) {
      const h = this.hearts[i];
      const a = age - i * 0.25;
      if (i >= n || a < 0 || a > 2.6) { if (i < n) h.visible = false; continue; }
      h.visible = true;
      h.position.set(pos.x + Math.sin(i * 2.3 + a * 2) * 0.8, pos.y + a * 1.2, pos.z + 0.3 + Math.cos(i) * 0.3);
      const s = 0.45 * Math.min(1, a * 4) * (1 + 0.1 * Math.sin(a * 10));
      h.scale.setScalar(s);
      h.rotation.y = Math.sin(a * 3 + i) * 0.4;
      h.material.opacity = 1 - clamp((a - 1.8) / 0.8);
    }
  }

  confettiAt(t, t0, center, dur = 5) {
    const age = t - t0;
    for (let i = 0; i < this.confetti.length; i++) {
      const c = this.confetti[i];
      if (age < 0 || age > dur) { c.visible = false; continue; }
      c.visible = true;
      const a = hash(i) * TAU, r = 1 + hash(i + 3) * 7;
      const vy = 6 + hash(i + 5) * 4;
      const y = 2 + vy * Math.min(age, 0.6) - Math.max(0, age - 0.6) * 1.6;
      c.position.set(center.x + Math.cos(a) * r * Math.min(1, age * 2) + Math.sin(age * 3 + i) * 0.3, Math.max(0.05, y), center.z + Math.sin(a) * r * 0.5);
      c.rotation.set(age * 5 + i, age * 4 + i * 2, age * 3);
    }
  }

  ringsAt(t, active, pos) {
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (!active) { r.visible = false; continue; }
      const k = ((t * 1.2 + i / this.rings.length) % 1);
      r.visible = true;
      r.position.copy(pos);
      r.scale.setScalar(0.6 + k * 2.6);
      r.material.opacity = 0.75 * (1 - k);
      r.lookAt(pos.x, pos.y, pos.z + 10);
    }
  }

  notesAt(t, on, pos) {
    for (let i = 0; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (!on) { n.visible = false; continue; }
      const k = ((t * 0.5 + i / this.notes.length) % 1);
      n.visible = true;
      n.position.set(pos.x + Math.sin(k * 6 + i) * 0.8 - k * 1.5, pos.y + k * 3, pos.z + (i % 2) * 0.5);
      n.scale.setScalar(0.7 * Math.sin(k * Math.PI) + 0.1);
      n.material.opacity = Math.sin(k * Math.PI);
    }
  }

  zzzAt(t, on, pos) {
    for (let i = 0; i < 3; i++) {
      const z = this.zz[i];
      if (!on) { z.visible = false; continue; }
      const k = ((t * 0.4 + i / 3) % 1);
      z.visible = true;
      z.position.set(pos.x + k * 1.2, pos.y + k * 2.2, pos.z + Math.sin(k * 6) * 0.3);
      z.scale.setScalar(0.4 + k * 0.6);
      z.material.opacity = Math.sin(k * Math.PI);
    }
  }
}
