// Export the current city (ground, streets, buildings) as a .glb for use in a game engine.

import { world } from '../world/scene.js';
import { withEditable } from '../world/optimizer.js';

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function exportGLB() {
  if (!world.cityRoot || !world.cityRoot.children.length) throw new Error('Generate a city first.');
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');

  // Export the editable per-building objects (named nodes), not the merged render chunks.
  const buffer = await withEditable(() => new Promise((resolve, reject) => {
    new GLTFExporter().parse(world.cityRoot, resolve, reject, { binary: true, onlyVisible: true });
  }));
  download(new Blob([buffer], { type: 'model/gltf-binary' }), 'city.glb');
}
