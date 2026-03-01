import { Signal } from "@char/aftercare";
import * as faceapi from "@vladmandic/face-api";

const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/";

type FaceResult = faceapi.WithAge<
  faceapi.WithGender<faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }>>
>;

const statusText = new Signal("");
const imageUrl = new Signal<string | null>(null);
const detections = new Signal<FaceResult[]>([]);
let detecting = false;

const threshold = new Signal(0.3);
const showLandmarks = new Signal(true);
const perturbStrength = new Signal(0);

let loadedImg: HTMLImageElement | null = null;

const applyPerturbation = (img: HTMLImageElement, strength: number): string => {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  if (strength > 0) {
    const imageData = ctx.getImageData(0, 0, c.width, c.height);
    const { data } = imageData;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() * 2 - 1) * strength;
      data[i] = Math.max(0, Math.min(255, data[i] + noise));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }
    ctx.putImageData(imageData, 0, 0);
  }
  return c.toDataURL();
};

const runDetection = async (img: HTMLImageElement) => {
  statusText.set("detecting...");
  const dataUrl = applyPerturbation(img, perturbStrength.get());
  imgEl.src = dataUrl;
  try {
    const input = await loadImage(dataUrl);
    const results = await faceapi
      .detectAllFaces(
        input,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 800, scoreThreshold: 0.05 }),
      )
      .withFaceLandmarks()
      .withAgeAndGender();
    detections.set(results);
  } catch (err) {
    statusText.set(`detection failed: ${err}`);
  }
};

(async () => {
  statusText.set("loading models…");
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
  ]);
  statusText.set("");
})();

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("load failed"));
    img.src = src;
  });

const processFile = async (file: File) => {
  if (!file.type.startsWith("image/")) return;
  if (detecting) return;

  const prev = imageUrl.get();
  if (prev) URL.revokeObjectURL(prev);
  detections.set([]);

  const url = URL.createObjectURL(file);
  imageUrl.set(url);
  detecting = true;

  try {
    loadedImg = await loadImage(url);
    await runDetection(loadedImg);
  } finally {
    detecting = false;
  }
};

const imgEl = (<img alt="" />) as HTMLImageElement;
const canvas = (<canvas />) as HTMLCanvasElement;

const imageContainer = (
  <div id="image-container">
    {imgEl}
    {canvas}
  </div>
) as HTMLElement;

const drawOverlay = (faces: FaceResult[], img: HTMLImageElement) => {
  const { naturalWidth: nw, naturalHeight: nh } = img;
  const { clientWidth: dw, clientHeight: dh } = img;

  const scaleX = dw / nw;
  const scaleY = dh / nh;

  canvas.width = dw;
  canvas.height = dh;

  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, dw, dh);

  for (const face of faces) {
    if (face.detection.score < threshold.get()) continue;

    const { x, y, width, height } = face.detection.box;
    const sx = x * scaleX;
    const sy = y * scaleY;
    const sw = width * scaleX;
    const sh = height * scaleY;

    // Box
    ctx.strokeStyle = "oklch(67.03% 0.1119 335.5)";
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, sw, sh);

    // Label background + text
    const gender = face.gender === "male" ? "m" : "f";
    const conf = Math.round(face.genderProbability * 100);
    const age = Math.round(face.age);
    const label = `${gender} (${conf}%), ${age}y`;

    const fontSize = Math.min(Math.max(16, Math.round(sh * 0.12)), 24);
    ctx.font = `${fontSize}px sans-serif`;

    const padding = 4;
    const textWidth = ctx.measureText(label).width;
    const boxH = fontSize + padding * 2;
    const boxY = sy - boxH;

    ctx.fillStyle = "oklch(67.03% 0.1119 335.5 / 85%)";
    ctx.fillRect(sx, boxY, textWidth + padding * 2, boxH);

    ctx.fillStyle = "#fff";
    ctx.fillText(label, sx + padding, sy - padding);

    if (showLandmarks.get()) {
      ctx.fillStyle = "oklch(67.03% 0.1119 335.5 / 30%)";
      const r = sw * 0.02;
      for (const { x: px, y: py } of face.landmarks.positions) {
        ctx.beginPath();
        ctx.arc(px * scaleX, py * scaleY, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
};

imageUrl.subscribe(url => {
  if (!url) {
    imgEl.src = "";
    canvas.width = 0;
    canvas.height = 0;
    imageContainer.style.display = "none";
    return;
  }
  imageContainer.style.display = "";
});

detections.subscribe(faces => {
  if (!imgEl.complete || !imgEl.naturalWidth) {
    imgEl.onload = () => drawOverlay(faces, imgEl);
  } else {
    drawOverlay(faces, imgEl);
  }
});

threshold.subscribe(() => {
  drawOverlay(detections.get(), imgEl);
});
showLandmarks.subscribe(() => {
  drawOverlay(detections.get(), imgEl);
});

detections.subscribe(faces => {
  const count = faces.filter(it => it.detection.score >= threshold.get()).length;
  if (count === 0) {
    statusText.set("no faces detected");
  } else {
    statusText.set(`${count} face${count === 1 ? "" : "s"} detected`);
  }
});

const thresholdPct = threshold.derive(
  t => Math.round(t * 100),
  t => t / 100,
);

const perturbPct = perturbStrength.derive(
  s => Math.round((s / 255) * 100),
  s => Math.round((s / 100) * 255),
);

const controls = (
  <section id="controls">
    <label>
      upload image:{" "}
      <input
        type="file"
        accept="image/*"
        _oninput={function (this: HTMLInputElement) {
          if (this.files?.[0]) processFile(this.files[0]);
        }}
      />
    </label>
    <p class="hint">or paste / drop an image anywhere on the page</p>
    <aside>
      <label>
        threshold: <input type="range" min="1" max="99" value={thresholdPct.str(Number)} />
        <span class="threshold-value">{thresholdPct.str()}%</span>
      </label>
      <label>
        <input
          type="checkbox"
          checked={showLandmarks}
          _oninput={function (this: HTMLInputElement) {
            showLandmarks.set(this.checked);
          }}
        />
        landmarks
      </label>
      <label>
        perturbation: <input type="range" min="0" max="100" value={perturbPct.str(Number)} />
        <span class="threshold-value">{perturbPct.str()}%</span>
      </label>
      <button
        type="button"
        _onclick={() => {
          if (loadedImg) runDetection(loadedImg);
        }}
      >
        redetect
      </button>
    </aside>

    <p class="status">{statusText}</p>
  </section>
);

document.body.dataset.dropLabel = "drop image here";
document.addEventListener("dragenter", e => {
  e.preventDefault();
  document.body.classList.add("drag-over");
});
document.addEventListener("dragleave", e => {
  if (!e.relatedTarget) document.body.classList.remove("drag-over");
});
document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("drop", e => {
  e.preventDefault();
  document.body.classList.remove("drag-over");
  const file = e.dataTransfer?.files[0];
  if (file) processFile(file);
});
document.addEventListener("paste", e => {
  e.preventDefault();
  const file = e.clipboardData?.files[0];
  if (file) processFile(file);
});

document.querySelector("main")!.append(
  <h1>face detection</h1>,
  <p>
    detect faces with age & gender estimates via{" "}
    <a href="https://github.com/vladmandic/face-api">face-api</a> - locally in your browser
  </p>,
  controls,
  imageContainer,
);
