// Dirt track texture: packed earth with twin wheel ruts and pebbles.

export const meta = { id: 'dirt_track', name: 'Dirt Track' };

export function makeTexture(THREE) {
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  g.fillStyle = '#8a7352';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 6000; i++) {
    const t = Math.random();
    g.fillStyle = t > 0.5 ? 'rgba(110,90,62,0.4)' : 'rgba(170,150,115,0.35)';
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }

  // Wheel ruts.
  g.fillStyle = 'rgba(70,55,38,0.45)';
  g.fillRect(W * 0.28 - 9, 0, 18, H);
  g.fillRect(W * 0.72 - 9, 0, 18, H);

  // Pebbles.
  for (let i = 0; i < 60; i++) {
    g.fillStyle = 'rgba(130,125,115,0.8)';
    g.beginPath();
    g.arc(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 0, Math.PI * 2);
    g.fill();
  }

  return new THREE.CanvasTexture(c);
}
