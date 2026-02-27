export function getElementCoordinates (elem) {
  if (!elem) return {};

  let box = elem.getBoundingClientRect();

  return {
    top:   box.top   + window.pageYOffset,
    left:  box.left  + window.pageXOffset,
    right: box.right + window.pageXOffset,
    width: box.width
  };
}