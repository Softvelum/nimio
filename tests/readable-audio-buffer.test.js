import { describe, it, expect, beforeEach, vi } from "vitest";
import { ReadableAudioBuffer } from "@/media/buffers/readable-audio-buffer";

function createTestBuffer(options = {}) {
  const {
    bufferSec = 1,
    sampleRate = 48000,
    numChannels = 2,
    sampleCount = 960,
  } = options;

  const capacity = Math.ceil((bufferSec * sampleRate) / sampleCount);
  const frameSize = (2 + numChannels * sampleCount) * Float32Array.BYTES_PER_ELEMENT;
  const sharedBuffer = new SharedArrayBuffer(
    8 + frameSize * capacity,
  );

  return new ReadableAudioBuffer(sharedBuffer, capacity, sampleRate, numChannels, sampleCount);
}

describe("ReadableAudioBuffer", () => {
  let rab;
  const sampleRate = 48000;
  const sampleCount = 960;
  const frameNs = (sampleCount * 1e9) / sampleRate;
  const sampleNs = 1e9 / sampleRate;

  const isClose = (a, b, epsilon = 1e-6) => Math.abs(a - b) < epsilon;

  beforeEach(() => {
    rab = createTestBuffer();
    rab.reset();
  });

  it("throws if outputChannels length doesn't match numChannels", () => {
    expect(() => rab.read(0, 1000, [new Float32Array(960)])).toThrow(
      "outputChannels must match numChannels",
    );
  });

  it("fills silence if no frames exist", () => {
    const out = [new Float32Array(960), new Float32Array(960)];
    const result = rab.read(0, 1000, out);
    expect(result).toBe(0);
    expect(out[0].every((x) => x === 0)).toBe(true);
  });

  it("reads data with valid timestamps and fills output", () => {
    const ts = 1000000;
    rab.timestamps[0] = ts / 1000;
    rab.frames[0].fill(0.5);
    rab.setWriteIdx(1);

    const out = [new Float32Array(960), new Float32Array(960)];
    const result = rab.read(ts, ts + frameNs - 1, out);

    expect(result).toBe(960);
    expect(out[0].every((x) => x === 0.5)).toBe(true);
  });

  it("reads start and end in different frames", () => {
    rab.timestamps[0] = 1000;
    rab.timestamps[1] = 1000 + frameNs / 1000;
    rab.frames[0].fill(0.3);
    rab.frames[1].fill(0.7);
    rab.setWriteIdx(2);

    const out = [new Float32Array(960), new Float32Array(960)];
    const result = rab.read(1000000 + frameNs / 2, 1000000 + 1.5 * frameNs, out);

    expect(result).toBe(960);
    expect(out[0].slice(0, 480).every((x) => isClose(x, 0.3))).toBe(true);
    expect(out[0].slice(480).every((x) => isClose(x, 0.7))).toBe(true);
  });

  it("reads with step > 1", () => {
    rab.timestamps[0] = 0.0;
    rab.frames[0].fill(1.0);
    rab.setWriteIdx(1);

    const out = [new Float32Array(480), new Float32Array(480)];
    const result = rab.read(0, frameNs - 1, out, 2);

    expect(result).toBeLessThanOrEqual(960);
    expect(out[0].some((x) => x === 1)).toBe(true);
  });

  it("fills silence when only end frame matches", () => {
    rab.timestamps[0] = frameNs / 1000;
    rab.frames[0].fill(0.1);
    rab.setWriteIdx(1);

    const out = [new Float32Array(960), new Float32Array(960)];
    const result = rab.read(0, frameNs - 1, out);

    expect(result).toBeLessThanOrEqual(960);
    expect(out[0].some((x) => x === 0)).toBe(true);
  });

  it("fills silence when only start frame matches", () => {
    rab.timestamps[0] = 0;
    rab.frames[0].fill(0.2);
    rab.setWriteIdx(1);
  
    const out = [new Float32Array(1920), new Float32Array(1920)]; // 2 frames
    const result = rab.read(0, frameNs * 2 - 1, out);
  
    expect(result).toBeGreaterThan(0);
    expect(out[0].slice(0, 960).every((x) => Math.abs(x - 0.2) < 1e-6)).toBe(true);
    // Expect the second half to be silence
    expect(out[0].slice(960).every((x) => x === 0)).toBe(true);
  });

  it("fills silence if no frame matched but skips index", () => {
    rab.timestamps[0] = frameNs * 5 / 1000;
    rab.frames[0].fill(0.2);
    rab.setWriteIdx(1);

    const out = [new Float32Array(960), new Float32Array(960)];
    rab.read(0, 1000, out);

    expect(out[0].every((x) => x === 0)).toBe(true);
  });

  it("sets readIdx to skipIdx and warns when no frames matched in range", () => {
    rab.timestamps[0] = 1000;
    rab.frames[0].fill(0.5);
    rab.setWriteIdx(1);
  
    // startTsNs after the frame end, so no readStartIdx or readEndIdx
    const startTsNs = 1000_000 + frameNs + 1;
    const endTsNs = 1000_000 + 2 * frameNs;
    const out = [new Float32Array(rab.sampleCount), new Float32Array(rab.sampleCount)];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const processed = rab.read(startTsNs, endTsNs, out);
  
    expect(processed).toBe(0);
    expect(rab.getReadIdx()).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith("No frames found in the requested range");
    warnSpy.mockRestore();
  });

  it("logs errors when filling silence partially (start, end, or middle)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  
    // Setup 2 frames with timestamps so partial overlap occurs
    rab.timestamps[0] = 0;
    rab.timestamps[1] = frameNs / 1000;
    rab.frames[0].fill(0.5);
    rab.frames[1].fill(0.8);
    rab.setWriteIdx(2);

    const out = [new Float32Array(960), new Float32Array(960)];
    rab.read(0, frameNs * 3, out);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("fills silence at the start when start frame is null but end frame matches", () => {
    rab.timestamps[0] = 1000;
    rab.frames[0].fill(0.5);
    rab.setWriteIdx(1);

    const startTsNs = 0;
    const endTsNs = 1000 * 1000 + 1;
    const out = [new Float32Array(rab.sampleCount), new Float32Array(rab.sampleCount)];
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  
    const processed = rab.read(startTsNs, endTsNs, out);
    expect(processed).toBe(0);
    expect(out[0].some((v) => v === 0)).toBe(true); // Some silence at start
    expect(errSpy).toHaveBeenCalledWith(
      "Fill silence at the start",
      expect.any(Number)
    );
    errSpy.mockRestore();
  });
  
  it("fills silence in the middle when startCount + endCount < output length", () => {
    rab.timestamps[0] = 0;
    rab.timestamps[1] = (frameNs / 1000) * 10; // a gap
    rab.frames[0].fill(0.4);
    rab.frames[1].fill(0.6);
    rab.setWriteIdx(2);
  
    const outLength = rab.sampleCount;
    const out = [new Float32Array(outLength), new Float32Array(outLength)];
    const step = 4;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const processed = rab.read(
      0,
      rab.timestamps[1] * 1000 + frameNs / 2,
      out,
      step
    );
    expect(processed).toBeGreaterThan(0);
    expect(errSpy).toHaveBeenCalledWith(
      "Fill silence in the middle",
      expect.any(Number)
    );
    const hasSilence = out[0].some((v, i) => i > 0 && i < outLength && v === 0);
    expect(hasSilence).toBe(true);
    errSpy.mockRestore();
  });
});
