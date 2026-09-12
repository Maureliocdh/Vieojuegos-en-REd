(function (root) {
  const skins = [
    { id: 'pulse', name: 'Pulse', role: 'Corredora neón', color: '#31dfcc', accent: '#f6fbff', detail: 'visor' },
    { id: 'ronin', name: 'Ronin', role: 'Samurái digital', color: '#ef5368', accent: '#ffe29b', detail: 'horns' },
    { id: 'nova', name: 'Nova', role: 'Exploradora orbital', color: '#f3f5ee', accent: '#ff824d', detail: 'antenna' },
    { id: 'viper', name: 'Viper', role: 'Operadora táctica', color: '#a4dd57', accent: '#263c39', detail: 'mask' },
    { id: 'glitch', name: 'Glitch', role: 'Hacker de asfalto', color: '#ee78ce', accent: '#86f5ff', detail: 'ears' },
    { id: 'tide', name: 'Tide', role: 'Piloto abisal', color: '#4db3ed', accent: '#ffe880', detail: 'fins' },
  ];
  function svgUrl(content, width = 96, height = 96) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`)}`;
  }
  function skinUrl(skin, portrait = false) {
    const ornaments = {
      visor: '<path d="M24 32L16 18 38 24M61 24L78 17 74 36"/>',
      horns: '<path d="M26 32L13 8 39 24M59 24L83 8 70 34"/>',
      antenna: '<path d="M48 22V8" stroke-width="5"/><circle cx="48" cy="8" r="5"/>',
      mask: '<path d="M27 60L48 80 70 60"/>',
      ears: '<path d="M24 35L21 8 42 24M56 24L76 8 72 36"/>',
      fins: '<path d="M23 33L8 31 18 61M73 33L88 31 78 61"/>',
    };
    return svgUrl(`<g transform="${portrait ? '' : 'rotate(90 48 48)'}" stroke="#162c32" stroke-width="3" stroke-linejoin="round"><ellipse cx="48" cy="76" rx="35" ry="12" fill="#102523" opacity=".2"/><rect x="12" y="51" width="21" height="26" rx="9" fill="${skin.color}"/><rect x="63" y="51" width="21" height="26" rx="9" fill="${skin.color}"/><path d="M27 49Q48 40 69 49L70 77Q48 87 26 77Z" fill="${skin.color}"/><path d="M37 61H59V80H37Z" fill="#263e43"/><circle cx="48" cy="42" r="27" fill="${skin.color}"/><g fill="${skin.accent}">${ornaments[skin.detail]}</g><path d="M24 37Q48 26 72 37L67 52Q48 60 29 52Z" fill="#19353d"/><path d="M30 40L44 38M53 38L65 40" stroke="${skin.accent}" stroke-width="5"/><path d="M33 24Q45 18 56 22" fill="none" stroke="#fff" opacity=".55"/><path d="M42 67H54" stroke="${skin.accent}" stroke-width="4"/></g>`);
  }
  const itemArt = {
    pistola: '<path d="M23 46L17 77H36L44 52H58V43" fill="#3e535c"/><path d="M20 29H83V48H20Z" fill="#cbd8da"/><path d="M26 32H42V44H26Z" fill="#37caba"/><path d="M48 48V60H35" fill="none"/><path d="M74 29V24M31 29V24"/><path d="M65 34V42M71 34V42" stroke="#617b84"/>',
    rifle: '<path d="M5 37L24 43V56L5 62Z" fill="#38b9a9"/><path d="M24 37H70V55H24Z" fill="#455e65"/><path d="M70 40H92V47H70Z" fill="#b9d0d0"/><path d="M33 55L28 72H40L46 55M49 55L50 73H64L61 55" fill="#304149"/><path d="M48 28H64V36H48Z" fill="#74e8dc"/><path d="M57 41H70V50H57Z" fill="#38b9a9"/>',
    sniper: '<path d="M4 45L23 48V58L4 66Z" fill="#526c91"/><path d="M22 41H61V56H22Z" fill="#6688ab"/><path d="M61 43H94V48H61Z" fill="#cfdee5"/><path d="M30 56L24 72H35L42 55" fill="#33485c"/><path d="M34 29H64V38H34Z" fill="#1f394b"/><path d="M29 26H38V41H29ZM61 26H69V41H61Z" fill="#6ad8f5"/><path d="M72 49L64 68M72 49L82 68" fill="none" stroke="#d8e0e4"/><path d="M44 38V42"/>',
    escopeta: '<path d="M5 39L29 45V57L5 65Z" fill="#c4884b"/><path d="M28 39H53V57H28Z" fill="#52565d"/><path d="M53 39H92V46H53ZM53 48H88V55H53Z" fill="#c7d0cf"/><path d="M53 46H71V60H53Z" fill="#ca924f"/><path d="M35 57L29 70H41L46 57" fill="#976139"/><path d="M56 48V58M63 48V58" stroke="#754e32"/>',
    botiquin: '<path d="M33 28V17H63V28" fill="none" stroke="#344d4b" stroke-width="7"/><rect x="12" y="28" width="72" height="56" rx="10" fill="#e8f0e7"/><path d="M12 43H84V63H12Z" fill="#e65d68" stroke="none"/><rect x="32" y="37" width="32" height="36" rx="6" fill="#fafdf5"/><path d="M44 43H52V51H60V59H52V67H44V59H36V51H44Z" fill="#e65d68" stroke="none"/><path d="M20 72H29M67 72H76" stroke="#9dadab"/>',
    escudo_pocion: '<rect x="35" y="9" width="26" height="14" rx="3" fill="#d4e6e4"/><path d="M34 23H62V32Q81 42 78 62Q76 85 48 89Q20 85 18 62Q15 42 34 32Z" fill="#62d7e7"/><path d="M24 51Q48 42 73 51V63Q70 80 48 84Q27 80 24 63Z" fill="#2783c5" stroke="none"/><path d="M34 48L48 44 62 48V61Q59 71 48 76Q37 71 34 61Z" fill="#e2fbfa"/><path d="M48 49V70" stroke="#7acfdc"/><path d="M28 39L33 35" stroke="#fff" stroke-width="5"/>',
    granada: '<rect x="37" y="12" width="22" height="18" rx="3" fill="#b9c7b5"/><path d="M58 17L73 28 78 45" fill="none" stroke="#d4dfd0" stroke-width="6"/><ellipse cx="47" cy="57" rx="25" ry="30" fill="#8aaf4f"/><path d="M24 49H70M24 63H70M47 29V85" stroke="#496f34" stroke-width="4"/>',
    'puños': '<path d="M9 34Q9 23 19 23H34Q44 23 44 35V61Q44 72 32 72H19Q9 72 9 61Z" fill="#e9c292"/><path d="M52 35Q52 23 63 23H77Q87 23 87 35V61Q87 72 77 72H63Q52 72 52 61Z" fill="#e9c292"/><path d="M9 57H44V73H9ZM52 57H87V73H52Z" fill="#dbe7e0"/><path d="M18 28V39M28 28V39M37 29V39M61 28V39M70 28V39M79 29V39" stroke="#ad875d"/>',
  };
  function itemUrl(item) {
    if (item.startsWith('ammo_')) {
      const colors = { pistola: '#37caba', rifle: '#c7df78', sniper: '#69b4ed', escopeta: '#e5ab62' };
      const labels = { pistola: 'P', rifle: 'R', sniper: 'S', escopeta: 'E' };
      const type = item.slice(5);
      return svgUrl(`<g stroke="#233b3c" stroke-width="3"><rect x="13" y="34" width="70" height="49" rx="5" fill="${colors[type]}"/><path d="M24 37V22Q29 8 34 22V37M41 37V18Q46 4 51 18V37M58 37V22Q63 8 68 22V37" fill="#e9d49a"/><path d="M13 43H83"/><rect x="34" y="49" width="28" height="27" rx="4" fill="#203b40"/></g><text x="48" y="70" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="bold" fill="#fff">${labels[type]}</text>`);
    }
    return svgUrl(`<g stroke="#203b40" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${itemArt[item] || itemArt['puños']}</g>`);
  }
  const api = { skins, skinUrl, svgUrl, itemUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GameAssets = api;
}(typeof window !== 'undefined' ? window : globalThis));