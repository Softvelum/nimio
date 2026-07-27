import { describe, it, expect, vi, beforeEach } from "vitest";

const flowMocks = vi.hoisted(() => {
  class FakeDecoderFlow {
    constructor(instanceName, trackId, timescale) {
      this.instanceName = instanceName;
      this.trackId = trackId;
      this.timescale = timescale;
      this.setConfig = vi.fn();
    }
  }

  return {
    videoInstances: [],
    audioInstances: [],
    FakeVideoFlow: class extends FakeDecoderFlow {
      constructor(...args) {
        super(...args);
        flowMocks.videoInstances.push(this);
      }
    },
    FakeAudioFlow: class extends FakeDecoderFlow {
      constructor(...args) {
        super(...args);
        flowMocks.audioInstances.push(this);
      }
    },
  };
});

vi.mock("@/media/decoders/flow-video", () => ({
  DecoderFlowVideo: flowMocks.FakeVideoFlow,
}));

vi.mock("@/media/decoders/flow-audio", () => ({
  DecoderFlowAudio: flowMocks.FakeAudioFlow,
}));

import { NimioLive } from "@/nimio-live.js";

function createLive() {
  const live = Object.create(NimioLive.prototype);
  live._config = { instanceName: "Test" };
  live._decoderFlows = { video: null, audio: null };
  live._nextRenditionData = {};
  live._sldpManager = { cancelStream: vi.fn() };
  live._eventBus = { emit: vi.fn() };
  live._onDecodedBufferFull = vi.fn();
  return live;
}

describe("NimioLive", () => {
  beforeEach(() => {
    flowMocks.videoInstances.length = 0;
    flowMocks.audioInstances.length = 0;
  });

  describe.each([
    ["video", "videoInstances", { codec: "avc1.42e01e" }, 90000],
    ["audio", "audioInstances", { codec: "mp4a.40.2" }, 48000],
  ])(
    "%s decoded-buffer-full callback",
    (type, instances, config, timescale) => {
      const data = { trackId: 2, timescale, config };

      it("is bound to the main flow with the track type", () => {
        const live = createLive();

        live._createMainDecoderFlow(type, data);

        const flow = flowMocks[instances][0];
        expect(flow.onDecodedBufferFull).toBeTypeOf("function");

        flow.onDecodedBufferFull();
        expect(live._onDecodedBufferFull).toHaveBeenCalledWith(type);
      });

      it("is bound to the next rendition flow with the track type", () => {
        const live = createLive();

        live._createNextRenditionFlow(type, data);

        const flow = flowMocks[instances][0];
        expect(flow.onDecodedBufferFull).toBeTypeOf("function");

        flow.onDecodedBufferFull();
        expect(live._onDecodedBufferFull).toHaveBeenCalledWith(type);
      });
    },
  );

  describe("_onDecodedBufferFull", () => {
    function createLiveInState(paused) {
      const live = Object.create(NimioLive.prototype);
      live._state = { isPaused: () => paused };
      live._logger = { warn: vi.fn() };
      live._cancelPauseTimeout = vi.fn();
      live.stop = vi.fn();
      return live;
    }

    it("stops playback and cancels the pause timeout while paused", () => {
      const live = createLiveInState(true);

      live._onDecodedBufferFull("audio");

      expect(live._cancelPauseTimeout).toHaveBeenCalledTimes(1);
      expect(live.stop).toHaveBeenCalledTimes(1);
      expect(live._logger.warn).toHaveBeenCalledWith(
        "Auto stop on audio buffer fill",
      );
    });

    it("does nothing while playing", () => {
      const live = createLiveInState(false);

      live._onDecodedBufferFull("video");

      expect(live._cancelPauseTimeout).not.toHaveBeenCalled();
      expect(live.stop).not.toHaveBeenCalled();
    });
  });
});
