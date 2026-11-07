import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Nimio from "@/nimio.js";
import { NimioVod } from "@/nimio-vod.js";
import { MODE, ERROR, STATE } from "@/shared/values";

function fakeLive() {
  return {
    attached: true,
    play: vi.fn(),
    stop: vi.fn(),
    setStreamURL: vi.fn(),
    detach: vi.fn(function (cb) {
      this.attached = false;
      if (cb) cb();
      return true;
    }),
    attach: vi.fn(function (ui, params, cb) {
      if (this.attached) return false;
      this.attached = true;
      if (cb) cb();
      return true;
    }),
  };
}

// running: SYNC or PLAY in the real engine (attached, or detached and warm);
// false after stop()
function fakeVod({ attach = "async" } = {}) {
  return {
    attached: false,
    running: false,
    pendingAttach: null,
    hasPlaybackErrors: () => false,
    isLoaded: () => true,
    initialize: vi.fn(() => Promise.resolve()),
    forgetSource: vi.fn(),
    isRunning: vi.fn(function () {
      return this.running;
    }),
    play: vi.fn(),
    stop: vi.fn(function (cb) {
      this.attached = false;
      this.running = false;
      this.pendingAttach = null;
      if (cb) cb();
    }),
    detach: vi.fn(function (cb) {
      if (!this.attached) return false;
      this.attached = false;
      this.pendingAttach = null;
      if (cb) cb();
      return true;
    }),
    attach: vi.fn(function (ui, position, cb) {
      if (attach === false) return false;
      this.attached = true;
      this.running = true;
      if (attach === "sync") {
        if (cb) cb();
      } else {
        this.pendingAttach = cb;
      }
      return true;
    }),
  };
}

function createFacade({ mode = MODE.LIVE, vod } = {}) {
  const n = Object.create(Nimio.prototype);
  n._logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  n._eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
  n._ui = { id: "ui", destroy: vi.fn(), mediaElement: { id: "media" } };
  n._context = {
    state: { value: STATE.STOPPED, initial: false },
    setState: vi.fn(function (value, initial) {
      this.state.value = value;
      if (initial !== undefined) this.state.initial = initial;
    }),
    resetState: vi.fn(function () {
      this.state.value = STATE.STOPPED;
      this.state.initial = false;
    }),
  };
  n._vodStartGen = 0;
  n._stopping = false;
  n._livePlayer = fakeLive();
  n._vodPlayer = vod || fakeVod();
  n._vuMeterSvc = { clear: vi.fn() };
  n._playProgressSvc = { resetVodDuration: vi.fn() };
  n._config = { streamUrl: "wss://example.test/old" };
  if (mode === MODE.VOD) {
    n._livePlayer.attached = false;
    n._vodPlayer.attached = true;
    n._vodPlayer.running = true;
  }
  n._actPlayer = mode === MODE.VOD ? n._vodPlayer : n._livePlayer;
  n._mode = mode;
  return n;
}

async function microtasks(n = 4) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

const errorEvent = (mode) => [
  "nimio:playback-error",
  { error: ERROR.MODE_SWITCH, mode },
];

