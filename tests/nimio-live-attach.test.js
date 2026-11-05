import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NimioLive } from "@/nimio-live";
import { STATE, MODE } from "@/shared/values";

// attach() runs after a VOD detach handed the UI back to the live player.
// A connected transport is the preserved server session; it must be reused
// regardless of the state recorded at detach time, otherwise a second session
// is opened (wrong viewer statistics) and the first one is left dangling.

function createLive({ connected, savedState }) {
  const live = Object.create(NimioLive.prototype);
  live._config = { streamUrl: "wss://example.test/live", startOffset: 0 };
  live._transport = { connected };
  live._context = { state: { value: savedState } };
  live._sldpManager = {
    requestCurrentStreams: vi.fn(),
    start: vi.fn(),
    sessionReady: true,
  };
  live._state = { start: vi.fn(), isStopped: () => false };
  live._latencyCtrl = { start: vi.fn() };
  live._isAutoAbr = () => false;
  live._attachUI = vi.fn();
  live._renderVideoFrame = () => {};
  live._playGen = 0;
  return live;
}

describe("NimioLive.attach() connection reuse", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses a connected transport even when the saved state is PAUSED", () => {
    const live = createLive({ connected: true, savedState: STATE.PAUSED });

    expect(live.attach({}, { latency: 0 })).toBe(true);

    expect(live._sldpManager.requestCurrentStreams).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.start).not.toHaveBeenCalled();
  });

  it("reuses a connected transport when the saved state is PLAYING", () => {
    const live = createLive({ connected: true, savedState: STATE.PLAYING });

    live.attach({}, { latency: 0 });

    expect(live._sldpManager.requestCurrentStreams).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.start).not.toHaveBeenCalled();
  });

  it("clears an end a pause() left unreported, like play() does", () => {
    // the sibling start path: a new playback is what the application sees
    const live = createLive({ connected: false, savedState: STATE.STOPPED });
    live._reconnect = { pending: false };
    live._retryCancelled = true;

    live.attach({}, { latency: 0 });

    expect(live.hasUnreportedEnd()).toBe(false);
  });

  it("handshakes again when the session's metadata never committed", () => {
    // connected, but a detach cancelled the pending status commit: the context
    // is empty, so reusing the socket would request nothing
    const live = createLive({ connected: true, savedState: STATE.PLAYING });
    live._sldpManager.sessionReady = false;

    live.attach({}, { latency: 0 });

    expect(live._sldpManager.start).toHaveBeenCalledWith(
      "wss://example.test/live",
      0,
    );
    expect(live._sldpManager.requestCurrentStreams).not.toHaveBeenCalled();
  });

  it("starts a new connection when the transport is disconnected", () => {
    const live = createLive({ connected: false, savedState: STATE.PAUSED });

    live.attach({}, { latency: 0 });

    expect(live._sldpManager.start).toHaveBeenCalledWith(
      "wss://example.test/live",
      0,
    );
    expect(live._sldpManager.requestCurrentStreams).not.toHaveBeenCalled();
  });
});

