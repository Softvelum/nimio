import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

// A flow with a fake decoder worker; destroy() touches exactly these fields
function createFlowWithWorker() {
  const flow = createFlow(createAudioBuffer());
  flow._logger = { debug: vi.fn(), error: vi.fn() };
  flow._decoder = {
    postMessage: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    terminate: vi.fn(),
  };
  flow._eventBus = { emit: vi.fn() };
  flow._metricsManager = { remove: vi.fn() };
  flow._timestampManager = { removeTrack: vi.fn() };
  flow._trackId = 7;
  flow._type = "audio";
  flow._addDecoderListener(); // as the constructor does
  return flow;
}

// The handler the fixture registered on the fake worker
function registeredListener(flow) {
  return flow._decoder.addEventListener.mock.calls[0][1];
}

describe("DecoderFlow.destroy() worker termination", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts shutdown and hard-terminates a worker that never acknowledges", () => {
    const flow = createFlowWithWorker();
    const decoder = flow._decoder;
    const listener = registeredListener(flow);

    flow.destroy();

    expect(decoder.postMessage).toHaveBeenCalledWith({ type: "shutdown" });
    vi.advanceTimersByTime(999);
    expect(decoder.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(decoder.terminate).toHaveBeenCalledTimes(1);
    expect(decoder.removeEventListener).toHaveBeenCalledWith(
      "message",
      listener,
    );
    expect(flow._decoder).toBeNull();
    expect(flow._buffer).toBeNull();
  });

  it("arms the fallback even when a switch already posted the shutdown", () => {
    const flow = createFlowWithWorker();
    const decoder = flow._decoder;
    flow._isShuttingDown = true; // finalizeSwitch() ran before destroy()

    flow.destroy();

    expect(decoder.postMessage).not.toHaveBeenCalled(); // no second shutdown
    vi.advanceTimersByTime(1000);
    expect(decoder.terminate).toHaveBeenCalledTimes(1);
    expect(flow._decoder).toBeNull();
    expect(flow._buffer).toBeNull();
  });

  it("does not terminate again when shutdownComplete arrived first", async () => {
    const flow = createFlowWithWorker();
    const decoder = flow._decoder;
    const listener = registeredListener(flow);

    flow.destroy();
    await flow._handleDecoderMessage({ data: { type: "shutdownComplete" } });
    expect(decoder.terminate).toHaveBeenCalledTimes(1);
    expect(decoder.removeEventListener).toHaveBeenCalledWith(
      "message",
      listener,
    );

    vi.advanceTimersByTime(1000);

    expect(decoder.terminate).toHaveBeenCalledTimes(1);
    expect(flow._decoder).toBeNull();
  });

  it("ignores a shutdownComplete that arrives after the fallback fired", async () => {
    const flow = createFlowWithWorker();
    const decoder = flow._decoder;

    flow.destroy();
    vi.advanceTimersByTime(1000);
    expect(decoder.terminate).toHaveBeenCalledTimes(1);

    await expect(
      flow._handleDecoderMessage({ data: { type: "shutdownComplete" } }),
    ).resolves.not.toThrow();

    expect(decoder.terminate).toHaveBeenCalledTimes(1);
  });

  it("is a no-op without a worker and arms no timer", () => {
    const flow = createFlowWithWorker();
    flow._decoder = null;

    expect(() => flow.destroy()).not.toThrow();

    expect(vi.getTimerCount()).toBe(0);
  });
});
