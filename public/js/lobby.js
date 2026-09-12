(() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('outpost-settings')) || {}; } catch {}
  const volume = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  const ui = window.ArenaUI = {
    skin: GameAssets.skins.some((skin) => skin.id === saved.skin) ? saved.skin : 'pulse',
    name: typeof saved.name === 'string' ? saved.name.slice(0, 16) : '',
    limiteKills: [5, 10, 20, 30].includes(saved.limiteKills) ? saved.limiteKills : 10,
    duracion: [60, 120, 180, 300].includes(saved.duracion) ? saved.duracion : 120,
    master: volume(saved.master, 0.65), effects: volume(saved.effects, 0.7), ambient: volume(saved.ambient, 0.25), muted: saved.muted === true,
    save() { try { localStorage.setItem('outpost-settings', JSON.stringify(this)); } catch {} },
  };
  const picker = document.getElementById('skin-picker');
  function selectSkin(id) {
    ui.skin = id;
    const skin = GameAssets.skins.find((candidate) => candidate.id === id);
    document.documentElement.style.setProperty('--operator-color', skin.color);
    document.getElementById('skin-preview').src = GameAssets.skinUrl(skin, true);
    document.getElementById('skin-preview').alt = skin.name;
    document.getElementById('skin-name').textContent = skin.name;
    document.getElementById('skin-role').textContent = skin.role;
    for (const button of picker.children) button.setAttribute('aria-pressed', String(button.dataset.skin === id));
    ui.save();
  }
  for (const skin of GameAssets.skins) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.skin = skin.id;
    button.title = skin.name;
    button.setAttribute('aria-label', skin.name);
    const image = new Image(68, 68);
    image.alt = '';
    image.src = GameAssets.skinUrl(skin, true);
    button.append(image);
    button.addEventListener('click', () => selectSkin(skin.id));
    picker.append(button);
  }
  selectSkin(ui.skin);
  for (const [id, field] of [['match-kills', 'limiteKills'], ['match-duration', 'duracion']]) {
    const select = document.getElementById(id);
    select.value = ui[field];
    select.addEventListener('change', () => { ui[field] = Number(select.value); ui.save(); });
  }
  document.getElementById('nickname').value = ui.name;
  document.getElementById('nickname').addEventListener('input', (event) => { ui.name = event.target.value; ui.save(); });
  for (const channel of ['master', 'effects', 'ambient']) {
    const slider = document.getElementById(`volume-${channel}`);
    const output = document.getElementById(`value-${channel}`);
    slider.value = Math.round(ui[channel] * 100);
    output.value = `${slider.value}%`;
    slider.addEventListener('input', () => {
      ui[channel] = Number(slider.value) / 100;
      output.value = `${slider.value}%`;
      ui.save();
      window.dispatchEvent(new Event('audio-settings'));
    });
  }
  const mute = document.getElementById('mute-audio');
  mute.checked = ui.muted;
  mute.addEventListener('change', () => { ui.muted = mute.checked; ui.save(); window.dispatchEvent(new Event('audio-settings')); });
  const dialog = document.getElementById('sound-dialog');
  document.querySelectorAll('.settings-trigger').forEach((button) => button.addEventListener('click', () => dialog.showModal()));
  window.lucide?.createIcons();
})();