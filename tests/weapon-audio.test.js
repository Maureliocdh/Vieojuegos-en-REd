const { test } = require('node:test');
const assert = require('node:assert/strict');
const Audio = require('../public/js/weapon-audio');

test('Armas: muestras originales distintas, acotadas, cacheadas y con salida suave', () => {
  let created = 0;
  const context = {
    sampleRate: 48000,
    createBuffer(channels, length, sampleRate) {
      created += 1;
      const data = new Float32Array(length);
      return { duration: length / sampleRate, getChannelData: () => data };
    },
  };
  const durations = [];
  for (const weapon of ['pistola', 'rifle', 'escopeta', 'sniper']) {
    assert.ok(Audio.has(weapon));
    const buffer = Audio.createBuffer(context, weapon);
    assert.equal(Audio.createBuffer(context, weapon), buffer);
    const data = buffer.getChannelData(0);
    let energy = 0, peak = 0, onset = 0, ending = 0;
    for (let i = 0; i < data.length; i += 1) {
      assert.ok(Number.isFinite(data[i]));
      peak = Math.max(peak, Math.abs(data[i]));
      energy += data[i] ** 2;
      if (i < 4800) onset += data[i] ** 2;
      if (i >= data.length - 4800) ending += data[i] ** 2;
    }
    assert.ok(peak > 0.1 && peak < 1, `${weapon}: pico ${peak}`);
    assert.ok(energy > 1);
    assert.ok(onset > ending * 10);
    assert.equal(data[0], 0);
    assert.equal(data.at(-1), 0);
    durations.push(buffer.duration);
  }
  assert.equal(new Set(durations).size, 4);
  assert.equal(created, 4);
  for (const weapon of ['puños', 'granada', 'botiquin', 'constructor', null]) {
    assert.equal(Audio.has(weapon), false);
    assert.throws(() => Audio.createBuffer(context, weapon), RangeError);
  }
});