describe("Nimio mode switch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("switches live to VOD when the VOD engine reports media attached", () => {
    const n = createFacade();
    expect(n._switchToVod(12)).toBe(true);
    expect(n._mode).toBe(MODE.PEND);
    expect(n._livePlayer.detach).toHaveBeenCalledTimes(1);
    expect(n._vodPlayer.attach).toHaveBeenCalledWith(
      n._ui,
      12,
      expect.any(Function),
    );
    expect(n._actPlayer).toBe(n._vodPlayer);
    n._vodPlayer.pendingAttach();
    expect(n._mode).toBe(MODE.VOD);
    expect(n._eventBus.emit).not.toHaveBeenCalled();
  });

  it("live detach callback runs synchronously inside the switch call", () => {
    const n = createFacade();
    n._switchToVod(0);
    expect(n._livePlayer.detach).toHaveBeenCalled();
    expect(n._vodPlayer.attach).toHaveBeenCalled();
  });

  it("restores live when VOD attach is refused", () => {
    const n = createFacade({ vod: fakeVod({ attach: false }) });
    n._context.state.value = STATE.PLAYING; // what the live detach records
    expect(n._switchToVod(5)).toBe(false);
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(n._livePlayer);
    expect(n._livePlayer.attach).toHaveBeenCalledWith(
      n._ui,
      { latency: 0 },
      expect.any(Function),
    );
    expect(n._livePlayer.attached).toBe(true);
    expect(n._eventBus.emit).toHaveBeenCalledWith(...errorEvent(MODE.VOD));
  });

  it("restores live and reports an error when VOD never reports media attached", () => {
    const n = createFacade();
    n._context.state.value = STATE.PLAYING;
    expect(n._switchToVod(5)).toBe(true);
    vi.advanceTimersByTime(4999);
    expect(n._mode).toBe(MODE.PEND);
    vi.advanceTimersByTime(1);
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(n._livePlayer);
    expect(n._vodPlayer.detach).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.attach).toHaveBeenCalledTimes(1);
    expect(n._eventBus.emit).toHaveBeenCalledWith(...errorEvent(MODE.VOD));
    // live plays again: the detached VOD engine stays warm behind it
    expect(n._vodPlayer.stop).not.toHaveBeenCalled();
  });

  it.each([
    ["stopped", STATE.STOPPED],
    ["paused", STATE.PAUSED],
  ])(
    "an idle restore of a %s live engine stops the VOD engine too",
    (_, state) => {
      // the VOD engine's detach restarts its background playlist reload; a
      // player that ends stopped must not keep polling the archive
      const n = createFacade();
      n._context.state.value = state; // what the live detach records
      n._switchToVod(5);

      vi.advanceTimersByTime(5000);

      expect(n._vodPlayer.stop).toHaveBeenCalledTimes(1);
      expect(n._vodPlayer.isRunning()).toBe(false);
      // released first, then stopped: the engine's stop emits its end event
      // only while it holds the UI
      expect(n._vodPlayer.stop.mock.invocationCallOrder[0]).toBeGreaterThan(
        n._vodPlayer.detach.mock.invocationCallOrder[0],
      );
    },
  );

  it("restores a stopped live engine idle when VOD attach is refused", () => {
    // autoplay: false, a seek into VOD on a stopped player fails: the
    // rollback must not start live playback nobody asked for
    const n = createFacade({ vod: fakeVod({ attach: false }) });
    n._context.state.value = STATE.STOPPED;

    expect(n._switchToVod(5)).toBe(false);

    expect(n._mode).toBe(MODE.LIVE);
    expect(n._livePlayer.attach).toHaveBeenCalledWith(
      n._ui,
      { latency: 0, idle: true },
      expect.any(Function),
    );
    expect(n._livePlayer.attached).toBe(true);
    expect(n._livePlayer.stop).toHaveBeenCalledTimes(1); // nothing to close here
    expect(n._eventBus.emit).toHaveBeenCalledWith(...errorEvent(MODE.VOD));
  });

  it("restores a paused live engine idle when VOD never reports media attached", () => {
    const n = createFacade();
    n._context.state.value = STATE.PAUSED;
    n._switchToVod(5);

    vi.advanceTimersByTime(5000);

    expect(n._mode).toBe(MODE.LIVE);
    expect(n._livePlayer.attach).toHaveBeenCalledWith(
      n._ui,
      { latency: 0, idle: true },
      expect.any(Function),
    );
    // the paused engine's detach kept its session alive; a restored player
    // that shows the splash must not keep a server session open
    const attachOrder = n._livePlayer.attach.mock.invocationCallOrder[0];
    expect(n._livePlayer.stop).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.stop.mock.invocationCallOrder[0]).toBeGreaterThan(
      attachOrder,
    );
  });

  it("an idle restore presents a stopped context, as stop() does", () => {
    // one stopped state: the snapshot restored for the engine's attach must
    // not outlive the stop that follows it
    const n = createFacade();
    n._context.state.value = STATE.PAUSED;
    n._switchToVod(5);

    vi.advanceTimersByTime(5000);

    expect(n._context.state).toEqual({ value: STATE.STOPPED, initial: false });
  });

  it("an idle restore of a paused live engine reports the switch error, then the playback end", () => {
    // the paused engine's detach stopped it without an event (its session
    // was kept for a restart); the restored player is stopped and shows
    // the stopped look, so the application must hear that the playback
    // ended, or it keeps a paused player that cannot be resumed
    const n = createFacade();
    n._context.state.value = STATE.PAUSED;
    n._switchToVod(5);

    vi.advanceTimersByTime(5000);

    // the cause first: an application that restarts from the end event
    // must not get the error of the old attempt on its new playback
    expect(n._eventBus.emit.mock.calls).toEqual([
      errorEvent(MODE.VOD),
      ["nimio:playback-end", { mode: MODE.LIVE }],
    ]);
  });

  it("an idle restore of a live engine paused during a reconnect wait reports the playback end", () => {
    // the drop stopped the engine silently and a pause() cancelled the
    // retry: the detach recorded the stopped engine, the application still
    // holds a paused player, and the restored one is stopped with the splash
    const n = createFacade({ vod: fakeVod({ attach: false }) });
    n._context.state.value = STATE.STOPPED; // what the live detach records
    n._livePlayer.hasUnreportedEnd = () => true;

    n._switchToVod(5);

    expect(n._eventBus.emit.mock.calls).toEqual([
      errorEvent(MODE.VOD),
      ["nimio:playback-end", { mode: MODE.LIVE }],
    ]);
    expect(n._livePlayer.attach).toHaveBeenCalledWith(
      n._ui,
      { latency: 0, idle: true },
      expect.any(Function),
    );
  });

  it("an idle restore of a stopped live engine reports no playback end", () => {
    const n = createFacade({ vod: fakeVod({ attach: false }) });
    n._context.state.value = STATE.STOPPED;

    n._switchToVod(5);

    expect(n._eventBus.emit.mock.calls).toEqual([errorEvent(MODE.VOD)]);
  });

  it("a destroy() from the playback end of an idle restore leaves the switch silent", () => {
    const n = createFacade();
    n._context.state.value = STATE.PAUSED;
    n._eventBus.emit = vi.fn((name) => {
      if (name === "nimio:playback-end") {
        n._destroyed = true;
        n._eventBus = undefined; // what destroy() does
      }
    });
    n._switchToVod(5);

    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });

  // The facade's public API as an application listener uses it; the log
  // holds the events and the engine calls in the order they happened.
  function listenTo(n, event, action) {
    const log = [];
    n._livePlayer.play = vi.fn(() => log.push("live.play"));
    n._vodPlayer.play = vi.fn(() => log.push("vod.play"));
    n._eventBus.emit = vi.fn((name, data) => {
      log.push(`${name}:${data.error ? "switch-error" : data.mode}`);
      if (name === event) action(log);
    });
    return log;
  }

  it("the switch error listener gets a player that is back in live mode", () => {
    // a play(), stop() or seekVod() from the listener must act on the
    // restored live engine, not on the VOD engine about to be released
    const n = createFacade();
    n._context.state.value = STATE.PAUSED;
    const seen = [];
    n._eventBus.emit = vi.fn((name) => {
      if (name !== "nimio:playback-error") return;
      seen.push([
        n._mode,
        n._actPlayer === n._livePlayer,
        n._livePlayer.attached,
      ]);
    });
    n._switchToVod(5);

    vi.advanceTimersByTime(5000);

    expect(seen).toEqual([[MODE.LIVE, true, true]]);
  });

  it("a play() from the playback end of an idle restore comes after the switch error", () => {
    const n = createFacade();
    n._context.state.value = STATE.PAUSED;
    const log = listenTo(n, "nimio:playback-end", () => n.play());
    n._switchToVod(5);

    vi.advanceTimersByTime(5000);

    expect(log).toEqual([
      "nimio:playback-error:switch-error",
      "nimio:playback-end:live",
      "live.play",
    ]);
  });

  it("a play() from the switch error listener leaves no playback end for the new playback", () => {
    // the application restarted the player itself: the end of the paused
    // playback would arrive on a running stream
    const n = createFacade();
    n._context.state.value = STATE.PAUSED;
    const log = listenTo(n, "nimio:playback-error", () => n.play());
    n._switchToVod(5);

    vi.advanceTimersByTime(5000);

    expect(log).toEqual(["nimio:playback-error:switch-error", "live.play"]);
  });

  it("a stop() from the switch error listener still gets the playback end, once", () => {
    // the restored engine is already stopped, so its own stop reports
    // nothing: the application that held a paused player still hears the end
    const n = createFacade();
    n._context.state.value = STATE.PAUSED;
    const log = listenTo(n, "nimio:playback-error", () => n.stop());
    n._switchToVod(5);

    vi.advanceTimersByTime(5000);

    expect(log).toEqual([
      "nimio:playback-error:switch-error",
      "nimio:playback-end:live",
    ]);
  });

  it("a destroy() from an event of the restarted live engine leaves the rollback silent", () => {
    // the restart emits nimio:play and nimio:connection-started from inside
    // the restore, before the switch error; their listener may remove the
    // player, and the real attach then reports that it did not take
    const n = createFacade();
    n._context.state.value = STATE.PLAYING;
    const emit = n._eventBus.emit;
    n._switchToVod(5);
    n._livePlayer.attach = vi.fn(() => {
      n._destroyed = true;
      n._eventBus = undefined; // what destroy() does
      return false;
    });

    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });

  it("a destroy() from the switch error listener leaves the rollback silent", () => {
    const n = createFacade();
    n._context.state.value = STATE.PAUSED;
    const emit = vi.fn((name) => {
      if (name === "nimio:playback-error") {
        n._destroyed = true;
        n._eventBus = undefined; // what destroy() does
      }
    });
    n._eventBus.emit = emit;
    n._switchToVod(5);

    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    expect(emit.mock.calls).toEqual([errorEvent(MODE.VOD)]);
    expect(n._idleRestore).toBeNull(); // the engines are not held any more
  });

  it("restores a playing live engine although the VOD detach recorded STOPPED", () => {
    // the timeout rollback detaches the VOD engine, whose detach writes its
    // own (never started) state into the shared context; the live state
    // must come from a snapshot taken when live let go of the UI
    const n = createFacade();
    n._livePlayer.detach = vi.fn(function (cb) {
      this.attached = false;
      n._context.setState(STATE.PLAYING, false); // the real live detach
      if (cb) cb();
      return true;
    });
    n._vodPlayer.detach = vi.fn(function (cb) {
      this.attached = false;
      n._context.setState(STATE.STOPPED, false); // the real VOD detach
      if (cb) cb();
      return true;
    });
    n._switchToVod(5);

    vi.advanceTimersByTime(5000);

    expect(n._mode).toBe(MODE.LIVE);
    expect(n._livePlayer.attach).toHaveBeenCalledWith(
      n._ui,
      { latency: 0 },
      expect.any(Function),
    );
    expect(n._context.state.value).toBe(STATE.PLAYING);
  });

  it("restores a paused VOD paused when the switch to live never completes", () => {
    // the live attach started (and its detach on rollback records a live
    // state); the VOD must come back with its own paused state, not resume
    const n = createFacade({ mode: MODE.VOD });
    n._vodPlayer.detach = vi.fn(function (cb) {
      this.attached = false;
      n._context.setState(STATE.PAUSED, false); // the VOD detach
      if (cb) cb();
      return true;
    });
    n._livePlayer.attach = vi.fn(function () {
      this.attached = true;
      return true; // never calls back
    });
    n._livePlayer.detach = vi.fn(function (cb) {
      this.attached = false;
      n._context.setState(STATE.STOPPED, false); // the live detach
      if (cb) cb();
      return true;
    });
    n._switchToLive(0);

    vi.advanceTimersByTime(5000);

    expect(n._mode).toBe(MODE.VOD);
    expect(n._vodPlayer.attach).toHaveBeenCalledWith(
      n._ui,
      undefined,
      expect.any(Function),
    );
    expect(n._context.state.value).toBe(STATE.PAUSED);
  });

  it("ignores a late attach completion after timeout", () => {
    const vod = fakeVod();
    const n = createFacade({ vod });
    n._switchToVod(5);
    const late = vod.pendingAttach;
    vi.advanceTimersByTime(5000);
    late();
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(n._livePlayer);
    expect(n._eventBus.emit).toHaveBeenCalledTimes(1);
  });

  it("ignores a switch request while another switch is pending", () => {
    const n = createFacade();
    n._switchToVod(1);
    expect(n._switchToLive(0)).toBe(false);
    expect(n._switchToVod(2)).toBe(false);
    expect(n._mode).toBe(MODE.PEND);
    expect(n._vodPlayer.detach).not.toHaveBeenCalled();
    expect(n._vodPlayer.attach).toHaveBeenCalledTimes(1);
  });

  it("returns false when already in the requested mode or VOD is disabled", () => {
    const n = createFacade();
    expect(n._switchToLive(0)).toBe(false);
    n._vodPlayer = undefined;
    expect(n._switchToVod(0)).toBe(false);
    expect(n._mode).toBe(MODE.LIVE);
  });

  it("switches VOD to live synchronously", () => {
    const n = createFacade({ mode: MODE.VOD });
    expect(n._switchToLive(3)).toBe(true);
    expect(n._vodPlayer.detach).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.attach).toHaveBeenCalledWith(
      n._ui,
      { latency: 3, pbError: false },
      expect.any(Function),
    );
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(n._livePlayer);
  });

  it("keeps VOD mode without re-attaching when VOD detach is refused", () => {
    const n = createFacade({ mode: MODE.VOD });
    n._vodPlayer.attached = false; // engine is not in PLAY, detach will refuse
    expect(n._switchToLive(0)).toBe(false);
    expect(n._mode).toBe(MODE.VOD);
    expect(n._actPlayer).toBe(n._vodPlayer);
    // Nothing was detached, so nothing may be (re)started.
    expect(n._vodPlayer.attach).not.toHaveBeenCalled();
    expect(n._livePlayer.attach).not.toHaveBeenCalled();
    expect(n._eventBus.emit).toHaveBeenCalledWith(...errorEvent(MODE.LIVE));
  });

  it("fails a pending switch to VOD immediately on a VOD playback error", () => {
    const n = createFacade();
    n._config = { vod: { liveFailover: true } };
    n._switchToVod(4);
    expect(n._mode).toBe(MODE.PEND);
    n._onVodPlaybackError("NO_SRC");
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(n._livePlayer);
    expect(n._vodPlayer.detach).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.attach).toHaveBeenCalledTimes(1);
    expect(n._eventBus.emit).toHaveBeenCalledWith(...errorEvent(MODE.VOD));
    expect(n._eventBus.emit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(n._livePlayer.attach).toHaveBeenCalledTimes(1);
  });

  it("destroy cancels a pending switch", () => {
    const n = createFacade();
    n._livePlayer.destroy = vi.fn();
    n._vodPlayer.destroy = vi.fn();
    const live = n._livePlayer;
    const bus = n._eventBus; // destroy() clears the facade's reference
    n._switchToVod(1);
    n.destroy();
    vi.advanceTimersByTime(5000);
    expect(bus.emit).not.toHaveBeenCalledWith(...errorEvent(MODE.VOD));
    expect(live.attach).not.toHaveBeenCalled();
  });
});

