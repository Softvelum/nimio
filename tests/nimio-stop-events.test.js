import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Nimio from "@/nimio.js";
import { NimioLive } from "@/nimio-live";
import { NimioVod } from "@/nimio-vod";
import { EventBus } from "@/event-bus";
import { PlaybackContext } from "@/playback/context";
import { StateManager } from "@/state-manager";
import { IDX } from "@/shared/values";
import { PlaybackProgressService } from "@/playback/progress-service";
import { PlaybackProgressProxy } from "@/playback/progress-proxy";
import { SLDPManager } from "@/sldp/manager";
import { releaseInstances } from "@/shared/service";
import { MODE, STATE } from "@/shared/values";

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
  vod._metadataReady = true;
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
    // the media element's position, as the real service reads it back
    setCurrentTime: vi.fn((time) => {
      vod._playbackService.currentTime = time;
    }),
    getCurrentTime: () => vod._playbackService.currentTime ?? 0,
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
  live._reconnect = { stop: vi.fn(), reset: vi.fn() };
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
  n._playProgressSvc = progress;
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

describe("Nimio setStreamURL() in live mode, then a seek into the new archive before the connection is established", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    releaseInstances(NAME);
  });

  it("start, attach and manifest come from the new archive; the old one is never requested", async () => {
    const { n, live, vod, ui, context, progress, events } = createPlayer({
      liveMode: true,
    });
    const requested = () =>
      vod._pHandler.loadSource.mock.calls.map((c) => c[0]);

    n.setStreamURL({ live: NEW_LIVE, vod: NEW_VOD });

    // the live engine restarted with the new URL; the stopped VOD engine
    // was stopped again (nothing to load yet); the old archive's duration
    // is forgotten at once
    expect(events).toEqual([
      ["nimio:playback-end", MODE.LIVE],
      ["nimio:play", MODE.LIVE],
    ]);
    expect(live._sldpManager.start).toHaveBeenLastCalledWith(NEW_LIVE, 0);
    expect(requested()).toEqual([]);
    expect(progress._extProgressNotifier.vodProgress).toHaveBeenCalledWith(
      0,
      0,
    );
    expect(progress._vodPlaylistDuration).toBe(0);
    progress._extProgressNotifier.vodProgress.mockClear();

    // a seek before nimio:connection-established of the new URL
    expect(n.seekVod(30)).toBe(true);
    await microtasks();

    // the reload loaded the new master playlist without the old session
    // parameter (its own duration reset was a no-op: the durations were
    // forgotten at the URL change), and the attach requested the new URL at
    // the position
    expect(n._mode).toBe(MODE.VOD);
    expect(vod._url).toBe(NEW_VOD);
    expect(requested()).toEqual([NEW_VOD, NEW_VOD]); // no "?s=1", no old URL
    expect(progress._extProgressNotifier.vodProgress).not.toHaveBeenCalled();
    expect(vod._playbackService.setCurrentTime).toHaveBeenCalledWith(30);
    expect(vod._ui).toBe(ui);
    expect(live._ui).toBeUndefined();

    // the new master manifest replaces the old archive's levels
    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://example.test/vod/new/360p.m3u8?s=9"], height: 360 },
        { url: ["https://example.test/vod/new/720p.m3u8?s=9"], height: 720 },
      ],
    });

    expect(context.levelsSourceUrl).toBe(NEW_VOD);
    expect(context.getCurrentLevel().data.url[0]).toContain("/new/");
    expect(context.getCurrentLevel().data.details).toBeUndefined();
    expect(vod._sessionParam).toBe("s=9");
    expect(progress._vodPlaylistDuration).toBe(0); // no old duration republished

    // the new variant playlist brings the duration; live was playing, so
    // the VOD plays
    vod._onLevelLoaded(null, {
      details: { totalduration: 120, fragments: [] },
    });
    await microtasks();

    expect(progress._vodPlaylistDuration).toBe(120);
    expect(progress._extProgressNotifier.vodProgress).toHaveBeenLastCalledWith(
      0,
      120,
    );
    expect(vod._pHandler.resumeBuffering).toHaveBeenCalledTimes(1);
    expect(vod._playbackService.startPlayback).toHaveBeenCalledTimes(1);
    expect(context.state).toEqual({ value: STATE.PLAYING, initial: false });
    expect(events).toHaveLength(2); // no error, no further end event
  });
});

