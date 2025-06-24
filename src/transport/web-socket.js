import { StateManager } from "../state-manager";
import { WEB } from "./data-types"

const CONN_CLOSE_CODES = {
  1000: 'CLOSE_NORMAL',
  1001: 'CLOSE_GOING_AWAY',
  1002: 'CLOSE_PROTOCOL_ERROR',
  1003: 'CLOSE_UNSUPPORTED',
  1005: 'CLOSE_NO_STATUS',
  1006: 'CLOSE_ABNORMAL',
  1007: 'Unsupported Data',
  1008: 'Policy Violation',
  1009: 'CLOSE_TOO_LARGE',
  1010: 'Missing Extension',
  1011: 'Internal Error',
  1012: 'Service Restart',
  1013: 'Try Again Later',
  1015: 'TLS Handshake',
};

let socket;

let streams = [];

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

function processStatus(e) {
  console.log("Command received", e.data);
  const status = JSON.parse(e.data);
  if (!status.info || status.info.length === 0 || !status.info[0].stream_info) {
    console.error("Invalid status received:", status);
    return;
  }

  const resolution = status.info[0].stream_info.resolution;
  const [width, height] = resolution.split("x").map(Number);

  streams = [];
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

  socket.send(
    JSON.stringify({
      command: "Play",
      streams: streams,
    }),
  );
}

let stateManager;
let curSocketId = 0;
self.onmessage = (e) => {
  var type = e.data.type;

  if (type === "initShared") {
    stateManager = new StateManager(e.data.sab);
  } else if (type === "initWebSocket") {
    startOffset = e.data.startOffset;

    socket = new WebSocket(e.data.url, e.data.protocols);
    socket.binaryType = "arraybuffer";
    socket.id = ++curSocketId;

    socket.onmessage = (wsEv) => {
      if (stateManager.isStopped()) return;

      if (wsEv.data instanceof ArrayBuffer) {
        processFrame(wsEv);
      } else {
        processStatus(wsEv);
      }
    };

    socket.onopen = () => {
      console.debug(`Connection established for socket id = ${this.id}`);
    };
    
    socket.onclose = (wsEv) => {
      let act = wsEv.wasClean ? 'closed' : 'dropped';
      console.debug(`Connection was ${act} for socket id ${this.id}`);
      let codeHuman = CONN_CLOSE_CODES[wsEv.code] || '';
      console.debug(
        `Close code ${wsEv.code} (${codeHuman}), reason: ${wsEv.reason}`
      );

      if (this.id === curSocketId) {
        // TODO: check if it's necessary verify readyState
        if( 3 === socket.readyState ) {
          socket = undefined;
        }
      }

      if (!wsEv.wasClean) {
        self.postMessage({
          type: 'disconnect'
        });
      }
    };

  } else if (type === "stop") {
    if (streams.length > 0) {
      socket.send(
        JSON.stringify({
          command: "Cancel",
          streams: streams.map((s) => s.sn),
        }),
      );
    }
    if (e.data.closeSocket) {
      socket.close();
    }
  }
};
