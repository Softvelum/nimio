// All methods are safe no-ops once the player is destroyed (no event bus).
export const NimioEvents = {
  on(event, listener) {
    if (!this._eventBus) return;
    this._eventBus.runEventSubscriptionHook(event);
    return this._eventBus.addListener(event, listener);
  },

  once(event, listener) {
    if (!this._eventBus) return;
    this._eventBus.runEventSubscriptionHook(event);
    return this._eventBus.once(event, listener);
  },

  off(event, listener) {
    if (!this._eventBus) return;
    return this._eventBus.removeListener(event, listener);
  },

  removeAllListeners(event) {
    if (!this._eventBus) return;
    return this._eventBus.removeAllListeners(event);
  },

  listeners(event) {
    if (!this._eventBus) return [];
    return this._eventBus.listeners(event);
  },

  listenerCount(event) {
    if (!this._eventBus) return 0;
    return this._eventBus.listenerCount(event);
  },
};