describe("Nimio mode switch with the real VOD engine", () => {
  const VOD_PLAY = 3;

  function realVod() {
    // Without a config the constructor returns early but initializes the
    // hls.js event handlers; the rest is stubbed at the hls.js boundary.
    const vod = new NimioVod("switch-test", undefined);
    vod._state = 2; // SYNC
    vod._logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    vod._pHandler = {
      loadSource: vi.fn(),
      stopLoad: vi.fn(),
      pauseBuffering: vi.fn(),
      attachMedia: vi.fn(),
      // hls.js fires MEDIA_DETACHED synchronously from inside detachMedia().
      detachMedia: vi.fn(() => vod._onMediaDetached()),
    };
    vod._context = {
      getCurrentLevel: () => undefined,
      setState: vi.fn(),
      hasVod: () => false,
    };
    vod._playbackService = { init: vi.fn(), resetPosition: vi.fn(), state: 0 };
    vod._audioCtrl = { reset: vi.fn() };
    vod._vuMeterSvc = { stop: vi.fn() };
    vod._url = "https://example.com/playlist_dvr.m3u8";
    return vod;
  }

  function uiStub() {
    return {
      toggleMode: vi.fn(),
      setDetached: vi.fn(),
      destroy: vi.fn(),
      mediaElement: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    };
  }

  it("keeps VOD attached and playable when the live engine refuses to attach", () => {
    const n = createFacade({ mode: MODE.VOD, vod: realVod() });
    n._ui = uiStub();
    n._vodPlayer.attach(n._ui, undefined, undefined);
    n._livePlayer.attached = true; // live still holds a UI, attach() will refuse

    expect(n._switchToLive(0)).toBe(false);

    expect(n._mode).toBe(MODE.VOD);
    expect(n._actPlayer).toBe(n._vodPlayer);
    expect(n._vodPlayer._state).toBe(VOD_PLAY);
    expect(n._vodPlayer._ui).toBe(n._ui);
    expect(n._eventBus.emit).toHaveBeenCalledWith(...errorEvent(MODE.LIVE));
  });

  it("keeps the master playlist loaded when the live engine refuses to attach", () => {
    const vod = realVod();
    vod._context.hasVod = () => true;
    vod._context.getCurrentLevel = () => ({
      data: { url: ["https://example.com/720p/playlist_dvr.m3u8"] },
    });
    const n = createFacade({ mode: MODE.VOD, vod });
    n._ui = uiStub();
    vod.attach(n._ui, undefined, undefined);
    vod._pHandler.loadSource.mockClear();
    n._livePlayer.attached = true; // attach() will refuse

    expect(n._switchToLive(0)).toBe(false);

    expect(vod._pHandler.loadSource).toHaveBeenLastCalledWith(
      "https://example.com/playlist_dvr.m3u8",
    );
    expect(vod._pHandler.loadSource).not.toHaveBeenCalledWith(
      "https://example.com/720p/playlist_dvr.m3u8",
    );
  });

  it("an idle restore leaves the real VOD engine stopped with nothing loading", () => {
    const VOD_STOP = 4;
    const vod = realVod();
    vod._state = VOD_STOP; // a stopped player's VOD engine
    vod._context.hasVod = () => true;
    vod._context.getCurrentLevel = () => ({
      data: { url: ["https://example.com/720p/playlist_dvr.m3u8"] },
    });
    const n = createFacade({ vod });
    n._ui = uiStub();
    n._context.state.value = STATE.STOPPED; // what the live detach records
    n._switchToVod(undefined);

    n._onVodPlaybackError("NO_SRC"); // the archive could not be loaded

    // the detach restarted the variant playlist reload: the stop comes last
    const { loadSource, stopLoad } = vod._pHandler;
    expect(loadSource).toHaveBeenLastCalledWith(
      "https://example.com/720p/playlist_dvr.m3u8",
    );
    expect(stopLoad.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      loadSource.mock.invocationCallOrder.at(-1),
    );
    expect(vod.isRunning()).toBe(false);
    // released before it was stopped: no VOD end event for a seek that
    // never showed the archive
    expect(n._eventBus.emit.mock.calls).toEqual([errorEvent(MODE.VOD)]);
  });

  it("releases the UI from VOD before the live engine takes it", () => {
    const n = createFacade({ mode: MODE.VOD, vod: realVod() });
    n._ui = uiStub();
    n._vodPlayer.attach(n._ui, undefined, undefined);
    const order = [];
    n._ui.setDetached.mockImplementation(() => order.push("vod:setDetached"));
    n._livePlayer.attach.mockImplementation(function (ui, params, cb) {
      order.push("live:attach");
      this.attached = true;
      if (cb) cb();
      return true;
    });

    expect(n._switchToLive(0)).toBe(true);

    expect(order).toEqual(["vod:setDetached", "live:attach"]);
    expect(n._mode).toBe(MODE.LIVE);
  });
});

