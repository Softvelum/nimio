import { multiInstanceService } from "@/shared/service";
import { checkSupportedCodecs } from "@/media/decoders/checker";
import { STATE } from "@/shared/values";

class PlaybackContext {
  constructor(instName) {
    this._instName = instName;

    // LIVE
    this._curConf = [];
    this._streams = [];
    this._streamsMap = {};
    this._ordRenditions = [];
    this._ordVideoRenditions = [];
    this._ordAudioRenditions = [];

    // VOD
    this._levels = [];
    this._lvl2stream = {};
    this._strm2level = {};
    this._rend2level = {};
    this._ordLevels = [];

    this._state = {
      value: STATE.STOPPED,
      initial: false,
    };

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
            name: streams[i].stream,
          });
        }
      }

      if (!streamInfo.vcodecSupported) {
        noVideoStreams.push({ idx: i });
      }

      if (streamInfo.acodec) {
        streamInfo.acodecSupported = this._cSupport.audio[streamInfo.acodec];
        if (vIdx !== null && this._ordVideoRenditions[vIdx]) {
          this._ordVideoRenditions[vIdx].hasAudio = streamInfo.acodecSupported;
        }
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

  resetCurrentStream(type) {
    this._curConf[type] = undefined;
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

  isCurrentLevel(levelIdx) {
    return this._curLevelIdx === levelIdx;
  }

  getStreamsConfig() {
    let res = [];
    for (let i = 0; i < this._streams.length; i++) {
      const streamInfo = this._streams[i].stream_info;
      let strm = {
        name: this._streams[i].stream,
        bandwidth: streamInfo.bandwidth,
      };
      if (streamInfo.vcodec) {
        strm.width = streamInfo.width;
        strm.height = streamInfo.height;
        strm.vcodec = streamInfo.vcodec;
        strm.video = streamInfo.vcodecSupported ? "supported" : "not supported";
      }
      if (streamInfo.acodec) {
        strm.acodec = streamInfo.acodec;
        strm.audio = streamInfo.acodecSupported ? "supported" : "not supported";
      }
      res.push(strm);
    }
    return res;
  }

  hasLive() {
    return this._ordRenditions.length > 0;
  }

  hasVod() {
    return this._levels.length > 0;
  }

  setLevels(levels, parentUrl) {
    this._levels = [];
    this._levelCount = 0;
    this._lvl2stream = {};
    this._strm2level = {};
    this._rend2level = {};
    this._ordLevels = [];

    let pPath = new URL(parentUrl).pathname;
    pPath = pPath.slice(0, pPath.lastIndexOf("/") + 1);
    for (let i = 0; i < levels.length; i++) {
      let lUrl = new URL(levels[i].url[0]);
      let lPath = lUrl.pathname.slice(0, lUrl.pathname.lastIndexOf("/") + 1);

      let nStart =
        lPath.length > pPath.length && lPath.startsWith(pPath)
          ? pPath.length
          : 1;
      let lvl = {
        idx: i,
        name: lPath.slice(nStart, -1),
        session: lUrl.search.slice(1),
        data: levels[i],
      };

      this._levels[i] = lvl;

      let streamIdx = this._streamsMap[lvl.name];
      if (streamIdx !== undefined) {
        this._lvl2stream[i] = streamIdx;
        this._strm2level[streamIdx] = i;
      }

      if (levels[i].height > 0) {
        this._addOrderedLevel(i, levels[i].height);

        let rend = levels[i].height + "p";
        this._levels[i].rend = rend;

        if (!this._rend2level[rend]) {
          this._rend2level[rend] = [];
        }
        this._rend2level[rend].push(i);
        this._levels[i].rIdx = this._rend2level[rend].length - 1;
      }
    }

    let curVConf = this._curConf.video;
    let curAConf = this._curConf.audio;
    if (curVConf?.idx !== undefined) {
      if (this._strm2level[curVConf.idx] !== undefined) {
        this._curLevelIdx = this._strm2level[curVConf.idx];
      } else {
        this._curLevelIdx = this.getMinimumLevelIdx();
      }
    } else if (curAConf?.idx !== undefined) {
      if (this._strm2level[curAConf.idx] !== undefined) {
        this._curLevelIdx = this._strm2level[curAConf.idx];
      } else {
        this._curLevelIdx = 0;
      }
    }
  }

  getMinimumLevelIdx() {
    let min = 1000000;
    for (let i = 0; i < this._levels.length; i++) {
      if (this._levels[i].height && this._levels[i].height < min) {
        min = this._levels[i].height;
        return i;
      }
    }

    return 0;
  }

  updateCurrentLevel(data) {
    if (this._curLevelIdx >= 0 && data.details) {
      this._levels[this._curLevelIdx].data.details = data.details;
    }
  }

  getCurrentLevel() {
    if (this._curLevelIdx >= 0) {
      return this._levels[this._curLevelIdx];
    }
  }

  setCurrentLevelIdx(idx) {
    this._curLevelIdx = idx;

    if (!this.hasLive()) return;
    let curVConf = this._curConf.video;
    if (!curVConf) return;
    if (curVConf.idx !== undefined && this._lvl2stream[idx] !== undefined) {
      curVConf.idx = this._lvl2stream[idx];
    }
  }

  getRenditionLevelIdx(rend, idx) {
    let res = this._rend2level[rend];
    if (res) res = res[idx];
    return res;
  }

  getLevelByName(name) {
    for (let i = 0; i < this._levels.length; i++) {
      if (this._levels[i].name === name) {
        return this._levels[i];
      }
    }
  }

  getStreamByName(name) {
    let idx = this._streamsMap[name];
    if( undefined !== idx ) {
      return this._streams[idx];
    }
  }

  setState(val, initial) {
    this._state.value = val;
    if (initial !== undefined) {
      this._state.initial = initial;
    }
  }

  resetState() {
    this._state.value = STATE.STOPPED;
    this._state.initial = false;
  }

  _addOrderedLevel(idx, height) {
    let oPos = 0;
    for (let j = 0; j < this._ordLevels.length; j++) {
      if (height < this._levels[this._ordLevels[j]].height) {
        break;
      }
      oPos++;
    }
    if (oPos === this._ordLevels.length) {
      this._ordLevels[oPos] = idx;
    } else {
      this._ordLevels.splice(oPos, 0, idx);
    }
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

  get levels() {
    return this._levels;
  }

  get orderedLevels() {
    return this._ordLevels;
  }

  get state() {
    return this._state;
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
      let stream = this._streams[source[i].idx];
      if (stream.stream_info.acodecSupported) {
        target.push({
          idx: source[i].idx,
          bandwidth: stream.stream_info.bandwidth,
          acodec: stream.stream_info.acodec,
          name: stream.stream,
        });
      }
    }
  }
}

PlaybackContext = multiInstanceService(PlaybackContext);
export { PlaybackContext };
