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
  const messages = [];
  let now = 10000;
  class Clock extends Date { static now() { return now; } }
  const sandbox = vm.createContext({
    __dirname: path.dirname(serverPath), process: { argv: [], env: {} }, console: { log() {} }, Date: Clock,
    setTimeout: (callback) => { timeouts.push(callback); return timeouts.length; }, clearTimeout() {},
    setInterval: (callback) => { intervals.push(callback); return intervals.length; }, clearInterval() {},
    require(name) {
      if (name === 'http') return { createServer: () => ({ listen() {} }) };
      if (name === 'socket.io') return { Server: class { on() {} emit(type, data) { messages.push({ type, data }); } } };
      return localRequire(name);
    },
  });
  vm.runInContext(`${fs.readFileSync(serverPath, 'utf8')}\nglobalThis.testing = { jugadores, plataformas, balas, itemsEnSuelo, obstaculos, addPlayer, unirseJugador, equiparArma, createBullet, reloadWeapon, exchangeWithPlatform, dropItem, interactuar, moverEntidad, colisionaConObstaculo, respawn, recogerObjeto };`, sandbox);
  const game = sandbox.testing;
  game.unirseSala = game.unirseJugador;
  vm.runInContext('Object.assign(testing, { processClientMessage, tactical: () => preparacionTactica, configMapa, actualizarVotacionMapa, estadoEquipos, aplicarZonasEspeciales, procesarGranadas, granadas, resolverBaja, reanimar, procesarAbatidos, removePlayer });', sandbox);
  vm.runInContext('Object.assign(testing, { zonaSegura, actualizarZonaSegura, aplicarDañoZona, cofres, procesarRespawns, updateMovement, actualizarBots, iniciarPartida, equipoInicial, finalizarPartida, iniciarDesdeSala, estadoSala });', sandbox);
  for (const id of Object.keys(game.jugadores)) delete game.jugadores[id];
  // Estas pruebas aíslan combate; la admisión y el inicio real se prueban por red.
  game.unirseJugador = (id, nombre) => {
    game.jugadores[id].unido = true;
    game.jugadores[id].nombre = nombre;
    game.equipoInicial(game.jugadores[id]);
    game.iniciarPartida();
  };
  const simulationTick = intervals.at(-1);
  return { game, messages, tick: simulationTick, matchSecond: () => intervals.at(-1)(),
    now: () => now, advance: (milliseconds) => { now += milliseconds; }, finishTimeouts: () => timeouts.splice(0).forEach((callback) => callback()) };
}

function revivalGame() {
  const result = loadGame();
  const { game, advance } = result;
  for (const id of ['a', 'b', 'c', 'd']) game.addPlayer(id);
  game.unirseSala('a', 'A', null, 'nova', { modoArena: 'equipos', cantidadBots: 0 });
  for (const id of ['b', 'c', 'd']) game.unirseSala(id, id);
  game.iniciarDesdeSala('a'); advance(4000);
  game.obstaculos.length = 0; require('../public/js/zones').zones.length = 0;
  for (const id of ['a', 'b', 'c', 'd']) {
    Object.assign(game.jugadores[id], { equipo: ['a', 'b'].includes(id) ? 'azul' : 'rojo',
      x: id === 'c' ? 1000 : id === 'd' ? 2000 : 1140, y: id === 'b' ? 1080 : 1000 });
  }
  return result;
}

test('Red: sonda disponible fuera de partida y solo devuelve secuencia validada', () => {
  const { game } = loadGame();
  const replies = [], client = { emit: (type, data) => replies.push({ type, data }) };
  game.processClientMessage('a', { type: 'sondaRed', data: { seq: 42, extra: 'no' } }, client);
  assert.equal(replies[0].type, 'respuestaRed');
  assert.equal(replies[0].data.seq, 42);
  assert.equal(Object.keys(replies[0].data).length, 1);
  for (const seq of [NaN, -1, {}, '42', Infinity]) game.processClientMessage('a', { type: 'sondaRed', data: { seq } }, client);
  assert.equal(replies.length, 1);
});

test('Estadísticas: daño efectivo, precisión por proyectil, curación real y resultado congelado', () => {
  const { game, tick, advance, messages } = revivalGame();
  const a = game.jugadores.a, target = game.jugadores.c;
  Object.assign(a, { x: 1000, y: 1000 });
  Object.assign(target, { x: 1080, y: 1000, vida: 5, escudo: 5 });
  game.jugadores.d.x = 4000; game.jugadores.b.x = 4000;
  game.createBullet('a', { x: a.x, y: a.y, angle: 0 });
  game.createBullet('a', { x: a.x, y: a.y, angle: 0 });
  tick();
  assert.equal(a.estadisticas.proyectiles, 1);
  assert.equal(a.estadisticas.impactos, 1);
  assert.equal(a.estadisticas.daño, 10);
  assert.equal(target.abatido, true);
  a.vida = 90; a.inventario[2] = 'botiquin'; a.slotSeleccionado = 2;
  game.createBullet('a', { x: a.x, y: a.y, angle: 0 });
  assert.equal(a.estadisticas.curacion, 10);
  assert.equal(a.estadisticas.proyectiles, 1);
  require('../public/js/zones').zones.splice(0, 0, { tipo: 'curacion', x: a.x, y: a.y, radio: 10 });
  a.vida = 99.9;
  game.aplicarZonasEspeciales();
  assert.ok(Math.abs(a.estadisticas.curacion - 10.1) < 1e-8);
  require('../public/js/zones').zones.length = 0;
  game.respawn(a);
  advance(3000); game.procesarRespawns();
  assert.equal(a.estadisticas.daño, 10);
  game.finalizarPartida();
  const result = messages.find(message => message.type === 'finDeJuego').data.find(player => player.id === 'a');
  assert.equal(result.estadisticas.daño, 10);
  assert.equal(game.jugadores.a.estadisticas.daño, 0);
  assert.equal(result.estadisticas.proyectiles, 1);
});

test('Estadísticas: reanimación suma solo al completarse y muerte cuenta una vez', () => {
  const { game, advance } = revivalGame();
  const a = game.jugadores.a, b = game.jugadores.b;
  game.resolverBaja(b, game.jugadores.c, 'rifle');
  game.reanimar('a', { activo: true }); game.procesarAbatidos();
  assert.equal(a.estadisticas.reanimaciones, 0);
  for (let i = 0; i < 30; i++) {
    advance(100); game.reanimar('a', { activo: true }); game.procesarAbatidos();
  }
  assert.equal(a.estadisticas.reanimaciones, 1);
  assert.equal(b.vida, 25);
  game.procesarAbatidos();
  assert.equal(a.estadisticas.reanimaciones, 1);
  game.resolverBaja(b, game.jugadores.c, 'rifle');
  assert.equal(b.estadisticas.muertes, 0);
  game.resolverBaja(b, game.jugadores.c, 'rifle');
  assert.equal(b.estadisticas.muertes, 1);
});

