const { test } = require('node:test');
const assert = require('node:assert/strict');
const { effects } = require('../public/js/zones');

test('Generación: seis polígonos repartidos, tres por tipo, con posiciones nuevas', () => {
  const Zones = require('../public/js/zones');
  const first = JSON.stringify(Zones.generate(6000, 6000));
  const areas = Zones.generate(6000, 6000);
  assert.notEqual(JSON.stringify(areas), first);
  assert.equal(areas.filter((area) => area.tipo === 'hielo').length, 3);
  assert.equal(areas.filter((area) => area.tipo === 'contaminacion').length, 3);
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
  assert.deepEqual(effects(entity, areas), { damagePerSecond: 5, speedMultiplier: 0.6 });
  entity.x = 101;
  assert.deepEqual(effects(entity, areas), { damagePerSecond: 0, speedMultiplier: 1 });
});
