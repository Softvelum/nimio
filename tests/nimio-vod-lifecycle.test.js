import { describe, it, expect, vi, afterEach } from "vitest";
import { NimioVod } from "@/nimio-vod";
import { EventBus } from "@/event-bus";
import { PlaybackContext } from "@/playback/context";
import { releaseInstances } from "@/shared/service";
import { MODE } from "@/shared/values";

let hlsCreated;

class FakeHls {
  constructor() {
    hlsCreated++;
    this.on = vi.fn();
    this.off = vi.fn();
    this.destroy = vi.fn();
  }
}
FakeHls.Events = {};
FakeHls.ErrorTypes = {
  NETWORK_ERROR: "networkError",
  MEDIA_ERROR: "mediaError",
};

async function microtasks(n = 4) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

describe("NimioVod destroyed before hls.js has loaded", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.Hls;
    for (const s of document.head.querySelectorAll("script")) s.remove();
  });

  it("local source: does not create Hls after destroy", async () => {
    globalThis.Hls = FakeHls;
    hlsCreated = 0;
    const name = "vod-early-local";
    const vod = new NimioVod(name, { hlsjs: { source: undefined } });

    vod.destroy();
    releaseInstances(name);
    await microtasks();

    expect(hlsCreated).toBe(0);
    expect(vod.isLoaded()).toBe(false);
  });

  it("pending remote script: removes the tag and detaches its handlers", async () => {
    globalThis.Hls = FakeHls;
    hlsCreated = 0;
    const name = "vod-early-pending";
    const vod = new NimioVod(name, {
      hlsjs: { source: "http://localhost/fake-hls.js" },
    });
    const script = document.head.querySelector("script[src$='fake-hls.js']");
    expect(script).not.toBeNull();
    const busBefore = EventBus.getInstance(name);

    vod.destroy();
    releaseInstances(name);

    expect(script.isConnected).toBe(false);
    expect(script.onload).toBeNull();
    expect(script.onerror).toBeNull();
    await microtasks();
    expect(hlsCreated).toBe(0);
    // nothing re-registered the name after release
    expect(EventBus.getInstance(name)).not.toBe(busBefore);
  });

  it("failed remote script: the tag is removed on destroy", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const name = "vod-early-failed";
    const vod = new NimioVod(name, {
      hlsjs: { source: "http://localhost/missing-hls.js" },
    });
    const script = document.head.querySelector("script[src$='missing-hls.js']");
    script.onerror();
    await microtasks();

    vod.destroy();

    expect(script.isConnected).toBe(false);
    error.mockRestore();
  });
});

describe("NimioVod.stop() with a destroying playback-end listener", () => {
  const NAME = "vod-stop-destroy";

  afterEach(() => {
    releaseInstances(NAME);
    delete globalThis.Hls;
  });

  // The facade's stop() in VOD mode runs this stop; an application that
  // removes the player from nimio:playback-end destroys the engine from
  // inside it, and the stop's continuation must not touch the released
  // hls.js handler.
  it("ends quietly after destroy() ran from the listener", () => {
    const vod = new NimioVod(NAME, undefined);
    const bus = EventBus.getInstance(NAME);
    vod._eventBus = bus;
    vod._logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    vod._state = 3; // PLAY, attached
    vod._config = {};
    vod._ui = {
      setDetached: vi.fn(),
      mediaElement: { removeEventListener: vi.fn() },
    };
    globalThis.Hls = FakeHls; // loaded: the engine got past INIT
    vod._pHandler = {
      stopLoad: vi.fn(),
      detachMedia: vi.fn(() => vod._onMediaDetached()),
      off: vi.fn(),
      destroy: vi.fn(),
    };
    vod._context = { setState: vi.fn() };
    vod._playbackService = { resetPosition: vi.fn(), clear: vi.fn(), state: 0 };
    vod._audioCtrl = { reset: vi.fn() };
    vod._vuMeterSvc = { stop: vi.fn() };
    bus.on("nimio:playback-end", () => vod.destroy());
    const callback = vi.fn();

    expect(() => vod.stop(callback)).not.toThrow();

    expect(vod._destroyed).toBe(true);
    expect(vod._pHandler).toBeUndefined();
    expect(callback).not.toHaveBeenCalled(); // nothing left to hand over
  });
});

