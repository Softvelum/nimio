import { createProtocolAgent } from "@/protocol-agent-factory";

const CONN_CLOSE_CODES = {
  1000: "CLOSE_NORMAL",
  1001: "CLOSE_GOING_AWAY",
  1002: "CLOSE_PROTOCOL_ERROR",
  1003: "CLOSE_UNSUPPORTED",
  1005: "CLOSE_NO_STATUS",
  1006: "CLOSE_ABNORMAL",
  1007: "Unsupported Data",
  1008: "Policy Violation",
  1009: "CLOSE_TOO_LARGE",
  1010: "Missing Extension",
  1011: "Internal Error",
  1012: "Service Restart",
  1013: "Try Again Later",
  1015: "TLS Handshake",
};

// Value     State         Description
//   0     CONNECTING   Socket has been created. The connection is not yet open.
//   1     OPEN         The connection is open and ready to communicate.
//   2     CLOSING      The connection is in the process of closing.
//   3     CLOSED       The connection is closed or couldn't be opened.
const CONN_STATES = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
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

function closeSocket() {
  console.debug(`Close connection for socket id ${socket.id}`);
  // open/message delivery is task-queued: a queued event of this socket may
  // still run after it was replaced and must not act for the new one
  socket.onopen = undefined;
  socket.onclose = undefined;
  socket.onmessage = undefined;
  socket.close();
  socket = undefined;
  self.postMessage({ aux: true, connected: false });
}

self.onmessage = (e) => {
  let type = e.data.type;

  if (type === "start") {
    // TODO: check possibility to reuse socket after pause auto stop
    // if (socket && socket.readyState === CONN_STATES.OPEN) {
    //   return;
    // }
    // A start while the previous socket is still live must not orphan it:
    // the server would keep that session open and its frames would go to
    // the new protocol agent.
    if (socket) closeSocket();

    const ws = new WebSocket(e.data.url, e.data.protocols);
    ws.binaryType = "arraybuffer";
    ws.id = ++curSocketId;
    socket = ws;

    protocolAgent = createProtocolAgent(e.data.protocols[0]);
    protocolAgent.syncMode = e.data.syncMode;

    // Handlers act only while `ws` is still the current socket: open/message
    // delivery is task-queued, so an event of a replaced socket may run after
    // the replacement and must not report or feed the new connection.
    ws.onmessage = (wsEv) => {
      if (ws !== socket) return;
      if (wsEv.data instanceof ArrayBuffer) {
        protocolAgent.processFrame(wsEv.data);
      } else {
        protocolAgent.processStatus(wsEv.data);
      }
    };

    ws.onopen = () => {
      if (ws !== socket) return;
      console.debug(`Connection established for socket id = ${ws.id}`);
      self.postMessage({ aux: true, connected: true });
    };

    ws.onclose = (wsEv) => {
      console.debug(`Connection was dropped for socket id ${wsEv.target.id}`);
      let codeHuman = CONN_CLOSE_CODES[wsEv.code] || "";
      console.debug(
        `Close code ${wsEv.code} (${codeHuman}), reason: ${wsEv.reason}`,
      );

      if (wsEv.target.id === curSocketId) {
        socket = undefined;
        self.postMessage({ type: "disconnect", data: { code: codeHuman } });
        self.postMessage({ aux: true, connected: false });
      }
    };
    return;
  }

  if (!socket && ["play", "stop"].includes(type)) {
    console.warn(`Attempt to send ${type} command via closed socket`);
    return;
  }

  if (type === "play") {
    socket.send(
      JSON.stringify({
        command: "Play",
        streams: e.data.streams,
      }),
    );
  } else if (type === "stop") {
    const sns = e.data.sns;
    // An empty Cancel right before close is a no-op, so skip it: a closing
    // stop may arrive while the socket is still CONNECTING, where send()
    // throws and close() would never be reached. The readyState guard
    // covers the same race for a non-empty Cancel.
    const sendCancel = Array.isArray(sns) && (sns.length > 0 || !e.data.close);
    if (sendCancel && socket.readyState === CONN_STATES.OPEN) {
      socket.send(
        JSON.stringify({
          command: "Cancel",
          streams: sns,
        }),
      );
    }
    if (e.data.close) closeSocket();
  } else {
    if (protocolAgent) protocolAgent.handleMessage(type, e.data);
  }
};
