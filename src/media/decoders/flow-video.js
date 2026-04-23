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
      this._nalProcessor.handleFrame({ codecData });
    }
    super.setCodecData(codecData);
  }

  processChunk(data) {
    if (!this._canHandleChunk(data)) {
      return false;
    }

    if (this._nalProcessor) {
      data.frame = getFrameData(data);
      let processed = this._nalProcessor.handleFrame(data);
      for (let i = 0; i < processed.length; i++) {
        super.processChunk(processed[i]);
      }
      return true;
    }

    return super.processChunk(data);
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
