import { multiInstanceService } from "@/shared/service";
import { checkSupportedCodecs } from "@/media/decoders/checker";

class PlaybackContext {
  constructor(instName) {
    this._instName = instName;

    this._curConf = [];
    this._streams = [];
    this._streamsMap = {};
    this._ordRenditions = [];
    this._ordVideoRenditions = [];
    this._ordAudioRenditions = [];

    this._autoAbr = false;
  }

  setSourceUrl(url) {
    if (this._sourceUrl === url) return;
    this._sourceUrl = url;
    this._curConf = [];
  }

  async setStreams(streams) {
    this._streams = streams;
    this._streamsMap = {};

    this._ordRenditions = [];
    this._ordVideoRenditions = [];
    this._ordAudioRenditions = [];

    this._cSupport = await this._checkSupportedCodecs(streams);

    let noVideoStreams = [];
    for (let i = 0; i < streams.length; i++) {
      this._streamsMap[streams[i].stream] = i;

      let streamInfo = streams[i].stream_info;
      if (streamInfo.vtimescale) {
        streamInfo.vtimescale = parseInt(streamInfo.vtimescale);
      }
      if (streamInfo.atimescale) {
        streamInfo.atimescale = parseInt(streamInfo.atimescale);
      }

      let vIdx = null;
      if (streamInfo.resolution && streamInfo.vcodec) {
        let res = streamInfo.resolution.split("x");
        streamInfo.width = parseInt(res[0]);
        streamInfo.height = parseInt(res[1]);
        streamInfo.name = res[1] + "p";

        if (this._cSupport.video[streamInfo.vcodec]) {
          streamInfo.vcodecSupported = true;
          streamInfo.bwStr = streamInfo.bandwidth;
          if (streamInfo.bandwidth) {
            streamInfo.bandwidth = parseInt(streamInfo.bandwidth);
          }

          for (vIdx = 0; vIdx < this._ordVideoRenditions.length; vIdx++) {
            let ordStreamInfo =
              this._streams[this._ordVideoRenditions[vIdx].idx].stream_info;
            if (
              ordStreamInfo.height > streamInfo.height ||
              (ordStreamInfo.height === streamInfo.height &&
                ordStreamInfo.bandwidth > streamInfo.bandwidth)
            ) {
              break;
            }
          }

          this._ordVideoRenditions.splice(vIdx, 0, {
            idx: i,
            bandwidth: streamInfo.bandwidth,
            width: streamInfo.width,
            height: streamInfo.height,
            vcodec: streamInfo.vcodec,
            rendition: streamInfo.name,
          });
        }
      }

      if (!streamInfo.vcodecSupported) {
        noVideoStreams.push({ idx: i });
      }

      if (streamInfo.acodec) {
        streamInfo.acodecSupported = this._cSupport.audio[streamInfo.acodec];
        this._ordVideoRenditions[vIdx].hasAudio = streamInfo.acodecSupported;
      }
    }

    for (let i = 0; i < this._ordVideoRenditions.length; i++) {
      let r = { ...this._ordVideoRenditions[i] };
      if (r.hasAudio) {
        r.acodec = this._streams[r.idx].stream_info.acodec;
        delete r.hasAudio;
      }
      this._ordRenditions.push(r);
    }

    this._cpAudioRenditions(this._ordAudioRenditions, this._ordVideoRenditions);
    this._cpAudioRenditions(this._ordAudioRenditions, noVideoStreams);
    this._cpAudioRenditions(this._ordRenditions, noVideoStreams);
  }

  getCurrentIdx(type) {
    let res = this._curConf[type];
    if (res) res = res.idx;
    return res;
  }

  getCurrentStreamInfo() {
    let res = { vIdx: this.getCurrentIdx("video") };

    let stream;
    if (res.vIdx >= 0) {
      res.vId = this._curConf.video.trackId;
      stream = this._getStream(res.vIdx);
      if (stream) {
        res.height = stream.stream_info.height;
        res.orderedIdx = this._getStreamOrderedIdx(res.vIdx);
      }
    }
    res.aIdx = this.getCurrentIdx("audio");
    if (res.aIdx >= 0) {
      res.aId = this._curConf.audio.trackId;
      if (!stream) {
        stream = this._getStream(res.aIdx);
      }
    }
    if (stream) {
      res.bandwidth = stream.stream_info.bandwidth;
    }

    return res;
  }

  setCurrentStream(type, idx, trackId) {
    let strm = this._streams[idx];
    if (strm) this._curConf[type] = { idx, trackId };
    return strm;
  }

  getCurrentRendition(type) {
    let conf = this._curConf[type];
    if (!conf) return null;

    for (let i = 0; i < this._ordRenditions.length; i++) {
      if (this._ordRenditions[i].idx === conf.idx) {
        return this._ordRenditions[i];
      }
    }
    return null;
  }

  isCurrentStream(type, idx) {
    return this._curConf[type] && idx === this._curConf[type].idx;
  }

  get streams() {
    return this._streams;
  }

  get allRenditions() {
    return this._ordRenditions;
  }

  get videoRenditions() {
    return this._ordVideoRenditions;
  }

  get audioRenditions() {
    return this._ordAudioRenditions;
  }

  get autoAbr() {
    return this._autoAbr;
  }

  set autoAbr(val) {
    this._autoAbr = val;
  }

  async _checkSupportedCodecs(streams) {
    return {
      video: await checkSupportedCodecs(
        "video",
        streams.map((v) => v.stream_info.vcodec),
      ),
      audio: await checkSupportedCodecs(
        "audio",
        streams.map((v) => v.stream_info.acodec),
      ),
    };
  }

  _getStream(idx) {
    let strm;
    if (idx >= 0) strm = this._streams[idx];
    return strm;
  }

  _getStreamOrderedIdx(idx) {
    for (let i = 0; i < this._ordVideoRenditions.length; i++) {
      if (this._ordVideoRenditions[i].idx === idx) {
        return i;
      }
    }
  }

  _cpAudioRenditions(target, source) {
    for (let i = 0; i < source.length; i++) {
      let streamInfo = this._streams[source[i].idx].stream_info;
      if (streamInfo.acodecSupported) {
        target.push({
          idx: source[i].idx,
          bandwidth: streamInfo.bandwidth,
          acodec: streamInfo.acodec,
        });
      }
    }
  }
}

PlaybackContext = multiInstanceService(PlaybackContext);
export { PlaybackContext };
