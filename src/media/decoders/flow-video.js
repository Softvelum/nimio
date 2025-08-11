import { DecoderFlow } from "./flow";

export class DecoderFlowVideo extends DecoderFlow {
  constructor(trackId, timescale) {
    super(trackId, timescale, "./decoder-video.js");
    this._type = "video";
  }

  async _handleDecodedData(data) {
    await this._handleDecodedFrame(data.videoFrame);
    this._state.setVideoLatestTsUs(data.videoFrame.timestamp);
    this._state.setVideoDecoderQueue(data.decoderQueue);
    this._state.setVideoDecoderLatency(data.decoderLatency);
  }
}
