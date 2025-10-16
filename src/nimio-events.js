export const NimioEvents = {
  on(event, listener) {
    return this._eventBus.addListener(event, listener);
  },

  once(event, listener) {
    return this._eventBus.once(event, listener);
  },

  off(event, listener) {
    return this._eventBus.removeListener(event, listener);
  },

  removeAllListeners(event) {
    return this._eventBus.removeAllListeners(event);
  },

  listeners(event) {
    return this._eventBus.listeners(event);
  },

  listenerCount(event) {
    return this._eventBus.listenerCount(event);
  },
};
