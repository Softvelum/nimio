import { PlaybackContext } from "@/playback/context";
import { LoggersFactory } from "@/shared/logger";
import { EventBus } from "@/event-bus";

export class SLDPManager {
  constructor(instName) {
    this._curStreams = [];
    this._reqStreams = {};
    this._nextSN = 1;
    this._nextPN = 1;
    this._snMod = parseInt("80", 16);

    this._context = PlaybackContext.getInstance(instName);
    this._logger = LoggersFactory.create(instName, "SLDP Manager");
    this._eventBus = EventBus.getInstance(this._instName);
    // TODO: set from config.syncBuffer
    this._useSteady = false;
  }

  init(transport, config) {
    if (this._transport) {
      this._logger.error("SLDP Manager already initialized");
      return;
    }

    this._startOffset = config.startOffset || 0;
    this._hasVideo = !config.audioOnly;
    this._hasAudio = !config.videoOnly;
    this._initRend = config.adaptiveBitrate?.initialRendition;

    this._transport = transport;
    this._transport.setCallback("status", async (msg) => {
      await this._processStatus(msg);
      this._play(this._curStreams);
    });
  }

  start(url) {
    this._context.setSourceUrl(url);
    this._transport.send("start", {
      url: url,
      protocols: ["sldp.softvelum.com"],
      useSteady: this._useSteady,
    });
  }

  stop(opts = {}) {
    this._transport.send("stop", {
      close: !!opts.closeConnection,
      sns: this.resetCurrentStreams(),
    });
  }

  resetCurrentStreams() {
    const sns = this._curStreams.map((s) => s.sn);
    for (let i = 0; i < sns.length; i++) {
      delete this._reqStreams[sns[i]];
    }
    this._curStreams = [];

    this._transport.send("removeTimescale", sns);
    return sns;
  }

  requestStream(type, idx, offset) {
    let stream = this._getStream(idx);
    if (!stream) return;

    if (offset === undefined) offset = 0;
    let ss = this._serializeStream(type, stream, offset);
    let setup = this._setupObject(type, ss.sn, stream.stream_info);

    setTimeout(() => {
      this._transport.runCallback(`${type}Setup`, setup);
    }, 0);
    this._transport.send("timescale", { [ss.sn]: setup.timescale });

    this._reqStreams[ss.sn] = idx;
    this._play([ss]);

    return ss.sn;
  }

  probeStream(type, idx, duration) {
    this._logger.debug(`probe ${type} stream ${idx} for ${duration}ms`);
    let stream = this._getStream(idx);
    if (!stream) return;

    let sp = this._serializeProbe(type, stream, duration);
    let timescale = stream.stream_info.vtimescale;
    if (type === "audio") timescale = stream.stream_info.atimescale;
    this._transport.send("timescale", { [sp.sn]: timescale });

    this._play([sp]);
    return sp.sn;
  }

  cancelStream(sn) {
    let idx = this._reqStreams[sn];
    if (idx === undefined) {
      this._logger.error(`Stream with sn ${sn} was not requested`);
      return;
    }

    delete this._reqStreams[sn];
    this._transport.send("stop", { sns: [sn] });
    this._transport.send("removeTimescale", [sn]);
  }

  cancelProbe(sn, doRequest) {
    this._logger.debug(`cancel probe SN ${sn}, req ${doRequest}`);
    if (doRequest) {
      this._transport.send("stop", { sns: [sn] });
    }
    this._transport.send("removeTimescale", [sn]);
  }

  _play(streams) {
    this._transport.send("play", { streams });
  }

