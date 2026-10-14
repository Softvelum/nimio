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
  flow._timestampManager = { removeTrack: vi.fn(), updateTimeBase: vi.fn() };
  flow._trackId = 7;
  flow._type = "audio";
  flow.onInputCancel = vi.fn(); // the engine always sets it
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

describe("DecoderFlow after destroy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("destroy twice posts one shutdown and arms one timer", () => {
    const flow = createFlowWithWorker();
    const decoder = flow._decoder;

    flow.destroy();
    flow.destroy();

    expect(decoder.postMessage).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("a frame arriving after destroy is closed and not pushed", async () => {
    const flow = createFlowWithWorker();
    flow.destroy();
    const audioFrame = createMockAudioFrame(0);

    await flow._handleDecoderMessage({
      data: {
        type: "decodedFrame",
        audioFrame,
        decTimestamp: 0,
        rawTimestamp: 0,
      },
    });

    expect(audioFrame.close).toHaveBeenCalledTimes(1);
  });

  it("a decoder error arriving after destroy calls nothing", async () => {
    const flow = createFlowWithWorker();
    flow.onDecodingError = vi.fn();
    flow.destroy();
    flow._decoder = { postMessage: vi.fn() }; // would be touched by a second destroy()

    await flow._handleDecoderMessage({ data: { type: "decoderError" } });

    expect(flow.onDecodingError).not.toHaveBeenCalled();
    expect(flow._decoder.postMessage).not.toHaveBeenCalled();
  });

  it("shutdownComplete on a destroyed flow terminates the worker and adopts nothing", async () => {
    const flow = createFlowWithWorker();
    const decoder = flow._decoder;
    const peer = { exportDecoder: vi.fn(), buffer: null, isActive: () => true };
    flow._isShuttingDown = true; // finalizeSwitch already posted shutdown
    flow._switchPeerFlow = peer;
    flow._switchContext = { dst: true };
    flow.onSwitchResult = vi.fn();

    flow.destroy(); // clears the peer pointer
    flow._switchPeerFlow = peer; // simulate a pointer that survived anyway
    await flow._handleDecoderMessage({ data: { type: "shutdownComplete" } });

    expect(decoder.terminate).toHaveBeenCalledTimes(1);
    expect(peer.exportDecoder).not.toHaveBeenCalled();
    expect(flow._decoder).toBeNull();
    expect(flow._switchPeerFlow).toBeNull();
    expect(flow._switchContext).toBeNull();
  });

  it("a frame whose start-ts handler was pending when the flow was destroyed is closed", async () => {
    const flow = createFlowWithWorker();
    flow._startTsUs = 0;
    flow.onStartTsNotSet = async () => {
      flow.destroy(); // playback reset while the engine initialised output
      return true;
    };
    const audioFrame = createMockAudioFrame(0);

    await expect(flow._handleDecodedFrame(audioFrame)).resolves.toBe(false);

    expect(audioFrame.close).toHaveBeenCalledTimes(1);
  });

  it("a throwing start-ts handler closes the frame and reports failure", async () => {
    const flow = createFlowWithWorker();
    flow._startTsUs = 0;
    flow.onStartTsNotSet = () => Promise.reject(new Error("cancelled"));
    const audioFrame = createMockAudioFrame(0);

    await expect(flow._handleDecodedFrame(audioFrame)).resolves.toBe(false);

    expect(audioFrame.close).toHaveBeenCalledTimes(1);
    expect(flow._logger.error).toHaveBeenCalled();
  });
});

const SWITCH_ABORT_MSG =
  "Rendition switch aborted: the new rendition's decoder stopped";

// A main flow (dst) switching to a new rendition flow (src), as
// NimioTransport does: main.switchTo(src) pairs them both ways.
function createSwitchPair() {
  const main = createFlowWithWorker();
  const src = createFlowWithWorker();
  main.onSwitchResult = vi.fn();
  main.onDecodingError = vi.fn();
  main.switchTo(src);
  expect(main._switchContext?.dst).toBe(true);
  expect(src._switchContext?.src).toBe(true);
  expect(src._switchPeerFlow).toBe(main);
  return { main, src };
}

