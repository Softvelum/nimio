// Answers the question the flicker guard actually depends on: does the
// output element's size feed back into the container's height? The
// rect-based fit oscillates exactly when it does (#86).
//
// Instead of inserting a synthetic element next to the container -
// which measures a proxy (the parent's definiteness) and is open to
// contamination through pseudo-element rules on empty children and
// structural selectors (:empty, :has, :nth-child) reacting to the
// temporary child - this flips the EXISTING output element's inline
// height between two extremes and checks whether the container's
// height follows. Nothing is inserted, so the DOM structure the host's
// selectors see never changes, and the verdict reflects the
// container's real computed height semantics: an unresolvable
// percentage, an auto-valued var(), or an inherited auto all read as
// content-sized no matter what the parent looks like.
//
// Side-effect containment:
// - Measuring requires transition:none on the output, which would
//   cancel every CSS transition currently live there - running OR
//   paused - and snap it to its end value. If any exists, the probe
//   returns null instead of measuring; the caller keeps its previous
//   verdict and uses whenOutputTransitionsSettled() to re-measure once
//   they finish (a transition that stays paused forever keeps the
//   stale verdict - the only alternative would be destroying it).
// - transition:none stays pinned until one style change event has seen
//   the restored height, so re-enabling a host transition cannot
//   animate from the probe value (the before/after-change rule of the
//   CSS transitions model).
// - Ancestor scroll offsets - walking the FLAT tree: slotted content
//   steps into its assigned slot's shadow-tree ancestry, and shadow
//   roots step out through their host - are snapshotted first and
//   re-applied last: the 1px pass shrinks ancestor scroll ranges, and
//   an engine may clamp scrollTop during the forced layout and keep
//   the clamped value (Chromium restores it within the same task, but
//   that is not guaranteed elsewhere).
// - Restoration runs in a finally block, so styles and scroll come
//   back even if a measurement throws.
// - The synchronous flip never reaches a rendering step, so a
//   ResizeObserver does not see it, and inline styles are restored
//   verbatim.
export function containerHeightIndependent(container, output) {
  if (outputTransitions(output).length) {
    return null;
  }

  const savedCss = output.style.cssText;
  const savedScrolls = [];
  // nodeType instead of instanceof: an ancestor adopted into a
  // same-origin iframe's document belongs to another realm, where the
  // local Element global would not match.
  for (
    let node = container;
    node && node.nodeType === 1;
    node =
      node.assignedSlot ?? node.parentElement ?? node.getRootNode().host ?? null
  ) {
    if (node.scrollTop || node.scrollLeft) {
      savedScrolls.push([node, node.scrollTop, node.scrollLeft]);
    }
  }

  let low, high;
  try {
    output.style.setProperty("transition", "none", "important");
    output.style.setProperty("height", "1px", "important");
    low = container.offsetHeight;
    output.style.setProperty("height", "99999px", "important");
    high = container.offsetHeight;
  } finally {
    output.style.cssText = savedCss;
    output.style.setProperty("transition", "none", "important");
    try {
      // Style change event with the steady height while transitions
      // are still off; the next event then sees no height difference.
      void output.offsetHeight;
    } catch {
      // measurement is best-effort during cleanup
    }
    output.style.cssText = savedCss;
    for (const [node, top, left] of savedScrolls) {
      // behavior:"instant" so a host `scroll-behavior: smooth` cannot
      // animate the restoration on engines that keep the clamped offset
      if (typeof node.scrollTo === "function") {
        node.scrollTo({ top, left, behavior: "instant" });
      } else {
        node.scrollTop = top;
        node.scrollLeft = left;
      }
    }
  }
  return low === high;
}

function outputTransitions(output) {
  if (typeof output.getAnimations !== "function") return [];
  return output.getAnimations().filter((a) => "transitionProperty" in a);
}

// Retry hook for a deferred probe: invokes callback once every CSS
// transition currently live on the output has finished or been
// cancelled, and returns true. Returns false without scheduling when
// there is nothing to wait for (the caller can probe again right
// away). Without this, a transition that never resizes the container -
// an opacity fade, say - would produce no ResizeObserver events and a
// deferred verdict would stay stale forever.
export function whenOutputTransitionsSettled(output, callback) {
  const transitions = outputTransitions(output);
  if (!transitions.length) return false;
  Promise.allSettled(transitions.map((t) => t.finished)).then(callback);
  return true;
}
