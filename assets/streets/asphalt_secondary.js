// Secondary road texture: medium asphalt, thin white edge lines, dashed white center line.

export const meta = { id: 'asphalt_secondary', name: 'Secondary Road' };

export function makeTexture(THREE) {
  const W = 256, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  g.fillStyle = '#48484c';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 8000; i++) {
    const v = 55 + Math.random() * 45;
    g.fillStyle = `rgba(${v},${v},${v},0.35)`;
    g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
  }

  g.fillStyle = '#d8d8d8';
  g.fillRect(14, 0, 4, H);
  g.fillRect(W - 18, 0, 4, H);
  for (let y = 30; y < H; y += 256) g.fillRect(W / 2 - 2, y, 4, 100);

  return new THREE.CanvasTexture(c);
}
