import { createProtocolAgent } from "@/protocol-agent-factory";

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

function logbin(bin) {
  console.log(
    [...bin.slice(0, 32)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" "),
  );
}

let protocolAgent;

let socket;
let curSocketId = 0;
self.onmessage = (e) => {
  var type = e.data.type;

  if (type === "start") {
    socket = new WebSocket(e.data.url, e.data.protocols);
    socket.binaryType = "arraybuffer";
    socket.id = ++curSocketId;

    protocolAgent = createProtocolAgent(e.data.protocols[0]);
    protocolAgent.useSteady = e.data.steady;
    socket.onmessage = (wsEv) => {
      if (wsEv.data instanceof ArrayBuffer) {
        protocolAgent.processFrame(wsEv.data);
      } else {
        protocolAgent.processStatus(wsEv.data);
      }
    };

    socket.onopen = () => {
      console.debug(`Connection established for socket id = ${socket.id}`);
    };
    
    socket.onclose = (wsEv) => {
      console.debug(`Connection was dropped for socket id ${socket.id}`);
      let codeHuman = CONN_CLOSE_CODES[wsEv.code] || '';
      console.debug(
        `Close code ${wsEv.code} (${codeHuman}), reason: ${wsEv.reason}`
      );

      socket = undefined;
      self.postMessage({type: 'disconnect'});
    };
  } else if (type === "play") {
    socket.send(
      JSON.stringify({
        command: "Play",
        streams: e.data.streams,
      }),
    );
  } else if (type === "stop") {
    if (streams.length > 0) {
      socket.send(
        JSON.stringify({
          command: "Cancel",
          streams: e.data.sns,
        }),
      );
    }
    if (e.data.close) {
      console.debug(`Close connection for socket id ${socket.id}`);
      socket.onclose = undefined;
      socket.close();
      socket = undefined;
    }
  } else {
    if (protocolAgent) protocolAgent.handleMessage(type, e.data);
  }

};
