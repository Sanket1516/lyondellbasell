// Kept apart from scene/textures.ts so the first-paint bundle does not pull in three.js.
/** Fine grain for the CSS overlay (a data URL, generated, not downloaded). */
export function grainDataUrl(size = 160) {
  const cv = document.createElement("canvas"); cv.width = cv.height = size; const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  let a = 1234567;
  for (let i = 0; i < img.data.length; i += 4) {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    const v = (a >> 16) & 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL("image/png");
}
