import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NimioLive } from "@/nimio-live";
import { MODE } from "@/shared/values";

// A live engine with the real play(), pause(), attach() and destroy() and
// every collaborator those touch stubbed. `stopped` mirrors what a stop()
// from an application listener does to the state.
function createEngine() {
  const live = Object.create(NimioLive.prototype);
  const flags = { stopped: false, paused: false, playing: false };
  live._instName = "Guards";
  live._config = { streamUrl: "wss://example.test/live", startOffset: 0 };
  live._logger = { error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  live._state = {
    start: vi.fn(() => {
      flags.stopped = false;
      flags.playing = true;
    }),
    stop: vi.fn(() => {
      flags.stopped = true;
      flags.playing = false;
    }),
    pause: vi.fn(() => {
      flags.paused = true;
      flags.playing = false;
    }),
    isPlaying: () => flags.playing,
    isPaused: () => flags.paused,
    isStopped: () => flags.stopped,
  };
  live._playGen = 0;
  live._latencyCtrl = { start: vi.fn(), pause: vi.fn() };
  live._isAutoAbr = () => false;
  live._cancelPauseTimeout = vi.fn();
  live._eventBus = { emit: vi.fn() };
  live._sldpManager = {
    start: vi.fn(),
    requestCurrentStreams: vi.fn(),
    sessionReady: false,
    destroy: vi.fn(),
  };
  live._transport = { connected: false, destroy: vi.fn() };
  live._debugView = { start: vi.fn(), stop: vi.fn() };
  live._renderVideoFrame = () => {};
  live._audioCtxProvider = {
    isSuspended: () => true,
    get: () => ({ resume: vi.fn() }),
  };
  live._reconnect = { stop: vi.fn(), destroy: vi.fn(), reset: vi.fn() };
  live._attachUI = vi.fn();
  // stop(): what _resetPlayback() does to the state and the generation
  live.stop = vi.fn(() => {
    flags.stopped = true;
    flags.playing = false;
    live._playGen++;
  });
  live._decoderFlows = { video: null, audio: null };
  live._nextRenditionData = null;
  live._autoplayTimers = [];
  live._stopAudio = vi.fn();
  live._removeUIEventHandlers = vi.fn();
  live._deinitTransport = vi.fn();
  return { live, flags };
}

describe("NimioLive after destroy()", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("destroy() twice runs the stages once", () => {
    const { live } = createEngine();

    live.destroy();
    live.destroy();

    expect(live._destroyed).toBe(true);
    expect(live.stop).toHaveBeenCalledTimes(1);
    expect(live._transport.destroy).toHaveBeenCalledTimes(1);
  });

  it("play() on a destroyed engine does nothing", () => {
    const { live } = createEngine();
    live.destroy();

    live.play();

    expect(live._state.start).not.toHaveBeenCalled();
    expect(live._eventBus.emit).not.toHaveBeenCalled();
    expect(live._sldpManager.start).not.toHaveBeenCalled();
  });

  it("pause() on a destroyed engine does nothing", () => {
    const { live } = createEngine();
    live.destroy();

    live.pause();

    expect(live._state.pause).not.toHaveBeenCalled();
    expect(live._latencyCtrl.pause).not.toHaveBeenCalled();
  });

  it("attach() on a destroyed engine returns false without touching the UI", () => {
    const { live } = createEngine();
    live.destroy();
    const callback = vi.fn();

    expect(live.attach({}, { latency: 0, pbError: true }, callback)).toBe(
      false,
    );

    expect(live._attachUI).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });
});

describe("NimioLive.play() with a listener that ends playback", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a nimio:play listener that destroys the player prevents the connection start", () => {
    const { live } = createEngine();
    live._eventBus.emit = vi.fn((name) => {
      if (name === "nimio:play") live.destroy();
    });

    live.play();

    expect(live._eventBus.emit).toHaveBeenCalledWith("nimio:play", {
      mode: MODE.LIVE,
    });
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(live._sldpManager.start).not.toHaveBeenCalled();
    expect(live._debugView.start).not.toHaveBeenCalled();
  });

  it("a nimio:play listener that stops the player prevents the connection start", () => {
    const { live, flags } = createEngine();
    live._eventBus.emit = vi.fn((name) => {
      if (name === "nimio:play") flags.stopped = true;
    });

    live.play();

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(live._sldpManager.start).not.toHaveBeenCalled();
    expect(live._debugView.start).not.toHaveBeenCalled();
  });

  it("a nimio:play listener that stops the player prevents the resume", () => {
    const { live, flags } = createEngine();
    flags.paused = true; // play() after pause(): not an initial play
    const ctx = { resume: vi.fn() };
    live._audioCtxProvider = { isSuspended: () => true, get: () => ctx };
    live._eventBus.emit = vi.fn((name) => {
      if (name === "nimio:play") flags.stopped = true;
    });

    live.play();

    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it("a nimio:connection-started listener that stops the player prevents the overlay start", () => {
    const { live, flags } = createEngine();
    // SLDPManager.start() emits nimio:connection-started synchronously
    live._sldpManager.start = vi.fn(() => (flags.stopped = true));

    live.play();

    expect(live._sldpManager.start).toHaveBeenCalledTimes(1);
    expect(live._debugView.start).not.toHaveBeenCalled();
  });

  it("without such a listener play() starts the overlay as before", () => {
    const { live } = createEngine();

    live.play();

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.start).toHaveBeenCalledWith(
      "wss://example.test/live",
      0,
    );
    expect(live._debugView.start).toHaveBeenCalledTimes(1);
  });
});

