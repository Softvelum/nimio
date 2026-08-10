import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  containerHeightIndependent,
  whenOutputTransitionsSettled,
} from "@/ui/height-probe";

// Exercises the production probe against a real layout engine. The
// probe flips the existing output element's inline height and checks
// whether the container's height follows - measuring the feedback
// loop itself, with no inserted element. That makes it immune to the
// vectors that broke element-insertion probes: pseudo-element rules on
// empty children, and structural selectors (:empty, :has, :nth-child)
// reacting to a temporary child.
const HOSTILE_CSS = `
  .hostile-pseudo > div:empty::before {
    content: "";
    display: block;
    height: 40px;
  }
  .hostile-has:has(> :nth-child(2)) {
    height: 300px;
  }
  .hostile-transition canvas {
    transition: height 1s linear;
  }
  .revert-target {
    height: 300px;
  }
`;

describe("containerHeightIndependent", () => {
  let root;
  let styleTag;

  beforeEach(() => {
    styleTag = document.createElement("style");
    styleTag.textContent = HOSTILE_CSS;
    document.head.appendChild(styleTag);
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    styleTag.remove();
  });

  // Builds the production DOM shape: a parent (host page), the nimio
  // container with the configured css height inline, and a canvas
  // output inside it.
  function build({
    parentCss,
    height,
    ancestorCss,
    parentClass,
    vars,
    containerClass,
  }) {
    let mount = root;
    if (ancestorCss !== undefined) {
      const ancestor = document.createElement("div");
      ancestor.style.cssText = ancestorCss;
      root.appendChild(ancestor);
      mount = ancestor;
    }
    const parent = document.createElement("div");
    parent.style.cssText = parentCss;
    if (parentClass) parent.className = parentClass;
    for (const [name, value] of Object.entries(vars ?? {})) {
      parent.style.setProperty(name, value);
    }
    mount.appendChild(parent);

    const container = document.createElement("div");
    if (containerClass) container.className = containerClass;
    Object.assign(container.style, {
      display: "block",
      position: "relative",
      width: "100%",
      height,
    });
    parent.appendChild(container);

    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    Object.assign(canvas.style, {
      display: "block",
      width: "100%",
      height: "100%",
    });
    container.appendChild(canvas);

    return { parent, container, canvas };
  }

  const CASES = [
    [
      "100% in a heightless block parent",
      { parentCss: "display:block", height: "100%" },
      false,
    ],
    [
      "100% in a 300px block parent",
      { parentCss: "display:block;height:300px", height: "100%" },
      true,
    ],
    [
      "100% of 100% of a heightless ancestor",
      {
        parentCss: "display:block;height:100%",
        ancestorCss: "display:block",
        height: "100%",
      },
      false,
    ],
    [
      "100% of 100% of a 300px ancestor",
      {
        parentCss: "display:block;height:100%",
        ancestorCss: "display:block;height:300px",
        height: "100%",
      },
      true,
    ],
    [
      "100% in a heightless flex row parent",
      { parentCss: "display:flex;flex-direction:row", height: "100%" },
      false,
    ],
    [
      "100% in a 300px flex row parent",
      {
        parentCss:
          "display:flex;flex-direction:row;height:300px;align-items:flex-start",
        height: "100%",
      },
      true,
    ],
    [
      "100% in a heightless flex column parent",
      { parentCss: "display:flex;flex-direction:column", height: "100%" },
      false,
    ],
    [
      "100% in a 300px flex column parent",
      {
        parentCss: "display:flex;flex-direction:column;height:300px",
        height: "100%",
      },
      true,
    ],
    [
      "100% in a heightless grid parent",
      { parentCss: "display:grid", height: "100%" },
      false,
    ],
    // An implicit auto row is stretched to the grid's 300px only while
    // the content fits; a larger output grows the row, so the feedback
    // loop is real and "content-sized" is the safe, correct verdict
    // (the old parent probe called this definite).
    [
      "100% in a 300px grid parent with an auto row",
      { parentCss: "display:grid;height:300px", height: "100%" },
      false,
    ],
    [
      "100% in a 300px grid parent with a definite row",
      {
        parentCss: "display:grid;height:300px;grid-template-rows:100%",
        height: "100%",
      },
      true,
    ],
    // Finding: var() must be judged by its resolved value, not by the
    // parent - an auto-valued variable in a definite parent is still
    // content-sized and would oscillate under the rect fit.
    [
      "var() resolving to auto in a 300px parent",
      {
        parentCss: "display:block;height:300px",
        height: "var(--player-height)",
        vars: { "--player-height": "auto" },
      },
      false,
    ],
    [
      "var() resolving to 480px in a heightless parent",
      {
        parentCss: "display:block",
        height: "var(--player-height)",
        vars: { "--player-height": "480px" },
      },
      true,
    ],
    [
      "var() resolving to 100% in a heightless parent",
      {
        parentCss: "display:block",
        height: "var(--player-height)",
        vars: { "--player-height": "100%" },
      },
      false,
    ],
    [
      "undefined var() in a 300px parent",
      {
        parentCss: "display:block;height:300px",
        height: "var(--player-height)",
      },
      false,
    ],
    [
      "inherit from a 300px parent",
      { parentCss: "display:block;height:300px", height: "inherit" },
      true,
    ],
    [
      "inherit from a heightless parent",
      { parentCss: "display:block", height: "inherit" },
      false,
    ],
    [
      "calc(100% - 40px) in a 300px parent",
      { parentCss: "display:block;height:300px", height: "calc(100% - 40px)" },
      true,
    ],
    [
      "calc(100% - 40px) in a heightless parent",
      { parentCss: "display:block", height: "calc(100% - 40px)" },
      false,
    ],
    // Finding: env() with a fallback can resolve to auto, and
    // calc-size(auto, ...) keeps intrinsic sizing - both must be
    // measured, not assumed definite. (If the browser rejects the
    // syntax the height falls back to auto, so the expected verdict
    // holds either way.)
    [
      "env() falling back to auto in a 300px parent",
      {
        parentCss: "display:block;height:300px",
        height: "env(missing-env-var, auto)",
      },
      false,
    ],
    [
      "calc-size(auto, size) in a 300px parent",
      {
        parentCss: "display:block;height:300px",
        height: "calc-size(auto, size)",
      },
      false,
    ],
    [
      "calc(50vh - 10px) in a heightless parent",
      { parentCss: "display:block", height: "calc(50vh - 10px)" },
      true,
    ],
    // Finding: revert-layer in the style attribute rolls back into
    // author stylesheet rules - a lower-layer definite height must
    // win, so the rect fit survives. Without such a rule it computes
    // to auto.
    [
      "revert-layer exposing a definite stylesheet height",
      {
        parentCss: "display:block",
        height: "revert-layer",
        containerClass: "revert-target",
      },
      true,
    ],
    [
      "revert-layer with no stylesheet height behind it",
      { parentCss: "display:block", height: "revert-layer" },
      false,
    ],
    [
      "revert with no user-origin height behind it",
      { parentCss: "display:block", height: "revert" },
      false,
    ],
    // Finding: pseudo-element rules on empty children fooled the
    // element-insertion probe; nothing is inserted now.
    [
      "hostile :empty::before rule, 100% in a heightless parent",
      {
        parentCss: "display:block",
        parentClass: "hostile-pseudo",
        height: "100%",
      },
      false,
    ],
    [
      "hostile :empty::before rule, 100% in a 300px parent",
      {
        parentCss: "display:block;height:300px",
        parentClass: "hostile-pseudo",
        height: "100%",
      },
      true,
    ],
    // Finding: a :has(> :nth-child(2)) rule gave the parent a height
    // only while a temporary child existed; the steady state (one
    // child) must decide.
    [
      "hostile :has(> :nth-child(2)) rule, 100% in a heightless parent",
      {
        parentCss: "display:block",
        parentClass: "hostile-has",
        height: "100%",
      },
      false,
    ],
    [
      "host transition on the output, 100% in a heightless parent",
      {
        parentCss: "display:block",
        parentClass: "hostile-transition",
        height: "100%",
      },
      false,
    ],
    // Improvement over the parent probe: a definite 0 is now
    // measurable - the container height stays 0 whatever the output
    // does, so the rect fit is safe.
    [
      "100% in a definite zero-height parent",
      { parentCss: "display:block;height:0", height: "100%" },
      true,
    ],
  ];

  for (const [name, setup, expected] of CASES) {
    it(`${name} -> ${expected ? "independent" : "content-sized"}`, () => {
      const { container, canvas } = build(setup);
      expect(containerHeightIndependent(container, canvas)).toBe(expected);
    });
  }

  it("does not mutate the DOM structure", () => {
    const { parent, container, canvas } = build({
      parentCss: "display:block;height:300px",
      height: "100%",
    });
    const parentChildren = parent.childNodes.length;
    const containerChildren = container.childNodes.length;

    containerHeightIndependent(container, canvas);

    expect(parent.childNodes.length).toBe(parentChildren);
    expect(container.childNodes.length).toBe(containerChildren);
  });

  it("restores the output's inline styles exactly", () => {
    const { container, canvas } = build({
      parentCss: "display:block;height:300px",
      height: "100%",
    });
    canvas.style.setProperty("height", "55%", "important");
    const before = canvas.style.cssText;

    containerHeightIndependent(container, canvas);

    expect(canvas.style.cssText).toBe(before);
  });

  it("does not start a host transition when restoring the output", async () => {
    // Finding: restoring cssText with a host height transition active
    // made the next style change animate from the 99999px probe value.
    const { container, canvas } = build({
      parentCss: "display:block",
      parentClass: "hostile-transition",
      height: "100%",
    });
    const steady = canvas.offsetHeight;
    let transitions = 0;
    canvas.addEventListener("transitionstart", () => transitions++);

    containerHeightIndependent(container, canvas);

    expect(canvas.offsetHeight).toBe(steady);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(transitions).toBe(0);
    expect(canvas.offsetHeight).toBe(steady);
  });

  it("defers measurement while a transition runs on the output", async () => {
    // Finding: pinning transition:none cancels every running CSS
    // transition on the output, snapping it to its end value. A live
    // transition must survive the probe untouched - the verdict is
    // deferred (null) and the caller reuses its previous one.
    const { container, canvas } = build({
      parentCss: "display:block",
      parentClass: "hostile-transition",
      height: "100%",
    });
    canvas.style.height = "50px";
    void canvas.offsetHeight;
    canvas.style.height = "400px";
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    expect(
      canvas
        .getAnimations()
        .some(
          (a) => a.transitionProperty === "height" && a.playState === "running",
        ),
    ).toBe(true);
    let cancelled = 0;
    canvas.addEventListener("transitioncancel", () => cancelled++);

    const verdict = containerHeightIndependent(container, canvas);

    expect(verdict).toBeNull();
    expect(cancelled).toBe(0);
    expect(
      canvas
        .getAnimations()
        .some(
          (a) => a.transitionProperty === "height" && a.playState === "running",
        ),
    ).toBe(true);
    const midFlight = canvas.getBoundingClientRect().height;
    expect(midFlight).toBeGreaterThan(0);
    expect(midFlight).toBeLessThan(400);
  });

  it("defers for a paused transition and leaves it intact", async () => {
    // Finding: a paused transition has playState "paused", but pinning
    // transition:none destroys it just the same - presence of any
    // CSSTransition must defer the probe.
    const { container, canvas } = build({
      parentCss: "display:block",
      parentClass: "hostile-transition",
      height: "100%",
    });
    canvas.style.height = "50px";
    void canvas.offsetHeight;
    canvas.style.height = "400px";
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const transition = canvas
      .getAnimations()
      .find((a) => a.transitionProperty === "height");
    expect(transition).toBeDefined();
    transition.pause();
    let cancelled = 0;
    canvas.addEventListener("transitioncancel", () => cancelled++);

    const verdict = containerHeightIndependent(container, canvas);

    expect(verdict).toBeNull();
    expect(cancelled).toBe(0);
    expect(
      canvas.getAnimations().some((a) => a.transitionProperty === "height"),
    ).toBe(true);
    const paused = canvas.getBoundingClientRect().height;
    expect(paused).toBeGreaterThan(0);
    expect(paused).toBeLessThan(400);
  });

  it("restores styles and scroll even when measurement throws", () => {
    // Finding: cleanup must be exception-safe.
    const { container, canvas } = build({
      parentCss: "display:block;height:300px",
      height: "100%",
    });
    const before = canvas.style.cssText;
    Object.defineProperty(container, "offsetHeight", {
      get() {
        throw new Error("layout backstop");
      },
    });

    expect(() => containerHeightIndependent(container, canvas)).toThrow(
      "layout backstop",
    );

    expect(canvas.style.cssText).toBe(before);
  });

  it("signals settlement of output transitions so deferred probes can retry", async () => {
    // Finding: an opacity fade defers the probe but never resizes the
    // container, so no ResizeObserver event retries it - the caller
    // needs an explicit signal when the transitions are done.
    const { container, canvas } = build({
      parentCss: "display:block;height:300px",
      height: "100%",
    });
    canvas.style.transition = "opacity 0.15s linear";
    void canvas.offsetHeight;
    canvas.style.opacity = "0.5";
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    expect(containerHeightIndependent(container, canvas)).toBeNull();

    const settled = new Promise((resolve) => {
      expect(whenOutputTransitionsSettled(canvas, resolve)).toBe(true);
    });
    await settled;

    expect(containerHeightIndependent(container, canvas)).toBe(true);
  });

  it("returns false from the settle hook when nothing is transitioning", () => {
    const { canvas } = build({
      parentCss: "display:block;height:300px",
      height: "100%",
    });

    expect(whenOutputTransitionsSettled(canvas, () => {})).toBe(false);
  });

  it("preserves scroll positions around a slot inside a shadow tree", () => {
    // Finding: slotted content must walk into its assigned slot's
    // shadow-tree ancestry - parentElement alone skips a scroller
    // wrapping the slot.
    const host = document.createElement("div");
    root.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const scroller = document.createElement("div");
    scroller.style.cssText = "height:200px;overflow:auto";
    const spacer = document.createElement("div");
    spacer.style.cssText = "height:300px";
    scroller.appendChild(spacer);
    scroller.appendChild(document.createElement("slot"));
    shadow.appendChild(scroller);

    const parent = document.createElement("div");
    parent.style.cssText = "display:block;width:400px";
    host.appendChild(parent); // slotted into the scroller
    const container = document.createElement("div");
    Object.assign(container.style, {
      display: "block",
      position: "relative",
      width: "100%",
      height: "100%",
    });
    parent.appendChild(container);
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    Object.assign(canvas.style, {
      display: "block",
      width: "100%",
      height: "225px",
    });
    container.appendChild(canvas);

    scroller.scrollTop = 250;
    expect(scroller.scrollTop).toBe(250);

    containerHeightIndependent(container, canvas);

    expect(scroller.scrollTop).toBe(250);
  });

  it("preserves scroll positions across shadow-root boundaries", () => {
    // Finding: the ancestor walk must cross shadow roots via the host,
    // or scrollers above a web component are never snapshotted.
    const scroller = document.createElement("div");
    scroller.style.cssText = "height:200px;overflow:auto";
    const spacer = document.createElement("div");
    spacer.style.cssText = "height:300px";
    scroller.appendChild(spacer);
    root.appendChild(scroller);

    const host = document.createElement("div");
    scroller.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const parent = document.createElement("div");
    parent.style.cssText = "display:block;width:400px";
    shadow.appendChild(parent);
    const container = document.createElement("div");
    Object.assign(container.style, {
      display: "block",
      position: "relative",
      width: "100%",
      height: "100%",
    });
    parent.appendChild(container);
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    Object.assign(canvas.style, {
      display: "block",
      width: "100%",
      height: "225px",
    });
    container.appendChild(canvas);

    scroller.scrollTop = 250;
    expect(scroller.scrollTop).toBe(250);

    containerHeightIndependent(container, canvas);

    expect(scroller.scrollTop).toBe(250);
  });

  it("preserves scroll positions for ancestors adopted into an iframe document", async () => {
    // Finding: instanceof Element is realm-specific - an ancestor
    // living in a same-origin iframe's document has a different
    // Element prototype, and the walk must not stop there.
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "width:500px;height:400px;border:0";
    root.appendChild(iframe);
    await new Promise((resolve) => {
      if (iframe.contentDocument?.readyState === "complete") resolve();
      else iframe.addEventListener("load", resolve, { once: true });
    });
    const idoc = iframe.contentDocument;

    const scroller = idoc.createElement("div");
    scroller.style.cssText = "height:200px;overflow:auto";
    const spacer = idoc.createElement("div");
    spacer.style.cssText = "height:300px";
    scroller.appendChild(spacer);
    idoc.body.appendChild(scroller);

    // Elements created in THIS realm, adopted into the iframe's
    // document - their ancestors are foreign-realm objects.
    const parent = document.createElement("div");
    parent.style.cssText = "display:block;width:400px";
    scroller.appendChild(parent);
    const container = document.createElement("div");
    Object.assign(container.style, {
      display: "block",
      position: "relative",
      width: "100%",
      height: "100%",
    });
    parent.appendChild(container);
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    Object.assign(canvas.style, {
      display: "block",
      width: "100%",
      height: "225px",
    });
    container.appendChild(canvas);

    scroller.scrollTop = 250;
    expect(scroller.scrollTop).toBe(250);

    containerHeightIndependent(container, canvas);

    expect(scroller.scrollTop).toBe(250);
  });

  it("restores a smooth-behavior scroller instantly", () => {
    // The restore must not glide: behavior:"instant" bypasses a host
    // `scroll-behavior: smooth` on engines that keep the clamped
    // offset. Pinned here; Chromium restores within the task anyway.
    const scroller = document.createElement("div");
    scroller.style.cssText =
      "height:200px;overflow:auto;scroll-behavior:smooth";
    const spacer = document.createElement("div");
    spacer.style.cssText = "height:300px";
    scroller.appendChild(spacer);
    root.appendChild(scroller);

    const parent = document.createElement("div");
    parent.style.cssText = "display:block;width:400px";
    scroller.appendChild(parent);
    const container = document.createElement("div");
    Object.assign(container.style, {
      display: "block",
      position: "relative",
      width: "100%",
      height: "100%",
    });
    parent.appendChild(container);
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    Object.assign(canvas.style, {
      display: "block",
      width: "100%",
      height: "225px",
    });
    container.appendChild(canvas);

    // Even the setup needs behavior:"instant" - a plain scrollTop
    // assignment on a smooth scroller animates and reads back 0.
    scroller.scrollTo({ top: 250, behavior: "instant" });
    expect(scroller.scrollTop).toBe(250);

    containerHeightIndependent(container, canvas);

    // Synchronously back at the exact offset - no smooth glide pending.
    expect(scroller.scrollTop).toBe(250);
  });

  it("preserves ancestor scroll positions", () => {
    // Finding: the 1px pass shrinks an overflowing ancestor's scroll
    // range, and the browser's scrollTop clamp survives restoration.
    const scroller = document.createElement("div");
    scroller.style.cssText = "height:200px;overflow:auto";
    const spacer = document.createElement("div");
    spacer.style.cssText = "height:300px";
    scroller.appendChild(spacer);
    root.appendChild(scroller);

    const parent = document.createElement("div");
    parent.style.cssText = "display:block;width:400px";
    scroller.appendChild(parent);
    const container = document.createElement("div");
    Object.assign(container.style, {
      display: "block",
      position: "relative",
      width: "100%",
      height: "100%",
    });
    parent.appendChild(container);
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    Object.assign(canvas.style, {
      display: "block",
      width: "100%",
      height: "225px",
    });
    container.appendChild(canvas);

    scroller.scrollTop = 250;
    expect(scroller.scrollTop).toBe(250);

    containerHeightIndependent(container, canvas);

    expect(scroller.scrollTop).toBe(250);
  });
});
