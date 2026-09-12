const { test, expect } = require('@playwright/test');

test('Lobby, skins, sonido, mapa, tormenta y controles', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Jugar ahora' })).toBeEnabled();
  await page.getByRole('button', { name: 'Ronin', exact: true }).click();
  await expect(page.locator('#skin-preview')).toHaveAttribute('alt', 'Ronin');
  await page.getByRole('textbox').fill('Prueba móvil');
  if (await page.locator('#match-kills').isEnabled()) {
    await page.locator('#match-kills').selectOption('20');
    await page.locator('#match-duration').selectOption('180');
    await page.locator('#match-bots').selectOption('5');
  }
  await page.getByRole('button', { name: 'Ajustes de sonido' }).click();
  await page.locator('#volume-master').fill('35');
  await page.locator('#volume-effects').fill('45');
  await page.locator('#volume-ambient').fill('15');
  await page.locator('#mute-audio').check();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.reload();
  await expect(page.locator('[data-skin=ronin]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#nickname')).toHaveValue('Prueba móvil');
  await expect(page.locator('#volume-master')).toHaveValue('35');
  await expect(page.locator('#mute-audio')).toBeChecked();
  await expect(page.locator('#match-bots')).toHaveValue('5');
  await page.screenshot({ path: testInfo.outputPath('lobby.png'), fullPage: true });
  const lobbyFit = await page.evaluate(() => {
    const heading = document.querySelector('.lobby-title h1');
    return { overflow: document.documentElement.scrollWidth > innerWidth, headingFits: heading.scrollWidth <= heading.clientWidth };
  });
  expect(lobbyFit).toEqual({ overflow: false, headingFits: true });
  const spectator = await context.newPage();
  await spectator.goto('/');
  await expect(spectator.getByRole('button', { name: 'Jugar ahora' })).toBeEnabled();
  await page.getByRole('button', { name: 'Jugar ahora' }).click();
  await expect(page.locator('#pantalla-inicio')).toBeHidden();
  await page.waitForFunction(() => Boolean(jugadores[network.id]));
  const heldFire = await page.evaluate(() => {
    if (isMobile) return null;
    const originalSend = network.send;
    const shots = [];
    network.send = (type) => { if (type === 'disparar') shots.push(performance.now()); };
    try {
      lastShotTime = -10000;
      canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      const immediate = shots.length;
      update(0);
      const duringCooldown = shots.length;
      lastShotTime = -10000;
      update(0);
      const held = shots.length;
      window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      lastShotTime = -10000;
      update(0);
      const released = shots.length;
      canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      window.dispatchEvent(new Event('blur'));
      lastShotTime = -10000;
      update(0);
      return { immediate, duringCooldown, held, released, blurred: shots.length };
    } finally { network.send = originalSend; fireHeld = false; }
  });
  if (heldFire) expect(heldFire).toEqual({ immediate: 1, duringCooldown: 1, held: 2, released: 2, blurred: 3 });
  await expect(spectator.locator('#pantalla-inicio')).toBeVisible();
  await expect(spectator.locator('#match-kills')).toBeDisabled();
  await expect(spectator.locator('#match-duration')).toBeDisabled();
  await expect(spectator.locator('#match-bots')).toBeDisabled();
  await expect(spectator.locator('#match-bots')).toHaveValue('5');
  await page.waitForFunction(() => Object.values(jugadores).filter((jugador) => jugador.esBot).length === 5);
  await expect(spectator.locator('#match-kills')).toHaveValue('20');
  await expect(spectator.locator('#match-duration')).toHaveValue('180');
  await page.waitForFunction(() => jugadores[network.id]?.skin === 'ronin');
  await page.waitForFunction(() => Object.values(itemImages).every((image) => image.complete && image.naturalWidth > 0));
  const handErrors = await page.evaluate(() => {
    const failures = [];
    const ratio = devicePixelRatio || 1;
    for (const skin of GameAssets.skins) {
      for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        drawWeaponOnPlayer({ x: 150, y: 150, angle, skin: skin.id, inventario: ['puños'], slotSeleccionado: 0 });
        for (const side of [-1, 1]) {
          const screenX = 150 + 23 * Math.cos(angle) - side * 17 * Math.sin(angle);
          const screenY = 150 + 23 * Math.sin(angle) + side * 17 * Math.cos(angle);
          const pixel = ctx.getImageData(Math.round(screenX * ratio), Math.round(screenY * ratio), 1, 1).data;
          const expected = skin.color.slice(1).match(/../g).map((part) => parseInt(part, 16));
          if (expected.some((value, index) => Math.abs(value - pixel[index]) > 2)) failures.push({ skin: skin.id, angle, side });
        }
      }
    }
    draw();
    return failures;
  });
  expect(handErrors).toEqual([]);
  expect(await page.evaluate(() => Object.keys(itemImages))).toEqual(expect.arrayContaining(['pistola', 'rifle', 'sniper', 'escopeta', 'botiquin', 'escudo_pocion']));
  await page.keyboard.press('1');
  await page.keyboard.press('g');
  expect(await page.evaluate(() => jugadores[network.id].inventario[0])).toBe('puños');
  expect(await page.evaluate(() => masterGain.gain.value)).toBe(0);
  await page.getByRole('button', { name: 'Ajustes de sonido' }).click();
  await page.locator('#mute-audio').uncheck();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  expect(await page.evaluate(() => Math.round(masterGain.gain.value * 100))).toBe(35);
  await spectator.locator('#nickname').fill('Segundo');
  await spectator.getByRole('button', { name: 'Nova', exact: true }).click();
  await spectator.getByRole('button', { name: 'Jugar ahora' }).click();
  await page.waitForFunction(() => Object.values(jugadores).some((player) => player.nombre === 'Segundo' && player.skin === 'nova'));
  await spectator.close();
  const mobile = testInfo.project.use.isMobile;
  if (mobile) {
    await expect(page.locator('#move-zone .back')).toBeVisible();
    await expect(page.locator('#aim-zone .back')).toBeVisible();
    const layout = await page.evaluate(() => {
      const controls = ['move-zone', 'aim-zone', 'reload-button', 'drop-button', 'grenade-button', 'game-settings', 'scoreboard'];
      const rectangles = controls.map((id) => ({ id, ...document.getElementById(id).getBoundingClientRect().toJSON() }));
      rectangles.push({ id: 'inventory', x: (innerWidth - 252) / 2, y: innerHeight - 56, width: 252, height: 44 });
      rectangles.push({ id: 'minimap', x: innerHeight >= 500 ? innerWidth - 88 : 14, y: 70, width: 76, height: 76 });
      const overlaps = [];
      for (let first = 0; first < rectangles.length; first += 1) {
        for (let second = first + 1; second < rectangles.length; second += 1) {
          const left = rectangles[first]; const right = rectangles[second];
          if (left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y) overlaps.push(`${left.id}/${right.id}`);
        }
      }
      return { overlaps, outside: rectangles.filter((rectangle) => rectangle.x < 0 || rectangle.y < 0 || rectangle.x + rectangle.width > innerWidth || rectangle.y + rectangle.height > innerHeight).map((rectangle) => rectangle.id) };
    });
    expect(layout).toEqual({ overlaps: [], outside: [] });
    const session = await context.newCDPSession(page);
    const zone = await page.locator('#move-zone').boundingBox();
    const before = await page.evaluate(() => ({ x: player.x, y: player.y }));
    const center = { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x + 35, y: center.y }] });
    await page.waitForFunction((position) => Math.hypot(player.x - position.x, player.y - position.y) > 5, before);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => movement.x === 0 && movement.y === 0);
  }
  const storm = await page.evaluate(() => {
    const original = zonaSegura;
    const ratio = devicePixelRatio || 1;
    const failures = [];
    const cases = [{ x: innerWidth / 2, y: innerHeight / 2, radio: 9000 }, { x: innerWidth / 2, y: innerHeight / 2, radio: 110 }, { x: -30, y: 120, radio: 170 }];
    for (const zone of cases) {
      zonaSegura = zone;
      ctx.fillStyle = '#408040'; ctx.fillRect(0, 0, innerWidth, innerHeight);
      drawZonaSegura(innerWidth / 2, innerHeight / 2);
      for (let screenX = 20; screenX < innerWidth; screenX += 37) {
        for (let screenY = 20; screenY < innerHeight; screenY += 37) {
          const distance = Math.hypot(screenX - zone.x, screenY - zone.y);
          if (Math.abs(distance - zone.radio) < 6) continue;
          const pixel = ctx.getImageData(Math.floor(screenX * ratio), Math.floor(screenY * ratio), 1, 1).data;
          const clear = pixel[0] === 64 && pixel[1] === 128 && pixel[2] === 64 && pixel[3] === 255;
          if (clear !== (distance < zone.radio)) failures.push({ screenX, screenY, zone, pixel: [...pixel] });
        }
      }
    }
    zonaSegura = original;
    draw();
    return failures;
  });
  expect(storm).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('game.png') });
  await page.waitForFunction(() => {
    const building = obstaculos.find(Buildings.isBuilding);
    const door = Buildings.door(building);
    if (getNearbyDoor(jugadores[network.id])) return true;
    Object.assign(player, { x: door.x + 48, y: door.y + 75 });
    network.send('movimiento', { x: player.x, y: player.y, angle: -Math.PI / 2 });
    return false;
  });
  await page.waitForFunction(() => Boolean(getNearbyDoor(jugadores[network.id])));
  const open = await page.evaluate(() => getNearbyDoor(jugadores[network.id]).puertaAbierta);
  if (!open) {
    if (mobile) await page.getByRole('button', { name: 'Abrir puerta', exact: true }).click();
    else await page.keyboard.press('e');
  }
  await page.waitForFunction(() => getNearbyDoor(jugadores[network.id])?.puertaAbierta);
  await page.waitForFunction(() => {
    const building = obstaculos.find(Buildings.isBuilding);
    if (Buildings.inside(building, jugadores[network.id])) return true;
    Object.assign(player, { x: building.x + building.width / 2, y: building.y + building.height / 2 });
    network.send('movimiento', { x: player.x, y: player.y, angle: -Math.PI / 2 });
    return false;
  });
  await page.waitForFunction(() => obstaculos.some((building) => Buildings.isBuilding(building) && Buildings.inside(building, jugadores[network.id])));
  const roofCheck = await page.evaluate(() => {
    const buffer = document.createElement('canvas'); buffer.width = 300; buffer.height = 300;
    const context = buffer.getContext('2d');
    const building = { x: 0, y: 0, width: 300, height: 300, tipo: 'casa', id: 'roof-test' };
    function paint(observer) { context.fillStyle = '#408040'; context.fillRect(0, 0, 300, 300); WorldArt.roof(context, building, observer); }
    paint({ x: -100, y: -100 });
    const outside = [...context.getImageData(110, 130, 1, 1).data];
    for (let frame = 0; frame < 60; frame += 1) paint({ x: 150, y: 150 });
    const inside = [...context.getImageData(110, 130, 1, 1).data];
    return { outside, inside };
  });
  expect(Math.abs(roofCheck.inside[0] - 64)).toBeLessThan(20);
  expect(Math.abs(roofCheck.outside[0] - 64)).toBeGreaterThan(70);
  await page.evaluate(() => new Promise((resolve) => {
    let frames = 0;
    function next() { frames += 1; if (frames >= 30) resolve(); else requestAnimationFrame(next); }
    requestAnimationFrame(next);
  }));
  await page.screenshot({ path: testInfo.outputPath('interior.png') });
  const chestId = await page.evaluate(() => cofres.find((chest) => !chest.abierto)?.id);
  if (chestId) {
    await page.waitForFunction((id) => {
      const chest = cofres.find((candidate) => candidate.id === id);
      if (getNearbyChest(jugadores[network.id])?.id === id) return true;
      Object.assign(player, { x: chest.x, y: chest.y + 70 });
      network.send('movimiento', { x: player.x, y: player.y, angle: 0 });
      return false;
    }, chestId);
    if (mobile) await page.getByRole('button', { name: 'Abrir cofre', exact: true }).click();
    else await page.keyboard.press('e');
    await page.waitForFunction((id) => cofres.find((chest) => chest.id === id)?.abierto, chestId);
  }
  const rarityPixels = await page.evaluate(() => {
    const colors = [];
    for (const rarity of [0, 1, 2]) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      drawItemIcon('pistola', 100, 100, 32, rarity);
      const ratio = devicePixelRatio || 1;
      colors.push([...ctx.getImageData(Math.round(81 * ratio), Math.round(100 * ratio), 1, 1).data].slice(0, 3));
    }
    draw();
    return colors;
  });
  expect(rarityPixels).toEqual([[76, 168, 255], [203, 117, 244], [255, 211, 78]]);
  const bushCheck = await page.evaluate(() => {
    const buffer = document.createElement('canvas'); buffer.width = 200; buffer.height = 180;
    const context = buffer.getContext('2d');
    const bush = { tipo: 'arbusto', x: 0, y: 0, width: 190, height: 160 };
    WorldArt.bush(context, bush, { x: -100, y: -100 });
    const outsideAlpha = context.getImageData(95, 80, 1, 1).data[3];
    context.clearRect(0, 0, 200, 180);
    WorldArt.bush(context, bush, { x: 95, y: 80 });
    const insideAlpha = context.getImageData(95, 80, 1, 1).data[3];
    const local = jugadores[network.id];
    const originalPosition = { x: local.x, y: local.y };
    const actualBush = obstaculos.find((object) => object.tipo === 'arbusto');
    const enemy = { ...local, x: actualBush.x + 95, y: actualBush.y + 80, nombre: 'Oculto' };
    jugadores['bush-test'] = enemy;
    const originalDrawWeapon = drawWeaponOnPlayer;
    let visible = false;
    drawWeaponOnPlayer = (target) => { if (target === enemy) visible = true; originalDrawWeapon(target); };
    try {
      Object.assign(local, { x: actualBush.x - 100, y: enemy.y });
      draw(); const outsideVisible = visible;
      visible = false;
      Object.assign(local, { x: enemy.x, y: enemy.y });
      draw(); const insideVisible = visible;
      return { outsideAlpha, insideAlpha, outsideVisible, insideVisible };
    } finally {
      Object.assign(local, originalPosition);
      delete jugadores['bush-test'];
      drawWeaponOnPlayer = originalDrawWeapon;
      draw();
    }
  });
  expect(bushCheck.outsideAlpha).toBe(255);
  expect(bushCheck.insideAlpha).toBeGreaterThan(50);
  expect(bushCheck.insideAlpha).toBeLessThan(80);
  expect(bushCheck.outsideVisible).toBe(false);
  expect(bushCheck.insideVisible).toBe(true);
  const resultMusic = await page.evaluate(() => {
    const results = [];
    const originalMusic = playResultMusic;
    playResultMusic = (victory) => { results.push(victory); originalMusic(victory); };
    try {
      gameStarted = true;
      network.receive('finDeJuego', [{ id: network.id, nombre: 'Podio', kills: 10 }]);
      const victoryNotes = resultNotes.size;
      network.receive('finDeJuego', [{ id: network.id, nombre: 'Podio', kills: 10 }]);
      network.receive('reinicioPartida');
      const resetNotes = resultNotes.size;
      gameStarted = true;
      network.receive('finDeJuego', [{ id: 'otro-id', nombre: jugadores[network.id].nombre, kills: 10 }]);
      const defeatNotes = resultNotes.size;
      const mutedBefore = ArenaUI.muted;
      ArenaUI.muted = true; updateAudioLevels();
      const mutedGain = masterGain.gain.value;
      ArenaUI.muted = mutedBefore; updateAudioLevels();
      network.receive('reinicioPartida');
      network.receive('finDeJuego', []);
      return { results, victoryNotes, defeatNotes, resetNotes, mutedGain };
    } finally { playResultMusic = originalMusic; stopResultMusic(); }
  });
  expect(resultMusic.results).toEqual([true, false]);
  expect(resultMusic.victoryNotes).toBe(20);
  expect(resultMusic.defeatNotes).toBe(14);
  expect(resultMusic.resetNotes).toBe(0);
  expect(resultMusic.mutedGain).toBe(0);
  expect(errors).toEqual([]);
});