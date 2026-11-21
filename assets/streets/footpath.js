// Footpath texture: paving slabs with grout lines.

export const meta = { id: 'footpath', name: 'Footpath' };

export function makeTexture(THREE) {
  const W = 128, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  g.fillStyle = '#b9ae9a';
  g.fillRect(0, 0, W, H);

  // 2 x 4 slabs per tile with slight tone variation.
  const cols = 2, rows = 4;
  const sw = W / cols, sh = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const t = 170 + Math.floor(Math.random() * 30);
      g.fillStyle = `rgb(${t},${t - 8},${t - 22})`;
      g.fillRect(col * sw + 1.5, r * sh + 1.5, sw - 3, sh - 3);
    }
  }
  g.strokeStyle = '#8a8070';
  g.lineWidth = 2;
  for (let r = 0; r <= rows; r++) { g.beginPath(); g.moveTo(0, r * sh); g.lineTo(W, r * sh); g.stroke(); }
  for (let col = 0; col <= cols; col++) { g.beginPath(); g.moveTo(col * sw, 0); g.lineTo(col * sw, H); g.stroke(); }

  return new THREE.CanvasTexture(c);
}