test('Chat rápido: cuatro reacciones autoritativas, duración y límite de frecuencia', () => {
  const { game, advance, now } = revivalGame();
  const replies = [], client = { emit: (type, data) => replies.push({ type, data }) };
  for (const reaccion of ['like', 'dislike', 'risa', 'enojo']) {
    game.processClientMessage('a', { type: 'reaccion', data: { reaccion, reaccionHasta: Infinity, id: 'b' } }, client);
    assert.equal(game.jugadores.a.reaccion, reaccion);
    assert.equal(game.jugadores.a.reaccionHasta, now() + 3000);
    assert.notEqual(game.jugadores.b.reaccion, reaccion);
    advance(2000);
  }
  game.processClientMessage('a', { type: 'reaccion', data: { reaccion: '<script>' } }, client);
  assert.equal(replies.at(-1).type, 'reaccionRechazada');
  assert.match(replies.at(-1).data.motivo, /válida/);
  game.processClientMessage('a', { type: 'reaccion', data: { reaccion: 'like' } }, client);
  const until = game.jugadores.a.reaccionHasta;
  game.processClientMessage('a', { type: 'reaccion', data: { reaccion: 'risa' } }, client);
  assert.equal(game.jugadores.a.reaccion, 'like');
  assert.equal(game.jugadores.a.reaccionHasta, until);
  assert.match(replies.at(-1).data.motivo, /Espera/);
  advance(1999);
  game.processClientMessage('a', { type: 'reaccion', data: { reaccion: 'risa' } }, client);
  assert.equal(game.jugadores.a.reaccion, 'like');
  advance(1);
  game.processClientMessage('a', { type: 'reaccion', data: { reaccion: 'risa' } }, client);
  assert.equal(game.jugadores.a.reaccion, 'risa');
});

test('Chat rápido: bloqueado en preparación, muertos y espectadores; permitido abatido y limpiado entre rondas', () => {
  const { game, advance } = loadGame();
  game.addPlayer('a'); game.addPlayer('b');
  game.unirseSala('a', 'A', null, 'nova', { cantidadBots: 0 });
  game.iniciarDesdeSala('a');
  const send = id => game.processClientMessage(id, { type: 'reaccion', data: { reaccion: 'like' } });
  send('a'); assert.equal(game.jugadores.a.reaccion, null);
  advance(4000);
  send('b'); assert.equal(game.jugadores.b.reaccion, undefined);
  game.jugadores.a.muerto = true; send('a');
  assert.equal(game.jugadores.a.reaccion, null);
  game.jugadores.a.muerto = false; game.jugadores.a.abatido = true; send('a');
  assert.equal(game.jugadores.a.reaccion, 'like');
  game.finalizarPartida();
  assert.equal(game.jugadores.a.reaccion, null);
  assert.equal(game.jugadores.a.reaccionHasta, 0);
});

test('Skins temáticas: el servidor admite las seis y conserva estadísticas idénticas', () => {
  for (const id of ['duna', 'siroco', 'cosmo', 'pulsar', 'ceiba', 'ranger']) {
    const { game } = loadGame();
    game.addPlayer('a');
    game.unirseSala('a', 'A', null, id, { cantidadBots: 0 });
    game.iniciarDesdeSala('a');
    assert.equal(game.jugadores.a.skin, id);
    assert.equal(game.jugadores.a.vida, 100);
    assert.equal(game.jugadores.a.escudo, 0);
    assert.equal(game.jugadores.a.balasEnCargador, 12);
  }
});

test('Desierto: entrada de carpa siempre libre, paredes y cactus bloquean, suministros accesibles', () => {
  const { game, advance } = loadGame();
  game.addPlayer('a');
  game.unirseSala('a', 'A', null, 'duna', { mapa: 'desierto', cantidadBots: 0 });
  game.iniciarDesdeSala('a'); advance(4000);
  const tent = game.obstaculos.find(object => object.tipo === 'carpa');
  const player = game.jugadores.a;
  assert.equal(game.cofres.length, 4);
  const centerX = tent.x + tent.width / 2;
  assert.equal(game.colisionaConObstaculo(centerX, tent.y + tent.height), false);
  assert.equal(game.colisionaConObstaculo(tent.x, tent.y + 100), false);
  assert.equal(game.colisionaConObstaculo(centerX - tent.width / 4, tent.y + tent.height / 2), true);
  Object.assign(player, { x: centerX, y: tent.y + tent.height + 40 });
  game.updateMovement('a', { x: centerX, y: tent.y + 130, angle: 0 });
  assert.equal(player.y, tent.y + 130);
  game.interactuar('a');
  assert.equal(game.cofres[0].abierto, true);
  const cactus = game.obstaculos.find(object => object.tipo === 'cactus');
  assert.equal(game.colisionaConObstaculo(cactus.x + cactus.width / 2, cactus.y + cactus.height / 2), true);
  assert.equal(game.configMapa().portales.length, 0);
});

test('Portales autoritativos: ida y vuelta, cooldown, preparación, abatidos y sincronización de movimiento', () => {
  const { game, advance } = loadGame();
  game.addPlayer('a');
  game.unirseSala('a', 'A', null, 'nova', { mapa: 'orbital', cantidadBots: 0 });
  game.iniciarDesdeSala('a');
  const portals = game.configMapa().portales;
  const source = portals[0], destination = portals.find(portal => portal.id === source.destinoId);
  const player = game.jugadores.a;
  Object.assign(player, { x: source.x, y: source.y });
  game.processClientMessage('a', { type: 'intercambiar', data: { destinoId: 'inventado' } });
  assert.equal(player.x, source.x);
  advance(4000);
  for (const state of ['abatido', 'muerto', 'reanimando']) {
    player[state] = true;
    game.interactuar('a'); assert.equal(player.x, source.x);
    player[state] = false;
  }
  player.x += 150; game.interactuar('a'); assert.equal(player.x, source.x + 150);
  player.x = source.x;
  game.processClientMessage('a', { type: 'intercambiar', data: { x: 0, y: 0 } });
  assert.equal(player.x, destination.x); assert.equal(player.y, destination.y);
  game.updateMovement('a', { x: source.x, y: source.y, angle: 0 });
  assert.equal(player.x, destination.x);
  game.interactuar('a'); assert.equal(player.x, destination.x);
  advance(2999); game.interactuar('a'); assert.equal(player.x, destination.x);
  advance(1); game.interactuar('a');
  assert.equal(player.x, source.x); assert.equal(player.y, source.y);
  assert.equal(player.vida, 100); assert.equal(player.escudo, 0);
});

test('Portales: los bots usan un enlace que acorta su ruta hacia el enemigo', () => {
  const { game, advance } = loadGame();
  game.addPlayer('a');
  game.unirseSala('a', 'A', null, 'nova', { mapa: 'orbital', cantidadBots: 5 });
  game.iniciarDesdeSala('a'); advance(4000);
  const source = game.configMapa().portales[0];
  const destination = game.configMapa().portales.find(portal => portal.id === source.destinoId);
  const bot = game.jugadores.bot1;
  for (const player of Object.values(game.jugadores)) player.muerto = true;
  Object.assign(bot, { muerto: false, x: source.x, y: source.y });
  Object.assign(game.jugadores.a, { muerto: false, x: destination.x + 100, y: destination.y });
  game.actualizarBots();
  assert.equal(bot.x, destination.x); assert.equal(bot.y, destination.y);
});

