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
    wait(type, predicate = () => true, timeout = 5000) {
      const found = messages.find((message) => message.type === type && predicate(message.data));
      if (found) return Promise.resolve(found.data);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { listeners.delete(listener); reject(new Error(`Timeout: ${type}`)); }, timeout);
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
  test(`Mapa y encuesta completos por red (${native ? 'nativo' : 'Socket.IO'})`, { timeout: 95000 }, async context => {
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
    const host = connect(url, native), guest = connect(url, native), spectator = connect(url, native);
    context.after(() => { host.close(); guest.close(); spectator.close(); });
    await Promise.all([host.wait('configMapa'), guest.wait('configMapa'), spectator.wait('configMapa')]);
    host.send('sondaRed', { seq: 19 });
    assert.deepEqual(await host.wait('respuestaRed'), { seq: 19 });
    host.send('unirse', { nombre: 'Host', mapa: 'orbital', duracion: 60, cantidadBots: 0, modoArena: 'equipos' });
    const room = await host.wait('estadoSala', state => state.jugadores.length === 1);
    const guestRoom = guest.wait('estadoSala', state => state.jugadores.length === 2);
    guest.send('unirse', { nombre: 'Guest', mapa: 'outpost' });
    await host.wait('estadoSala', state => state.jugadores.length === 2);
    const guestId = (await guestRoom).jugadores.find(player => player.id !== room.anfitrionId).id;
    host.send('iniciarSala', {});
    await host.wait('inicioPartida');
    const map = await guest.wait('configMapa', state => state.mapa === 'orbital');
    assert.ok(map.obstaculos.some(object => object.tipo === 'contenedor'));
    assert.equal((await guest.wait('configPartida', state => state.activa)).mapa, 'orbital');
    const final = await host.wait('finDeJuego', () => true, 75000);
    for (const player of final) {
      assert.deepEqual(player.estadisticas, { daño: 0, proyectiles: 0, impactos: 0, curacion: 0, reanimaciones: 0, muertes: 0 });
    }
    const vote = await host.wait('estadoVotacion', state => state.activa);
    assert.equal(vote.segundos, 15);
    assert.equal(vote.electores.length, 2);
    host.send('unirse', { nombre: 'Antes de tiempo' });
    assert.equal((await host.wait('entradaRechazada')).motivo, 'votacionEnCurso');
    spectator.send('votarMapa', { mapa: 'orbital' });
    assert.match((await spectator.wait('votoRechazado')).motivo, /Solo/);
    host.send('votarMapa', { mapa: 'constructor' });
    assert.match((await host.wait('votoRechazado')).motivo, /válido/);
    host.send('votarMapa', { mapa: 'desierto' });
    guest.send('votarMapa', { mapa: 'desierto' });
    await host.wait('estadoVotacion', state => state.recuento.desierto === 2);
    host.messages.length = 0;
    guest.messages.length = 0;
    spectator.messages.length = 0;
    const ended = await host.wait('estadoVotacion', state => !state.activa, 18000);
    assert.equal(ended.ganador, 'desierto');
    await Promise.all([host.wait('inicioPartida'), guest.wait('inicioPartida')]);
    const next = await host.wait('estadoSala', state => state.activa && state.reglas.mapa === 'desierto');
    assert.equal(next.reglas.mapa, 'desierto');
    assert.equal(next.reglas.modoArena, 'equipos');
    assert.equal(next.anfitrionId, room.anfitrionId);
    assert.deepEqual(next.jugadores.map(player => player.id).sort(), [room.anfitrionId, guestId].sort());
    const desert = await host.wait('configMapa');
    assert.equal(desert.mapa, 'desierto');
    assert.equal(desert.obstaculos.filter(object => object.tipo === 'carpa').length, 4);
    assert.ok(desert.obstaculos.some(object => object.tipo === 'cactus'));
    const state = await host.wait('estadoJuego', state => state.jugadores[room.anfitrionId]?.unido);
    assert.equal(state.jugadores[room.anfitrionId].kills, 0);
    assert.equal(state.jugadores[guestId].unido, true);
    assert.equal(Object.values(state.jugadores).filter(player => player.unido && !player.esBot).length, 2);
    assert.notEqual(state.jugadores[room.anfitrionId].equipo, state.jugadores[guestId].equipo);
    assert.deepEqual(state.equipos.puntos, { azul: 0, rojo: 0 });
  });

  test(`Duelo y charcos: equipos equilibrados, bots, escudo y reingreso (${native ? 'nativo' : 'Socket.IO'})`, { timeout: 15000 }, async context => {
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
    const clients = Array.from({ length: 4 }, () => connect(`http://localhost:${port}`, native));
    context.after(() => clients.forEach(client => client.close()));
    await Promise.all(clients.map(client => client.wait('configMapa')));
    const host = clients[0];
    host.send('unirse', { nombre: 'Host', modoArena: 'equipos', mapa: 'orbital', cantidadBots: 5 });
    await host.wait('estadoSala', state => state.jugadores.length === 1);
    for (let i = 1; i < clients.length; i += 1) {
      clients[i].send('unirse', { nombre: `Invitado ${i}`, modoArena: 'clasico', equipo: 'azul' });
      const room = await host.wait('estadoSala', state => state.jugadores.length === i + 1);
      if (i === 1) assert.notEqual(room.jugadores[0].equipo, room.jugadores[1].equipo);
      if (i === 3) assert.equal(room.jugadores.filter(player => player.equipo === 'azul').length, 2);
    }
    host.messages.length = 0;
    host.send('iniciarSala', {});
    await Promise.all(clients.map(client => client.wait('inicioPartida')));
    const snapshot = await host.wait('estadoJuego', state => state.preparacionRestante === 0);
    for (const bot of [false, true]) {
      const group = Object.values(snapshot.jugadores).filter(player => player.unido && player.esBot === bot);
      assert.equal(group.length, bot ? 5 : 4);
      const blue = group.filter(player => player.equipo === 'azul').length;
      assert.ok(Math.abs(blue - (group.length - blue)) <= 1);
    }
    const room = await host.wait('estadoSala', state => state.activa);
    const id = room.anfitrionId, team = snapshot.jugadores[id].equipo;
    const map = await host.wait('configMapa', data => data.mapa === 'orbital');
    for (const type of ['curacion', 'escudo']) {
      assert.equal(map.zonasEspeciales.filter(zone => zone.tipo === type).length, 1);
      assert.equal(map.zonasEspeciales.find(zone => zone.tipo === type).points.length, 18);
    }
    const zone = map.zonasEspeciales.find(zone => zone.tipo === 'escudo');
    host.send('movimiento', { x: zone.x, y: zone.y, angle: 0 });
    const shield = await host.wait('estadoJuego', state => state.jugadores[id]?.escudo > 0
      && Math.hypot(state.jugadores[id].x - zone.x, state.jugadores[id].y - zone.y) < 10);
    assert.ok(shield.jugadores[id].escudo <= 100);
    host.send('abandonarPartida', {});
    await host.wait('salidaPartida');
    host.messages.length = 0;
    host.send('unirse', { nombre: 'Regreso', modoArena: 'clasico', equipo: team === 'azul' ? 'rojo' : 'azul' });
    await host.wait('inicioPartida');
    const resumed = await host.wait('estadoJuego', state => state.jugadores[id]?.unido);
    assert.equal(resumed.jugadores[id].equipo, team);
    assert.ok(resumed.equipos);
  });

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
    guest.messages.length = 0;
    const ready = await guest.wait('estadoJuego', s => s.preparacionRestante === 0);
    const shooter = ready.jugadores[promoted.anfitrionId];
    guest.send('disparar', { x: shooter.x, y: shooter.y, angle: 0 });
    const shot = await guest.wait('estadoJuego', s => s.jugadores[promoted.anfitrionId]?.ultimoDisparo > 0);
    assert.equal(shot.jugadores[promoted.anfitrionId].ultimoDisparoArma, 'pistola');
    assert.equal(shot.jugadores[promoted.anfitrionId].balasEnCargador, 11);
  });
}
