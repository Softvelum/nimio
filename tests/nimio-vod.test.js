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

  it("loads the configured source when a failed load forgot the URL", () => {
    // a master playlist that never loaded left the engine in SYNC, which
    // counts as running: seeks go straight to attach(), and it must retry
    // the load instead of refusing until the next live connection
    const vod = createVod(VOD_STATE.SYNC);
    vod._url = undefined;
    vod._config = { url: "https://example.com/playlist_dvr.m3u8" };
    const ui = createUi();
    const cb = vi.fn();

    expect(vod.attach(ui, undefined, cb)).toBe(true);

    expect(vod._url).toBe("https://example.com/playlist_dvr.m3u8");
    expect(vod._pHandler.loadSource).toHaveBeenCalledWith(
      "https://example.com/playlist_dvr.m3u8",
    );
    expect(vod._pHandler.attachMedia).toHaveBeenCalledWith(ui.mediaElement);
  });

  it("returns false when no source is configured either", () => {
    // hls.js is never handed an undefined source
    const vod = createVod(VOD_STATE.SYNC);
    vod._url = undefined;
    vod._config = {};
    const ui = createUi();
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
    vod._metadataReady = true; // the archive played
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

  it("does not reload a variant of a source whose playlist never loaded", () => {
    // a load failed after the master playlist, and a seek retried it: the
    // levels in the context are the failed attempt's, with a session
    // parameter the engine has forgotten. A detach before the new master
    // answers must let that request finish, not replace it with the old
    // variant.
    const vod = createVod();
    vod._metadataReady = false;
    vod._context.hasVod = () => true;
    vod._context.getCurrentLevel = () => ({
      data: { url: ["https://example.com/360p/playlist.m3u8?s=1"] },
    });
    vod._pHandler.detachMedia = vi.fn(() => vod._onMediaDetached());
    vod.attach(createUi(), undefined, undefined);

    expect(vod.detach(() => {})).toBe(true);

    expect(vod._pHandler.loadSource.mock.calls).toEqual([
      ["https://example.com/playlist_dvr.m3u8"],
    ]);
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

  it("a manifest that arrives after the source was forgotten is ignored", () => {
    // a stop() (or a fatal error) before the variant playlist forgot the
    // URL; a master playlist response that still arrives has no source to
    // be recorded under, and must not replace the levels or load a variant
    const ctx = contextWithPlayedArchive();
    const vod = reloadedEngine(ctx, undefined);
    vod._metadataReady = false;

    vod._onManifestParsed(null, {
      levels: [{ url: ["https://a.test/new/360p/playlist.m3u8"], height: 360 }],
    });

    expect(ctx.levelsSourceUrl).toBe(OLD);
    expect(ctx.getCurrentLevel().data.url[0]).toContain("/old/");
    expect(vod._loadCurrentLevel).not.toHaveBeenCalled();
    expect(vod._updateUiLayout).not.toHaveBeenCalled();
  });

  it("a variant playlist that arrives after the source was forgotten is ignored, and the loading stopped", () => {
    // it would mark the forgotten source as usable and publish its
    // duration; hls.js goes on loading after a manifest it delivered, and
    // a stopped engine must not keep polling the archive
    const ctx = contextWithPlayedArchive();
    const vod = reloadedEngine(ctx, undefined);
    vod._metadataReady = false;

    vod._onLevelLoaded(null, {
      details: { totalduration: 99, fragments: [] },
    });

    expect(vod._metadataReady).toBe(false);
    expect(vod._progressSvc.updateVodPlaylistDuration).not.toHaveBeenCalled();
    expect(vod._pHandler.stopLoad).toHaveBeenCalledTimes(1);
  });

  it("an engine that is not stopped takes the configured source back when a playlist arrives", () => {
    // a fatal error forgot the source, but loading went on (hls.js
    // recovered, or the application restarted it through the handler):
    // the response is the configured source's and makes it usable
    const ctx = contextWithPlayedArchive();
    const vod = reloadedEngine(ctx, undefined);
    vod._state = VOD_STATE.SYNC;
    vod._metadataReady = false;
    vod._config.url = NEW;

    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://a.test/new/360p/playlist.m3u8?s=7"], height: 360 },
      ],
    });

    expect(vod._url).toBe(NEW);
    expect(ctx.levelsSourceUrl).toBe(NEW);
    expect(vod._sessionParam).toBe("s=7");
    expect(vod._loadCurrentLevel).toHaveBeenCalledTimes(1);

    vod._forgetSource(); // a second fatal error, then the variant arrives
    vod._onLevelLoaded(null, {
      details: { totalduration: 99, fragments: [] },
    });

    expect(vod._url).toBe(NEW);
    expect(vod._metadataReady).toBe(true);
    expect(vod._progressSvc.updateVodPlaylistDuration).toHaveBeenCalledWith(99);
    expect(vod._pHandler.stopLoad).not.toHaveBeenCalled();
  });

  it("an attach retry with another source's levels in the context requests only the configured source", () => {
    // URL change, a failed reload, a failover back to live: SYNC, the URL
    // forgotten, the old archive's levels still in the context
    const ctx = contextWithPlayedArchive();
    const vod = reloadedEngine(ctx, undefined);
    vod._state = VOD_STATE.SYNC;
    vod._metadataReady = false;
    vod._config.url = NEW;
    vod._eventBus = { emit: vi.fn() };
    vod._playbackService.setCurrentTime = vi.fn();

    expect(vod.attach(createUi(), 30, undefined)).toBe(true);
    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://a.test/new/360p/playlist.m3u8?s=9"], height: 360 },
      ],
    });

    expect(vod._pHandler.loadSource.mock.calls).toEqual([[NEW]]);
    expect(ctx.levelsSourceUrl).toBe(NEW);
    expect(ctx.getCurrentLevel().data.url[0]).toContain("/new/");
    expect(vod._sessionParam).toBe("s=9");
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

