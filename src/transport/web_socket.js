import { StateManager } from "../state_manager.js";

const WEB_AAC_SEQUENCE_HEADER = 0;
const WEB_AAC_FRAME = 1;
const WEB_AVC_SEQUENCE_HEADER = 2;
const WEB_AVC_KEY_FRAME = 3;
const WEB_AVC_FRAME = 4;
const WEB_HEVC_SEQUENCE_HEADER = 5;
const WEB_HEVC_KEY_FRAME = 6;
const WEB_HEVC_FRAME = 7;
const WEB_VP6_KEY_FRAME = 8;
const WEB_VP6_FRAME = 9;
const WEB_VP8_KEY_FRAME = 10;
const WEB_VP8_FRAME = 11;
const WEB_VP9_KEY_FRAME = 12;
const WEB_VP9_FRAME = 13;
const WEB_MP3 = 14;
const WEB_OPUS_FRAME = 15;
const WEB_AV1_SEQUENCE_HEADER = 16;
const WEB_AV1_KEY_FRAME = 17;
const WEB_AV1_FRAME = 18;

let socket = null;

let timescale = {
  audio: null,
  video: null,
};

let steady = false;

let startOffset = 0;

function logbin(bin) {
  console.log(
    [...bin.slice(0, 32)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" "),
  );
}

function readInt(buffer, offset, length) {
  if (length === 4) {
    // Read a 32-bit unsigned int (big-endian)
    return (
      ((buffer[offset] << 24) |
        (buffer[offset + 1] << 16) |
        (buffer[offset + 2] << 8) |
        buffer[offset + 3]) >>>
      0
    ); // Ensure unsigned 32-bit
  } else if (length === 8) {
    // Read a 64-bit unsigned int (big-endian)
    const high =
      ((buffer[offset] << 24) |
        (buffer[offset + 1] << 16) |
        (buffer[offset + 2] << 8) |
        buffer[offset + 3]) >>>
      0; // High part (32 bit)
    const low =
      ((buffer[offset + 4] << 24) |
        (buffer[offset + 5] << 16) |
        (buffer[offset + 6] << 8) |
        buffer[offset + 7]) >>>
      0; // Low part (32 bit)
    // Mask high part to fit within 53-bit safe integer range
    const maskedHigh = high & 0x001fffff;
    // Combine high and low parts
    return maskedHigh * 2 ** 32 + low;
  } else {
    console.error("Unsupported length!");
    return null;
  }
}

function processFrame(event) {
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
    case WEB_AAC_SEQUENCE_HEADER:
    case WEB_AVC_SEQUENCE_HEADER:
    case WEB_HEVC_SEQUENCE_HEADER:
    case WEB_AV1_SEQUENCE_HEADER:
      let codecData = frameWithHeader.subarray(2, frameSize);
      let type =
        frameType === WEB_AAC_SEQUENCE_HEADER
          ? "audioCodecData"
          : "videoCodecData";
      self.postMessage({ type: type, codecData: codecData });
      break;
    case WEB_AAC_FRAME:
      timestamp = readInt(frameWithHeader, 2, 8);

      if (steady) {
        showTime = readInt(frameWithHeader, dataPos, 8);
        dataPos += 8;
      }

      tsSec = timestamp / timescale.audio;
      tsUs = 1_000_000 * tsSec;

      self.postMessage({
        type: "audioChunk",
        timestamp: tsUs,
        frameWithHeader: frameWithHeader.buffer,
        framePos: dataPos,
      });
      break;
    case WEB_AVC_KEY_FRAME:
    case WEB_HEVC_KEY_FRAME:
    case WEB_AV1_KEY_FRAME:
      isKey = true;
    case WEB_AVC_FRAME:
    case WEB_HEVC_FRAME:
    case WEB_AV1_FRAME:
      timestamp = readInt(frameWithHeader, 2, 8);

      if (steady) {
        showTime = readInt(frameWithHeader, dataPos, 8);
        dataPos += 8;
      }

      let compositionOffset = 0;
      if (frameType !== WEB_AV1_KEY_FRAME && frameType !== WEB_AV1_FRAME) {
        compositionOffset = readInt(frameWithHeader, dataPos, 4);
        dataPos += 4;
      }

      tsSec = (timestamp + compositionOffset) / timescale.video;
      tsUs = 1_000_000 * tsSec;

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

function processStatus(e) {
  console.debug("Command received", e.data);
  const status = JSON.parse(e.data);
  const resolution = status.info[0].stream_info.resolution;
  const [width, height] = resolution.split("x").map(Number);
  const videoConfig = {
    width: width,
    height: height,
    codec: status.info[0].stream_info.vcodec,
  };
  const audioConfig = {
    codec: status.info[0].stream_info.acodec,
  };

  timescale.video = +status.info[0].stream_info.vtimescale;
  timescale.audio = +status.info[0].stream_info.atimescale;

  const streamName = status.info[0].stream;

  self.postMessage({ type: "videoConfig", videoConfig: videoConfig });
  self.postMessage({ type: "audioConfig", audioConfig: audioConfig });

  socket.send(
    JSON.stringify({
      command: "Play",
      streams: [
        {
          type: "video",
          offset: `${startOffset}`,
          steady: steady,
          stream: streamName,
          sn: 0,
        },
        {
          type: "audio",
          offset: `${startOffset}`,
          steady: steady,
          stream: streamName,
          sn: 1,
        },
      ],
    }),
  );
}

let stateManager;

self.onmessage = (e) => {
  var type = e.data.type;

  if (type === "initShared") {
    stateManager = new StateManager(e.data.sab);
  } else if (type === "initWebSocket") {
    startOffset = e.data.startOffset;

    socket = new WebSocket(e.data.url, e.data.protocols);

    socket.binaryType = "arraybuffer";

    socket.onmessage = (ws_event) => {
      if (stateManager.isStopped()) return;

      if (ws_event.data instanceof ArrayBuffer) {
        processFrame(ws_event);
      } else {
        processStatus(ws_event);
      }
    };
  } else if (type === "stop") {
    socket.send(
      JSON.stringify({
        command: "Cancel",
        streams: [0, 1], // TODO: correct stream IDs
      }),
    );
  }
};
