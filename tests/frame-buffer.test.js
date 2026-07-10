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
    expect(buffer.isFull()).toBe(false);
    buffer.pushFrame(f2);
    expect(buffer.isFull()).toBe(false);
    buffer.pushFrame(f3);
    expect(buffer.isFull()).toBe(false);
    buffer.pushFrame(f4); // should pop f1
    expect(buffer.isFull()).toBe(true);

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

  it("gets proper first timestamp", () => {
    const f1 = createMockFrame(1, 1000);
    const f2 = createMockFrame(2, 2000);

    buffer.pushFrame(f1);
    buffer.pushFrame(f2);

    expect(buffer.firstFrameTs).toBe(1000);
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

  it("forEach iterates in order", () => {
    const f1 = createMockFrame(1, 1000);
    const f2 = createMockFrame(2, 2000);
    const f3 = createMockFrame(3, 3000);

    buffer.pushFrame(f1);
    buffer.pushFrame(f2);
    buffer.pushFrame(f3);
    const out = [];
    buffer.forEach((x) => out.push(x));
    expect(out).toEqual([f1, f2, f3]);
  });

  it("returns isFull when frame was dropped", () => {
    // At least 2 frames should be popped to clear fullness status
    buffer.setFullMargin(2);
    const f1 = createMockFrame(1, 1000);
    const f2 = createMockFrame(2, 2000);
    const f3 = createMockFrame(3, 3000);
    const f4 = createMockFrame(4, 4000);

    buffer.pushFrame(f1);
    expect(buffer.isFull()).toBe(false);
    buffer.pushFrame(f2);
    expect(buffer.isFull()).toBe(false);
    buffer.pushFrame(f3);
    expect(buffer.isFull()).toBe(false);
    buffer.pushFrame(f4);
    expect(buffer.isFull()).toBe(true);

    expect(buffer.length).toBe(3);
    let result = buffer.popFrameForTime(2000);
    expect(result).toBe(f2);
    let free = buffer.freeSpace();
    expect(free).toBe(1);
    expect(buffer.isFull()).toBe(true);

    result = buffer.popFrameForTime(3000);
    expect(result).toBe(f3);
    free = buffer.freeSpace();
    expect(free).toBe(2);
    expect(buffer.isFull()).toBe(false);
  });

  it("clears isFull after enough out-of-order frames are removed", () => {
    buffer.setFullMargin(2);
    const f1 = createMockFrame(1, 1000);
    const f2 = createMockFrame(2, 3000);
    const f3 = createMockFrame(3, 2000);
    const f4 = createMockFrame(4, 4000);

    buffer.pushFrame(f1);
    buffer.pushFrame(f2);
    buffer.pushFrame(f3);
    buffer.pushFrame(f4);

    expect(buffer.isFull()).toBe(true);

    const result = buffer.popFrameForTime(3000);

    expect(result).toBe(f2);
    expect(buffer.freeSpace()).toBe(2);
    expect(buffer.isFull()).toBe(false);
  });
});
