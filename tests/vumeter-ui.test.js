import { describe, it, expect, vi, afterEach } from "vitest";
import { VUMeterUI } from "@/vumeter/ui";

// The meter UI animates with requestAnimationFrame while _fullValue is set.
// destroy() must stop that loop even when the host already tore the
// generated elements out of the DOM.

describe("VUMeterUI.destroy()", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  function createMeter() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const ui = new VUMeterUI(container, 60);
    ui.create(2);
    return { container, ui };
  }

  it("stops the animation loop even when the host already removed the meter's children", () => {
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    const { container, ui } = createMeter();
    const gen = ui._drawGen;
    ui._drawMeter(gen);
    expect(raf).toHaveBeenCalled(); // the loop is running

    container.querySelector("*").innerHTML = ""; // host cleared the inner DOM
    expect(() => ui.destroy(true)).not.toThrow();

    raf.mockClear();
    ui._drawMeter(gen); // a frame that was already scheduled fires
    expect(raf).not.toHaveBeenCalled();
    expect(container.childElementCount).toBe(0);
  });

  it("tolerates a meter element the host already removed from the container", () => {
    const { container, ui } = createMeter();
    container.innerHTML = "";

    expect(() => ui.destroy(true)).not.toThrow();
  });
});

describe("VUMeterUI.refresh()", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("with a changed size leaves one animation loop running", () => {
    const frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb) => frames.push(cb));
    const container = document.createElement("div");
    let width = 100;
    Object.defineProperty(container, "clientWidth", { get: () => width });
    Object.defineProperty(container, "clientHeight", { get: () => 40 });
    document.body.appendChild(container);
    const ui = new VUMeterUI(container, 60);
    ui.create(2);
    expect(frames).toHaveLength(1); // the first loop is running

    width = 200;
    ui.refresh(2); // destroy(true) + create(): the old loop's frame is still queued

    // fire every queued frame once: only the current loop may continue
    const queued = frames.splice(0);
    queued.forEach((cb) => cb());
    expect(frames).toHaveLength(1);
  });
});
