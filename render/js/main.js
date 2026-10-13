// Boots the scene and exposes window.renderAt(t) -> JPEG (base64) for the
// headless renderer, plus a live preview (?t=SECONDS or ?play=1).
import * as THREE from 'three';
import { Director } from './director.js';
import { World } from './env.js';

const q = new URLSearchParams(location.search);
const W = +(q.get('w') || 1920), H = Math.round(W * 9 / 16);

async function boot() {
  const font = new FontFace('Fredoka', 'url(/assets/fonts/Fredoka-700.ttf)', { weight: '700' });
  document.fonts.add(await font.load());
  const tl = await (await fetch(q.get('timeline') || '/build/timeline.json')).json();

  const renderer = new THREE.WebGLRenderer({ antialias: q.get('aa') === '1', preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 3000);
  scene.add(camera);
  const world = new World(scene, renderer);
  const director = new Director(scene, world, camera, tl);

  // full-screen fade card that lives in front of the camera
  const fadeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
  const fade = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), fadeMat);
  fade.position.z = -0.5;
  fade.renderOrder = 999;
  camera.add(fade);

  const lineup = q.get('lineup');
  const draw = (t) => {
    if (lineup) return drawLineup(t);
    director.apply(t);
    fadeMat.opacity = director.fadeAlpha;
    fadeMat.color.copy(director.fadeColor);
    fade.visible = director.fadeAlpha > 0.001;
    renderer.render(scene, camera);
  };
  function drawLineup(t) {
    // ?lineup=adults|babies|friends : every character in a row for design review
    director.apply(1400);
    for (const a of director.all) a.root.visible = false;
    director.train.group.visible = false;
    const groups = { adults: Object.values(director.mommy), babies: Object.values(director.babies), friends: Object.values(director.friends) };
    const list = groups[lineup] || groups.adults;
    const n = list.length, sp = lineup === 'friends' ? 3.2 : 3.6;
    list.forEach((a, i) => a.update({ t, visible: true, x: (i - (n - 1) / 2) * sp, z: 6, yaw: 0.35, mood: 0.9, open: i % 3 === 0 ? 0.5 : 0 }));
    camera.position.set(0, 3.0, 6 + (n * sp + 2) / 1.2); camera.lookAt(0, 1.2, 6);
    camera.fov = 38; camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    director.train.group.visible = true;
  }
  const quality = +(q.get('jpeg') || 0.93);
  window.renderAt = (t) => {
    draw(t);
    return new Promise((res) => renderer.domElement.toBlob((b) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result.split(',')[1]);
      fr.readAsDataURL(b);
    }, 'image/jpeg', quality));
  };
  window.timeline = tl;
  window.__dbg = { renderer, scene, world, director, camera, draw };
  if (q.get('play')) {
    const t0 = performance.now() / 1000 - (+q.get('t') || 0);
    const loop = () => { draw(performance.now() / 1000 - t0); requestAnimationFrame(loop); };
    loop();
  } else draw(+(q.get('t') || 0));
  window.ready = true;
}
boot().catch((e) => { console.error(e.stack || e); window.bootError = String(e.stack || e); });
