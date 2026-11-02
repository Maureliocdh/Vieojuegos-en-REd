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
  test(`Abandonar y dificultad en todos los modos (${native ? 'nativo' : 'Socket.IO'})`, { timeout: 20000 }, async (context) => {
    const port = 22000 + Math.floor(Math.random() * 15000);
    const server = spawn(process.execPath, ['server.js', ...(native ? ['--nativo'] : [])], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    context.after(() => server.kill());
    await new Promise((resolve, reject) => {
      server.stdout.on('data', data => { if (String(data).includes('Servidor (')) resolve(); });
      server.once('error', reject);
      server.once('exit', code => reject(new Error(`Servidor terminó: ${code}`)));
    });
    const url = `http://localhost:${port}`;
    const host = connect(url, native), guest = connect(url, native);
    context.after(() => { host.close(); guest.close(); });
    await Promise.all([host.wait('configMapa'), guest.wait('configMapa')]);
    for (const mode of ['clasico', 'puzzles', 'solo']) {
      host.messages.length = 0;
      guest.messages.length = 0;
      host.send('unirse', { nombre: 'Host', cantidadBots: 5, dificultadBots: 'dificil', modoArena: mode, soloJugador: mode === 'solo' });
      const room = await host.wait('estadoSala', r => r.jugadores.length === 1);
      assert.equal(room.reglas.dificultadBots, 'dificil');
      if (mode !== 'solo') {
        guest.send('unirse', { nombre: 'Guest', dificultadBots: 'facil' });
        const joined = await guest.wait('estadoSala', r => r.jugadores.length === 2);
        assert.equal(joined.reglas.dificultadBots, 'dificil');
        await host.wait('estadoSala', r => r.jugadores.length === 2);
      }
      host.send('iniciarSala', {});
      const start = await host.wait('inicioPartida');
      assert.equal((await host.wait('configPartida', r => r.activa)).dificultadBots, 'dificil');
      if (mode !== 'solo') {
        await guest.wait('inicioPartida');
        const snapshot = await host.wait('estadoJuego', s => s.jugadores[room.anfitrionId]?.unido);
        guest.messages.length = 0;
        host.send('abandonarPartida', {});
        await host.wait('salidaPartida');
        const continued = await guest.wait('estadoSala', r => r.activa && r.jugadores.length === 1);
        assert.notEqual(continued.anfitrionId, room.anfitrionId);
        const after = await guest.wait('estadoJuego', s => !s.jugadores[room.anfitrionId]?.unido);
        assert.equal(after.tiempoRestante, snapshot.tiempoRestante);
        assert.equal(guest.messages.some(m => ['finDeJuego', 'reinicioPartida'].includes(m.type)), false);
        const outsider = connect(url, native);
        context.after(() => outsider.close());
        await outsider.wait('configMapa');
        outsider.send('unirse', { nombre: 'Host', id: room.anfitrionId });
        assert.equal((await outsider.wait('entradaRechazada')).motivo, 'partidaEnCurso');
        host.messages.length = 0;
        host.send('unirse', { nombre: 'Regreso', cantidadBots: 20, dificultadBots: 'facil' });
        const resumed = await host.wait('inicioPartida');
        assert.ok(resumed.tiempoRestante > 0 && resumed.tiempoRestante <= start.tiempoRestante);
        assert.ok(resumed.preparacionRestante >= 0 && resumed.preparacionRestante <= start.preparacionRestante);
        if (mode === 'puzzles') {
          assert.deepEqual(Object.keys(resumed.preparacionTactica.players), [room.anfitrionId]);
        }
        const returned = await host.wait('estadoSala', r => r.activa && r.jugadores.length === 2);
        assert.equal(returned.anfitrionId, continued.anfitrionId);
        assert.equal(returned.jugadores.find(p => p.id === room.anfitrionId).nombre, 'Host');
        assert.equal(returned.reglas.cantidadBots, 5);
        assert.equal(returned.reglas.dificultadBots, 'dificil');
        host.send('abandonarPartida', {});
        await host.wait('salidaPartida');
        guest.send('abandonarPartida', {});
        await guest.wait('salidaPartida');
      } else {
        host.send('abandonarPartida', {});
        await host.wait('salidaPartida');
      }
      const empty = await host.wait('estadoSala', r => !r.activa && r.anfitrionId === null);
      assert.deepEqual(empty.reingresos, []);
    }
  });

  test(`Sala: espera, permisos, bloqueo tardío y relevo de anfitrión (${native ? 'nativo' : 'Socket.IO'})`, { timeout: 15000 }, async (context) => {
    const port = 22000 + Math.floor(Math.random() * 15000);
    const server = spawn(process.execPath, ['server.js', ...(native ? ['--nativo'] : [])], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port) }, stdio: ['ignore','pipe','pipe'],
    });
    context.after(() => server.kill());
    await new Promise((resolve, reject) => {
      server.stdout.on('data', data => { if (String(data).includes('Servidor (')) resolve(); });
      server.once('error', reject);
      server.once('exit', code => reject(new Error(`Servidor terminó: ${code}`)));
    });
    const url = `http://localhost:${port}`;
    const host = connect(url, native), guest = connect(url, native);
    context.after(() => { host.close(); guest.close(); });
    const [mapA, mapB] = await Promise.all([host.wait('configMapa'), guest.wait('configMapa')]);
    assert.deepEqual(mapA, mapB);
    host.send('unirse', { nombre: 'Host', cantidadBots: 0, duracion: 60, limiteKills: 5 });
    const room = await host.wait('estadoSala', r => r.jugadores.length === 1);
    assert.equal(room.activa, false);
    assert.equal(host.messages.some(m => m.type === 'inicioPartida'), false);
    guest.send('unirse', { nombre: '<img src=x>', skin: 'nova', duracion: 300, cantidadBots: 20 });
    const joined = await guest.wait('estadoSala', r => r.jugadores.length === 2);
    assert.equal(joined.reglas.duracion, 60);
    assert.equal(joined.reglas.cantidadBots, 0);
    assert.equal(joined.jugadores.find(j => j.id !== room.anfitrionId).skin, 'nova');
    guest.send('cerrarSala', {});
    guest.send('iniciarSala', {});
    guest.send('movimiento', { x: 100, y: 100, angle: 0 });
    const waiting = await guest.wait('estadoJuego', state => Object.values(state.jugadores).filter(p => p.unido && !p.esBot).length === 2);
    assert.equal(waiting.jugadores[room.anfitrionId].vida, 100);
    assert.equal(guest.messages.some(m => m.type === 'inicioPartida'), false);
    host.close();
    const promoted = await guest.wait('estadoSala', r => r.jugadores.length === 1 && r.anfitrionId !== room.anfitrionId);
    guest.send('cerrarSala', {});
    await guest.wait('estadoSala', r => r.jugadores.length === 0 && r.anfitrionId === null);
    guest.send('unirse', { nombre: 'Nuevo host', cantidadBots: 0, duracion: 60 });
    await guest.wait('estadoSala', r => r.jugadores.some(j => j.nombre === 'Nuevo host'));
    guest.send('iniciarSala', {});
    const start = await guest.wait('inicioPartida');
    assert.equal(start.tiempoRestante, 60);
    assert.equal(start.preparacionRestante, 4);
    const state = await guest.wait('estadoJuego', state => Object.values(state.jugadores).filter(p => p.esBot).length === 0);
    assert.ok(state.jugadores[promoted.anfitrionId]);
    const initialX = state.jugadores[promoted.anfitrionId].x;
    guest.send('movimiento', { x: 100, y: 100, angle: 0 });
    const frozen = await guest.wait('estadoJuego', s => s.preparacionRestante === 3);
    assert.equal(frozen.jugadores[promoted.anfitrionId].x, initialX);
    const late = connect(url, native);
    context.after(() => late.close());
    await late.wait('configMapa');
    late.send('unirse', { nombre: 'Tarde' });
    assert.equal((await late.wait('entradaRechazada')).motivo, 'partidaEnCurso');
    assert.equal(late.messages.some(m => m.type === 'inicioPartida'), false);
  });
}
