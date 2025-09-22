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
    this._timescale = {};
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

    let dataPos = 2;
    let timestamp;
    if (!IS_SEQUENCE_HEADER[frameType]) {
      timestamp = ByteReader.readUint(frameWithHeader, dataPos, 8);
      dataPos += 8;

      if (this._steady) {
        showTime = ByteReader.readUint(frameWithHeader, dataPos, 8);
        dataPos += 8;
      }
    }
    let timescale = this._timescale[trackId];
    if (!timescale) {
      console.warn(
        `Timescale for track ${trackId} not found, cannot process frame`,
      );
      return;
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
          trackId,
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
          this._sendCodecData(trackId, codecData, "audio", frameType);
        }
      case WEB.AAC_FRAME:
        tsSec = timestamp / (timescale / 1000);
        tsUs = Math.round(1000 * tsSec);
        this._sendAudioChunk(frameWithHeader, tsUs, dataPos, showTime);
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

        tsSec = (timestamp + compositionOffset) / (timescale / 1000);
        tsUs = Math.round(1000 * tsSec);
        // console.log(`V frame uts: ${tsUs}, pts: ${timestamp + compositionOffset}, dts: ${timestamp}, off: ${compositionOffset}`);
        this._sendVideoChunk(frameWithHeader, tsUs, isKey, dataPos, showTime);
        break;
      case WEB.VP8_KEY_FRAME:
      case WEB.VP9_KEY_FRAME:
        if (!this._codecDataStatus[trackId]) {
          this._codecDataStatus[trackId] = true;
          this._sendCodecData(trackId, null, "video", frameType);
        }
        isKey = true;
      case WEB.VP8_FRAME:
      case WEB.VP9_FRAME:
        tsSec = timestamp / (timescale / 1000);
        tsUs = Math.round(1000 * tsSec);
        this._sendVideoChunk(frameWithHeader, tsUs, isKey, dataPos, showTime);
        break;
      default:
        break;
    }
  }

  processStatus(msg) {
    console.debug("Command received", msg);
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

    self.postMessage({ type: "status", data: status.info });
    this._codecDataStatus = {};
  }

  handleMessage(type, data) {
    switch (type) {
      case "timescale":
        for (let tId in data) {
          this._timescale[tId] = data[tId];
        }
        break;
      case "removeTimescale":
        for (let i = 0; i < data.length; i++) {
          delete this._timescale[data[i]];
        }
        break;
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

  _sendCodecData(trackId, data, type, frameType) {
    self.postMessage({
      type: type === "video" ? "videoCodec" : "audioCodec",
      data: {
        trackId: trackId,
        data: data,
        family: CODEC_FAMILY_MAP[frameType],
      },
    });
  }

  _sendVideoChunk(frameWithHeader, tsUs, isKey, dataPos, showTime) {
    let payload = {
      trackId: frameWithHeader[0],
      timestamp: tsUs,
      chunkType: isKey ? "key" : "delta",
      frameWithHeader: frameWithHeader.buffer,
      framePos: dataPos,
    };
    if (showTime > 0) {
      payload.showTime = showTime;
    }

    self.postMessage(
      {
        type: "videoChunk",
        data: payload,
      },
      [frameWithHeader.buffer],
    );
  }

  _sendAudioChunk(frameWithHeader, tsUs, dataPos, showTime) {
    let payload = {
      trackId: frameWithHeader[0],
      timestamp: tsUs,
      frameWithHeader: frameWithHeader.buffer,
      framePos: dataPos,
    };
    if (showTime > 0) {
      payload.showTime = showTime;
    }

    self.postMessage(
      {
        type: "audioChunk",
        data: payload,
      },
      [frameWithHeader.buffer],
    );
  }
}
