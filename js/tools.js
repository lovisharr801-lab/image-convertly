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
