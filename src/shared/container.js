function isElement(node) {
  return typeof Element !== "undefined" && node instanceof Element;
}

function normalizeSelector(selector) {
  if (typeof selector !== "string") return "";
  return selector.trim();
}

export function resolveContainer(container, { logger, fallbackId } = {}) {
  const selector = normalizeSelector(container);
  let element = null;

  if (isElement(container)) {
    element = container;
  } else if (container && container.nodeType === 1) {
    // Allow elements coming from a different JS realm (e.g. iframe) where instanceof Element may fail
    element = container;
  } else if (
    container &&
    typeof container === "object" &&
    "length" in container &&
    container.length
  ) {
    const candidate = container[0];
    if (isElement(candidate) || candidate?.nodeType === 1) {
      element = candidate;
    }
  } else if (selector) {
    const byId = document.getElementById(
      selector.startsWith("#") ? selector.slice(1) : selector,
    );
    if (byId) {
      element = byId;
    } else {
      try {
        element = document.querySelector(selector);
      } catch (err) {
        logger?.warn?.(`Container selector "${selector}" is invalid`, err);
      }
    }
  }

  if (!element) {
    const name = selector || (container?.tagName ? container.tagName : "");
    const msg = `Container element${name ? ` "${name}"` : ""} not found`;
    logger?.error?.(msg);
    throw new Error(msg);
  }

  const id = element.id || undefined;
  let storageKey = selector || id || undefined;
  if (!storageKey) storageKey = fallbackId || "nimio";

  return { element, id, storageKey };
}