describe("Nimio.stop()", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const idle = { latency: 0, idle: true };

  it("in VOD mode returns to live, stopped, and a later play() starts live", () => {
    const n = createFacade({ mode: MODE.VOD });

    n.stop();

    expect(n._vodPlayer.stop).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.attach).toHaveBeenCalledWith(n._ui, idle);
    expect(n._livePlayer.attached).toBe(true);
    expect(n._livePlayer.stop).toHaveBeenCalledTimes(1);
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(n._livePlayer);
    expect(n._eventBus.emit).not.toHaveBeenCalled();
    expect(n._context.resetState).toHaveBeenCalledTimes(1);

    n.play();
    expect(n._livePlayer.play).toHaveBeenCalledTimes(1);
  });

  it("a second stop() re-runs the engine stop and emits nothing", () => {
    const n = createFacade({ mode: MODE.VOD });
    n.stop();
    n._vodPlayer.stop.mockClear();
    n._livePlayer.attach.mockClear();

    expect(() => n.stop()).not.toThrow();

    // the engine stop runs again: idempotent, and it cancels a reload a
    // seek may have queued meanwhile
    expect(n._vodPlayer.stop).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.attach.mock.results[0].value).toBe(false); // held
    expect(n._livePlayer.stop).toHaveBeenCalledTimes(2);
    expect(n._mode).toBe(MODE.LIVE);
  });

  it("a destroy() from the VOD playback-end listener leaves stop() silent", () => {
    const n = createFacade({ mode: MODE.VOD });
    n._instName = "sw-stop-destroy";
    n._removeVolumeEventHandlers = vi.fn();
    n._livePlayer.destroy = vi.fn();
    n._vodPlayer.destroy = vi.fn();
    n._vodPlayer.stop = vi.fn(function () {
      n.destroy(); // an application listener removes the player on playback-end
      this.attached = false;
      this.running = false;
    });

    expect(() => n.stop()).not.toThrow();

    expect(n._destroyed).toBe(true);
    expect(n._actPlayer).toBeUndefined();
    expect(n._livePlayer).toBeUndefined();
  });

  it("a destroy() from the LIVE playback-end listener leaves stop() silent", () => {
    // live playing (or a pending switch to live): the live stop emits the
    // event, and the listener removes the player; nothing may run after
    const n = createFacade();
    n._instName = "sw-stop-destroy-live";
    n._removeVolumeEventHandlers = vi.fn();
    n._livePlayer.destroy = vi.fn();
    n._vodPlayer.destroy = vi.fn();
    n._livePlayer.stop = vi.fn(() => n.destroy());

    expect(() => n.stop()).not.toThrow();

    expect(n._destroyed).toBe(true);
    expect(n._actPlayer).toBeUndefined();
    expect(n._stopping).toBe(false);
  });

  it("stop() and seekVod() from the VOD playback-end listener are ignored; a play() waits for the stop", () => {
    const n = createFacade({ mode: MODE.VOD });
    n._vodPlayer.stop = vi.fn(function (cb) {
      // application listeners of nimio:playback-end
      n.play();
      n.stop();
      n.seekVod(1);
      this.attached = false;
      this.running = false;
      if (cb) cb();
    });

    n.stop();

    expect(n._vodPlayer.play).not.toHaveBeenCalled();
    expect(n._livePlayer.play).toHaveBeenCalledTimes(1); // after the stop
    expect(n._vodPlayer.initialize).not.toHaveBeenCalled();
    expect(n._vodPlayer.stop).toHaveBeenCalledTimes(1); // the nested stop was ignored
    expect(n._livePlayer.attach).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.stop).toHaveBeenCalledTimes(1);
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(n._livePlayer);
    expect(n._stopping).toBe(false); // released for the next call
  });

  it("in VOD mode a play() from the VOD playback-end listener restarts live after the stop", () => {
    // the VOD engine still holds the UI when it emits its end event, so the
    // play cannot run there; it is remembered and performed as the stop's
    // last step, so the restart pattern works from either end event
    const n = createFacade({ mode: MODE.VOD });
    n._vodPlayer.stop = vi.fn(function (cb) {
      this.attached = false;
      this.running = false;
      n.play(); // an application listener of nimio:playback-end VOD
      if (cb) cb();
    });

    n.stop();

    expect(n._livePlayer.play).toHaveBeenCalledTimes(1);
    const order = (fn) => fn.mock.invocationCallOrder[0];
    expect(order(n._livePlayer.play)).toBeGreaterThan(
      order(n._livePlayer.stop),
    );
    expect(order(n._livePlayer.play)).toBeGreaterThan(
      order(n._context.resetState),
    );
    expect(n._playAfterStop).toBe(false);
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(n._livePlayer);
  });

  it("a deferred play() is not performed when the listener also destroyed the player", () => {
    const n = createFacade({ mode: MODE.VOD });
    n._vodPlayer.stop = vi.fn(function (cb) {
      this.attached = false;
      n.play();
      n._destroyed = true; // what destroy() does
      if (cb) cb();
    });

    n.stop();

    expect(n._livePlayer.play).not.toHaveBeenCalled();
  });

  it("a throwing VOD playback-end listener leaves no deferred play behind", () => {
    // the listener asked for a play(), then threw: the stop is over, and
    // the next stop() must not start live on its own
    const n = createFacade({ mode: MODE.VOD });
    n._vodPlayer.stop = vi.fn(() => {
      n.play();
      throw new Error("listener");
    });

    expect(() => n.stop()).toThrow("listener");
    expect(n._playAfterStop).toBe(false);

    n._vodPlayer.stop = vi.fn();
    n._livePlayer.play.mockClear();
    n.stop();
    expect(n._livePlayer.play).not.toHaveBeenCalled();
  });

  it("in live mode a play() from the LIVE playback-end listener restarts live, as in the base", () => {
    // the live stop is the last step and emits the end event last; an app
    // that restarts from that event must not be swallowed by the guard that
    // protects the VOD stop (where the engine still holds the UI)
    const n = createFacade();
    let stopped = false;
    n._livePlayer.stop = vi.fn(() => {
      if (stopped) return; // the real engine returns before emitting again
      stopped = true;
      n.play(); // an application listener of nimio:playback-end LIVE
      n.stop(); // a nested stop is harmless
    });

    expect(() => n.stop()).not.toThrow();

    expect(n._livePlayer.play).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.stop).toHaveBeenCalledTimes(2); // the nested stop ran
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(n._livePlayer);
    expect(n._stopping).toBe(false);
  });

  it("in live mode resets the context too", () => {
    const n = createFacade();
    n._context.state.value = STATE.PLAYING; // left by an earlier VOD detach

    n.stop();

    expect(n._context.resetState).toHaveBeenCalledTimes(1);
    expect(n._context.state).toEqual({ value: STATE.STOPPED, initial: false });
  });

  it("voids a VOD start still waiting for hls.js", async () => {
    const n = createFacade();
    n._vodPlayer.running = false;
    expect(n._runVodFromStart(5)).toBe(true);

    n.stop(); // before the initialize() promise resolves
    await microtasks();

    expect(n._vodPlayer.stop).toHaveBeenCalledTimes(1); // cancels it at the engine too
    expect(n._vodPlayer.attach).not.toHaveBeenCalled();
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(n._livePlayer);
  });

  it("during a pending switch to VOD cancels the switch without an error", () => {
    const n = createFacade();
    n._switchToVod(3);
    expect(n._mode).toBe(MODE.PEND);
    const late = n._vodPlayer.pendingAttach;

    n.stop();

    expect(n._modeSwitch).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(n._vodPlayer.stop).toHaveBeenCalledTimes(1); // it held the UI
    expect(n._livePlayer.attach).toHaveBeenLastCalledWith(n._ui, idle);
    expect(n._livePlayer.attached).toBe(true);
    expect(n._livePlayer.stop).toHaveBeenCalledTimes(1);
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(n._livePlayer);
    expect(n._eventBus.emit).not.toHaveBeenCalled();

    late(); // the settled switch ignores its late completion
    expect(n._mode).toBe(MODE.LIVE);
  });

  it("during a pending switch to live stops the warm VOD engine and live", () => {
    // VOD detached (warm), live attached and playing, switch not settled
    const n = createFacade({ mode: MODE.VOD });
    n._mode = MODE.PEND;
    n._modeSwitch = { settled: false, timer: setTimeout(() => {}, 5000) };
    n._vodPlayer.attached = false;
    n._livePlayer.attached = true;

    n.stop();

    expect(n._vodPlayer.stop).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.attach.mock.results[0].value).toBe(false); // held
    expect(n._livePlayer.stop).toHaveBeenCalledTimes(1);
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(n._livePlayer);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("in live mode with a warm VOD engine stops it and live", () => {
    const n = createFacade();
    n._vodPlayer.running = true; // detached, reloading levels in the background

    n.stop();

    expect(n._vodPlayer.stop).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.attached).toBe(true);
    expect(n._livePlayer.stop).toHaveBeenCalledTimes(1);
    expect(n._mode).toBe(MODE.LIVE);
  });

  it("in live mode stops a stopped VOD engine too: a queued reload is cancelled at the engine", () => {
    const n = createFacade();
    n._vodPlayer.running = false;

    n.stop();

    expect(n._vodPlayer.stop).toHaveBeenCalledTimes(1);
    expect(n._mode).toBe(MODE.LIVE);
  });

  it("with no VOD engine stops live only", () => {
    const n = createFacade();
    n._vodPlayer = undefined;

    n.stop();

    expect(n._livePlayer.stop).toHaveBeenCalledTimes(1);
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(n._livePlayer);
  });

  it("on a destroyed player does nothing", () => {
    const n = createFacade({ mode: MODE.VOD });
    n._destroyed = true;

    n.stop();

    expect(n._vodPlayer.stop).not.toHaveBeenCalled();
    expect(n._livePlayer.stop).not.toHaveBeenCalled();
  });
});

