import LoggersFactory from "@/shared/logger";

export class SLDPManager {
  constructor(instName, transport, context, config) {
    this._curStreams = [];
    this._nextSN = 1;

    this._startOffset = config.startOffset || 0;
    this._hasVideo = !config.audioOnly;
    this._hasAudio = !config.videoOnly;

    // TODO: set from config.syncBuffer
    this._useSteady = false;

    this._transport = transport;
    this._transport.setCallback("status", async (msg) => {
      await this._processStatus(msg);
      this._play();
    });

    this._context = context;
    this._logger = LoggersFactory.create(instName, "SLDP Manager");
  }

  start(url) {
    this._transport.send("start", {
      url: url,
      protocols: ["sldp.softvelum.com"],
      useSteady: this._useSteady,
    });
  }

  stop(closeConnection) {
    this._transport.send("stop", {
      close: !!closeConnection,
      sns: this._curStreams.map((s) => s.sn),
    });
  }

  _play() {
    this._transport.send("play", {
      streams: this._curStreams,
    });
  }

  async _processStatus(streams) {
    await this._context.setStreams(streams);

    let gotVideo = !this._hasVideo;
    let vconfig = null;

    let gotAudio = !this._hasAudio;
    let aconfig = null;

    this._curStreams = [];
    let timescale = {};
    let ordStreams = this._context.orderedStreams;
    for (let i = 0; i < ordStreams.length; i++) {
      if (!gotVideo && ordStreams[i].stream_info.vcodecSupported) {
        vconfig = {
          width: width,
          height: height,
          codec: ordStreams[i].stream_info.vcodec,
        };
        timescale.video = ordStreams[i].stream_info.vtimescale;
  
        this._curStreams.push({
          type: "video",
          stream: ordStreams[i].stream,
          offset: this._startOffset,
          sn: this._nextSN++,
        });
        gotVideo = true;
      }

      if (!gotAudio && ordStreams[i].stream_info.acodecSupported) {
        aconfig = { codec: ordStreams[i].stream_info.acodec };
        timescale.audio = ordStreams[i].stream_info.atimescale;
        this._curStreams.push({
          type: "audio",
          stream: ordStreams[i].stream,
          offset: this._startOffset,
          sn: this._nextSN++,
        });
        gotAudio = true;
      }

      if (gotVideo && gotAudio) break;
    }

    this._transport.runCallback("videoConfig", vconfig);
    this._transport.runCallback("audioConfig", aconfig);
    this._transport.send("timescale", timescale);
  }
}
