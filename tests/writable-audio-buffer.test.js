import { describe, it, expect, vi, beforeEach } from "vitest";
import { WritableAudioBuffer } from "@/media/buffers/writable-audio-buffer.js";

function createMockAudioFrame(options = {}) {
  const {
    numberOfFrames = 960,
    decTimestamp = 12345,
    format = "f32-planar",
  } = options;

  // Mock copyTo method to copy data into target TypedArray
  return {
    numberOfFrames,
    decTimestamp,
    format,
    copyTo(target, opts) {
      // Fill target with pattern to verify copy
      const mod = opts.planeIndex || 0;
      for (let i = 0; i < target.length; i++) {
        target[i] = 42 + mod + i;
      }
    },
  };
}

function snapshotMock(impl) {
  const calls = [];

  const mock = vi.fn((...args) => {
    // clone arguments at call time
    const snap = args.map((arg) =>
      typeof arg === "object" && arg !== null ? structuredClone(arg) : arg,
    );

    calls.push(snap);

    return impl?.(...args);
  });

  mock.snapshots = calls;

  return mock;
}

function createTestBuffer(options = {}) {
  const {
    bufferSec = 1,
    sampleRate = 48000,
    numChannels = 2,
    sampleCount = 960,
  } = options;
  return WritableAudioBuffer.allocate(
    bufferSec,
    sampleRate,
    numChannels,
    sampleCount,
  );
}