describe("NimioLive.attach() idle", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The facade's stop() in VOD mode gives the UI back to the live engine
  // without starting it: the player ends in live mode, stopped.
  it("takes the UI, calls back and starts nothing", () => {
    const live = createLive({ connected: true, savedState: STATE.PLAYING });
    live._attachUI = vi.fn(function (ui) {
      this._ui = ui;
    });
    const ui = { showStopped: vi.fn() };
    const cb = vi.fn();

    expect(live.attach(ui, { latency: 0, idle: true }, cb)).toBe(true);

    expect(live._attachUI).toHaveBeenCalledWith(ui, { idle: true });
    expect(ui.showStopped).toHaveBeenCalledTimes(1); // the live stopped look
    expect(cb).toHaveBeenCalledTimes(1);
    expect(live._state.start).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(live._sldpManager.start).not.toHaveBeenCalled();
    expect(live._sldpManager.requestCurrentStreams).not.toHaveBeenCalled();
  });

  it("an error attach takes the UI idle, shows the stopped look and reports the error", () => {
    // the stream could be played neither live nor as VOD: the UI shows the
    // stopped look under the error notification, with no capture stream
    const live = createLive({ connected: false, savedState: STATE.PLAYING });
    live._attachUI = NimioLive.prototype._attachUI;
    live._eventBus = { emit: vi.fn() };
    const ui = { toggleMode: vi.fn(), showStopped: vi.fn() };
    const cb = vi.fn();

    expect(live.attach(ui, { latency: 0, pbError: true }, cb)).toBe(true);

    expect(ui.toggleMode).toHaveBeenCalledWith(MODE.LIVE, { capture: false });
    expect(ui.showStopped).toHaveBeenCalledTimes(1);
    expect(live._eventBus.emit).toHaveBeenCalledWith("aux:playback-error", {
      type: "NO_SRC",
      mode: MODE.LIVE,
      stop: true,
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(live._state.start).not.toHaveBeenCalled();
  });

  it("an idle attach takes the UI without a capture stream; a normal attach with one", () => {
    const idleLive = createLive({
      connected: false,
      savedState: STATE.PLAYING,
    });
    idleLive._attachUI = NimioLive.prototype._attachUI;
    const idleUi = { toggleMode: vi.fn(), showStopped: vi.fn() };

    idleLive.attach(idleUi, { latency: 0, idle: true });

    expect(idleUi.toggleMode).toHaveBeenCalledWith(MODE.LIVE, {
      capture: false,
    });
    expect(idleLive._ui).toBe(idleUi);

    const live = createLive({ connected: false, savedState: STATE.PLAYING });
    live._attachUI = NimioLive.prototype._attachUI;
    const ui = { toggleMode: vi.fn() };

    live.attach(ui, { latency: 0 });

    expect(ui.toggleMode).toHaveBeenCalledWith(MODE.LIVE, { capture: true });
  });

  it("holds the UI afterwards: a second attach is refused", () => {
    const live = createLive({ connected: false, savedState: STATE.PLAYING });
    live._attachUI = vi.fn(function (ui) {
      this._ui = ui;
    });

    live.attach({ showStopped: vi.fn() }, { latency: 0, idle: true });

    expect(live.attach({}, { latency: 0 })).toBe(false);
  });
});

describe("NimioLive.stop() on a stopped engine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // a just-constructed autoplay player and a dropped connection both leave
  // the engine stopped with a timer that would start playback later; a
  // stop() must cancel them even though it has nothing else to do
  it("cancels a pending reconnect and the autoplay timers", () => {
    const live = Object.create(NimioLive.prototype);
    live._state = { isStopped: () => true };
    live._transport = { connected: true }; // the drop notice is still in flight
    live._sldpManager = { stop: vi.fn() };
    live._reconnect = { stop: vi.fn(), reset: vi.fn() };
    live._autoplayTimers = [
      setTimeout(() => {}, 0),
      setTimeout(() => {}, 1000),
    ];

    live.stop();

    expect(live._reconnect.stop).toHaveBeenCalledTimes(1);
    expect(live._autoplayTimers).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(live._sldpManager.stop).toHaveBeenCalledWith({
      closeConnection: true,
    });
  });

  it("a stop() during a reconnect wait reports the playback end", () => {
    // the drop stopped the engine silently (a retry was coming): the
    // application still believes the player is playing and the UI shows
    // the pause glyph; a stop that cancels the retry ends that playback
    // for both, so one click stops the player
    const live = Object.create(NimioLive.prototype);
    live._state = { isStopped: () => true };
    live._transport = { connected: false, connecting: false };
    live._sldpManager = { stop: vi.fn() };
    live._reconnect = { stop: vi.fn(), reset: vi.fn(), pending: true };
    live._eventBus = { emit: vi.fn() };

    live.stop();

    expect(live._reconnect.stop).toHaveBeenCalledTimes(1);
    expect(live._eventBus.emit).toHaveBeenCalledTimes(1);
    expect(live._eventBus.emit).toHaveBeenCalledWith("nimio:playback-end", {
      mode: MODE.LIVE,
    });
  });

  it("a pause() during a reconnect wait, then a stop(): the stop reports the playback end", () => {
    // the pause cancelled the retry (and reported the pause); the player is
    // stopped from then on, but the application has not heard that the
    // playback ended: the next closing stop says so, as a stop that cancels
    // the retry itself does
    const live = Object.create(NimioLive.prototype);
    live._state = { isStopped: () => true, isPaused: () => false };
    live._transport = { connected: false, connecting: false };
    live._sldpManager = { stop: vi.fn() };
    live._reconnect = {
      pending: true,
      stop: vi.fn(function () {
        this.pending = false;
      }),
      reset: vi.fn(),
    };
    live._eventBus = { emit: vi.fn() };

    live.pause();
    expect(live._eventBus.emit).toHaveBeenCalledWith("nimio:pause", {
      mode: MODE.LIVE,
    });

    live.stop();

    expect(live._eventBus.emit).toHaveBeenCalledTimes(2);
    expect(live._eventBus.emit).toHaveBeenLastCalledWith("nimio:playback-end", {
      mode: MODE.LIVE,
    });

    live.stop(); // once: the end was reported
    expect(live._eventBus.emit).toHaveBeenCalledTimes(2);
  });

  // a drop, a pause() during the wait, a play(): the new playback is what
  // the application now sees; when the reconnects later run out (the
  // engine is stopped directly, without stop()), a stop() must emit no end
  // event, as it does without the earlier pause
  function engineAfterDropPausePlay({ pause }) {
    const live = Object.create(NimioLive.prototype);
    const flags = { stopped: true, paused: false, playing: false };
    live._config = { streamUrl: "wss://example.test/live", startOffset: 0 };
    live._state = {
      start: vi.fn(() => {
        flags.stopped = false;
        flags.playing = true;
      }),
      stop: vi.fn(() => {
        flags.stopped = true;
        flags.playing = false;
      }),
      isStopped: () => flags.stopped,
      isPaused: () => flags.paused,
      isPlaying: () => flags.playing,
    };
    live._playGen = 0;
    live._autoplayTimers = [];
    live._latencyCtrl = { start: vi.fn() };
    live._isAutoAbr = () => false;
    live._cancelPauseTimeout = vi.fn();
    live._renderVideoFrame = () => {};
    live._transport = { connected: false, connecting: false };
    live._sldpManager = { start: vi.fn(), stop: vi.fn() };
    live._reconnect = {
      pending: true,
      stop: vi.fn(function () {
        this.pending = false;
      }),
      reset: vi.fn(),
    };
    live._eventBus = { emit: vi.fn() };
    if (pause) live.pause();
    live._reconnect.pending = false;
    live.play();
    live._state.stop(); // the reconnects ran out: _onDisconnect stops directly
    live._eventBus.emit.mockClear();
    return live;
  }

  it("a stop() after a drop, a pause(), a play() and an exhausted reconnect emits nothing, like the control", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    try {
      const control = engineAfterDropPausePlay({ pause: false });
      control.stop();
      expect(control._eventBus.emit).not.toHaveBeenCalled();

      const live = engineAfterDropPausePlay({ pause: true });
      expect(live.hasUnreportedEnd()).toBe(false); // a new playback started
      live.stop();
      expect(live._eventBus.emit).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hasUnreportedEnd() is true while a retry is pending and after a pause() cancelled it", () => {
    const live = Object.create(NimioLive.prototype);
    live._reconnect = { pending: true };
    expect(live.hasUnreportedEnd()).toBe(true);
    live._reconnect.pending = false;
    expect(live.hasUnreportedEnd()).toBe(false);
    live._retryCancelled = true; // what pause() during the wait records
    expect(live.hasUnreportedEnd()).toBe(true);
  });

  it("a detach during a reconnect wait (keepConnection) reports nothing", () => {
    const live = Object.create(NimioLive.prototype);
    live._state = { isStopped: () => true };
    live._transport = { connected: false, connecting: false };
    live._sldpManager = { stop: vi.fn() };
    live._reconnect = { stop: vi.fn(), reset: vi.fn(), pending: true };
    live._eventBus = { emit: vi.fn() };

    live.stop({ keepConnection: true });

    expect(live._eventBus.emit).not.toHaveBeenCalled();
  });

  it("a stop() on a stopped engine with no retry pending reports nothing", () => {
    const live = Object.create(NimioLive.prototype);
    live._state = { isStopped: () => true };
    live._transport = { connected: false, connecting: false };
    live._sldpManager = { stop: vi.fn() };
    live._reconnect = { stop: vi.fn(), reset: vi.fn(), pending: false };
    live._eventBus = { emit: vi.fn() };

    live.stop();

    expect(live._eventBus.emit).not.toHaveBeenCalled();
  });

  it("cancels the autoplay play timer; the controls fade does not hide a stopped player's controls", () => {
    // the controls fade belongs to the autoplay start: it stays armed
    // across a stop, but a player that is stopped when it fires (an early
    // stop, an immediate server rejection) keeps its controls visible
    const live = Object.create(NimioLive.prototype);
    live._state = { isStopped: () => true };
    live._transport = { connected: false, connecting: false };
    live._sldpManager = { stop: vi.fn() };
    live._reconnect = { stop: vi.fn(), reset: vi.fn() };
    live._playCb = vi.fn();
    live._ui = { hideControls: vi.fn() };
    live._scheduleAutoplay();

    live.stop();
    vi.advanceTimersByTime(1000);

    expect(live._playCb).not.toHaveBeenCalled();
    expect(live._ui.hideControls).not.toHaveBeenCalled();
    expect(live._autoplayTimers).toEqual([]);
    expect(live._controlsTimer).toBeUndefined(); // fired and cleared
  });

  it("the controls fade hides the controls of a playing player", () => {
    const live = Object.create(NimioLive.prototype);
    live._state = { isStopped: () => false };
    live._playCb = vi.fn();
    live._ui = { hideControls: vi.fn() };
    live._scheduleAutoplay();

    vi.advanceTimersByTime(1000);

    expect(live._ui.hideControls).toHaveBeenCalledWith(true);
  });
});

describe("NimioLive.stop() and a connecting socket", () => {
  // VOD entered before the live socket opened, then a stop: the engine is
  // stopped and not connected, but the socket may still open afterwards
  it("closes a socket that is still connecting", () => {
    const live = Object.create(NimioLive.prototype);
    live._state = { isStopped: () => true };
    live._transport = { connected: false, connecting: true };
    live._sldpManager = { stop: vi.fn() };
    live._reconnect = { stop: vi.fn(), reset: vi.fn() };
    live._autoplayTimers = [];

    live.stop();

    expect(live._sldpManager.stop).toHaveBeenCalledWith({
      closeConnection: true,
    });
  });
});