describe("Nimio: a seek into the archive after its first load failed", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    vi.stubGlobal("Hls", {
      ErrorTypes: { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    releaseInstances(NAME);
  });

  // live plays; the VOD engine warmed up in the background (SYNC, which
  // counts as running) and a fatal network error ended its load before the
  // variant playlist arrived: no duration is known, the URL is forgotten.
  // Seeks of a running engine go through the progress proxy.
  function failedWarmUp() {
    const player = createPlayer({ liveMode: true });
    const { n, vod, bus, context, progress } = player;
    vod._state = 2; // SYNC
    vod._metadataReady = false;
    // a first load: no levels, no session parameter, no duration
    context.setLevels([], OLD_VOD);
    vod._sessionParam = undefined;
    progress.resetVodDuration();
    n._playProgressProxy = new PlaybackProgressProxy(bus, progress);
    progress.positionChangeCb = n._onPlaybackPositionChange.bind(n);
    const vodProgress = [];
    bus.on("nimio:vod-progress", (e) =>
      vodProgress.push([e.position, e.duration]),
    );

    vod._onError(null, { fatal: true, type: "networkError" });
    expect(vod._url).toBeUndefined();
    expect(vod.isRunning()).toBe(true);
    return { ...player, vodProgress };
  }

  it("reloads the master playlist and switches to VOD, with no switch error", () => {
    const { n, vod, ui, events } = failedWarmUp();

    expect(n.seekVod(30)).toBe(true);

    expect(n._mode).toBe(MODE.VOD);
    expect(vod._ui).toBe(ui);
    expect(vod._url).toBe(OLD_VOD);
    expect(vod._pHandler.loadSource.mock.calls).toEqual([[OLD_VOD]]);
    expect(vod._playbackService.setCurrentTime).toHaveBeenCalledWith(30);
    expect(events).toEqual([]);
  });

  it("a target beyond the end is validated when the playlist arrives", () => {
    const { n, vod, vodProgress } = failedWarmUp();

    expect(n.seekVod(500)).toBe(true);
    expect(vod._playbackService.setCurrentTime).toHaveBeenLastCalledWith(500);

    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://example.test/vod/old/360p.m3u8?s=2"], height: 360 },
      ],
    });
    vod._onLevelLoaded(null, {
      details: { totalduration: 120, fragments: [] },
    });

    expect(vod._playbackService.setCurrentTime).toHaveBeenLastCalledWith(120);
    expect(vodProgress).toEqual([[120, 120]]);
  });
});

describe("Nimio: a stream URL change from inside a playlist callback of the old archive", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    releaseInstances(NAME);
  });

  // live plays, the old archive is known and the VOD engine reloads its
  // variant playlist in the background (SYNC). hls.js delivers that
  // response as MANIFEST_PARSED and then LEVEL_LOADED; the first publishes
  // the duration, and a nimio:vod-progress listener changes the stream URL
  // right there. A stopLoad() from inside the callback does not stop the
  // rest of the same response.
  function urlChangeDuringReload() {
    const player = createPlayer({ liveMode: true });
    const { n, vod, progress } = player;
    vod._state = 2; // SYNC
    vod._metadataReady = true;
    const reported = [];
    let change = true;
    progress._extProgressNotifier.vodProgress = vi.fn((position, duration) => {
      reported.push([position, duration]);
      if (change && duration > 0) {
        change = false;
        n.setStreamURL({ live: NEW_LIVE, vod: NEW_VOD });
      }
    });
    const oldVariant = {
      url: ["https://example.test/vod/old/360p.m3u8?s=1"],
      height: 360,
      details: { totalduration: 10, fragments: [] },
    };

    vod._onManifestParsed(null, { levels: [oldVariant] });
    expect(reported).toEqual([
      [0, 10],
      [0, 0],
    ]);
    expect(vod._config.url).toBe(NEW_VOD);
    vod._pHandler.stopLoad.mockClear();
    vod._onLevelLoaded(null, { details: oldVariant.details });
    return { ...player, reported };
  }

  it("the rest of that response does not bring the old duration back, and its loading is stopped", () => {
    const { vod, progress, reported } = urlChangeDuringReload();

    expect(reported).toEqual([
      [0, 10],
      [0, 0],
    ]);
    expect(progress._vodPlaylistDuration).toBe(0);
    // hls.js re-enables loading after a manifest it delivered
    expect(vod._pHandler.stopLoad).toHaveBeenCalledTimes(1);
  });

  it("the reload of the new archive that follows is still taken", async () => {
    const { vod, context, progress, reported } = urlChangeDuringReload();

    await vod.initialize(); // the next nimio:connection-established
    expect(vod._pHandler.loadSource).toHaveBeenLastCalledWith(NEW_VOD);
    vod._onManifestParsed(null, {
      levels: [
        { url: ["https://example.test/vod/new/360p.m3u8?s=9"], height: 360 },
      ],
    });
    vod._onLevelLoaded(null, {
      details: { totalduration: 120, fragments: [] },
    });

    expect(context.levelsSourceUrl).toBe(NEW_VOD);
    expect(vod._metadataReady).toBe(true);
    expect(progress._vodPlaylistDuration).toBe(120);
    expect(reported.at(-1)).toEqual([0, 120]);
  });
});
