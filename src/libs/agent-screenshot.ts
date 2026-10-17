import type {Map} from "maplibre-gl";
import type {AgentToolOutput} from "./agent-client";

export const MAX_SCREENSHOT_EDGE = 1024;
/** Bound the actual image input, including the data URL prefix and Base64. */
export const MAX_SCREENSHOT_DATA_URL_BYTES = 256 * 1024;
export const SCREENSHOT_TIMEOUT_MS = 8000;
const JPEG_PREFIX = "data:image/jpeg;base64,";

/** Copy in idle's render task, after transitions, before WebGL clears its buffer. */
function captureRenderedMap(map: Map, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      map.off("idle", onIdle);
      map.off("remove", onRemove);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(signal?.reason ?? new Error("Screenshot cancelled"));
    const onRemove = () => fail(new Error("The live map was removed during screenshot capture"));
    const onIdle = () => {
      if (!map.loaded() || map.isMoving()) return;
      try {
        const source = map.getCanvas();
        if (!source.width || !source.height) {
          throw new Error("The live map canvas is empty");
        }
        const scale = Math.min(1, MAX_SCREENSHOT_EDGE / Math.max(source.width, source.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(source.width * scale));
        canvas.height = Math.max(1, Math.round(source.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not create screenshot canvas");
        // JPEG has no alpha; make transparent map backgrounds predictable.
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        cleanup();
        resolve(canvas);
      }
      catch (error) {
        fail(error);
      }
    };
    const timer = setTimeout(() => fail(new Error("Map rendering did not settle within 8 seconds; wait for loading or animations to finish before retrying")), SCREENSHOT_TIMEOUT_MS);
    map.on("idle", onIdle);
    map.on("remove", onRemove);
    signal?.addEventListener("abort", onAbort, {once: true});
    try {
      map.triggerRepaint();
    }
    catch (error) {
      fail(error);
    }
  });
}

/** Try quality first to retain label detail; shrink only if still over budget. */
export async function encodeScreenshot(canvas: HTMLCanvasElement, signal?: AbortSignal) {
  const output = document.createElement("canvas");
  let width = canvas.width;
  let height = canvas.height;
  while (true) {
    output.width = width;
    output.height = height;
    const context = output.getContext("2d");
    if (!context) throw new Error("Could not create screenshot canvas");
    context.drawImage(canvas, 0, 0, width, height);
    for (const quality of [0.8, 0.6, 0.4]) {
      signal?.throwIfAborted();
      const blob = await new Promise<Blob | null>(resolve => output.toBlob(resolve, "image/jpeg", quality));
      signal?.throwIfAborted();
      if (!blob || blob.type !== "image/jpeg") throw new Error("Could not encode screenshot as JPEG");
      if (JPEG_PREFIX.length + 4 * Math.ceil(blob.size / 3) <= MAX_SCREENSHOT_DATA_URL_BYTES) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Could not read screenshot image"));
          reader.readAsDataURL(blob);
        });
        signal?.throwIfAborted();
        return {dataUrl, width, height, bytes: blob.size};
      }
    }
    if (Math.max(width, height) <= 128) throw new Error("Could not fit screenshot within the image size limit");
    width = Math.max(1, Math.floor(width * 0.75));
    height = Math.max(1, Math.floor(height * 0.75));
  }
}

export async function captureMapScreenshot(map: Map | null, signal?: AbortSignal): Promise<AgentToolOutput> {
  if (!map) throw new Error("Live map access requires the MapLibreGL JS renderer");
  const canvas = await captureRenderedMap(map, signal);
  // Record the viewport before asynchronous encoding, while it matches the image.
  const center = map.getCenter();
  const viewport = {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
  const {dataUrl, ...image} = await encodeScreenshot(canvas, signal);
  return [
    {type: "input_text", text: JSON.stringify({format: "image/jpeg", ...image, dataUrlBytes: dataUrl.length, viewport})},
    {type: "input_image", image_url: dataUrl, detail: "auto"},
  ];
}
