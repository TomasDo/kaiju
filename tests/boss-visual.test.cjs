// 用本地 Three.js 在 Node 中验证模型与游戏生命周期；无需安装依赖。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const THREE = require(path.join(root, 'vendor/three.min.js'));
const elements = new Map();
function element(id){
  if(!elements.has(id)) elements.set(id, {
    width:1280, height:800, style:{}, classList:{add(){},remove(){}}, addEventListener(){},
    getContext:() => ({fillRect(){},fillText(){},strokeText(){},measureText:text => ({width:text.length * 24})})
  });
  return elements.get(id);
}
const context = vm.createContext({
  THREE, console, assert,
  document:{getElementById:element, createElement:() => element('texture'), addEventListener(){}},
  window:{innerWidth:1280,innerHeight:800,addEventListener(){}},
  requestAnimationFrame(){},
  localStorage:{getItem(){return null;},setItem(){}}
});
for(const script of ['boss-model.js','city-visual.js','unit-visual.js','kaiju-visual.js']) vm.runInContext(fs.readFileSync(path.join(root, script), 'utf8'), context);
const html = fs.readFileSync(path.join(root, 'kaiju-destroyer.html'), 'utf8');
const gameScript = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('class Game'));
assert(gameScript, 'Game script exists');
const startup = gameScript.lastIndexOf('\nloadHighScore();');
assert(startup >= 0, 'Browser startup boundary exists');
vm.runInContext(gameScript.slice(0,startup), context);
vm.runInContext(`
  renderer = {};
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera();
  buildingGroup = new THREE.Group(); entityGroup = new THREE.Group(); fxGroup = new THREE.Group();
  playerMesh = createGodzillaMesh(); aimLine = new THREE.Group(); stompRing = new THREE.Group();
  entityGroup.add(playerMesh, aimLine);
  game = new Game();
`, context);

let passed = 0;
function test(name, script){
  vm.runInContext(`(() => {${script}})()`, context);
  passed++;
  console.log('PASS ' + name);
}

test('共享几何体，独立受击材质，模型边界和顶点有效', `
  const a = BossVisual.create(), b = BossVisual.create();
  const am = [], bm = [];
  a.traverse(o => {if(o.isMesh) am.push(o);}); b.traverse(o => {if(o.isMesh) bm.push(o);});
  assert(am.length <= 36, 'Draw calls per boss stay bounded');
  for(let i = 0; i < am.length; i++){
    assert.equal(am[i].geometry, bm[i].geometry);
    assert.notEqual(am[i].material, bm[i].material);
    assert([...am[i].geometry.attributes.position.array].every(Number.isFinite));
  }
  const bounds = new THREE.Box3().setFromObject(a);
  assert(bounds.min.y >= -0.002 && bounds.min.y < 0.015, 'Feet meet the ground');
  assert(bounds.max.y > 1.5 && bounds.max.y < 1.8, 'Silhouette retains gameplay scale');
  let disposedGeometry = 0, disposedMaterial = 0;
  am[0].geometry.addEventListener('dispose', () => disposedGeometry++);
  am[0].material.addEventListener('dispose', () => disposedMaterial++);
  BossVisual.dispose(a);
  assert.equal(disposedMaterial, 1);
  assert.equal(disposedGeometry, 0);
  assert.equal(BossVisual.create().children.length, b.children.length);
`);

test('训话动作改变手臂和口型，相同时间保持相同姿态', `
  const model = BossVisual.create();
  BossVisual.animate(model, 2, 0);
  const arm = model.userData.rig.pointArm.rotation.x;
  const mouth = model.userData.rig.mouth.scale.y;
  BossVisual.animate(model, 2, 0.9);
  assert(model.userData.rig.pointArm.rotation.x < arm - 0.5);
  assert(model.userData.rig.mouth.scale.y > mouth);
  const pose = model.userData.rig.head.rotation.toArray().join();
  BossVisual.animate(model, 2, 0.9);
  assert.equal(model.userData.rig.head.rotation.toArray().join(), pose);
  BossVisual.dispose(model);
`);

test('楼顶生成、弹幕联动与楼塌落地', `
  const x = Math.floor(player.x + 3), y = Math.floor(player.y + 3), ci = y * MAP + x;
  map[ci] = 1; buildHeight[ci] = 3; buildDying[ci] = -1;
  spawnEnemy('boss', x + 0.5, y + 0.5);
  const boss = enemies[enemies.length - 1];
  syncEntityMeshes();
  const visual = enemyMeshMap.get(boss);
  assert(Math.abs(visual.position.y - (3 * BUILD_UNIT + 0.025)) < 0.001);
  boss.shootTimer = 0;
  game.updateEnemy(boss);
  assert.equal(boss.tauntTimer, 32);
  assert.equal(projectiles[projectiles.length - 1].ptype, 'insult');
  game.updateEnemy(boss);
  assert.equal(boss.tauntTimer, 31);
  map[ci] = 0;
  game.updateEnemy(boss); syncEntityMeshes();
  assert.equal(boss.onRoof, false);
  assert.equal(visual.position.y, 0);
`);

test('一名 Boss 受击不染红其他 Boss，结束后恢复原色', `
  spawnEnemy('boss', player.x + 4, player.y + 2);
  const a = enemies[0], b = enemies[enemies.length - 1];
  a.hitFlash = 0; b.hitFlash = 0;
  syncEntityMeshes();
  const meshes = m => {const list=[]; m.traverse(o=>{if(o.isMesh) list.push(o);}); return list;};
  const am = meshes(enemyMeshMap.get(a)), bm = meshes(enemyMeshMap.get(b));
  const colors = bm.map(m => m.material.color.getHex());
  a.hitFlash = 10; syncEntityMeshes();
  assert(am.every(m => m.material.color.getHex() === 0xff6666));
  assert(bm.every((m,i) => m.material.color.getHex() === colors[i]));
  a.hitFlash = 0; syncEntityMeshes();
  assert(am.every(m => m.material.color.getHex() === m.userData.baseHex));
`);

test('击杀掉落、缩小离场、释放和重新开局', `
  const boss = enemies[0], count = pickups.length;
  const visual = enemyMeshMap.get(boss);
  const shared = visual.userData.bossVisual.children.find(o => o.isMesh).geometry;
  let disposed = 0;
  shared.addEventListener('dispose', () => disposed++);
  killEnemy(boss, game);
  assert.equal(pickups.length - count, BALANCE.bossPickups);
  for(let i=0;i<10;i++) game.updateEnemy(boss);
  syncEntityMeshes();
  assert.equal(visual.scale.x, 1.5);
  releaseMesh(enemyMeshMap, boss);
  assert(!entityGroup.children.includes(visual));
  assert.equal(disposed, 0);
  game = new Game();
  assert.equal(entityGroup.children.length, 2);
  spawnEnemy('boss', player.x + 3, player.y + 3); syncEntityMeshes();
  assert(enemyMeshMap.get(enemies[0]).userData.bossVisual);
  assert.equal(disposed, 0);
`);

console.log(passed + ' boss visual regression checks passed.');
