import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fakes = vi.hoisted(() => ({
  uis: [],
  lives: [],
  vods: [],
  order: [],
  vodLoaded: false,
  vodInit: undefined,
  liveThrows: false,
}));

vi.mock("@/ui/ui", () => ({
  UI: class {
    constructor(instName) {
      this.instName = instName;
      this.mediaElement = {};
      this.destroy = vi.fn(() => fakes.order.push("ui"));
      fakes.uis.push(this);
    }
  },
}));

vi.mock("@/nimio-live", () => ({
  NimioLive: class {
    constructor(instName) {
      if (fakes.liveThrows) throw new Error("SecurityError: worker blocked");
      this.instName = instName;
      this.destroy = vi.fn(() => fakes.order.push("live"));
      this.play = vi.fn();
      this.setParameters = vi.fn();
      fakes.lives.push(this);
    }
  },
}));

vi.mock("@/nimio-vod", () => ({
  NimioVod: class {
    constructor(instName) {
      this.instName = instName;
      this.destroy = vi.fn(() => fakes.order.push("vod"));
      this.isRunning = () => false;
      this.isPlaying = () => false;
      this.isLoaded = () => fakes.vodLoaded;
      this.initialize = vi.fn(() => fakes.vodInit);
      fakes.vods.push(this);
    }
  },
}));

import Nimio from "@/nimio";
import { EventBus } from "@/event-bus";
import { VUMeterService } from "@/vumeter/service";
import { AudioVolumeController } from "@/audio/volume-controller";

const players = [];
const containers = [];

function createPlayer(extra = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const options = {
    streamUrl: "wss://example.com/live/stream",
    container,
    logLevel: "warn",
    ...extra,
  };
  const player = new Nimio(options);
  players.push(player);
  return { player, options };
}

