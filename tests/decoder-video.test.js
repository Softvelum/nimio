import { describe, it, beforeEach, vi, expect, afterEach } from "vitest";

let postMessageMock;
let nowMock;
let decodeMock;
let configureMock;
let resetMock;
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
  globalThis.performance = {
    now: (nowMock = vi.fn(function () {
      return 1000;
    })),
  };

  decodeMock = vi.fn();
  configureMock = vi.fn();
  resetMock = vi.fn();
  isConfigSupportedMock = vi.fn(async function () {
    return { supported: true };
  });

  EncodedVideoChunkMock = vi.fn(function (data) {
    Object.assign(this, data);
  });

  VideoDecoderMock = vi.fn(function ({ output, error }) {
    errorCallback = error;

    setTimeout(() => {
      if (skipOutput) return;
      output({ timestamp: 1234, close: vi.fn() });
    }, 0);

    return {
      decode: decodeMock,
      configure: configureMock,
      reset: resetMock,
      decodeQueueSize: 1,
      state: "configured",
    };
  });
  VideoDecoderMock.isConfigSupported = isConfigSupportedMock;

  globalThis.VideoDecoder = VideoDecoderMock;
  globalThis.EncodedVideoChunk = EncodedVideoChunkMock;

  skipOutput = false;
}

function sendWorkerMessage(data) {
  globalThis.dispatchEvent(new MessageEvent("message", { data }));
}

async function setupFallbackTest(hardwareAcceleration) {
  skipOutput = true;
  await import("@/media/decoders/decoder-video.js");
  const codecData = new Uint8Array([1, 2, 3]);
  sendWorkerMessage({
    type: "config",
    config: {
      codec: "hvc1.1.6.L93.B0",
      width: 1280,
      height: 720,
      hardwareAcceleration,
    },
  });
  sendWorkerMessage({ type: "codecData", codecData });
  return {
    codec: "hvc1.1.6.L93.B0",
    codedWidth: 1280,
    codedHeight: 720,
    description: codecData,
  };
}

