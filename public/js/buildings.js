(function (root) {
  const isBuilding = (object) => object.tipo === 'casa' || object.tipo === 'almacen';
  function door(building) {
    return { x: building.x + building.width / 2 - 48, y: building.y + building.height - 18, width: 96, height: 18 };
  }
  function walls(building) {
    if (building.tipo === 'arbusto') return [];
    if (!isBuilding(building)) return [building];
    const opening = door(building);
    const rectangles = [
      { x: building.x, y: building.y, width: building.width, height: 18 },
      { x: building.x, y: building.y, width: 18, height: building.height },
      { x: building.x + building.width - 18, y: building.y, width: 18, height: building.height },
      { x: building.x, y: opening.y, width: opening.x - building.x, height: 18 },
      { x: opening.x + opening.width, y: opening.y, width: building.width / 2 - 48, height: 18 },
    ];
    if (!building.puertaAbierta) rectangles.push(opening);
    return rectangles;
  }
  function inside(building, point) {
    return point.x > building.x + 18 && point.x < building.x + building.width - 18
      && point.y > building.y + 18 && point.y < building.y + building.height - 18;
  }
  function inBush(bush, point) {
    return Boolean(point) && ((point.x - bush.x - bush.width / 2) / (bush.width / 2)) ** 2
      + ((point.y - bush.y - bush.height / 2) / (bush.height / 2)) ** 2 < 1;
  }
  function concealed(objects, target, observer) {
    return objects.some((object) => object.tipo === 'arbusto' && inBush(object, target) && !inBush(object, observer));
  }
  const api = { isBuilding, door, walls, inside, inBush, concealed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Buildings = api;
}(typeof window !== 'undefined' ? window : globalThis));