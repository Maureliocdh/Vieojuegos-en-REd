const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { io } = require('socket.io-client');
const WebSocket = require('ws');
const Buildings = require('../public/js/buildings');

function connect(url, native) {
  const socket = native ? new WebSocket(url.replace('http', 'ws')) : io(url, { reconnection: false });
  const messages = [];
  const listeners = new Set();
  const receive = (type, data) => {
    messages.push({ type, data });
    for (const listener of listeners) listener(type, data);
  };
  if (native) socket.on('message', (raw) => {
    const message = JSON.parse(raw);
    receive(message.type, message.data);
  });
  else socket.onAny(receive);
  return {
    messages,
    close: () => native ? socket.close() : socket.disconnect(),
    send: (type, data) => native ? socket.send(JSON.stringify({ type, data })) : socket.emit(type, data),
    wait(type, predicate = () => true) {
      const found = messages.find((message) => message.type === type && predicate(message.data));
      if (found) return Promise.resolve(found.data);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { listeners.delete(listener); reject(new Error(`Timeout: ${type}`)); }, 5000);
        function listener(receivedType, data) {
          if (receivedType !== type || !predicate(data)) return;
          clearTimeout(timer);
          listeners.delete(listener);
          resolve(data);
        }
        listeners.add(listener);
      });
    },
  };
}

for (const native of [false, true]) {
  test(`Dos clientes: ${native ? 'WebSocket nativo' : 'Socket.IO'}`, { timeout: 15000 }, async (context) => {
    const port = 22000 + Math.floor(Math.random() * 15000);
    const server = spawn(process.execPath, ['server.js', ...(native ? ['--nativo'] : [])], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    context.after(() => server.kill());
    await new Promise((resolve, reject) => {
      server.stdout.on('data', (data) => { if (String(data).includes('Servidor (')) resolve(); });
      server.once('error', reject);
      server.once('exit', (code) => reject(new Error(`Servidor terminó: ${code}`)));
    });
    const url = `http://localhost:${port}`;
    assert.equal((await (await fetch(`${url}/modo`)).json()).modo, native ? 'nativo' : 'socket.io');
    const first = connect(url, native);
    const second = connect(url, native);
    context.after(() => { first.close(); second.close(); });
    const [mapFirst, mapSecond] = await Promise.all([first.wait('configMapa'), second.wait('configMapa')]);
    assert.deepEqual(mapFirst, mapSecond);
    assert.ok(mapFirst.obstaculos.some((obstacle) => obstacle.tipo === 'arbol'));
    first.send('unirse', { nombre: 'Primero', skin: 'ronin', limiteKills: 20, duracion: 180, cantidadBots: native ? 0 : 5 });
    const start = await first.wait('inicioPartida');
    assert.equal(start.tiempoRestante, 180);
    const rules = await second.wait('configPartida', (config) => config.activa);
    assert.equal(rules.limiteKills, 20);
    assert.equal(rules.duracion, 180);
    assert.equal(rules.cantidadBots, native ? 0 : 5);
    const lobby = await second.wait('estadoJuego', (state) => Object.values(state.jugadores).some((player) => player.nombre === 'Primero'));
    assert.equal(second.messages.filter((message) => message.type === 'inicioPartida').length, 0);
    const waiting = Object.values(lobby.jugadores).find((player) => !player.esBot && !player.unido);
    assert.equal(Object.values(lobby.jugadores).filter((player) => player.esBot).length, native ? 0 : 5);
    assert.equal(waiting.vida, 100);
    assert.equal(waiting.inventario.filter(Boolean).length, 1);
    second.send('unirse', { nombre: '<img src=x>', skin: 'nova', limiteKills: 5, duracion: 60, cantidadBots: 20 });
    await second.wait('inicioPartida');
    const both = (state) => Object.values(state.jugadores).filter((player) => !player.esBot && player.unido).length === 2;
    const [stateFirst, stateSecond] = await Promise.all([first.wait('estadoJuego', both), second.wait('estadoJuego', both)]);
    const humans = (state) => Object.entries(state.jugadores).filter(([, player]) => !player.esBot).map(([id, player]) => ({ id, nombre: player.nombre, skin: player.skin, inventario: player.inventario }));
    assert.deepEqual(humans(stateFirst), humans(stateSecond));
    assert.equal(Object.values(stateSecond.jugadores).filter((player) => player.esBot).length, native ? 0 : 5);
    assert.equal(humans(stateFirst).find((player) => player.nombre === 'Primero').skin, 'ronin');
    assert.equal(humans(stateFirst).find((player) => player.nombre === '<img src=x>').skin, 'nova');
    const firstId = humans(stateFirst).find((player) => player.nombre === 'Primero').id;
    first.send('tirarItem', { slot: 0 });
    first.send('tirarItem', { slot: 0.5 });
    first.send('cambiarSlot', { slot: 4 });
    const protectedFists = await second.wait('estadoJuego', (state) => state.jugadores[firstId]?.slotSeleccionado === 4);
    assert.equal(protectedFists.jugadores[firstId].inventario[0], 'puños');
    assert.ok(!protectedFists.itemsEnSuelo.some((drop) => drop.item === 'puños'));
    first.send('movimiento', { x: 3100, y: 3100, angle: 1 });
    await second.wait('estadoJuego', (state) => state.jugadores[firstId]?.x === 3100);
    first.send('movimiento', { x: 660, y: 800, angle: 1 });
    first.send('unirse', { nombre: 'Duplicado', skin: 'glitch' });
    second.send('cambiarSlot', { slot: 2 });
    const checked = await first.wait('estadoJuego', (state) => Object.values(state.jugadores).some((player) => player.nombre === '<img src=x>' && player.slotSeleccionado === 2));
    assert.equal(checked.jugadores[firstId].nombre, 'Primero');
    assert.equal(checked.jugadores[firstId].skin, 'ronin');
    assert.notDeepEqual([checked.jugadores[firstId].x, checked.jugadores[firstId].y], [660, 800]);
    for (const platform of checked.plataformas) {
      assert.ok(!mapFirst.obstaculos.flatMap(Buildings.walls).some((obstacle) => platform.x > obstacle.x && platform.x < obstacle.x + obstacle.width && platform.y > obstacle.y && platform.y < obstacle.y + obstacle.height));
    }
    const building = mapFirst.obstaculos.find(Buildings.isBuilding);
    const door = Buildings.door(building);
    first.send('movimiento', { x: door.x + 48, y: door.y + 75, angle: 0 });
    first.send('intercambiar', {});
    await second.wait('estadoJuego', (state) => state.obstaculos.find((object) => object.id === building.id)?.puertaAbierta);
    first.send('movimiento', { x: door.x + 48, y: door.y - 60, angle: 0 });
    const inside = await second.wait('estadoJuego', (state) => state.jugadores[firstId]?.y === door.y - 60);
    assert.equal(Buildings.inside(building, inside.jugadores[firstId]), true);
    second.close();
    await first.wait('jugadorDesconectado');
    const third = connect(url, native);
    context.after(() => third.close());
    await third.wait('configMapa');
    const lateRules = await third.wait('configPartida');
    assert.equal(lateRules.limiteKills, 20);
    assert.equal(lateRules.duracion, 180);
    third.send('unirse', { nombre: 'Tercero', skin: '../../invalid' });
    const fallback = await first.wait('estadoJuego', (state) => Object.values(state.jugadores).some((player) => player.nombre === 'Tercero'));
    assert.equal(Object.values(fallback.jugadores).find((player) => player.nombre === 'Tercero').skin, 'pulse');
  });
}