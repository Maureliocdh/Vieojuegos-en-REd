const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Tactical } = require('../lib/tactical');

test('Instrucciones congelan la sala cinco segundos y conservan el minuto completo', () => {
  const mode = new Tactical(['a'],0);
  const room = mode.accounts.get('a').training;
  assert.equal(mode.move('a',{ x: 1, y: 0 },4999),false);
  mode.tick(4999);
  assert.equal(room.player.x,500);
  assert.equal(room.active,null);
  assert.equal(mode.accounts.get('a').credits,80);
  assert.equal(mode.snapshot(4999,'a').players.a.training.beacons.length,9);
  assert.deepEqual(mode.phase(5000),{ phase:'puzzles', seconds:60 });
  assert.equal(mode.move('a',{ x:1,y:0 },5000),true);
  mode.tick(5100);
  assert.equal(room.player.x,524);
});

test('Fases: minuto de entrenamiento, 20 s de tienda y 4 s de cuenta', () => {
  const mode = new Tactical(['a','b'], 1000);
  for (const [time,phase,seconds] of [[1000,'instrucciones',5], [5999,'instrucciones',1], [6000,'puzzles',60], [65999,'puzzles',1], [66000,'tienda',20], [86000,'cuenta',4], [90000,'combate',0]]) {
    assert.deepEqual(mode.phase(time), { phase, seconds });
  }
});

test('Mapas individuales: nueve balizas separadas, apagadas al inicio, saldos privados', () => {
  const mode = new Tactical(['a','b'], -5000);
  const a = mode.snapshot(0,'a');
  assert.deepEqual(Object.keys(a.players), ['a']);
  assert.deepEqual(Object.keys(mode.snapshot(0,'b').players), ['b']);
  assert.deepEqual(mode.snapshot(0).players, {});
  assert.equal(a.players.a.training.active, null);
  const beacons = a.players.a.training.beacons;
  assert.equal(beacons.length, 9);
  assert.ok(beacons.every(b => b.x > 50 && b.x < 950 && b.y > 50 && b.y < 650));
  for (let i = 0; i < beacons.length; i++) for (let j = i + 1; j < beacons.length; j++) {
    assert.ok(Math.hypot(beacons[i].x - beacons[j].x, beacons[i].y - beacons[j].y) >= 130);
  }
  assert.notDeepEqual(beacons, mode.snapshot(0,'b').players.b.training.beacons);
});

test('Recoger da cinco una sola vez; expirar o terminar la fase no otorgan ni descuentan', () => {
  const mode = new Tactical(['a','b'], -5000);
  const account = mode.accounts.get('a'), room = account.training;
  room.player = { ...room.beacons[0] }; room.active = 0; room.expires = 6000;
  mode.tick(10);
  assert.equal(account.credits, 85);
  mode.tick(20);
  assert.equal(account.credits, 85);
  assert.equal(mode.accounts.get('b').credits, 80);
  room.active = 1; room.expires = 1000; room.player = { x: 500, y: 650 };
  mode.tick(1000);
  assert.equal(room.active, null);
  assert.equal(account.credits, 85);
  room.active = 0; room.player = { ...room.beacons[0] }; room.expires = 70000;
  mode.tick(60000);
  assert.equal(account.credits, 85);
});

test('Movimiento limita velocidad y caduca al perder entradas; rechaza datos inválidos', () => {
  const mode = new Tactical(['a'],-5000);
  const room = mode.accounts.get('a').training;
  assert.equal(mode.move('a',{ x: NaN, y: 0 },0),false);
  assert.equal(mode.move('intruso',{ x: 1, y: 0 },0),false);
  mode.move('a',{ x: 99999, y: 0 },0); mode.tick(100);
  assert.equal(room.player.x,524);
  mode.tick(1000);
  assert.equal(room.player.x,524);
  assert.equal(mode.move('a',{ x: 1, y: 0 },60000),false);
});

test('Bonificación máxima y compra validada por saldo, fase, límite y espacio', () => {
  const mode = new Tactical(['a'],-5000), a = mode.accounts.get('a'), room = a.training;
  a.credits = 175;
  for (let i = 0; i < 2; i++) {
    room.active = 0; room.expires = 6000; room.player = { ...room.beacons[0] }; mode.tick(i * 10);
  }
  assert.equal(a.credits,180);
  assert.equal(mode.buy('a','sniper',1000,()=>true),false);
  assert.equal(mode.buy('a','fake',60000,()=>true),false);
  assert.equal(mode.buy('a','sniper',60000,()=>false),false);
  assert.equal(a.credits,180);
  assert.equal(mode.buy('a','sniper',60000,()=>true),true);
  assert.equal(a.credits,40);
  assert.equal(mode.buy('a','sniper',60000,()=>true),false);
  assert.equal(mode.buy('a','escudo',80000,()=>true),false);
});
