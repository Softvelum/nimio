import { describe, it, beforeEach, vi, expect, afterEach } from "vitest";

let postMessageMock;
let nowMock;
let decodeMock;
let configureMock;
let isConfigSupportedMock;
let VideoDecoderMock;
let EncodedVideoChunkMock;
let skipOutput;
let errorCallback;

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

  EncodedVideoChunkMock = vi.fn(function (data) {
    Object.assign(this, data);
  });

  VideoDecoderMock = vi.fn(({ output, error }) => {
    errorCallback = error;

    setTimeout(() => {
      if (skipOutput) return;
      output({ timestamp: 1234, close: vi.fn() });
    }, 0);

    return {
      decode: decodeMock,
      configure: configureMock,
      decodeQueueSize: 1,
    };
  });
  VideoDecoderMock.isConfigSupported = isConfigSupportedMock;

  globalThis.VideoDecoder = VideoDecoderMock;
  globalThis.EncodedVideoChunk = EncodedVideoChunkMock;

  skipOutput = false;
}

describe("decoder-video", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    setupWorkerGlobals();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("configures the decoder and processes codecData", async () => {
    await import("@/media/decoders/decoder-video.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "config",
          config: { codec: "avc1.42e01e", width: 640, height: 480 },
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

    await Promise.resolve(); // wait for async isConfigSupported
    expect(VideoDecoderMock).toHaveBeenCalled();
    expect(configureMock).toHaveBeenCalled();
  });

  it("buffers and decode video frames when ready", async () => {
    await import("@/media/decoders/decoder-video.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "config",
          config: { codec: "hvc1.1.6.L150.B0", width: 640, height: 480 },
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
    const frameWithHeader = new Uint8Array([10, 20, 30, 40]);
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "chunk",
          timestamp: 1234,
          chunkType: "key",
          frameWithHeader,
          framePos: 1,
        },
      }),
    );

    expect(decodeMock).toHaveBeenCalled();
    await Promise.resolve(); // wait for async decode

    vi.runAllTimers();
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "decodedFrame" }),
      expect.any(Array),
    );
  });

  it("warns on high latency frames", async () => {
    nowMock.mockReturnValueOnce(1000).mockReturnValueOnce(1000 + 700); // latency = 700ms

    await import("@/media/decoders/decoder-video.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "config",
          config: { codec: "avc1.42e01e", width: 640, height: 480 },
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

    const frameWithHeader = new Uint8Array([10, 20, 30, 40]);

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "chunk",
          timestamp: 1234,
          chunkType: "key",
          frameWithHeader,
          framePos: 0,
        },
      }),
    );
    vi.runAllTimers();
  });

  it("fallbacks to software decoding if hardware is not supported", async () => {
    isConfigSupportedMock
      .mockResolvedValueOnce({ supported: false }) // hardware not supported
      .mockResolvedValueOnce({ supported: true }); // software supported

    await import("@/media/decoders/decoder-video.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "config",
          config: {
            codec: "avc1.42e01e",
            width: 640,
            height: 480,
            hardwareAcceleration: true,
          },
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
    expect(isConfigSupportedMock).toHaveBeenCalledTimes(2);
    await Promise.resolve(); // wait for async configure
    await Promise.resolve();
    expect(configureMock).toHaveBeenCalled();
  });

  it("reports decoderError if codec unsupported", async () => {
    skipOutput = true;
    isConfigSupportedMock
      .mockResolvedValueOnce({ supported: false })
      .mockResolvedValueOnce({ supported: false });

    await import("@/media/decoders/decoder-video.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "config",
          config: {
            codec: "bogus",
            width: 1,
            height: 1,
            hardwareAcceleration: true,
          },
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

    // wait for 2 isConfigSupported() and configureDecoder to run
    for (let i = 0; i < 3; i++) await Promise.resolve();
    expect(postMessageMock).toHaveBeenCalledWith({
      type: "decoderError",
      kind: "video",
    });
  });

  it("buffers frames before decoder is ready", async () => {
    await import("@/media/decoders/decoder-video.js");

    // Setup and trigger decoder
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "config",
          config: { codec: "avc1.42e01e", width: 640, height: 480 },
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
          chunkType: "delta",
          frameWithHeader2,
          framePos: 0,
        },
      }),
    );

    vi.runAllTimers();
    expect(decodeMock).toHaveBeenCalledTimes(2);
  });

  it("handles decoder error", async () => {
    await import("@/media/decoders/decoder-video.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "config",
          config: { codec: "avc1.42e01e", width: 640, height: 480 },
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

    // Simulate decoder error
    errorCallback(new Error("Something went wrong"));

    expect(globalThis.postMessage).toHaveBeenCalledWith({
      type: "decoderError",
      kind: "video",
    });
  });

  it("emits decoderError message if decoder fails during configure", async () => {
    skipOutput = true;
    configureMock.mockImplementation(() => {
      throw new Error("Configuration failed");
    });

    await import("@/media/decoders/decoder-video.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "config",
          config: {
            codec: "avc1.42e01e",
            width: 640,
            height: 480,
            hardwareAcceleration: true,
          },
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

    for (let i = 0; i < 3; i++) await Promise.resolve();
    vi.runAllTimers();
    expect(postMessageMock).toHaveBeenCalledWith({
      type: "decoderError",
      kind: "video",
    });
  });
});
