import { describe, it, expect, vi, beforeEach } from "vitest";
import { RingBuffer } from "../src/shared/ring-buffer";

const mockLogger = {
  error: vi.fn(),
  warn: vi.fn(),
};

// Global mock of LoggersFactory
globalThis.LoggersFactory = {
  create: vi.fn(() => mockLogger),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RingBuffer", () => {
  it("throws on invalid capacity", () => {
    expect(() => new RingBuffer("test", 0)).toThrow("Invalid capacity 0");
    expect(() => new RingBuffer("test", -1)).toThrow();
    expect(() => new RingBuffer("test", 2.5)).toThrow();
  });

  it("pushes and pops values", () => {
    const rb = new RingBuffer("test", 3);
    rb.push(1);
    rb.push(2);
    expect(rb.pop()).toBe(1);
    expect(rb.pop()).toBe(2);
    expect(rb.pop()).toBe(null); // empty now
    console.log("Buffer after popping all items:", rb.toArray());
    expect(mockLogger.warn).toHaveBeenCalledWith("Can't pop from empty ring buffer");
  });

  it("respects isEmpty and isFull", () => {
    const rb = new RingBuffer("test", 2);
    expect(rb.isEmpty()).toBe(true);
    expect(rb.isFull()).toBe(false);
    rb.push("a");
    rb.push("b");
    expect(rb.isFull()).toBe(true);
    expect(rb.isEmpty()).toBe(false);
  });

  it("handles overflow without force", () => {
    const rb = new RingBuffer("test", 2);
    rb.push(1);
    rb.push(2);
    rb.push(3); // should not be added
    expect(rb.length).toBe(2);
    expect(rb.toArray()).toEqual([1, 2]);
    expect(mockLogger.error).toHaveBeenCalledWith("Ring buffer is full. Capacity: 2");
  });

  it("overwrites oldest on overflow with force=true", () => {
    const rb = new RingBuffer("test", 2);
    rb.push("a");
    rb.push("b");
    rb.push("c", true); // overwrites "a"
    expect(rb.toArray()).toEqual(["b", "c"]);
    expect(mockLogger.warn).toHaveBeenCalledWith("Ring buffer is full. Overwriting the first item.");
  });

  it("get returns correct item", () => {
    const rb = new RingBuffer("test", 3);
    rb.push("x");
    rb.push("y");
    expect(rb.get(0)).toBe("x");
    expect(rb.get(1)).toBe("y");
  });

  it("get handles empty or invalid indices", () => {
    const rb = new RingBuffer("test", 2);
    expect(rb.get(0)).toBe(null);
    expect(mockLogger.warn).toHaveBeenCalledWith("Can't get from empty ring buffer", 0);

    rb.push("a");
    expect(rb.get(-1)).toBe(null);
    expect(rb.get(2)).toBe(null);
    expect(mockLogger.error).toHaveBeenCalledWith("Invalid index for get", 2, 1);
  });

  it("reset clears buffer", () => {
    const rb = new RingBuffer("test", 3);
    rb.push(1);
    rb.push(2);
    rb.reset();
    expect(rb.length).toBe(0);
    expect(rb.isEmpty()).toBe(true);
    expect(rb.pop()).toBe(null);
  });

  it("forEach iterates in order", () => {
    const rb = new RingBuffer("test", 3);
    rb.push("a");
    rb.push("b");
    const out = [];
    rb.forEach((x) => out.push(x));
    expect(out).toEqual(["a", "b"]);
  });

  it("toArray returns items in insertion order", () => {
    const rb = new RingBuffer("test", 3);
    rb.push(5);
    rb.push(6);
    expect(rb.toArray()).toEqual([5, 6]);
  });
});