// Shared helpers used by every converter/compressor page.
// Everything runs client-side — no file ever leaves the browser.

function formatBytes(bytes) {
  if (bytes === 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function swapExtension(name, newExt) {
  const dot = name.lastIndexOf(".");
  const base = dot === -1 ? name : name.slice(0, dot);
  return `${base}.${newExt}`;
}

// Decodes any raster image the browser supports and re-encodes it to
// the target mime type at the given quality (quality only applies to
// jpeg/webp). Returns a Blob.
function convertImageFile(file, targetMime, quality = 0.92) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");

      // Flatten transparency onto white when converting into a format
      // that has no alpha channel (e.g. JPEG), so output isn't black.
      if (targetMime === "image/jpeg") {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl);
          if (blob) resolve(blob);
          else reject(new Error("Conversion failed in this browser."));
        },
        targetMime,
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("This browser couldn't read that file. Some formats (like HEIC) aren't decodable in every browser."));
    };
    img.src = objectUrl;
  });
}

// canvas.toBlob has no SVG encoder, so "converting to SVG" here means
// embedding the source raster image as a base64 data URI inside a
// minimal SVG wrapper, sized to the image's natural dimensions.
function convertImageToSvgWrapper(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = () => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${img.naturalWidth}" height="${img.naturalHeight}" viewBox="0 0 ${img.naturalWidth} ${img.naturalHeight}">
  <image href="${dataUrl}" x="0" y="0" width="${img.naturalWidth}" height="${img.naturalHeight}" />
</svg>`;
        resolve(new Blob([svg], { type: "image/svg+xml" }));
      };
      img.onerror = () => reject(new Error("This browser couldn't read that file."));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error("Couldn't read the file."));
    reader.readAsDataURL(file);
  });
}

// Browsers have no native ICO encoder, so this builds a real multi-size
// .ico file by hand: a small ICONDIR header followed by several PNG
// images at standard favicon sizes, each with its own directory entry.
// This "PNG-in-ICO" format has been supported by Windows and browsers
// since Vista and is what every favicon generator actually produces.
async function convertImageToIco(file, sizes = [16, 32, 48, 64]) {
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    const url = URL.createObjectURL(file);
    im.onload = () => { resolve(im); };
    im.onerror = () => reject(new Error("This browser couldn't read that file."));
    im.src = url;
  });

  const pngBuffers = [];
  for (const size of sizes) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    // Contain-fit the source image within the square canvas, centered,
    // so non-square source images don't get stretched.
    const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    pngBuffers.push(new Uint8Array(await blob.arrayBuffer()));
  }

  const headerSize = 6 + 16 * sizes.length;
  const totalSize = headerSize + pngBuffers.reduce((sum, b) => sum + b.length, 0);
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  view.setUint16(0, 0, true);   // reserved
  view.setUint16(2, 1, true);   // type: 1 = icon
  view.setUint16(4, sizes.length, true);

  let offset = headerSize;
  sizes.forEach((size, i) => {
    const entryStart = 6 + i * 16;
    const dim = size >= 256 ? 0 : size; // 0 means 256 in the ICO spec
    out[entryStart] = dim;              // width
    out[entryStart + 1] = dim;          // height
    out[entryStart + 2] = 0;            // color palette count
    out[entryStart + 3] = 0;            // reserved
    view.setUint16(entryStart + 4, 1, true);   // color planes
    view.setUint16(entryStart + 6, 32, true);  // bits per pixel
    view.setUint32(entryStart + 8, pngBuffers[i].length, true);
    view.setUint32(entryStart + 12, offset, true);
    out.set(pngBuffers[i], offset);
    offset += pngBuffers[i].length;
  });

  return new Blob([out], { type: "image/x-icon" });
}

// ---------------------------------------------------------------
// Real PNG compression via palette quantization (median-cut) + pako
// deflate. Plain canvas.toBlob('image/png') can't shrink an already-
// optimized PNG — it just re-encodes as raw 32-bit RGBA, which often
// makes files *bigger*. This builds an actual indexed-color PNG,
// which is how real PNG compressors (TinyPNG etc.) get real savings.
// ---------------------------------------------------------------

const _crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function _crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = _crc32Table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function _pngChunk(type, data) {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, 4);
  const crc = _crc32(body);

  const chunk = new Uint8Array(4 + body.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  chunk.set(body, 4);
  view.setUint32(4 + body.length, crc, false);
  return chunk;
}

// Median-cut quantizer: reduces a set of weighted RGBA colors to at
// most `maxColors` representative colors.
function _medianCutPalette(uniqueColors, maxColors) {
  // Each entry: [r, g, b, a, count]
  let boxes = [uniqueColors];

  function boxRangeChannel(box) {
    let ranges = [0, 0, 0, 0];
    for (let ch = 0; ch < 4; ch++) {
      let lo = 255, hi = 0;
      for (const c of box) { if (c[ch] < lo) lo = c[ch]; if (c[ch] > hi) hi = c[ch]; }
      ranges[ch] = hi - lo;
    }
    let best = 0;
    for (let ch = 1; ch < 4; ch++) if (ranges[ch] > ranges[best]) best = ch;
    return { channel: best, range: ranges[best] };
  }

  while (boxes.length < maxColors) {
    // Pick the box with the largest population that can still be split.
    let splitIdx = -1, splitScore = -1, splitInfo = null;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      const info = boxRangeChannel(boxes[i]);
      let population = 0;
      for (const c of boxes[i]) population += c[4];
      const score = info.range * population;
      if (score > splitScore) { splitScore = score; splitIdx = i; splitInfo = info; }
    }
    if (splitIdx === -1) break;

    const box = boxes[splitIdx];
    const ch = splitInfo.channel;
    box.sort((a, b) => a[ch] - b[ch]);
    let total = 0;
    for (const c of box) total += c[4];
    let acc = 0, mid = 0;
    for (; mid < box.length; mid++) { acc += box[mid][4]; if (acc >= total / 2) break; }
    mid = Math.max(1, Math.min(box.length - 1, mid));
    const boxA = box.slice(0, mid), boxB = box.slice(mid);
    boxes.splice(splitIdx, 1, boxA, boxB);
  }

  return boxes.map((box) => {
    let r = 0, g = 0, b = 0, a = 0, count = 0;
    for (const c of box) { r += c[0] * c[4]; g += c[1] * c[4]; b += c[2] * c[4]; a += c[3] * c[4]; count += c[4]; }
    return [Math.round(r / count), Math.round(g / count), Math.round(b / count), Math.round(a / count)];
  });
}

async function compressPngLossy(file, qualityPercent) {
  if (typeof pako === "undefined") {
    throw new Error("PNG compression engine failed to load. Please refresh and try again.");
  }

  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    const url = URL.createObjectURL(file);
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("This browser couldn't read that file."));
    im.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { width, height } = canvas;
  const pixels = ctx.getImageData(0, 0, width, height).data;

  // quality 95 -> up to 256 colors (near-lossless); quality 10 -> 8 colors
  const maxColors = Math.max(8, Math.round(8 + (qualityPercent / 100) * 248));

  // Build a histogram of unique colors.
  const histogram = new Map();
  const pixelCount = width * height;
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    const key = (pixels[o] << 24) | (pixels[o + 1] << 16) | (pixels[o + 2] << 8) | pixels[o + 3];
    histogram.set(key, (histogram.get(key) || 0) + 1);
  }

  const uniqueColors = [];
  for (const [key, count] of histogram) {
    uniqueColors.push([(key >>> 24) & 255, (key >>> 16) & 255, (key >>> 8) & 255, key & 255, count]);
  }

  const palette = uniqueColors.length <= maxColors
    ? uniqueColors.map((c) => [c[0], c[1], c[2], c[3]])
    : _medianCutPalette(uniqueColors, maxColors);

  // Map every unique color to its nearest palette index (computed once
  // per unique color, not per pixel).
  const colorToIndex = new Map();
  for (const [key] of histogram) {
    const r = (key >>> 24) & 255, g = (key >>> 16) & 255, b = (key >>> 8) & 255, a = key & 255;
    let bestIdx = 0, bestDist = Infinity;
    for (let p = 0; p < palette.length; p++) {
      const pc = palette[p];
      const dr = r - pc[0], dg = g - pc[1], db = b - pc[2], da = a - pc[3];
      const dist = dr * dr + dg * dg + db * db + da * da;
      if (dist < bestDist) { bestDist = dist; bestIdx = p; }
    }
    colorToIndex.set(key, bestIdx);
  }

  const indices = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    const key = (pixels[o] << 24) | (pixels[o + 1] << 16) | (pixels[o + 2] << 8) | pixels[o + 3];
    indices[i] = colorToIndex.get(key);
  }

  // Build the raw scanline data: one filter-type byte (0 = None) per
  // row, followed by one palette-index byte per pixel.
  const bpl = width;
  const raw = new Uint8Array((bpl + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (bpl + 1)] = 0;
    raw.set(indices.subarray(y * width, (y + 1) * width), y * (bpl + 1) + 1);
  }

  const compressed = pako.deflate(raw, { level: 9 });

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 3;   // color type: palette
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const plte = new Uint8Array(palette.length * 3);
  const needsAlpha = palette.some((c) => c[3] !== 255);
  const trns = needsAlpha ? new Uint8Array(palette.length) : null;
  palette.forEach((c, i) => {
    plte[i * 3] = c[0]; plte[i * 3 + 1] = c[1]; plte[i * 3 + 2] = c[2];
    if (trns) trns[i] = c[3];
  });

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [
    signature,
    _pngChunk("IHDR", ihdr),
    _pngChunk("PLTE", plte),
  ];
  if (trns) chunks.push(_pngChunk("tRNS", trns));
  chunks.push(_pngChunk("IDAT", compressed));
  chunks.push(_pngChunk("IEND", new Uint8Array(0)));

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }

  const resultBlob = new Blob([out], { type: "image/png" });

  // Safety net: never hand back something bigger than the original.
  if (resultBlob.size >= file.size) return file;
  return resultBlob;
}

// Wires drag-and-drop + click-to-browse behavior onto a dropzone element.
function setupDropzone(dropzoneEl, inputEl, onFiles) {
  const openPicker = () => inputEl.click();

  dropzoneEl.addEventListener("click", openPicker);
  dropzoneEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  });

  inputEl.addEventListener("change", () => {
    if (inputEl.files.length) onFiles(inputEl.files);
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropzoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzoneEl.classList.add("drag");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzoneEl.classList.remove("drag");
    })
  );
  dropzoneEl.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
  });
}
