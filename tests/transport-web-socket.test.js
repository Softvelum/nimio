import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";

const ws = vi.hoisted(() => {
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.readyState = FakeWebSocket.CONNECTING;
      this.sent = [];
      this.close = vi.fn(() => {
        this.readyState = FakeWebSocket.CLOSED;
      });
      ws.sockets.push(this);
    }

    send(data) {
      if (this.readyState !== FakeWebSocket.OPEN) {
        throw new DOMException(
          "Still in CONNECTING state",
          "InvalidStateError",
        );
      }
      this.sent.push(JSON.parse(data));
    }
  }

  return { FakeWebSocket, sockets: [] };
});

vi.mock("@/protocol-agent-factory", () => ({
  createProtocolAgent: () => ({
    processFrame: vi.fn(),
    processStatus: vi.fn(),
    handleMessage: vi.fn(),
  }),
}));

function send(data) {
  self.onmessage({ data });
}

function start(url) {
  send({ type: "start", url, protocols: ["sldp.softvelum.com"] });
  return ws.sockets[ws.sockets.length - 1];
}

describe("WebSocket transport worker", () => {
  beforeAll(async () => {
    vi.stubGlobal("WebSocket", ws.FakeWebSocket);
    self.postMessage = vi.fn();
    await import("@/transport/web-socket.js");
  });

  beforeEach(() => {
    // Leave no socket open from the previous test
    send({ type: "stop", sns: [], close: true });
    ws.sockets.length = 0;
  });

  it("closes the previous socket when a new connection is started", () => {
    const first = start("wss://host/app/first");

    const second = start("wss://host/app/second");

    expect(second).not.toBe(first);
    expect(first.close).toHaveBeenCalled();
    expect(second.close).not.toHaveBeenCalled();
  });

  it("closes a socket that is still connecting without sending to it", () => {
    const socket = start("wss://host/app/stream");

    expect(() => send({ type: "stop", sns: [], close: true })).not.toThrow();

    expect(socket.sent).toEqual([]);
    expect(socket.close).toHaveBeenCalled();
  });

  it("sends Cancel to an open socket before closing it", () => {
    const socket = start("wss://host/app/stream");
    socket.readyState = ws.FakeWebSocket.OPEN;

    send({ type: "stop", sns: ["1"], close: true });

    expect(socket.sent).toEqual([{ command: "Cancel", streams: ["1"] }]);
    expect(socket.close).toHaveBeenCalled();
  });

  it("keeps the empty Cancel used as keep-alive on an open socket", () => {
    const socket = start("wss://host/app/stream");
    socket.readyState = ws.FakeWebSocket.OPEN;

    send({ type: "stop", sns: [] });

    expect(socket.sent).toEqual([{ command: "Cancel", streams: [] }]);
    expect(socket.close).not.toHaveBeenCalled();
  });

  describe("terminate command", () => {
    let closeScope;

    beforeEach(() => {
      closeScope = vi.spyOn(self, "close").mockImplementation(() => {});
      self.postMessage.mockClear();
    });

    afterEach(() => {
      closeScope.mockRestore();
    });

    it("closes an open socket silently and closes the worker scope", () => {
      const socket = start("wss://host/app/stream");
      socket.readyState = ws.FakeWebSocket.OPEN;

      send({ type: "terminate" });

      expect(socket.close).toHaveBeenCalledTimes(1);
      expect(socket.onopen).toBeFalsy();
      expect(socket.onclose).toBeFalsy();
      expect(socket.onmessage).toBeFalsy();
      expect(self.postMessage).toHaveBeenCalledWith({
        aux: true,
        connected: false,
      });
      expect(self.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "disconnect" }),
      );
      expect(closeScope).toHaveBeenCalledTimes(1);
    });

    it("closes the worker scope when no socket exists", () => {
      send({ type: "terminate" });

      expect(closeScope).toHaveBeenCalledTimes(1);
      expect(self.postMessage).not.toHaveBeenCalled();
    });

    it("after a closing stop, terminate only closes the scope", () => {
      const socket = start("wss://host/app/stream");
      send({ type: "stop", sns: [], close: true });
      expect(socket.close).toHaveBeenCalledTimes(1);
      self.postMessage.mockClear();

      send({ type: "terminate" });

      expect(socket.close).toHaveBeenCalledTimes(1); // not closed again
      expect(self.postMessage).not.toHaveBeenCalled();
      expect(closeScope).toHaveBeenCalledTimes(1);
    });
  });
});
