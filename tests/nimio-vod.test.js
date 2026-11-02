import { describe, it, expect, vi, afterEach } from "vitest";
import { NimioVod } from "@/nimio-vod.js";
import { PlaybackContext } from "@/playback/context";
import { releaseInstances } from "@/shared/service";

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
    levelsSourceUrl: "https://example.com/playlist_dvr.m3u8",
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

  it("returns false while no source is known (a failed load forgot the URL)", () => {
    // a master playlist that never loaded left the engine in SYNC with no
    // URL; an attach would hand hls.js an undefined source
    const vod = createVod(VOD_STATE.SYNC);
    vod._url = undefined;
    const ui = { toggleMode: vi.fn(), mediaElement: {} };
    const cb = vi.fn();

    expect(vod.attach(ui, 0, cb)).toBe(false);

    expect(ui.toggleMode).not.toHaveBeenCalled();
    expect(vod._pHandler.loadSource).not.toHaveBeenCalled();
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

  it("does not reload a variant of another source after a detach during a URL change", () => {
    // the levels in the context still belong to the previous archive; the
    // reload would fetch its variant and record it under the new URL
    const vod = createVod();
    vod._pHandler.detachMedia = vi.fn(() => vod._onMediaDetached());
    vod._context.hasVod = () => true;
    vod._context.levelsSourceUrl = "https://example.com/old.m3u8";
    vod._context.getCurrentLevel = () => ({
      data: { url: ["https://example.com/old/720p/playlist.m3u8"] },
    });
    vod.attach(createUi(), undefined, undefined);
    vod._pHandler.loadSource.mockClear();

    expect(vod.detach(vi.fn())).toBe(true);

    expect(vod._pHandler.loadSource).not.toHaveBeenCalled();
    expect(vod._state).toBe(VOD_STATE.SYNC);
  });

  it("returns false without calling back when detach is requested while not attached", () => {
    const vod = createVod(VOD_STATE.SYNC);
    const cb = vi.fn();
    expect(vod.detach(cb)).toBe(false);
    vod._onMediaDetached();
    expect(cb).not.toHaveBeenCalled();
  });
});

