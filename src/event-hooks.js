export const EventHooks = {
  onListenerAdded(event, handler) {
    this._eventSubscriptionHooks = this._eventSubscriptionHooks || {};
    this._eventSubscriptionHooks[event] = handler;
    if (this.hasListeners(event)) {
      handler();
    }
  },

  runEventSubscriptionHook(event) {
    if (!this._eventSubscriptionHooks) return;
    if (this._eventSubscriptionHooks[event]) {
      this._eventSubscriptionHooks[event]();
    }
  },
};
