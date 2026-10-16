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
  live._state = { start: vi.fn(), isStopped: () => false, value: 0 };
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
  live._reconnect = { stop: vi.fn() };
  live._renderVideoFrame = vi.fn();
  live._playGen = 0;
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
  it("destroys the decoder flows and stops audio even when stop() failed before reaching them", () => {
    const live = Object.create(NimioLive.prototype);
    live._logger = { error: vi.fn(), debug: vi.fn() };
    live.stop = vi.fn(() => {
      throw new Error("VU meter container gone"); // _resetPlayback threw early
    });
    live._autoplayTimers = [];
    live._decoderFlows = { video: { destroy: vi.fn() }, audio: null };
    live._nextRenditionData = { decoderFlow: { destroy: vi.fn() } };
    live._stopAudio = vi.fn();
    live._state = { stop: vi.fn() };
    live._grabber = { stop: vi.fn() };
    live._debugView = { stop: vi.fn() };
    live._cancelPauseTimeout = vi.fn();
    live._abrController = { stop: vi.fn() };
    live._removeUIEventHandlers = vi.fn();
    live._deinitTransport = vi.fn();
    live._reconnect = { destroy: vi.fn() };
    live._sldpManager = { destroy: vi.fn() };
    live._transport = { destroy: vi.fn() };

    expect(() => live.destroy()).toThrow("VU meter container gone");

    expect(live._decoderFlows.video).toBeNull();
    expect(live._nextRenditionData).toBeNull();
    expect(live._stopAudio).toHaveBeenCalledTimes(1);
    expect(live._grabber.stop).toHaveBeenCalledTimes(1);
    expect(live._debugView.stop).toHaveBeenCalledTimes(1);
    expect(live._cancelPauseTimeout).toHaveBeenCalledTimes(1);
    expect(live._abrController.stop).toHaveBeenCalledWith({ hard: true });
    expect(live._state.stop).toHaveBeenCalledTimes(1);
    expect(live._transport.destroy).toHaveBeenCalledTimes(1);
  });

  it("still releases everything when stop() throws (a listener failed), then rethrows", () => {
    const live = Object.create(NimioLive.prototype);
    live._logger = { error: vi.fn(), debug: vi.fn() };
    live._state = { stop: vi.fn() };
    live._autoplayTimers = [];
    live._decoderFlows = { video: null, audio: null };
    live._nextRenditionData = null;
    live._stopAudio = vi.fn();
    live._cancelPauseTimeout = vi.fn();
    live.stop = vi.fn(() => {
      throw new Error("playback-end listener boom");
    });
    live._removeUIEventHandlers = vi.fn();
    live._deinitTransport = vi.fn();
    live._reconnect = { destroy: vi.fn() };
    live._sldpManager = { destroy: vi.fn() };
    live._transport = { destroy: vi.fn() };

    expect(() => live.destroy()).toThrow("playback-end listener boom");

    expect(live._removeUIEventHandlers).toHaveBeenCalledTimes(1);
    expect(live._deinitTransport).toHaveBeenCalledTimes(1);
    expect(live._reconnect.destroy).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.destroy).toHaveBeenCalledTimes(1);
    expect(live._transport.destroy).toHaveBeenCalledTimes(1);
    // only the stop stage failed: the media stage ran cleanly
    expect(live._logger.error).toHaveBeenCalledTimes(1);
    expect(live._logger.error.mock.calls[0][0]).toBe("destroy: stop failed");
  });

  it("removes the sync-mode params listener it subscribed", () => {
    const live = Object.create(NimioLive.prototype);
    live._logger = { error: vi.fn(), debug: vi.fn() };
    live._autoplayTimers = [];
    live._decoderFlows = { video: null, audio: null };
    live._nextRenditionData = null;
    live._stopAudio = vi.fn();
    live._state = { stop: vi.fn() };
    live._pauseTimeoutId = null;
    const bus = { on: vi.fn(), off: vi.fn() };
    live._eventBus = bus;
    live._createSyncModeParams();
    const handler = bus.on.mock.calls[0][1];
    expect(typeof handler).toBe("function");
    live.stop = vi.fn();
    live._removeUIEventHandlers = vi.fn();
    live._deinitTransport = vi.fn();
    live._reconnect = { destroy: vi.fn() };
    live._sldpManager = { destroy: vi.fn() };
    live._transport = { destroy: vi.fn() };

    live.destroy();

    expect(bus.off).toHaveBeenCalledWith("nimio:sync-mode-params", handler);
  });

  it("destroy without sync mode unsubscribes nothing extra", () => {
    const live = Object.create(NimioLive.prototype);
    live._logger = { error: vi.fn(), debug: vi.fn() };
    live._autoplayTimers = [];
    live._decoderFlows = { video: null, audio: null };
    live._nextRenditionData = null;
    live._stopAudio = vi.fn();
    live._state = { stop: vi.fn() };
    live._pauseTimeoutId = null;
    const bus = { off: vi.fn() };
    live._eventBus = bus;
    live.stop = vi.fn();
    live._removeUIEventHandlers = vi.fn();
    live._deinitTransport = vi.fn();
    live._reconnect = { destroy: vi.fn() };
    live._sldpManager = { destroy: vi.fn() };
    live._transport = { destroy: vi.fn() };

    expect(() => live.destroy()).not.toThrow();
    expect(bus.off).not.toHaveBeenCalled();
  });

  it("destroys the transport after stopping and unsubscribing", () => {
    const live = Object.create(NimioLive.prototype);
    live._logger = { error: vi.fn(), debug: vi.fn() };
    live._autoplayTimers = [];
    live._decoderFlows = { video: null, audio: null };
    live._nextRenditionData = null;
    live._stopAudio = vi.fn();
    live._state = { stop: vi.fn() };
    live._pauseTimeoutId = null;
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

describe("NimioLive stream setups while stopped", () => {
  it("ignores video and audio setups received after stop()", () => {
    const live = Object.create(NimioLive.prototype);
    live._state = { isStopped: () => true };
    live._config = { hardwareAcceleration: "no-preference" };
    live._decoderFlows = { video: null, audio: null };
    live._nextRenditionData = null;
    live._eventBus = { emit: vi.fn() };
    live._isAutoAbr = () => false;
    live._makeUiRenditionList = () => [];
    live._context = {
      getCurrentRendition: () => ({ rendition: "r", name: "n", idx: 0 }),
    };
    live._createMainDecoderFlow = vi.fn();
    live._setNoVideo = vi.fn();
    live._startNoAudioMode = vi.fn();
    live.stop = vi.fn();

    live._onVideoSetupReceived({ trackId: 1, config: { codec: "avc1" } });
    live._onAudioSetupReceived({ trackId: 2, config: { codec: "mp4a.40.2" } });
    live._onAudioSetupReceived({ trackId: 2 }); // no-config branch

    expect(live._createMainDecoderFlow).not.toHaveBeenCalled();
    expect(live._setNoVideo).not.toHaveBeenCalled();
    expect(live._startNoAudioMode).not.toHaveBeenCalled();
    expect(live.stop).not.toHaveBeenCalled();
  });
});

describe("NimioLive.detach() and the kept-alive session", () => {
  function createDetachable(sessionReady) {
    const live = Object.create(NimioLive.prototype);
    live._ui = {};
    live._context = { setState: vi.fn() };
    live._state = { value: "playing" };
    live.stop = vi.fn();
    live._detachUI = vi.fn();
    live._reconnect = { stop: vi.fn() };
    live._transport = { connected: true };
    live._sldpManager = {
      sessionReady,
      keepAliveConnection: vi.fn(),
      stop: vi.fn(),
    };
    return live;
  }

  it("keeps a committed session alive", () => {
    const live = createDetachable(true);

    expect(live.detach()).toBe(true);

    expect(live.stop).toHaveBeenCalledWith({ keepConnection: true });
    expect(live._sldpManager.keepAliveConnection).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.stop).not.toHaveBeenCalled();
  });

  it("does not try to close a session whose socket is not connected", () => {
    const live = createDetachable(false);
    live._transport.connected = false; // never opened, or already closed

    expect(live.detach()).toBe(true);

    expect(live._sldpManager.keepAliveConnection).not.toHaveBeenCalled();
    expect(live._sldpManager.stop).not.toHaveBeenCalled();
  });

  it("closes a session that never committed instead of keeping it alive", () => {
    const live = createDetachable(false);

    expect(live.detach()).toBe(true);

    expect(live.stop).toHaveBeenCalledWith({ keepConnection: true });
    expect(live._sldpManager.keepAliveConnection).not.toHaveBeenCalled();
    expect(live._sldpManager.stop).toHaveBeenCalledWith({
      closeConnection: true,
    });
    // the engine stop stays non-closing (keepConnection: true above), which
    // is what keeps nimio:playback-end from being emitted on a mode switch
  });

  it("stops a reconnect the disconnect handler scheduled", () => {
    // _onDisconnect() stopped the engine and scheduled play(); the stop()
    // inside detach() returns early on a stopped engine and never resets it
    const live = createDetachable(true);

    live.detach();

    expect(live._reconnect.stop).toHaveBeenCalledTimes(1);
  });
});

describe("NimioLive.setStreamURL() while detached", () => {
  // VOD mode: the live engine holds no UI; a kept-alive session belongs to
  // the old URL, so the next attach() must handshake instead of reusing it
  function createDetached(connected) {
    const live = Object.create(NimioLive.prototype);
    live._ui = undefined;
    live._transport = { connected };
    live._sldpManager = { stop: vi.fn() };
    live._state = { isStopped: () => true, isPlaying: () => false };
    live.stop = vi.fn();
    live.play = vi.fn();
    return live;
  }

  it("closes a connected kept-alive session", () => {
    const live = createDetached(true);

    live.setStreamURL();

    expect(live._sldpManager.stop).toHaveBeenCalledWith({
      closeConnection: true,
    });
    expect(live.stop).not.toHaveBeenCalled();
    expect(live.play).not.toHaveBeenCalled();
  });

  it("does nothing when the transport is disconnected", () => {
    const live = createDetached(false);

    live.setStreamURL();

    expect(live._sldpManager.stop).not.toHaveBeenCalled();
  });

  it("attached and stopped: returns without stopping or playing", () => {
    const live = createDetached(true);
    live._ui = {};

    live.setStreamURL();

    expect(live._sldpManager.stop).not.toHaveBeenCalled();
    expect(live.stop).not.toHaveBeenCalled();
  });
});
