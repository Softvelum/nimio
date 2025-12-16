export function isSharedArrayBufferSupported() {
  if (
    typeof SharedArrayBuffer === "undefined" ||
    typeof Atomics === "undefined"
  ) {
    return false;
  }

  const coi =
    typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : true;
  if (!coi) return false;

  try {
    // Safari may expose the constructor but throw when it's not allowed.
    new SharedArrayBuffer(1);
    return true;
  } catch (e) {
    return false;
  }
}

export function createSharedBuffer(byteLength) {
  console.log(
    isSharedArrayBufferSupported()
      ? "SharedArrayBuffer mode"
      : "ArrayBuffer mode",
  );
  return isSharedArrayBufferSupported()
    ? new SharedArrayBuffer(byteLength)
    : new ArrayBuffer(byteLength);
}

export function isSharedBuffer(buffer) {
  return (
    typeof SharedArrayBuffer !== "undefined" &&
    buffer instanceof SharedArrayBuffer
  );
}
