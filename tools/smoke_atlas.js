/*
 * Paints assets/tex/smoke.png: four billowy, cauliflower-edged smoke puffs in a 2×2 sheet.
 *   R/G/B = how lit the puff is (thin wisps and upper edges catch the light, the dense core is in its own shadow)
 *   A     = density
 * To regenerate: open the game, paste this file into the browser console, then save the image it opens.
 */
(() => {
  const T = 256, N = T * 2;
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(N, N);
  // value noise + fbm (seeded, so every run paints the same puffs)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const P = new Float32Array(256 * 256).map(rnd);
  const vn = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const g = (a, b) => P[((yi + b) & 255) * 256 + ((xi + a) & 255)];
    return (g(0, 0) * (1 - u) + g(1, 0) * u) * (1 - v) + (g(0, 1) * (1 - u) + g(1, 1) * u) * v;
  };
  const fbm = (x, y) => { let s = 0, a = 0.5, f = 1; for (let o = 0; o < 5; o++) { s += vn(x * f, y * f) * a; f *= 2.03; a *= 0.5; } return s; };
  const D = new Float32Array(T * T);
  for (let t = 0; t < 4; t++) {
    // a cluster of overlapping billows makes the silhouette
    const blobs = [];
    for (let b = 0; b < 9; b++) {
      const a = rnd() * Math.PI * 2, r = b ? 0.08 + rnd() * 0.17 : 0;
      blobs.push([Math.cos(a) * r, Math.sin(a) * r, b ? 0.12 + rnd() * 0.1 : 0.22]);
    }
    const ox = rnd() * 100, oy = rnd() * 100;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const px = x / T - 0.5, py = y / T - 0.5;
      let d = 0;
      for (const [bx, by, br] of blobs) { const q = ((px - bx) ** 2 + (py - by) ** 2) / (br * br); d += Math.exp(-q * 1.6); }
      // eroded by turbulence: soft at the rims, lumpy inside
      const n = fbm(px * 6 + ox, py * 6 + oy);
      d = Math.max(0, d * (0.55 + 0.9 * n) - 0.35);
      const rr = Math.hypot(px, py) * 2;
      d *= Math.max(0, 1 - rr * rr) ** 1.5; // nothing reaches the tile's edge
      D[y * T + x] = Math.min(1, d * 1.3);
    }
    const tx = (t & 1) * T, ty = (t >> 1) * T;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const d = D[y * T + x];
      // light from above: denser material above a pixel shades it
      let occ = 0;
      for (let k = 1; k <= 6; k++) occ += D[Math.max(0, y - k * 4) * T + x];
      const lit = Math.max(0, Math.min(1, 1.05 - occ * 0.16 - d * 0.35));
      const o = ((ty + y) * N + tx + x) * 4;
      img.data[o] = lit * 255; img.data[o + 1] = lit * 255; img.data[o + 2] = lit * 255; img.data[o + 3] = d * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  cv.toBlob((b) => window.open(URL.createObjectURL(b)), 'image/png');
})();
