import { describe, it, expect, afterEach } from "vitest";
import { PlaybackProgressProxy } from "@/playback/progress-proxy";
import { PlaybackProgressService } from "@/playback/progress-service";
import { EventBus } from "@/event-bus";
import { releaseInstances } from "@/shared/service";

// The progress events reach the application's listeners one after the
// other. A listener that changes the stream URL makes the service reset
// the duration, which emits a progress of its own from inside the first
// one: delivered right away, it would reach the later listeners before the
// rest of the superseded progress, and they would end up with the old
// archive's duration.
describe("PlaybackProgressProxy: a progress emitted from inside a progress", () => {
  const NAME = "progress-proxy-nested";

  afterEach(() => {
    releaseInstances(NAME);
  });

  function createProxy() {
    const bus = EventBus.getInstance(NAME);
    const svc = PlaybackProgressService.getInstance(NAME);
    const proxy = new PlaybackProgressProxy(bus, svc);
    return { bus, svc, proxy };
  }

  it("reaches every listener after the one it interrupted", () => {
    const { bus, svc } = createProxy();
    svc.updateVodPlaylistDuration(10);
    let reset = false;
    const first = [];
    const second = [];
    bus.on("nimio:vod-progress", ({ position, duration }) => {
      first.push([position, duration]);
      if (!reset) {
        reset = true;
        svc.resetVodDuration(); // what a listener's setStreamURL() does
      }
    });
    bus.on("nimio:vod-progress", ({ position, duration }) => {
      second.push([position, duration]);
    });

    svc.updateVodProgress(4, NaN); // the engine's playback progress

    expect(first).toEqual([
      [4, 10],
      [0, 0],
    ]);
    expect(second).toEqual([
      [4, 10],
      [0, 0],
    ]);
  });

  it("several nested progresses are delivered in the order they were produced", () => {
    const { bus, svc } = createProxy();
    svc.updateVodPlaylistDuration(10);
    let nested = 0;
    const seen = [];
    bus.on("nimio:vod-progress", () => {
      if (nested++ === 0) {
        svc.resetVodDuration();
        svc.updateVodPlaylistDuration(20); // the new archive's playlist
      }
    });
    bus.on("nimio:vod-progress", ({ position, duration }) => {
      seen.push([position, duration]);
    });

    svc.updateVodProgress(4, NaN); // the engine's playback progress

    expect(seen).toEqual([
      [4, 10],
      [0, 0],
      [0, 20],
    ]);
  });

  it("a throwing listener does not leave the later reports undelivered", () => {
    const { bus, svc } = createProxy();
    svc.updateVodPlaylistDuration(10);
    let throwOnce = true;
    const seen = [];
    bus.on("nimio:vod-progress", () => {
      if (throwOnce) {
        throwOnce = false;
        throw new Error("application listener");
      }
    });
    bus.on("nimio:vod-progress", ({ position }) => seen.push(position));

    expect(() => svc.updateVodProgress(4, NaN)).toThrow("application listener");
    svc.updateVodProgress(5, NaN);

    expect(seen).toEqual([5]);
  });

  it("a progress queued before a listener threw is delivered before the exception", () => {
    // the URL change a listener makes resets the duration also when a
    // listener of the engines' events threw: the exception reaches the
    // first listener, the later ones would keep the old duration otherwise
    const { bus, svc } = createProxy();
    svc.updateVodPlaylistDuration(10);
    let throwOnce = true;
    const seen = [];
    bus.on("nimio:vod-progress", () => {
      if (throwOnce) {
        throwOnce = false;
        svc.resetVodDuration(); // what a listener's setStreamURL() does ...
        throw new Error("application end listener"); // ... before it rethrows
      }
    });
    bus.on("nimio:vod-progress", ({ position, duration }) => {
      seen.push([position, duration]);
    });

    expect(() => svc.updateVodProgress(4, NaN)).toThrow(
      "application end listener",
    );

    expect(seen).toEqual([[0, 0]]);
  });

  it("the first exception is the one rethrown", () => {
    const { bus, svc } = createProxy();
    svc.updateVodPlaylistDuration(10);
    let n = 0;
    bus.on("nimio:vod-progress", () => {
      n++;
      if (n === 1) svc.resetVodDuration();
      throw new Error("listener " + n);
    });

    expect(() => svc.updateVodProgress(4, NaN)).toThrow("listener 1");
    expect(n).toBe(2);
  });

  it("a thrown undefined is an exception too: delivered, then rethrown as is", () => {
    // "nothing thrown" and "undefined thrown" must stay apart, or the
    // report returns normally and a later listener's error takes its place
    const { bus, svc } = createProxy();
    svc.updateVodPlaylistDuration(10);
    let n = 0;
    bus.on("nimio:vod-progress", () => {
      n++;
      if (n === 1) {
        svc.resetVodDuration();
        throw undefined;
      }
      throw new Error("listener " + n);
    });

    let caught = "nothing";
    try {
      svc.updateVodProgress(4, NaN);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeUndefined();
    expect(n).toBe(2);
  });
});
