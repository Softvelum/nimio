import { WEB, CODEC_FAMILY_MAP } from "./data-types";
import { ByteReader } from "@/shared/byte-reader";

const IS_SEQUENCE_HEADER = [
  WEB.AAC_SEQUENCE_HEADER,
  WEB.AVC_SEQUENCE_HEADER,
  WEB.HEVC_SEQUENCE_HEADER,
  WEB.AV1_SEQUENCE_HEADER,
].reduce((o, v) => ((o[v] = true), o), {});

export class SLDPAgent {
  constructor() {
    this._timescale = {
      audio: null,
      video: null,
    };
    this._useSteady = false;
    this._steady = false;
    this._codecDataStatus = {};
  }

  processFrame(data) {
    let frameWithHeader = new Uint8Array(data);
    let trackId = frameWithHeader[0];
    let frameType = frameWithHeader[1];
    let showTime = 0;
    let frameSize = frameWithHeader.byteLength;

    let timestamp;
    let dataPos = 2;
    if (!IS_SEQUENCE_HEADER[frameType]) {
      timestamp = ByteReader.readUint(frameWithHeader, dataPos, 8);
      dataPos += 8;

      if (this._steady) {
        showTime = ByteReader.readUint(frameWithHeader, dataPos, 8);
        dataPos += 8;
      }
    }

    let tsSec;
    let tsUs;
    let isKey = false;
    switch (frameType) {
      case WEB.AAC_SEQUENCE_HEADER:
      case WEB.AVC_SEQUENCE_HEADER:
      case WEB.HEVC_SEQUENCE_HEADER:
      case WEB.AV1_SEQUENCE_HEADER:
        this._sendCodecData(
          frameWithHeader.subarray(dataPos, frameSize),
          frameType === WEB.AAC_SEQUENCE_HEADER ? "audio" : "video",
          frameType,
        );
        break;
      case WEB.MP3:
      case WEB.OPUS_FRAME:
        if (!this._codecDataStatus[trackId]) {
          let codecData = frameWithHeader.subarray(dataPos, dataPos + 4);
          this._codecDataStatus[trackId] = true;
          this._sendCodecData(codecData, "audio", frameType);
        }
      case WEB.AAC_FRAME:
        tsSec = timestamp / (this._timescale.audio / 1000);
        tsUs = Math.round(1000 * tsSec);
        this._sendAudioFrame(frameWithHeader, tsUs, dataPos);
        break;
      case WEB.AVC_KEY_FRAME:
      case WEB.HEVC_KEY_FRAME:
      case WEB.AV1_KEY_FRAME:
        isKey = true;
      case WEB.AVC_FRAME:
      case WEB.HEVC_FRAME:
      case WEB.AV1_FRAME:
        let compositionOffset = 0;
        if (frameType !== WEB.AV1_KEY_FRAME && frameType !== WEB.AV1_FRAME) {
          compositionOffset = ByteReader.readUint(frameWithHeader, dataPos, 4);
          dataPos += 4;
        }

        tsSec =
          (timestamp + compositionOffset) / (this._timescale.video / 1000);
        tsUs = Math.round(1000 * tsSec);
        this._sendVideoFrame(frameWithHeader, tsUs, isKey, dataPos);
        break;
      case WEB.VP8_KEY_FRAME:
      case WEB.VP9_KEY_FRAME:
        if (!this._codecDataStatus[trackId]) {
          this._codecDataStatus[trackId] = true;
          this._sendCodecData(null, "video", frameType);
        }
        isKey = true;
      case WEB.VP8_FRAME:
      case WEB.VP9_FRAME:
        tsSec = timestamp / (this._timescale.video / 1000);
        tsUs = Math.round(1000 * tsSec);
        this._sendVideoFrame(frameWithHeader, tsUs, isKey, dataPos);
        break;
      default:
        break;
    }
  }

  processStatus(msg) {
    console.log("Command received", msg);
    const status = JSON.parse(msg);
    if (
      !status.info ||
      status.info.length === 0 ||
      !status.info[0].stream_info
    ) {
      console.error("Invalid status received:", status);
      return;
    }

    if (this._useSteady) {
      this._steady = !!status.steady;
    }

    // TODO: move all this logic to the manager
    const resolution = status.info[0].stream_info.resolution;
    const [width, height] = resolution.split("x").map(Number);

    let streams = [];
    let vconfig = null;
    if (status.info[0].stream_info.vcodec) {
      vconfig = {
        width: width,
        height: height,
        codec: status.info[0].stream_info.vcodec,
      };
      this._timescale.video = +status.info[0].stream_info.vtimescale;

      streams.push({
        type: "video",
        steady: this._steady,
        stream: status.info[0].stream,
        sn: 0,
      });
    }
    self.postMessage({
      type: "videoConfig",
      data: vconfig,
    });

    let aconfig = null;
    if (status.info[0].stream_info.acodec) {
      aconfig = { codec: status.info[0].stream_info.acodec };
      this._timescale.audio = +status.info[0].stream_info.atimescale;
      streams.push({
        type: "audio",
        steady: this._steady,
        stream: status.info[0].stream,
        sn: 1,
      });
    }

    self.postMessage({
      type: "audioConfig",
      data: aconfig,
    });

    self.postMessage({
      type: "status",
      data: streams,
    });

    this._codecDataStatus = {};
  }

  handleMessage(type, data) {
    switch (type) {
      default:
        console.warn("Unknown message type:", type, data);
        break;
    }
  }

  get useSteady() {
    return this._useSteady;
  }

  set useSteady(value) {
    this._useSteady = value;
  }

  _sendCodecData(data, type, frameType) {
    self.postMessage({
      type: type === "video" ? "videoCodec" : "audioCodec",
      data: {
        data: data,
        family: CODEC_FAMILY_MAP[frameType],
      },
    });
  }

  _sendVideoFrame(frameWithHeader, tsUs, isKey, dataPos) {
    self.postMessage(
      {
        type: "videoChunk",
        data: {
          timestamp: tsUs,
          chunkType: isKey ? "key" : "delta",
          frameWithHeader: frameWithHeader.buffer,
          framePos: dataPos,
        },
      },
      [frameWithHeader.buffer],
    );
  }

  _sendAudioFrame(frameWithHeader, tsUs, dataPos) {
    self.postMessage(
      {
        type: "audioChunk",
        data: {
          timestamp: tsUs,
          frameWithHeader: frameWithHeader.buffer,
          framePos: dataPos,
        },
      },
      [frameWithHeader.buffer],
    );
  }
}
