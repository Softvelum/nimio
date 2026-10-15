import { describe, it, expect, vi } from "vitest";

// Parsing a real AAC header is not under test: any header parses, and the
// engine's audio config decides compatibility.
vi.mock("@/audio/config", () => ({
  AudioConfig: class {
    parse() {
      return this;
    }
    get() {
      return {};
    }
  },
}));

import { NimioLive } from "@/nimio-live";
import { DecoderFlowAudio } from "@/media/decoders/flow-audio";

function createFlowWithWorker() {
  const flow = Object.create(DecoderFlowAudio.prototype);
  flow.setBuffer({ reset: vi.fn() }, { isStopped: () => false });
  flow._logger = { debug: vi.fn(), error: vi.fn() };
  flow._decoder = {
    postMessage: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    terminate: vi.fn(),
  };
  flow._eventBus = { emit: vi.fn() };
  flow._metricsManager = { remove: vi.fn() };
  flow._timestampManager = { removeTrack: vi.fn(), updateTimeBase: vi.fn() };
  flow._trackId = 7;
  flow._type = "audio";
  flow.onInputCancel = vi.fn();
  flow._addDecoderListener();
  return flow;
}

// A live engine with the real _onAudioCodecDataReceived() and the real
// _onRenditionSwitchResult(), everything else stubbed.
function createEngine({ paired }) {
  const live = Object.create(NimioLive.prototype);
  const main = createFlowWithWorker();
  const next = createFlowWithWorker();
  next._trackId = 5;
  live._state = { isStopped: () => false };
  live._logger = { warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  live._runMetrics = vi.fn();
  live._timestampManager = { rebaseTrack: vi.fn() };
  live._audioConfig = {
    isCompatible: () => false,
    updateFrom: vi.fn(),
    get: () => ({}),
  };
  live._sldpManager = { cancelStream: vi.fn() };
  live._isAutoAbr = () => false;
  live._eventBus = { emit: vi.fn() };
  live._decoderFlows = { audio: main, video: null };
  live._nextRenditionData = {
    type: "audio",
    idx: 1,
    trackId: 5,
    decoderFlow: next,
  };
  live._onRenditionSwitchResult = vi.fn(function (type, done) {
    return NimioLive.prototype._onRenditionSwitchResult.call(this, type, done);
  });
  main.onSwitchResult = (done) => live._onRenditionSwitchResult("audio", done);
  // as _createNextRenditionFlow() wires it: cancelling input cancels the stream
  next.onInputCancel = () => live._sldpManager.cancelStream(5);
  if (paired) main.switchTo(next); // a first, compatible header paired them
  return { live, main, next };
}

const codecData = { trackId: 5, data: new Uint8Array(2), family: "aac" };

describe("incompatible audio config for the next rendition", () => {
  it("after pairing, the switch failure is reported once and nothing throws", () => {
    const { live, main, next } = createEngine({ paired: true });

    expect(() => live._onAudioCodecDataReceived(codecData)).not.toThrow();

    expect(next._decoder.postMessage).toHaveBeenCalledWith({
      type: "shutdown",
    });
    expect(live._onRenditionSwitchResult).toHaveBeenCalledTimes(1);
    expect(live._onRenditionSwitchResult).toHaveBeenCalledWith("audio", false);
    expect(live._nextRenditionData).toBeNull();
    expect(main._switchContext).toBeNull();
    expect(main._switchPeerFlow).toBeNull();
    // destroy() cancelled the input through the flow; no second cancellation
    expect(live._sldpManager.cancelStream).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.cancelStream).toHaveBeenCalledWith(5);
  });

  it("before pairing, the engine reports the failure itself", () => {
    const { live, next } = createEngine({ paired: false });

    live._onAudioCodecDataReceived(codecData);

    expect(next._decoder.postMessage).toHaveBeenCalledWith({
      type: "shutdown",
    });
    expect(live._onRenditionSwitchResult).toHaveBeenCalledTimes(1);
    expect(live._nextRenditionData).toBeNull();
    expect(live._sldpManager.cancelStream).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.cancelStream).toHaveBeenCalledWith(5);
  });
});

