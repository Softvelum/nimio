export function getElementCoordinates (elem) {
  if (!elem) return {};

  let box = elem.getBoundingClientRect();
  return {
    top:   box.top   + window.scrollY,
    left:  box.left  + window.scrollX,
    right: box.right + window.scrollX,
    width: box.width
  };
}

