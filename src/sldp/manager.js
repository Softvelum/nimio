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
    let vRenditions = this._context.videoRenditions;
    for (let i = 0; i < vRenditions.length; i++) {
      let stream = this._context.streams[vRenditions[i].idx];
      if (!gotVideo) {
        vconfig = this._pushCurStream("video", stream);
        timescale.video = stream.stream_info.vtimescale;
        gotVideo = true;
      }

      if (!gotAudio && stream.stream_info.acodecSupported) {
        aconfig = this._pushCurStream("audio", stream);
        timescale.audio = stream.stream_info.atimescale;
        gotAudio = true;
      }

      if (gotVideo && gotAudio) break;
    }

    if (!gotAudio) {
      // If no audio in the video renditions, take the first audio rendition
      let aRenditions = this._context.audioRenditions;
      if (aRenditions.length > 0) {
        let stream = this._context.streams[aRenditions[0].idx];
        aconfig = this._pushCurStream("audio", stream);
        timescale.audio = stream.stream_info.atimescale;
      }
    }

    this._transport.runCallback("videoConfig", vconfig);
    this._transport.runCallback("audioConfig", aconfig);
    this._transport.send("timescale", timescale);
  }

  _pushCurStream(type, stream) {
    let config = (type === "video") ? {
      width: stream.stream_info.width,
      height: stream.stream_info.height,
      codec: stream.stream_info.vcodec,
    } : {
      codec: stream.stream_info.acodec,
    };

    this._curStreams.push({
      type: type,
      stream: stream.stream,
      offset: this._startOffset,
      sn: this._nextSN++,
    });

    return config;
  }
}
