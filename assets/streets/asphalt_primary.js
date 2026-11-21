// Primary road texture: dark asphalt, white edge lines, dashed yellow center line.
// Texture contract: u across the road width (0..1), v along it. One tile = meta tileLength meters.

export const meta = { id: 'asphalt_primary', name: 'Primary Road' };

export function makeTexture(THREE) {
  const W = 256, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  g.fillStyle = '#38383b';
  g.fillRect(0, 0, W, H);

  // Asphalt grain.
  for (let i = 0; i < 9000; i++) {
    const v = 40 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v},${v},0.35)`;
    g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
  }

  // Solid white edge lines.
  g.fillStyle = '#e8e8e8';
  g.fillRect(12, 0, 6, H);
  g.fillRect(W - 18, 0, 6, H);

  // Dashed yellow center line (two dashes per tile).
  g.fillStyle = '#e6b800';
  for (let y = 20; y < H; y += 256) g.fillRect(W / 2 - 3, y, 6, 130);

  const tex = new THREE.CanvasTexture(c);
  return tex;
}
