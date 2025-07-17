export class SLDPManager {
  constructor(transport) {
    this._streams = [];
    this._startOffset = 0;

    this._transport = transport;
    this._transport.setCallback("status", (msg) => {
      this._processStatus(msg);
      this._play();
    });
  }

  start(url) {
    this._transport.send("start", {
      url: url,
      protocols: ["sldp.softvelum.com"],
      steady: false,
    });
  }

  stop(closeConnection) {
    this._transport.send("stop", {
      close: !!closeConnection,
      sns: this._streams.map((s) => s.sn),
    });
  }

  _play() {
    this._transport.send("play", {
      streams: this._streams,
    });
  }

  _processStatus(streams) {
    // TODO: Extend this to manage all streams
    this._streams = streams;
    for (let i = 0; i < this._streams.length; i++) {
      this._streams[i].offset = this._startOffset;
    }
  }
}
