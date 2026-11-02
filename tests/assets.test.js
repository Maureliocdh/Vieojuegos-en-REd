const { test } = require('node:test');
const assert = require('node:assert/strict');
const Assets = require('../public/js/assets');

test('Skins: doce identidades, seis nuevas con dos por mapa y siluetas SVG originales', () => {
  assert.equal(Assets.skins.length, 12);
  assert.equal(new Set(Assets.skins.map(skin => skin.id)).size, 12);
  assert.equal(new Set(Assets.skins.map(skin => skin.detail)).size, 12);
  for (const theme of ['outpost', 'orbital', 'desierto']) {
    assert.equal(Assets.skins.filter(skin => skin.theme === theme).length, 2);
  }
  for (const skin of Assets.skins) {
    for (const portrait of [true, false]) {
      const svg = decodeURIComponent(Assets.skinUrl(skin, portrait));
      assert.ok(svg.includes('<svg'));
      assert.ok(svg.includes(skin.color));
      assert.ok(svg.includes(skin.accent));
      assert.ok(!svg.includes('undefined'));
      assert.equal(svg.includes('rotate(90 48 48)'), !portrait);
    }
  }
});
