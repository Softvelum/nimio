import { checkSupportedCodecs } from "@/media/decoders/checker";

export class SLDPContext {
  constructor(instName) {
    this._instName = instName;

    this._curIdxs = [];
    this._streams = [];
    this._streamsMap = {};
    this._ordVideoRenditions = [];
    this._ordAudioRenditions = [];
  }

  async setStreams(streams) {
    this._streams = streams;
    this._streamsMap = {};
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

        if (this._cSupport.video[streamInfo.vcodec]) {
          streamInfo.vcodecSupported = true;
          streamInfo.bwStr = streamInfo.bandwidth;
          if (streamInfo.bandwidth) {
            streamInfo.bandwidth = parseInt(streamInfo.bandwidth) / 1024;
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
            rendition: res[1] + "p",
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

    this._fillAudioRenditions(this._ordVideoRenditions);
    this._fillAudioRenditions(noVideoStreams);
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

  getCurrentStream(type) {
    return this._getCurrentStream(this._curIdxs[type]);
  }

  setCurrentStream(type, idx) {
    let strm = this._streams[idx];
    if (strm) this._curIdxs[type] = idx;

    return strm;
  }

  isCurrentStream(type, idx) {
    return idx === this._curIdxs[type];
  }

  get streams() {
    return this._streams;
  }

  get videoRenditions() {
    return this._ordVideoRenditions;
  }

  get audioRenditions() {
    return this._ordAudioRenditions;
  }

  _getCurrentStream(idx) {
    let strm;
    if (idx >= 0) strm = this._streams[idx];
    return strm;
  }

  _fillAudioRenditions(source) {
    for (let i = 0; i < source.length; i++) {
      let streamInfo = this._streams[source[i].idx].stream_info;
      if (streamInfo.acodecSupported) {
        this._ordAudioRenditions.push({
          idx: source[i].idx,
          bandwidth: streamInfo.bandwidth,
          acodec: streamInfo.acodec,
        });
      }
    }
  }

}
