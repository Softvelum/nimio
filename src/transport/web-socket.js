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

let socket;
let curSocketId = 0;
self.onmessage = (e) => {
  var type = e.data.type;

  if (type === "init") {
    socket = new WebSocket(e.data.url, e.data.protocols);
    socket.binaryType = "arraybuffer";
    socket.id = ++curSocketId;

    socket.onmessage = (wsEv) => {
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
          streams: streams.map((s) => s.sn),
        }),
      );
    }
    if (e.data.close) {
      socket.close();
    }
  }
};
