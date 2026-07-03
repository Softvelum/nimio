import { NimioLiveContext } from "./nimio-live-context";

export class NimioOffscreenWrapper {
  constructor(worker) {
    this._worker = worker;
  }

  attachPort(port) {
    this._worker.postMessage({
      type: "attachPort",
      port: port
    },
  [port]);
  }

  updateAudioConfig(config) {
    this._worker.postMessage({
      type: "updateAudioConfig",
      config: config
    });
  }

  onTrackAction(action) {
    this._worker.postMessage({
      type: "trackAction",
      action: action
    });
  }

  sendPendingAdvertizerActions() {
    this._worker.postMessage({
      type: "sendPending"
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

  setNoVideo(val) {
    this._worker.postMessage({
      type: "noVideo",
      value: val
    });    

  }

  setNoAudio(val) {
    this._worker.postMessage({
      type: "noAudio",
      value: val
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
