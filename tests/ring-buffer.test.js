import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockLogger } from "./mocks/logger-mock";
import { RingBuffer } from "@/shared/ring-buffer";

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
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Can't pop from empty ring buffer",
    );
  });

  it("puhes and pops sequentially", () => {
    const rb = new RingBuffer("test", 2);
    rb.push("a");
    rb.push("b");
    expect(rb.pop()).toBe("a");
    rb.push("c");
    expect(rb.pop()).toBe("b");
    expect(rb.pop()).toBe("c");
    expect(rb.pop()).toBe(null); // empty now
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
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Ring buffer is full. Capacity: 2",
    );
  });

  it("overwrites oldest on overflow with force=true", () => {
    const rb = new RingBuffer("test", 2);
    rb.push("a");
    rb.push("b");
    rb.push("c", true); // overwrites "a"
    expect(rb.toArray()).toEqual(["b", "c"]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Ring buffer is full. Overwriting the first item.",
    );
  });

  it("works correctly for edge case with force=true", () => {
    const rb = new RingBuffer("test", 3);
    rb.push("a");
    rb.push("b");
    rb.push("c");
    expect(rb.pop()).toBe("a");
    expect(rb.pop()).toBe("b");
    rb.push("d");
    rb.push("e");
    rb.push("f", true); // should overwrite "c"
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Ring buffer is full. Overwriting the first item.",
    );
  });

  it("get returns correct item", () => {
    const rb = new RingBuffer("test", 3);
    rb.push("x");
    rb.push("y");
    expect(rb.get(0)).toBe("x");
    expect(rb.get(1)).toBe("y");
    rb.push("z");
    expect(rb.pop()).toBe("x");
    expect(rb.pop()).toBe("y");
    rb.push("a");
    rb.push("b");
    expect(rb.get(0)).toBe("z");
    expect(rb.get(2)).toBe("b");
  });

  it("get handles empty or invalid indices", () => {
    const rb = new RingBuffer("test", 2);
    expect(rb.get(0)).toBe(null);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Can't get from empty ring buffer",
      0,
    );

    rb.push("a");
    expect(rb.get(-1)).toBe(null);
    expect(rb.get(2)).toBe(null);
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Invalid index for get",
      2,
      1,
    );
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

  it("forEach iterates in order circulary", () => {
    const rb = new RingBuffer("test", 3);
    rb.push("a");
    rb.push("b");
    rb.push("c");
    rb.pop();
    rb.pop();
    rb.push("d");
    rb.push("e");
    const out = [];
    rb.forEach((x) => out.push(x));
    expect(out).toEqual(["c", "d", "e"]);
  });

  it("toArray returns items in insertion order", () => {
    const rb = new RingBuffer("test", 3);
    rb.push(5);
    rb.push(6);
    expect(rb.toArray()).toEqual([5, 6]);
  });

  it("toArray returns items in insertion order circulary", () => {
    const rb = new RingBuffer("test", 3);
    rb.push(5);
    rb.push(6);
    rb.push(7);
    rb.pop();
    rb.pop();
    rb.push(70);
    rb.push(80);
    expect(rb.toArray()).toEqual([7, 70, 80]);
  });
});
