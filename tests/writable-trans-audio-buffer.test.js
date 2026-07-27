import { describe, it, expect, beforeEach } from "vitest";
import { WritableTransAudioBuffer } from "@/media/buffers/writable-trans-audio-buffer.js";

const CAPACITY = 50;
const OVERFLOW_SHIFT = 10;

// The real constructor allocates a shared buffer and starts a 40 ms dispatcher
// interval, while only the write index bookkeeping is under test here
function createTransBuffer() {
  const buf = Object.create(WritableTransAudioBuffer.prototype);
  buf._capacity = CAPACITY;
  buf._useAtomics = false;
  buf._header = new Int32Array(2);
  buf._overflowShift = OVERFLOW_SHIFT;
  buf._fullBufferMargin = 2 * OVERFLOW_SHIFT;
  buf._isFull = false;
  buf._deferred = [];
  buf._preprocessors = [];
  buf._pendingMessages = []; // _sendMessage queues here while there is no port
  buf._dispData = { tss: [], idxs: [], rates: [], frames: [], buffers: [] };
  return buf;
}

describe("WritableTransAudioBuffer full buffer status", () => {
  let wtab;

  beforeEach(() => {
    wtab = createTransBuffer();
  });

  it("marks the buffer full and asks the reader to free space", () => {
    wtab.setReadIdx(5);
    wtab._incWriteIdx(0); // free space drops below the overflow threshold

    expect(wtab.isFull()).toBe(true);
    expect(wtab._pendingMessages).toContainEqual(
      expect.objectContaining({ data: { type: "tb:overflow" } }),
    );
  });

  it("stays full while the free space is below the margin", () => {
    wtab.setReadIdx(5);
    wtab._incWriteIdx(0);
    expect(wtab.isFull()).toBe(true);

    const wIdx = wtab.getWriteIdx();
    wtab.setReadIdx(wIdx + wtab._fullBufferMargin); // one frame short
    wtab._incWriteIdx(wIdx);

    expect(wtab.isFull()).toBe(true);
  });

  it("clears the full status once the free space reaches the margin", () => {
    wtab.setReadIdx(5);
    wtab._incWriteIdx(0);
    expect(wtab.isFull()).toBe(true);

    const wIdx = wtab.getWriteIdx();
    wtab.setReadIdx(wIdx + 1 + wtab._fullBufferMargin);
    wtab._incWriteIdx(wIdx);

    expect(wtab.isFull()).toBe(false);
  });

  it("clears the full status on a non-final reset", () => {
    wtab.setReadIdx(5);
    wtab._incWriteIdx(0);
    expect(wtab.isFull()).toBe(true);

    wtab.reset(); // no super.reset() call on this path
    expect(wtab.isFull()).toBe(false);
  });

  it("clears the full status on a final reset", () => {
    wtab.setReadIdx(5);
    wtab._incWriteIdx(0);
    expect(wtab.isFull()).toBe(true);

    wtab.reset(true);
    expect(wtab.isFull()).toBe(false);
  });
});
