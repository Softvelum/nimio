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

describe("NimioLive", () => {
  beforeEach(() => {
    flowMocks.videoInstances.length = 0;
    flowMocks.audioInstances.length = 0;
  });

  it("binds decoded-buffer-full callback for next video rendition flow", () => {
    const live = Object.create(NimioLive.prototype);
    live._config = { instanceName: "Test" };
    live._nextRenditionData = {};
    live._sldpManager = { cancelStream: vi.fn() };
    live._onDecodedBufferFull = function () {
      this._decodedBufferFullHandled = true;
    };

    live._createNextRenditionFlow("video", {
      trackId: 2,
      timescale: 90000,
      config: { codec: "avc1.42e01e" },
    });

    const flow = flowMocks.videoInstances[0];
    expect(flow.onDecodedBufferFull).toBeTypeOf("function");

    flow.onDecodedBufferFull();

    expect(live._decodedBufferFullHandled).toBe(true);
  });
});
