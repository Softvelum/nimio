import { DecoderFlow } from "./flow";

export class DecoderFlowVideo extends DecoderFlow {
  constructor(trackId, timescale) {
    super(trackId, timescale, "./decoder-video.js");
    
  }

  async _processDecoderMessage(e) {
    const type = e.data.type;
    switch (type) {
      case "videoFrame":
        let frame = e.data.videoFrame;
        if (this._startTsUs === 0) {
          this._startTsUs = this._state.getPlaybackStartTsUs();
          if (this._startTsUs === 0) {
            await this._onStartTsNotSet(frame);
          }
        }
        this._buffer.pushFrame(frame);
        this._state.setVideoLatestTsUs(frame.timestamp);
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