test('Abatidos: bala letal conserva inventario, permite arrastrarse y bloquea acciones y curación', () => {
  const { game, tick, advance } = revivalGame();
  const victim = game.jugadores.a;
  const inventory = [...victim.inventario];
  victim.vida = 1;
  game.createBullet('c', { x: 1000, y: 1000, angle: 0 });
  for (let i = 0; i < 3; i += 1) tick();
  assert.equal(victim.abatido, true);
  assert.equal(victim.muerto, false);
  assert.equal(victim.vida, 30);
  assert.deepEqual([...victim.inventario], inventory);
  assert.equal(game.estadoEquipos().puntos.rojo, 0);
  const bullets = game.balas.length, items = game.itemsEnSuelo.length;
  game.createBullet('a', { x: victim.x, y: victim.y, angle: 0 });
  game.reloadWeapon('a'); game.dropItem('a');
  victim.inventario[2] = 'granada';
  game.processClientMessage('a', { type: 'lanzarGranada', data: { angle: 0 } });
  assert.equal(game.granadas.length, 0);
  assert.equal(game.balas.length, bullets);
  assert.equal(game.itemsEnSuelo.length, items);
  assert.equal(victim.recargando, false);
  const x = victim.x, y = victim.y;
  advance(100); game.updateMovement('a', { x: x + 500, y, angle: 0 });
  assert.ok(victim.x > x && victim.x - x <= 8.001);
  require('../public/js/zones').zones.push({ tipo: 'curacion', x: victim.x, y, radio: 100 },
    { tipo: 'escudo', x: victim.x, y, radio: 100 });
  for (let i = 0; i < 30; i += 1) game.aplicarZonasEspeciales();
  assert.equal(victim.vida, 30); assert.equal(victim.escudo, 0);
});

test('Abatidos: mantener tres segundos levanta con exactamente 25 de vida, sin escudo ni baja', () => {
  const { game, advance } = revivalGame();
  game.resolverBaja(game.jugadores.a, game.jugadores.c, 'pistola');
  for (let i = 0; i <= 30; i += 1) {
    game.processClientMessage('b', { type: 'reanimar', data: { activo: true, vida: 100, progreso: 1 } });
    game.procesarAbatidos();
    if (i < 30) { assert.equal(game.jugadores.a.abatido, true); advance(100); }
  }
  assert.equal(game.jugadores.a.abatido, false);
  assert.equal(game.jugadores.a.vida, 25);
  assert.equal(game.jugadores.a.escudo, 0);
  assert.equal(game.estadoEquipos().puntos.rojo, 0);
});

test('Abatidos: los perdigones del disparo que lo abate no pueden rematarlo inmediatamente', () => {
  const { game, tick } = revivalGame();
  const shooter = game.jugadores.c;
  shooter.inventario[1] = 'escopeta'; shooter.municionPorSlot[1] = 6;
  game.equiparArma(shooter);
  Object.assign(game.jugadores.a, { x: 1060, vida: 1 });
  game.createBullet('c', { x: 1000, y: 1000, angle: 0 });
  for (let i = 0; i < 10; i += 1) tick();
  assert.equal(game.jugadores.a.abatido, true);
  assert.equal(game.jugadores.a.vida, 30);
  assert.equal(game.estadoEquipos().puntos.rojo, 0);
});

test('Abatidos: soltar, alejarse o perder conexión cancela el progreso; no se puede levantar enemigos ni a través de paredes', () => {
  for (const cancel of ['soltar', 'alejarse', 'conexion', 'muro']) {
    const { game, advance } = revivalGame();
    const target = game.jugadores.a, rescuer = game.jugadores.b;
    game.resolverBaja(target, game.jugadores.c, 'rifle');
    game.reanimar('c', { activo: true }); game.procesarAbatidos();
    assert.equal(target.reanimadorId, null);
    game.reanimar('b', { activo: true }); game.procesarAbatidos();
    advance(200); game.reanimar('b', { activo: true }); game.procesarAbatidos();
    assert.ok(target.progresoReanimacion > 0);
    if (cancel === 'soltar') game.reanimar('b', { activo: false });
    if (cancel === 'alejarse') rescuer.x += 500;
    if (cancel === 'conexion') advance(400);
    if (cancel === 'muro') game.obstaculos.push({ tipo: 'roca', x: 1120, y: 1030, width: 40, height: 20 });
    game.procesarAbatidos();
    assert.equal(target.progresoReanimacion, 0, cancel);
    assert.equal(target.abatido, true);
  }
});

test('Abatidos: desangrado y remate acreditan una sola baja, después reaparece normalmente', () => {
  for (const finish of ['tiempo', 'bala', 'granada']) {
    const { game, advance, tick } = revivalGame();
    const target = game.jugadores.a;
    game.resolverBaja(target, game.jugadores.c, 'pistola');
    if (finish === 'tiempo') { advance(20000); game.procesarAbatidos(); }
    if (finish === 'bala') {
      advance(1000);
      target.vida = 1; game.createBullet('c', { x: 1000, y: 1000, angle: 0 });
      for (let i = 0; i < 3; i += 1) tick();
    }
    if (finish === 'granada') {
      game.granadas.push({ x: target.x, y: target.y, angle: 0, lanzadorId: 'c', equipo: 'rojo',
        distancia: 350, explotaEn: 0 });
      game.procesarGranadas();
    }
    assert.equal(target.muerto, true, finish);
    assert.equal(target.abatido, false);
    assert.equal(game.estadoEquipos().puntos.rojo, 1);
    game.procesarAbatidos();
    assert.equal(game.estadoEquipos().puntos.rojo, 1);
    advance(3000); game.procesarRespawns();
    assert.equal(target.muerto, false); assert.equal(target.vida, 100);
    assert.equal(target.abatido, false);
  }
});

test('Abatidos: equipo completo abatido o sin compañero conectado pasa a muerte y reinicia al reaparecer', () => {
  for (const disconnect of [false, true]) {
    const { game } = revivalGame();
    game.resolverBaja(game.jugadores.a, game.jugadores.c, 'rifle');
    if (disconnect) { game.removePlayer('b'); game.procesarAbatidos(); }
    else game.resolverBaja(game.jugadores.b, game.jugadores.c, 'rifle');
    assert.equal(game.jugadores.a.muerto, true);
    assert.equal(game.estadoEquipos().puntos.rojo, disconnect ? 1 : 2);
  }
});

test('Abatidos: bots rescatan compañeros y las zonas letales también abaten sin conceder curación', () => {
  const { game, advance } = revivalGame();
  game.jugadores.b.esBot = true;
  game.jugadores.a.vida = 0.01;
  require('../public/js/zones').zones.push({ tipo: 'contaminacion', x: 1140, y: 1000, radio: 30 });
  game.aplicarZonasEspeciales();
  assert.equal(game.jugadores.a.abatido, true);
  require('../public/js/zones').zones.length = 0;
  for (let i = 0; i <= 30; i += 1) {
    game.actualizarBots(); game.procesarAbatidos();
    if (i < 30) advance(100);
  }
  assert.equal(game.jugadores.a.abatido, false);
  assert.equal(game.jugadores.a.vida, 25);
});

