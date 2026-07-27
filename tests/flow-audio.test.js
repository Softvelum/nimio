import { describe, it, expect, vi, beforeEach } from "vitest";
import { DecoderFlowAudio } from "@/media/decoders/flow-audio";
import { WritableAudioBuffer } from "@/media/buffers/writable-audio-buffer.js";

const SAMPLE_RATE = 48000;
const SAMPLE_COUNT = 960;
const FRAME_US = (SAMPLE_COUNT * 1e6) / SAMPLE_RATE;
const DECODER_DATA = { decoderQueue: 0 };

function createMockAudioFrame(decTimestamp) {
  return {
    decTimestamp,
    numberOfFrames: SAMPLE_COUNT,
    format: "f32-planar",
    copyTo(target) {
      target.fill(1);
    },
    close: vi.fn(),
  };
}

function createState() {
  return {
    isStopped: () => false,
    getPlaybackStartTsUs: () => 1,
    setAudioLatestTsUs: vi.fn(),
    setAudioDecoderQueue: vi.fn(),
  };
}

// The real constructor spawns a decoder worker, only the decoded output
// handling is under test here
function createFlow(buffer) {
  const flow = Object.create(DecoderFlowAudio.prototype);
  flow.setBuffer(buffer, createState());
  flow._startTsUs = 1; // playback start ts is already known
  return flow;
}

function createAudioBuffer() {
  const buffer = WritableAudioBuffer.allocate(1, SAMPLE_RATE, 2, SAMPLE_COUNT);
  buffer.reset();
  return buffer;
}

describe("DecoderFlowAudio decoded buffer full notification", () => {
  let onDecodedBufferFull;

  beforeEach(() => {
    onDecodedBufferFull = vi.fn();
  });

  it("notifies once the audio buffer runs out of space", async () => {
    const buffer = createAudioBuffer();
    const flow = createFlow(buffer);
    flow.onDecodedBufferFull = onDecodedBufferFull;

    const cap = buffer.bufferCapacity;
    for (let i = 0; i < cap - 1; i++) {
      const frame = createMockAudioFrame(i * FRAME_US);
      await flow._handleDecoderOutput(frame, DECODER_DATA);
    }
    expect(onDecodedBufferFull).not.toHaveBeenCalled();

    await flow._handleDecoderOutput(
      createMockAudioFrame((cap - 1) * FRAME_US),
      DECODER_DATA,
    );

    expect(buffer.isFull()).toBe(true);
    expect(onDecodedBufferFull).toHaveBeenCalledTimes(1);
  });

  it("doesn't throw when the buffer is gone before the frame is handled", async () => {
    const flow = createFlow(null);
    flow._startTsUs = 0;
    flow.onStartTsNotSet = async () => false; // e.g. incompatible audio config
    flow.onDecodedBufferFull = onDecodedBufferFull;

    await expect(
      flow._handleDecoderOutput(createMockAudioFrame(0), DECODER_DATA),
    ).resolves.toBeUndefined();
    expect(onDecodedBufferFull).not.toHaveBeenCalled();
  });
});
