import { DecoderFlow } from "./flow";

export class DecoderFlowVideo extends DecoderFlow {
  constructor(trackId, timescale) {
    super(trackId, timescale, "./decoder-video.js");
    this._type = "video";
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
