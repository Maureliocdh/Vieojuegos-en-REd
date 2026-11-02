const { test, expect } = require('@playwright/test');

test('Audio de armas real: señal audible, estéreo, volumen, limpieza y límite de voces', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  const results = await page.evaluate(async () => {
    const results = [];
    for (const weapon of ['pistola', 'rifle', 'escopeta', 'sniper']) {
      const context = new OfflineAudioContext(2, 57600, 48000);
      let disconnected = 0;
      const source = WeaponAudio.play(context, context.destination, weapon, { volume: 0.6, pan: -1 });
      const disconnect = source.disconnect.bind(source);
      source.disconnect = () => { disconnected += 1; disconnect(); };
      const rendered = await context.startRendering();
      await new Promise(resolve => setTimeout(resolve, 0));
      const left = rendered.getChannelData(0), right = rendered.getChannelData(1);
      const energy = data => data.reduce((sum, value) => sum + value * value, 0);
      results.push({ weapon, left: energy(left), right: energy(right),
        peak: left.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0), disconnected });
    }
    const context = new OfflineAudioContext(2, 57600, 48000);
    const sources = [];
    for (let i = 0; i < 30; i += 1) sources.push(WeaponAudio.play(context, context.destination, 'rifle'));
    const capped = sources.filter(source => source.onended !== null).length;
    WeaponAudio.stopAll(context);
    const cleared = sources.every(source => source.onended === null);
    const silence = await context.startRendering();
    const battle = new OfflineAudioContext(2, 57600, 48000);
    for (let i = 0; i < 12; i += 1) WeaponAudio.play(battle, battle.destination, ['rifle', 'escopeta', 'pistola', 'sniper'][i % 4]);
    const mix = await battle.startRendering();
    const mixPeak = mix.getChannelData(0).reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
    return { results, capped, cleared, mixPeak, silent: silence.getChannelData(0).every(sample => sample === 0) };
  });
  for (const result of results.results) {
    expect(result.left).toBeGreaterThan(0.1);
    expect(result.right).toBeLessThan(0.000001);
    expect(result.peak).toBeGreaterThan(0.01);
    expect(result.peak).toBeLessThan(1);
    expect(result.disconnected).toBe(1);
  }
  expect(results.capped).toBe(12);
  expect(results.cleared).toBe(true);
  expect(results.silent).toBe(true);
  expect(results.mixPeak).toBeGreaterThan(0.01);
  expect(results.mixPeak).toBeLessThan(1);
});

test('Cada disparo usa su arma; vacíos, recargas, granadas y consumibles no hacen ruido de fusil', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  await page.locator('#nickname').click();
  const result = await page.evaluate(() => {
    const original = { play: WeaponAudio.play, send: network.send, jugadores, gameStarted, gameFinished };
    const calls = [];
    WeaponAudio.play = (_context, _destination, weapon) => calls.push(weapon);
    network.send = () => {};
    try {
      gameStarted = true; gameFinished = false; preparacionRestante = 0;
      const local = { unido: true, muerto: false, inventario: ['pistola'], slotSeleccionado: 0,
        balasEnCargador: 12, vida: 50, escudo: 0, x: 1000, y: 1000 };
      jugadores = { [network.id]: local };
      for (const weapon of ['pistola', 'rifle', 'escopeta', 'sniper']) {
        local.inventario[0] = weapon;
        lastShotTime = -10000;
        shoot();
        shoot();
      }
      local.balasEnCargador = 0; lastShotTime = -10000; shoot();
      local.balasEnCargador = 12; local.recargando = true; shoot();
      local.recargando = false;
      for (const item of ['puños', 'botiquin', 'escudo_pocion', 'granada']) {
        local.inventario[0] = item; lastShotTime = -10000; shoot();
      }
      lastShotTime = -10000; throwGrenade();
      ArenaUI.muted = true; updateAudioLevels();
      playShoot('rifle');
      ArenaUI.muted = false;
      ArenaUI.effects = 0; updateAudioLevels();
      playShoot('rifle');
      ArenaUI.effects = 0.7;
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      playShoot('rifle');
      delete document.hidden;
      return calls;
    } finally {
      WeaponAudio.play = original.play; network.send = original.send;
      ({ jugadores, gameStarted, gameFinished } = original);
      consumeAnim = null; updateAudioLevels();
    }
  });
  expect(result).toEqual(['pistola', 'rifle', 'escopeta', 'sniper']);
});

test('Disparos remotos: tipo confirmado, distancia, estéreo y sin duplicados al actualizar estado', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  await page.locator('#nickname').click();
  const result = await page.evaluate(() => {
    const original = { play: WeaponAudio.play, jugadores, gameStarted, gameFinished };
    const calls = [];
    WeaponAudio.play = (_context, _destination, weapon, options) => calls.push({ weapon, ...options });
    try {
      gameStarted = true; gameFinished = false;
      const local = { x: 1000, y: 1000, unido: true, muerto: false, vida: 100, escudo: 0 };
      const enemy = { x: 1600, y: 1000, unido: true, muerto: false, vida: 100,
        ultimoDisparo: 0, ultimoDisparoArma: 'rifle', inventario: ['pistola'], slotSeleccionado: 0 };
      const packet = remote => ({ jugadores: { [network.id]: { ...local, ultimoDisparo: 50, ultimoDisparoArma: 'sniper' },
        enemy: remote }, balas: [], plataformas: [], obstaculos: [], itemsEnSuelo: [], granadas: [], cofres: [] });
      jugadores = {};
      network.receive('estadoJuego', packet({ ...enemy, ultimoDisparo: 10 }));
      network.receive('estadoJuego', packet({ ...enemy, ultimoDisparo: 20 }));
      network.receive('estadoJuego', packet({ ...enemy, ultimoDisparo: 20 }));
      network.receive('estadoJuego', packet({ ...enemy, x: 4000, ultimoDisparo: 30 }));
      network.receive('estadoJuego', packet({ ...enemy, ultimoDisparo: 40, ultimoDisparoArma: 'granada' }));
      network.receive('estadoJuego', packet({ ...enemy, unido: false, ultimoDisparo: 50 }));
      network.receive('estadoJuego', packet({ ...enemy, ultimoDisparo: 60 }));
      return calls;
    } finally {
      WeaponAudio.play = original.play;
      ({ jugadores, gameStarted, gameFinished } = original);
      updateAudioLevels();
    }
  });
  expect(result).toHaveLength(1);
  expect(result[0].weapon).toBe('rifle');
  expect(result[0].pan).toBeCloseTo(0.5);
  expect(result[0].volume).toBeCloseTo(0.65 * (1 - 600 / 1800) ** 2);
});
