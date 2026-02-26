import { Signal } from "@char/aftercare";

type Format = "png" | "jpeg" | "webp";
type ConvertedImage = { objectUrl: string; filename: string; format: Format };

const format = new Signal<Format>("png");
const quality = new Signal(0.85);
const images = new Signal<ConvertedImage[]>([]);

const loadImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("load failed"));
    img.src = src;
  });
};

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  mime: string,
  q?: number,
): Promise<Blob> => {
  const { promise, resolve, reject } = Promise.withResolvers<Blob>();
  canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error("conversion failed"))),
    mime,
    q,
  );
  return promise;
};

const convertFile = async (file: File): Promise<ConvertedImage> => {
  const fmt = format.get();
  const src = URL.createObjectURL(file);
  const img = await loadImage(src).finally(() => URL.revokeObjectURL(src));
  const canvas = (
    <canvas width={img.naturalWidth} height={img.naturalHeight} />
  ) as HTMLCanvasElement;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  const blob = await canvasToBlob(
    canvas,
    `image/${fmt}`,
    fmt === "png" ? undefined : quality.get(),
  );
  return {
    objectUrl: URL.createObjectURL(blob),
    filename: file.name.replace(/\.[^.]+$/, "") + "." + fmt,
    format: fmt,
  };
};

const convertFiles = async (files: ArrayLike<File>) => {
  const imageFiles = Array.from(files).filter((f) =>
    f.type.startsWith("image/"),
  );
  if (!imageFiles.length) return;
  const results = await Promise.all(imageFiles.map(convertFile));
  images.set([...results, ...images.get()]);
};

const fileInput = (
  <input type="file" accept="image/*" multiple />
) as HTMLInputElement;

const formatSelect = (
  <select
    value={format}
    _oninput={function () {
      format.set(this.value as Format);
    }}
  >
    <option value="png">PNG</option>
    <option value="jpeg">JPEG</option>
    <option value="webp">WebP</option>
  </select>
) as HTMLSelectElement;

const form = (
  <form
    onsubmit={(e: Event) => {
      e.preventDefault();
      convertFiles(fileInput.files!);
    }}
  >
    {fileInput}
    <button type="submit">convert</button>
  </form>
);

const qualityPct = quality.derive(
  (q) => Math.round(q * 100),
  (q) => q / 100,
);

const qualitySlider = (
  <label
    class="quality-label"
    style={{ display: format.derive((f) => (f === "png" ? "none" : "")) }}
  >
    quality:{" "}
    <input type="range" min="1" max="100" value={qualityPct.str(Number)} />
    <span class="quality-value">{qualityPct.str()}%</span>
  </label>
) as HTMLElement;

const controls = (
  <section class="controls">
    <label class="format-label">format: {formatSelect}</label>
    {qualitySlider}
    {form}
    <p class="hint">or paste / drop images anywhere on the page</p>
  </section>
);

const renderResult = (img: ConvertedImage) => (
  <div class="result-card">
    <img src={img.objectUrl} alt={img.filename} />
    <a href={img.objectUrl} download={img.filename} class="download-link">
      {img.filename}
    </a>
  </div>
);

const resultsSection = (<section class="results" />) as HTMLElement;

images.subscribe((imgs) => {
  resultsSection.replaceChildren(...imgs.map(renderResult));
});

document.addEventListener("dragenter", (e) => {
  e.preventDefault();
  document.body.classList.add("drag-over");
});
document.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) {
    document.body.classList.remove("drag-over");
  }
});
document.addEventListener("dragover", (e) => {
  e.preventDefault();
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("drag-over");
  convertFiles(e.dataTransfer?.files ?? []);
});

document.addEventListener("paste", (e) => {
  e.preventDefault();
  convertFiles(e.clipboardData?.files ?? []);
});

document
  .querySelector("main")!
  .append(
    <h1>image conversion</h1>,
    <p>convert images to png, jpeg, or webp - locally in your browser</p>,
    controls,
    resultsSection,
  );
