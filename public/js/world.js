(() => {
  const images = {};
  const makeImage = (source) => { const image = new Image(); image.src = source; return image; };
  for (const skin of GameAssets.skins) images[skin.id] = makeImage(GameAssets.skinUrl(skin));
  const tree = makeImage(GameAssets.svgUrl('<ellipse cx="49" cy="56" rx="42" ry="37" fill="#1f462d" opacity=".3"/><path d="M44 57h12v31H44z" fill="#665c42"/><path d="M12 42L23 18 47 6 75 17 87 43 74 72 47 80 20 65Z" fill="#306343" stroke="#234a35" stroke-width="3"/><path d="M21 36L38 15 63 17 77 36 67 58 39 64 20 52Z" fill="#498450"/><path d="M31 32L45 19 64 26 68 39 47 46 29 42Z" fill="#639c5b"/>'));
  const rock = makeImage(GameAssets.svgUrl('<path d="M9 63L18 30 44 14 72 23 89 54 78 80 35 87Z" fill="#546a67" stroke="#384e4b" stroke-width="3"/><path d="M18 30L44 14 72 23 64 53 36 65 9 63Z" fill="#a2b3a3"/><path d="M18 30L42 25 55 40 36 65Z" fill="#bec8b4"/>'));
  let floorPattern = null;
  const roofOpacity = new Map();
  window.WorldArt = {
    images,
    terrain(context, image, width, height) {
      if (!floorPattern && image.complete && image.naturalWidth) floorPattern = context.createPattern(image, 'repeat');
      context.fillStyle = floorPattern || '#75a75a';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#a5b27d';
      for (const coordinate of [1200, 3000, 4800]) {
        context.fillRect(coordinate - 65, 0, 130, height);
        context.fillRect(0, coordinate - 65, width, 130);
      }
      context.fillStyle = '#718581';
      context.fillRect(2936, 0, 128, height);
      context.fillRect(0, 2936, width, 128);
      context.save();
      context.strokeStyle = '#d3d6b8';
      context.setLineDash([28, 32]);
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(3000, 0); context.lineTo(3000, height);
      context.moveTo(0, 3000); context.lineTo(width, 3000);
      context.stroke();
      context.restore();
    },
    obstacle(context, obstacle) {
      const { x, y, width, height, tipo } = obstacle;
      if (tipo === 'arbol' || tipo === 'roca') {
        const image = tipo === 'arbol' ? tree : rock;
        if (image.complete && image.naturalWidth) context.drawImage(image, x, y, width, height);
        return;
      }
      context.fillStyle = tipo === 'almacen' ? '#afb7af' : '#dbcbae';
      context.fillRect(x, y, width, height);
      context.strokeStyle = '#887d6744'; context.lineWidth = 1;
      for (let offset = 18; offset < height; offset += 30) {
        context.beginPath(); context.moveTo(x, y + offset); context.lineTo(x + width, y + offset); context.stroke();
      }
      context.fillStyle = '#638f85'; context.fillRect(x + 35, y + 35, 100, 48);
      context.fillStyle = '#25474e'; context.fillRect(x + 40, y + 40, 90, 9);
      context.fillStyle = '#a58052'; context.fillRect(x + width - 85, y + 36, 46, 46);
      context.strokeStyle = '#664c33'; context.strokeRect(x + width - 80, y + 41, 36, 36);
      context.fillStyle = '#e5e8d8'; context.fillRect(x + width - 100, y + height - 100, 55, 45);
      context.fillStyle = '#82a59a'; context.fillRect(x + width - 95, y + height - 95, 45, 10);
      context.fillStyle = '#dbe0d4';
      for (const wall of Buildings.walls(obstacle)) context.fillRect(wall.x, wall.y, wall.width, wall.height);
    },
    roof(context, obstacle, observer) {
      if (!Buildings.isBuilding(obstacle)) return;
      const { x, y, width, height, tipo } = obstacle;
      const target = Buildings.inside(obstacle, observer) ? 0.03 : 1;
      const previous = roofOpacity.get(obstacle.id) ?? target;
      const opacity = previous + (target - previous) * 0.18;
      roofOpacity.set(obstacle.id, opacity);
      context.save(); context.globalAlpha = opacity;
      context.fillStyle = '#23433055'; context.fillRect(x + 10, y + 12, width, height);
      context.fillStyle = '#d4d7c1'; context.fillRect(x - 6, y - 6, width + 12, height + 12);
      context.fillStyle = tipo === 'almacen' ? '#617f87' : '#c57666'; context.fillRect(x, y, width, height);
      context.save();
      context.beginPath(); context.rect(x, y, width, height); context.clip();
      context.strokeStyle = '#22373444'; context.lineWidth = 2;
      for (let offset = 16; offset < height; offset += 22) {
        context.beginPath(); context.moveTo(x, y + offset); context.lineTo(x + width, y + offset); context.stroke();
      }
      context.fillStyle = '#ffffff18'; context.fillRect(x, y, width / 2, height);
      context.fillStyle = '#394f54'; context.fillRect(x + width / 2 - 5, y, 10, height);
      context.fillStyle = '#dbe6df'; context.fillRect(x + 30, y + 30, 52, 44);
      context.fillStyle = '#45656f'; context.fillRect(x + 36, y + 36, 40, 32);
      context.restore();
      context.restore();
      const door = Buildings.door(obstacle);
      context.fillStyle = obstacle.puertaAbierta ? '#d4be86' : '#345451';
      if (obstacle.puertaAbierta) context.fillRect(door.x, door.y - 75, 12, 85);
      else context.fillRect(door.x, door.y, door.width, door.height);
      context.fillStyle = '#f2d66c'; context.fillRect(door.x + (obstacle.puertaAbierta ? 3 : 75), door.y + 5, 6, 6);
    },
  };
})();