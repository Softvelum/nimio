import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Nimio from "@/nimio.js";
import { NimioLive } from "@/nimio-live";
import { NimioVod } from "@/nimio-vod";
import { EventBus } from "@/event-bus";
import { PlaybackContext } from "@/playback/context";
import { StateManager } from "@/state-manager";
import { IDX } from "@/shared/values";
import { PlaybackProgressService } from "@/playback/progress-service";
import { SLDPManager } from "@/sldp/manager";
import { Reconnector } from "@/reconnector";
import { releaseInstances } from "@/shared/service";
import { MODE, STATE, ERROR } from "@/shared/values";

// The event sequence of a stop and of a URL change in VOD mode, pinned
// through the real facade, the real VOD engine's stop() and the real live
// engine's attach(), stop() and play(), on one real event bus and one real
// playback context. Only hls.js, the SLDP manager and the transport are
// stubbed. The fake-engine tests check the facade's calls; this one checks
// what an application and the UI hear, in order.

const NAME = "stop-events";
const OLD_LIVE = "wss://example.test/live/old";
const NEW_LIVE = "wss://example.test/live/new";
const OLD_VOD = "https://example.test/vod/old.m3u8";
const NEW_VOD = "https://example.test/vod/new.m3u8";

// liveMode: live playing with the UI, the VOD engine stopped after an
// archive of the old URL played (its levels in the context). realSldp: the
// real SLDP manager over a stubbed transport adapter (a kept-alive session
// whose status committed), instead of a manager stub.
function createPlayer({ liveMode = false, realSldp = false } = {}) {
  const bus = EventBus.getInstance(NAME);
  const context = PlaybackContext.getInstance(NAME);
  const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ui = {
    mediaElement: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    setDetached: vi.fn(),
    toggleMode: vi.fn(),
    showStopped: vi.fn(),
  };

  // one config object, shared by the facade and the live engine as in
  // the real player (setStreamURL() updates it in place); the VOD engine
  // holds its vod section the same way
  const config = {
    streamUrl: OLD_LIVE,
    startOffset: 0,
    vod: { url: OLD_VOD, adaptiveBitrate: {} },
  };

  // VOD engine: playing and attached (VOD mode) or stopped after playing
  // (live mode), its hls.js handler stubbed
  const vod = new NimioVod(NAME, undefined);
  vod._eventBus = bus;
  vod._logger = logger;
  vod._state = liveMode ? 4 : 3; // STOP : PLAY
  vod._url = OLD_VOD;
  vod._config = config.vod;
  vod._ui = liveMode ? undefined : ui;
  vod._loadSourcePromise = Promise.resolve();
  vod._pHandler = {
    loadSource: vi.fn(),
    stopLoad: vi.fn(),
    pauseBuffering: vi.fn(),
    resumeBuffering: vi.fn(),
    attachMedia: vi.fn(() => vod._onMediaAttached()),
    detachMedia: vi.fn(() => vod._onMediaDetached()),
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
  };
  vod._playbackService = {
    init: vi.fn(),
    resetPosition: vi.fn(),
    setCurrentTime: vi.fn(),
    startPlayback: vi.fn(() => Promise.resolve()),
    clear: vi.fn(),
    state: STATE.PLAYING,
  };
  vod._audioCtrl = { reset: vi.fn() };
  vod._vuMeterSvc = { stop: vi.fn() };
  const progress = PlaybackProgressService.getInstance(NAME);
  progress._extProgressNotifier = { vodProgress: vi.fn() };
  vod._progressSvc = progress;
  if (liveMode) {
    // the old archive played: its levels, selection and duration are known
    context.setLevels(
      [{ url: ["https://example.test/vod/old/360p.m3u8?s=1"], height: 360 }],
      OLD_VOD,
    );
    context.setCurrentLevelIdx(0);
    context.updateCurrentLevel({ details: { totalduration: 10 } });
    vod._sessionParam = "s=1"; // the old archive's
    progress.updateVodPlaylistDuration(10);
    progress._extProgressNotifier.vodProgress.mockClear();
  }

  // live engine: in VOD mode detached and stopped by its detach for the
  // switch, the server session kept alive (connected transport); in live
  // mode attached and playing
  const live = Object.create(NimioLive.prototype);
  live._instName = NAME;
  live._config = config;
  live._logger = logger;
  live._eventBus = bus;
  live._context = context;
  // the real state manager over a plain buffer (one state at a time, as in
  // production); the methods are spied for the call-count assertions
  const idxCount = Object.values(IDX).reduce(
    (total, val) => total + (Array.isArray(val) ? val.length : 1),
    0,
  );
  live._state = new StateManager(
    new ArrayBuffer(Uint32Array.BYTES_PER_ELEMENT * idxCount),
    { shared: false, sendInit: false },
  );
  live._state.stop();
  vi.spyOn(live._state, "start");
  vi.spyOn(live._state, "stop");
  vi.spyOn(live._state, "pause");
  live._playGen = 0;
  live._autoplayTimers = [];
  live._latencyCtrl = { start: vi.fn(), pause: vi.fn() };
  live._isAutoAbr = () => false;
  live._cancelPauseTimeout = vi.fn();
  live._transport = {
    connected: true,
    connecting: false,
    setCallback: vi.fn(),
    runCallback: vi.fn(),
    send: vi.fn(),
  };
  if (realSldp) {
    live._sldpManager = new SLDPManager(NAME);
    live._sldpManager.init(live._transport, config);
    live._sldpManager._sessionReady = true; // the session's status committed
  } else {
    live._sldpManager = {
      start: vi.fn(),
      stop: vi.fn(),
      requestCurrentStreams: vi.fn(),
      keepAliveConnection: vi.fn(),
      sessionReady: true,
    };
  }
  live._reconnect = { stop: vi.fn(), reset: vi.fn(), pending: false };
  live._renderVideoFrame = () => {};
  live._resetPlayback = vi.fn();
  live._audioCtxProvider = { isSuspended: () => false };
  if (liveMode) {
    live._ui = ui;
    live._state.start();
    live._state.start.mockClear();
  }

  // facade
  const n = Object.create(Nimio.prototype);
  n._instName = NAME;
  n._logger = logger;
  n._eventBus = bus;
  n._context = context;
  n._ui = ui;
  n._config = config;
  n._livePlayer = live;
  n._vodPlayer = vod;
  n._vodStartGen = 0;
  n._stopping = false;
  n._playAfterStop = false;
  n._actPlayer = liveMode ? live : vod;
  n._mode = liveMode ? MODE.LIVE : MODE.VOD;
  context.setState(STATE.PLAYING, false);

  const events = [];
  for (const name of [
    "nimio:playback-end",
    "nimio:play",
    "nimio:pause",
    "nimio:playback-error",
  ]) {
    bus.on(name, (e) => events.push([name, e.mode]));
  }
  bus.on("nimio:connection-started", (url) =>
    events.push(["nimio:connection-started", url]),
  );
  return { n, live, vod, ui, bus, context, progress, events };
}

