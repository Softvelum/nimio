import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NimioLive } from "@/nimio-live";

// A fake AudioWorkletNode that records every instance and whose port can
// capture message handlers (the sync clock registers one).
function installFakeNode(nodes, handlers = []) {
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      constructor(ctx) {
        if (!ctx) throw new TypeError("null audio context");
        nodes.push(this);
        this.port = {
          start: vi.fn(),
          postMessage: vi.fn(),
          addEventListener: (type, h) => handlers.push(h),
          removeEventListener: vi.fn(),
        };
      }
    },
  );
}

// Audio context whose worklet module load settles when the test says so.
function controllableContext(sampleRate = 48000) {
  const ctx = { sampleRate, audioWorklet: {} };
  ctx.audioWorklet.addModule = () =>
    new Promise((resolve, reject) => {
      ctx.settle = resolve;
      ctx.fail = reject;
    });
  return ctx;
}

// Minimal live engine: only what _initAudioProcessor(), _stopAudio(),
// _onAudioStartTsNotSet() and _sendPendingAdvertizerActions() touch.
function createAudioEngine(ctx) {
  const live = Object.create(NimioLive.prototype);
  live._logger = { debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
  live._config = {
    volumeId: "v",
    muted: false,
    latency: 0,
    latencyTolerance: 0,
    latencyAdjustMethod: "x",
    metricsOverlay: false,
    logLevel: 0,
    workletLogs: false,
    syncBuffer: 0,
  };
  live._audioInitGen = 0;
  live._audioContext = null;
  live._audioNode = null;
  live._audioWorkletReady = null;
  live._audioBuffer = null;
  live._noVideo = false;
  live._noAudio = false;
  live._audioCtrl = {
    initContext: vi.fn(() => ctx),
    initVolume: vi.fn(),
    reset: vi.fn(),
    connectSource: vi.fn(),
  };
  live._vuMeterSvc = { setAudioInfo: vi.fn(), isInitialized: () => false };
  live._workletLogReceiver = { add: vi.fn() };
  live._latencyCtrl = {};
  live._state = {
    isShared: () => true,
    isStopped: () => false,
    setPlaybackStartTsUs: vi.fn(),
  };
  live._advertizerEval = { hasPendingActions: () => false };
  live._syncModeParams = { inited: false };
  return live;
}

const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

describe("NimioLive audio initialisation after stop", () => {
  let nodes;

  beforeEach(() => {
    nodes = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("init cancelled by _stopAudio() resolves and creates no node", async () => {
    installFakeNode(nodes);
    const ctx = controllableContext();
    const live = createAudioEngine(ctx);

    const init = live._initAudioProcessor(48000, 2);
    live._stopAudio();
    ctx.settle();

    await expect(init).resolves.toBeUndefined();
    expect(nodes).toHaveLength(0);
    expect(live._audioCtrl.connectSource).not.toHaveBeenCalled();
  });

  it("init cancelled by a stop and restarted: the old load creates no node on the new run", async () => {
    installFakeNode(nodes);
    const oldCtx = controllableContext();
    const live = createAudioEngine(oldCtx);

    const oldInit = live._initAudioProcessor(48000, 2);
    live._stopAudio();
    const newCtx = controllableContext();
    live._audioCtrl.initContext = vi.fn(() => newCtx);
    const newInit = live._initAudioProcessor(48000, 2);
    oldCtx.settle();
    await flush();
    expect(nodes).toHaveLength(0); // the stale continuation did nothing
    newCtx.settle();
    await Promise.all([oldInit, newInit]);

    expect(nodes).toHaveLength(1);
    expect(live._audioNode).toBe(nodes[0]);
  });

  it("a module that fails after the stop logs no error", async () => {
    installFakeNode(nodes);
    const ctx = controllableContext();
    const live = createAudioEngine(ctx);

    const init = live._initAudioProcessor(48000, 2);
    live._stopAudio();
    ctx.fail(new Error("not found"));
    await init;

    expect(live._logger.error).not.toHaveBeenCalled();
  });

  it("a stale start-ts request after a stop and restart records nothing", async () => {
    installFakeNode(nodes);
    const ctx = controllableContext();
    const live = createAudioEngine(ctx);
    live._audioConfig = { sampleRate: 48000, numberOfChannels: 2 };
    live._firstAudioFrameTsUs = 0;
    live._firstVideoFrameTsUs = 0;
    live._noVideo = true;
    const frame = { sampleRate: 48000, numberOfChannels: 2, decTimestamp: 777 };

    const stale = live._onAudioStartTsNotSet(frame);
    live._stopAudio(); // playback stopped while the module was loading
    live._audioContext = ctx; // ...and restarted: a new context and node exist
    live._audioNode = { port: { postMessage: vi.fn() } };
    ctx.settle();

    await expect(stale).resolves.toBe(false);
    expect(live._firstAudioFrameTsUs).toBe(0);
    expect(live._state.setPlaybackStartTsUs).not.toHaveBeenCalled();
  });

  it("the sync-clock reply arriving after a stop touches no node", async () => {
    const handlers = [];
    installFakeNode(nodes, handlers);
    const ctx = controllableContext();
    const live = createAudioEngine(ctx);
    live._config.syncBuffer = 1;
    live._applySyncModeParams = vi.fn();

    const init = live._initAudioProcessor(48000, 2);
    ctx.settle();
    await flush();
    expect(handlers).toHaveLength(1); // the clock handshake is waiting
    const node = nodes[0];

    live._stopAudio(); // stop during the handshake
    for (let i = 0; i < 3; i++) {
      handlers[0]({
        data: {
          aux: true,
          type: "clock-reply",
          timeMainSend: 0,
          timeWorker: 0,
        },
      });
    }
    await init;

    expect(live._applySyncModeParams).not.toHaveBeenCalled();
    expect(live._audioNode).toBeNull();
    expect(node.port.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "sync-mode-params" }),
    );
  });

  it("no-audio mode keeps an existing node and context", async () => {
    const live = createAudioEngine(controllableContext());
    const node = { port: { postMessage: vi.fn() } };
    live._audioContext = { sampleRate: 44100 };
    live._audioNode = node;
    live._audioWorkletReady = Promise.resolve();

    await live._startNoAudioMode(); // e.g. after an audio decoder error

    expect(live._audioCtrl.initContext).not.toHaveBeenCalled();
    expect(live._audioNode).toBe(node);
    expect(live._audioContext.sampleRate).toBe(44100);
    expect(node.port.postMessage).toHaveBeenCalledWith({
      type: "audio-status",
      data: { enabled: false },
    });
  });

  it("no-audio mode initialises the idle processor when no node exists", async () => {
    installFakeNode(nodes);
    const ctx = controllableContext();
    const live = createAudioEngine(ctx);

    const start = live._startNoAudioMode();
    ctx.settle();
    await start;

    expect(nodes).toHaveLength(1);
    expect(live._audioNode).toBe(nodes[0]);
  });

  it("a stale advertizer eval-ready reply does not consume the restarted run's actions", () => {
    const handlers = [];
    const oldNode = {
      port: {
        postMessage: vi.fn(),
        addEventListener: (type, h) => handlers.push(h),
        removeEventListener: vi.fn(),
      },
    };
    const live = createAudioEngine(controllableContext());
    live._audioNode = oldNode;
    const evalState = {
      hasPendingActions: () => true,
      pendingActions: [{ op: "rem", id: 1 }],
      clearPendingActions: vi.fn(),
    };
    live._advertizerEval = evalState;
    live._sendPendingAdvertizerActions(); // registered on the old run

    live._audioInitGen++; // stop (and restart): a new run owns the queue now
    evalState.pendingActions = [{ op: "main", id: 2 }];
    handlers[0]({ data: "transp-discont-eval-ready" }); // queued before the stop

    expect(oldNode.port.postMessage).not.toHaveBeenCalled();
    expect(evalState.clearPendingActions).not.toHaveBeenCalled();
    expect(oldNode.port.removeEventListener).toHaveBeenCalled();
  });

  it("the advertizer eval-ready reply uses the node it was registered on", () => {
    const handlers = [];
    const node = {
      port: {
        postMessage: vi.fn(),
        addEventListener: (type, h) => handlers.push(h),
        removeEventListener: vi.fn(),
      },
    };
    const live = createAudioEngine(controllableContext());
    live._audioNode = node;
    live._advertizerEval = {
      hasPendingActions: () => true,
      pendingActions: [{ op: "rem" }],
      clearPendingActions: vi.fn(),
    };

    live._sendPendingAdvertizerActions();
    // the field no longer points at this node (same run, generation unchanged):
    // the handler must use the node it registered on, not the field
    live._audioNode = null;

    expect(() =>
      handlers[0]({ data: "transp-discont-eval-ready" }),
    ).not.toThrow();
    expect(node.port.postMessage).toHaveBeenCalledWith({
      type: "transp-track-action",
      data: { op: "rem" },
    });
    expect(node.port.removeEventListener).toHaveBeenCalled();
  });
});
