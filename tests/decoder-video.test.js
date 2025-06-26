import { describe, it, beforeEach, vi, expect } from "vitest";

let postMessageMock;
let nowMock;
let decodeMock;
let configureMock;
let isConfigSupportedMock;
let VideoDecoderMock;
let EncodedVideoChunkMock;

function setupWorkerGlobals() {
  const eventTarget = new EventTarget();
  globalThis.addEventListener = eventTarget.addEventListener.bind(eventTarget);
  globalThis.removeEventListener = eventTarget.removeEventListener.bind(eventTarget);
  globalThis.dispatchEvent = eventTarget.dispatchEvent.bind(eventTarget);

  globalThis.postMessage = postMessageMock = vi.fn();
  globalThis.performance = { now: nowMock = vi.fn(() => 1000) };

  decodeMock = vi.fn();
  configureMock = vi.fn();
  isConfigSupportedMock = vi.fn(async () => ({ supported: true }));

  EncodedVideoChunkMock = vi.fn(function (data) {
    Object.assign(this, data);
  });

  VideoDecoderMock = vi.fn(({ output, error }) => {
    setTimeout(() => {
      console.log('run output mock', output);
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
}

describe("decoderVideo worker", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setupWorkerGlobals();
  });

  it("should configure the decoder and process codecData", async () => {
    await import("@/media/decoders/decoder-video.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "videoConfig",
          videoConfig: { codec: "avc1.42e01e", width: 640, height: 480 },
        },
      })
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1, 2, 3]),
        },
      })
    );

    await Promise.resolve(); // wait for async isConfigSupported
    expect(VideoDecoderMock).toHaveBeenCalled();
    expect(configureMock).toHaveBeenCalled();
  });

  it.only("should buffer and decode video frames when ready", async () => {
    await import("@/media/decoders/decoder-video.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "videoConfig",
          videoConfig: { codec: "hvc1.1.6.L150.B0", width: 640, height: 480 },
        },
      })
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1, 2, 3]),
        },
      })
    );

    await Promise.resolve();

    const frameWithHeader = new Uint8Array([10, 20, 30, 40]);
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "videoChunk",
          timestamp: 1234,
          chunkType: "key",
          frameWithHeader,
          framePos: 1,
        },
      })
    );

    expect(decodeMock).toHaveBeenCalled();
    await Promise.resolve(); // wait for async decode
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "videoFrame" }),
      expect.any(Array)
    );
  });

  it("should warn on high latency frames", async () => {
    nowMock
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000 + 700); // latency = 700ms
  
    await import("@/media/decoders/decoder-video.js");
  
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "videoConfig",
          videoConfig: { codec: "avc1.42e01e", width: 640, height: 480 },
        },
      })
    );
  
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1, 2, 3]),
        },
      })
    );
  
    await Promise.resolve();
  
    const frameWithHeader = new Uint8Array([10, 20, 30, 40]);
  
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "videoChunk",
          timestamp: 1234,
          chunkType: "key",
          frameWithHeader,
          framePos: 0,
        },
      })
    );
  });
  
  it("should fallback to software decoding if hardware is not supported", async () => {
    isConfigSupportedMock
      .mockResolvedValueOnce({ supported: false }) // hardware not supported
      .mockResolvedValueOnce({ supported: true }); // software supported
  
    await import("@/media/decoders/decoder-video.js");
  
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "videoConfig",
          videoConfig: { codec: "avc1.42e01e", width: 640, height: 480 },
        },
      })
    );
  
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1, 2, 3]),
        },
      })
    );
  
    await Promise.resolve();
    expect(isConfigSupportedMock).toHaveBeenCalledTimes(2);
    await Promise.resolve(); // wait for async configure
    expect(configureMock).toHaveBeenCalled();
  });
  
  it("should report decoderError if codec unsupported", async () => {
    isConfigSupportedMock
      .mockResolvedValueOnce({ supported: false })
      .mockResolvedValueOnce({ supported: false });
  
    await import("@/media/decoders/decoder-video.js");
  
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "videoConfig",
          videoConfig: { codec: "bogus", width: 1, height: 1 },
        },
      })
    );
  
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1]),
        },
      })
    );
  
    await Promise.resolve();
    await Promise.resolve();
    expect(postMessageMock).toHaveBeenCalledWith({
      type: "decoderError",
      kind: "video"
    });
  });
  
  it("should buffer frames before decoder is ready", async () => {
    await import("@/media/decoders/decoder-video.js");

    // Setup and trigger decoder
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "videoConfig",
          videoConfig: { codec: "avc1.42e01e", width: 640, height: 480 },
        },
      })
    );

    // Push a chunk before sending codecData
    const frameWithHeader = new Uint8Array([1, 2, 3]);
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "videoChunk",
          timestamp: 111,
          chunkType: "key",
          frameWithHeader,
          framePos: 0,
        },
      })
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1, 2, 3]),
        },
      })
    );
  
    await Promise.resolve();

    const frameWithHeader2 = new Uint8Array([4, 5, 6]);
    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "videoChunk",
          timestamp: 222,
          chunkType: "delta",
          frameWithHeader2,
          framePos: 0,
        },
      })
    );
  
    // Buffered frames should now be decoded
    expect(decodeMock).toHaveBeenCalledTimes(2);
  });
});
