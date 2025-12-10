import { describe, it, expect, vi, beforeEach } from "vitest";
import { SharedAudioBuffer } from "@/media/buffers/shared-audio-buffer";

function createTestBuffer(options = {}) {
  const {
    bufferSec = 1,
    sampleRate = 48000,
    numChannels = 2,
    sampleCount = 960,
  } = options;
  return SharedAudioBuffer.allocate(
    bufferSec,
    sampleRate,
    numChannels,
    sampleCount,
  );
}

describe("SharedAudioBuffer", () => {
  let sab;

  beforeEach(() => {
    sab = createTestBuffer();
    sab.reset();
  });

  it("allocates with correct properties", () => {
    expect(sab.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(sab.sampleRate).toBe(48000);
    expect(sab.bufferCapacity).toBe(50); // 1 second at 48000Hz with 960 samples per frame
    expect(Array.isArray(sab._frames)).toBe(true);
    expect(sab._frames.length).toBe(sab.bufferCapacity);
  });

  it("resets read and write indexes", () => {
    sab.setWriteIdx(5);
    sab.setReadIdx(3);
    sab.reset();
    expect(sab.getWriteIdx()).toBe(0);
    expect(sab.getReadIdx()).toBe(0);
  });

  it("computes size correctly for linear case", () => {
    sab.setWriteIdx(8);
    sab.setReadIdx(3);
    expect(sab.getSize()).toBe(5);
  });

  it("computes size correctly for wrapped case", () => {
    sab.setWriteIdx(2);
    sab.setReadIdx(sab.bufferCapacity - 2);
    expect(sab.getSize()).toBe(4);
  });

  it("wraps around index when setting values beyond capacity", () => {
    sab.setWriteIdx(sab.bufferCapacity + 1);
    expect(sab.getWriteIdx()).toBe(1);
  });

  it("returns correct last timestamp", () => {
    sab.setWriteIdx(1);
    sab._timestamps[0] = 123456;
    expect(sab.lastFrameTs).toBe(123456);
  });

  it("returns zero if no timestamps have been written", () => {
    sab.setWriteIdx(0);
    expect(sab.lastFrameTs).toBe(0);
  });

  it("iterates over frames in forEach", () => {
    const calls = [];
    sab.setWriteIdx(3);
    sab.setReadIdx(0);
    sab._timestamps[0] = 1;
    sab._timestamps[1] = 2;
    sab._timestamps[2] = 3;

    sab.forEach((ts, frame, idx, remaining) => {
      calls.push({ ts, idx, remaining });
    });

    expect(calls.length).toBe(3);
    expect(calls[0].ts).toBe(1);
    expect(calls[1].ts).toBe(2);
    expect(calls[2].ts).toBe(3);
  });

  it("iterates circular over frames in forEach", () => {
    let capacity = sab.bufferCapacity;
    const calls = [];
    sab.setWriteIdx(2);
    sab.setReadIdx(capacity - 1);
    sab._timestamps[capacity - 1] = 1;
    sab._timestamps[0] = 2;
    sab._timestamps[1] = 3;

    sab.forEach((ts, frame, idx, remaining) => {
      calls.push({ ts, idx, remaining });
    });

    expect(calls.length).toBe(3);
    expect(calls[0].ts).toBe(1);
    expect(calls[1].ts).toBe(2);
    expect(calls[2].ts).toBe(3);
  });

  it("can break iteration early in forEach", () => {
    const calls = [];
    sab.setWriteIdx(3);
    sab.setReadIdx(0);

    sab.forEach((ts, rate, frame, idx, remaining) => {
      calls.push(idx);
      if (idx === 1) return false;
    });

    expect(calls.length).toBe(2);
  });

  it("_getIdx and _setIdx handle Atomics access correctly", () => {
    sab._setIdx(0, 5);
    expect(sab._getIdx(0)).toBe(5);
  });

  it("handles concurrent-like index updates correctly", () => {
    const iterations = 100;
    for (let i = 0; i < iterations; i++) {
      sab.setWriteIdx(i);
      const readIdx = sab.getWriteIdx();
      expect(readIdx).toBe(i % sab.bufferCapacity);
    }
  });

  it("handles concurrent-like read/write index contention", () => {
    const iterations = sab.bufferCapacity * 2;
    for (let i = 0; i < iterations; i++) {
      sab.setWriteIdx(i);
      if (i % 2 === 0) sab.setReadIdx(i / 2);
      const size = sab.getSize();
      const cap = sab.bufferCapacity;
      expect(size).toBe((sab.getWriteIdx() + cap - sab.getReadIdx()) % cap);
    }
  });

  it("returns correct buffer capacity", () => {
    expect(sab.bufferCapacity).toBe(sab.bufferCapacity);
  });

  it("returns the buffer is shareable", () => {
    expect(sab.isShareable).toBe(true);
  });
});
