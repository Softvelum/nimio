import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NimioLive } from "@/nimio-live";
import { SLDPManager } from "@/sldp/manager";

// End-to-end guard for the statistics/session-continuity constraint:
// when the SLDP server returns an invalid/empty status during VOD, the player
// fails over via NimioLive._onInvalidStatus() -> stop({ keepConnection: true }).
// The live session (and its keep-alive loop) MUST survive so a later return to
// live reuses the same server session; otherwise the server double-counts
// viewers. This test exercises the real NimioLive.stop() guard together with a
// real SLDPManager, so a future change to the guard that tore down keep-alive
// on the preserve path would fail here.

function makeTransport() {
  return {
    connected: true,
    sent: [],
    send(cmd, data) {
      this.sent.push({ cmd, data });
    },
    setCallback() {},
    runCallback() {},
  };
}

// A keep-alive is an empty Cancel that does not close the connection.
const isKeepAlive = (m) =>
  m.cmd === "stop" &&
  Array.isArray(m.data.sns) &&
  m.data.sns.length === 0 &&
  !m.data.close;

describe("NimioLive failover preserves the keep-alive session", () => {
  let live;
  let transport;
  let manager;

  beforeEach(() => {
    vi.useFakeTimers();
    transport = makeTransport();
    manager = new SLDPManager("nimio-live-failover-test");
    manager.init(transport, {});

    // Minimal NimioLive that runs the real stop() guard and _onInvalidStatus()
    // without constructing workers/audio/decoders. In VOD the live player is
    // detached, so its state is STOPPED.
    live = Object.create(NimioLive.prototype);
    live._sldpManager = manager;
    live._transport = transport;
    live._eventBus = { emit: () => {} };
    live._state = { isStopped: () => true };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the keep-alive loop running when _onInvalidStatus fires during VOD", () => {
    // VOD: keep-alive armed, no requested streams.
    manager.keepAliveConnection();
    vi.advanceTimersByTime(10000);
    expect(transport.sent.filter(isKeepAlive).length).toBeGreaterThan(0);

    transport.sent.length = 0;

    // Server returns an invalid/empty status -> failover.
    live._onInvalidStatus();

    // The connection must NOT be closed on this preserve path...
    expect(
      transport.sent.some((m) => m.cmd === "stop" && m.data.close === true),
    ).toBe(false);

    // ...and the keep-alive loop must still be running.
    vi.advanceTimersByTime(10000);
    expect(transport.sent.filter(isKeepAlive).length).toBe(1);
  });

  it("a closing stop from the detached state closes the session and ends keep-alive", () => {
    // VOD: live player detached (STOPPED), transport connected, keep-alive on.
    manager.keepAliveConnection();
    vi.advanceTimersByTime(10000);
    expect(transport.sent.filter(isKeepAlive).length).toBe(1);
    transport.sent.length = 0;

    // Nimio.stop() while in VOD: the stop() guard must reach the manager even
    // though the live state is already STOPPED, because the connection is up.
    live.stop();

    const closeMsgs = transport.sent.filter(
      (m) => m.cmd === "stop" && m.data.close === true,
    );
    expect(closeMsgs).toHaveLength(1);
    expect(closeMsgs[0].data.sns).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(60000);
    expect(transport.sent.filter(isKeepAlive)).toHaveLength(0);
  });
});
