// Background removal of an uploaded photo, entirely in the browser (no server, no account, no fee):
// ONNX Runtime Web (MIT, vendor/ort) runs the "silueta" salient-object model (U²-Net family, models/silueta.onnx, 44 MB).
// The model is fetched once on first use and then cached by the browser. Nothing is uploaded anywhere.
const SIZE = 320, MAX_SIDE = 2000;

let sessionPromise = null;
function getSession(onStatus) {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      onStatus?.('A modell betöltése (egyszeri, ~44 MB)…');
      const ort = await import('../vendor/ort/ort.wasm.min.mjs');
      ort.env.wasm.wasmPaths = new URL('../vendor/ort/', import.meta.url).href;
      ort.env.wasm.numThreads = 1; // multi-threading needs cross-origin isolation, which static hosting does not give
      const res = await fetch(new URL('../models/silueta.onnx', import.meta.url));
      if (!res.ok) throw new Error('A modell nem tölthető le (HTTP ' + res.status + ')');
      const session = await ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), { executionProviders: ['wasm'] });
      return { ort, session };
    })().catch(e => { sessionPromise = null; throw e; });
  }
  return sessionPromise;
}

function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/** Runs the model; returns { w, h, mask: Uint8ClampedArray (0-255 per pixel at the working size), src: canvas of the (scaled) photo }. */
export async function segment(img, { onStatus } = {}) {
  const { ort, session } = await getSession(onStatus);
  onStatus?.('Háttér keresése…');
  const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const src = canvasOf(w, h); src.getContext('2d').drawImage(img, 0, 0, w, h);
  const small = canvasOf(SIZE, SIZE), sg = small.getContext('2d');
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(src, 0, 0, SIZE, SIZE);
  const px = sg.getImageData(0, 0, SIZE, SIZE).data, n = SIZE * SIZE, input = new Float32Array(3 * n);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) input[c * n + i] = (px[i * 4 + c] / 255 - mean[c]) / std[c];
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const o = out[session.outputNames[0]].data;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { if (o[i] < lo) lo = o[i]; if (o[i] > hi) hi = o[i]; }
  const mc = canvasOf(SIZE, SIZE), mg = mc.getContext('2d'), md = mg.createImageData(SIZE, SIZE);
  for (let i = 0; i < n; i++) { const v = Math.round(((o[i] - lo) / (hi - lo || 1)) * 255); md.data[i * 4] = md.data[i * 4 + 1] = md.data[i * 4 + 2] = 255; md.data[i * 4 + 3] = v; }
  mg.putImageData(md, 0, 0);
  const big = canvasOf(w, h), bg = big.getContext('2d');
  bg.imageSmoothingQuality = 'high';
  bg.drawImage(mc, 0, 0, w, h); // bilinear upscale of the mask
  const a = bg.getImageData(0, 0, w, h).data, mask = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = a[i * 4 + 3];
  return { w, h, mask, src };
}

/** Cuts the photo out with the mask. cut 0..100: higher = stricter (removes more of the soft edge). Returns a canvas with alpha. */
export function compose({ w, h, mask, src }, cut = 50) {
  const out = canvasOf(w, h), g = out.getContext('2d');
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  const mid = 0.25 + 0.5 * (cut / 100) , soft = 0.16; // the mask value that becomes half transparent; width of the soft edge
  const a0 = mid - soft, a1 = mid + soft;
  for (let i = 0; i < w * h; i++) {
    const m = mask[i] / 255, t = Math.min(1, Math.max(0, (m - a0) / (a1 - a0)));
    d[i * 4 + 3] = Math.round(d[i * 4 + 3] * (t * t * (3 - 2 * t)));
  }
  g.putImageData(img, 0, 0);
  return out;
}

export async function removeBackground(img, cut = 50, opts = {}) {
  const seg = await segment(img, opts);
  return { seg, canvas: compose(seg, cut) };
}
