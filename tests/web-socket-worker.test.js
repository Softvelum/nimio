import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

// Minimal stand-in for the browser WebSocket: send() throws on a socket that
// is not OPEN, exactly as the WebSocket spec requires.
class FakeWebSocket {
  static instances = [];
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = CONNECTING;
    this.sent = [];
    this.closeCalls = 0;
    FakeWebSocket.instances.push(this);
  }
  send(data) {
    if (this.readyState !== OPEN) {
      throw new DOMException(
        "Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.",
        "InvalidStateError",
      );
    }
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closeCalls++;
    this.readyState = CLOSING;
  }
}

async function loadWorker() {
  vi.resetModules();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  self.postMessage = vi.fn();
  await import("@/transport/web-socket");
  return (data) => self.onmessage({ data });
}

function startSocket(post) {
  post({
    type: "start",
    url: "wss://example.test/live",
    protocols: ["sldp.softvelum.com"],
    syncMode: false,
  });
  return FakeWebSocket.instances.at(-1);
}

describe("transport worker stop command", () => {
  let post;

  beforeEach(async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    post = await loadWorker();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("closing stop with no streams closes a CONNECTING socket without sending", () => {
    const socket = startSocket(post);
    expect(socket.readyState).toBe(CONNECTING);

    expect(() => post({ type: "stop", sns: [], close: true })).not.toThrow();

    expect(socket.sent).toEqual([]);
    expect(socket.closeCalls).toBe(1);
    expect(self.postMessage).toHaveBeenCalledWith({
      aux: true,
      connected: false,
    });
  });

  it("closing stop with requested streams still closes a CONNECTING socket", () => {
    const socket = startSocket(post);

    expect(() =>
      post({ type: "stop", sns: [1, 2], close: true }),
    ).not.toThrow();

    expect(socket.sent).toEqual([]);
    expect(socket.closeCalls).toBe(1);
  });

  it("keep-alive (empty Cancel without close) is still sent on an OPEN socket", () => {
    const socket = startSocket(post);
    socket.readyState = OPEN;

    post({ type: "stop", sns: [] });

    expect(socket.sent).toEqual([{ command: "Cancel", streams: [] }]);
    expect(socket.closeCalls).toBe(0);
  });

  it("closing stop with streams on an OPEN socket sends Cancel and then closes", () => {
    const socket = startSocket(post);
    socket.readyState = OPEN;

    post({ type: "stop", sns: [1, 2], close: true });

    expect(socket.sent).toEqual([{ command: "Cancel", streams: [1, 2] }]);
    expect(socket.closeCalls).toBe(1);
  });

  it("closing stop on a CLOSING socket sends nothing and still calls close()", () => {
    const socket = startSocket(post);
    socket.readyState = CLOSING;

    expect(() => post({ type: "stop", sns: [1], close: true })).not.toThrow();

    expect(socket.sent).toEqual([]);
    expect(socket.closeCalls).toBe(1);
  });

  it("keep-alive on a CLOSED socket sends nothing and does not throw", () => {
    const socket = startSocket(post);
    socket.readyState = CLOSED;

    expect(() => post({ type: "stop", sns: [] })).not.toThrow();

    expect(socket.sent).toEqual([]);
    expect(socket.closeCalls).toBe(0);
  });
});

describe("transport worker start command", () => {
  let post;

  beforeEach(async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    post = await loadWorker();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("closes a still-live previous socket before opening a new one", () => {
    const first = startSocket(post);
    first.readyState = OPEN;
    self.postMessage.mockClear();

    const second = startSocket(post);

    expect(second).not.toBe(first);
    expect(first.closeCalls).toBe(1);
    expect(first.onclose).toBeFalsy();
    expect(self.postMessage).toHaveBeenCalledWith({
      aux: true,
      connected: false,
    });
  });

  it("stale handlers of a replaced socket do not act for the new one", () => {
    const first = startSocket(post);
    first.readyState = OPEN;
    // open/message delivery is task-queued, so a handler of the old socket
    // may still run after the replacement; capture them as the browser would
    const staleOpen = first.onopen;
    const staleMessage = first.onmessage;

    const second = startSocket(post);
    self.postMessage.mockClear();

    staleOpen();
    staleMessage({ data: "{}" });

    expect(second.readyState).toBe(CONNECTING);
    expect(self.postMessage).not.toHaveBeenCalled();
    expect(first.onopen).toBeFalsy();
    expect(first.onmessage).toBeFalsy();
  });

  it("second start while the previous socket is live leaves no created socket open", () => {
    // Defensive: the player no longer does this on the paused-VOD stop path
    // (attach() reuses a connected transport), but a start that replaces a
    // live socket must still close it before the closing stop closes the new
    // one, or the first server session is orphaned.
    const preserved = startSocket(post);
    preserved.readyState = OPEN;
    post({ type: "stop", sns: [] });
    expect(preserved.sent).toEqual([{ command: "Cancel", streams: [] }]);

    const replacement = startSocket(post);
    post({ type: "stop", sns: [], close: true });

    for (const socket of FakeWebSocket.instances) {
      expect(socket.closeCalls, `socket ${socket.id} left open`).toBe(1);
    }
    expect(replacement.closeCalls).toBe(1);
  });
});
