import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SLDPManager } from "@/sldp/manager";
import { PlaybackContext } from "@/playback/context";

function serverStream(name) {
  return {
    stream: name,
    stream_info: {
      resolution: "640x360",
      vcodec: "avc1.42e01e",
      bandwidth: "1000",
      vtimescale: "90000",
    },
  };
}

// A manager with a fake transport that records sends and exposes the status
// callback, a fake context, and a started run.
function createManager(name) {
  const mgr = new SLDPManager(name);
  const transport = {
    callbacks: {},
    setCallback: vi.fn((type, cb) => (transport.callbacks[type] = cb)),
    send: vi.fn(),
    runCallback: vi.fn(),
    connected: true,
  };
  mgr.init(transport, {});
  mgr._context = {
    setSourceUrl: vi.fn(),
    cancelPendingStreams: vi.fn(),
    setStreams: () => Promise.resolve(true),
    getStreamsConfig: () => [],
    streams: [
      {
        stream: "s1",
        stream_info: { vcodec: "avc1", width: 1, height: 1, vtimescale: 90000 },
      },
    ],
  };
  mgr._processCurrentStreams = vi.fn();
  mgr._eventBus = { emit: vi.fn() };
  mgr.start("wss://example.com/live");
  return { mgr, transport };
}

const playsOf = (transport) =>
  transport.send.mock.calls.filter((c) => c[0] === "play");