async function microtasks(n = 6) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// the connection drops through the real disconnect handler: the engine
// is stopped, the socket is gone and a retry is pending; the application
// and the UI still see what the player was doing before the drop
function droppedPlayer({ paused = false } = {}) {
  const player = createPlayer({ liveMode: true });
  const { live } = player;
  if (paused) live._state.pause();
  live._transport.connected = false;
  live._reconnect = new Reconnector(NAME, 3);
  live._playCb = () => live.play(); // the real retry
  live._sldpManager.resetRequestedStreams = vi.fn();
  live._onDisconnect({ code: 1006 });
  expect(live._reconnect.pending).toBe(true);
  return player;
}

describe("Nimio stop() and setStreamURL() in VOD mode: the event sequence", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    releaseInstances(NAME);
  });

  it("stop(): the VOD end event only; live takes the UI idle with the stopped look", () => {
    const { n, live, vod, ui, context, events } = createPlayer();

    n.stop();

    expect(events).toEqual([["nimio:playback-end", MODE.VOD]]);
    expect(vod._state).toBe(4); // STOP
    expect(vod._ui).toBeUndefined();
    expect(live._ui).toBe(ui);
    expect(ui.toggleMode).toHaveBeenCalledWith(MODE.LIVE, { capture: false });
    expect(ui.showStopped).toHaveBeenCalledTimes(1);
    expect(live._state.start).not.toHaveBeenCalled();
    // the kept-alive session is closed
    expect(live._sldpManager.stop).toHaveBeenCalledWith({
      closeConnection: true,
    });
    expect(context.state).toEqual({ value: STATE.STOPPED, initial: false });
    expect(n._mode).toBe(MODE.LIVE);
    expect(n._actPlayer).toBe(live);
  });

  it("setStreamURL(): the VOD end event, then one initial live play with the new URL", () => {
    const { n, live, vod, events } = createPlayer();

    n.setStreamURL(NEW_LIVE);

    expect(events).toEqual([
      ["nimio:playback-end", MODE.VOD],
      ["nimio:play", MODE.LIVE],
    ]);
    expect(vod._state).toBe(4);
    expect(live._state.start).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.start).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.start).toHaveBeenCalledWith(NEW_LIVE, 0);
    // the old session was closed before the new connection
    const closed = live._sldpManager.stop.mock.invocationCallOrder[0];
    const started = live._sldpManager.start.mock.invocationCallOrder[0];
    expect(closed).toBeLessThan(started);
    expect(n._mode).toBe(MODE.LIVE);
  });

  it("stop() with a play() from the VOD end-event listener: the same sequence as a URL change", () => {
    const { n, live, bus, events } = createPlayer();
    bus.on("nimio:playback-end", () => n.play());

    n.stop();

    expect(events).toEqual([
      ["nimio:playback-end", MODE.VOD],
      ["nimio:play", MODE.LIVE],
    ]);
    expect(live._sldpManager.start).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.start).toHaveBeenCalledWith(OLD_LIVE, 0);
  });

  it("a second stop() after the first emits nothing", () => {
    const { n, events } = createPlayer();
    n.stop();
    events.length = 0;

    n.stop();

    expect(events).toEqual([]);
  });
});

