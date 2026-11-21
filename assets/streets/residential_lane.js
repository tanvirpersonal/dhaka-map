// Residential lane texture: worn grey asphalt with patches and faint edge wear, no markings.

export const meta = { id: 'residential_lane', name: 'Residential Lane' };

export function makeTexture(THREE) {
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  g.fillStyle = '#5a5a5e';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 7000; i++) {
    const v = 70 + Math.random() * 50;
    g.fillStyle = `rgba(${v},${v},${v},0.3)`;
    g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
  }

  // Repair patches.
  for (let i = 0; i < 5; i++) {
    g.fillStyle = 'rgba(40,40,44,0.35)';
    g.fillRect(20 + Math.random() * (W - 80), Math.random() * H, 30 + Math.random() * 40, 14 + Math.random() * 20);
  }

  // Dusty edges.
  const edge = g.createLinearGradient(0, 0, W, 0);
  edge.addColorStop(0, 'rgba(150,135,110,0.45)');
  edge.addColorStop(0.12, 'rgba(150,135,110,0)');
  edge.addColorStop(0.88, 'rgba(150,135,110,0)');
  edge.addColorStop(1, 'rgba(150,135,110,0.45)');
  g.fillStyle = edge;
  g.fillRect(0, 0, W, H);

  return new THREE.CanvasTexture(c);
}
