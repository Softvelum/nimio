import { describe, it, beforeEach, vi, expect } from "vitest";

let postMessageMock;
let nowMock;
let decodeMock;
let configureMock;
let AudioDecoderMock;
let EncodedAudioChunkMock;
let timestampBufferMock;
let errorCallback;

vi.mock("@/shared/ring-buffer.js", () => {
  return {
    RingBuffer: vi.fn().mockImplementation(() => timestampBufferMock),
  };
});

describe("decoderAudio worker", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    postMessageMock = vi.fn();
    globalThis.postMessage = postMessageMock;
    globalThis.performance = { now: (nowMock = vi.fn(() => 1000)) };

    decodeMock = vi.fn();
    configureMock = vi.fn();
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
        output({ timestamp: 1000, close: vi.fn() });
      }, 0);

      return {
        decode: decodeMock,
        configure: configureMock,
        decodeQueueSize: 2,
      };
    });

    globalThis.AudioDecoder = AudioDecoderMock;
    globalThis.EncodedAudioChunk = EncodedAudioChunkMock;
  });

  it("configures decoder and processes codecData", async () => {
    await import("@/media/decoders/decoder-audio.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "audioConfig",
          audioConfig: { codec: "mp4a.40.2" },
        },
      }),
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1, 2, 3]),
          aacConfig: {
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
          type: "audioConfig",
          audioConfig: { codec: "mp4a.40.2" },
        },
      }),
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1, 2, 3]),
          aacConfig: {
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
          type: "audioChunk",
          timestamp: 1000,
          frameWithHeader,
          framePos: 1,
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(decodeMock).toHaveBeenCalled();
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "audioFrame",
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
          type: "audioConfig",
          audioConfig: { codec: "mp4a.40.2" },
        },
      }),
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1, 2, 3]),
          aacConfig: {
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
          type: "audioChunk",
          timestamp: 999,
          frameWithHeader: new Uint8Array([1, 2, 3]),
          framePos: 0,
        },
      }),
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "audioChunk",
          timestamp: 1000,
          frameWithHeader: new Uint8Array([1, 2, 3]),
          framePos: 0,
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "audioFrame",
        rawTimestamp: 1000,
        decTimestamp: expect.any(Number),
      }),
      expect.any(Array),
    );
  });

  it("emits decoderError message if decoder fails during configure", async () => {
    configureMock.mockImplementationOnce(() => {
      throw new Error("Configuration failed");
    });

    await import("@/media/decoders/decoder-audio.js");

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "audioConfig",
          audioConfig: { codec: "mp4a.40.2" },
        },
      }),
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1, 2, 3]),
          aacConfig: {
            codec: "mp4a.40.2",
            sampleRate: 48000,
            numberOfChannels: 2,
            sampleCount: 1024,
          },
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
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
          type: "audioConfig",
          audioConfig: { codec: "aac" },
        },
      }),
    );

    globalThis.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "codecData",
          codecData: new Uint8Array([1, 2]),
          aacConfig: {
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
});
