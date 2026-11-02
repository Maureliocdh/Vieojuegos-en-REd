(function (root) {
  const catalog = [
    { id: 'outpost', nombre: 'Isla Outpost', descripcion: 'Bosques, casas y caminos abiertos.' },
    { id: 'orbital', nombre: 'Estación Orbital', descripcion: 'Salas conectadas por pasillos, compuertas y esclusas exteriores.' },
  ];
  const valid = id => typeof id === 'string' && catalog.some(map => map.id === id);
  function stationLayout() {
    const rooms = [];
    for (const y of [300, 1700, 3100, 4500]) {
      for (const x of [500, 2500, 4500]) rooms.push({ x, y, width: 1000, height: 1000 });
    }
    const corridors = [800, 2200, 3600, 5000].map(y => ({ x: 1000, y: y - 150, width: 4000, height: 300 }));
    corridors.push({ x: 1850, y: 500, width: 300, height: 4500 },
      { x: 3850, y: 800, width: 300, height: 4700 });
    const exterior = [{ x: 1600, y: 200, width: 800, height: 600 },
      { x: 3600, y: 5200, width: 800, height: 600 }];
    return { rooms, corridors, exterior };
  }
  function createStation() {
    const layout = stationLayout();
    const obstacles = layout.rooms.map((room, index) => ({
      ...room, tipo: index % 3 === 0 ? 'almacen' : 'casa', id: `modulo-${index}`,
      puertaAbierta: false,
      puertas: (index % 3 === 0 ? ['derecha'] : index % 3 === 2 ? ['izquierda'] : ['izquierda', 'derecha'])
        .map(lado => ({ lado, abierta: false })),
    }));
    const floors = [...layout.rooms, ...layout.corridors, ...layout.exterior];
    // El complemento del suelo es casco sólido: no se puede caminar por el espacio.
    for (let y = 0; y < 6000; y += 50) {
      let start = null;
      for (let x = 0; x <= 6000; x += 50) {
        const solid = x < 6000 && !floors.some(floor => x + 25 > floor.x && x + 25 < floor.x + floor.width
          && y + 25 > floor.y && y + 25 < floor.y + floor.height);
        if (solid && start === null) start = x;
        if (!solid && start !== null) {
          const previous = obstacles.find(object => object.tipo === 'casco' && object.x === start
            && object.width === x - start && object.y + object.height === y);
          if (previous) previous.height += 50;
          else obstacles.push({ tipo: 'casco', x: start, y, width: x - start, height: 50 });
          start = null;
        }
      }
    }
    for (const room of layout.rooms) {
      obstacles.push({ tipo: 'contenedor', x: room.x + 150, y: room.y + 170, width: 130, height: 90 },
        { tipo: 'contenedor', x: room.x + 720, y: room.y + 740, width: 130, height: 90 });
    }
    const platforms = layout.rooms.slice(0, 10).map(room => ({
      x: room.x + 680, y: room.y + 650, objeto: null,
    }));
    const colors = ['#65eaff', '#c699ff', '#ffbd69', '#85ffbc', '#ff83ba', '#e5ec82'];
    const portals = [[0, 11], [2, 9], [1, 7], [3, 8], [4, 10], [5, 6]].flatMap(([first, second], pair) =>
      [first, second].map((room, side) => ({
        id: `portal-${pair}-${side}`, destinoId: `portal-${pair}-${1 - side}`,
        enlace: String.fromCharCode(65 + pair), color: colors[pair],
        x: layout.rooms[room].x + 450, y: layout.rooms[room].y + 700, radio: 65,
      })));
    return { platforms, obstacles, portals };
  }
  function create(id) {
    if (!valid(id)) throw new Error(`Mapa desconocido: ${id}`);
    if (id === 'orbital') return createStation();
    const platforms = [[900, 900], [3000, 900], [5100, 1500], [1500, 4500], [4200, 4800],
        [2400, 2400], [4800, 3000], [1200, 3000], [3600, 1800], [3000, 5400]]
      .map(([x, y]) => ({ x, y, objeto: null }));
    const buildings = [[660, 660, 420, 300], [2280, 1260, 660, 270], [3960, 780, 360, 660],
        [1080, 3150, 780, 300], [3180, 3540, 390, 780], [4680, 4740, 720, 330],
        [1800, 1800, 300, 300], [4500, 2100, 450, 240], [2700, 4200, 360, 360],
        [900, 5100, 480, 200], [5400, 4200, 300, 420], [2400, 600, 240, 300]];
    const obstacles = buildings.map(([x, y, width, height], index) => ({
      x, y, width, height, tipo: index % 3 === 0 ? 'almacen' : 'casa',
      id: `edificio-${index}`, puertaAbierta: false,
    }));
    for (let index = 0; index < 160; index += 1) {
      const object = {
        x: 160 + ((index * 977) % 5650), y: 160 + ((index * 619) % 5650),
        width: index % 3 === 0 ? 70 : 92,
        height: index % 3 === 0 ? 60 : 92,
        tipo: index % 3 === 0 ? 'roca' : 'arbol',
      };
      if (obstacles.some(other => object.x < other.x + other.width + 100
        && object.x + object.width + 100 > other.x && object.y < other.y + other.height + 100
        && object.y + object.height + 100 > other.y)) continue;
      if (platforms.some(platform => Math.hypot(platform.x - object.x, platform.y - object.y) < 180)) continue;
      obstacles.push(object);
    }
    for (let index = 0; index < 100; index += 1) {
        const bush = { id: `arbusto-${index}`, tipo: 'arbusto', x: 220 + (index * 733) % 5500,
          y: 280 + (index * 1091) % 5500, width: 190, height: 160 };
        if (obstacles.some(object => bush.x < object.x + object.width + 40 && bush.x + bush.width + 40 > object.x
          && bush.y < object.y + object.height + 40 && bush.y + bush.height + 40 > object.y)) continue;
        obstacles.push(bush);
    }
    return { platforms, obstacles, portals: [] };
  }
  const api = { catalog, valid, create, stationLayout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArenaMaps = api;
}(typeof window !== 'undefined' ? window : globalThis));
