(function (root) {
  const isBuilding = (object) => object.tipo === 'casa' || object.tipo === 'almacen';
  function doors(building) {
    if (!building.puertas) return [{ ...door(building), abierta: building.puertaAbierta, index: 0 }];
    return building.puertas.map((entry, index) => ({
      x: entry.lado === 'izquierda' ? building.x : building.x + building.width - 18,
      y: building.y + building.height / 2 - 90, width: 18, height: 180,
      abierta: entry.abierta, index,
    }));
  }
  function door(building) {
    if (building.puertas) return doors(building)[0];
    return { x: building.x + building.width / 2 - 48, y: building.y + building.height - 18, width: 96, height: 18 };
  }
  function walls(building) {
    if (building.tipo === 'arbusto') return [];
    if (!isBuilding(building)) return [building];
    if (building.puertas) {
      const rectangles = [
        { x: building.x, y: building.y, width: building.width, height: 18 },
        { x: building.x, y: building.y + building.height - 18, width: building.width, height: 18 },
      ];
      for (const lado of ['izquierda', 'derecha']) {
        if (!building.puertas.some(entry => entry.lado === lado)) {
          rectangles.push({ x: lado === 'izquierda' ? building.x : building.x + building.width - 18,
            y: building.y, width: 18, height: building.height });
        }
      }
      for (const opening of doors(building)) {
        rectangles.push({ x: opening.x, y: building.y, width: 18, height: opening.y - building.y },
          { x: opening.x, y: opening.y + opening.height, width: 18, height: building.height / 2 - 90 });
        if (!opening.abierta) rectangles.push(opening);
      }
      return rectangles;
    }
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
  const api = { isBuilding, door, doors, walls, inside, inBush, concealed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Buildings = api;
}(typeof window !== 'undefined' ? window : globalThis));