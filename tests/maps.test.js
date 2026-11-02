const { test } = require('node:test');
const assert = require('node:assert/strict');
const Maps = require('../public/js/maps');
const Buildings = require('../public/js/buildings');
const { MapVote } = require('../lib/map-vote');
const { Navigation } = require('../lib/navigation');
const Zones = require('../public/js/zones');

for (const { id } of Maps.catalog) {
  test(`Mapa ${id}: geometría independiente, módulos transitables y suministros`, () => {
    const map = Maps.create(id);
    const copy = Maps.create(id);
    assert.deepEqual(map, copy);
    map.obstacles[0].puertaAbierta = true;
    assert.notEqual(copy.obstacles[0].puertaAbierta, true);
    assert.equal(map.platforms.length, 10);
    const buildings = map.obstacles.filter(Buildings.isBuilding);
    assert.equal(buildings.length, id === 'desierto' ? 4 : 12);
    for (const object of map.obstacles) {
      assert.ok(object.x >= 0 && object.y >= 0);
      assert.ok(object.x + object.width <= 6000 && object.y + object.height <= 6000);
    }
    for (const building of buildings) {
      building.puertaAbierta = true;
      for (const entry of building.puertas || []) entry.abierta = true;
      for (const door of Buildings.doors(building)) {
        const x = door.x + door.width / 2, y = door.y + door.height / 2;
        assert.ok(!Buildings.walls(building).some(wall => x >= wall.x && x <= wall.x + wall.width && y >= wall.y && y <= wall.y + wall.height));
      }
      assert.ok(Buildings.inside(building, { x: building.x + building.width / 2, y: building.y + building.height / 2 }));
    }
    if (id === 'orbital') {
      assert.ok(map.obstacles.some(object => object.tipo === 'contenedor'));
      assert.ok(map.obstacles.every(object => !['arbol', 'roca', 'arbusto'].includes(object.tipo)));
      for (const platform of map.platforms) {
        assert.ok(!map.obstacles.flatMap(Buildings.walls).some(wall => Math.hypot(
          platform.x - Math.max(wall.x, Math.min(platform.x, wall.x + wall.width)),
          platform.y - Math.max(wall.y, Math.min(platform.y, wall.y + wall.height))) < 55));
      }
    }
  });
}

test('Mapas desconocidos se rechazan', () => {
  for (const id of ['constructor', '__proto__', null, {}, 'luna']) {
    assert.equal(Maps.valid(id), false);
    assert.throws(() => Maps.create(id));
  }
});

test('Portales: seis parejas unen las doce salas, sin obstáculos, peligros ni solapamientos', () => {
  const map = Maps.create('orbital');
  assert.equal(Maps.create('outpost').portals.length, 0);
  assert.equal(map.portals.length, 12);
  const walls = map.obstacles.flatMap(Buildings.walls);
  const rooms = Maps.stationLayout().rooms;
  for (const portal of map.portals) {
    const destination = map.portals.find(other => other.id === portal.destinoId);
    assert.ok(destination);
    assert.equal(destination.destinoId, portal.id);
    assert.equal(destination.color, portal.color);
    assert.equal(destination.enlace, portal.enlace);
    assert.ok(Math.hypot(destination.x - portal.x, destination.y - portal.y) > 1000);
    assert.ok(!walls.some(wall => Math.hypot(portal.x - Math.max(wall.x, Math.min(portal.x, wall.x + wall.width)),
      portal.y - Math.max(wall.y, Math.min(portal.y, wall.y + wall.height))) < 105));
    for (let i = 0; i < 10; i += 1) {
      assert.ok(Zones.generateStation(rooms).every(zone => Math.hypot(zone.x - portal.x, zone.y - portal.y) > zone.radio + 105));
    }
  }
  assert.ok(rooms.every(room => map.portals.some(portal => Buildings.inside({ ...room, tipo: 'casa' }, portal))));
});

test('Estación cerrada: todas las salas y cubiertas se comunican solo por suelo transitable', () => {
  const map = Maps.create('orbital');
  const nav = new Navigation(map.obstacles);
  const { rooms, exterior } = Maps.stationLayout();
  const source = { x: 1000, y: 800 };
  for (const floor of [...rooms, ...exterior]) {
    const target = { x: floor.x + floor.width / 2, y: floor.y + floor.height / 2 };
    const route = nav.path(source, target);
    assert.ok(route.length, `No hay ruta a ${JSON.stringify(target)}`);
    for (let i = 0; i < route.length; i += 1) {
      assert.ok(nav.clear(route[i].x, route[i].y));
      if (i) {
        assert.equal(Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y), 100);
        assert.ok(nav.clear((route[i].x + route[i - 1].x) / 2, (route[i].y + route[i - 1].y) / 2));
      }
    }
  }
  assert.equal(nav.clear(100, 100), false);
  assert.equal(nav.clear(2000, 1500), true);
  assert.equal(nav.clear(1700, 1500), false);
  const room = map.obstacles.find(Buildings.isBuilding);
  const closed = Buildings.doors(room)[0];
  assert.ok(Buildings.walls(room).some(wall => wall.x === closed.x && wall.y === closed.y && wall.height === closed.height));
});