describe("NimioLive.attach() with a listener that ends playback", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a nimio:connection-started listener that stops the player leaves the engine attached and stopped", () => {
    // like the pbError path: attached-and-stopped is a legitimate outcome the
    // application asked for; returning false would make the facade believe
    // the engine never took the UI, leaving it un-attachable afterwards
    const { live, flags } = createEngine();
    delete live._attachUI; // the real one: records the UI
    const ui = { toggleMode: vi.fn(), setDetached: vi.fn() };
    live._sldpManager.start = vi.fn(() => (flags.stopped = true));
    const callback = vi.fn();

    expect(live.attach(ui, { latency: 0 }, callback)).toBe(true);

    expect(live._ui).toBe(ui);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(live._debugView.start).not.toHaveBeenCalled();
    expect(live.attach(ui, { latency: 0 })).toBe(false); // already attached
  });

  it("a nimio:connection-started listener that destroys the player makes attach() return false", () => {
    const { live } = createEngine();
    live._sldpManager.start = vi.fn(() => live.destroy());

    expect(live.attach({}, { latency: 0 })).toBe(false);

    expect(live._debugView.start).not.toHaveBeenCalled();
  });

  it("without such a listener attach() returns true and starts the overlay", () => {
    const { live } = createEngine();
    const callback = vi.fn();

    expect(live.attach({}, { latency: 0 }, callback)).toBe(true);

    expect(live._debugView.start).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe("NimioLive autoplay timers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fire play and hide the controls when nothing cancels them", () => {
    const { live } = createEngine();
    live._playCb = vi.fn();
    live._ui = { hideControls: vi.fn() };

    live._scheduleAutoplay();
    vi.advanceTimersByTime(1000);

    expect(live._playCb).toHaveBeenCalledTimes(1);
    expect(live._ui.hideControls).toHaveBeenCalledWith(true);
  });

  it("are cancelled by destroy()", () => {
    const { live } = createEngine();
    live._playCb = vi.fn();
    live._ui = { hideControls: vi.fn() };

    live._scheduleAutoplay();
    live.destroy();
    vi.advanceTimersByTime(1000);

    expect(live._playCb).not.toHaveBeenCalled();
    expect(live._ui.hideControls).not.toHaveBeenCalled();
    expect(live._autoplayTimers).toEqual([]);
  });
});

describe("NimioLive restart from a listener", () => {
  // A listener may stop AND restart the player (setStreamURL(), or
  // stop(); play()). The state is playing again afterwards, so only the
  // playback generation tells the interrupted call that it must not go on.
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a nimio:play listener that changes the stream URL leaves one loop and one connection", () => {
    const { live } = createEngine();
    let once = false;
    live._eventBus.emit = vi.fn((name) => {
      if (name !== "nimio:play" || once) return;
      once = true;
      live.setStreamURL(); // stop() + play() inside the outer play()
    });

    live.play();

    expect(live._state.start).toHaveBeenCalledTimes(2); // outer, then inner
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.start).toHaveBeenCalledTimes(1);
    expect(live._debugView.start).toHaveBeenCalledTimes(1);
  });

  it("a nimio:connection-started listener that restarts playback leaves attach() attached with one overlay start", () => {
    const { live } = createEngine();
    let once = false;
    live._sldpManager.start = vi.fn(() => {
      if (once) return;
      once = true;
      live.stop();
      live.play();
    });
    const callback = vi.fn();

    expect(live.attach({}, { latency: 0 }, callback)).toBe(true);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.start).toHaveBeenCalledTimes(2); // attach, play
    expect(live._debugView.start).toHaveBeenCalledTimes(1); // by the play
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2); // attach, play
  });
});

describe("NimioLive setters after destroy()", () => {
  it("setParameters() changes nothing", () => {
    const { live } = createEngine();
    live._config.latency = 500;
    live._context = { autoAbr: true };
    live._abrController = {
      stop: vi.fn(),
      start: vi.fn(),
      setBuffering: vi.fn(),
    };
    live._updateLatencyParams = vi.fn();
    live.destroy();

    live.setParameters({ latency: 2000 });

    expect(live._config.latency).toBe(500);
    expect(live._updateLatencyParams).not.toHaveBeenCalled();
    expect(live._abrController.start).not.toHaveBeenCalled();
  });
});
