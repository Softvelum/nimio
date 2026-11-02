import { describe, it, expect, vi, afterEach } from "vitest";
import { NimioVod } from "@/nimio-vod";
import { EventBus } from "@/event-bus";
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
    vod._ui = { setDetached: vi.fn() };
    vod._pHandler = {
      stopLoad: vi.fn(),
      detachMedia: vi.fn(() => vod._onMediaDetached()),
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
    vod._config = { url };
    vod._pHandler = { loadSource: vi.fn(), stopLoad: vi.fn() };
    vod._progressSvc = { updateVodPlaylistDuration: vi.fn() };
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

  it("with the same URL does nothing and stays stopped", async () => {
    const vod = stoppedEngine("https://example.test/old.m3u8");

    await vod.initialize();

    expect(vod._pHandler.loadSource).not.toHaveBeenCalled();
    expect(vod._state).toBe(4);
    expect(vod.isRunning()).toBe(false);
  });
});