test('Estación: tres agujeros negros dañan, tres zonas de hielo mantienen su lentitud', () => {
  const rooms = Maps.stationLayout().rooms;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const areas = Zones.generateStation(rooms);
    assert.equal(areas.filter(zone => zone.tipo === 'agujeroNegro').length, 3);
    assert.equal(areas.filter(zone => zone.tipo === 'hielo').length, 3);
    for (const zone of areas) {
      assert.ok(rooms.some(room => zone.x - zone.radio > room.x + 18 && zone.x + zone.radio < room.x + room.width - 18
        && zone.y - zone.radio > room.y + 18 && zone.y + zone.radio < room.y + room.height - 18));
      assert.deepEqual(Zones.effects(zone, [zone]), {
        damagePerSecond: zone.tipo === 'agujeroNegro' ? 5 : 0, speedMultiplier: zone.tipo === 'hielo' ? 0.6 : 1,
        healPerSecond: zone.tipo === 'curacion' ? 10 : 0, shieldPerSecond: zone.tipo === 'escudo' ? 10 : 0,
      });
    }
  }
});

test('Votación: 15 segundos exactos, un voto por humano, cambio de voto y mayoría', () => {
  const vote = new MapVote(['a', 'b', 'c'], 'outpost', 1000);
  assert.equal(vote.snapshot(1000).segundos, 15);
  assert.match(vote.vote('bot1', 'orbital', 1000), /Solo/);
  assert.match(vote.vote('espectador', 'orbital', 1000), /Solo/);
  assert.match(vote.vote('a', 'constructor', 1000), /válido/);
  assert.equal(vote.vote('a', 'outpost', 1000), null);
  assert.equal(vote.vote('a', 'orbital', 1100), null);
  assert.equal(vote.vote('a', 'orbital', 1100), null);
  assert.equal(vote.vote('b', 'orbital', 1100), null);
  assert.equal(vote.vote('c', 'outpost', 1100), null);
  assert.deepEqual(vote.counts(), { outpost: 1, orbital: 2, desierto: 0 });
  assert.equal(vote.close(15999), false);
  assert.equal(vote.snapshot(15999).segundos, 1);
  assert.match(vote.vote('b', 'outpost', 16000), /terminó/);
  assert.equal(vote.close(16000), true);
  assert.equal(vote.ganador, 'orbital');
  assert.equal(vote.snapshot(16000).activa, false);
  assert.equal(vote.close(17000), false);
});

test('Votación: empate, abstención y desconexión conservan reglas deterministas', () => {
  for (const { id: current } of Maps.catalog) {
    const vote = new MapVote(['a', 'b'], current, 0);
    vote.vote('a', 'outpost', 0);
    vote.vote('b', 'orbital', 0);
    vote.close(15000);
    assert.equal(vote.ganador, current);
    const abstention = new MapVote(['a'], current, 0);
    abstention.close(15000);
    assert.equal(abstention.ganador, current);
  }
  const vote = new MapVote(['a'], 'outpost', 0);
  vote.vote('a', 'orbital', 0);
  vote.close(15000);
  assert.equal(vote.ganador, 'orbital');
});

test('Desierto abierto: cuatro carpas con suministros, cactus dispersos y menos del 1,5 % ocupado', () => {
  const map = Maps.create('desierto');
  const tents = map.obstacles.filter(Buildings.isBuilding);
  assert.equal(tents.length, 4);
  assert.ok(tents.every(tent => tent.tipo === 'carpa'));
  assert.ok(map.obstacles.filter(object => object.tipo === 'cactus').length >= 20);
  assert.ok(map.obstacles.every(object => ['carpa', 'cactus', 'roca'].includes(object.tipo)));
  assert.ok(map.obstacles.reduce((area, object) => area + object.width * object.height, 0) / 36000000 < 0.015);
  assert.ok(map.obstacles.length < Maps.create('outpost').obstacles.length / 3);
  for (const tent of tents) {
    assert.equal(Buildings.doors(tent).length, 0);
    const corner = { x: tent.x + 25, y: tent.y + 25 };
    assert.equal(Buildings.inside(tent, corner), false);
    const walls = Buildings.walls(tent);
    assert.ok(!walls.some(wall => corner.x >= wall.x && corner.x <= wall.x + wall.width
      && corner.y >= wall.y && corner.y <= wall.y + wall.height));
    for (const side of [-1, 1]) {
      const edge = { x: tent.x + tent.width / 2 + side * tent.width / 4, y: tent.y + tent.height / 2 };
      assert.ok(walls.some(wall => edge.x >= wall.x && edge.x <= wall.x + wall.width
        && edge.y >= wall.y && edge.y <= wall.y + wall.height));
    }
    const opening = Buildings.door(tent);
    assert.ok(!Buildings.walls(tent).some(wall => opening.x + 48 >= wall.x && opening.x + 48 <= wall.x + wall.width
      && opening.y + 9 >= wall.y && opening.y + 9 <= wall.y + wall.height));
    assert.equal(map.platforms.filter(platform => Buildings.inside(tent, platform)).length, 2);
  }
  const vote = new MapVote(['a'], 'orbital', 0);
  assert.equal(vote.vote('a', 'desierto', 0), null);
  vote.close(15000);
  assert.equal(vote.ganador, 'desierto');
  for (let i = 0; i < 50; i += 1) {
    assert.equal(Zones.generate(6000, 6000, tents).length, 8);
  }
});
