import { DecoderFlow } from "./flow";

export class DecoderFlowVideo extends DecoderFlow {
  constructor(trackId, timescale) {
    super(trackId, timescale, "./decoder-video.js");
  }

  async _processDecoderMessage(e) {
    const type = e.data.type;
    switch (type) {
      case "videoFrame":
        await this._handleFrame(e.data.videoFrame);
        this._state.setVideoLatestTsUs(e.data.videoFrame.timestamp);
        this._state.setVideoDecoderQueue(e.data.decoderQueue);
        this._state.setVideoDecoderLatency(e.data.decoderLatency);
        break;
      case "decoderError":
        this._onDecodingError("video");
        break;
      default:
        console.warn(`Unknown message type in DecoderFlowVideo: ${type}`);
        break;
    }
  }
}
