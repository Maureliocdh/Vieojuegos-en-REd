const { test, expect } = require('@playwright/test');

test('Selector persistente y estación compartida en todos los modos', async ({ page, context }, testInfo) => {
  test.setTimeout(45000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  await page.locator('#match-map').selectOption('orbital');
  await expect(page.locator('#map-name')).toHaveText('Estación Orbital');
  await page.reload();
  await expect(page.locator('#match-map')).toHaveValue('orbital');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  await page.locator('#nickname').fill('Orbital');
  const guest = await context.newPage();
  guest.on('pageerror', error => errors.push(error.message));
  await guest.goto('/');
  await expect(guest.locator('#jugar-button')).toBeEnabled();
  await guest.locator('#nickname').fill('Tripulación');
  for (const mode of ['clasico', 'puzzles', 'solo', 'equipos']) {
    await page.locator(`[data-mode=${mode}]`).click();
    await page.locator('#match-bots').selectOption('0');
    await page.locator('#jugar-button').click();
    await expect(page.locator('#room-rules')).toContainText('Estación Orbital');
    await expect(guest.locator('#match-map')).toHaveValue('orbital');
    await expect(guest.locator('#match-map')).toBeDisabled();
    if (mode !== 'solo') {
      await guest.locator('#jugar-button').click();
      await expect(page.locator('#room-players li')).toHaveCount(2);
    }
    await page.locator('#start-match').click();
    await page.waitForFunction(() => gameStarted && WorldArt.map === 'orbital'
      && obstaculos.some(object => object.tipo === 'contenedor'));
    if (mode === 'clasico') {
      await expect(page.locator('#match-countdown')).toBeHidden({ timeout: 8000 });
      await page.bringToFront();
      await page.screenshot({ path: testInfo.outputPath('orbital.png') });
    } else if (mode === 'puzzles') {
      await expect(page.locator('#tactical-screen')).toBeVisible();
    }
    if (mode !== 'solo') {
      await page.locator('#leave-match').click();
      await page.getByRole('button', { name: 'Volver a la partida', exact: true }).click();
      await expect(page.locator('#pantalla-inicio')).toBeHidden();
      expect(await page.evaluate(() => WorldArt.map)).toBe('orbital');
      await guest.locator('#leave-match').click();
    }
    await page.locator('#leave-match').click();
    await expect(page.locator('#jugar-button')).toBeEnabled();
  }
  await page.locator('#match-map').selectOption('outpost');
  await page.locator('#jugar-button').click();
  await expect(page.locator('#room-rules')).toContainText('Isla Outpost');
  await page.waitForFunction(() => WorldArt.map === 'outpost' && obstaculos.some(object => object.tipo === 'arbol'));
  await page.locator('#leave-match').click();
  await guest.close();
  expect(errors).toEqual([]);
});

test('Resultados y menú permiten votar y recibir la ronda automática en el mapa ganador', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  await page.evaluate(() => {
    window.originalReceive = network.receive;
    network.receive = (type, data) => { if (type !== 'estadoJuego') window.originalReceive.call(network, type, data); };
    gameStarted = true;
    network.receive('finDeJuego', [{ id: network.id, nombre: 'Piloto', skin: 'nova', kills: 5 }]);
    window.testVote = { activa: true, segundos: 15, electores: [network.id],
      votos: {}, recuento: { outpost: 0, orbital: 0 }, ganador: null };
    currentRoom = { ...currentRoom, votacion: window.testVote };
    network.receive('estadoVotacion', window.testVote);
    window.voteRequests = [];
    window.originalNetworkSend = network.send;
    network.send = (type, data) => window.voteRequests.push({ type, data });
  });
  const results = page.locator('#pantalla-fin .map-vote');
  await expect(results).toBeVisible();
  await expect(results.locator('.vote-status')).toContainText('15 s');
  await results.locator('[data-vote-map=orbital]').click();
  expect(await page.evaluate(() => window.voteRequests)).toEqual([{ type: 'votarMapa', data: { mapa: 'orbital' } }]);
  await page.evaluate(() => {
    window.testVote.votos[network.id] = 'orbital';
    window.testVote.recuento.orbital = 1;
    network.receive('estadoVotacion', window.testVote);
  });
  await expect(results.locator('[data-vote-map=orbital]')).toHaveAttribute('aria-pressed', 'true');
  await expect(results.locator('[data-vote-map=orbital]')).toContainText('1 voto');
  await page.screenshot({ path: testInfo.outputPath('map-vote.png'), fullPage: true });
  await page.locator('#return-home').click();
  const menu = page.locator('#pantalla-inicio .map-vote');
  await expect(menu).toBeVisible();
  await expect(page.locator('#jugar-button')).toBeDisabled();
  await menu.locator('[data-vote-map=outpost]').click();
  expect(await page.evaluate(() => window.voteRequests.at(-1))).toEqual({ type: 'votarMapa', data: { mapa: 'outpost' } });
  await page.evaluate(() => {
    window.testVote.activa = false;
    window.testVote.segundos = 0;
    window.testVote.ganador = 'orbital';
    network.receive('estadoSala', { ...currentRoom, votacion: window.testVote, mapaSiguiente: 'orbital' });
    network.receive('estadoVotacion', window.testVote);
  });
  await expect(menu.locator('.vote-status')).toContainText('Próximo mapa: Estación Orbital');
  await expect(menu.locator('[data-vote-map=orbital]')).toBeDisabled();
  await expect(page.locator('#match-map')).toHaveValue('orbital');
  await expect(page.locator('#match-map')).toBeDisabled();
  await expect(page.locator('#jugar-button')).toBeEnabled();
  expect(await page.evaluate(() => window.voteRequests.some(request => request.type === 'iniciarSala'))).toBe(false);
  await page.evaluate(() => {
    network.receive('configMapa', { MAP_WIDTH: 6000, MAP_HEIGHT: 6000, mapa: 'orbital',
      obstaculos: ArenaMaps.create('orbital').obstacles, zonasEspeciales: [] });
    network.receive('estadoSala', { ...currentRoom, activa: true, anfitrionId: network.id,
      jugadores: [{ id: network.id, nombre: 'Piloto', skin: 'nova' }], reglas: { mapa: 'orbital' } });
    network.receive('inicioPartida', { tiempoRestante: 120, preparacionRestante: 4 });
  });
  await expect(page.locator('#pantalla-fin')).toBeHidden();
  await expect(page.locator('#pantalla-inicio')).toBeHidden();
  await expect(page.locator('#match-countdown')).toBeVisible();
  expect(await page.evaluate(() => ({ gameStarted, resultsPinned, mapa: WorldArt.map })))
    .toEqual({ gameStarted: true, resultsPinned: false, mapa: 'orbital' });
  await page.evaluate(() => { network.send = window.originalNetworkSend; network.receive = window.originalReceive; });
});

