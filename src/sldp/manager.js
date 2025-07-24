import LoggersFactory from "@/shared/logger";
import { checkSupportedCodecs } from "@/media/decoders/checker";

export class SLDPManager {
  constructor(instName, transport, config) {
    this._streams = [];
    this._curStreams = [];
    this._startOffset = config.startOffset || 0;

    // TODO: set from config.syncBuffer
    this._useSteady = false;

    this._transport = transport;
    this._transport.setCallback("status", async (msg) => {
      await this._processStatus(msg);
      this._play();
    });
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
    this._streams = streams;

    const supported = {
      video: await checkSupportedCodecs("video", this._streams.map(v => v.stream_info.vcodec)),
      audio: await checkSupportedCodecs("audio", this._streams.map(v => v.stream_info.acodec)),
    };

    debugger;
    const resolution = this._streams[0].stream_info.resolution;
    const [width, height] = resolution.split("x").map(Number);

    this._curStreams = [];
    let timescale = {};
    let vconfig = null;
    if (this._streams[0].stream_info.vcodec) {
      vconfig = {
        width: width,
        height: height,
        codec: this._streams[0].stream_info.vcodec,
      };
      timescale.video = +this._streams[0].stream_info.vtimescale;

      this._curStreams.push({
        type: "video",
        stream: this._streams[0].stream,
        offset: this._startOffset,
        sn: 0,
      });
    }
    this._transport.runCallback("videoConfig", vconfig);

    let aconfig = null;
    if (this._streams[0].stream_info.acodec) {
      aconfig = { codec: this._streams[0].stream_info.acodec };
      timescale.audio = +this._streams[0].stream_info.atimescale;
      this._curStreams.push({
        type: "audio",
        stream: this._streams[0].stream,
        offset: this._startOffset,
        sn: 1,
      });
    }
    this._transport.runCallback("audioConfig", aconfig);
    this._transport.send("timescale", timescale);
  }
}
