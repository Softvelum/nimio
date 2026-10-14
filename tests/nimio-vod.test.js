import { describe, it, expect, vi } from "vitest";
import { NimioVod } from "@/nimio-vod.js";

const VOD_STATE = { NULL: 0, INIT: 1, SYNC: 2, PLAY: 3, STOP: 4 };

function createVod(state = VOD_STATE.SYNC) {
  // Without a config the constructor returns early, but the hls.js event
  // handlers (class fields) are initialized, which Object.create would skip.
  const vod = new NimioVod("vod-test", undefined);
  vod._state = state;
  vod._logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  vod._pHandler = {
    loadSource: vi.fn(),
    stopLoad: vi.fn(),
    pauseBuffering: vi.fn(),
    attachMedia: vi.fn(),
    detachMedia: vi.fn(),
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

function createUi() {
  return {
    toggleMode: vi.fn(),
    setDetached: vi.fn(),
    mediaElement: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
  };
}

describe("NimioVod attach/detach callbacks", () => {
  it("returns false without calling back when not initialized", () => {
    const vod = createVod(VOD_STATE.INIT);
    const cb = vi.fn();
    expect(vod.attach(createUi(), undefined, cb)).toBe(false);
    vod._onMediaAttached();
    expect(cb).not.toHaveBeenCalled();
  });

  it("replaces a pending attached callback with the newest one", () => {
    const vod = createVod();
    const first = vi.fn();
    const second = vi.fn();
    vod.attach(createUi(), undefined, first);
    vod.attach(createUi(), undefined, second);
    vod._onMediaAttached();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("drops a pending attached callback when detached before media attached", () => {
    const vod = createVod();
    const attachedCb = vi.fn();
    const detachedCb = vi.fn();
    vod.attach(createUi(), undefined, attachedCb);
    expect(vod.detach(detachedCb)).toBe(true);
    vod._onMediaDetached();
    vod._onMediaAttached();
    expect(detachedCb).toHaveBeenCalledTimes(1);
    expect(attachedCb).not.toHaveBeenCalled();
  });

  it("invokes the detach callback only after the engine is fully detached", () => {
    const vod = createVod();
    // hls.js fires MEDIA_DETACHED synchronously from inside detachMedia().
    vod._pHandler.detachMedia = vi.fn(() => vod._onMediaDetached());
    vod.attach(createUi(), undefined, undefined);
    const seen = {};
    const cb = vi.fn(() => {
      seen.state = vod._state;
      seen.ui = vod._ui;
    });
    expect(vod.detach(cb)).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(seen.state).toBe(VOD_STATE.SYNC);
    expect(seen.ui).toBeUndefined();
  });

  it("reloads the current variant playlist after a plain detach", () => {
    const vod = createVod();
    vod._pHandler.detachMedia = vi.fn(() => vod._onMediaDetached());
    vod._context.hasVod = () => true;
    vod._context.getCurrentLevel = () => ({
      data: { url: ["https://example.com/720p/playlist_dvr.m3u8"] },
    });
    vod.attach(createUi(), undefined, undefined);
    vod._pHandler.loadSource.mockClear();
    expect(vod.detach(vi.fn())).toBe(true);
    expect(vod._pHandler.loadSource).toHaveBeenLastCalledWith(
      "https://example.com/720p/playlist_dvr.m3u8",
    );
  });

  it("does not overwrite the master playlist when the callback re-attaches the engine", () => {
    const vod = createVod();
    vod._pHandler.detachMedia = vi.fn(() => vod._onMediaDetached());
    vod._context.hasVod = () => true;
    vod._context.getCurrentLevel = () => ({
      data: { url: ["https://example.com/720p/playlist_dvr.m3u8"] },
    });
    const ui = createUi();
    vod.attach(ui, undefined, undefined);
    vod._pHandler.loadSource.mockClear();
    expect(vod.detach(() => vod.attach(ui, undefined, undefined))).toBe(true);
    expect(vod._pHandler.loadSource).toHaveBeenLastCalledWith(
      "https://example.com/playlist_dvr.m3u8",
    );
    expect(vod._pHandler.loadSource).not.toHaveBeenCalledWith(
      "https://example.com/720p/playlist_dvr.m3u8",
    );
    expect(vod._state).toBe(VOD_STATE.PLAY);
  });

  it("returns false without calling back when detach is requested while not attached", () => {
    const vod = createVod(VOD_STATE.SYNC);
    const cb = vi.fn();
    expect(vod.detach(cb)).toBe(false);
    vod._onMediaDetached();
    expect(cb).not.toHaveBeenCalled();
  });
});
