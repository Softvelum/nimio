import { DecoderFlow } from "./flow";
import vDecoderUrl from "./decoder-video?worker&url"; // ?worker&url - Vite initiate new Rollup build

export class DecoderFlowVideo extends DecoderFlow {
  constructor(instanceName, trackId, timescale) {
    super(instanceName, trackId, timescale, "video", vDecoderUrl);
  }

  _prepareFrame(data) {
    return data.videoFrame;
  }

  async _handleDecoderOutput(frame, data) {
    if (await this._handleDecodedFrame(frame)) {
      this._state.setVideoLatestTsUs(this._buffer.lastFrameTs);
    }
    this._state.setVideoDecoderQueue(data.decoderQueue);
    this._state.setVideoDecoderLatency(data.decoderLatency);
  }
}