describe("Nimio instance lifecycle", () => {
  beforeEach(() => {
    fakes.uis.length = 0;
    fakes.lives.length = 0;
    fakes.vods.length = 0;
    fakes.order.length = 0;
  });

  afterEach(() => {
    for (const p of players) {
      try {
        p.destroy();
      } catch {
        // a test may have made a step throw on purpose
      }
    }
    players.length = 0;
    for (const c of containers) c.remove();
    containers.length = 0;
  });

  it("destroy releases the services registered under the instance key", () => {
    const { player } = createPlayer({ instanceName: "fac-release" });
    const key = player._instName;
    const bus = EventBus.getInstance(key);

    player.destroy();

    expect(EventBus.getInstance(key)).not.toBe(bus); // a fresh one: released
    expect(fakes.uis[0].destroy).toHaveBeenCalledTimes(1);
    expect(fakes.lives[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("destroy drops all listeners, including application ones", () => {
    const { player } = createPlayer({ instanceName: "fac-listeners" });
    const bus = EventBus.getInstance(player._instName);
    player.on("nimio:play", () => {});
    expect(bus.listenerCount("nimio:play")).toBe(1);
    expect(bus.listenerCount("aux:playback-error")).toBe(1);

    player.destroy();

    expect(bus.listenerCount("nimio:play")).toBe(0);
    expect(bus.listenerCount("aux:playback-error")).toBe(0);
    expect(bus.listenerCount("ui:volume-change")).toBe(0);
  });

  it("destroy is idempotent", () => {
    const { player } = createPlayer({ instanceName: "fac-twice" });

    player.destroy();
    player.destroy();

    expect(fakes.lives[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys the VOD engine before the live engine, after the UI", () => {
    const { player } = createPlayer({ instanceName: "fac-vod", vod: true });

    player.destroy();

    expect(fakes.order).toEqual(["ui", "vod", "live"]);
  });

  it("destroy clears the facade's references", () => {
    const { player } = createPlayer({ instanceName: "fac-refs" });

    player.destroy();

    for (const field of [
      "_ui",
      "_livePlayer",
      "_actPlayer",
      "_eventBus",
      "_context",
      "_vuMeterSvc",
      "_playProgressSvc",
      "_playProgressProxy",
      "_thumbnailSvc",
      "_audioVolumeCtrl",
    ]) {
      expect(player[field], field).toBeUndefined();
    }
  });

  it("a VOD initialization that settles after destroy does not touch released services", async () => {
    let settle;
    fakes.vodLoaded = true;
    fakes.vodInit = new Promise((resolve) => (settle = resolve));
    try {
      const { player } = createPlayer({
        instanceName: "fac-late-vod",
        vod: true,
      });
      const vod = fakes.vods[0];
      const context = player._context;
      const setState = vi.spyOn(context, "setState");

      expect(player.seekVod(0)).toBe(true);
      expect(vod.initialize).toHaveBeenCalledTimes(1);
      player.destroy();
      settle();
      await fakes.vodInit;
      await Promise.resolve();

      expect(setState).not.toHaveBeenCalled();
    } finally {
      fakes.vodLoaded = false;
      fakes.vodInit = undefined;
    }
  });

  it("a constructor failure before the UI exists leaves no services registered", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const name = "fac-throw";
    const busBefore = EventBus.getInstance(name); // what a leak would reuse

    expect(
      () =>
        new Nimio({
          streamUrl: "wss://example.com/live/stream",
          container: "#no-such-container",
          instanceName: name,
        }),
    ).toThrow();

    // the failed player took the key and released it on rollback, so the
    // bus it had reused is gone; no UI was ever created
    expect(EventBus.getInstance(name)).not.toBe(busBefore);
    expect(fakes.uis).toHaveLength(0);
    error.mockRestore();
  });

  it("destroy releases the key even if the live engine's destroy throws, and rethrows", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { player } = createPlayer({ instanceName: "fac-throwing-engine" });
    const key = player._instName;
    const bus = EventBus.getInstance(key);
    fakes.lives[0].destroy.mockImplementation(() => {
      fakes.order.push("live");
      throw new Error("engine boom");
    });

    expect(() => player.destroy()).toThrow("engine boom");

    expect(fakes.uis[0].destroy).toHaveBeenCalledTimes(1);
    expect(EventBus.getInstance(key)).not.toBe(bus);
    expect(player._livePlayer).toBeUndefined();
    expect(() => player.destroy()).not.toThrow(); // idempotent afterwards
    error.mockRestore();
  });

  it("destroy still tears down the engines when the UI cleanup throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { player } = createPlayer({ instanceName: "fac-ui-throws" });
    const key = player._instName;
    const bus = EventBus.getInstance(key);
    fakes.uis[0].destroy.mockImplementation(() => {
      throw new DOMException("container already removed", "NotFoundError");
    });

    expect(() => player.destroy()).toThrow("container already removed");

    expect(fakes.lives[0].destroy).toHaveBeenCalledTimes(1);
    expect(EventBus.getInstance(key)).not.toBe(bus);
    error.mockRestore();
  });

  it("a constructor failure after the UI was created destroys that UI and clears the VU meter", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const proto = Object.getPrototypeOf(
      VUMeterService.getInstance("fac-vu-probe"),
    );
    const clear = vi.spyOn(proto, "clear");
    fakes.liveThrows = true;
    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      containers.push(container);
      expect(
        () =>
          new Nimio({
            streamUrl: "wss://example.com/live/stream",
            container,
            instanceName: "fac-ctor-ui",
          }),
      ).toThrow("SecurityError");

      expect(fakes.uis).toHaveLength(1);
      expect(fakes.uis[0].destroy).toHaveBeenCalledTimes(1);
      // once from the rollback step, once more from the service release
      expect(clear).toHaveBeenCalled();
    } finally {
      clear.mockRestore();
      fakes.liveThrows = false;
      error.mockRestore();
    }
  });

  it("a throwing service release still clears the references and is reported", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { player } = createPlayer({ instanceName: "fac-service-throws" });
    const bus = EventBus.getInstance(player._instName);
    // the registry nulls each instance's constructor, which vi.spyOn trips
    // over, so override the method directly
    bus.destroy = () => {
      throw new Error("bus release boom");
    };

    expect(() => player.destroy()).toThrow("bus release boom");

    expect(player._eventBus).toBeUndefined();
    expect(player._livePlayer).toBeUndefined();
    expect(() => player.destroy()).not.toThrow();
    error.mockRestore();
  });

  it("play() and setParameters() from a teardown listener do not touch the engine", () => {
    const { player } = createPlayer({
      instanceName: "fac-restart-in-teardown",
    });
    const bus = EventBus.getInstance(player._instName);
    const live = fakes.lives[0];
    live.destroy.mockImplementation(() => {
      fakes.order.push("live");
      // the real engine emits this from its closing stop
      bus.emit("nimio:playback-end", { mode: "live" });
    });
    const volume = AudioVolumeController.getInstance(player._instName);
    volume.setVolume = vi.fn(); // the registry nulls constructors: no spyOn
    volume.mute = vi.fn();
    player.on("nimio:playback-end", () => {
      player.play();
      player.setParameters({ latency: 500 });
      player.setVolume(13); // would persist nimio_volume_* for later players
      player.mute();
    });

    player.destroy();

    expect(live.play).not.toHaveBeenCalled();
    expect(live.setParameters).not.toHaveBeenCalled();
    expect(volume.setVolume).not.toHaveBeenCalled();
    expect(volume.mute).not.toHaveBeenCalled();
  });

  it("a playback position change after destroy is ignored", () => {
    const { player } = createPlayer({ instanceName: "fac-pos-after-destroy" });
    player.destroy();

    expect(() => player._onPlaybackPositionChange("live", 0)).not.toThrow();
    expect(player._onPlaybackPositionChange("live", 0)).toBe(false);
  });

  it("event and volume methods are safe no-ops after destroy", () => {
    const { player } = createPlayer({ instanceName: "fac-after-destroy" });
    const fn = () => {};
    player.on("nimio:play", fn);
    player.destroy();

    expect(() => player.off("nimio:play", fn)).not.toThrow();
    expect(() => player.on("nimio:play", fn)).not.toThrow();
    expect(() => player.once("nimio:play", fn)).not.toThrow();
    expect(() => player.removeAllListeners()).not.toThrow();
    expect(player.listeners("nimio:play")).toEqual([]);
    expect(player.listenerCount("nimio:play")).toBe(0);
    expect(player.getVolume()).toBeUndefined();
    expect(() => player.mute()).not.toThrow();
    expect(() => player.unmute()).not.toThrow();
    expect(() => player.setVolume(50)).not.toThrow();
  });

  it("public methods are safe no-ops with neutral values after destroy", () => {
    fakes.vodLoaded = true;
    try {
      const { player } = createPlayer({
        instanceName: "fac-api-after-destroy",
        vod: true,
      });
      player.destroy();

      for (const call of [
        () => player.play(),
        () => player.stop(),
        () => player.pause(),
        () => player.setParameters({ latency: 1000 }),
        () => player.setStreamURL("wss://example.com/live/other"),
        () => player.startAbr(),
        () => player.stopAbr(),
        () => player.setCaptionTrack("CC1"),
      ]) {
        expect(call).not.toThrow();
      }
      expect(player.seekLive(0)).toBe(false);
      expect(player.seekVod(0)).toBe(false);
      expect(fakes.vods[0].initialize).not.toHaveBeenCalled();
      expect(player.isAbr()).toBe(false);
      expect(player.getRenditions("video")).toEqual([]);
      expect(player.getCurrentRendition("video")).toBeNull();
      expect(player.setVideoRendition(1)).toBe(false);
      expect(player.setAudioRendition(1)).toBe(false);
      expect(player.getCaptionTracks()).toEqual({});
      expect(player.getCurrentCaptionTrack()).toEqual({});
      expect(player.getCurrentStreamBandwidth()).toBe(0);
      expect(player.getCurrentTimestamp()).toBe(0);
      expect(player.getStreamEncodedFramerate()).toBeUndefined();
      expect(player.getVodThumbnailUrl(0)).toBeUndefined();
      expect(player.getVodPlayerHandler()).toBeNull();
      expect(typeof player.version()).toBe("string");
    } finally {
      fakes.vodLoaded = false;
    }
  });
});