// Main-track header update that the existing audio output cannot accept.
function createMainTrackEngine({ paired, nextFlowExists = true }) {
  const { live, main, next } = createEngine({ paired });
  live._audioBuffer = { reset: vi.fn() }; // an audio output already exists
  live._context = { resetCurrentStream: vi.fn() };
  if (!nextFlowExists) live._nextRenditionData.decoderFlow = undefined;
  return { live, main, next };
}

const mainCodecData = { trackId: 7, data: new Uint8Array(2), family: "aac" };

describe("incompatible audio config update on the main track", () => {
  it("with a paired next rendition: fails the switch once and cancels both streams", () => {
    const { live, main, next } = createMainTrackEngine({ paired: true });

    expect(() => live._onAudioCodecDataReceived(mainCodecData)).not.toThrow();

    expect(main._decoder.postMessage).toHaveBeenCalledWith({
      type: "shutdown",
    });
    expect(next._decoder.postMessage).toHaveBeenCalledWith({
      type: "shutdown",
    });
    expect(live._decoderFlows.audio).toBeNull();
    expect(live._nextRenditionData).toBeNull();
    expect(live._onRenditionSwitchResult).toHaveBeenCalledTimes(1);
    expect(live._onRenditionSwitchResult).toHaveBeenCalledWith("audio", false);
    expect(live._sldpManager.cancelStream).toHaveBeenCalledWith(7);
    expect(live._sldpManager.cancelStream).toHaveBeenCalledWith(5);
  });

  it("with a pending next rendition whose setup has not arrived: fails it without throwing", () => {
    const { live } = createMainTrackEngine({
      paired: false,
      nextFlowExists: false,
    });

    expect(() => live._onAudioCodecDataReceived(mainCodecData)).not.toThrow();

    expect(live._nextRenditionData).toBeNull();
    expect(live._onRenditionSwitchResult).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.cancelStream).toHaveBeenCalledWith(5);
  });

  it("with a pending VIDEO switch: leaves it alone and tears down only the main audio stream", () => {
    const { live } = createMainTrackEngine({ paired: false });
    const videoNext = createFlowWithWorker();
    videoNext._type = "video";
    videoNext._trackId = 9;
    live._nextRenditionData = {
      type: "video",
      idx: 2,
      trackId: 9,
      decoderFlow: videoNext,
    };

    expect(() => live._onAudioCodecDataReceived(mainCodecData)).not.toThrow();

    expect(videoNext._decoder.postMessage).not.toHaveBeenCalled();
    expect(live._nextRenditionData).toMatchObject({
      type: "video",
      trackId: 9,
    });
    expect(live._onRenditionSwitchResult).not.toHaveBeenCalled();
    expect(live._sldpManager.cancelStream).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.cancelStream).toHaveBeenCalledWith(7);
  });

  it("without a pending rendition: only the main stream is torn down", () => {
    const { live } = createMainTrackEngine({ paired: false });
    live._nextRenditionData = null;

    live._onAudioCodecDataReceived(mainCodecData);

    expect(live._onRenditionSwitchResult).not.toHaveBeenCalled();
    expect(live._sldpManager.cancelStream).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.cancelStream).toHaveBeenCalledWith(7);
  });
});

