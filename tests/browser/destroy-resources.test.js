import { describe, it, expect, afterEach } from "vitest";
import Nimio from "@/nimio";
import { AudioContextProvider } from "@/audio/context-provider";
import { AudioController } from "@/audio/controller";
import { EventBus } from "@/event-bus";
import controlsCss from "@/ui/controls.css?raw";

// Reproduces https://github.com/Softvelum/nimio/issues/93:
// destroy() doesn't release per-instance resources.

let instCounter = 0;
const players = [];
const containers = [];

function uniqueName() {
  return `destroy-res-${++instCounter}`;
}

function createPlayer(instanceName) {
  const container = document.createElement("div");
  container.style.cssText = "width:640px;height:360px";
  document.body.appendChild(container);
  containers.push(container);

  const player = new Nimio({
    instanceName,
    container,
    streamUrl: "wss://127.0.0.1:1/live/stream",
  });
  players.push(player);
  return player;
}

function controlsStyleCount() {
  return [...document.head.querySelectorAll("style")].filter(
    (s) => s.textContent === controlsCss,
  ).length;
}

// What play() eventually does for the audio path.
function startAudio(instanceName, sampleRate = 48000) {
  return AudioController.getInstance(instanceName).initContext(sampleRate, 2);
}

function waitStateChange() {
  return new Promise((r) => setTimeout(r, 50));
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
  });

  describe("AudioContext", () => {
    it("is closed by destroy()", async () => {
      const name = uniqueName();
      const player = createPlayer(name);
      const ctx = startAudio(name);
      expect(ctx).toBeInstanceOf(AudioContext);

      player.destroy();
      await waitStateChange();

      expect(ctx.state).toBe("closed");
    });

    it("is not created by destroy() when audio never started", () => {
      const name = uniqueName();
      const player = createPlayer(name);

      player.destroy();

      expect(AudioContextProvider.getInstance(name).get()).toBeUndefined();
    });

    it("previous one is closed when the sample rate changes", async () => {
      const name = uniqueName();
      createPlayer(name);
      const first = startAudio(name, 48000);

      const second = startAudio(name, 44100);
      await waitStateChange();

      expect(second).not.toBe(first);
      expect(second.state).not.toBe("closed");
      expect(first.state).toBe("closed");
    });

    it("is recreated when the cached one was closed externally", async () => {
      const name = uniqueName();
      createPlayer(name);
      const first = startAudio(name);
      await first.close();

      const second = startAudio(name);

      expect(second).not.toBe(first);
      expect(second.state).not.toBe("closed");
    });

    it("is usable by a player recreated with the same instanceName", async () => {
      const name = uniqueName();
      const first = createPlayer(name);
      const oldCtx = startAudio(name);
      first.destroy();
      // Integrator workaround from the issue: close the context manually.
      if (oldCtx.state !== "closed") await oldCtx.close();

      createPlayer(name);
      const ctx = startAudio(name);

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

  // TODO(#93, item 2): per-instance registries are not released yet.
  it.skip("does not hand per-instance services to the next player with the same instanceName", () => {
    const name = uniqueName();
    const first = createPlayer(name);
    const oldProvider = AudioContextProvider.getInstance(name);
    const oldBus = EventBus.getInstance(name);
    first.destroy();

    createPlayer(name);

    // Services have constructor = null, which breaks vitest's diff
    // formatter, so compare references directly.
    expect(AudioContextProvider.getInstance(name) === oldProvider).toBe(false);
    expect(EventBus.getInstance(name) === oldBus).toBe(false);
  });
});
