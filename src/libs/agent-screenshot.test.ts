import {afterEach, describe, expect, it, vi} from "vitest";
import type {Map} from "maplibre-gl";
import {captureMapScreenshot, encodeScreenshot, MAX_SCREENSHOT_DATA_URL_BYTES, SCREENSHOT_TIMEOUT_MS} from "./agent-screenshot";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mockCanvas(blobSize: (width: number, quality: number) => number) {
  const qualities: number[] = [];
  const createCanvas = () => ({
    width: 0, height: 0,
    getContext: () => ({fillRect: vi.fn(), drawImage: vi.fn()}),
    toBlob(callback: (blob: Blob) => void, type: string, quality: number) {
      qualities.push(quality);
      callback(new Blob([new Uint8Array(blobSize(this.width, quality))], {type}));
    },
  });
  vi.stubGlobal("document", {createElement: createCanvas});
  vi.stubGlobal("FileReader", class {
    result = "";
    onload = () => {};
    readAsDataURL(blob: Blob) {
      this.result = "data:image/jpeg;base64," + "A".repeat(4 * Math.ceil(blob.size / 3));
      this.onload();
    }
  });
  return {canvas: {...createCanvas(), width: 1024, height: 512} as unknown as HTMLCanvasElement, qualities};
}

describe("screenshot encoding budget", () => {
  it("reduces quality before reducing resolution and includes Base64 overhead", async () => {
    const {canvas, qualities} = mockCanvas((_width, quality) => quality > 0.6 ? 200_000 : 100_000);
    const result = await encodeScreenshot(canvas);
    expect(qualities).toEqual([0.8, 0.6]);
    expect(result).toMatchObject({width: 1024, height: 512, bytes: 100_000});
    expect(result.dataUrl.length).toBeLessThanOrEqual(MAX_SCREENSHOT_DATA_URL_BYTES);
  });

  it("shrinks dense images while preserving aspect ratio when quality is insufficient", async () => {
    const {canvas} = mockCanvas(width => width >= 1024 ? 300_000 : 150_000);
    const result = await encodeScreenshot(canvas);
    expect(result).toMatchObject({width: 768, height: 384});
    expect(result.dataUrl.length).toBeLessThanOrEqual(MAX_SCREENSHOT_DATA_URL_BYTES);
  });

  it("fails rather than returning an image above the hard limit", async () => {
    const {canvas} = mockCanvas(() => 300_000);
    await expect(encodeScreenshot(canvas)).rejects.toThrow("image size limit");
  });
});

function mockMap() {
  const handlers = new globalThis.Map<string, () => void>();
  const map = {
    on: vi.fn((event: string, callback: () => void) => handlers.set(event, callback)),
    off: vi.fn((event: string) => handlers.delete(event)),
    loaded: () => true,
    isMoving: () => false,
    triggerRepaint: vi.fn(),
    getCanvas: () => ({width: 4000, height: 2000}),
    getCenter: () => ({lng: 120, lat: 30}),
    getZoom: () => 5,
    getBearing: () => 0,
    getPitch: () => 0,
  };
  return {map, handlers, liveMap: map as unknown as Map};
}

describe("live screenshot lifecycle", () => {
  it("waits for a settled render and copies at a bounded size", async () => {
    mockCanvas(() => 1000);
    const {map, handlers, liveMap} = mockMap();
    const loaded = vi.spyOn(map, "loaded").mockReturnValue(false);
    const result = captureMapScreenshot(liveMap);
    handlers.get("idle")!();
    expect(handlers.has("idle")).toBe(true);
    loaded.mockReturnValue(true);
    handlers.get("idle")!();
    const output = await result;
    expect(output).toMatchObject([{type: "input_text"}, {type: "input_image"}]);
    expect(JSON.parse((output[0] as {text: string}).text)).toMatchObject({width: 1024, height: 512});
    expect(handlers.size).toBe(0);
  });

  it("times out and cleans up when the map never renders", async () => {
    vi.useFakeTimers();
    const {handlers, liveMap} = mockMap();
    const result = expect(captureMapScreenshot(liveMap)).rejects.toThrow("8 seconds");
    await vi.advanceTimersByTimeAsync(SCREENSHOT_TIMEOUT_MS);
    await result;
    expect(handlers.size).toBe(0);
  });

  it("cancels promptly and removes event listeners", async () => {
    const {handlers, liveMap} = mockMap();
    const controller = new AbortController();
    const result = captureMapScreenshot(liveMap, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({name: "AbortError"});
    expect(handlers.size).toBe(0);
  });

  it("reports missing live map access", async () => {
    await expect(captureMapScreenshot(null)).rejects.toThrow("MapLibreGL JS");
  });
});