describe("Nimio stop(): the SLDP session through the real manager", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    releaseInstances(NAME);
  });

  it("closes the kept-alive session, clears the session-ready flag, and the next play() handshakes anew", () => {
    const { n, live, events } = createPlayer({ realSldp: true });
    const transport = live._transport;

    n.stop();

    // the closing stop went out and the session's metadata is void
    expect(transport.send).toHaveBeenCalledWith("stop", {
      sns: [],
      close: true,
    });
    expect(live._sldpManager.sessionReady).toBe(false);
    expect(events).toEqual([["nimio:playback-end", MODE.VOD]]);

    transport.connected = false; // the worker reports the socket closed
    n.play();

    // an initial play: a new start, no play request on the old session
    const commands = transport.send.mock.calls.map((c) => c[0]);
    expect(commands.filter((c) => c === "start")).toHaveLength(1);
    expect(commands).not.toContain("play");
    expect(transport.send).toHaveBeenCalledWith(
      "start",
      expect.objectContaining({ url: OLD_LIVE }),
    );
    expect(events.slice(1)).toEqual([
      ["nimio:play", MODE.LIVE],
      ["nimio:connection-started", OLD_LIVE],
    ]);
  });
});

describe("Nimio: a pause() during a reconnect wait, then a failed seek into VOD", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    releaseInstances(NAME);
  });

  it("the rollback reports the playback end exactly once; a later stop() adds nothing", async () => {
    const { n, live, vod, events } = createPlayer({ liveMode: true });
    // the connection dropped: the engine is stopped, the socket is gone and
    // a retry is pending
    live._state.stop();
    live._transport.connected = false;
    live._reconnect = new Reconnector(NAME, 3);
    live._reconnect.schedule(() => {});
    expect(live._reconnect.pending).toBe(true);

    n.pause(); // cancels the retry, reports the pause
    expect(events).toEqual([["nimio:pause", MODE.LIVE]]);

    // a seek into VOD whose attach never completes (no MEDIA_ATTACHED)
    vod._pHandler.attachMedia = vi.fn();
    expect(n.seekVod(30)).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(n._mode).toBe(MODE.PEND);
    await vi.advanceTimersByTimeAsync(5000); // the switch times out

    expect(n._mode).toBe(MODE.LIVE);
    expect(events).toEqual([
      ["nimio:pause", MODE.LIVE],
      ["nimio:playback-error", MODE.VOD],
      ["nimio:playback-end", MODE.LIVE],
    ]);

    n.stop();

    const ends = events.filter(([name]) => name === "nimio:playback-end");
    expect(ends).toHaveLength(1);
  });
});

