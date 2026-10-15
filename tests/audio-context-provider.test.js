import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AudioContextProvider } from "@/audio/context-provider";
import { releaseInstances } from "@/shared/service";

// The provider is a per-instance service: the facade's destroy releases it,
// which must close the context it created, exactly once, and drop every
// callback waiting for a suspended context to run.
let created;

class FakeAudioContext {
  constructor(opts) {
    this.sampleRate = opts.sampleRate;
    this.state = "running";
    this.destination = { maxChannelCount: 2, channelCount: 2 };
    this.close = vi.fn(() => {
      this.state = "closed";
      return Promise.resolve();
    });
    this.resume = vi.fn();
    created.push(this);
  }
}

describe("AudioContextProvider.destroy()", () => {
  let name = 0;
  let instName;
  let provider;

  beforeEach(() => {
    created = [];
    vi.stubGlobal("AudioContext", FakeAudioContext);
    instName = `acp-${++name}`;
    provider = AudioContextProvider.getInstance(instName);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    releaseInstances(instName);
  });

  it("closes the context once and drops the reference", () => {
    provider.init(48000);
    const ctx = created[0];

    provider.destroy();
    provider.destroy();

    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(provider.get()).toBeUndefined();
  });

  it("does not call close() on an already closed context", () => {
    provider.init(48000);
    const ctx = created[0];
    ctx.state = "closed";

    provider.destroy();

    expect(ctx.close).not.toHaveBeenCalled();
    expect(provider.get()).toBeUndefined();
  });

  it("clears the state-change handler and the pending callbacks of a suspended context", () => {
    class Suspended extends FakeAudioContext {
      constructor(opts) {
        super(opts);
        this.state = "suspended";
      }
    }
    vi.stubGlobal("AudioContext", Suspended);
    provider.init(48000);
    const ctx = created[0];
    const cb = vi.fn();
    provider.onContextRunning(cb);
    expect(typeof ctx.onstatechange).toBe("function");

    provider.destroy();

    expect(ctx.onstatechange).toBeUndefined();
    expect(provider.isSuspended()).toBe(false);
    expect(cb).not.toHaveBeenCalled();
  });

  it("logs a rejected close() instead of throwing", async () => {
    provider.init(48000);
    const ctx = created[0];
    ctx.close = vi.fn(() => Promise.reject(new Error("closing")));
    provider._logger.error = vi.fn();

    expect(() => provider.destroy()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(provider._logger.error).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when no context was created", () => {
    expect(() => provider.destroy()).not.toThrow();
    expect(provider.get()).toBeUndefined();
  });

  it("closes the previous context when the sample rate changes", () => {
    provider.init(48000);
    provider.init(44100);

    expect(created).toHaveLength(2);
    expect(created[0].close).toHaveBeenCalledTimes(1);
    expect(created[1].close).not.toHaveBeenCalled();
    expect(provider.get()).toBe(created[1]);
  });

  it("replaces a context that was closed externally", () => {
    provider.init(48000);
    created[0].state = "closed";

    provider.init(48000);

    expect(created).toHaveLength(2);
    expect(created[0].close).not.toHaveBeenCalled();
    expect(provider.get()).toBe(created[1]);
  });
});
