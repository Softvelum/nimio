import { checkSupportedCodecs } from "@/media/decoders/checker";

export class SLDPContext {
  constructor(instName) {
    this._instName = instName;

    this._streams = [];
    this._streamsMap = {};
    this._orderedStreams = [];
  }

  async setStreams(streams) {
    this._streams = streams;
    this._streamsMap = {};
    this._orderedStreams = [];

    this._cSupport = {
      video: await checkSupportedCodecs(
        "video",
        streams.map((v) => v.stream_info.vcodec),
      ),
      audio: await checkSupportedCodecs(
        "audio",
        streams.map((v) => v.stream_info.acodec),
      ),
    };

    for (let i = 0; i < streams.length; i++) {
      this._streamsMap[streams[i].stream] = i;

      let streamInfo = streams[i].stream_info;
      if (streamInfo.vtimescale) {
        streamInfo.vtimescale = parseInt(streamInfo.vtimescale);
      }
      if (streamInfo.atimescale) {
        streamInfo.atimescale = parseInt(streamInfo.atimescale);
      }

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

          let j = 0;
          for (; j < this._orderedStreams.length; j++) {
            let ordStreamInfo =
              this._streams[this._orderedStreams[j].idx].stream_info;
            if (
              ordStreamInfo.height > streamInfo.height ||
              (ordStreamInfo.height === streamInfo.height &&
                ordStreamInfo.bandwidth > streamInfo.bandwidth)
            ) {
              break;
            }
          }

          this._orderedStreams.splice(j, 0, {
            idx: i,
            bandwidth: streamInfo.bandwidth,
            rendition: res[1],
          });
        }
      }

      if (streamInfo.acodec) {
        streamInfo.acodecSupported = this._cSupport.audio[streamInfo.acodec];
      }
    }
  }

  get orderedStreams() {
    return this._orderedStreams;
  }
}