describe("DecoderFlow switch abort", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("destroying the src peer clears the main flow's switch and reports once", () => {
    const { main, src } = createSwitchPair();

    src.destroy();

    expect(main._switchContext).toBeNull();
    expect(main._switchPeerFlow).toBeNull();
    expect(main.onSwitchResult).toHaveBeenCalledTimes(1);
    expect(main.onSwitchResult).toHaveBeenCalledWith(false, SWITCH_ABORT_MSG);
    expect(main.onDecodingError).not.toHaveBeenCalled();
    expect(main._startSwitch("dst")).toBe(true); // a new switch can start
  });

  it("escalates to a decoding error when the peer dies after the main flow's input was cancelled", () => {
    const { main, src } = createSwitchPair();
    main._cancelInput(); // processChunk() cancelled the main stream, finalize not yet started

    src.destroy();

    expect(main.onSwitchResult).toHaveBeenCalledTimes(1);
    expect(main.onDecodingError).toHaveBeenCalledTimes(1);
    expect(main.onDecodingError).toHaveBeenCalledWith("audio");
  });

  it("escalates to a decoding error when the peer dies after the main flow committed", () => {
    const { main, src } = createSwitchPair();
    main.finalizeSwitch(); // input cancelled, own shutdown posted: no way back

    src.destroy();

    expect(main.onSwitchResult).toHaveBeenCalledTimes(1);
    expect(main.onSwitchResult).toHaveBeenCalledWith(false, SWITCH_ABORT_MSG);
    expect(main.onDecodingError).toHaveBeenCalledTimes(1);
    expect(main.onDecodingError).toHaveBeenCalledWith("audio");
    expect(main._switchContext).toBeNull();
    expect(main._switchPeerFlow).toBeNull();
  });

  it("is silent when the main flow's playback is already stopped (teardown)", () => {
    const { main, src } = createSwitchPair();
    main._state.isStopped = () => true;

    src.destroy();

    expect(main._switchContext).toBeNull();
    expect(main._switchPeerFlow).toBeNull();
    expect(main.onSwitchResult).not.toHaveBeenCalled();
  });

  it("a decoder error on the src flow destroys it and fails the switch via the main flow", async () => {
    const { main, src } = createSwitchPair();
    const srcDecoder = src._decoder;

    await src._handleDecoderMessage({ data: { type: "decoderError" } });

    expect(srcDecoder.postMessage).toHaveBeenCalledWith({ type: "shutdown" });
    expect(main.onSwitchResult).toHaveBeenCalledTimes(1);
    expect(main.onSwitchResult).toHaveBeenCalledWith(false, SWITCH_ABORT_MSG);
    expect(src._switchPeerFlow).toBeNull();
  });

  it("the main flow's excessive-gap abort reports exactly once", () => {
    const { main, src } = createSwitchPair();
    src._switchContext.firstTsUs = 1_000;
    const srcDecoder = src._decoder;

    main._handleDstSwitchFrame({ timestamp: 20_000_000 });

    expect(srcDecoder.postMessage).toHaveBeenCalledWith({ type: "shutdown" });
    expect(main.onSwitchResult).toHaveBeenCalledTimes(1);
    expect(main.onSwitchResult.mock.calls[0][0]).toBe(false);
    expect(main.onDecodingError).not.toHaveBeenCalled(); // input still flowing
    expect(main._switchContext).toBeNull();
    expect(main._switchPeerFlow).toBeNull();
  });

  it("the excessive-gap abort escalates when the main input was already cancelled", () => {
    const { main, src } = createSwitchPair();
    main._cancelInput(); // a matching key chunk cancelled the main stream
    src._switchContext.firstTsUs = 1_000;
    const srcDecoder = src._decoder;

    main._handleDstSwitchFrame({ timestamp: 20_000_000 });

    expect(srcDecoder.postMessage).toHaveBeenCalledWith({ type: "shutdown" });
    expect(main.onSwitchResult).toHaveBeenCalledTimes(1);
    expect(main.onDecodingError).toHaveBeenCalledTimes(1);
    expect(main.onDecodingError).toHaveBeenCalledWith("audio");
    expect(main._switchContext).toBeNull();
    expect(main._switchPeerFlow).toBeNull();
  });

  it("does not adopt from a peer that is no longer active", async () => {
    const { main, src } = createSwitchPair();
    const mainDecoder = main._decoder;
    main._isShuttingDown = true; // finalizeSwitch posted the shutdown
    src._buffer = null; // peer released without notifying (defensive path)

    await main._handleDecoderMessage({ data: { type: "shutdownComplete" } });

    expect(mainDecoder.terminate).toHaveBeenCalledTimes(1);
    expect(main._decoder).toBeNull();
    expect(main._switchPeerFlow).toBeNull();
    expect(main._switchContext).toBeNull();
    expect(main.onSwitchResult).toHaveBeenCalledTimes(1);
    expect(main.onSwitchResult).toHaveBeenCalledWith(false, SWITCH_ABORT_MSG);
    expect(main.onDecodingError).toHaveBeenCalledWith("audio"); // no decoder left
  });

  it("destroying the main flow clears the src peer without a report", () => {
    const { main, src } = createSwitchPair();

    main.destroy();

    expect(src._switchContext).toBeNull();
    expect(src._switchPeerFlow).toBeNull();
    expect(main.onSwitchResult).not.toHaveBeenCalled();
  });
});

describe("DecoderFlowAudio output after destroy", () => {
  it("writes no state when the flow was destroyed during the start-ts await", async () => {
    const flow = createFlowWithWorker();
    flow._startTsUs = 0;
    flow.onStartTsNotSet = async () => {
      flow.destroy();
      return true;
    };
    flow.onDecodedBufferFull = vi.fn();

    await flow._handleDecoderOutput(createMockAudioFrame(0), DECODER_DATA);

    expect(flow._state.setAudioDecoderQueue).not.toHaveBeenCalled();
    expect(flow._state.setAudioLatestTsUs).not.toHaveBeenCalled();
    expect(flow.onDecodedBufferFull).not.toHaveBeenCalled();
  });
});
