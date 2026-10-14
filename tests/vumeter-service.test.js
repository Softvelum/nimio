import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VUMeterService } from "@/vumeter/service";
import { AudioContextProvider } from "@/audio/context-provider";

let nodes;
let deferred;

class FakeAudioContext {
  constructor(opts) {
    this.sampleRate = opts.sampleRate;
    this.state = "running";
    this.destination = { maxChannelCount: 2, channelCount: 2 };
    this.audioWorklet = {
      addModule: vi.fn(
        () =>
          new Promise((resolve, reject) => {
            deferred = { resolve, reject };
          }),
      ),
    };
    this.close = vi.fn(() => Promise.resolve());
  }
}

class FakeAudioWorkletNode {
  constructor() {
    this.port = { postMessage: vi.fn() };
    this.connect = vi.fn();
    this.disconnect = vi.fn();
    nodes.push(this);
  }
}

async function microtasks(n = 6) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

describe("VUMeterService.clear() with a pending worklet module", () => {
  let n = 0;
  let name;
  let error;

  beforeEach(() => {
    nodes = [];
    deferred = undefined;
    name = `vu-pending-${++n}`;
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
    window.AudioContext = FakeAudioContext;
    AudioContextProvider.getInstance(name).init(48000);
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    error.mockRestore();
    vi.unstubAllGlobals();
    delete window.AudioContext;
  });

  function startMeter() {
    const svc = VUMeterService.getInstance(name);
    svc.init({ mode: "peak", type: "input", api: "AudioWorklet" }, () => {});
    svc.setAudioInfo({ sampleRate: 48000, channels: 2 });
    svc.start();
    expect(deferred).toBeDefined();
    return svc;
  }

  it("ignores a module that loads after clear()", async () => {
    const svc = startMeter();

    svc.clear();
    deferred.resolve();
    await microtasks();

    expect(nodes).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
  });

  it("ignores a module that fails after clear()", async () => {
    const svc = startMeter();

    svc.clear();
    deferred.reject(new Error("not found"));
    await microtasks();

    expect(nodes).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
    expect(svc.isInitialized()).toBe(false); // no re-init by the error path
  });

  it("clear() twice and destroy() are safe", () => {
    const svc = startMeter();

    svc.clear();
    expect(() => svc.clear()).not.toThrow();
    expect(() => svc.destroy()).not.toThrow();
  });
});
