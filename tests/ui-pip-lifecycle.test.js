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