test('La ronda automática sustituye resultados fijados sin pulsar Volver al inicio', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  await page.evaluate(() => {
    window.originalReceive = network.receive;
    network.receive = (type, data) => { if (type !== 'estadoJuego') window.originalReceive.call(network, type, data); };
    gameStarted = true;
    network.receive('finDeJuego', [{ id: network.id, nombre: 'Piloto', skin: 'nova', kills: 5 }]);
    network.receive('estadoSala', { ...currentRoom, activa: true, anfitrionId: network.id,
      jugadores: [{ id: network.id, nombre: 'Piloto', skin: 'nova' }], reglas: { mapa: 'outpost' } });
    network.receive('inicioPartida', { tiempoRestante: 60, preparacionRestante: 4 });
  });
  await expect(page.locator('#pantalla-fin')).toBeHidden();
  await expect(page.locator('#match-countdown')).toBeVisible();
  expect(await page.evaluate(() => gameStarted && !gameFinished && !resultsPinned)).toBe(true);
  await page.evaluate(() => { network.receive = window.originalReceive; });
});

test('Compuertas sincronizadas, interiores sin rótulos y agujeros negros visibles', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  await page.locator('#match-map').selectOption('orbital');
  await page.locator('#match-bots').selectOption('0');
  await page.locator('#nickname').fill('Piloto');
  await page.locator('#jugar-button').click();
  await page.locator('#start-match').click();
  await page.waitForFunction(() => gameStarted);
  await expect(page.locator('#match-countdown')).toBeHidden({ timeout: 8000 });
  await page.evaluate(() => {
    const room = obstaculos.find(object => object.puertas?.length === 2);
    const door = Buildings.doors(room)[0];
    const position = { x: door.x + 70, y: door.y + door.height / 2 };
    window.testStationPosition = position;
    window.originalMoveSend = network.send;
    network.send = function (type, data) {
      return window.originalMoveSend.call(this, type, type === 'movimiento' ? { ...data, ...position } : data);
    };
    Object.assign(player, position);
    network.send('movimiento', { x: player.x, y: player.y, angle: 0 });
  });
  await page.waitForFunction(() => getNearbyDoor(jugadores[network.id])?.compuerta);
  const mobile = await page.evaluate(() => isMobile);
  if (mobile) await page.locator('#swap-button').click();
  else await page.keyboard.press('e');
  await page.waitForFunction(() => obstaculos.find(object => object.puertas?.length === 2).puertas[0].abierta);
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath('station-hatch.png') });
  const render = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 1000;
    const context = canvas.getContext('2d'), texts = [], colors = [];
    const fillText = context.fillText.bind(context), gradient = context.createRadialGradient.bind(context);
    context.fillText = (...args) => { texts.push(args[0]); fillText(...args); };
    context.createRadialGradient = (...args) => {
      const value = gradient(...args), add = value.addColorStop.bind(value);
      value.addColorStop = (offset, color) => { colors.push(color); add(offset, color); };
      return value;
    };
    WorldArt.terrain(context, new Image(), 6000, 6000);
    for (const object of obstaculos.filter(Buildings.isBuilding)) {
      WorldArt.obstacle(context, object);
      WorldArt.roof(context, object, { x: object.x + 500, y: object.y + 500 });
    }
    WorldArt.specialZones(context);
    return { texts, colors, types: SpecialZones.zones.map(zone => zone.tipo) };
  });
  expect(render.texts).toEqual([]);
  expect(render.colors).toContain('#05030b');
  expect(render.colors).toContain('#d5f8ffff');
  expect(render.types.filter(type => type === 'agujeroNegro')).toHaveLength(3);
  expect(render.types).not.toContain('contaminacion');
  await page.evaluate(() => {
    const zone = SpecialZones.zones.find(zone => zone.tipo === 'agujeroNegro');
    Object.assign(window.testStationPosition, { x: zone.x, y: zone.y + 220 });
    Object.assign(player, window.testStationPosition);
  });
  await page.waitForFunction(() => {
    const target = window.testStationPosition, local = jugadores[network.id];
    return Math.hypot(target.x - local.x, target.y - local.y) < 5;
  });
  await page.screenshot({ path: testInfo.outputPath('station-black-hole.png') });
  await page.evaluate(() => { network.send = window.originalMoveSend; });
  await page.locator('#leave-match').click();
  expect(errors).toEqual([]);
});
