import { DecoderFlow } from "./flow";

export class DecoderFlowVideo extends DecoderFlow {
  constructor(instanceName, trackId, timescale) {
    super(instanceName, trackId, timescale, "video");
  }

  _prepareFrame(data) {
    return data.videoFrame;
  }

  async _handleDecoderOutput(frame, data) {
    await this._handleDecodedFrame(frame);
    this._state.setVideoLatestTsUs(frame.timestamp);
    this._state.setVideoDecoderQueue(data.decoderQueue);
    this._state.setVideoDecoderLatency(data.decoderLatency);
  }
}
