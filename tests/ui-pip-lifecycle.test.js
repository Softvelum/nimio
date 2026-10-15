import { describe, it, expect, vi, afterEach } from "vitest";
import { UI } from "@/ui/ui";

// Document Picture-in-Picture: requestWindow() resolves asynchronously. If
// the UI was destroyed meanwhile, the completion must not move the player
// into the new window; it must close it and leave no observer behind.

const observers = [];
class FakeResizeObserver {
  constructor() {
    this.observe = vi.fn();
    this.disconnect = vi.fn();
    observers.push(this);
  }
}

function fakePipWindow() {
  return {
    document: { body: { style: {}, append: vi.fn() } },
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

function createPipUi() {
  const ui = Object.create(UI.prototype);
  ui._logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  ui._isPlayerFullscreen = () => false;
  ui._buttonPictureInPicture = {
    disabled: false,
    removeEventListener: vi.fn(),
  };
  ui._nativePip = false;
  ui._rendProps = { dWidth: 320, dHeight: 180 };
  ui._mode = "live";
  ui._canvas = document.createElement("canvas");
  ui._container = document.createElement("div");
  ui._container.appendChild(ui._canvas);
  ui._pipMessage = { style: {}, remove: vi.fn() };
  ui._clearMediaElementEvents = vi.fn();
  ui._updateLayout = vi.fn();
  ui._handleViewportUpdate = vi.fn();
  return ui;
}

describe("UI document PiP pending request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    observers.length = 0;
  });

  it("a window granted after destroy is closed and nothing is installed", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    let grant;
    const win = fakePipWindow();
    vi.stubGlobal("documentPictureInPicture", {
      window: null,
      requestWindow: () => new Promise((resolve) => (grant = resolve)),
    });
    const ui = createPipUi();

    const pending = ui._toggleDocumentPip();
    ui._cleanupPip(); // destroy() tears the PiP state down meanwhile
    grant(win);
    await pending;

    expect(win.close).toHaveBeenCalledTimes(1);
    expect(win.document.body.append).not.toHaveBeenCalled();
    expect(win.addEventListener).not.toHaveBeenCalled();
    expect(observers).toHaveLength(0);
    expect(ui._pipWindowFrame).toBeUndefined();
    expect(ui._canvas.parentNode).toBe(ui._container); // player not moved
  });

  it("a window granted while the UI is alive is used as before", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const win = fakePipWindow();
    vi.stubGlobal("documentPictureInPicture", {
      window: null,
      requestWindow: () => Promise.resolve(win),
    });
    const ui = createPipUi();

    await ui._toggleDocumentPip();

    expect(win.close).not.toHaveBeenCalled();
    expect(win.document.body.append).toHaveBeenCalledTimes(1);
    expect(ui._pipWindowFrame).toBe(win);
    expect(observers).toHaveLength(1);
  });
});

// Native PiP: requestPictureInPicture() resolves asynchronously too. A grant
// after the UI was torn down must exit the PiP window instead of leaving a
// detached video in it, and must not run the leave handling (which plays the
// element and arms a layout timer). Cleanup exits an active window itself.
function createNativePipUi() {
  const ui = createPipUi();
  let grant, reject;
  ui._mediaElement = {
    style: {},
    pause: vi.fn(),
    play: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    requestPictureInPicture: () =>
      new Promise((res, rej) => {
        grant = res;
        reject = rej;
      }),
  };
  ui._getFrameSizePip = (rect) => rect;
  ui._handleLeavePip = vi.fn();
  return { ui, grant: () => grant({}), reject: (e) => reject(e) };
}

function setPipElement(element) {
  Object.defineProperty(document, "pictureInPictureElement", {
    configurable: true,
    get: () => element,
  });
}

describe("UI native PiP pending request", () => {
  afterEach(() => {
    setPipElement(null);
    delete document.exitPictureInPicture;
  });

  it("a grant after cleanup exits PiP and skips the leave handling", async () => {
    const { ui, grant } = createNativePipUi();
    document.exitPictureInPicture = vi.fn(() => Promise.resolve());

    const pending = ui._toggieVideoPip();
    ui._cleanupPip();
    setPipElement(ui._mediaElement); // the browser entered PiP meanwhile
    document.exitPictureInPicture.mockClear();
    grant();
    await pending;

    expect(document.exitPictureInPicture).toHaveBeenCalledTimes(1);
    expect(ui._handleLeavePip).not.toHaveBeenCalled();
    expect(ui._mediaElement.play).not.toHaveBeenCalled();
  });

  it("a rejection after cleanup runs no leave handling", async () => {
    const { ui, reject } = createNativePipUi();

    const pending = ui._toggieVideoPip();
    ui._cleanupPip();
    reject(new Error("denied"));
    await pending;

    expect(ui._handleLeavePip).not.toHaveBeenCalled();
    expect(ui._logger.error).not.toHaveBeenCalled();
  });

  it("a grant while the UI is alive re-enables the button and exits nothing", async () => {
    const { ui, grant } = createNativePipUi();
    document.exitPictureInPicture = vi.fn(() => Promise.resolve());

    const pending = ui._toggieVideoPip();
    expect(ui._buttonPictureInPicture.disabled).toBe(true);
    grant();
    await pending;

    expect(ui._buttonPictureInPicture.disabled).toBe(false);
    expect(document.exitPictureInPicture).not.toHaveBeenCalled();
  });

  it("cleanup exits an active native PiP window", () => {
    const { ui } = createNativePipUi();
    setPipElement(ui._mediaElement);
    document.exitPictureInPicture = vi.fn(() => Promise.resolve());

    ui._cleanupPip();

    expect(document.exitPictureInPicture).toHaveBeenCalledTimes(1);
  });

  it("cleanup tolerates an exit rejection", async () => {
    const { ui } = createNativePipUi();
    setPipElement(ui._mediaElement);
    document.exitPictureInPicture = vi.fn(() =>
      Promise.reject(new Error("not in PiP")),
    );

    expect(() => ui._cleanupPip()).not.toThrow();
    await Promise.resolve(); // the rejection settles; nothing unhandled
    expect(ui._pipMessage).toBeUndefined(); // cleanup ran to its end
  });

  it("cleanup leaves another element's PiP window alone", () => {
    const { ui } = createNativePipUi();
    setPipElement({});
    document.exitPictureInPicture = vi.fn(() => Promise.resolve());

    ui._cleanupPip();

    expect(document.exitPictureInPicture).not.toHaveBeenCalled();
  });
});
