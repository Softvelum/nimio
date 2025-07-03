import { describe, it, expect, vi, beforeEach } from "vitest";

import { VideoBuffer } from "@/media/buffers/video-buffer.js";

const createMockFrame = (id = 0) => ({
  id,
  close: vi.fn(),
});

describe("VideoBuffer", () => {
  let buffer;

  beforeEach(() => {
    buffer = new VideoBuffer("test", 3);
  });

  it("adds frames and retrieves the correct one by time", () => {
    const f1 = createMockFrame(1);
    const f2 = createMockFrame(2);
    const f3 = createMockFrame(3);

    buffer.addFrame(f1, 1000);
    buffer.addFrame(f2, 2000);
    buffer.addFrame(f3, 3000);

    let result = buffer.popFrameForTime(2500);
    expect(result).toBe(f2);
    result = buffer.popFrameForTime(3500);
    expect(result).toBe(f3);
  });

  it("retrieves null if no frame is available for the requested time", () => {
    const f1 = createMockFrame(1);
    const f2 = createMockFrame(2);

    buffer.addFrame(f1, 1000);
    buffer.addFrame(f2, 2000);

    const result = buffer.popFrameForTime(0);
    expect(result).toBe(null);
  });

  it("disposes of older frames when overflowing", () => {
    const f1 = createMockFrame(1);
    const f2 = createMockFrame(2);
    const f3 = createMockFrame(3);
    const f4 = createMockFrame(4);

    buffer.addFrame(f1, 1000);
    buffer.addFrame(f2, 2000);
    buffer.addFrame(f3, 3000);
    buffer.addFrame(f4, 4000); // should pop f1

    expect(f1.close).toHaveBeenCalled();
    expect(buffer.length).toBe(3);
  });

  it("gets proper last timestamp", () => {
    const f1 = createMockFrame(1);
    const f2 = createMockFrame(2);

    buffer.addFrame(f1, 1000);
    buffer.addFrame(f2, 2000);

    const result = buffer.popFrameForTime(1000);
    expect(result).toBe(f1);
    expect(buffer.lastFrameTs).toBe(2000);
  });

  it("clears and disposes all frames", () => {
    const f1 = createMockFrame(1);
    const f2 = createMockFrame(2);

    buffer.addFrame(f1, 1000);
    buffer.addFrame(f2, 2000);

    buffer.clear();

    expect(f1.close).toHaveBeenCalled();
    expect(f2.close).toHaveBeenCalled();
    expect(buffer.length).toBe(0);
  });

  it("returns null when popping from an empty buffer", () => {
    const result = buffer.popFrameForTime(1000);
    expect(result).toBe(null);
  });

  it("returns 0 time capacity when empty", () => {
    expect(buffer.getTimeCapacity()).toBe(0);
  });

  it("computes time capacity correctly", () => {
    buffer.addFrame(createMockFrame(), 1_000_000);
    buffer.addFrame(createMockFrame(), 3_000_000);
    expect(buffer.getTimeCapacity()).toBe(2);
  });
});
