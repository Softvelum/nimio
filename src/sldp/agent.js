import { WEB } from "./data-types"
import { ByteReader } from "@/shared/byte-reader";
import { RingBuffer } from "@/shared/ring-buffer";
import { SharedTransportBuffer } from "@/media/buffers/shared-transport-buffer";

export class SLDPAgent {
  constructor() {
    this._timescale = {
      audio: null,
      video: null,
    };
    this._useSteady = false;
    this._steady = false;
  }

  processFrame(data) {
    let frameWithHeader = new Uint8Array(data);
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
        self.postMessage({
          type: frameType === WEB.AAC_SEQUENCE_HEADER ? "audioCodec" : "videoCodec",
          data: frameWithHeader.subarray(2, frameSize),
        });
        break;
      case WEB.MP3:
      case WEB.OPUS_FRAME:
      case WEB.AAC_FRAME:
        timestamp = ByteReader.readUint(frameWithHeader, 2, 8);
  
        if (this._steady) {
          showTime = ByteReader.readUint(frameWithHeader, dataPos, 8);
          dataPos += 8;
        }
  
        tsSec = timestamp / (this._timescale.audio / 1000);
        tsUs = Math.round(1000 * tsSec);
  
        if (!this._aTransBuffer) {
          this._stashFrame("audio", frameWithHeader, dataPos, frameSize, tsUs);
        } else {
          if (this._aTempBuffer.length > 0) {
            this._unstashFrames("audio");
          }
          if (this._aTempBuffer.length === 0) {
            // console.log('audio frame', tsUs, frameSize);
            this._aTransBuffer.write(frameWithHeader.subarray(dataPos, frameSize), tsUs);
          } else {
            this._stashFrame("audio", frameWithHeader, dataPos, frameSize, tsUs);
          }
        }

        // self.postMessage({
        //   type: "audioChunk",
        //   data: {
        //     timestamp: tsUs,
        //     frameWithHeader: frameWithHeader.buffer,
        //     framePos: dataPos,
        //   }
        // });
        break;
      case WEB.AVC_KEY_FRAME:
      case WEB.HEVC_KEY_FRAME:
      case WEB.AV1_KEY_FRAME:
        isKey = true;
      case WEB.AVC_FRAME:
      case WEB.HEVC_FRAME:
      case WEB.AV1_FRAME:
        timestamp = ByteReader.readUint(frameWithHeader, 2, 8);
  
        if (this._steady) {
          showTime = ByteReader.readUint(frameWithHeader, dataPos, 8);
          dataPos += 8;
        }
  
        let compositionOffset = 0;
        if (frameType !== WEB.AV1_KEY_FRAME && frameType !== WEB.AV1_FRAME) {
          compositionOffset = ByteReader.readUint(frameWithHeader, dataPos, 4);
          dataPos += 4;
        }

        tsSec = (timestamp + compositionOffset) / (this._timescale.video / 1000);
        tsUs = Math.round(1000 * tsSec);

        let key = isKey ? 1 : 0;
        if (!this._vTransBuffer) {
          this._stashFrame("video", frameWithHeader, dataPos, frameSize, tsUs, key);
        } else {
          if (this._vTempBuffer.length > 0) {
            this._unstashFrames("video");
          }
          if (this._vTempBuffer.length === 0) {
            this._vTransBuffer.write(frameWithHeader.subarray(dataPos, frameSize), tsUs, key);
          } else {
            this._stashFrame("video", frameWithHeader, dataPos, frameSize, tsUs, key);
          }
        }

        // self.postMessage(
        //   {
        //     type: "videoChunk",
        //     data: {
        //       timestamp: tsUs,
        //       chunkType: isKey ? "key" : "delta",
        //       frameWithHeader: frameWithHeader.buffer,
        //       framePos: dataPos,
        //     }
        //   },
        //   [frameWithHeader.buffer],
        // );
        break;
      default:
        break;
    }
  }

  processStatus(msg) {
    console.log("Command received", msg);
    const status = JSON.parse(msg);
    if (!status.info || status.info.length === 0 || !status.info[0].stream_info) {
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
      this._vTempBuffer = new RingBuffer("SLDP agent video", 1000);
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
      this._aTempBuffer = new RingBuffer("SLDP agent audio", 3000);
    }

    self.postMessage({
      type: "audioConfig",
      data: aconfig,
    });

    self.postMessage({
      type: "status",
      data: streams,
    });
  }

  handleMessage(type, data) {
    let bufName;
    switch (type) {
      case "videoBuffer":
      case "audioBuffer":
        bufName = type === "videoBuffer" ? "_vTransBuffer" : "_aTransBuffer";
        this[bufName] = new SharedTransportBuffer(...data.buffer);
        break;
      default:
        console.warn("Unknown message type:", type);
        break;
    }
  }

  get useSteady() {
    return this._useSteady;
  }

  set useSteady(value) {
    this._useSteady = value;
  }

  _stashFrame(type, frameWithHeader, dataPos, frameSize, tsUs, key) {
    let bufName = type === "video" ? "_vTempBuffer" : "_aTempBuffer";
    this[bufName].push({
      ts: tsUs,
      frame: frameWithHeader.subarray(dataPos, frameSize),
      key: key,
    }, true);
  }

  _unstashFrames(type) {
    let tempBuf, transBuf;
    if (type === "video") {
      tempBuf = this._vTempBuffer;
      transBuf = this._vTransBuffer;
    } else {
      tempBuf = this._aTempBuffer;
      transBuf = this._aTransBuffer;
    }
    
    while (tempBuf.length > 0) {
      let frame = tempBuf.get(0);
      if (!transBuf.write(frame.frame, frame.ts, frame.key)) {
        break;
      }
      tempBuf.skip();
    }
  }
}