describe("NimioVod: the first playlist after an attach validates the position", () => {
  // the progress service clamps a seek to the duration it knows; with no
  // duration known (a new source, a first load still running, a start of a
  // stopped engine) the target reaches the media element as is, and the
  // first variant playlist after the attach validates it
  function attachedAt(position, { metadataReady = false } = {}) {
    const vod = createVod(VOD_STATE.SYNC);
    vod._metadataReady = metadataReady;
    vod._config = {};
    vod._context.state = { value: 0, initial: false }; // opens paused
    vod._progressSvc = { updateVodPlaylistDuration: vi.fn() };
    let time = 0; // the media element's position, read back as set
    vod._playbackService = {
      init: vi.fn(),
      resetPosition: vi.fn(),
      state: 0,
      getCurrentTime: () => time,
      setCurrentTime: vi.fn((t) => {
        time = t;
      }),
    };
    vod.attach(createUi(), position, undefined);
    vod._playbackService.setCurrentTime.mockClear();
    return vod;
  }
  const playlist = (totalduration) => ({
    details: { totalduration, fragments: [] },
  });

  it("a target beyond the end is moved to the end", () => {
    const vod = attachedAt(500);

    vod._onLevelLoaded(null, playlist(120));

    expect(vod._playbackService.setCurrentTime.mock.calls).toEqual([[120]]);
  });

  it("a target inside the archive is left alone", () => {
    const vod = attachedAt(30);

    vod._onLevelLoaded(null, playlist(120));

    expect(vod._playbackService.setCurrentTime).not.toHaveBeenCalled();
  });

  it("also for a source whose playlist had loaded before", () => {
    // the durations may be unknown all the same (a URL changed and changed
    // back), and a start of a stopped engine does not go through the
    // progress service at all
    const vod = attachedAt(500, { metadataReady: true });

    vod._onLevelLoaded(null, playlist(120));

    expect(vod._playbackService.setCurrentTime.mock.calls).toEqual([[120]]);
  });

  it("a seek made between the attach and the playlist is validated too", () => {
    const vod = attachedAt(undefined, { metadataReady: true });
    vod.goto(500);
    vod._playbackService.setCurrentTime.mockClear();

    vod._onLevelLoaded(null, playlist(120));

    expect(vod._playbackService.setCurrentTime.mock.calls).toEqual([[120]]);
  });

  it("a later reload of the playlist does not move the position", () => {
    // once per attach: from then on the progress service knows the duration
    const vod = attachedAt(30);
    vod._onLevelLoaded(null, playlist(120));
    vod._playbackService.setCurrentTime(500);
    vod._playbackService.setCurrentTime.mockClear();

    vod._onLevelLoaded(null, playlist(120));

    expect(vod._playbackService.setCurrentTime).not.toHaveBeenCalled();
  });

  it("a playlist with no duration validates nothing", () => {
    const vod = attachedAt(500);

    vod._onLevelLoaded(null, playlist(0));

    expect(vod._playbackService.setCurrentTime).not.toHaveBeenCalled();
  });

  it("a detached engine has no position to validate", () => {
    const vod = createVod(VOD_STATE.SYNC); // the warm-up load
    vod._metadataReady = false;
    vod._config = {};
    vod._progressSvc = { updateVodPlaylistDuration: vi.fn() };
    vod._playbackService = {
      getCurrentTime: () => 500,
      setCurrentTime: vi.fn(),
    };

    vod._onLevelLoaded(null, playlist(120));

    expect(vod._playbackService.setCurrentTime).not.toHaveBeenCalled();
    expect(vod._metadataReady).toBe(true);
  });
});