describe("Nimio: a seek into VOD during a reconnect wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    releaseInstances(NAME);
  });

  it("opens the VOD playing, as the player was playing a moment ago", async () => {
    const { n, vod, context, events } = droppedPlayer();

    expect(n.seekVod(30)).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(n._mode).toBe(MODE.VOD);
    expect(context.state).toEqual({ value: STATE.PLAYING, initial: false });

    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://example.test/vod/new/360p.m3u8?s=9"], height: 360 },
      ],
    });
    vod._onLevelLoaded(null, {
      details: { totalduration: 120, fragments: [] },
    });
    await vi.advanceTimersByTimeAsync(10);

    expect(vod._pHandler.resumeBuffering).toHaveBeenCalledTimes(1);
    expect(vod._playbackService.startPlayback).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]); // no end event: the playback goes on, in VOD
  });

  it("a player paused before the drop opens the VOD paused, as the base did", async () => {
    // the last user action was pause; the retry would have resumed live
    // later (base behaviour), but the seek cancels it, and the archive must
    // not start on its own
    const { n, vod, context, events } = droppedPlayer({ paused: true });

    expect(n.seekVod(30)).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(n._mode).toBe(MODE.VOD);
    // the engine's own state: the rollback's end event comes from the
    // unreported-end snapshot, not from a paused one
    expect(context.state.value).toBe(STATE.STOPPED);

    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://example.test/vod/new/360p.m3u8?s=9"], height: 360 },
      ],
    });
    vod._onLevelLoaded(null, {
      details: { totalduration: 120, fragments: [] },
    });
    await vi.advanceTimersByTimeAsync(10);

    expect(vod._playbackService.startPlayback).not.toHaveBeenCalled();
    expect(vod._pHandler.resumeBuffering).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("a player paused before the drop: a timed-out switch ends stopped with the switch error, then the end event", async () => {
    // the seek cancelled the retry that was the pending end; the
    // application last heard a pause and now hears the end, once
    const { n, live, vod, events } = droppedPlayer({ paused: true });
    vod._pHandler.attachMedia = vi.fn(); // no MEDIA_ATTACHED

    expect(n.seekVod(30)).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(5000);

    expect(n._mode).toBe(MODE.LIVE);
    expect(live._state.start).not.toHaveBeenCalled();
    expect(events).toEqual([
      ["nimio:playback-error", MODE.VOD],
      ["nimio:playback-end", MODE.LIVE],
    ]);

    n.stop();
    expect(events).toHaveLength(2);
  });

  it("a timed-out switch restarts live (an immediate retry), with the switch error only", async () => {
    const { n, live, vod, events } = droppedPlayer();
    vod._pHandler.attachMedia = vi.fn(); // no MEDIA_ATTACHED

    expect(n.seekVod(30)).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(n._mode).toBe(MODE.PEND);
    await vi.advanceTimersByTimeAsync(5000);

    expect(n._mode).toBe(MODE.LIVE);
    expect(live._state.start).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.start).toHaveBeenCalledWith(OLD_LIVE, 0);
    expect(events).toEqual([["nimio:playback-error", MODE.VOD]]);
  });
});

describe("Nimio: a play() during a reconnect wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    releaseInstances(NAME);
  });

  it("is the reconnect: the pending retry is cancelled and no end is left unreported", async () => {
    // the stale timer would spend an attempt on a player that is already
    // playing, and until it fired the engine would claim an unreported end
    const { n, live, events } = droppedPlayer();

    n.play();

    expect(live._reconnect.pending).toBe(false);
    expect(live.hasUnreportedEnd()).toBe(false);
    expect(live._sldpManager.start).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);

    expect(live._reconnect._done).toBe(0);
    expect(live._sldpManager.start).toHaveBeenCalledTimes(1);
    expect(events).toEqual([["nimio:play", MODE.LIVE]]);
  });
});

describe("Nimio: a startup VOD failover whose switch to VOD fails", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    releaseInstances(NAME);
  });

  it("reports the switch error, then NO_SRC, and leaves both engines stopped", async () => {
    // the server rejects the stream through the real status handler, the
    // facade starts the archive instead, and the archive never attaches
    const { n, live, vod, ui, bus } = createPlayer({ liveMode: true });
    n._config.vod.startupVodFailover = true;
    // the facade's own subscription, made by its constructor
    bus.on("aux:playback-error", (data) =>
      n._onLivePlaybackError(data.type, !data.stop),
    );
    const errors = [];
    bus.on("nimio:playback-error", (e) => errors.push([e.error, e.mode]));
    const others = [];
    for (const name of ["nimio:playback-end", "nimio:play", "nimio:pause"]) {
      bus.on(name, () => others.push(name));
    }
    vod._pHandler.attachMedia = vi.fn(); // no MEDIA_ATTACHED

    live._onInvalidStatus();
    await vi.advanceTimersByTimeAsync(10);
    expect(n._mode).toBe(MODE.PEND);
    expect(errors).toEqual([]); // the failover is trying the archive
    await vi.advanceTimersByTimeAsync(5000); // the switch times out

    expect(errors).toEqual([
      [ERROR.MODE_SWITCH, MODE.VOD],
      [ERROR.NO_SRC, MODE.LIVE],
    ]);
    expect(others).toEqual([]);
    // live holds the UI again without playing; the archive is not polled
    expect(n._mode).toBe(MODE.LIVE);
    expect(live._ui).toBe(ui);
    expect(live._state.start).not.toHaveBeenCalled();
    expect(vod._state).toBe(4); // STOP
    expect(
      vod._pHandler.stopLoad.mock.invocationCallOrder.at(-1),
    ).toBeGreaterThan(vod._pHandler.loadSource.mock.invocationCallOrder.at(-1));
  });
});
