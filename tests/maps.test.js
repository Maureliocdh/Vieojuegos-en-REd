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
    assert.equal(copy.obstacles[0].puertaAbierta, false);
    assert.equal(map.platforms.length, 10);
    const buildings = map.obstacles.filter(Buildings.isBuilding);
    assert.equal(buildings.length, 12);
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
      assert.deepEqual(Zones.effects(zone, [zone]), zone.tipo === 'hielo'
        ? { damagePerSecond: 0, speedMultiplier: 0.6 } : { damagePerSecond: 5, speedMultiplier: 1 });
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
  assert.deepEqual(vote.counts(), { outpost: 1, orbital: 2 });
  assert.equal(vote.close(15999), false);
  assert.equal(vote.snapshot(15999).segundos, 1);
  assert.match(vote.vote('b', 'outpost', 16000), /terminó/);
  assert.equal(vote.close(16000), true);
  assert.equal(vote.ganador, 'orbital');
  assert.equal(vote.snapshot(16000).activa, false);
  assert.equal(vote.close(17000), false);
});

test('Votación: empate, abstención y desconexión conservan reglas deterministas', () => {
  for (const current of ['outpost', 'orbital']) {
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