describe("setCurrentRendition()", () => {
  // the real selector with only what it touches; `flags` mirror the state
  function createSelector() {
    const live = Object.create(NimioLive.prototype);
    const flags = { stopped: false };
    live._logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    live._isSwitchPossible = () => true;
    live._state = { isStopped: () => flags.stopped };
    live._playGen = 0;
    live._context = {
      isCurrentStream: () => false,
      streams: [
        null,
        { stream: "aud2", stream_info: { acodecSupported: true, name: "a2" } },
      ],
    };
    live._nextRenditionData = null;
    live._eventBus = { emit: vi.fn() };
    live._sldpManager = { requestStream: vi.fn(() => 9) };
    return { live, flags };
  }

  it("records the switch type with the pending rendition data", () => {
    const { live } = createSelector();

    expect(live.setCurrentRendition("audio", 2)).toBe(true);

    expect(live._nextRenditionData).toMatchObject({
      type: "audio",
      idx: 1,
      trackId: 9,
    });
  });

  it("on a stopped engine returns false without emitting or requesting", () => {
    // nothing is playing: a request now would only create a stale pending
    // switch, and the selection does not change what the next play requests
    const { live, flags } = createSelector();
    flags.stopped = true;

    expect(live.setCurrentRendition("audio", 2)).toBe(false);

    expect(live._eventBus.emit).not.toHaveBeenCalled();
    expect(live._sldpManager.requestStream).not.toHaveBeenCalled();
    expect(live._nextRenditionData).toBeNull();
  });

  it("on a destroyed engine returns false and requests nothing", () => {
    const { live } = createSelector();
    live._destroyed = true;

    expect(live.setCurrentRendition("audio", 2)).toBe(false);

    expect(live._sldpManager.requestStream).not.toHaveBeenCalled();
    expect(live._nextRenditionData).toBeNull();
  });

  // A nimio:rendition-select listener may end playback: stop() clears the
  // pending switch state and resets the requested streams, so requesting
  // the stream afterwards would leave a stale switch that blocks every later
  // selection ("a switch is in progress").
  it("a rendition-select listener that stops the player: no request, no pending switch", () => {
    const { live, flags } = createSelector();
    live._eventBus.emit = vi.fn(() => {
      flags.stopped = true;
      live._playGen++; // what _resetPlayback() does
    });

    expect(live.setCurrentRendition("audio", 2)).toBe(false);

    expect(live._eventBus.emit).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.requestStream).not.toHaveBeenCalled();
    expect(live._nextRenditionData).toBeNull();
  });

  it("a rendition-select listener that destroys the player: no request, no pending switch", () => {
    const { live } = createSelector();
    live._eventBus.emit = vi.fn(() => (live._destroyed = true));

    expect(live.setCurrentRendition("audio", 2)).toBe(false);

    expect(live._sldpManager.requestStream).not.toHaveBeenCalled();
    expect(live._nextRenditionData).toBeNull();
  });

  it("a rendition-select listener that stops and restarts the player: no request, no pending switch", () => {
    const { live } = createSelector();
    // stop() + play(): the state is playing again, only the generation moved
    live._eventBus.emit = vi.fn(() => (live._playGen += 2));

    expect(live.setCurrentRendition("audio", 2)).toBe(false);

    expect(live._sldpManager.requestStream).not.toHaveBeenCalled();
    expect(live._nextRenditionData).toBeNull();
  });
});

describe("main-track audio header after the main flow was dropped", () => {
  // an incompatible update destroyed the main flow and cancelled the next
  // track; the next track's header may still be in flight and lands here
  function createDroppedEngine(compatible) {
    const { live } = createMainTrackEngine({ paired: false });
    live._decoderFlows.audio = null;
    live._nextRenditionData = null;
    live._audioConfig.isCompatible = () => compatible;
    live._prepareAudioOutput = vi.fn(() => true);
    return live;
  }

  it("is ignored on the incompatible path", () => {
    const live = createDroppedEngine(false);

    expect(() => live._onAudioCodecDataReceived(mainCodecData)).not.toThrow();

    expect(live._sldpManager.cancelStream).not.toHaveBeenCalled();
    expect(live._context.resetCurrentStream).not.toHaveBeenCalled();
    expect(live._onRenditionSwitchResult).not.toHaveBeenCalled();
  });

  it("is ignored on the compatible path", () => {
    const live = createDroppedEngine(true);

    expect(() => live._onAudioCodecDataReceived(mainCodecData)).not.toThrow();

    expect(live._prepareAudioOutput).not.toHaveBeenCalled();
    expect(live._audioConfig.updateFrom).not.toHaveBeenCalled();
  });
});