function checkedPreferences() {
  return isConfigSupportedMock.mock.calls.map(
    ([params]) => params.hardwareAcceleration,
  );
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

  it.each([
    [false, "prefer-software", ["prefer-software"]],
    [false, "no-preference", ["prefer-software", "no-preference"]],
    [true, "prefer-hardware", ["prefer-hardware"]],
    [true, "prefer-software", ["prefer-hardware", "prefer-software"]],
    [
      true,
      "no-preference",
      ["prefer-hardware", "prefer-software", "no-preference"],
    ],
  ])(
    "selects %s / %s using the full decoder configuration",
    async (hardwareAcceleration, supportedPreference, expectedPreferences) => {
      isConfigSupportedMock.mockImplementation(async (params) => ({
        supported: params.hardwareAcceleration === supportedPreference,
      }));
      const expectedParams = await setupFallbackTest(hardwareAcceleration);
      await vi.runAllTimersAsync();

      expect(checkedPreferences()).toEqual(expectedPreferences);
      for (const [params] of isConfigSupportedMock.mock.calls) {
        expect(params).toEqual({
          ...expectedParams,
          hardwareAcceleration: params.hardwareAcceleration,
        });
      }
      expect(configureMock).toHaveBeenCalledExactlyOnceWith({
        ...expectedParams,
        hardwareAcceleration: supportedPreference,
      });
      expect(postMessageMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    [false, "no-preference", ["prefer-software", "no-preference"]],
    [true, "prefer-software", ["prefer-hardware", "prefer-software"]],
    [
      true,
      "no-preference",
      ["prefer-hardware", "prefer-software", "no-preference"],
    ],
  ])(
    "continues after configure throws with %s / %s",
    async (hardwareAcceleration, workingPreference, expectedPreferences) => {
      configureMock.mockImplementation((params) => {
        if (params.hardwareAcceleration !== workingPreference) {
          throw new Error("Configuration failed");
        }
      });
      const expectedParams = await setupFallbackTest(hardwareAcceleration);
      await vi.runAllTimersAsync();

      expect(checkedPreferences()).toEqual(expectedPreferences);
      expect(configureMock).toHaveBeenCalledTimes(expectedPreferences.length);
      expect(configureMock).toHaveBeenLastCalledWith({
        ...expectedParams,
        hardwareAcceleration: workingPreference,
      });
      expect(postMessageMock).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "reports one error when all modes are unsupported (hardwareAcceleration=%s)",
    async (hardwareAcceleration) => {
      isConfigSupportedMock.mockResolvedValue({ supported: false });
      await setupFallbackTest(hardwareAcceleration);
      await vi.runAllTimersAsync();

      expect(checkedPreferences()).toEqual(
        hardwareAcceleration
          ? ["prefer-hardware", "prefer-software", "no-preference"]
          : ["prefer-software", "no-preference"],
      );
      expect(configureMock).not.toHaveBeenCalled();
      expect(postMessageMock).toHaveBeenCalledExactlyOnceWith({
        type: "decoderError",
        kind: "video",
      });
    },
  );

  it("falls back if the support check rejects", async () => {
    isConfigSupportedMock.mockRejectedValueOnce(new Error("Check failed"));
    await setupFallbackTest(false);
    await vi.runAllTimersAsync();

    expect(checkedPreferences()).toEqual(["prefer-software", "no-preference"]);
    expect(configureMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ hardwareAcceleration: "no-preference" }),
    );
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("reuses the selected fallback when recovering the decoder", async () => {
    isConfigSupportedMock.mockImplementation(async (params) => ({
      supported: params.hardwareAcceleration === "no-preference",
    }));
    await setupFallbackTest(false);
    await vi.runAllTimersAsync();
    isConfigSupportedMock.mockClear();
    configureMock.mockClear();

    await errorCallback(new Error("Decode failed"));

    expect(resetMock).toHaveBeenCalledOnce();
    expect(checkedPreferences()).not.toContain("prefer-software");
    expect(configureMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ hardwareAcceleration: "no-preference" }),
    );
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("buffers chunks while the fallback support check is pending", async () => {
    let resolveSupport;
    isConfigSupportedMock
      .mockResolvedValueOnce({ supported: false })
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveSupport = resolve)),
      );
    await setupFallbackTest(false);
    await vi.runAllTimersAsync();

    const frameWithHeader = new Uint8Array([1, 2, 3]).buffer;
    sendWorkerMessage({
      type: "chunk",
      pts: 1000,
      chunkType: "key",
      frameWithHeader,
      framePos: 0,
    });
    expect(decodeMock).not.toHaveBeenCalled();

    resolveSupport({ supported: true });
    await vi.runAllTimersAsync();
    sendWorkerMessage({
      type: "chunk",
      pts: 2000,
      chunkType: "delta",
      frameWithHeader,
      framePos: 0,
    });

    expect(decodeMock.mock.calls.map(([chunk]) => chunk.timestamp)).toEqual([
      1000, 2000,
    ]);
    expect(configureMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ hardwareAcceleration: "no-preference" }),
    );
    expect(postMessageMock).not.toHaveBeenCalled();
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
    for (let i = 0; i <= 10; i++) {
      errorCallback(new Error("Something went wrong"));
    }

    expect(globalThis.postMessage).toHaveBeenCalledWith({
      type: "decoderError",
      kind: "video",
    });
  });

  it.each([false, true])(
    "reports one error when every configure attempt fails (hardwareAcceleration=%s)",
    async (hardwareAcceleration) => {
      configureMock.mockImplementation(() => {
        throw new Error("Configuration failed");
      });
      await setupFallbackTest(hardwareAcceleration);
      await vi.runAllTimersAsync();

      const expectedPreferences = hardwareAcceleration
        ? ["prefer-hardware", "prefer-software", "no-preference"]
        : ["prefer-software", "no-preference"];
      expect(checkedPreferences()).toEqual(expectedPreferences);
      expect(configureMock).toHaveBeenCalledTimes(expectedPreferences.length);
      expect(postMessageMock).toHaveBeenCalledExactlyOnceWith({
        type: "decoderError",
        kind: "video",
      });
    },
  );
});