// After a stream URL change the context still holds the previous archive's
// levels, with the variant details (and duration) cached on the current one.
// The new source's master manifest must replace them, not be treated as a
// level update of the old archive, which republished the old duration.
describe("NimioVod._onManifestParsed() after a source change", () => {
  const NAME = "vod-manifest-source";
  const OLD = "https://a.test/old/playlist.m3u8";
  const NEW = "https://a.test/new/playlist.m3u8";

  function contextWithPlayedArchive() {
    const ctx = PlaybackContext.getInstance(NAME);
    ctx.setLevels(
      [{ url: ["https://a.test/old/720p/playlist.m3u8?s=1"], height: 720 }],
      OLD,
    );
    ctx.setCurrentLevelIdx(0);
    ctx.updateCurrentLevel({ details: { totalduration: 10 } }); // played before
    return ctx;
  }

  function reloadedEngine(ctx, url) {
    const vod = createVod(VOD_STATE.STOP);
    vod._context = ctx;
    vod._url = url;
    vod._metadataReady = true; // the archive the levels belong to played
    vod._config = { adaptiveBitrate: {} };
    vod._progressSvc = { updateVodPlaylistDuration: vi.fn() };
    vod._loadCurrentLevel = vi.fn();
    vod._updateUiLayout = vi.fn();
    return vod;
  }

  afterEach(() => {
    releaseInstances(NAME);
  });

  it("a manifest from a new source replaces the cached levels and publishes no old duration", () => {
    const ctx = contextWithPlayedArchive();
    const vod = reloadedEngine(ctx, NEW);

    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://a.test/new/720p/playlist.m3u8?s=9"], height: 720 },
      ],
    });

    expect(vod._progressSvc.updateVodPlaylistDuration).not.toHaveBeenCalled();
    expect(ctx.levelsSourceUrl).toBe(NEW);
    expect(ctx.getCurrentLevel().data.url[0]).toBe(
      "https://a.test/new/720p/playlist.m3u8?s=9",
    );
    expect(ctx.getCurrentLevel().data.details).toBeUndefined();
    expect(vod._sessionParam).toBe("s=9");
    expect(vod._loadCurrentLevel).toHaveBeenCalledTimes(1); // the new variant
  });

  it("a new source with fewer renditions before the live connection completes selects a valid level", () => {
    // a higher rendition was selected on the old archive; the live-mode URL
    // change reset the current configuration, and the old live metadata is
    // still there until the new status arrives
    const ctx = PlaybackContext.getInstance(NAME);
    ctx._ordRenditions = [{}]; // stale live metadata
    ctx._curConf = [];
    ctx.setLevels(
      [
        { url: ["https://a.test/old/360p/playlist.m3u8?s=1"], height: 360 },
        { url: ["https://a.test/old/720p/playlist.m3u8?s=1"], height: 720 },
        { url: ["https://a.test/old/1080p/playlist.m3u8?s=1"], height: 1080 },
      ],
      OLD,
    );
    ctx.setCurrentLevelIdx(2);
    const vod = reloadedEngine(ctx, NEW);

    expect(() =>
      vod._onManifestParsed(null, {
        levels: [
          { url: ["https://a.test/new/360p/playlist.m3u8?s=9"], height: 360 },
        ],
      }),
    ).not.toThrow();

    expect(ctx.getCurrentLevel().idx).toBe(0);
    expect(vod._sessionParam).toBe("s=9");
    expect(vod._updateUiLayout).toHaveBeenCalledTimes(1);
    expect(vod._loadCurrentLevel).toHaveBeenCalledTimes(1);
  });

  it("a new source selects the configured initial rendition although live metadata is stale", () => {
    const ctx = PlaybackContext.getInstance(NAME);
    ctx._ordRenditions = [{}]; // stale live metadata of the previous stream
    ctx._curConf = [];
    ctx.setLevels(
      [{ url: ["https://a.test/old/360p/playlist.m3u8?s=1"], height: 360 }],
      OLD,
    );
    ctx.setCurrentLevelIdx(0);
    const vod = reloadedEngine(ctx, NEW);
    vod._config.adaptiveBitrate.initialRendition = "720p";

    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://a.test/new/360p/playlist.m3u8?s=9"], height: 360 },
        { url: ["https://a.test/new/720p/playlist.m3u8?s=9"], height: 720 },
      ],
    });

    expect(ctx.getCurrentLevel().idx).toBe(1);
  });

  it("a new source keeps the live selection when the live metadata is fresh", () => {
    // live already plays the new stream at 360p: the VOD level that maps to
    // that stream is the selection, and the configured initial rendition
    // must not silently move it to 720p
    const ctx = PlaybackContext.getInstance(NAME);
    ctx._ordRenditions = [{}];
    ctx._streamsMap = { "360p": 0 }; // the live stream list of the new URL
    ctx._curConf = { video: { idx: 0 } }; // playing 360p
    ctx.setLevels(
      [{ url: ["https://a.test/old/360p/playlist.m3u8?s=1"], height: 360 }],
      OLD,
    );
    ctx.setCurrentLevelIdx(0);
    const vod = reloadedEngine(ctx, NEW);
    vod._config.adaptiveBitrate.initialRendition = "720p";

    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://a.test/new/360p/playlist.m3u8?s=9"], height: 360 },
        { url: ["https://a.test/new/720p/playlist.m3u8?s=9"], height: 720 },
      ],
    });

    expect(ctx.getCurrentLevel().idx).toBe(0);
    expect(ctx._curConf.video.idx).toBe(0);
  });

  it("a manifest from the same source is a level update and republishes the duration", () => {
    const ctx = contextWithPlayedArchive();
    const vod = reloadedEngine(ctx, OLD);

    // a level update of a loaded source: hls.js delivers the variant with
    // its details (a master without details never follows a loaded source)
    vod._onManifestParsed(null, {
      levels: [
        {
          url: ["https://a.test/old/720p/playlist.m3u8?s=1"],
          height: 720,
          details: { totalduration: 10 },
        },
      ],
    });

    expect(vod._progressSvc.updateVodPlaylistDuration).toHaveBeenCalledWith(10);
    expect(vod._loadCurrentLevel).not.toHaveBeenCalled();
  });
});
