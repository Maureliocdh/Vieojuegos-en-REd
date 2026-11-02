const { test } = require('node:test');
const assert = require('node:assert/strict');
const Teams = require('../public/js/teams');

test('Balance: humanos, bots y totales difieren como máximo en uno, sin duplicar miembros', () => {
  for (let humans = 0; humans <= 12; humans += 1) {
    for (const bots of [0, 5, 11, 15, 20]) {
      for (const random of [() => 0, () => 0.99999, Math.random]) {
        const players = Array.from({ length: humans + bots }, (_, i) => ({ id: i, esBot: i >= humans }));
        const totals = Teams.balance(players, random);
        assert.ok(Math.abs(totals.azul - totals.rojo) <= 1);
        assert.equal(totals.azul + totals.rojo, humans + bots);
        for (const bot of [false, true]) {
          const group = players.filter(player => player.esBot === bot);
          const blue = group.filter(player => player.equipo === 'azul').length;
          assert.ok(Math.abs(blue - (group.length - blue)) <= 1);
        }
        assert.ok(players.every(player => Teams.valid(player.equipo)));
        assert.equal(new Set(players.map(player => player.id)).size, humans + bots);
      }
    }
  }
});

test('Impares: ambos equipos pueden recibir el extra y los extras se compensan si ambos grupos son impares', () => {
  for (const value of [0, 0.99999]) {
    const humans = Array.from({ length: 3 }, () => ({ esBot: false }));
    Teams.balance(humans, () => value);
    const expected = value === 0 ? 'azul' : 'rojo';
    assert.equal(humans.filter(player => player.equipo === expected).length, 2);
    const bots = Array.from({ length: 5 }, () => ({ esBot: true }));
    Teams.balance(bots, () => value);
    assert.equal(bots.filter(player => player.equipo === expected).length, 3);
    Teams.balance([...humans, ...bots], () => value);
    assert.equal([...humans, ...bots].filter(player => player.equipo === 'azul').length, 4);
  }
});

test('Equipos válidos, compañeros y victoria por puntos o empate', () => {
  assert.equal(Teams.same({ equipo: 'azul' }, { equipo: 'azul' }), true);
  assert.equal(Teams.same({ equipo: 'azul' }, { equipo: 'rojo' }), false);
  assert.equal(Teams.same({}, {}), false);
  assert.equal(Teams.same(null, null), false);
  assert.equal(Teams.valid('constructor'), false);
  assert.equal(Teams.winner({ azul: 5, rojo: 4 }), 'azul');
  assert.equal(Teams.winner({ azul: 2, rojo: 3 }), 'rojo');
  assert.equal(Teams.winner({ azul: 3, rojo: 3 }), null);
});
