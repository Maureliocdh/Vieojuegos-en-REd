const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function launch({ platform = 'linux', missing = false, installStatus = 0 } = {}) {
  const calls = [], errors = [], timers = [];
  const server = new EventEmitter();
  server.stdout = new EventEmitter();
  server.kill = signal => calls.push(['kill', signal]);
  const process = new EventEmitter();
  Object.assign(process, { platform, argv: [], execPath: '/node', chdir() {}, stdout: { write() {} } });
  const requireMock = name => {
    if (name === './package.json') return { dependencies: { express: '*' } };
    if (name === 'node:path') return path;
    if (name === 'node:child_process') return {
      spawn(command, args) {
        calls.push(['spawn', command, ...args]);
        return command === '/node' ? server : new EventEmitter();
      },
      spawnSync(command, args) {
        calls.push(['install', command, ...args]);
        return { status: installStatus };
      },
    };
    if (name === 'node:http') return {
      get(url, callback) {
        calls.push(['http', url]);
        const response = new EventEmitter();
        response.statusCode = 200;
        callback(response);
        response.emit('data', '{"modo":"socket.io"}');
        response.emit('end');
        const request = new EventEmitter();
        request.setTimeout = () => {};
        return request;
      },
    };
    throw new Error(`Unexpected module: ${name}`);
  };
  requireMock.resolve = () => {
    if (missing) throw Object.assign(new Error('Missing dependency'), { code: 'MODULE_NOT_FOUND' });
    return '/express';
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../iniciar.js'), 'utf8'), {
    require: requireMock, __dirname: path.join(__dirname, '..'), process,
    console: { log() {}, error: message => errors.push(message) },
    setTimeout(callback) { timers.push(callback); return timers.length; }, clearTimeout() {},
  });
  return { calls, errors, server, process, timers };
}

for (const platform of ['linux', 'win32']) {
  test(`Lanzador ${platform}: instala solo si faltan dependencias y abre tras comprobar HTTP`, () => {
    for (const missing of [false, true]) {
      const { calls, server } = launch({ platform, missing });
      assert.equal(calls.filter(call => call[0] === 'install').length, missing ? 1 : 0);
      assert.equal(calls.filter(call => call[0] === 'spawn').length, 1);
      server.stdout.emit('data', 'Servidor (Socket.IO) en http://localhost:3000\n');
      assert.ok(calls.some(call => call[0] === 'http'));
      assert.ok(calls.some(call => call[0] === 'spawn' && call[1] === (platform === 'win32' ? 'cmd.exe' : 'xdg-open')));
    }
  });
}

test('Lanzador: instalación fallida no inicia servidor ni navegador', () => {
  const { calls, errors, process } = launch({ missing: true, installStatus: 1 });
  assert.equal(process.exitCode, 1);
  assert.equal(calls.some(call => call[0] === 'spawn'), false);
  assert.match(errors[0], /No se pudieron instalar/);
});

test('Lanzador: timeout y señales detienen el proceso hijo', () => {
  const { calls, process, timers } = launch();
  process.emit('SIGTERM');
  assert.ok(calls.some(call => call[0] === 'kill' && call[1] === 'SIGTERM'));
  timers[0]();
  assert.equal(process.exitCode, 1);
});
