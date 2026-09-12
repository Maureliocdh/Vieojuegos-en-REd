const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

function loadGame() {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const localRequire = createRequire(serverPath);
  const timeouts = [];
  const intervals = [];
  let now = 10000;
  class Clock extends Date { static now() { return now; } }
  const sandbox = vm.createContext({
    __dirname: path.dirname(serverPath), process: { argv: [], env: {} }, console: { log() {} }, Date: Clock,
    setTimeout: (callback) => { timeouts.push(callback); return timeouts.length; }, clearTimeout() {},
    setInterval: (callback) => { intervals.push(callback); return intervals.length; }, clearInterval() {},
    require(name) {
      if (name === 'http') return { createServer: () => ({ listen() {} }) };
      if (name === 'socket.io') return { Server: class { on() {} emit() {} } };
      return localRequire(name);
    },
  });
  vm.runInContext(`${fs.readFileSync(serverPath, 'utf8')}\nglobalThis.testing = { jugadores, plataformas, balas, itemsEnSuelo, obstaculos, addPlayer, unirseJugador, equiparArma, createBullet, reloadWeapon, exchangeWithPlatform, dropItem, interactuar, moverEntidad, colisionaConObstaculo, respawn, recogerObjeto };`, sandbox);
  const game = sandbox.testing;
  vm.runInContext('Object.assign(testing, { zonaSegura, aplicarDañoZona, cofres, procesarRespawns });', sandbox);
  for (const id of Object.keys(game.jugadores)) delete game.jugadores[id];
  const simulationTick = intervals.at(-1);
  return { game, tick: simulationTick, advance: (milliseconds) => { now += milliseconds; }, finishTimeouts: () => timeouts.splice(0).forEach((callback) => callback()) };
}

test('Arbustos: ocultan desde fuera, permiten entrar y disparar hacia fuera', () => {
  const Buildings = require('../public/js/buildings.js');
  const { game, tick } = loadGame();
  const bush = game.obstaculos.find((object) => object.tipo === 'arbusto');
  assert.ok(bush);
  const center = { x: bush.x + bush.width / 2, y: bush.y + bush.height / 2 };
  const outside = { x: bush.x + bush.width + 30, y: center.y };
  assert.equal(Buildings.concealed(game.obstaculos, center, outside), true);
  assert.equal(Buildings.concealed(game.obstaculos, center, center), false);
  assert.equal(Buildings.concealed(game.obstaculos, outside, center), false);
  assert.equal(Buildings.walls(bush).length, 0);
  game.addPlayer('player'); game.unirseJugador('player', 'Oculto');
  const player = game.jugadores.player;
  game.moverEntidad(player, center.x, center.y);
  assert.equal(player.x, center.x);
  assert.equal(player.y, center.y);
  game.createBullet('player', { ...center, angle: 0 });
  for (let step = 0; step < 4; step += 1) tick();
  assert.ok(game.balas.some((bullet) => bullet.x > bush.x + bush.width));
});

test('Tormenta: daño entero cada segundo, fases de 1 a 5 y protección interior', () => {
  const { game, advance, finishTimeouts } = loadGame();
  game.addPlayer('outside'); game.addPlayer('inside'); game.addPlayer('waiting');
  game.unirseJugador('outside', 'Fuera'); game.unirseJugador('inside', 'Dentro');
  const outside = game.jugadores.outside;
  outside.x = 0; outside.y = 0; outside.escudo = 100;
  game.aplicarDañoZona();
  assert.equal(outside.vida, 100);
  for (let phase = 1; phase <= 7; phase += 1) {
    finishTimeouts();
    const damage = Math.min(phase, 5);
    assert.equal(game.zonaSegura.dañoPorSegundo, damage);
    Object.assign(game.jugadores.inside, { x: game.zonaSegura.x, y: game.zonaSegura.y });
    const previous = outside.vida;
    advance(999); game.aplicarDañoZona();
    assert.equal(outside.vida, previous);
    advance(1); game.aplicarDañoZona();
    assert.equal(outside.vida, previous - damage);
    game.aplicarDañoZona();
    assert.equal(outside.vida, previous - damage);
    assert.equal(game.jugadores.inside.vida, 100);
    assert.equal(game.jugadores.waiting.vida, 100);
    assert.equal(outside.escudo, 100);
  }
  outside.vida = 3;
  advance(1000); game.aplicarDañoZona();
  assert.equal(outside.muerto, true);
  assert.equal(outside.vida, 0);
});