test('Resultados incluyen todos los puestos y el reinicio limpia las puntuaciones', () => {
  const { game, messages, finishTimeouts } = loadGame();
  for (let i = 0; i < 5; i++) {
    game.addPlayer(`p${i}`); game.unirseJugador(`p${i}`, `Jugador ${i}`);
    game.jugadores[`p${i}`].kills = i;
  }
  game.finalizarPartida();
  const results = messages.find(m => m.type === 'finDeJuego').data;
  assert.equal(results.length, 5);
  assert.equal(results[0].kills, 4);
  assert.equal(results[4].kills, 0);
  finishTimeouts();
  assert.ok(Object.values(game.jugadores).every(j => j.kills === 0 && !j.unido));
  assert.equal(game.estadoSala().anfitrionId, null);
  assert.ok(messages.some(m => m.type === 'reinicioPartida'));
});

test('Duelo: dos humanos se separan, cuatro quedan 2/2 y los bots también se equilibran', () => {
  const { game } = loadGame();
  for (const id of ['a', 'b', 'c', 'd']) game.addPlayer(id);
  game.unirseSala('a', 'A', null, 'nova', { modoArena: 'equipos', cantidadBots: 5 });
  game.unirseSala('b', 'B', null, 'pulse', { equipo: game.jugadores.a.equipo, modoArena: 'clasico' });
  assert.notEqual(game.jugadores.a.equipo, game.jugadores.b.equipo);
  game.unirseSala('c', 'C'); game.unirseSala('d', 'D');
  assert.equal(game.estadoSala().jugadores.filter(player => player.equipo === 'azul').length, 2);
  game.iniciarDesdeSala('a');
  assert.equal(game.estadoSala().reglas.modoArena, 'equipos');
  assert.equal(game.tactical(), null);
  const bots = Object.values(game.jugadores).filter(player => player.esBot);
  assert.equal(bots.length, 5);
  assert.ok([2, 3].includes(bots.filter(player => player.equipo === 'azul').length));
});

test('Duelo: balas y puños atraviesan compañeros sin daño y solo eliminan enemigos', () => {
  for (const weapon of ['pistola', 'puños']) {
    const { game, tick, advance } = loadGame();
    for (const id of ['a', 'b', 'c']) game.addPlayer(id);
    game.unirseSala('a', 'A', null, 'nova', { modoArena: 'equipos', cantidadBots: 0 });
    game.unirseSala('b', 'B'); game.unirseSala('c', 'C');
    game.iniciarDesdeSala('a'); advance(4000);
    game.obstaculos.length = 0;
    require('../public/js/zones').zones.length = 0;
    Object.assign(game.jugadores.a, { equipo: 'azul', x: 1000, y: 1000 });
    Object.assign(game.jugadores.b, { equipo: 'azul', x: 1060, y: 1000, escudo: 20 });
    Object.assign(game.jugadores.c, { equipo: 'rojo', x: weapon === 'puños' ? 1080 : 1140, y: 1000, vida: 1 });
    if (weapon === 'puños') { game.jugadores.a.slotSeleccionado = 0; game.equiparArma(game.jugadores.a); }
    game.createBullet('a', { x: 1000, y: 1000, angle: 0 });
    for (let i = 0; i < 5; i += 1) tick();
    assert.equal(game.jugadores.b.vida, 100);
    assert.equal(game.jugadores.b.escudo, 20);
    assert.equal(game.jugadores.c.muerto, true);
    assert.equal(game.jugadores.a.kills, 1);
    assert.equal(game.estadoEquipos().puntos.azul, 1);
    assert.equal(game.estadoEquipos().puntos.rojo, 0);
  }
});

test('Duelo: granadas no dañan compañeros ni al lanzador y suman solo bajas enemigas', () => {
  const { game, advance } = loadGame();
  for (const id of ['a', 'b', 'c']) game.addPlayer(id);
  game.unirseSala('a', 'A', null, 'nova', { modoArena: 'equipos', cantidadBots: 0 });
  game.unirseSala('b', 'B'); game.unirseSala('c', 'C');
  game.iniciarDesdeSala('a'); advance(4000);
  for (const id of ['a', 'b', 'c']) Object.assign(game.jugadores[id], { equipo: id === 'c' ? 'rojo' : 'azul', x: 1000, y: 1000 });
  game.jugadores.c.vida = 1;
  game.jugadores.a.inventario[2] = 'granada';
  game.processClientMessage('a', { type: 'lanzarGranada', data: { angle: 0 } });
  game.granadas[0].x = 1000; game.granadas[0].y = 1000;
  advance(2000); game.procesarGranadas();
  assert.equal(game.jugadores.a.vida, 100);
  assert.equal(game.jugadores.b.vida, 100);
  assert.equal(game.jugadores.c.muerto, true);
  assert.equal(game.estadoEquipos().puntos.azul, 1);
});

test('Duelo: bajas colectivas alcanzan el objetivo aunque nadie lo alcance individualmente', () => {
  const { game, advance, tick, messages } = loadGame();
  for (const id of ['a', 'b', 'c']) game.addPlayer(id);
  game.unirseSala('a', 'A', null, 'nova', { modoArena: 'equipos', cantidadBots: 0, limiteKills: 5 });
  game.unirseSala('b', 'B'); game.unirseSala('c', 'C');
  game.iniciarDesdeSala('a'); advance(4000);
  game.obstaculos.length = 0; require('../public/js/zones').zones.length = 0;
  Object.assign(game.jugadores.a, { equipo: 'azul', x: 1000, y: 1000 });
  Object.assign(game.jugadores.b, { equipo: 'azul', x: 1000, y: 1300 });
  Object.assign(game.jugadores.c, { equipo: 'rojo', x: 1140, y: 1000 });
  for (let i = 0; i < 5; i += 1) {
    const shooter = i % 2 ? 'b' : 'a';
    Object.assign(game.jugadores.c, { muerto: false, vida: 1, y: game.jugadores[shooter].y });
    game.createBullet(shooter, { x: 1000, y: game.jugadores[shooter].y, angle: 0 });
    for (let step = 0; step < 3; step += 1) tick();
    advance(1000);
  }
  const final = messages.find(message => message.type === 'configPartida' && message.data.finalizada);
  assert.equal(final.data.equipos.ganador, 'azul');
  assert.equal(final.data.equipos.puntos.azul, 5);
  const results = messages.find(message => message.type === 'finDeJuego').data;
  assert.equal(results.find(player => player.id === 'a').kills, 3);
  assert.equal(results.find(player => player.id === 'b').kills, 2);
  assert.ok(results.every(player => ['azul', 'rojo'].includes(player.equipo)));
  advance(15000); tick();
  assert.equal(game.estadoSala().activa, true);
  assert.equal(game.estadoSala().reglas.modoArena, 'equipos');
  assert.equal(game.estadoEquipos().puntos.azul, 0);
  assert.equal(game.estadoEquipos().puntos.rojo, 0);
});

