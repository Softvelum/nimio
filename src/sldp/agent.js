import { WEB } from "./data-types"

export class SLDPAgent {
  constructor() {
    this._streams = [];
    this._timescale = {
      audio: null,
      video: null,
    };
    this._steady = false;
    this._startOffset = 0;

    this._transport = transport;
  }

  _processFrame(event) {
    let frameWithHeader = new Uint8Array(event.data);
    let trackId = frameWithHeader[0];
    let frameType = frameWithHeader[1];
    let showTime = 0;
    let dataPos = 10;
    let frameSize = frameWithHeader.byteLength;
    let timestamp;
  
    let tsSec,
      tsUs,
      isKey = false;
    switch (frameType) {
      case WEB.AAC_SEQUENCE_HEADER:
      case WEB.AVC_SEQUENCE_HEADER:
      case WEB.HEVC_SEQUENCE_HEADER:
      case WEB.AV1_SEQUENCE_HEADER:
        let codecData = frameWithHeader.subarray(2, frameSize);
        let type =
          frameType === WEB.AAC_SEQUENCE_HEADER
            ? "audioCodecData"
            : "videoCodecData";
        self.postMessage({ type: type, codecData: codecData });
        break;
      case WEB.MP3:
      case WEB.OPUS_FRAME:
      case WEB.AAC_FRAME:
        timestamp = ByteReader.readUint(frameWithHeader, 2, 8);
  
        if (steady) {
          showTime = ByteReader.readUint(frameWithHeader, dataPos, 8);
          dataPos += 8;
        }
  
        tsSec = timestamp / (timescale.audio / 1000);
        tsUs = 1000 * tsSec;
  
        self.postMessage({
          type: "audioChunk",
          timestamp: tsUs,
          frameWithHeader: frameWithHeader.buffer,
          framePos: dataPos,
        });
        break;
      case WEB.AVC_KEY_FRAME:
      case WEB.HEVC_KEY_FRAME:
      case WEB.AV1_KEY_FRAME:
        isKey = true;
      case WEB.AVC_FRAME:
      case WEB.HEVC_FRAME:
      case WEB.AV1_FRAME:
        timestamp = ByteReader.readUint(frameWithHeader, 2, 8);
  
        if (steady) {
          showTime = ByteReader.readUint(frameWithHeader, dataPos, 8);
          dataPos += 8;
        }
  
        let compositionOffset = 0;
        if (frameType !== WEB.AV1_KEY_FRAME && frameType !== WEB.AV1_FRAME) {
          compositionOffset = ByteReader.readUint(frameWithHeader, dataPos, 4);
          dataPos += 4;
        }

        tsSec = (timestamp + compositionOffset) / (timescale.video / 1000);
        tsUs = 1000 * tsSec;
  
        self.postMessage(
          {
            type: "videoChunk",
            timestamp: tsUs,
            chunkType: isKey ? "key" : "delta",
            frameWithHeader: frameWithHeader.buffer,
            framePos: dataPos,
          },
          [frameWithHeader.buffer],
        );
        break;
      default:
        break;
    }
  }

  _processStatus(e) {
    console.log("Command received", e.data);
    const status = JSON.parse(e.data);
    if (!status.info || status.info.length === 0 || !status.info[0].stream_info) {
      console.error("Invalid status received:", status);
      return;
    }

    const resolution = status.info[0].stream_info.resolution;
    const [width, height] = resolution.split("x").map(Number);

    let vconfig = null;
    if (status.info[0].stream_info.vcodec) {
      vconfig = {
        width: width,
        height: height,
        codec: status.info[0].stream_info.vcodec,
      };
      timescale.video = +status.info[0].stream_info.vtimescale;

      streams.push({
        type: "video",
        offset: `${startOffset}`,
        steady: steady,
        stream: status.info[0].stream,
        sn: 0,
      });
    }
    self.postMessage({
      type: "videoConfig",
      videoConfig: vconfig,
    });

    let aconfig = null;
    if (status.info[0].stream_info.acodec) {
      aconfig = { codec: status.info[0].stream_info.acodec };
      timescale.audio = +status.info[0].stream_info.atimescale;
      streams.push({
        type: "audio",
        offset: `${startOffset}`,
        steady: steady,
        stream: status.info[0].stream,
        sn: 1,
      });
    }
    self.postMessage({
      type: "audioConfig",
      audioConfig: aconfig,
    });
  }
}