test('Puertas: abrir cerca, atravesar, impedir cierre sobre jugadores', () => {
  const { game } = loadGame();
  game.addPlayer('player');
  game.unirseJugador('player', 'Jugador');
  const player = game.jugadores.player;
  const building = game.obstaculos[0];
  const doorX = building.x + building.width / 2;
  const doorY = building.y + building.height - 9;
  assert.equal(game.colisionaConObstaculo(doorX, doorY), true);
  assert.equal(game.colisionaConObstaculo(building.x + 60, building.y + 60), false);
  Object.assign(player, { x: doorX, y: doorY + 65 });
  game.interactuar('player');
  assert.equal(building.puertaAbierta, true);
  assert.equal(game.colisionaConObstaculo(doorX, doorY), false);
  game.moverEntidad(player, doorX, doorY);
  game.interactuar('player');
  assert.equal(building.puertaAbierta, true);
  game.moverEntidad(player, doorX, doorY - 65);
  game.interactuar('player');
  assert.equal(building.puertaAbierta, false);
  assert.equal(game.colisionaConObstaculo(building.x, building.y + 100), true);
});

test('Los puños no se descartan ni se intercambian; un arma sí', () => {
  const { game } = loadGame();
  game.addPlayer('player');
  const player = game.jugadores.player;
  game.plataformas[0].x = player.x;
  game.plataformas[0].y = player.y;
  game.plataformas[0].objeto = 'sniper';
  game.plataformas[0].balas = 5;
  const initialDrops = game.itemsEnSuelo.length;
  game.dropItem('player', { slot: 0 });
  game.exchangeWithPlatform('player');
  assert.equal(player.inventario[0], 'puños');
  assert.equal(game.plataformas[0].objeto, 'sniper');
  assert.equal(game.itemsEnSuelo.length, initialDrops);
  player.slotSeleccionado = 1;
  game.exchangeWithPlatform('player');
  assert.equal(player.inventario[1], 'sniper');
  game.dropItem('player', { slot: 1 });
  assert.equal(player.inventario[1], null);
  assert.equal(game.itemsEnSuelo.at(-1).item, 'sniper');
  assert.equal(game.itemsEnSuelo.at(-1).balas, 5);
  assert.equal(player.inventario[0], 'puños');
});

test('Reservas finitas: recarga parcial, acumulación y cancelar recarga al cambiar', () => {
  const { game, finishTimeouts } = loadGame();
  game.addPlayer('player');
  game.unirseJugador('player', 'Jugador');
  const player = game.jugadores.player;
  player.inventario[1] = null;
  player.municionPorSlot[1] = null;
  game.recogerObjeto(player, 'sniper', 1);
  player.slotSeleccionado = 1;
  game.equiparArma(player);
  game.reloadWeapon('player');
  assert.equal(player.recargando, false);
  game.recogerObjeto(player, 'ammo_sniper', null, 2);
  game.reloadWeapon('player');
  finishTimeouts();
  assert.equal(player.balasEnCargador, 3);
  assert.equal(player.reservas.sniper, 0);
  game.recogerObjeto(player, 'sniper', 4);
  game.recogerObjeto(player, 'ammo_sniper', null, 5);
  assert.equal(player.reservas.sniper, 9);
  assert.equal(player.inventario.filter((item) => item === 'sniper').length, 1);
  game.reloadWeapon('player');
  player.slotSeleccionado = 0;
  game.equiparArma(player);
  player.slotSeleccionado = 1;
  game.equiparArma(player);
  finishTimeouts();
  assert.equal(player.balasEnCargador, 3);
  assert.equal(player.reservas.sniper, 9);
  game.dropItem('player', { slot: 1 });
  const dropped = game.itemsEnSuelo.at(-1);
  game.recogerObjeto(player, dropped.item, dropped.balas);
  game.equiparArma(player);
  assert.equal(player.balasEnCargador, 3);
  assert.equal(player.reservas.sniper, 9);
});