test('Duelo: las bajas del equipo sobreviven a salida y reingreso sin cambiar de equipo', () => {
  const { game, advance, tick } = loadGame();
  for (const id of ['a', 'b']) game.addPlayer(id);
  game.unirseSala('a', 'A', null, 'nova', { modoArena: 'equipos', cantidadBots: 0 });
  game.unirseSala('b', 'B'); game.iniciarDesdeSala('a'); advance(4000);
  const team = game.jugadores.a.equipo;
  game.obstaculos.length = 0; require('../public/js/zones').zones.length = 0;
  Object.assign(game.jugadores.a, { x: 1000, y: 1000 });
  Object.assign(game.jugadores.b, { x: 1140, y: 1000, vida: 1 });
  game.createBullet('a', { x: 1000, y: 1000, angle: 0 });
  for (let i = 0; i < 3; i += 1) tick();
  const client = { emit() {} };
  game.processClientMessage('a', { type: 'abandonarPartida' }, client);
  assert.equal(game.estadoEquipos().puntos[team], 1);
  game.unirseSala('a', 'Cambio', client, 'pulse', { equipo: team === 'azul' ? 'rojo' : 'azul' });
  assert.equal(game.jugadores.a.equipo, team);
  assert.equal(game.jugadores.a.kills, 1);
});

for (const tied of [true, false]) {
  test(`Duelo: al agotarse el tiempo ${tied ? 'declara empate' : 'gana el equipo con más bajas'}`, () => {
    const { game, advance, tick, matchSecond, messages } = loadGame();
    for (const id of ['a', 'b']) game.addPlayer(id);
    game.unirseSala('a', 'A', null, 'nova', { modoArena: 'equipos', cantidadBots: 0, duracion: 60 });
    game.unirseSala('b', 'B'); game.iniciarDesdeSala('a'); advance(4000);
    const team = game.jugadores.a.equipo;
    if (!tied) {
      game.obstaculos.length = 0; require('../public/js/zones').zones.length = 0;
      Object.assign(game.jugadores.a, { x: 1000, y: 1000 });
      Object.assign(game.jugadores.b, { x: 1140, y: 1000, vida: 1 });
      game.createBullet('a', { x: 1000, y: 1000, angle: 0 });
      for (let i = 0; i < 3; i += 1) tick();
    }
    for (let i = 0; i < 60; i += 1) matchSecond();
    const final = messages.find(message => message.type === 'configPartida' && message.data.finalizada);
    assert.equal(final.data.equipos.ganador, tied ? null : team);
    assert.equal(final.data.equipos.puntos[team], tied ? 0 : 1);
    assert.ok(messages.some(message => message.type === 'finDeJuego'));
  });
}

test('Duelo: bots ignoran compañeros incluso cuando están más cerca', () => {
  const { game, advance } = loadGame();
  game.addPlayer('a'); game.addPlayer('b');
  game.unirseSala('a', 'A', null, 'nova', { modoArena: 'equipos', cantidadBots: 5 });
  game.unirseSala('b', 'B'); game.iniciarDesdeSala('a'); advance(4000);
  game.obstaculos.length = 0; require('../public/js/zones').zones.length = 0;
  for (const id of ['bot2', 'bot3', 'bot4', 'bot5']) delete game.jugadores[id];
  Object.assign(game.jugadores.bot1, { equipo: 'azul', x: 1000, y: 1000 });
  Object.assign(game.jugadores.a, { equipo: 'azul', x: 1050, y: 1000 });
  Object.assign(game.jugadores.b, { equipo: 'rojo', x: 1000, y: 1200 });
  game.actualizarBots();
  assert.ok(game.jugadores.bot1.y > 1000);
  assert.equal(game.jugadores.bot1.angle, Math.PI / 2);
  assert.equal(game.balas[0].equipo, 'azul');
});

for (const map of ['outpost', 'orbital', 'desierto']) {
  test(`Charcos en ${map}: regeneración autoritativa por segundo, límites, muertos y preparación`, () => {
    const { game, tick, advance } = loadGame();
    game.addPlayer('a');
    game.unirseSala('a', 'A', null, 'nova', { mapa: map, cantidadBots: 0 });
    game.iniciarDesdeSala('a');
    const zones = require('../public/js/zones').zones;
    for (const [type, stat, other] of [['curacion', 'vida', 'escudo'], ['escudo', 'escudo', 'vida']]) {
      const zone = zones.find(zone => zone.tipo === type);
      const player = game.jugadores.a;
      Object.assign(player, { x: zone.x, y: zone.y, vida: 30, escudo: 30, muerto: false });
      if (type === 'curacion') { tick(); assert.equal(player.vida, 30); }
      advance(4000);
      for (let i = 0; i < 30; i += 1) game.aplicarZonasEspeciales();
      assert.ok(Math.abs(player[stat] - 40) < 0.00001);
      assert.equal(player[other], 30);
      for (let i = 0; i < 300; i += 1) game.aplicarZonasEspeciales();
      assert.equal(player[stat], 100);
      Object.assign(player, { vida: 0, escudo: 0, muerto: true });
      game.aplicarZonasEspeciales();
      assert.equal(player.vida, 0); assert.equal(player.escudo, 0);
      Object.assign(player, { x: zone.x + zone.radio + 1, vida: 30, escudo: 30, muerto: false });
      game.aplicarZonasEspeciales();
      assert.equal(player.vida, 30); assert.equal(player.escudo, 30);
    }
  });
}

test('Modo puzzles integra recompensas, compras, bots y combate sin reponer el equipo comprado', () => {
  const { game, tick, advance } = loadGame();
  game.addPlayer('host');
  game.unirseSala('host', 'Host', null, 'nova', { modoArena: 'puzzles', cantidadBots: 5 });
  game.iniciarDesdeSala('host');
  const player = game.jugadores.host;
  const mode = game.tactical();
  assert.ok(mode);
  const initialX = player.x;
  game.processClientMessage('host', { type: 'movimiento', data: { x: 100, y: 100, angle: 0 } });
  assert.equal(player.x, initialX);
  advance(5000); tick();
  const room = mode.accounts.get('host').training;
  for (let i = 0; i < 4; i++) {
    room.active = 0; room.expires = 20000;
    room.player = { x: room.beacons[0].x, y: room.beacons[0].y };
    advance(100); tick();
  }
  assert.equal(mode.snapshot(15400, 'host').players.host.credits, 100);
  tick();
  assert.equal(player.vida, 100);
  advance(59600); tick();
  game.processClientMessage('host', { type: 'comprarEquipo', data: { item: 'rifle', precio: 0 } });
  assert.ok(player.inventario.includes('rifle'));
  assert.equal(player.reservas.rifle, 30);
  assert.equal(mode.accounts.get('host').credits, 0);
  assert.ok(Object.values(game.jugadores).filter(p => p.esBot).every(p => p.inventario.includes('rifle')));
  advance(20000); tick();
  assert.equal(mode.phase(95000).phase, 'cuenta');
  advance(4000); tick();
  assert.ok(player.inventario.includes('rifle'));
  assert.equal(mode.phase(99000).phase, 'combate');
  game.respawn(player); advance(3000); game.procesarRespawns();
  assert.equal(player.inventario.includes('rifle'), false);
  game.finalizarPartida();
  assert.equal(game.tactical(), null);
});

