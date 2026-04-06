import { DecoderFlow } from "./flow";
import { getFrameData } from "@/shared/data-helpers";
import vDecoderUrl from "./decoder-video?worker&url"; // ?worker&url - Vite initiate new Rollup build

export class DecoderFlowVideo extends DecoderFlow {
  constructor(instanceName, trackId, timescale) {
    super(instanceName, trackId, timescale, "video", vDecoderUrl);
  }

  _prepareFrame(data) {
    return data.videoFrame;
  }

  setCodecData(codecData) {
    if (this._nalProcessor) {
      this._nalProcessor.handleFrame(null, codecData);
    }
    super.setCodecData(codecData);
  }

  processChunk(data) {
    if (this._nalProcessor) {
      debugger;
      this._nalProcessor.handleFrame(data.pts, getFrameData(data));
    }
    super.processChunk(data);
  }

  async _handleDecoderOutput(frame, data) {
    if (await this._handleDecodedFrame(frame)) {
      if (!this._buffer) return;
      this._state.setVideoLatestTsUs(this._buffer.lastFrameTs);
    }
    this._state.setVideoDecoderQueue(data.decoderQueue);
    this._state.setVideoDecoderLatency(data.decoderLatency);
  }

  set nalProcessor(processor) {
    this._nalProcessor = processor;
  }
}