test('Solo los bots recargan sin reservas y su botín sigue siendo finito', () => {
  const { game, finishTimeouts } = loadGame();
  game.addPlayer('bot'); game.addPlayer('human');
  game.unirseJugador('bot', 'Bot'); game.unirseJugador('human', 'Humano');
  const bot = game.jugadores.bot;
  const human = game.jugadores.human;
  bot.esBot = true;
  for (const player of [bot, human]) {
    player.inventario[1] = null;
    player.reservas.pistola = 0;
    game.recogerObjeto(player, 'pistola', 0);
    player.slotSeleccionado = 1;
    game.equiparArma(player);
  }
  for (let round = 0; round < 3; round += 1) {
    bot.balasEnCargador = 0;
    bot.municionPorSlot[1] = 0;
    game.reloadWeapon('bot');
    game.reloadWeapon('human');
    assert.equal(bot.recargando, true);
    assert.equal(bot.balasEnCargador, 0);
    assert.equal(human.recargando, false);
    finishTimeouts();
    assert.equal(bot.balasEnCargador, 12);
    assert.equal(bot.reservas.pistola, 0);
    assert.equal(human.balasEnCargador, 0);
  }
  game.respawn(bot, human);
  assert.equal(human.reservas.pistola, 12);
  assert.ok(Object.values(human.reservas).every(Number.isFinite));
});

test('Eliminar transfiere balas compatibles y deja el resto sin duplicar', () => {
  const { game } = loadGame();
  game.itemsEnSuelo.length = 0;
  game.addPlayer('killer'); game.addPlayer('victim');
  const killer = game.jugadores.killer;
  const victim = game.jugadores.victim;
  game.recogerObjeto(killer, 'rifle', 10);
  game.recogerObjeto(victim, 'rifle', 7);
  game.recogerObjeto(victim, 'sniper', 2);
  victim.reservas.rifle = 20;
  victim.reservas.sniper = 8;
  game.respawn(victim, killer);
  assert.equal(killer.reservas.rifle, 27);
  assert.equal(game.itemsEnSuelo.find((drop) => drop.item === 'rifle').balas, 0);
  assert.equal(game.itemsEnSuelo.find((drop) => drop.item === 'sniper').balas, 2);
  assert.equal(game.itemsEnSuelo.find((drop) => drop.item === 'ammo_sniper').cantidad, 8);
  assert.equal(game.itemsEnSuelo.some((drop) => drop.item === 'ammo_rifle'), false);
  assert.equal(Object.values(victim.reservas).reduce((total, amount) => total + amount, 0), 0);
});