describe("SLDPManager run token and timers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stop cancels queued stream setup callbacks", () => {
    const { mgr, transport } = createManager("sldp-stop");
    mgr.requestStream("video", 0);

    mgr.stop();
    vi.runAllTimers();

    expect(transport.runCallback).not.toHaveBeenCalled();
  });

  it("cancelStream() cancels that track's queued setup and leaves others armed", () => {
    const { mgr, transport } = createManager("sldp-cancel-setup");
    const cancelled = mgr.requestStream("video", 0);
    const kept = mgr.requestStream("audio", 0);

    mgr.cancelStream(cancelled);
    vi.runAllTimers();

    const setups = transport.runCallback.mock.calls.map(([type, setup]) => [
      type,
      setup.trackId,
    ]);
    expect(setups).toEqual([["audioSetup", kept]]);
  });

  it("destroy cancels queued stream setup callbacks", () => {
    const { mgr, transport } = createManager("sldp-destroy-timers");
    mgr.requestStream("video", 0);

    mgr.destroy();
    vi.runAllTimers();

    expect(transport.runCallback).not.toHaveBeenCalled();
  });

  it("a status whose processing settles after a stop requests nothing", async () => {
    const { mgr, transport } = createManager("sldp-status-stop");
    let settle;
    mgr._context.setStreams = () =>
      new Promise((resolve) => (settle = resolve));

    const pending = transport.callbacks.status({ info: [] });
    mgr.stop();
    settle(true);
    await pending;

    expect(mgr._processCurrentStreams).not.toHaveBeenCalled();
    expect(mgr._eventBus.emit).not.toHaveBeenCalledWith(
      "nimio:connection-established",
      expect.anything(),
    );
    expect(playsOf(transport)).toHaveLength(0);
  });

  it("a stop from a connection-established listener prevents the play request", async () => {
    const { mgr, transport } = createManager("sldp-listener-stop");
    mgr._eventBus.emit = vi.fn((event) => {
      if (event === "nimio:connection-established") mgr.stop();
    });

    await transport.callbacks.status({ info: [] });

    expect(playsOf(transport)).toHaveLength(0);
  });

  it("a cancelled status settling first does not clear the restarted status's play", async () => {
    const { mgr, transport } = createManager("sldp-settle-order");
    const settlers = [];
    mgr._context.setStreams = () =>
      new Promise((resolve) => settlers.push(() => resolve(true)));
    mgr._processCurrentStreams = vi.fn(() => {
      mgr._curStreams = [{ sn: 1, stream: "s1" }];
    });

    const old = transport.callbacks.status({ info: [] });
    mgr.stop(); // stop and restart while the old codec check is pending
    mgr.start("wss://example.com/live");
    const fresh = transport.callbacks.status({ info: [] });
    settlers[0]();
    settlers[1](); // both settle in the same turn, old first
    await Promise.all([old, fresh]);

    const plays = playsOf(transport);
    expect(plays).toHaveLength(1);
    expect(plays[0][1].streams).toEqual([{ sn: 1, stream: "s1" }]);
  });

  it("a status arriving after a stop that preceded it requests nothing", async () => {
    const { mgr, transport } = createManager("sldp-stop-before-status");

    mgr.stop({ closeConnection: false }); // e.g. detach to VOD before the reply
    await transport.callbacks.status({ info: [] });

    expect(mgr._processCurrentStreams).not.toHaveBeenCalled();
    expect(playsOf(transport)).toHaveLength(0);
  });

  it("a status arriving after destroy requests nothing", async () => {
    const { mgr, transport } = createManager("sldp-destroy-before-status");

    mgr.destroy();
    await transport.callbacks.status({ info: [] });

    expect(playsOf(transport)).toHaveLength(0);
  });

  it("a stop during the codec check leaves the real context untouched", async () => {
    const { mgr, transport } = createManager("sldp-real-context");
    const ctx = PlaybackContext.getInstance("sldp-real-context");
    let settle;
    ctx._checkSupportedCodecs = () =>
      new Promise((resolve) => (settle = resolve));
    mgr._context = ctx;

    const pending = transport.callbacks.status({ info: [serverStream("old")] });
    mgr.stop();
    settle({ video: { "avc1.42e01e": true }, audio: {} });
    await pending;

    expect(ctx.streams).toHaveLength(0);
    expect(mgr._processCurrentStreams).not.toHaveBeenCalled();
    expect(playsOf(transport)).toHaveLength(0);
  });

  it("a sync-mode listener that stops playback prevents the play request", async () => {
    const { mgr, transport } = createManager("sldp-sync-listener-stop");
    mgr._useSyncMode = true;
    mgr._handleSyncParams = () => mgr.stop(); // a nimio:sync-mode-params listener stops

    await transport.callbacks.status({ info: [], steady: "1" });

    expect(mgr._processCurrentStreams).not.toHaveBeenCalled();
    expect(playsOf(transport)).toHaveLength(0);
  });

  it("sessionReady turns true only once a status committed for the current run", async () => {
    const { mgr, transport } = createManager("sldp-session-ready");
    expect(mgr.sessionReady).toBe(false);

    await transport.callbacks.status({ info: [] });
    expect(mgr.sessionReady).toBe(true);

    mgr.stop({ closeConnection: false }); // detach: session kept, metadata valid
    expect(mgr.sessionReady).toBe(true);

    mgr.start("wss://example.com/other"); // new session: metadata pending again
    expect(mgr.sessionReady).toBe(false);
  });

  it("a detach during the codec check leaves the session not ready (real context)", async () => {
    const { mgr, transport } = createManager("sldp-detach-during-codec-check");
    const ctx = PlaybackContext.getInstance("sldp-detach-during-codec-check");
    let settle;
    ctx._checkSupportedCodecs = () =>
      new Promise((resolve) => (settle = resolve));
    mgr._context = ctx;

    const pending = transport.callbacks.status({ info: [serverStream("s")] });
    mgr.stop({ closeConnection: false }); // live -> VOD while the status is checked
    settle({ video: { "avc1.42e01e": true }, audio: {} });
    await pending;

    expect(ctx.streams).toHaveLength(0);
    expect(mgr.sessionReady).toBe(false); // attach() must handshake again
  });

  it("destroy resets sessionReady", async () => {
    const { mgr, transport } = createManager("sldp-session-destroy");
    await transport.callbacks.status({ info: [] });
    expect(mgr.sessionReady).toBe(true);

    mgr.destroy();

    expect(mgr.sessionReady).toBe(false);
  });

  it("a status for a live run still requests the prepared streams", async () => {
    const { mgr, transport } = createManager("sldp-live-run");
    mgr._processCurrentStreams = vi.fn(() => {
      mgr._curStreams = [{ sn: 2, stream: "s1" }];
    });

    await transport.callbacks.status({ info: [] });

    expect(mgr._eventBus.emit).toHaveBeenCalledWith(
      "nimio:connection-established",
      [],
    );
    expect(playsOf(transport)).toHaveLength(1);
    expect(playsOf(transport)[0][1].streams).toEqual([{ sn: 2, stream: "s1" }]);
    expect(mgr._curStreams).toEqual([]);
  });

  it("destroy clears an armed keep-alive timer and leaves no timers", () => {
    const { mgr, transport } = createManager("sldp-keepalive-destroy");
    mgr.keepAliveConnection();
    transport.send.mockClear();

    mgr.destroy();
    vi.advanceTimersByTime(10000);

    const keepAlives = transport.send.mock.calls.filter(
      ([cmd, data]) => cmd === "stop" && data.sns?.length === 0,
    );
    expect(keepAlives).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
