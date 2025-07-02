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

function createTestBuffer(options = {}) {
  const {
    bufferSec = 1,
    sampleRate = 48000,
    numChannels = 2,
    sampleCount = 960,
  } = options;
  return WritableAudioBuffer.allocate(bufferSec, sampleRate, numChannels, sampleCount);
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

  it("pushFrame throws if audioFrame.numberOfFrames mismatch", () => {
    const badFrame = createMockAudioFrame({ numberOfFrames: wab.sampleCount - 1 });
    expect(() => wab.pushFrame(badFrame)).toThrow(
      `audioFrame must contain ${wab.sampleCount} samples, got ${badFrame.numberOfFrames}`,
    );
  });

  it("pushFrame calls preprocessors process method", () => {
    const preprocessor = { process: vi.fn(), setBufferIface() {} };
    wab.addPreprocessor(preprocessor);
    const frame = createMockAudioFrame();

    wab.pushFrame(frame);

    expect(preprocessor.process).toHaveBeenCalledWith(frame, wab);
  });

  it("pushFrame copies planar data per channel when format ends with -planar", () => {
    const frame = createMockAudioFrame({ format: "f32-planar" });
    const spyCopyTo = vi.spyOn(frame, "copyTo");

    wab.pushFrame(frame);

    expect(spyCopyTo).toHaveBeenCalledTimes(wab.numChannels);
    for (let ch = 0; ch < wab.numChannels; ch++) {
      expect(spyCopyTo).toHaveBeenCalledWith(
        wab.frames[wab.getWriteIdx() - 1].subarray(
          ch * wab.sampleCount,
          (ch + 1) * wab.sampleCount,
        ),
        { layout: "planar", planeIndex: ch },
      );
    }
  });

  it("pushFrame copies interleaved data correctly when numChannels > 1 and format is not planar", () => {
    const frame = createMockAudioFrame({ format: "f32-interleaved" });
    const spyCopyTo = vi.spyOn(frame, "copyTo");

    wab.pushFrame(frame);

    expect(spyCopyTo).toHaveBeenCalledWith(wab.temp, {
      layout: "interleaved",
      planeIndex: 0,
    });

    const lastWriteIdx = wab.getWriteIdx() - 1;
    const frameBuffer = wab.frames[lastWriteIdx];

    for (let ch = 0; ch < wab.numChannels; ch++) {
      for (let i = 0; i < wab.sampleCount; i++) {
        // frameBuffer is arranged by channels, so
        // frameBuffer[ch * sampleCount + i] should equal temp[ch + i * numChannels]
        expect(frameBuffer[ch * wab.sampleCount + i]).toBe(
          wab.temp[i * wab.numChannels + ch],
        );
      }
    }
  });

  it("pushFrame copies interleaved data correctly when numChannels == 1 and format is not planar", () => {
    const singleChannelBuffer = WritableAudioBuffer.allocate(
      1,
      48000,
      1,
      960,
    );
    singleChannelBuffer.reset();

    const frame = createMockAudioFrame({
      format: "f32",
      numberOfFrames: 960,
    });

    const spyCopyTo = vi.spyOn(frame, "copyTo");

    singleChannelBuffer.pushFrame(frame);

    expect(spyCopyTo).toHaveBeenCalledWith(singleChannelBuffer.frames[singleChannelBuffer.getWriteIdx() - 1], {
      layout: "planar",
      planeIndex: 0,
    });
  });

  it("pushFrame sets timestamp correctly and increments write index", () => {
    const frame = createMockAudioFrame();
    const initialWriteIdx = wab.getWriteIdx();

    wab.pushFrame(frame);

    expect(wab.timestamps[initialWriteIdx]).toBe(frame.decTimestamp);
    expect(wab.getWriteIdx()).toBe((initialWriteIdx + 1) % wab.capacity);
  });

  it("pushSilence fills frame with zeros, sets timestamp and increments write index", () => {
    const initialWriteIdx = wab.getWriteIdx();
    wab.pushSilence(999999);

    expect(wab.timestamps[initialWriteIdx]).toBe(999999);
    const frame = wab.frames[initialWriteIdx];
    for (let i = 0; i < frame.length; i++) {
      expect(frame[i]).toBe(0);
    }
    expect(wab.getWriteIdx()).toBe((initialWriteIdx + 1) % wab.capacity);
  });
});