test('Un jugador conserva combate clásico y no permite invitados aunque se soliciten puzzles', () => {
  const { game } = loadGame();
  game.addPlayer('solo'); game.addPlayer('guest');
  game.unirseSala('solo', 'Solo', null, 'pulse', { soloJugador: true, modoArena: 'puzzles', cantidadBots: 0 });
  game.unirseSala('guest', 'Guest');
  assert.equal(game.jugadores.guest.unido, false);
  game.iniciarDesdeSala('solo');
  assert.equal(game.tactical(), null);
  assert.equal(game.estadoSala().reglas.modoArena, 'clasico');
});

test('Mapas: selección autoritativa, votación bloquea sala y ganador obliga la siguiente ronda', () => {
  const { game, messages, advance, tick } = loadGame();
  for (const id of ['host', 'guest', 'spectator']) game.addPlayer(id);
  game.unirseSala('host', 'Host', null, 'pulse', { mapa: 'orbital', cantidadBots: 0 });
  game.unirseSala('guest', 'Guest', null, 'pulse', { mapa: 'outpost' });
  assert.equal(game.estadoSala().reglas.mapa, 'orbital');
  assert.equal(game.configMapa().mapa, 'orbital');
  assert.ok(game.obstaculos.some(object => object.tipo === 'contenedor'));
  game.iniciarDesdeSala('host');
  assert.equal(game.cofres.length, 12);
  assert.ok(game.plataformas.every(platform => !game.colisionaConObstaculo(platform.x, platform.y, 55)));
  game.finalizarPartida();
  assert.equal(game.estadoSala().votacion.segundos, 15);
  assert.deepEqual([...game.estadoSala().votacion.electores].sort(), ['guest', 'host']);
  const errors = [];
  const client = { emit: (type, data) => errors.push({ type, data }) };
  game.unirseSala('host', 'Host', client);
  assert.equal(errors.at(-1).data.motivo, 'votacionEnCurso');
  game.processClientMessage('spectator', { type: 'votarMapa', data: { mapa: 'orbital' } }, client);
  assert.equal(errors.at(-1).type, 'votoRechazado');
  for (const id of ['host', 'guest']) game.processClientMessage(id, { type: 'votarMapa', data: { mapa: 'outpost' } }, client);
  advance(14999); tick();
  assert.equal(game.estadoSala().votacion.activa, true);
  advance(1); tick();
  assert.equal(game.estadoSala().mapaSiguiente, null);
  assert.equal(game.estadoSala().activa, true);
  game.unirseSala('host', 'Host', client, 'pulse', { mapa: 'orbital', cantidadBots: 0 });
  assert.equal(game.estadoSala().reglas.mapa, 'outpost');
  assert.deepEqual([...game.estadoSala().jugadores].map(j => j.nombre).sort(), ['Guest', 'Host']);
  assert.equal(game.jugadores.spectator.unido, false);
  assert.equal(game.configMapa().mapa, 'outpost');
  assert.ok(game.obstaculos.some(object => object.tipo === 'arbol'));
  assert.ok(!game.obstaculos.some(object => object.tipo === 'contenedor'));
  assert.equal(game.cofres.length, 12);
  assert.ok(game.plataformas.every(platform => !game.colisionaConObstaculo(platform.x, platform.y, 55)));
  game.iniciarDesdeSala('host');
  assert.equal(game.estadoSala().activa, true);
  assert.ok(messages.some(message => message.type === 'estadoVotacion' && message.data.ganador === 'outpost'));
});

for (const mode of ['clasico', 'puzzles', 'solo']) {
  test(`Votación reinicia automáticamente ${mode}, conserva reglas y excluye salidas`, () => {
    const { game, messages, advance, tick } = loadGame();
    for (const id of ['host', 'guest', 'spectator']) game.addPlayer(id);
    game.unirseSala('host', 'Host', null, 'nova', {
      mapa: 'outpost', modoArena: mode, soloJugador: mode === 'solo', duracion: 180,
      cantidadBots: 5, dificultadBots: 'dificil', limiteKills: 20,
    });
    if (mode !== 'solo') game.unirseSala('guest', 'Guest');
    game.iniciarDesdeSala('host');
    game.finalizarPartida();
    game.processClientMessage('host', { type: 'votarMapa', data: { mapa: 'orbital' } });
    const client = { emit() {} };
    if (mode !== 'solo') game.processClientMessage('guest', { type: 'abandonarPartida', data: {} }, client);
    advance(15000); tick();
    const room = game.estadoSala();
    assert.equal(room.activa, true);
    assert.equal(room.reglas.mapa, 'orbital');
    assert.equal(room.reglas.cantidadBots, 5);
    assert.equal(room.reglas.dificultadBots, 'dificil');
    assert.equal(room.reglas.duracion, 180);
    assert.equal(room.reglas.limiteKills, 20);
    assert.equal(room.reglas.soloJugador, mode === 'solo');
    assert.equal(room.reglas.modoArena, mode === 'puzzles' ? 'puzzles' : 'clasico');
    assert.deepEqual([...room.jugadores].map(j => j.id), ['host']);
    assert.equal(game.jugadores.host.skin, 'nova');
    assert.equal(game.jugadores.host.kills, 0);
    assert.ok(!game.colisionaConObstaculo(game.jugadores.host.x, game.jugadores.host.y));
    assert.equal(Object.values(game.jugadores).filter(j => j.esBot).length, 5);
    assert.equal(messages.filter(message => message.type === 'configPartida' && message.data.activa).length, 2);
    assert.equal(!!game.tactical(), mode === 'puzzles');
    assert.ok(game.plataformas.every(platform => platform.objeto));
  });
}

test('Sin participantes tras la encuesta no arranca una ronda de bots', () => {
  const { game, messages, advance, tick } = loadGame();
  game.addPlayer('host');
  game.unirseSala('host', 'Host', null, 'nova', { cantidadBots: 5 });
  game.iniciarDesdeSala('host');
  game.finalizarPartida();
  game.processClientMessage('host', { type: 'abandonarPartida' }, { emit() {} });
  advance(15000); tick();
  assert.equal(game.estadoSala().activa, false);
  assert.equal(messages.filter(message => message.type === 'inicioPartida').length, 1);
});

