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
  live._nextRenditionData = { idx: 1, trackId: 5, decoderFlow: next };
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
