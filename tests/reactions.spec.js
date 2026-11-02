const { test, expect } = require('@playwright/test');

test('Rueda de cuatro emojis: teclado y táctil, réplica real, caducidad y cierre al salir', async ({ page, context }, testInfo) => {
  test.setTimeout(40000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#jugar-button')).toBeEnabled();
  await expect(page.locator('#quick-chat')).toBeHidden();
  await page.locator('#nickname').fill('Reacciones');
  await page.locator('#match-bots').selectOption('0');
  await page.locator('#jugar-button').click();
  const guest = await context.newPage();
  guest.on('pageerror', error => errors.push(error.message));
  await guest.goto('/');
  await expect(guest.locator('#jugar-button')).toBeEnabled();
  await guest.locator('#nickname').fill('Observador');
  await guest.locator('#jugar-button').click();
  await expect(page.locator('#room-players li')).toHaveCount(2);
  await page.locator('#start-match').click();
  await page.waitForFunction(() => gameStarted && preparacionRestante === 0);
  const id = await page.evaluate(() => network.id);
  const mobile = await page.evaluate(() => isMobile);
  if (mobile) {
    const chatBounds = await page.locator('#quick-chat').boundingBox();
    expect(chatBounds.y).toBeGreaterThanOrEqual(160);
  }
  const open = async () => {
    await page.bringToFront();
    if (mobile) await page.locator('#quick-chat').click();
    else await page.keyboard.down('c');
    await expect(page.locator('#reaction-wheel')).toBeVisible();
  };
  await open();
  await expect(page.locator('.reaction-circle button')).toHaveCount(4);
  const bounds = await page.locator('#reaction-wheel').boundingBox();
  expect(bounds.width).toBe(bounds.height);
  expect(await page.locator('#reaction-wheel').evaluate(element => getComputedStyle(element).borderRadius)).toBe('50%');
  const before = await page.evaluate(() => ({ x: player.x, y: player.y, ammo: jugadores[network.id].balasEnCargador }));
  await page.keyboard.down('w');
  await page.waitForTimeout(200);
  await page.keyboard.up('w');
  expect(await page.evaluate(() => ({ x: player.x, y: player.y, ammo: jugadores[network.id].balasEnCargador }))).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('emoji-wheel.png') });
  for (const reaction of ['like', 'dislike', 'risa', 'enojo']) {
    if (reaction !== 'like') {
      await page.waitForTimeout(2050);
      await open();
    }
    if (mobile) await page.locator(`[data-reaction=${reaction}]`).click();
    else {
      await page.locator(`[data-reaction=${reaction}]`).hover();
      await expect(page.locator(`[data-reaction=${reaction}]`)).toHaveClass('selected');
      const previous = await page.evaluate(() => jugadores[network.id].reaccion);
      expect(previous).not.toBe(reaction);
      await page.keyboard.up('c');
    }
    await expect(page.locator('#reaction-wheel')).not.toBeVisible();
    await guest.waitForFunction(({ id, reaction }) => jugadores[id]?.reaccion === reaction
      && jugadores[id]?.reaccionHasta > Date.now(), { id, reaction });
    await page.waitForFunction(reaction => jugadores[network.id]?.reaccion === reaction, reaction);
    const drawn = await page.evaluate(() => {
      const emoji = GameAssets.reactions.find(reaction => reaction.id === jugadores[network.id].reaccion).emoji;
      const original = ctx.fillText;
      let drawn = false;
      ctx.fillText = function (text, ...args) { if (text === emoji) drawn = true; return original.call(this, text, ...args); };
      draw();
      ctx.fillText = original;
      return drawn;
    });
    expect(drawn).toBe(true);
    if (reaction === 'like') {
      await page.evaluate(() => network.send('reaccion', { reaccion: 'risa' }));
      await expect(page.locator('#reaction-status')).toContainText('Espera');
      expect(await page.evaluate(() => jugadores[network.id].reaccion)).toBe('like');
      await page.evaluate(() => network.send('reaccion', { reaccion: 'inventada' }));
      await expect(page.locator('#reaction-status')).toContainText('no válida');
    }
  }
  await page.waitForTimeout(3100);
  expect(await page.evaluate(() => jugadores[network.id].reaccionHasta <= Date.now())).toBe(true);
  await open();
  await page.keyboard.press('Escape');
  await page.keyboard.up('c');
  await expect(page.locator('#reaction-wheel')).not.toBeVisible();
  if (!mobile) {
    const previous = await page.evaluate(() => jugadores[network.id].reaccionHasta);
    await open();
    const center = await page.locator('#close-reactions').boundingBox();
    await page.mouse.move(center.x + center.width / 2, center.y + center.height / 2);
    await page.keyboard.up('c');
    await expect(page.locator('#reaction-wheel')).not.toBeVisible();
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => jugadores[network.id].reaccionHasta)).toBe(previous);
    await open();
    await page.locator('[data-reaction=like]').hover();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.keyboard.up('c');
    await expect(page.locator('#reaction-wheel')).not.toBeVisible();
    expect(await page.evaluate(() => jugadores[network.id].reaccionHasta)).toBe(previous);
  }
  await open();
  await page.evaluate(() => network.send('abandonarPartida', {}));
  await expect(page.locator('#reaction-wheel')).not.toBeVisible();
  await page.keyboard.up('c');
  await expect(page.locator('#quick-chat')).toBeHidden();
  await guest.locator('#leave-match').click();
  await guest.close();
  expect(errors).toEqual([]);
});
