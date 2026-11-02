const { test } = require('node:test');
const assert = require('node:assert/strict');
const NetworkMetrics = require('../public/js/network-metrics');

test('Red: RTT local, timeout exacto, duplicados y respuestas tardías', () => {
  const metrics = new NetworkMetrics();
  const first = metrics.probe(100);
  metrics.reply(first.seq, 145);
  metrics.reply(first.seq, 150);
  assert.equal(metrics.sample(150).ping, 45);
  assert.equal(metrics.results.length, 1);
  const second = metrics.probe(1000);
  assert.equal(metrics.sample(3999).lost, 0);
  assert.equal(metrics.sample(4000).lost, 1);
  assert.equal(metrics.sample(4000).ping, null);
  metrics.reply(second.seq, 4001);
  assert.equal(metrics.results.length, 2);
  for (let i = 0; i < 40; i++) metrics.reply(metrics.probe(5000 + i).seq, 5001 + i);
  assert.equal(metrics.results.length, 30);
  assert.equal(metrics.sample(6000).lost, 0);
});

test('Red: bytes UTF-8 y tasas normalizadas por tiempo real; reinicio sin pérdidas falsas', () => {
  const metrics = new NetworkMetrics();
  const payload = { texto: '👍á' };
  metrics.count('up', 'prueba', payload);
  metrics.count('down', 'prueba', payload);
  const bytes = Buffer.byteLength(JSON.stringify({ type: 'prueba', data: payload }));
  const sample = metrics.sample(2000);
  assert.equal(sample.upload, bytes / 2 / 1024);
  assert.equal(sample.download, sample.upload);
  metrics.probe(2000);
  metrics.reset(10000);
  assert.deepEqual(metrics.sample(10000), { ping: null, lost: 0, total: 0, upload: null, download: null });
  assert.equal(metrics.sample(11000).download, 0);
});
