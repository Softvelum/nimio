import { NimioLiveContext } from "./nimio-live-context";

export class NimioOffscreenWrapper {
  constructor(worker) {
    this._worker = worker;
  }

  updateAudioConfig(config) {
    this._worker.postMessage({
      type: "updateAudioConfig",
      config: config
    });
  }

  updateLatencyParams(params) {
    this._worker.postMessage({
      type: "updateLatency",
      params: params
    });
  }

  play() {
    this._worker.postMessage({
      type: "play"
    });    
  }

  play() {
    this._worker.postMessage({
      type: "play"
    });
  }
  pause() {
    this._worker.postMessage({
      type: "pause"
    });
  }

  stop() {
    this._worker.postMessage({
      type: "stop"
    });    
  }

  resetPlayback() {
    this._worker.postMessage({
      type: "resetPlayback"
    });    

  }

  onAttach() {
    this._worker.postMessage({
      type: "attach"
    });
  }

}