describe("NimioVod.play() after an attach", () => {
  const NAME = "vod-play-buffering";

  afterEach(() => {
    releaseInstances(NAME);
  });

  // attach() pauses hls.js buffering and only the autoplay branch of
  // _onLevelLoaded resumed it: a VOD attached paused (a seek on a stopped
  // or paused player) could not be started by play()
  it("resumes buffering before playing", () => {
    const vod = new NimioVod(NAME, undefined);
    vod._state = 3; // PLAY, attached
    vod._ui = {};
    vod._pHandler = { resumeBuffering: vi.fn() };
    vod._playbackService = { handlePlay: vi.fn() };
    vod._eventBus = { emit: vi.fn() };

    vod.play();

    expect(vod._pHandler.resumeBuffering).toHaveBeenCalledTimes(1);
    expect(vod._playbackService.handlePlay).toHaveBeenCalledTimes(1);
    expect(
      vod._pHandler.resumeBuffering.mock.invocationCallOrder[0],
    ).toBeLessThan(vod._playbackService.handlePlay.mock.invocationCallOrder[0]);
    expect(vod._eventBus.emit).toHaveBeenCalledWith("nimio:play", {
      mode: MODE.VOD,
    });
  });
});

describe("NimioVod.initialize() from the stopped state", () => {
  const NAME = "vod-init-from-stop";

  afterEach(() => {
    releaseInstances(NAME);
  });

  function stoppedEngine(url) {
    const vod = new NimioVod(NAME, undefined);
    vod._loadSourcePromise = Promise.resolve();
    vod._state = 4; // STOP
    vod._url = "https://example.test/old.m3u8";
    vod._metadataReady = true; // the old archive had played
    vod._config = { url };
    vod._pHandler = { loadSource: vi.fn(), stopLoad: vi.fn() };
    vod._progressSvc = {
      resetVodDuration: vi.fn(),
      updateVodPlaylistDuration: vi.fn(),
    };
    return vod;
  }

  // a URL change re-initialises a stopped engine in the background; it
  // stays stopped (not "running"), so a seek goes through the facade's
  // start path and not through the progress proxy with the old archive's
  // duration, and a stop() cancels or stops the reload
  it("with a new URL reloads the source and stays stopped", async () => {
    const vod = stoppedEngine("https://example.test/new.m3u8");

    await vod.initialize();

    expect(vod._pHandler.loadSource).toHaveBeenCalledWith(
      "https://example.test/new.m3u8",
    );
    expect(vod._state).toBe(4); // STOP
    expect(vod.isRunning()).toBe(false);
    // the old archive's duration must not clamp seeks into the new one
    expect(vod._progressSvc.resetVodDuration).toHaveBeenCalledTimes(1);
  });

  it("a stop() before the queued reload runs cancels it", async () => {
    const vod = stoppedEngine("https://example.test/new.m3u8");

    const pending = vod.initialize();
    vod.stop(); // the facade's stop() right after a seek
    await pending;

    expect(vod._pHandler.loadSource).not.toHaveBeenCalled();
    expect(vod._url).toBe("https://example.test/old.m3u8"); // next initialize reloads
    expect(vod._state).toBe(4);
  });

  it("a stop() during an unfinished reload forgets the URL, so the next initialize reloads", async () => {
    // the reload was aborted before the new master playlist arrived: the
    // engine knows nothing about the new archive, and a later initialize()
    // (the next nimio:connection-established) must not treat it as done
    const vod = stoppedEngine("https://example.test/new.m3u8");
    await vod.initialize();

    vod.stop();
    expect(vod._url).toBeUndefined();

    await vod.initialize();
    expect(vod._pHandler.loadSource).toHaveBeenCalledTimes(2);
  });

  it("a stop() that forgets the URL drops the session parameter too", async () => {
    // the parameter belongs to the archive the URL named; the next load
    // must not carry it to a URL the engine no longer knows
    const vod = stoppedEngine("https://example.test/new.m3u8");
    await vod.initialize();
    vod._sessionParam = "sid=old";

    vod.stop();

    expect(vod._url).toBeUndefined();
    expect(vod._sessionParam).toBeUndefined();
  });

  it("destroy() after a stop() that forgot the URL still releases the handlers", async () => {
    // the teardown used to be keyed on the URL; a stop during an
    // unfinished reload clears it, and the hls.js listeners and the UI
    // handlers added at initialisation must still be removed
    const vod = stoppedEngine("https://example.test/new.m3u8");
    await vod.initialize();
    vod.stop();
    expect(vod._url).toBeUndefined();
    vod._pHandler.off = vi.fn();
    vod._pHandler.detachMedia = vi.fn();
    vod._pHandler.destroy = vi.fn();
    vod._removeUIEventHandlers = vi.fn();
    vod._detachUI = vi.fn();
    vod._vuMeterSvc = { stop: vi.fn() };
    vod._playbackService = { clear: vi.fn() };
    globalThis.Hls = FakeHls; // loaded: the engine got past INIT
    try {
      vod.destroy();
    } finally {
      delete globalThis.Hls;
    }

    expect(vod._removeUIEventHandlers).toHaveBeenCalledTimes(1);
    expect(vod._detachUI).toHaveBeenCalledTimes(1);
    expect(vod._pHandler).toBeUndefined();
  });

  it("the variant playlist completes the reload: a later stop() keeps the URL", async () => {
    const vod = stoppedEngine("https://example.test/new.m3u8");
    await vod.initialize();
    vod._onLevelLoaded(null, { details: { totalduration: 5, fragments: [] } });

    vod.stop();

    expect(vod._url).toBe("https://example.test/new.m3u8");
  });

  it("a stop() after the master playlist but before the variant forgets the URL", async () => {
    // the levels are known but the duration is not: the archive is not
    // usable yet, so the next initialize() must load again
    const vod = stoppedEngine("https://example.test/new.m3u8");
    vod._context = PlaybackContext.getInstance(NAME);
    vod._config.adaptiveBitrate = {};
    vod._updateUiLayout = vi.fn();
    await vod.initialize();
    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://example.test/new/360p.m3u8?s=2"], height: 360 },
      ],
    });
    // the master was taken: its variant is requested
    expect(vod._context.levelsSourceUrl).toBe("https://example.test/new.m3u8");
    expect(vod._pHandler.loadSource).toHaveBeenLastCalledWith(
      "https://example.test/new/360p.m3u8?s=2",
    );

    vod.stop();

    expect(vod._url).toBeUndefined();
    expect(vod._sessionParam).toBeUndefined();
  });

  it("playlists that still arrive after a stop() during the reload are ignored", async () => {
    // the stop forgot the URL; a master playlist response in flight would
    // be recorded under no source (new URL(undefined) throws, after the
    // context's levels were cleared), and its variant would mark the
    // forgotten source usable
    const vod = stoppedEngine("https://example.test/new.m3u8");
    vod._context = PlaybackContext.getInstance(NAME);
    vod._context.setLevels(
      [{ url: ["https://example.test/old/360p.m3u8?s=1"], height: 360 }],
      "https://example.test/old.m3u8",
    );
    vod._context.setCurrentLevelIdx(0);
    await vod.initialize();
    vod.stop();

    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://example.test/new/360p.m3u8?s=2"], height: 360 },
      ],
    });
    vod._onLevelLoaded(null, { details: { totalduration: 50, fragments: [] } });

    expect(vod._context.levelsSourceUrl).toBe("https://example.test/old.m3u8");
    expect(vod._context.getCurrentLevel().data.url[0]).toContain("/old/");
    expect(vod._metadataReady).toBe(false);
    expect(vod._progressSvc.updateVodPlaylistDuration).not.toHaveBeenCalled();
    expect(vod._url).toBeUndefined();
  });

  it("a playlist of a load made before a stop() is ignored although the URL is kept", async () => {
    // the archive had loaded, so the stop keeps its URL; a stop() made from
    // inside a callback of a playlist response does not stop the rest of
    // that response, and hls.js re-enables loading after a manifest: the
    // stopped engine must not take the playlist or go on loading
    const vod = stoppedEngine("https://example.test/old.m3u8");
    vod._state = 2; // SYNC: warm, reloading its variant
    vod._config.adaptiveBitrate = {};

    vod.stop();
    expect(vod._url).toBe("https://example.test/old.m3u8");
    vod._pHandler.stopLoad.mockClear();
    vod._onLevelLoaded(null, { details: { totalduration: 50, fragments: [] } });

    expect(vod._progressSvc.updateVodPlaylistDuration).not.toHaveBeenCalled();
    expect(vod._pHandler.stopLoad).toHaveBeenCalledTimes(1);
  });

  it("a fatal network error on a loaded source keeps it: the next initialize loads nothing", async () => {
    // the archive is usable; one failed reload must not make every live
    // connection load it from scratch
    const vod = stoppedEngine("https://example.test/old.m3u8");
    vod._eventBus = { emit: vi.fn() };
    globalThis.Hls = FakeHls;
    try {
      vod._onError(null, {
        fatal: true,
        type: FakeHls.ErrorTypes.NETWORK_ERROR,
      });
    } finally {
      delete globalThis.Hls;
    }

    expect(vod._url).toBe("https://example.test/old.m3u8");
    await vod.initialize();
    expect(vod._pHandler.loadSource).not.toHaveBeenCalled();
  });

  it("forgetSource() makes a loaded source unknown: the next initialize loads the configured URL, although it is the same", async () => {
    // the facade calls it when the configured URL changes; the URL may
    // change back before any reload, and the durations are gone by then
    const vod = stoppedEngine("https://example.test/old.m3u8");
    vod._sessionParam = "s=1";

    vod.forgetSource();

    expect(vod._metadataReady).toBe(false);
    await vod.initialize();
    expect(vod._pHandler.loadSource.mock.calls).toEqual([
      ["https://example.test/old.m3u8"],
    ]);
  });

  it("forgetSource() ends what was loading: a playlist of the forgotten source is not taken under the configured URL", () => {
    // a warm engine reloading its variant when the URL changes: without
    // this, the response would find no URL and take the configured one
    const vod = stoppedEngine("https://example.test/new.m3u8");
    vod._state = 2; // SYNC
    vod._config.adaptiveBitrate = {};

    vod.forgetSource();
    expect(vod._pHandler.stopLoad).toHaveBeenCalledTimes(1);
    vod._onLevelLoaded(null, { details: { totalduration: 50, fragments: [] } });

    expect(vod._url).toBeUndefined();
    expect(vod._metadataReady).toBe(false);
    expect(vod._progressSvc.updateVodPlaylistDuration).not.toHaveBeenCalled();
  });

  it("forgetSource() on an engine still setting up hls.js does not void its first initialize", () => {
    const vod = new NimioVod(NAME, undefined);
    vod._state = 1; // INIT
    const gen = vod._initGen;

    vod.forgetSource();

    expect(vod._initGen).toBe(gen);
  });

  it("a second interrupted reload is retried like the first", async () => {
    const vod = stoppedEngine("https://example.test/new.m3u8");
    await vod.initialize();
    vod.stop(); // first interruption forgets the URL
    await vod.initialize(); // loads again
    vod.stop(); // second interruption

    expect(vod._url).toBeUndefined();
    await vod.initialize();
    expect(vod._pHandler.loadSource).toHaveBeenCalledTimes(3);
  });

  it("the reload after an interrupted load completes: the second master of the same source requests the variant and re-reads the session", async () => {
    // the first master set the levels for the new URL; the stop forgot the
    // URL, the next initialize() requests the master again, and that
    // manifest must not be taken for a level update of a loaded source
    const vod = stoppedEngine("https://example.test/new.m3u8");
    vod._config.adaptiveBitrate = {};
    vod._updateUiLayout = vi.fn();
    await vod.initialize();
    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://example.test/new/360p.m3u8?s=9"], height: 360 },
      ],
    });
    expect(vod._pHandler.loadSource).toHaveBeenLastCalledWith(
      "https://example.test/new/360p.m3u8?s=9",
    );

    vod.stop(); // between the master and the variant: interrupted
    expect(vod._url).toBeUndefined();
    await vod.initialize();
    expect(vod._pHandler.loadSource).toHaveBeenLastCalledWith(
      "https://example.test/new.m3u8",
    );
    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://example.test/new/360p.m3u8?s=11"], height: 360 },
      ],
    });

    expect(vod._sessionParam).toBe("s=11");
    expect(vod._pHandler.loadSource).toHaveBeenLastCalledWith(
      "https://example.test/new/360p.m3u8?s=11",
    );
    vod._onLevelLoaded(null, { details: { totalduration: 5, fragments: [] } });
    // the variant's own manifest (details present) is a level update: no
    // further request, the levels are not replaced again
    const requests = vod._pHandler.loadSource.mock.calls.length;
    const setLevels = vi.spyOn(vod._context, "setLevels");
    vod._onManifestParsed(null, {
      levels: [
        {
          url: ["https://example.test/new/360p.m3u8?s=11"],
          height: 360,
          details: { totalduration: 5 },
        },
      ],
    });
    expect(vod._pHandler.loadSource).toHaveBeenCalledTimes(requests);
    expect(setLevels).not.toHaveBeenCalled();
    vod.stop();
    expect(vod._url).toBe("https://example.test/new.m3u8"); // loaded: kept
  });

  it("a stop() from the duration-reset listener ends the reload before it loads", async () => {
    // resetVodDuration() notifies nimio:vod-progress synchronously; an
    // application may stop the player from there
    const vod = stoppedEngine("https://example.test/new.m3u8");
    vod._progressSvc.resetVodDuration = vi.fn(() => vod.stop());

    await vod.initialize();

    expect(vod._pHandler.loadSource).not.toHaveBeenCalled();
    expect(vod._url).toBeUndefined();
  });

  it("a destroy() from the duration-reset listener ends the reload quietly", async () => {
    const vod = stoppedEngine("https://example.test/new.m3u8");
    vod._logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const handler = vod._pHandler;
    handler.off = vi.fn();
    handler.detachMedia = vi.fn();
    handler.destroy = vi.fn();
    vod._removeUIEventHandlers = vi.fn();
    vod._detachUI = vi.fn();
    vod._vuMeterSvc = { stop: vi.fn() };
    vod._playbackService = { clear: vi.fn() };
    vod._progressSvc.resetVodDuration = vi.fn(() => vod.destroy());
    globalThis.Hls = FakeHls; // loaded: the engine got past INIT
    try {
      await expect(vod.initialize()).resolves.toBeUndefined();
    } finally {
      delete globalThis.Hls;
    }

    // really destroyed, and the reload did not go on into the released
    // engine (it would throw there, and the error would be logged)
    expect(handler.destroy).toHaveBeenCalledTimes(1);
    expect(handler.loadSource).not.toHaveBeenCalled();
    expect(vod._logger.error).not.toHaveBeenCalled();
  });

  it("a stop() while hls.js is still initialising does not void the first initialize", () => {
    const vod = new NimioVod(NAME, undefined);
    vod._state = 1; // INIT: the warm-up initialize() may be queued
    const gen = vod._initGen;

    vod.stop();

    expect(vod._initGen).toBe(gen);
  });

  it("a stop() on a stopped engine voids a queued reload", () => {
    const vod = stoppedEngine("https://example.test/new.m3u8");
    const gen = vod._initGen;

    vod.stop();

    expect(vod._initGen).toBe(gen + 1);
  });

  it("a stop() after the reload stops the loading", async () => {
    const vod = stoppedEngine("https://example.test/new.m3u8");
    await vod.initialize();

    vod.stop();

    expect(vod._pHandler.stopLoad).toHaveBeenCalledTimes(1);
  });

  it("with a new URL drops the old archive's session parameter from the request", async () => {
    const vod = stoppedEngine("https://example.test/new.m3u8");
    vod._sessionParam = "nimblesessionid=old";

    await vod.initialize();

    expect(vod._pHandler.loadSource).toHaveBeenCalledWith(
      "https://example.test/new.m3u8",
    );
    expect(vod._sessionParam).toBeUndefined();
  });

  it("a fatal network error before the variant loaded forgets the URL, so the next initialize retries", async () => {
    const vod = stoppedEngine("https://example.test/new.m3u8");
    vod._eventBus = { emit: vi.fn() };
    vod._logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    globalThis.Hls = FakeHls;
    await vod.initialize(); // the reload: the new master is requested

    vod._onError(null, { fatal: true, type: FakeHls.ErrorTypes.NETWORK_ERROR });

    expect(vod._url).toBeUndefined();
    expect(vod._eventBus.emit).toHaveBeenCalledWith("aux:playback-error", {
      mode: MODE.VOD,
      type: "NO_SRC",
    });
    vod._pHandler.loadSource.mockClear();
    await vod.initialize();
    expect(vod._pHandler.loadSource).toHaveBeenCalledWith(
      "https://example.test/new.m3u8",
    );
    delete globalThis.Hls;
  });

  it("with the same URL does nothing and stays stopped", async () => {
    const vod = stoppedEngine("https://example.test/old.m3u8");

    await vod.initialize();

    expect(vod._pHandler.loadSource).not.toHaveBeenCalled();
    expect(vod._state).toBe(4);
    expect(vod.isRunning()).toBe(false);
    expect(vod._progressSvc.resetVodDuration).not.toHaveBeenCalled();
  });
});