test('Compuertas: interacción independiente, paso abierto y cierre sin aplastar jugadores', () => {
  const { game } = loadGame();
  game.addPlayer('host');
  game.unirseSala('host', 'Host', null, 'nova', { mapa: 'orbital', cantidadBots: 0 });
  game.iniciarDesdeSala('host');
  const room = game.obstaculos.find(object => object.puertas?.length === 2);
  const Buildings = require('../public/js/buildings');
  const door = Buildings.doors(room)[0];
  const player = game.jugadores.host;
  Object.assign(player, { x: door.x + 70, y: door.y + door.height / 2 });
  assert.ok(game.colisionaConObstaculo(door.x + 9, player.y));
  game.interactuar('host');
  assert.equal(room.puertas[0].abierta, true);
  assert.equal(room.puertas[1].abierta, false);
  assert.equal(game.colisionaConObstaculo(door.x + 9, player.y), false);
  player.x = door.x + 9;
  game.interactuar('host');
  assert.equal(room.puertas[0].abierta, true);
  player.x = door.x + 70;
  game.interactuar('host');
  assert.equal(room.puertas[0].abierta, false);
});

test('Bots encuentran un pasillo y abren la compuerta al salir de una sala', () => {
  const { game, advance } = loadGame();
  game.addPlayer('host');
  game.unirseSala('host', 'Host', null, 'nova', { mapa: 'orbital', cantidadBots: 5, dificultadBots: 'dificil' });
  game.iniciarDesdeSala('host');
  for (const id of ['bot2', 'bot3', 'bot4', 'bot5']) delete game.jugadores[id];
  const bot = game.jugadores.bot1;
  Object.assign(bot, { x: 1400, y: 800 });
  Object.assign(game.jugadores.host, { x: 2000, y: 1400 });
  advance(4000);
  for (let i = 0; i < 340; i += 1) {
    advance(1000 / 30);
    game.actualizarBots();
    assert.ok(!game.colisionaConObstaculo(bot.x, bot.y));
  }
  assert.ok(Math.hypot(bot.x - 2000, bot.y - 1400) < 70);
  assert.ok(game.obstaculos.find(object => object.id === 'modulo-0').puertas[0].abierta);
});

test('Estación: la tormenta final y las reapariciones permanecen sobre suelo transitable', () => {
  const { game, advance } = loadGame();
  game.addPlayer('host');
  game.unirseSala('host', 'Host', null, 'nova', { mapa: 'orbital', cantidadBots: 0 });
  game.iniciarDesdeSala('host');
  for (let i = 0; i < 40; i += 1) {
    advance(20000);
    game.actualizarZonaSegura();
    assert.ok(!game.colisionaConObstaculo(game.zonaSegura.x, game.zonaSegura.y));
  }
  assert.equal(game.zonaSegura.radio, 400);
  for (let i = 0; i < 30; i += 1) {
    game.respawn(game.jugadores.host);
    advance(3000); game.procesarRespawns();
    const player = game.jugadores.host;
    assert.ok(!game.colisionaConObstaculo(player.x, player.y));
    assert.ok(Math.hypot(player.x - game.zonaSegura.x, player.y - game.zonaSegura.y) <= game.zonaSegura.radio - 60);
  }
});

for (const [phase, elapsed] of [['instrucciones', 0], ['puzzles', 10000], ['tienda', 65000], ['cuenta', 85000], ['combate', 89000]]) {
  test(`Abandonar durante ${phase} no reinicia la ronda de los demás`, () => {
    const { game, messages, advance, now } = loadGame();
    for (const id of ['host', 'guest']) {
      game.addPlayer(id);
      game.unirseSala(id, id, null, 'pulse', { modoArena: 'puzzles', cantidadBots: 5, dificultadBots: 'dificil' });
    }
    game.iniciarDesdeSala('host');
    advance(elapsed);
    const tactical = game.tactical();
    assert.equal(tactical.phase(now()).phase, phase);
    const guest = game.jugadores.guest;
    const host = game.jugadores.host;
    Object.assign(host, { kills: 2, vida: 37, escudo: 15 });
    const account = tactical.accounts.get('host');
    account.credits = 125;
    guest.kills = 3;
    game.balas.push({ propietarioId: 'host' }, { propietarioId: 'guest' });
    messages.length = 0;
    const replies = [];
    game.processClientMessage('host', { type: 'abandonarPartida' }, { emit: (type, data) => replies.push({ type, data }) });
    assert.equal(replies[0].type, 'salidaPartida');
    assert.equal(game.estadoSala().activa, true);
    assert.equal(game.estadoSala().anfitrionId, 'guest');
    assert.equal(game.jugadores.guest, guest);
    assert.equal(guest.kills, 3);
    assert.equal(game.jugadores.host.unido, false);
    assert.equal(game.tactical(), tactical);
    assert.equal(tactical.accounts.has('host'), false);
    assert.equal(tactical.accounts.has('guest'), true);
    assert.equal(game.balas.length, 1);
    assert.equal(game.balas[0].propietarioId, 'guest');
    assert.equal(messages.some(m => ['reinicioPartida', 'finDeJuego'].includes(m.type)), false);
    game.processClientMessage('host', { type: 'comprarEquipo', data: { item: 'rifle' } });
    assert.equal(game.jugadores.host.inventario.includes('rifle'), false);
    assert.ok(game.estadoSala().reingresos.includes('host'));
    replies.length = 0;
    game.unirseSala('host', 'Otro nombre', { emit: (type, data) => replies.push({ type, data }) }, 'nova', { cantidadBots: 20 });
    assert.equal(game.jugadores.host, host);
    assert.equal(host.vida, 37);
    assert.equal(host.escudo, 15);
    assert.equal(host.kills, 2);
    assert.equal(host.nombre, 'host');
    assert.equal(tactical.accounts.get('host'), account);
    assert.equal(account.credits, 125);
    assert.equal(account.training.input.x, 0);
    assert.equal(account.training.input.y, 0);
    assert.equal(game.estadoSala().anfitrionId, 'guest');
    assert.equal(game.estadoSala().reingresos.length, 0);
    const resumed = replies.find(m => m.type === 'inicioPartida').data;
    assert.equal(resumed.preparacionTactica.phase, phase);
    assert.deepEqual(Object.keys(resumed.preparacionTactica.players), ['host']);
    assert.equal(resumed.preparacionRestante, phase === 'cuenta' ? 4 : 0);
    game.processClientMessage('host', { type: 'abandonarPartida' }, { emit() {} });
    game.processClientMessage('guest', { type: 'abandonarPartida' }, { emit() {} });
    assert.equal(game.estadoSala().activa, false);
    assert.equal(game.estadoSala().anfitrionId, null);
    assert.equal(game.tactical(), null);
    assert.equal(game.estadoSala().reingresos.length, 0);
    assert.ok(Object.values(game.jugadores).filter(p => !p.esBot).every(p => !p.unido));
    game.unirseSala('host', 'Otra sala');
    assert.equal(game.estadoSala().anfitrionId, 'host');
  });
}

