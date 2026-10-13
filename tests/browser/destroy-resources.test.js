import { describe, it, expect, afterEach } from "vitest";
import Nimio from "@/nimio";
import { AudioContextProvider } from "@/audio/context-provider";
import { AudioController } from "@/audio/controller";
import { EventBus } from "@/event-bus";
import controlsCss from "@/ui/controls.css?raw";

// Reproduces https://github.com/Softvelum/nimio/issues/93:
// destroy() doesn't release per-instance resources.
//
// Services have constructor = null, which breaks vitest's diff formatter,
// so service identity is compared with === instead of toBe().

let instCounter = 0;
const players = [];
const containers = [];

function uniqueName() {
  return `destroy-res-${++instCounter}`;
}

function createPlayer(instanceName, opts = {}) {
  const container = document.createElement("div");
  container.style.cssText = "width:640px;height:360px";
  document.body.appendChild(container);
  containers.push(container);

  const player = new Nimio({
    instanceName,
    container,
    streamUrl: "wss://127.0.0.1:1/live/stream",
    ...opts,
  });
  players.push(player);
  return player;
}

// Registry key of the player's per-instance services.
function keyOf(player) {
  return player._instName;
}

function controlsStyleCount() {
  return [...document.head.querySelectorAll("style")].filter(
    (s) => s.textContent === controlsCss,
  ).length;
}

// What play() eventually does for the audio path.
function startAudio(player, sampleRate = 48000) {
  return AudioController.getInstance(keyOf(player)).initContext(sampleRate, 2);
}

function waitStateChange() {
  return new Promise((r) => setTimeout(r, 50));
}

function listenerSnapshot(bus) {
  const out = {};
  for (const ev of bus.eventNames()) out[String(ev)] = bus.listenerCount(ev);
  return out;
}

describe("Nimio.destroy() releases per-instance resources (#93)", () => {
  afterEach(() => {
    for (const p of players.splice(0)) {
      try {
        p.destroy();
      } catch {
        // already destroyed
      }
    }
    for (const c of containers.splice(0)) c.remove();
    delete window.Hls;
  });

  describe("AudioContext", () => {
    it("is closed by destroy()", async () => {
      const player = createPlayer(uniqueName());
      const ctx = startAudio(player);
      expect(ctx).toBeInstanceOf(AudioContext);

      player.destroy();
      await waitStateChange();

      expect(ctx.state).toBe("closed");
    });

    it("is not created by destroy() when audio never started", () => {
      const player = createPlayer(uniqueName());
      const provider = AudioContextProvider.getInstance(keyOf(player));

      player.destroy();

      expect(provider.get()).toBeUndefined();
    });

    it("previous one is closed when the sample rate changes", async () => {
      const player = createPlayer(uniqueName());
      const first = startAudio(player, 48000);

      const second = startAudio(player, 44100);
      await waitStateChange();

      expect(second).not.toBe(first);
      expect(second.state).not.toBe("closed");
      expect(first.state).toBe("closed");
    });

    it("is recreated when the cached one was closed externally", async () => {
      const player = createPlayer(uniqueName());
      const first = startAudio(player);
      await first.close();

      const second = startAudio(player);

      expect(second).not.toBe(first);
      expect(second.state).not.toBe("closed");
    });

    it("is usable by a player recreated with the same instanceName", async () => {
      const name = uniqueName();
      const first = createPlayer(name);
      const oldCtx = startAudio(first);
      first.destroy();
      // Integrator workaround from the issue: close the context manually.
      if (oldCtx.state !== "closed") await oldCtx.close();

      const second = createPlayer(name);
      const ctx = startAudio(second);

      expect(ctx).not.toBe(oldCtx);
      expect(ctx.state).not.toBe("closed");
    });
  });

  describe("controls <style>", () => {
    it("is injected once per document regardless of player count", () => {
      createPlayer(uniqueName());
      createPlayer(uniqueName());
      expect(controlsStyleCount()).toBe(1);

      for (const p of players.splice(0)) p.destroy();
      createPlayer(uniqueName()).destroy();
      createPlayer(uniqueName());

      expect(controlsStyleCount()).toBe(1);
    });
  });

  describe("per-instance services", () => {
    it("are released by destroy()", () => {
      const player = createPlayer(uniqueName());
      const key = keyOf(player);
      const provider = AudioContextProvider.getInstance(key);
      const bus = EventBus.getInstance(key);

      player.destroy();

      expect(AudioContextProvider.getInstance(key) === provider).toBe(false);
      expect(EventBus.getInstance(key) === bus).toBe(false);
    });

    it("are not shared with the next player with the same instanceName", () => {
      const name = uniqueName();
      const first = createPlayer(name);
      const oldProvider = AudioContextProvider.getInstance(keyOf(first));
      const oldBus = EventBus.getInstance(keyOf(first));
      first.destroy();

      const second = createPlayer(name);

      expect(
        AudioContextProvider.getInstance(keyOf(second)) === oldProvider,
      ).toBe(false);
      expect(EventBus.getInstance(keyOf(second)) === oldBus).toBe(false);
    });

    it("recreated by a late call after destroy() don't leak into the next player", () => {
      const name = uniqueName();
      const first = createPlayer(name);
      const oldKey = keyOf(first);
      first.destroy();
      // A stale async callback of the destroyed player asks for a service.
      const zombie = EventBus.getInstance(oldKey);

      const second = createPlayer(name);

      expect(EventBus.getInstance(keyOf(second)) === zombie).toBe(false);
    });
  });

  describe("EventBus subscriptions", () => {
    it("are all removed by the player itself before the bus is released", () => {
      const player = createPlayer(uniqueName());
      const bus = EventBus.getInstance(keyOf(player));
      let leftAtRelease;
      const removeAll = bus.removeAllListeners;
      bus.removeAllListeners = function (...args) {
        leftAtRelease ??= listenerSnapshot(this);
        return removeAll.apply(this, args);
      };

      player.destroy();
      leftAtRelease ??= listenerSnapshot(bus);

      expect(leftAtRelease).toEqual({});
    });

    it("of a destroyed player don't receive events of the next one", () => {
      const name = uniqueName();
      const first = createPlayer(name);
      const oldBus = EventBus.getInstance(keyOf(first));
      first.destroy();

      const second = createPlayer(name);
      EventBus.getInstance(keyOf(second));

      expect(oldBus.eventNames()).toEqual([]);
    });
  });

  describe("VOD", () => {
    it("is not initialized when destroyed before hls.js is loaded", async () => {
      let hlsCreated = 0;
      window.Hls = class {
        constructor() {
          hlsCreated++;
          return new Proxy(this, { get: (t, k) => (k in t ? t[k] : () => {}) });
        }
      };
      window.Hls.Events = new Proxy({}, { get: (t, k) => String(k) });

      const player = createPlayer(uniqueName(), { vod: { hlsjs: "local" } });
      player.destroy();
      await waitStateChange();

      expect(hlsCreated).toBe(0);
    });
  });
});
