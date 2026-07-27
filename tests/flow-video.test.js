import { describe, it, expect, vi, beforeEach } from "vitest";
import { DecoderFlowVideo } from "@/media/decoders/flow-video";
import { FrameBuffer } from "@/media/buffers/frame-buffer";

const DECODER_DATA = { decoderQueue: 0, decoderLatency: 0 };

function createMockFrame(timestamp) {
  return { timestamp, close: vi.fn() };
}

function createState() {
  return {
    isStopped: () => false,
    getPlaybackStartTsUs: () => 1,
    setVideoLatestTsUs: vi.fn(),
    setVideoDecoderQueue: vi.fn(),
    setVideoDecoderLatency: vi.fn(),
  };
}

// The real constructor spawns a decoder worker, only the decoded output
// handling is under test here
function createFlow(buffer) {
  const flow = Object.create(DecoderFlowVideo.prototype);
  flow.setBuffer(buffer, createState());
  flow._startTsUs = 1; // playback start ts is already known
  return flow;
}

describe("DecoderFlowVideo decoded buffer full notification", () => {
  let onDecodedBufferFull;

  beforeEach(() => {
    onDecodedBufferFull = vi.fn();
  });

  it("notifies once the frame buffer starts dropping frames", async () => {
    const buffer = new FrameBuffer("Test", "Video", 3);
    const flow = createFlow(buffer);
    flow.onDecodedBufferFull = onDecodedBufferFull;

    for (let i = 1; i <= 3; i++) {
      await flow._handleDecoderOutput(createMockFrame(i * 1000), DECODER_DATA);
    }
    expect(onDecodedBufferFull).not.toHaveBeenCalled();

    await flow._handleDecoderOutput(createMockFrame(4000), DECODER_DATA);
    expect(buffer.isFull()).toBe(true);
    expect(onDecodedBufferFull).toHaveBeenCalledTimes(1);
  });

  it("doesn't notify while the frame buffer has free space", async () => {
    const flow = createFlow(new FrameBuffer("Test", "Video", 10));
    flow.onDecodedBufferFull = onDecodedBufferFull;

    for (let i = 1; i <= 5; i++) {
      await flow._handleDecoderOutput(createMockFrame(i * 1000), DECODER_DATA);
    }

    expect(onDecodedBufferFull).not.toHaveBeenCalled();
  });

  it("doesn't throw when the buffer is gone before the frame is handled", async () => {
    const flow = createFlow(null);
    flow._startTsUs = 0;
    flow.onStartTsNotSet = async () => false;
    flow.onDecodedBufferFull = onDecodedBufferFull;

    await expect(
      flow._handleDecoderOutput(createMockFrame(1000), DECODER_DATA),
    ).resolves.toBeUndefined();
    expect(onDecodedBufferFull).not.toHaveBeenCalled();
  });
});