for (const [difficulty, speed, range, pause] of [['facil', 55, 200, 1100], ['normal', 80, 300, 650], ['dificil', 150, 650, 650]]) {
  test(`Dificultad ${difficulty}: velocidad, alcance, puntería y cadencia autoritativos`, () => {
    const { game, advance } = loadGame();
    game.addPlayer('host');
    game.unirseSala('host', 'Host', null, 'pulse', { cantidadBots: 0, dificultadBots: difficulty });
    game.iniciarDesdeSala('host');
    advance(4000);
    game.obstaculos.length = 0;
    require('../public/js/zones').zones.length = 0;
    game.addPlayer('bot');
    const bot = game.jugadores.bot;
    Object.assign(bot, { x: 1000, y: 1000, esBot: true, unido: true });
    game.equipoInicial(bot);
    Object.assign(game.jugadores.host, { x: 1000 + range + 1, y: 1000 });
    game.actualizarBots();
    assert.ok(Math.abs(bot.x - 1000 - speed / 30) < 0.0001);
    assert.equal(game.balas.length, 0);
    bot.x = 1000;
    game.jugadores.host.x = 1000 + range - 1;
    game.actualizarBots();
    assert.equal(game.balas.length, 1);
    assert.ok(Math.abs(game.balas[0].angle) <= (difficulty === 'facil' ? 0.3 : 0));
    advance(pause - 1);
    game.actualizarBots();
    assert.equal(game.balas.length, 1);
    advance(1);
    game.actualizarBots();
    assert.equal(game.balas.length, 2);
    assert.equal(game.estadoSala().reglas.dificultadBots, difficulty);
  });
}

for (const invalid of [undefined, 'imposible', '__proto__', 'constructor', { toString: null }]) {
  test(`Dificultad inválida ${JSON.stringify(invalid)} usa Normal`, () => {
    const { game } = loadGame();
    game.addPlayer('host');
    game.unirseSala('host', 'Host', null, 'pulse', { dificultadBots: invalid });
    assert.equal(game.estadoSala().reglas.dificultadBots, 'normal');
  });
}

test('Hielo limita humanos y bots y recupera la velocidad fuera', () => {
  const { game, advance } = loadGame();
  game.obstaculos.length = 0;
  game.addPlayer('human'); game.unirseJugador('human', 'Humano');
  game.addPlayer('bot'); game.unirseJugador('bot', 'Bot');
  const zone = require('../public/js/zones').zones.find((area) => area.tipo === 'hielo');
  const human = game.jugadores.human;
  const bot = game.jugadores.bot;
  Object.assign(human, { x: zone.x, y: zone.y });
  game.updateMovement('human', { x: zone.x + 100, y: zone.y, angle: 0 });
  assert.ok(Math.abs(human.x - zone.x - 8) < 0.001);
  Object.assign(bot, { x: zone.x, y: zone.y, esBot: true });
  Object.assign(human, { x: zone.x + 150, y: zone.y });
  game.actualizarBots();
  assert.ok(Math.abs(bot.x - zone.x - 1.6) < 0.001);
  Object.assign(bot, { x: zone.x + zone.radio + 30, y: zone.y });
  Object.assign(human, { x: bot.x + 150, y: zone.y });
  const before = bot.x;
  game.actualizarBots();
  assert.ok(Math.abs(bot.x - before - 80 / 30) < 0.001);
  advance(34);
  const targetX = human.x + 13;
  game.updateMovement('human', { x: targetX, y: human.y, angle: 0 });
  assert.equal(human.x, targetX);
});

test('Contaminación afecta humanos y bots solo dentro, respeta escudo y causa muerte ambiental', () => {
  const { game, tick } = loadGame();
  game.addPlayer('human'); game.unirseJugador('human', 'Humano');
  game.addPlayer('bot'); game.unirseJugador('bot', 'Bot');
  const zone = require('../public/js/zones').zones[0];
  const human = game.jugadores.human;
  const bot = game.jugadores.bot;
  Object.assign(human, { x: zone.x, y: zone.y, escudo: 50 });
  Object.assign(bot, { x: zone.x, y: zone.y, esBot: true, escudo: 50 });
  for (let i = 0; i < 30; i++) tick();
  assert.ok(Math.abs(human.vida - 95) < 0.001);
  assert.ok(Math.abs(bot.vida - 95) < 0.001);
  assert.equal(human.escudo, 50);
  human.x = zone.x + zone.radio + 50;
  const health = human.vida;
  tick();
  assert.equal(human.vida, health);
  Object.assign(human, { x: zone.x, vida: 0.1 });
  tick();
  assert.equal(human.muerto, true);
  assert.equal(bot.kills, 0);
});

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

test('Tormenta avisa, interpola el cierre, descansa y se detiene en el radio mínimo', () => {
  const { game, advance } = loadGame();
  game.addPlayer('player'); game.unirseJugador('player', 'Jugador');
  const zone = game.zonaSegura;
  const initial = zone.radio;
  const target = { ...zone.objetivo };
  assert.equal(zone.estado, 'espera');
  assert.ok(Math.hypot(target.x - zone.x, target.y - zone.y) + target.radio <= initial);
  advance(19999); game.actualizarZonaSegura();
  assert.equal(zone.radio, initial);
  advance(10001); game.actualizarZonaSegura();
  assert.equal(zone.estado, 'cerrando');
  assert.ok(Math.abs(zone.radio - (initial + target.radio) / 2) < 0.001);
  advance(10000); game.actualizarZonaSegura();
  assert.equal(zone.estado, 'espera');
  assert.equal(zone.radio, target.radio);
  advance(14999); game.actualizarZonaSegura();
  assert.equal(zone.radio, target.radio);
  advance(300000); game.actualizarZonaSegura();
  assert.equal(zone.radio, 400);
  assert.equal(zone.estado, 'final');
  assert.equal(zone.objetivo, null);
});

test('Tormenta: daño entero cada segundo, fases de 1 a 5 y protección interior', () => {
  const { game, advance } = loadGame();
  game.addPlayer('outside'); game.addPlayer('inside'); game.addPlayer('waiting');
  game.unirseJugador('outside', 'Fuera'); game.unirseJugador('inside', 'Dentro');
  const outside = game.jugadores.outside;
  outside.x = -100; outside.y = -100; outside.escudo = 100;
  game.aplicarDañoZona();
  assert.equal(outside.vida, 100);
  for (let phase = 1; phase <= 7; phase += 1) {
    advance(phase === 1 ? 20000 : 34000);
    game.actualizarZonaSegura();
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

test('Audio remoto identifica el arma que disparó, no la equipada después ni intentos rechazados', () => {
  const { game, advance } = loadGame();
  game.addPlayer('player'); game.unirseJugador('player', 'Jugador');
  const player = game.jugadores.player;
  for (const weapon of ['pistola', 'rifle', 'escopeta', 'sniper']) {
    player.inventario[1] = weapon;
    player.municionPorSlot[1] = 30;
    game.equiparArma(player);
    advance(1600);
    game.createBullet('player', { x: player.x, y: player.y, angle: 0 });
    assert.equal(player.ultimoDisparoArma, weapon);
    player.inventario[1] = 'pistola';
    game.equiparArma(player);
    game.createBullet('player', { x: player.x, y: player.y, angle: 0 });
    assert.equal(player.ultimoDisparoArma, weapon);
  }
  player.inventario[2] = 'granada';
  advance(1600);
  game.processClientMessage('player', { type: 'lanzarGranada', data: { angle: 0 } });
  assert.equal(player.ultimoDisparoArma, 'granada');
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