describe("Nimio.setStreamURL()", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const order = (fn) => fn.mock.invocationCallOrder[0];
  const idle = { latency: 0, idle: true };

  it("in VOD mode a play() from the VOD playback-end listener does not double the live play", () => {
    const n = createFacade({ mode: MODE.VOD });
    n._vodPlayer.stop = vi.fn(function (cb) {
      this.attached = false;
      this.running = false;
      n.play();
      if (cb) cb();
    });

    n.setStreamURL("wss://example.test/new");

    expect(n._livePlayer.play).toHaveBeenCalledTimes(1);
    expect(n._playAfterStop).toBe(false);
  });

  it("in VOD mode stops and starts live with the new URL, no switch", () => {
    const n = createFacade({ mode: MODE.VOD });

    n.setStreamURL("wss://example.test/new");

    expect(n._config.streamUrl).toBe("wss://example.test/new");
    expect(n._vodPlayer.stop).toHaveBeenCalledTimes(1);
    expect(n._vodPlayer.detach).not.toHaveBeenCalled();
    expect(n._livePlayer.attach).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.attach).toHaveBeenCalledWith(n._ui, idle);
    expect(n._livePlayer.stop).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.play).toHaveBeenCalledTimes(1);
    expect(order(n._livePlayer.stop)).toBeLessThan(order(n._livePlayer.play));
    expect(n._livePlayer.setStreamURL).not.toHaveBeenCalled();
    expect(n._context.resetState).toHaveBeenCalledTimes(1);
    expect(n._modeSwitch ?? null).toBeNull();
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(n._livePlayer);
    expect(n._eventBus.emit).not.toHaveBeenCalled();
  });

  it("accepts the object form and records both URLs", () => {
    const n = createFacade({ mode: MODE.VOD });
    n._config.vod = { url: "https://example.test/old.m3u8" };

    n.setStreamURL({
      live: "wss://example.test/new",
      vod: "https://example.test/new.m3u8",
    });

    expect(n._config.streamUrl).toBe("wss://example.test/new");
    expect(n._config.vod.url).toBe("https://example.test/new.m3u8");
    expect(n._livePlayer.play).toHaveBeenCalledTimes(1);
    expect(n._mode).toBe(MODE.LIVE);
  });

  it("in VOD mode a destroy() from the playback-end listener leaves it silent", () => {
    const n = createFacade({ mode: MODE.VOD });
    n._instName = "sw-url-destroy";
    n._removeVolumeEventHandlers = vi.fn();
    n._livePlayer.destroy = vi.fn();
    n._vodPlayer.destroy = vi.fn();
    const livePlay = n._livePlayer.play;
    n._vodPlayer.stop = vi.fn(function () {
      n.destroy();
      this.attached = false;
      this.running = false;
    });

    expect(() => n.setStreamURL("wss://example.test/new")).not.toThrow();

    expect(n._destroyed).toBe(true);
    expect(livePlay).not.toHaveBeenCalled();
  });

  it("during a pending switch settles it silently and starts live with the new URL", () => {
    const n = createFacade();
    n._switchToVod(1);
    expect(n._mode).toBe(MODE.PEND);
    const late = n._vodPlayer.pendingAttach;

    n.setStreamURL("wss://example.test/new");

    expect(n._modeSwitch).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(n._vodPlayer.stop).toHaveBeenCalledTimes(1); // it held the UI
    expect(n._livePlayer.attach).toHaveBeenLastCalledWith(n._ui, idle);
    expect(n._livePlayer.play).toHaveBeenCalledTimes(1);
    expect(n._logger.warn).not.toHaveBeenCalled();
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(n._livePlayer);
    expect(n._eventBus.emit).not.toHaveBeenCalled();

    late(); // the settled switch ignores its late completion
    expect(n._mode).toBe(MODE.LIVE);
  });

  it("re-entrant from the VOD playback-end listener: the newest URL is recorded and played once", () => {
    const n = createFacade({ mode: MODE.VOD });
    n._vodPlayer.stop = vi.fn(function (cb) {
      n.setStreamURL("wss://example.test/newer"); // an application listener
      this.attached = false;
      this.running = false;
      if (cb) cb();
    });

    n.setStreamURL("wss://example.test/new");

    expect(n._config.streamUrl).toBe("wss://example.test/newer");
    expect(n._livePlayer.attach).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.stop).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.play).toHaveBeenCalledTimes(1);
    expect(n._mode).toBe(MODE.LIVE);
  });

  it("a setStreamURL() from the nimio:play listener of the restart takes the live-mode path once", () => {
    const n = createFacade({ mode: MODE.VOD });
    n._livePlayer.play = vi.fn(() => {
      n.setStreamURL("wss://example.test/newer"); // a listener of nimio:play LIVE
    });

    n.setStreamURL("wss://example.test/new");

    expect(n._config.streamUrl).toBe("wss://example.test/newer");
    expect(n._livePlayer.play).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.setStreamURL).toHaveBeenCalledTimes(1); // live mode by then
    expect(n._livePlayer.attach).toHaveBeenCalledTimes(1);
    expect(n._mode).toBe(MODE.LIVE);
  });

  it("in live mode a changed VOD URL resets the known VOD duration at once", () => {
    // the seek bar and the application must not keep the old archive's
    // scale until the new connection brings the reload
    const n = createFacade();
    n._config.vod = { url: "https://example.test/old.m3u8" };

    n.setStreamURL({ vod: "https://example.test/new.m3u8" });

    expect(n._playProgressSvc.resetVodDuration).toHaveBeenCalledTimes(1);
  });

  it("a destroy() from the progress listener of the duration reset leaves setStreamURL() quiet", () => {
    // the reset notifies the application synchronously; a listener that
    // removes the player must not be followed by a call into the gone engine
    const n = createFacade();
    n._instName = "sw-url-destroy";
    n._removeVolumeEventHandlers = vi.fn();
    n._livePlayer.destroy = vi.fn();
    n._vodPlayer.destroy = vi.fn();
    n._config.vod = { url: "https://example.test/old.m3u8" };
    n._playProgressSvc = { resetVodDuration: vi.fn(() => n.destroy()) };

    expect(() =>
      n.setStreamURL({ vod: "https://example.test/new.m3u8" }),
    ).not.toThrow();

    expect(n._destroyed).toBe(true);
  });

  it("in live mode an unchanged VOD URL keeps the known VOD duration", () => {
    const n = createFacade();
    n._config.vod = { url: "https://example.test/same.m3u8" };

    n.setStreamURL({ live: "wss://example.test/live2" });

    expect(n._playProgressSvc.resetVodDuration).not.toHaveBeenCalled();
    expect(n._vodPlayer.forgetSource).not.toHaveBeenCalled();
  });

  it.each([MODE.LIVE, MODE.VOD])(
    "in %s mode a changed VOD URL makes the engine forget its source before the application is told",
    (mode) => {
      // dropping the durations and keeping the engine's "loaded" mark apart
      // would leave the archive unloaded when the URL changes back; and a
      // listener of the reset must not find the old archive attachable
      const n = createFacade({ mode });
      n._config.vod = { url: "https://example.test/old.m3u8" };

      n.setStreamURL({ vod: "https://example.test/new.m3u8" });

      expect(n._vodPlayer.forgetSource).toHaveBeenCalledTimes(1);
      expect(
        n._vodPlayer.forgetSource.mock.invocationCallOrder[0],
      ).toBeLessThan(
        n._playProgressSvc.resetVodDuration.mock.invocationCallOrder[0],
      );
    },
  );

  it("re-entrant from a listener of a stop in progress, a changed VOD URL is forgotten too", () => {
    const n = createFacade({ mode: MODE.VOD });
    n._config.vod = { url: "https://example.test/old.m3u8" };
    n._stopping = true;

    n.setStreamURL({ vod: "https://example.test/new.m3u8" });

    expect(n._vodPlayer.forgetSource).toHaveBeenCalledTimes(1);
    expect(n._vodPlayer.stop).not.toHaveBeenCalled();
  });

  it("in VOD mode a changed VOD URL resets the known VOD duration before the stop", () => {
    const n = createFacade({ mode: MODE.VOD });
    n._config.vod = { url: "https://example.test/old.m3u8" };

    n.setStreamURL({ vod: "https://example.test/new.m3u8" });

    expect(n._playProgressSvc.resetVodDuration).toHaveBeenCalledTimes(1);
    expect(n._vodPlayer.stop).toHaveBeenCalled();
  });

  it("in live mode with an unchanged VOD URL only tells the live engine", () => {
    const n = createFacade();
    n._config.vod = { url: "https://example.test/archive.m3u8" };
    n._vodPlayer.running = true; // warm

    n.setStreamURL("wss://example.test/new");

    expect(n._livePlayer.setStreamURL).toHaveBeenCalledTimes(1);
    expect(n._vodPlayer.stop).not.toHaveBeenCalled();
    expect(n._livePlayer.attach).not.toHaveBeenCalled();
    expect(n._livePlayer.play).not.toHaveBeenCalled();
    expect(n._vodPlayer.detach).not.toHaveBeenCalled();
    expect(n._mode).toBe(MODE.LIVE);
  });

  it("in live mode stops a running VOD engine whose URL changed", () => {
    const n = createFacade();
    n._config.vod = { url: "https://example.test/old.m3u8" };
    n._vodPlayer.running = true; // warm, or reloading

    n.setStreamURL({
      live: "wss://example.test/new",
      vod: "https://example.test/new.m3u8",
    });

    expect(n._vodPlayer.stop).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.setStreamURL).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.play).not.toHaveBeenCalled();
    expect(n._mode).toBe(MODE.LIVE);
  });

  it("in live mode with a cold VOD engine a changed VOD URL calls the engine stop (a no-op there) and restarts live", () => {
    const n = createFacade();
    n._config.vod = { url: "https://example.test/old.m3u8" };
    n._vodPlayer.running = false;
    n._vodPlayer.isLoaded = () => false;

    expect(() =>
      n.setStreamURL({
        live: "wss://example.test/new",
        vod: "https://example.test/new.m3u8",
      }),
    ).not.toThrow();

    expect(n._vodPlayer.stop).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.setStreamURL).toHaveBeenCalledTimes(1);
  });

  it("in live mode a changed VOD URL voids a pending VOD start", async () => {
    const n = createFacade();
    n._config.vod = { url: "https://example.test/old.m3u8" };
    n._vodPlayer.running = false;
    expect(n._runVodFromStart(5)).toBe(true);

    n.setStreamURL({
      live: "wss://example.test/new",
      vod: "https://example.test/new.m3u8",
    });
    await microtasks();

    expect(n._vodPlayer.stop).toHaveBeenCalledTimes(1); // cancels the queued reload
    expect(n._vodPlayer.attach).not.toHaveBeenCalled();
    expect(n._mode).toBe(MODE.LIVE);
  });

  it("in live mode an unchanged VOD URL keeps a pending VOD start", async () => {
    const n = createFacade();
    n._config.vod = { url: "https://example.test/archive.m3u8" };
    n._vodPlayer.running = false;
    expect(n._runVodFromStart(5)).toBe(true);

    n.setStreamURL("wss://example.test/new");
    await microtasks();

    expect(n._vodPlayer.attach).toHaveBeenCalledWith(
      n._ui,
      5,
      expect.any(Function),
    );
  });

  it("on a destroyed player does nothing", () => {
    const n = createFacade({ mode: MODE.VOD });
    n._destroyed = true;

    n.setStreamURL("wss://example.test/new");

    expect(n._config.streamUrl).toBe("wss://example.test/old");
    expect(n._livePlayer.setStreamURL).not.toHaveBeenCalled();
    expect(n._livePlayer.play).not.toHaveBeenCalled();
  });
});

