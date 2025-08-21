import LoggersFactory from "@/shared/logger";

export class SLDPManager {
  constructor(instName, transport, context, config) {
    this._curStreams = [];
    this._reqStreams = {};
    this._nextSN = 1;

    this._startOffset = config.startOffset || 0;
    this._hasVideo = !config.audioOnly;
    this._hasAudio = !config.videoOnly;
    this._initRend = config.adaptiveBitrate.initialRendition;

    // TODO: set from config.syncBuffer
    this._useSteady = false;

    this._transport = transport;
    this._transport.setCallback("status", async (msg) => {
      await this._processStatus(msg);
      this._play(this._curStreams);
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
    let sns = this._curStreams.map((s) => s.sn);
    this._transport.send("stop", {
      close: !!closeConnection,
      sns: sns,
    });
    this._transport.send("removeTimescale", sns);
  }

  requestStream(type, idx) {
    let stream = this._context.streams[idx];
    if (!stream) {
      this._logger.error(`Stream with index ${idx} not found`);
      return;
    }

    let ss = this._serializeStream(type, stream, 0);
    let setup = this._setupObject(type, ss.sn, stream.stream_info);

    setTimeout(() => {
      this._transport.runCallback(`${type}Setup`, setup);
    }, 0);
    this._transport.send("timescale", { [ss.sn]: setup.timescale });

    this._reqStreams[idx] = ss.sn;
    this._play([ss]);

    return ss.sn;
  }

  cancelStream(idx) {
    let sn = this._reqStreams[idx];
    if (sn === undefined) {
      this._logger.error(`Stream with index ${idx} was not requested`);
      return;
    }

    delete this._reqStreams[idx];
    this._transport.send("stop", { sns: [sn] });
    this._transport.send("removeTimescale", [sn]);
  }

  _play(streams) {
    this._transport.send("play", { streams });
  }

  async _processStatus(streams) {
    await this._context.setStreams(streams);

    let gotVideo = !this._hasVideo;
    let vIdx = null;
    let vsetup = {};

    let gotAudio = !this._hasAudio;
    let aIdx = null;
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

    if (gotVideo && vIdx !== null) {
      let stream = this._context.setCurrentVideoStream(vIdx);
      let trackId = this._pushCurStream("video", stream);
      vsetup = this._setupObject("video", trackId, stream.stream_info);
      timescale[trackId] = vsetup.timescale;
    }

    if (gotAudio && aIdx !== null) {
      let stream = this._context.setCurrentAudioStream(aIdx);
      let trackId = this._pushCurStream("audio", stream);
      asetup = this._setupObject("audio", trackId, stream.stream_info);
      timescale[trackId] = asetup.timescale;
    }

    this._transport.runCallback("videoSetup", vsetup);
    this._transport.runCallback("audioSetup", asetup);
    this._transport.send("timescale", timescale);
  }

  _pushCurStream(type, stream) {
    let strm = this._serializeStream(type, stream, this._startOffset);
    this._curStreams.push(strm);

    return strm.sn;
  }

  _serializeStream(type, stream, offset) {
    let sn = this._streamNumber();
    if (offset === undefined) {
      offset = this._startOffset;
    }

    return {
      type: type,
      stream: stream.stream,
      offset: offset,
      sn: sn,
    };
  }

  _streamNumber() {
    let sn = this._nextSN % parseInt("F0", 16);
    this._nextSN++;
    return sn;
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
