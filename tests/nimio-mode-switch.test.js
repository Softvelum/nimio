import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Nimio from "@/nimio.js";
import { NimioVod } from "@/nimio-vod.js";
import { MODE, ERROR } from "@/shared/values";

function fakeLive() {
  return {
    attached: true,
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

function fakeVod({ attach = "async" } = {}) {
  return {
    attached: false,
    pendingAttach: null,
    hasPlaybackErrors: () => false,
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
  if (mode === MODE.VOD) {
    n._livePlayer.attached = false;
    n._vodPlayer.attached = true;
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
    n._switchToVod(1);
    n.destroy();
    vi.advanceTimersByTime(5000);
    expect(n._eventBus.emit).not.toHaveBeenCalledWith(...errorEvent(MODE.VOD));
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
