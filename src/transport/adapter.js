export class TransportAdapter {
  constructor(workerUrl) {
    this._worker = new Worker(
      new URL(workerUrl, import.meta.url),
      { type: "module" }
    );
    this._callbacks = {};
    this._worker.onmessage = (e) => this._handleMessage(e.data);
  }

  start(url, offset) {
    this._worker.postMessage({
      type: "start",
      url: url,
      protocols: ["sldp.softvelum.com"],
      startOffset: offset,
    });
  }

  stop (closeConnection) {
    this._worker.postMessage({
      type: "stop",
      close: closeConnection,
    });
  }

  onVideoConfig(callback) {
    this._callbacks["VIDEO_CONFIG"] = callback;
  }

  onVideoCodecData(callback) {
    this._callbacks["VIDEO_CODEC"] = callback;
  }

  onAudioConfig(callback) {
    this._callbacks["AUDIO_CONFIG"] = callback;
  }

  onAudioCodecData(callback) {
    this._callbacks["AUDIO_CODEC"] = callback;
  }

  _handleMessage(msg) {
    if (msg.type && this._callbacks[msg.type]) {
      this._callbacks[msg.type](msg.data);
    }
  }
}
