import { describe, it, beforeEach, vi, expect } from "vitest";

let postMessageMock;
let nowMock;
let decodeMock;
let configureMock;
let isConfigSupportedMock;
let AudioDecoderMock;
let EncodedAudioChunkMock;
let timestampBufferMock;
let skipOutput;
let outputSecondFrame;
let errorCallback;

vi.mock("@/shared/ring-buffer.js", () => {
  return {
    RingBuffer: vi.fn().mockImplementation(() => timestampBufferMock),
  };
});

function setupWorkerGlobals() {
  const eventTarget = new EventTarget();
  globalThis.addEventListener = eventTarget.addEventListener.bind(eventTarget);
  globalThis.removeEventListener =
    eventTarget.removeEventListener.bind(eventTarget);
  globalThis.dispatchEvent = eventTarget.dispatchEvent.bind(eventTarget);

  globalThis.postMessage = postMessageMock = vi.fn();
  globalThis.performance = { now: (nowMock = vi.fn(() => 1000)) };

  decodeMock = vi.fn();
  configureMock = vi.fn();
  isConfigSupportedMock = vi.fn(async () => ({ supported: true }));
  timestampBufferMock = {
    reset: vi.fn(),
    push: vi.fn(),
    pop: vi.fn(() => 1000),
  };

  EncodedAudioChunkMock = vi.fn(function (data) {
    Object.assign(this, data);
  });

  AudioDecoderMock = vi.fn(({ output, error }) => {
    errorCallback = error;
    setTimeout(() => {
      if (skipOutput) return;
      output({ timestamp: 1000, close: vi.fn() });
      if (!outputSecondFrame) return;
      output({ timestamp: 2000, close: vi.fn() });
    }, 0);

    return {
      decode: decodeMock,
      configure: configureMock,
      decodeQueueSize: 2,
    };
  });
  AudioDecoderMock.isConfigSupported = isConfigSupportedMock;

  globalThis.AudioDecoder = AudioDecoderMock;
  globalThis.EncodedAudioChunk = EncodedAudioChunkMock;

  skipOutput = false;
}