describe("Nimio VOD start from a non-running engine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function liveDetachRecording(n, value) {
    // the real live detach writes the engine's state into the context
    n._livePlayer.detach = vi.fn(function (cb) {
      this.attached = false;
      n._context.setState(value, false);
      if (cb) cb();
      return true;
    });
  }

  it("a position change into a non-running VOD engine re-initialises and starts it", async () => {
    const n = createFacade();
    n._vodPlayer.running = false; // stopped: attachable with a stale URL otherwise

    expect(n._onPlaybackPositionChange(MODE.VOD, 7)).toBe(true);
    await microtasks();

    expect(n._vodPlayer.initialize).toHaveBeenCalledWith(n._ui.mediaElement);
    expect(n._vodPlayer.attach).toHaveBeenCalledWith(
      n._ui,
      7,
      expect.any(Function),
    );
  });

  it("a position change into a running VOD engine switches directly", () => {
    const n = createFacade();
    n._vodPlayer.running = true;

    expect(n._onPlaybackPositionChange(MODE.VOD, 7)).toBe(true);

    expect(n._vodPlayer.initialize).not.toHaveBeenCalled();
    expect(n._vodPlayer.attach).toHaveBeenCalledWith(
      n._ui,
      7,
      expect.any(Function),
    );
  });

  it("a position change into VOD without a VOD engine returns false", () => {
    const n = createFacade();
    n._vodPlayer = undefined;

    expect(n._onPlaybackPositionChange(MODE.VOD, 7)).toBe(false);
    expect(n._mode).toBe(MODE.LIVE);
  });

  it("keeps the context value the live detach wrote: stopped player → STOPPED, which opens the VOD paused", async () => {
    const n = createFacade();
    n._vodPlayer.running = false;
    liveDetachRecording(n, STATE.STOPPED);

    n._runVodFromStart(3);
    await microtasks();

    expect(n._context.state).toEqual({ value: STATE.STOPPED, initial: false });
  });

  it("keeps the context value the live detach wrote: playing player → playing VOD", async () => {
    const n = createFacade();
    n._vodPlayer.running = false;
    liveDetachRecording(n, STATE.PLAYING);

    n._runVodFromStart(3);
    await microtasks();

    expect(n._context.state).toEqual({ value: STATE.PLAYING, initial: false });
  });

  it("marks the startup failover as initial, so the autoplay setting decides", async () => {
    const n = createFacade();
    n._vodPlayer.running = false;
    liveDetachRecording(n, STATE.STOPPED);

    n._runVodFromStart(undefined, { initial: true });
    await microtasks();

    expect(n._context.state).toEqual({ value: STATE.STOPPED, initial: true });
  });

  it("the NO_SRC startup failover starts VOD as initial", () => {
    const n = createFacade();
    n._config.vod = { startupVodFailover: true };
    n._runVodFromStart = vi.fn(() => true);

    n._onLivePlaybackError("NO_SRC", true);

    expect(n._runVodFromStart).toHaveBeenCalledWith(undefined, {
      initial: true,
    });
    expect(n._eventBus.emit).not.toHaveBeenCalled();
  });

  const noSrcEvent = [
    "nimio:playback-error",
    { error: ERROR.NO_SRC, mode: MODE.LIVE },
  ];

  it("a startup failover whose switch to VOD fails reports NO_SRC after the switch error", async () => {
    // the server rejected live and the archive could not be opened either:
    // the player ends stopped, and the application must hear why
    const n = createFacade();
    n._config.vod = { startupVodFailover: true };
    n._onLivePlaybackError("NO_SRC", true);
    await microtasks();
    expect(n._mode).toBe(MODE.PEND);

    vi.advanceTimersByTime(5000); // VOD never reports media attached

    expect(n._mode).toBe(MODE.LIVE);
    expect(n._livePlayer.attach).toHaveBeenCalledWith(
      n._ui,
      { latency: 0, idle: true },
      expect.any(Function),
    );
    expect(n._eventBus.emit.mock.calls).toEqual([
      errorEvent(MODE.VOD),
      noSrcEvent,
    ]);
  });

  it("a startup failover refused at once reports NO_SRC as well", async () => {
    const n = createFacade({ vod: fakeVod({ attach: false }) });
    n._config.vod = { startupVodFailover: true };
    n._onLivePlaybackError("NO_SRC", true);

    await microtasks();

    expect(n._eventBus.emit.mock.calls).toEqual([
      errorEvent(MODE.VOD),
      noSrcEvent,
    ]);
  });

  it("a play() from the switch error listener of a failed failover gets no NO_SRC", async () => {
    // the new live attempt reports its own outcome
    const n = createFacade();
    n._config.vod = { startupVodFailover: true };
    const events = [];
    n._eventBus.emit = vi.fn((name, data) => {
      events.push([name, data]);
      if (data.error === ERROR.MODE_SWITCH) n.play();
    });
    n._onLivePlaybackError("NO_SRC", true);
    await microtasks();

    vi.advanceTimersByTime(5000);

    expect(n._livePlayer.play).toHaveBeenCalledTimes(1);
    expect(events).toEqual([errorEvent(MODE.VOD)]);
  });

  it("a seekVod() from the switch error listener of a failed failover gets no NO_SRC", async () => {
    // the retry was accepted and the archive is being opened after all:
    // "no playable sources" would be false, and that attempt reports for
    // itself
    const n = createFacade();
    n._config.vod = { startupVodFailover: true };
    const events = [];
    const accepted = [];
    n._eventBus.emit = vi.fn((name, data) => {
      events.push([name, data]);
      if (data.error === ERROR.MODE_SWITCH) accepted.push(n.seekVod(7));
    });
    n._onLivePlaybackError("NO_SRC", true);
    await microtasks();

    vi.advanceTimersByTime(5000);

    expect(accepted).toEqual([true]);
    expect(events).toEqual([errorEvent(MODE.VOD)]);
    await microtasks();
    expect(n._vodPlayer.attach).toHaveBeenLastCalledWith(
      n._ui,
      7,
      expect.any(Function),
    );
  });

  it("a seekVod() from the switch error listener of a paused player still gets the playback end", async () => {
    // the paused live playback did end, whatever opens next
    const n = createFacade();
    liveDetachRecording(n, STATE.PAUSED);
    const events = [];
    const accepted = [];
    n._eventBus.emit = vi.fn((name, data) => {
      events.push([name, data]);
      if (data.error === ERROR.MODE_SWITCH) accepted.push(n.seekVod(7));
    });
    n._runVodFromStart(5);
    await microtasks();

    vi.advanceTimersByTime(5000);

    expect(accepted).toEqual([true]);
    expect(events).toEqual([
      errorEvent(MODE.VOD),
      ["nimio:playback-end", { mode: MODE.LIVE }],
    ]);
  });

  it("a failover whose rollback restarts live reports no NO_SRC", async () => {
    // a play() while hls.js was loading: the detach records a playing
    // engine, the rollback restarts it, and that attempt reports for itself
    const n = createFacade();
    n._config.vod = { startupVodFailover: true };
    liveDetachRecording(n, STATE.PLAYING);
    n._onLivePlaybackError("NO_SRC", true);
    await microtasks();

    vi.advanceTimersByTime(5000);

    expect(n._livePlayer.attach).toHaveBeenCalledWith(
      n._ui,
      { latency: 0 },
      expect.any(Function),
    );
    expect(n._eventBus.emit.mock.calls).toEqual([errorEvent(MODE.VOD)]);
  });

  it("a seek whose switch to VOD fails on a stopped player reports no NO_SRC", async () => {
    const n = createFacade();
    liveDetachRecording(n, STATE.STOPPED);
    n._runVodFromStart(5);
    await microtasks();

    vi.advanceTimersByTime(5000);

    expect(n._eventBus.emit.mock.calls).toEqual([errorEvent(MODE.VOD)]);
  });

  it("a newer start supersedes a pending one", async () => {
    const n = createFacade();
    n._vodPlayer.running = false;

    n._runVodFromStart(1);
    n._runVodFromStart(2);
    await microtasks();

    expect(n._vodPlayer.attach).toHaveBeenCalledTimes(1);
    expect(n._vodPlayer.attach).toHaveBeenCalledWith(
      n._ui,
      2,
      expect.any(Function),
    );
  });

  it("a destroy() from the end event of a refused switch ends the start quietly", async () => {
    // a paused player: the refused attach restores live idle and reports the
    // end; the listener removes the player, and the start's continuation
    // must not touch the context any more (the restore wrote it once)
    const n = createFacade({ vod: fakeVod({ attach: false }) });
    n._context.state.value = STATE.PAUSED;
    n._eventBus.emit = vi.fn((name) => {
      if (name === "nimio:playback-end") n._destroyed = true;
    });

    expect(n._runVodFromStart(5)).toBe(true);
    await microtasks();

    expect(n._context.setState).toHaveBeenCalledTimes(1); // the restore only
  });

  it("returns false for a cold engine and for a running one", () => {
    const cold = createFacade();
    cold._vodPlayer.isLoaded = () => false;
    expect(cold._runVodFromStart(1)).toBe(false);

    const running = createFacade();
    running._vodPlayer.running = true;
    expect(running._runVodFromStart(1)).toBe(false);
  });
});
