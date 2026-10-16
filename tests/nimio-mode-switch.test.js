import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Nimio from "@/nimio.js";
import { NimioVod } from "@/nimio-vod.js";
import { MODE, ERROR } from "@/shared/values";

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
  n._ui = { id: "ui", destroy: vi.fn() };
  n._context = { state: { value: 0, initial: false } };
  n._livePlayer = fakeLive();
  n._vodPlayer = vod || fakeVod();
  n._vuMeterSvc = { clear: vi.fn() };
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
    expect(n._switchToVod(5)).toBe(true);
    vi.advanceTimersByTime(4999);
    expect(n._mode).toBe(MODE.PEND);
    vi.advanceTimersByTime(1);
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(n._livePlayer);
    expect(n._vodPlayer.detach).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.attach).toHaveBeenCalledTimes(1);
    expect(n._eventBus.emit).toHaveBeenCalledWith(...errorEvent(MODE.VOD));
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

    n.play();
    expect(n._livePlayer.play).toHaveBeenCalledTimes(1);
  });

  it("a second stop() is a no-op", () => {
    const n = createFacade({ mode: MODE.VOD });
    n.stop();
    n._vodPlayer.stop.mockClear();
    n._livePlayer.attach.mockClear();

    expect(() => n.stop()).not.toThrow();

    expect(n._vodPlayer.stop).not.toHaveBeenCalled(); // not running any more
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

  it("a play() from the VOD playback-end listener is a no-op", () => {
    const n = createFacade({ mode: MODE.VOD });
    n._vodPlayer.stop = vi.fn(function (cb) {
      n.play(); // an application listener of nimio:playback-end
      this.attached = false;
      this.running = false;
      if (cb) cb();
    });

    n.stop();

    expect(n._vodPlayer.play).toHaveBeenCalledTimes(1); // the stopping engine
    expect(n._livePlayer.play).not.toHaveBeenCalled();
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

  it("in VOD mode tells the live engine first, then switches to live with one attach", () => {
    const n = createFacade({ mode: MODE.VOD });

    n.setStreamURL("wss://example.test/new");

    expect(n._config.streamUrl).toBe("wss://example.test/new");
    expect(n._livePlayer.setStreamURL).toHaveBeenCalledTimes(1);
    expect(n._vodPlayer.detach).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.attach).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.attach).toHaveBeenCalledWith(
      n._ui,
      { latency: 0 },
      expect.any(Function),
    );
    expect(order(n._livePlayer.setStreamURL)).toBeLessThan(
      order(n._livePlayer.attach),
    );
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
    expect(n._livePlayer.attach).toHaveBeenCalledTimes(1);
    expect(n._mode).toBe(MODE.LIVE);
  });

  it("in VOD mode with a refused live attach restores VOD and reports the error", () => {
    const n = createFacade({ mode: MODE.VOD });
    n._livePlayer.attach = vi.fn(() => false);

    n.setStreamURL("wss://example.test/new");

    expect(n._mode).toBe(MODE.VOD);
    expect(n._actPlayer).toBe(n._vodPlayer);
    expect(n._vodPlayer.attach).toHaveBeenCalledTimes(1); // restored
    expect(n._eventBus.emit).toHaveBeenCalledWith(...errorEvent(MODE.LIVE));
    expect(n._config.streamUrl).toBe("wss://example.test/new"); // kept
  });

  it("during a pending switch applies only the engine-level change and warns", () => {
    const n = createFacade();
    n._switchToVod(1);
    expect(n._mode).toBe(MODE.PEND);

    n.setStreamURL("wss://example.test/new");

    expect(n._livePlayer.setStreamURL).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.attach).not.toHaveBeenCalled();
    expect(n._logger.warn).toHaveBeenCalledTimes(1);
    expect(n._mode).toBe(MODE.PEND);

    n._vodPlayer.pendingAttach(); // the switch completes as it would have
    expect(n._mode).toBe(MODE.VOD);
  });

  it("in live mode only tells the live engine", () => {
    const n = createFacade();

    n.setStreamURL("wss://example.test/new");

    expect(n._livePlayer.setStreamURL).toHaveBeenCalledTimes(1);
    expect(n._livePlayer.attach).not.toHaveBeenCalled();
    expect(n._vodPlayer.detach).not.toHaveBeenCalled();
    expect(n._mode).toBe(MODE.LIVE);
  });

  it("on a destroyed player does nothing", () => {
    const n = createFacade({ mode: MODE.VOD });
    n._destroyed = true;

    n.setStreamURL("wss://example.test/new");

    expect(n._config.streamUrl).toBe("wss://example.test/old");
    expect(n._livePlayer.setStreamURL).not.toHaveBeenCalled();
  });
});
