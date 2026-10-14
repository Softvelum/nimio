import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SLDPManager } from "@/sldp/manager";

function makeTransport() {
  return {
    connected: true,
    sent: [],
    _callbacks: {},
    send(cmd, data) {
      this.sent.push({ cmd, data });
    },
    setCallback(type, cb) {
      this._callbacks[type] = cb;
    },
    runCallback(type, data) {
      if (this._callbacks[type]) this._callbacks[type](data);
    },
  };
}

const isKeepAlive = (m) =>
  m.cmd === "stop" && Array.isArray(m.data.sns) && m.data.sns.length === 0;

describe("SLDPManager closing stop", () => {
  let mgr;
  let transport;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mgr = new SLDPManager("ka-test");
    transport = makeTransport();
    mgr.init(transport, {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops sending keep-alive after a closing stop with no requested streams", () => {
    // VOD mode: no requested streams, keep-alive loop armed.
    mgr.keepAliveConnection();
    vi.advanceTimersByTime(10000);
    expect(transport.sent.filter(isKeepAlive).length).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0); // keep-alive timer pending

    mgr.stop({ closeConnection: true });
    // Hard cancellation: the pending timer is cleared, not just neutralized.
    // A soft `_keepAliveTimer = undefined` would leave the timer queued (count 1).
    expect(vi.getTimerCount()).toBe(0);
    const countAtStop = transport.sent.length;

    vi.advanceTimersByTime(60000);
    const keepAlivesAfterStop = transport.sent
      .slice(countAtStop)
      .filter(isKeepAlive).length;
    expect(keepAlivesAfterStop).toBe(0);
  });

  it("sends a close command on a closing stop even with no requested streams", () => {
    mgr.keepAliveConnection();
    vi.advanceTimersByTime(10000);
    transport.sent.length = 0;

    mgr.stop({ closeConnection: true });

    const closeMsgs = transport.sent.filter(
      (m) => m.cmd === "stop" && m.data.close === true,
    );
    expect(closeMsgs).toHaveLength(1);
    expect(closeMsgs[0].data.sns).toEqual([]);
  });

  it("does not send anything on a non-closing stop with no requested streams, keep-alive continues", () => {
    // Preserve path: arm keep-alive
    mgr.keepAliveConnection();
    vi.advanceTimersByTime(10000);
    expect(transport.sent.filter(isKeepAlive).length).toBeGreaterThan(0);

    // Clear and stop without closing
    transport.sent.length = 0;
    mgr.stop({ closeConnection: false });

    // Assert nothing was sent
    const stopMsgs = transport.sent.filter((m) => m.cmd === "stop");
    expect(stopMsgs).toHaveLength(0);

    // Assert keep-alive is still running
    vi.advanceTimersByTime(10000);
    const keepAlives = transport.sent.filter(isKeepAlive);
    expect(keepAlives).toHaveLength(1);
  });

  it("detach pattern keeps the connection alive and re-arm still works", () => {
    // NimioLive.detach(): stop without closing, then re-arm keep-alive.
    mgr._reqStreams = { 1: 0 }; // a live stream was requested
    mgr.stop({ closeConnection: false });

    const stopMsg = transport.sent.find((m) => m.cmd === "stop");
    expect(stopMsg.data.close).toBe(false); // socket NOT closed

    mgr.keepAliveConnection();
    transport.sent.length = 0;
    vi.advanceTimersByTime(10000);
    expect(transport.sent.filter(isKeepAlive).length).toBe(1); // loop alive
  });

  it("closing stop with requested streams cancels those streams and closes", () => {
    mgr._reqStreams = { 1: 0, 2: 1 };

    mgr.stop({ closeConnection: true });

    const stopMsg = transport.sent.find(
      (m) => m.cmd === "stop" && m.data.close === true,
    );
    expect(stopMsg).toBeTruthy();
    expect(stopMsg.data.sns.sort()).toEqual(["1", "2"]);
  });

  it("cancelKeepAlive() stops the loop even when the transport is disconnected", () => {
    mgr.keepAliveConnection();
    vi.advanceTimersByTime(10000);
    expect(transport.sent.filter(isKeepAlive).length).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0); // keep-alive timer pending

    transport.connected = false; // socket already dropped
    transport.sent.length = 0;
    mgr.cancelKeepAlive();
    // Hard cancellation clears the queued timer immediately.
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(60000);
    expect(transport.sent).toHaveLength(0);
  });
});
