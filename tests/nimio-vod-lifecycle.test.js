import { describe, it, expect, vi, afterEach } from "vitest";
import { NimioVod } from "@/nimio-vod";
import { EventBus } from "@/event-bus";
import { releaseInstances } from "@/shared/service";

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