  async _processStatus(streams) {
    await this._context.setStreams(streams);

    let gotVideo = !this._hasVideo;
    let vIdx;
    if (!gotVideo) {
      vIdx = this._context.getCurrentIdx("video");
      gotVideo = vIdx !== undefined;
    }
    let vsetup = {};

    let gotAudio = !this._hasAudio;
    let aIdx;
    if (!gotAudio) {
      aIdx = this._context.getCurrentIdx("audio");
      gotAudio = aIdx !== undefined;
    }
    let asetup = {};

    this._curStreams = [];
    this._reqStreams = {};
    let timescale = {};

    let vRenditions = this._context.videoRenditions;
    if (this._initRend && !gotVideo) {
      for (let i = 0; i < vRenditions.length; i++) {
        if (vRenditions[i].rendition === this._initRend) {
          vIdx = vRenditions[i].idx;
          gotVideo = true;

          if (!gotAudio && vRenditions[i].hasAudio) {
            aIdx = vRenditions[i].idx;
            gotAudio = true;
          }
          break;
        }
      }
    }

    for (let i = 0; i < vRenditions.length; i++) {
      if (gotVideo && gotAudio) break;

      if (!gotVideo) {
        vIdx = vRenditions[i].idx;
        gotVideo = true;
      }
      if (!gotAudio && vRenditions[i].hasAudio) {
        aIdx = vRenditions[i].idx;
        gotAudio = true;
      }
    }

    if (!gotAudio) {
      // If no audio in the video renditions, take the first audio rendition
      if (this._context.audioRenditions.length > 0) {
        aIdx = this._context.audioRenditions[0].idx;
      }
    }

    if (gotVideo && vIdx !== undefined) {
      let trackId = this._nextStreamNumber(true);
      let stream = this._context.setCurrentStream("video", vIdx, trackId);
      this._pushCurStream("video", stream);
      vsetup = this._setupObject("video", trackId, stream.stream_info);
      timescale[trackId] = vsetup.timescale;
      this._reqStreams[trackId] = vIdx;
    }

    if (gotAudio && aIdx !== undefined) {
      let trackId = this._nextStreamNumber(true);
      let stream = this._context.setCurrentStream("audio", aIdx, trackId);
      this._pushCurStream("audio", stream);
      asetup = this._setupObject("audio", trackId, stream.stream_info);
      timescale[trackId] = asetup.timescale;
      this._reqStreams[trackId] = aIdx;
    }

    this._transport.runCallback("videoSetup", vsetup);
    this._transport.runCallback("audioSetup", asetup);
    this._transport.send("timescale", timescale);

    // name - application and stream name, e.g. 'live/stream'
    // width - stream width in pixels if video is present
    // height - stream height in pixels if video is present
    // vcodec - stream video codec if present
    // video - either 'supported' or 'not supported' depending on browser capabilities
    // acodec - stream audio codec if present
    // audio - either 'supported' or 'not supported' depending on browser capabilities
    // bandwidth - stream bandwidth expressed in bits per second
    this._eventBus.emit("nimio:connection-established", streams);
  }

  _pushCurStream(type, stream) {
    let strm = this._serializeStream(type, stream, this._startOffset);
    this._curStreams.push(strm);

    return strm.sn;
  }

  _serializeProbe(type, stream, duration) {
    return {
      sn: this._nextProbeNumber(),
      stream: stream.stream,
      type: type,
      offset: 10_000,
      duration: duration,
    };
  }

  _getStream(idx) {
    let stream = this._context.streams[idx];
    if (!stream) {
      this._logger.error(`Stream with index ${idx} not found`);
    }
    return stream;
  }

  _serializeStream(type, stream, offset) {
    if (offset === undefined) offset = this._startOffset;

    let res = {
      sn: this._nextStreamNumber(),
      stream: stream.stream,
      type: type,
      offset: offset,
    };

    return res;
  }

  _nextStreamNumber(omitIncrement) {
    let sn = this._nextSN % this._snMod;
    if (!omitIncrement) this._nextSN++;
    return sn;
  }

  _nextProbeNumber() {
    let pn = this._snMod + (this._nextPN % this._snMod);
    this._nextPN++;
    return pn;
  }

  _setupObject(type, trackId, streamInfo) {
    let res = { trackId };
    if (type === "video") {
      res.config = {
        width: streamInfo.width,
        height: streamInfo.height,
        codec: streamInfo.vcodec,
      };
      res.timescale = streamInfo.vtimescale;
    } else {
      res.config = { codec: streamInfo.acodec };
      res.timescale = streamInfo.atimescale;
    }

    return res;
  }
}
