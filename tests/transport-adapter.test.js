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
