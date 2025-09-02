export const EventMixin = {
  _initEventTarget() {
    if (!this._eventTarget) {
      this._eventTarget = new EventTarget();
    }
  },

  addEventListener(...args) {
    this._initEventTarget();
    this._eventTarget.addEventListener(...args);
  },

  removeEventListener(...args) {
    this._initEventTarget();
    this._eventTarget.removeEventListener(...args);
  },

  dispatchEvent(...args) {
    this._initEventTarget();
    return this._eventTarget.dispatchEvent(...args);
  },
};
