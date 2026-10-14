import { describe, it, expect, vi, beforeEach } from "vitest";

const flowMocks = vi.hoisted(() => {
  class FakeDecoderFlow {
    constructor(instanceName, trackId, timescale) {
      this.instanceName = instanceName;
      this.trackId = trackId;
      this.timescale = timescale;
      this.setConfig = vi.fn();
    }
  }

  return {
    videoInstances: [],
    audioInstances: [],
    FakeVideoFlow: class extends FakeDecoderFlow {
      constructor(...args) {
        super(...args);
        flowMocks.videoInstances.push(this);
      }
    },
    FakeAudioFlow: class extends FakeDecoderFlow {
      constructor(...args) {
        super(...args);
        flowMocks.audioInstances.push(this);
      }
    },
  };
});

vi.mock("@/media/decoders/flow-video", () => ({
  DecoderFlowVideo: flowMocks.FakeVideoFlow,
}));

vi.mock("@/media/decoders/flow-audio", () => ({
  DecoderFlowAudio: flowMocks.FakeAudioFlow,
}));

import { NimioLive } from "@/nimio-live.js";

function createLive() {
  const live = Object.create(NimioLive.prototype);
  live._instName = "Test";
  live._config = {};
  live._decoderFlows = { video: null, audio: null };
  live._nextRenditionData = {};
  live._sldpManager = { cancelStream: vi.fn() };
  live._eventBus = { emit: vi.fn() };
  live._onDecodedBufferFull = vi.fn();
  return live;
}

describe("NimioLive", () => {
  beforeEach(() => {
    flowMocks.videoInstances.length = 0;
    flowMocks.audioInstances.length = 0;
  });

  describe.each([
    ["video", "videoInstances", { codec: "avc1.42e01e" }, 90000],
    ["audio", "audioInstances", { codec: "mp4a.40.2" }, 48000],
  ])(
    "%s decoded-buffer-full callback",
    (type, instances, config, timescale) => {
      const data = { trackId: 2, timescale, config };

      it("is bound to the main flow with the track type", () => {
        const live = createLive();

        live._createMainDecoderFlow(type, data);

        const flow = flowMocks[instances][0];
        expect(flow.onDecodedBufferFull).toBeTypeOf("function");

        flow.onDecodedBufferFull();
        expect(live._onDecodedBufferFull).toHaveBeenCalledWith(type);
      });

      it("is bound to the next rendition flow with the track type", () => {
        const live = createLive();

        live._createNextRenditionFlow(type, data);

        const flow = flowMocks[instances][0];
        expect(flow.onDecodedBufferFull).toBeTypeOf("function");

        flow.onDecodedBufferFull();
        expect(live._onDecodedBufferFull).toHaveBeenCalledWith(type);
      });
    },
  );

  describe("_onDecodedBufferFull", () => {
    function createLiveInState(paused) {
      const live = Object.create(NimioLive.prototype);
      live._state = { isPaused: () => paused };
      live._logger = { warn: vi.fn() };
      live._cancelPauseTimeout = vi.fn();
      live.stop = vi.fn();
      return live;
    }

    it("stops playback and cancels the pause timeout while paused", () => {
      const live = createLiveInState(true);

      live._onDecodedBufferFull("audio");

      expect(live._cancelPauseTimeout).toHaveBeenCalledTimes(1);
      expect(live.stop).toHaveBeenCalledTimes(1);
      expect(live._logger.warn).toHaveBeenCalledWith(
        "Auto stop on audio buffer fill",
      );
    });

    it("does nothing while playing", () => {
      const live = createLiveInState(false);

      live._onDecodedBufferFull("video");

      expect(live._cancelPauseTimeout).not.toHaveBeenCalled();
      expect(live.stop).not.toHaveBeenCalled();
    });
  });
});

function createLiveForAttach() {
  const live = Object.create(NimioLive.prototype);
  live._config = {
    instanceName: "Test",
    latency: 200,
    latencyTolerance: 0,
    syncBuffer: 0,
    streamUrl: "wss://x",
    startOffset: 1000,
  };
  live._logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  live._eventBus = { emit: vi.fn() };
  live._state = { start: vi.fn(), value: 0 };
  live._latencyCtrl = { start: vi.fn() };
  live._isAutoAbr = () => false;
  live._transport = { connected: false };
  live._sldpManager = {
    start: vi.fn(),
    requestCurrentStreams: vi.fn(),
    stop: vi.fn(),
    keepAliveConnection: vi.fn(),
  };
  live._context = { setState: vi.fn(), state: { value: 0 } };
  live._renderVideoFrame = vi.fn();
  live.stop = vi.fn();
  return live;
}

describe("NimioLive attach/detach completion", () => {
  it("attach calls the callback once and returns true", () => {
    const live = createLiveForAttach();
    const ui = { toggleMode: vi.fn(), setDetached: vi.fn() };
    const cb = vi.fn();
    expect(live.attach(ui, { latency: 0 }, cb)).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.start).toHaveBeenCalled();
  });

  it("attach with pbError reports the error, calls back and returns true", () => {
    const live = createLiveForAttach();
    const ui = { toggleMode: vi.fn(), setDetached: vi.fn() };
    const cb = vi.fn();
    expect(live.attach(ui, { latency: 0, pbError: true }, cb)).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(live._eventBus.emit).toHaveBeenCalledWith(
      "aux:playback-error",
      expect.objectContaining({ type: "NO_SRC", stop: true }),
    );
    expect(live._sldpManager.start).not.toHaveBeenCalled();
  });

  it("attach returns false without calling back when already attached", () => {
    const live = createLiveForAttach();
    live._ui = { toggleMode: vi.fn() };
    const cb = vi.fn();
    expect(live.attach({ toggleMode: vi.fn() }, { latency: 0 }, cb)).toBe(
      false,
    );
    expect(cb).not.toHaveBeenCalled();
  });

  it("detach calls the callback synchronously and returns true when attached", () => {
    const live = createLiveForAttach();
    live._ui = { toggleMode: vi.fn(), setDetached: vi.fn() };
    const order = [];
    const cb = vi.fn(() => order.push("cb"));
    const res = live.detach(cb);
    order.push("returned");
    expect(res).toBe(true);
    expect(order).toEqual(["cb", "returned"]);
    expect(live._ui).toBeUndefined();
  });

  it("detach while not attached still calls back and returns true", () => {
    const live = createLiveForAttach();
    const cb = vi.fn();
    expect(live.detach(cb)).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("NimioLive.destroy() releases the transport worker", () => {
  it("destroys the transport after stopping and unsubscribing", () => {
    const live = Object.create(NimioLive.prototype);
    const order = [];
    live.stop = vi.fn(() => order.push("stop"));
    live._removeUIEventHandlers = vi.fn(() => order.push("ui"));
    live._deinitTransport = vi.fn(() => order.push("deinitTransport"));
    live._reconnect = { destroy: vi.fn(() => order.push("reconnect")) };
    live._sldpManager = { destroy: vi.fn(() => order.push("sldp")) };
    live._transport = { destroy: vi.fn(() => order.push("transport")) };

    live.destroy();

    expect(live._transport.destroy).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.destroy).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      "stop",
      "ui",
      "deinitTransport",
      "reconnect",
      "sldp",
      "transport",
    ]);
  });
});