describe("WritableAudioBuffer", () => {
  let wab;

  beforeEach(() => {
    wab = createTestBuffer();
    wab.reset();
  });

  it("adds preprocessor and calls setBufferIface", () => {
    const preprocessor = {
      setBufferIface: vi.fn(),
    };
    wab.addPreprocessor(preprocessor);
    expect(wab._preprocessors).toContain(preprocessor);
    expect(preprocessor.setBufferIface).toHaveBeenCalledWith(wab);
  });

  it("reset clears preprocessors and calls their reset methods", () => {
    const preprocessor1 = { reset: vi.fn(), setBufferIface() {} };
    const preprocessor2 = { reset: vi.fn(), setBufferIface() {} };
    wab.addPreprocessor(preprocessor1);
    wab.addPreprocessor(preprocessor2);

    wab.reset();

    expect(preprocessor1.reset).toHaveBeenCalled();
    expect(preprocessor2.reset).toHaveBeenCalled();
    expect(wab._preprocessors.length).toBe(0);

    expect(wab.getWriteIdx()).toBe(0);
    expect(wab.getReadIdx()).toBe(0);
  });

  it("pushFrame calls preprocessors process method", () => {
    const preprocessor = { process: vi.fn(), setBufferIface() {} };
    wab.addPreprocessor(preprocessor);
    const frame = createMockAudioFrame();

    wab.pushFrame(frame);

    expect(preprocessor.process).toHaveBeenCalledWith(frame);
  });

  it("pushFrame copies planar data per channel when format ends with -planar", () => {
    const frame = createMockAudioFrame({ format: "f32-planar" });
    frame.copyTo = snapshotMock(frame.copyTo);

    wab.pushFrame(frame);

    expect(frame.copyTo.snapshots.length).toBe(wab.numChannels);
    for (let ch = 0; ch < wab.numChannels; ch++) {
      const snapArr = new Float32Array(frame.copyTo.snapshots[ch][0]);
      expect(snapArr).toEqual(
        wab._frames[wab.getWriteIdx() - 1].subarray(
          ch * wab.sampleCount,
          (ch + 1) * wab.sampleCount,
        ),
      );
      expect(frame.copyTo.snapshots[ch][1]).toEqual({
        planeIndex: ch,
        frameOffset: 0,
      });
    }
  });

  it("pushFrame copies s16-planar data per channel", () => {
    const frame = createMockAudioFrame({ format: "s16-planar" });
    frame.copyTo = snapshotMock(frame.copyTo);

    wab.pushFrame(frame);

    expect(frame.copyTo.snapshots.length).toBe(wab.numChannels);
    for (let ch = 0; ch < wab.numChannels; ch++) {
      const snapArr = new Int16Array(frame.copyTo.snapshots[ch][0]);
      expect(snapArr).toEqual(wab._tempI16);
      expect(frame.copyTo.snapshots[ch][1]).toEqual({
        planeIndex: ch,
        frameOffset: 0,
      });
    }

    let lastChannel = wab._frames[wab.getWriteIdx() - 1].subarray(
      wab.sampleCount,
      2 * wab.sampleCount,
    );
    for (let i = 0; i < wab.sampleCount; i++) {
      expect(lastChannel[i]).toBe(wab._tempI16[i] / 32768);
    }
  });

  it("pushFrame copies f32-interleaved data correctly when numChannels > 1 and format is not planar", () => {
    const frame = createMockAudioFrame({ format: "f32-interleaved" });
    const spyCopyTo = vi.spyOn(frame, "copyTo");

    wab.pushFrame(frame);

    expect(spyCopyTo).toHaveBeenCalledWith(wab._tempF32, {
      planeIndex: 0,
      frameOffset: 0,
    });

    const lastWriteIdx = wab.getWriteIdx() - 1;
    const fBuffer = wab._frames[lastWriteIdx];

    for (let ch = 0; ch < wab.numChannels; ch++) {
      for (let i = 0; i < wab.sampleCount; i++) {
        // fBuffer is arranged by channels, so
        // fBuffer[ch * sampleCount + i] should equal temp[ch + i * numChannels]
        expect(fBuffer[ch * wab.sampleCount + i]).toBe(
          wab._tempF32[i * wab.numChannels + ch],
        );
      }
    }
  });

  it("pushFrame copies s16-interleaved data correctly when numChannels > 1 and format is not planar", () => {
    const frame = createMockAudioFrame({ format: "s16-interleaved" });
    const spyCopyTo = vi.spyOn(frame, "copyTo");

    wab.pushFrame(frame);

    expect(spyCopyTo).toHaveBeenCalledWith(wab._tempI16, {
      planeIndex: 0,
      frameOffset: 0,
    });

    const lastWriteIdx = wab.getWriteIdx() - 1;
    const fBuffer = wab._frames[lastWriteIdx];

    for (let ch = 0; ch < wab.numChannels; ch++) {
      for (let i = 0; i < wab.sampleCount; i++) {
        // fBuffer is arranged by channels, so
        // fBuffer[ch * sampleCount + i] should equal temp[ch + i * numChannels]
        expect(fBuffer[ch * wab.sampleCount + i]).toBe(
          wab._tempI16[i * wab.numChannels + ch] / 32768,
        );
      }
    }
  });

  it("pushFrame copies interleaved data correctly when numChannels == 1 and format is not planar", () => {
    const singleChannelBuffer = WritableAudioBuffer.allocate(1, 48000, 1, 960);
    singleChannelBuffer.reset();

    const frame = createMockAudioFrame({
      format: "f32",
      numberOfFrames: 960,
    });

    const spyCopyTo = vi.spyOn(frame, "copyTo");

    singleChannelBuffer.pushFrame(frame);

    expect(spyCopyTo).toHaveBeenCalledWith(
      singleChannelBuffer._frames[singleChannelBuffer.getWriteIdx() - 1],
      {
        planeIndex: 0,
        frameOffset: 0,
      },
    );
  });

  it("pushFrame sets timestamp correctly and increments write index", () => {
    const frame = createMockAudioFrame();
    const initialWriteIdx = wab.getWriteIdx();

    wab.pushFrame(frame);

    expect(wab._timestamps[initialWriteIdx]).toBe(frame.decTimestamp);
    expect(wab.getWriteIdx()).toBe((initialWriteIdx + 1) % wab.bufferCapacity);
  });

  it("pushSilence fills frame with zeros, sets timestamp and increments write index", () => {
    const initialWriteIdx = wab.getWriteIdx();
    wab.pushSilence(999999);

    expect(wab._timestamps[initialWriteIdx]).toBe(999999);
    const frame = wab._frames[initialWriteIdx];
    for (let i = 0; i < frame.length; i++) {
      expect(frame[i]).toBe(0);
    }
    expect(wab.getWriteIdx()).toBe((initialWriteIdx + 1) % wab.bufferCapacity);
  });

  describe("full buffer status", () => {
    const FRAME_US = 20000; // 960 samples at 48000 Hz

    it("starts not full and derives the margin from the overflow shift", () => {
      expect(wab.isFull()).toBe(false);
      expect(wab._fullBufferMargin).toBe(2 * wab._overflowShift);
    });

    it("becomes full when the writer wraps onto the reader", () => {
      const cap = wab.bufferCapacity;
      for (let i = 0; i < cap - 1; i++) {
        wab.pushFrame(createMockAudioFrame({ decTimestamp: i * FRAME_US }));
        expect(wab.isFull()).toBe(false);
      }

      wab.pushFrame(
        createMockAudioFrame({ decTimestamp: (cap - 1) * FRAME_US }),
      );
      expect(wab.isFull()).toBe(true);
    });

    it("stays full while the free space is below the margin", () => {
      wab.setReadIdx(5);
      wab._incWriteIdx(4); // write idx catches up with the read idx

      expect(wab.isFull()).toBe(true);
      expect(wab.getReadIdx()).toBe(5 + wab._overflowShift);

      // the reader is only _overflowShift frames ahead, that's less than margin
      wab._incWriteIdx(wab.getWriteIdx());
      expect(wab.isFull()).toBe(true);
    });

    it("clears the full status once the free space reaches the margin", () => {
      wab.setReadIdx(5);
      wab._incWriteIdx(4);
      expect(wab.isFull()).toBe(true);

      const wIdx = wab.getWriteIdx();
      wab.setReadIdx(wIdx + 1 + wab._fullBufferMargin);
      wab._incWriteIdx(wIdx);

      expect(wab.isFull()).toBe(false);
    });

    it("reset clears the full status", () => {
      wab.setReadIdx(5);
      wab._incWriteIdx(4);
      expect(wab.isFull()).toBe(true);

      wab.reset();
      expect(wab.isFull()).toBe(false);
    });
  });
});
