import { describe, it, expect, vi, afterEach } from "vitest";
import { releaseInstances } from "@/shared/service";
import { EventBus } from "@/event-bus";

// The real constructor runs under jsdom with a stubbed Worker. The media
// grabber is the last thing the constructor creates, after the transport
// worker, the SLDP manager, the reconnector and the autoplay timers: making
// it throw reproduces a failure that would otherwise leak all of those.
const probe = vi.hoisted(() => ({ fail: false }));
vi.mock("@/grabber", () => ({
  MediaGrabber: {
    getInstance() {
      if (probe.fail) throw new Error("grabber boom");
      return { setRate() {}, onScreenshotReady() {}, start() {}, stop() {} };
    },
  },
}));

class FakeWorker {
  constructor() {
    this.postMessage = vi.fn();
    this.terminate = vi.fn();
    FakeWorker.instances.push(this);
  }
}
FakeWorker.instances = [];

import { NimioLive } from "@/nimio-live";

const config = {
  streamUrl: "wss://example.test/live",
  fullBufferMs: 1000,
  latency: 500,
  latencyTolerance: 0,
  reconnects: 0,
  startOffset: 0,
  workletLogs: false,
  autoplay: true,
  screenshots: { rate: 1 },
};

describe("NimioLive constructor failure", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    probe.fail = false;
    FakeWorker.instances.length = 0;
    releaseInstances("Init");
  });

  it("releases the transport worker, unsubscribes and rethrows", () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    probe.fail = true;
    const ui = { hideControls: vi.fn(), clear: vi.fn() };

    expect(() => new NimioLive("Init", ui, config)).toThrow("grabber boom");

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledWith({
      type: "terminate",
    });
    vi.advanceTimersByTime(1000);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    expect(ui.hideControls).not.toHaveBeenCalled(); // autoplay cancelled
    const bus = EventBus.getInstance("Init");
    expect(bus.hasListeners("ui:play-pause-click")).toBe(false);
    expect(bus.hasListeners("transp:track-action")).toBe(false);
    expect(bus.hasListeners("nimio:connection-established")).toBe(false); // reconnector
  });

  it("a successful construction leaves the worker alive", () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    const ui = { hideControls: vi.fn(), clear: vi.fn() };

    const live = new NimioLive("Init", ui, {
      ...config,
      autoplay: false,
      screenshots: undefined,
    });

    expect(live._destroyed).toBeFalsy();
    expect(FakeWorker.instances[0].postMessage).not.toHaveBeenCalledWith({
      type: "terminate",
    });
    live.destroy();
  });
});

describe("NimioLive._rollbackInit()", () => {
  it("rollback before the transport exists releases what is there and does not throw", () => {
    const live = Object.create(NimioLive.prototype);
    live._logger = { error: vi.fn(), debug: vi.fn() };
    live._eventBus = { off: vi.fn() };
    live._autoplayTimers = [];
    live._removeUIEventHandlers = vi.fn();
    live._deinitTransport = vi.fn();

    expect(() => live._rollbackInit()).not.toThrow();

    expect(live._destroyed).toBe(true);
    expect(live._removeUIEventHandlers).toHaveBeenCalledTimes(1);
    expect(live._deinitTransport).not.toHaveBeenCalled();
    expect(live._logger.error).not.toHaveBeenCalled();
  });

  it("a failing step is logged and the others still run", () => {
    const live = Object.create(NimioLive.prototype);
    live._logger = { error: vi.fn(), debug: vi.fn() };
    live._eventBus = { off: vi.fn() };
    live._autoplayTimers = [];
    live._removeUIEventHandlers = vi.fn();
    live._deinitTransport = vi.fn();
    live._transport = { destroy: vi.fn() };
    live._sldpManager = {
      destroy: vi.fn(() => {
        throw new Error("manager boom");
      }),
    };
    live._reconnect = { destroy: vi.fn() };
    live._debugView = { stop: vi.fn() };

    expect(() => live._rollbackInit()).not.toThrow();

    expect(live._deinitTransport).toHaveBeenCalledTimes(1);
    expect(live._reconnect.destroy).toHaveBeenCalledTimes(1);
    expect(live._debugView.stop).toHaveBeenCalledTimes(1);
    expect(live._transport.destroy).toHaveBeenCalledTimes(1);
    expect(live._logger.error).toHaveBeenCalledTimes(1);
    expect(live._logger.error.mock.calls[0][0]).toBe(
      "init rollback: SLDP manager failed",
    );
  });
});