describe("decoder-audio", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    setupWorkerGlobals();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("configures decoder and processes codecData", async () => {
    await import("@/media/decoders/decoder-audio.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "config",
          config: { codec: "mp4a.40.2" },
        },
      }),
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1, 2, 3]),
          config: {
            codec: "mp4a.40.2",
            sampleRate: 48000,
            numberOfChannels: 2,
            sampleCount: 1024,
          },
        },
      }),
    );

    await Promise.resolve();
    expect(AudioDecoderMock).toHaveBeenCalled();
    expect(configureMock).toHaveBeenCalled();
  });

  it("decodes audio chunk and outputs audioFrame", async () => {
    await import("@/media/decoders/decoder-audio.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "config",
          config: { codec: "mp4a.40.2" },
        },
      }),
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1, 2, 3]),
          config: {
            codec: "mp4a.40.2",
            sampleRate: 48000,
            numberOfChannels: 2,
            sampleCount: 1024,
          },
        },
      }),
    );

    await Promise.resolve();

    const frameWithHeader = new Uint8Array([10, 20, 30, 40]);
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "chunk",
          timestamp: 1000,
          frameWithHeader,
          framePos: 1,
        },
      }),
    );

    vi.runAllTimers();
    expect(decodeMock).toHaveBeenCalled();
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "decodedFrame",
        rawTimestamp: 1000,
        decTimestamp: 1000,
      }),
      expect.any(Array),
    );
  });

  it("passes computed timestamp if decoded one is different", async () => {
    timestampBufferMock.pop = vi
      .fn()
      .mockReturnValueOnce(999)
      .mockReturnValueOnce(1000);

    await import("@/media/decoders/decoder-audio.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "config",
          config: { codec: "mp4a.40.2" },
        },
      }),
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1, 2, 3]),
          config: {
            codec: "mp4a.40.2",
            sampleRate: 48000,
            numberOfChannels: 2,
            sampleCount: 1024,
          },
        },
      }),
    );

    await Promise.resolve();

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "chunk",
          timestamp: 999,
          frameWithHeader: new Uint8Array([1, 2, 3]),
          framePos: 0,
        },
      }),
    );

    vi.runAllTimers();
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "decodedFrame",
        rawTimestamp: 999,
        decTimestamp: 1000,
      }),
      expect.any(Array),
    );
  });

  it("computes timestamps according to the sample rate", async () => {
    outputSecondFrame = true;
    timestampBufferMock.pop = vi
      .fn()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2000);

    await import("@/media/decoders/decoder-audio.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "config",
          config: { codec: "mp4a.40.2" },
        },
      }),
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1, 2, 3]),
          config: {
            codec: "mp4a.40.2",
            sampleRate: 48000,
            numberOfChannels: 2,
            sampleCount: 1024,
          },
        },
      }),
    );

    await Promise.resolve();

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "chunk",
          timestamp: 1000,
          frameWithHeader: new Uint8Array([1, 2, 3]),
          framePos: 0,
        },
      }),
    );

    vi.runAllTimers();
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "decodedFrame",
        rawTimestamp: 1000,
        decTimestamp: 1000,
      }),
      expect.any(Array),
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "chunk",
          timestamp: 1000,
          frameWithHeader: new Uint8Array([1, 2, 3]),
          framePos: 0,
        },
      }),
    );

    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "decodedFrame",
        rawTimestamp: 2000,
        decTimestamp: 22333.333333333332,
      }),
      expect.any(Array),
    );
  });

  it("emits decoderError message if decoder fails during configure", async () => {
    skipOutput = true;
    configureMock.mockImplementationOnce(() => {
      throw new Error("Configuration failed");
    });

    await import("@/media/decoders/decoder-audio.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "config",
          config: { codec: "mp4a.40.34" },
        },
      }),
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1, 2, 3]),
          config: {
            codec: "mp4a.40.34",
            sampleRate: 48000,
            numberOfChannels: 2,
            sampleCount: 1024,
          },
        },
      }),
    );

    await Promise.resolve();
    vi.runAllTimers();
    expect(postMessageMock).toHaveBeenCalledWith({
      type: "decoderError",
      kind: "audio",
    });
  });

  it("handles decoder error", async () => {
    await import("@/media/decoders/decoder-audio.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "config",
          config: { codec: "aac" },
        },
      }),
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1, 2]),
          config: {
            codec: "aac",
            sampleRate: 48000,
            numberOfChannels: 2,
            sampleCount: 1024,
          },
        },
      }),
    );

    // Simulate decoder error
    errorCallback(new Error("Something went wrong"));

    expect(globalThis.postMessage).toHaveBeenCalledWith({
      type: "decoderError",
      kind: "audio",
    });
  });

  it("reports decoderError if codec unsupported", async () => {
    isConfigSupportedMock.mockResolvedValueOnce({ supported: false });

    await import("@/media/decoders/decoder-audio.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "config",
          config: { codec: "bogus" },
        },
      }),
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1]),
        },
      }),
    );

    await Promise.resolve();
    expect(postMessageMock).toHaveBeenCalledWith({
      type: "decoderError",
      kind: "audio",
    });
  });

  it("buffers frames before decoder is ready", async () => {
    await import("@/media/decoders/decoder-audio.js");

    // Setup and trigger decoder
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "config",
          config: { codec: "mp4a.40.2" },
        },
      }),
    );

    // Push a chunk before sending codecData
    const frameWithHeader = new Uint8Array([1, 2, 3]);
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "chunk",
          timestamp: null,
          chunkType: "key",
          frameWithHeader,
          framePos: 0,
        },
      }),
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1, 2, 3]),
        },
      }),
    );

    await Promise.resolve();

    const frameWithHeader2 = new Uint8Array([4, 5, 6]);
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "chunk",
          timestamp: 222,
          chunkType: "key",
          frameWithHeader2,
          framePos: 0,
        },
      }),
    );

    vi.runAllTimers();
    expect(decodeMock).toHaveBeenCalledTimes(2);
  });
});
