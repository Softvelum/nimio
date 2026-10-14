import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TransportAdapter } from "@/transport/adapter";

const workers = [];

class FakeWorker {
  constructor(url, opts) {
    this.url = url;
    this.opts = opts;
    this.postMessage = vi.fn();
    this.terminate = vi.fn();
    this.onmessage = null;
    workers.push(this);
  }
}

function createAdapter(name) {
  const adapter = new TransportAdapter(name, "worker.js");
  return { adapter, worker: workers.at(-1) };
}

describe("TransportAdapter.destroy()", () => {
  beforeEach(() => {
    workers.length = 0;
    vi.stubGlobal("Worker", FakeWorker);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("asks the worker to terminate, stops listening and reports disconnected", () => {
    const { adapter, worker } = createAdapter("ta-1");
    worker.onmessage({ data: { aux: true, connected: true } });
    expect(adapter.connected).toBe(true);

    adapter.destroy();

    expect(worker.onmessage).toBeNull();
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: "terminate" });
    expect(adapter.connected).toBe(false);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("hard-terminates the worker after exactly the fallback delay", () => {
    const { adapter, worker } = createAdapter("ta-2");

    adapter.destroy();
    vi.advanceTimersByTime(999);
    expect(worker.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("still schedules the hard terminate when postMessage throws", () => {
    const { adapter, worker } = createAdapter("ta-3");
    worker.postMessage = vi.fn(() => {
      throw new Error("worker gone");
    });

    expect(() => adapter.destroy()).not.toThrow();
    vi.advanceTimersByTime(1000);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("is idempotent and makes later send() calls no-ops", () => {
    const { adapter, worker } = createAdapter("ta-4");

    adapter.destroy();
    adapter.destroy();
    adapter.send("play", { streams: [] });

    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("drops a late worker message: no callback runs after destroy", () => {
    const { adapter, worker } = createAdapter("ta-5");
    const status = vi.fn();
    adapter.setCallback("status", status);
    const onmessage = worker.onmessage;

    adapter.destroy();
    // the browser would not deliver this (onmessage is null); even if a
    // reference leaked, the callbacks are gone
    expect(worker.onmessage).toBeNull();
    onmessage({ data: { type: "status", data: {} } });

    expect(status).not.toHaveBeenCalled();
  });

  it("runCallback() is a no-op after destroy", () => {
    const { adapter } = createAdapter("ta-6");
    const cb = vi.fn();
    adapter.setCallback("videoSetup", cb);

    adapter.destroy();

    expect(() =>
      adapter.runCallback("videoSetup", { trackId: 1 }),
    ).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("runCallback() logs and returns when no callback is set", () => {
    const { adapter } = createAdapter("ta-7");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => adapter.runCallback("audioSetup", {})).not.toThrow();

    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("TransportAdapter session tagging", () => {
  beforeEach(() => {
    workers.length = 0;
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("numbers each start and drops tagged messages from an earlier start", () => {
    const { adapter, worker } = createAdapter("ta-session");
    const status = vi.fn();
    adapter.setCallback("status", status);

    adapter.send("start", { url: "wss://a" });
    adapter.send("start", { url: "wss://b" });
    const sessions = worker.postMessage.mock.calls.map((c) => c[0].session);
    expect(sessions).toEqual([1, 2]);

    worker.onmessage({
      data: { type: "status", data: { from: "a" }, session: 1 },
    });
    expect(status).not.toHaveBeenCalled();

    worker.onmessage({
      data: { type: "status", data: { from: "b" }, session: 2 },
    });
    expect(status).toHaveBeenCalledWith({ from: "b" });
  });

  it("drops a disconnect and a connected:false from an earlier session", () => {
    const { adapter, worker } = createAdapter("ta-stale-disconnect");
    const disconnect = vi.fn();
    adapter.setCallback("disconnect", disconnect);
    adapter.send("start", { url: "wss://a" });
    adapter.send("start", { url: "wss://b" });
    worker.onmessage({ data: { aux: true, connected: true, session: 2 } });

    worker.onmessage({
      data: {
        type: "disconnect",
        data: { code: "CLOSE_ABNORMAL" },
        session: 1,
      },
    });
    worker.onmessage({ data: { aux: true, connected: false, session: 1 } });

    expect(disconnect).not.toHaveBeenCalled();
    expect(adapter.connected).toBe(true);
  });

  it("reports disconnected as soon as a new start replaces the socket", () => {
    const { adapter, worker } = createAdapter("ta-restart-connected");
    adapter.send("start", { url: "wss://a" });
    worker.onmessage({ data: { aux: true, connected: true, session: 1 } });
    expect(adapter.connected).toBe(true);

    adapter.send("start", { url: "wss://b" }); // stop(); play() in one tick
    expect(adapter.connected).toBe(false);

    // the old socket's connected:false arrives late and is dropped as stale
    worker.onmessage({ data: { aux: true, connected: false, session: 1 } });
    expect(adapter.connected).toBe(false);

    worker.onmessage({ data: { aux: true, connected: true, session: 2 } });
    expect(adapter.connected).toBe(true);
  });

  it("passes untagged messages through", () => {
    const { adapter, worker } = createAdapter("ta-untagged");
    adapter.send("start", { url: "wss://a" });

    worker.onmessage({ data: { aux: true, connected: true } });

    expect(adapter.connected).toBe(true);
  });
});
