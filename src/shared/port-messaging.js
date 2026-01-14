export const PortMessaging = {
  setPort(port) {
    if (this._port === port) return;
    if (this._port) this._detachPort();

    this._attachPort(port);

    if (this._pendingMessages.length > 0) {
      for (let i = 0, n = this._pendingMessages.length; i < n; i++) {
        this._postMessage(
          this._pendingMessages[i].data,
          this._pendingMessages[i].transfer,
        );
      }
      this._pendingMessages.length = 0;
    }
  },

  _initMessaging() {
    this._pendingMessages = [];
  },

  _resetMessaging() {
    this._pendingMessages.length = 0;
    this._detachPort();
  },

  _attachPort(port) {
    this._port = port;
    if (this._handlePortMessage) {
      this._portEvHandler = this._handlePortMessage.bind(this);
      this._port.addEventListener("message", this._portEvHandler);
      if (this._port?.start) this._port.start();
    }
  },

  _detachPort() {
    if (this._portEvHandler) {
      this._port.removeEventListener("message", this._portEvHandler);
      this._portEvHandler = undefined;
    }
    this._port = undefined;
  },

  _sendMessage(data, transfer = []) {
    if (!this._port) {
      this._pendingMessages.push({ data, transfer });
      return;
    }
    this._postMessage(data, transfer);
  },

  _postMessage(data, transfer) {
    if (!this._port) return;

    try {
      this._port.postMessage(data, transfer);
    } catch (e) {
      // If posting fails, keep the message to retry later.
      this._pendingMessages.push({ data, transfer });
    }
  },
};
