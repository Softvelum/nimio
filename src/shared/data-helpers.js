export function getFrameData(data) {
  const frameWithHeader = new Uint8Array(data.frameWithHeader);
  return frameWithHeader.subarray(data.framePos, frameWithHeader.byteLength);
}