test('Sniper: daño y cadencia; una puerta cerrada detiene el proyectil', () => {
  const { game, tick, advance } = loadGame();
  game.addPlayer('shooter'); game.addPlayer('target');
  game.unirseJugador('shooter', 'Tirador'); game.unirseJugador('target', 'Objetivo');
  const shooter = game.jugadores.shooter;
  shooter.inventario[1] = null;
  const target = game.jugadores.target;
  Object.assign(shooter, { x: 730, y: 760, slotSeleccionado: 1 });
  Object.assign(target, { x: 835, y: 760, escudo: 20 });
  game.recogerObjeto(shooter, 'sniper', 5);
  game.equiparArma(shooter);
  game.createBullet('shooter', { x: shooter.x, y: shooter.y, angle: 0 });
  game.createBullet('shooter', { x: shooter.x, y: shooter.y, angle: 0 });
  assert.equal(game.balas.length, 1);
  assert.equal(shooter.balasEnCargador, 4);
  tick();
  assert.equal(target.vida, 55);
  assert.equal(target.escudo, 0);
  const building = game.obstaculos[0];
  Object.assign(shooter, { x: building.x + building.width / 2, y: building.y + building.height + 46 });
  advance(1400);
  game.createBullet('shooter', { x: shooter.x, y: shooter.y, angle: -Math.PI / 2 });
  tick();
  assert.equal(game.balas.length, 0);
  game.interactuar('shooter');
  advance(1400);
  game.createBullet('shooter', { x: shooter.x, y: shooter.y, angle: -Math.PI / 2 });
  tick();
  assert.equal(game.balas.length, 1);
});

test('Rifle permite tres disparos por segundo y supera la cadencia de pistola', () => {
  for (const [weapon, expected] of [['rifle', 9], ['pistola', 5], ['escopeta', 3]]) {
    const { game, advance } = loadGame();
    game.addPlayer('player'); game.unirseJugador('player', 'Jugador');
    const player = game.jugadores.player;
    player.inventario[1] = weapon;
    player.municionPorSlot[1] = 30;
    game.equiparArma(player);
    for (let elapsed = 0; elapsed < 3000; elapsed += 1) {
      game.createBullet('player', { x: player.x, y: player.y, angle: 0 });
      advance(1);
    }
    assert.equal(game.balas.length, expected * (weapon === 'escopeta' ? 3 : 1));
    assert.equal(player.balasEnCargador, 30 - expected);
  }
});

test('Equipo inicial y reaparición dan pistola 12/24 y conservan puños', () => {
  const { game, advance } = loadGame();
  game.addPlayer('player'); game.unirseJugador('player', 'Jugador');
  const player = game.jugadores.player;
  for (let cycle = 0; cycle < 2; cycle += 1) {
    assert.equal(player.inventario[0], 'puños');
    assert.equal(player.inventario[player.slotSeleccionado], 'pistola');
    assert.equal(player.balasEnCargador, 12);
    assert.equal(player.reservas.pistola, 24);
    game.respawn(player); advance(3000); game.procesarRespawns();
  }
});

test('Cofre abre una vez y entrega arma, balas compatibles y curación', () => {
  const { game } = loadGame();
  game.addPlayer('player'); game.unirseJugador('player', 'Jugador');
  const chest = game.cofres[0];
  Object.assign(game.jugadores.player, { x: chest.x, y: chest.y });
  game.itemsEnSuelo.length = 0;
  game.interactuar('player');
  assert.equal(chest.abierto, true);
  assert.equal(game.itemsEnSuelo.length, 3);
  const weapon = game.itemsEnSuelo[0];
  assert.equal(game.itemsEnSuelo[1].item, `ammo_${weapon.item}`);
  assert.ok(['botiquin', 'escudo_pocion'].includes(game.itemsEnSuelo[2].item));
  game.interactuar('player');
  assert.equal(game.itemsEnSuelo.length, 3);
});

test('Rareza mejora daño, comparte reservas y persiste al soltar', () => {
  const { game, advance } = loadGame();
  game.addPlayer('player'); game.unirseJugador('player', 'Jugador');
  const player = game.jugadores.player;
  for (const rarity of [0, 1, 2]) {
    game.recogerObjeto(player, 'pistola', 3, null, rarity);
    advance(1000);
    game.createBullet('player', { x: player.x, y: player.y, angle: 0 });
    assert.equal(game.balas.at(-1).daño, 15 * (1 + rarity * 0.0015));
    assert.equal(player.rarezas[1], rarity);
  }
  assert.equal(player.reservas.pistola, 33);
  game.dropItem('player', { slot: 1 });
  assert.equal(game.itemsEnSuelo.at(-1).rareza, 2);
});