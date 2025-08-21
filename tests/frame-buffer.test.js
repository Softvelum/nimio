import { describe, it, expect, vi, beforeEach } from "vitest";

import { FrameBuffer } from "@/media/buffers/frame-buffer.js";

const createMockFrame = (id = 0, timestamp) => ({
  id,
  timestamp,
  close: vi.fn(),
});

describe("FrameBuffer", () => {
  let buffer;

  beforeEach(() => {
    buffer = new FrameBuffer("Test", "Video", 3);
  });

  it("adds frames and retrieves the correct one by time", () => {
    const f1 = createMockFrame(1, 1000);
    const f2 = createMockFrame(2, 2000);
    const f3 = createMockFrame(3, 3000);

    buffer.pushFrame(f1);
    buffer.pushFrame(f2);
    buffer.pushFrame(f3);

    let result = buffer.popFrameForTime(2500);
    expect(result).toBe(f2);
    result = buffer.popFrameForTime(3500);
    expect(result).toBe(f3);
  });

  it("retrieves null if no frame is available for the requested time", () => {
    const f1 = createMockFrame(1, 1000);
    const f2 = createMockFrame(2, 2000);

    buffer.pushFrame(f1);
    buffer.pushFrame(f2);

    const result = buffer.popFrameForTime(0);
    expect(result).toBe(null);
  });

  it("disposes of older frames when overflowing", () => {
    const f1 = createMockFrame(1, 1000);
    const f2 = createMockFrame(2, 2000);
    const f3 = createMockFrame(3, 3000);
    const f4 = createMockFrame(4, 4000);

    buffer.pushFrame(f1);
    buffer.pushFrame(f2);
    buffer.pushFrame(f3);
    buffer.pushFrame(f4); // should pop f1

    expect(f1.close).toHaveBeenCalled();
    expect(buffer.length).toBe(3);
  });

  it("gets proper last timestamp", () => {
    const f1 = createMockFrame(1, 1000);
    const f2 = createMockFrame(2, 2000);

    buffer.pushFrame(f1);
    buffer.pushFrame(f2);

    const result = buffer.popFrameForTime(1000);
    expect(result).toBe(f1);
    expect(buffer.lastFrameTs).toBe(2000);
  });

  it("clears and disposes all frames", () => {
    const f1 = createMockFrame(1, 1000);
    const f2 = createMockFrame(2, 2000);

    buffer.pushFrame(f1);
    buffer.pushFrame(f2);

    buffer.reset();

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
    buffer.pushFrame(createMockFrame(1, 1_000_000));
    buffer.pushFrame(createMockFrame(2, 3_000_000));
    expect(buffer.getTimeCapacity()).toBe(2);
  });
});
