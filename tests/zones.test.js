const { test } = require('node:test');
const assert = require('node:assert/strict');
const { effects } = require('../public/js/zones');

test('Generación: seis peligros y dos charcos de recuperación, con posiciones nuevas', () => {
  const Zones = require('../public/js/zones');
  const first = JSON.stringify(Zones.generate(6000, 6000));
  const areas = Zones.generate(6000, 6000);
  assert.notEqual(JSON.stringify(areas), first);
  assert.equal(areas.filter((area) => area.tipo === 'hielo').length, 3);
  assert.equal(areas.filter((area) => area.tipo === 'contaminacion').length, 3);
  assert.equal(areas.length, 8);
  for (const type of ['curacion', 'escudo']) assert.equal(areas.filter(area => area.tipo === type).length, 1);
  for (const area of areas) {
    assert.ok(Zones.contains(area, area));
    assert.ok(!Zones.contains(area, { x: area.x + area.radio + 1, y: area.y }));
    assert.ok(area.points.every((p) => p.x >= 0 && p.x <= 6000 && p.y >= 0 && p.y <= 6000));
  }
});

test('Los efectos solo existen dentro de las zonas y no se acumulan al superponerse', () => {
  const areas = [
    { tipo: 'contaminacion', x: 0, y: 0, radio: 100 },
    { tipo: 'contaminacion', x: 0, y: 0, radio: 100 },
    { tipo: 'hielo', x: 0, y: 0, radio: 100 },
  ];
  const entity = { x: 0, y: 0 };
  assert.deepEqual(effects(entity, areas), { damagePerSecond: 5, speedMultiplier: 0.6, healPerSecond: 0, shieldPerSecond: 0 });
  entity.x = 101;
  assert.deepEqual(effects(entity, areas), { damagePerSecond: 0, speedMultiplier: 1, healPerSecond: 0, shieldPerSecond: 0 });
});

test('Charcos usan su polígono real, recuperan solo dentro y no multiplican efectos superpuestos', () => {
  const Zones = require('../public/js/zones');
  const maps = require('../public/js/maps');
  for (const areas of [Zones.generate(6000, 6000).slice(), Zones.generateStation(maps.stationLayout().rooms).slice()]) {
    for (const tipo of ['curacion', 'escudo']) {
      const zone = areas.find(area => area.tipo === tipo);
      assert.equal(zone.points.length, 18);
      assert.equal(Zones.contains(zone, { x: zone.x, y: zone.y + zone.radio * 0.9 }), false);
      const effect = effects(zone, [zone, { ...zone }]);
      assert.equal(effect.healPerSecond, tipo === 'curacion' ? 10 : 0);
      assert.equal(effect.shieldPerSecond, tipo === 'escudo' ? 10 : 0);
      const distances = zone.points.map(point => Math.hypot(point.x - zone.x, point.y - zone.y));
      assert.ok(Math.max(...distances) - Math.min(...distances) > 20);
      assert.deepEqual(effects({ x: zone.x + zone.radio + 1, y: zone.y }, [zone]),
        { damagePerSecond: 0, speedMultiplier: 1, healPerSecond: 0, shieldPerSecond: 0 });
    }
  }
});
