// Draw-call optimiser: inside every group, child meshes that never move on
// their own and share a material are baked into one mesh.  Mark a mesh with
// userData.keep = true to leave it alone (animated / toggled individually).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mergeStatic(root) {
  const groups = [];
  root.traverse((o) => { if (!o.isMesh || o.children.length) groups.push(o); });
  let saved = 0;
  for (const g of groups) {
    const buckets = new Map();
    for (const c of g.children) {
      if (!c.isMesh || c.isInstancedMesh || c.isSkinnedMesh || c.children.length || c.userData.keep || !c.visible) continue;
      if (Array.isArray(c.material)) continue;
      const geo = c.geometry;
      const key = c.material.uuid + (geo.index ? ':i' : ':n') + ':' + Object.keys(geo.attributes).sort().join(',') + (c.castShadow ? ':s' : '');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(c);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const geos = list.map((m) => { m.updateMatrix(); return m.geometry.clone().applyMatrix4(m.matrix); });
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.castShadow = list[0].castShadow;
      mesh.receiveShadow = list.some((m) => m.receiveShadow);
      for (const m of list) g.remove(m);
      g.add(mesh);
      saved += list.length - 1;
    }
  }
  return saved;
}
