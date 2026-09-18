// Run the real game logic with local Three.js; no browser or extra packages required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const THREE = require(path.join(root, 'vendor/three.min.js'));
const html = fs.readFileSync(path.join(root, 'kaiju-destroyer.html'), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(source => source.includes('class Game'));
assert(script, 'The game script exists');
const startup = script.lastIndexOf('\nloadHighScore();');
assert(startup >= 0, 'The browser startup boundary exists');

function createHarness(){
  const listeners = new Map();
  const elements = new Map();
  const ctx2d = new Proxy({
    measureText: text => ({width:String(text).length * 24}),
    createLinearGradient: () => ({addColorStop(){}}),
    createRadialGradient: () => ({addColorStop(){}}),
    getImageData: () => ({data:new Uint8ClampedArray(4)}),
    createImageData: (w, h) => ({data:new Uint8ClampedArray(w * h * 4)}),
  }, {get:(object, key) => key in object ? object[key] : () => {}});
  const register = target => (name, callback) => {
    const key = target + ':' + name;
    const entries = listeners.get(key) || [];
    entries.push(callback);
    listeners.set(key, entries);
  };
  function element(id){
    if(!elements.has(id)){
      const tag = html.match(new RegExp('<[^>]+\\bid="' + id + '"[^>]*>'))?.[0] || '';
      const classes = new Set((tag.match(/class="([^"]*)"/)?.[1] || '').split(/\s+/).filter(Boolean));
      elements.set(id, {
        width:1280, height:800, style:{}, innerHTML:'', textContent:'',
        classList:{
          add(...names){names.forEach(name => classes.add(name));},
          remove(...names){names.forEach(name => classes.delete(name));},
          contains(name){return classes.has(name);},
          toggle(name){if(classes.has(name)){classes.delete(name);return false;} classes.add(name);return true;},
        },
        addEventListener:register(id), getContext:() => ctx2d,
        getBoundingClientRect:() => ({left:0,top:0,width:1280,height:800}),
        setAttribute(){}, appendChild(){},
      });
    }
    return elements.get(id);
  }
  const math = Object.create(Math);
  math.random = () => 0.5;
  let canvasId = 0;
  const context = vm.createContext({
    THREE, assert, console, Math:math,
    document:{
      hidden:false, visibilityState:'visible',
      getElementById:element, createElement:() => element('texture-' + canvasId++),
      addEventListener:register('document'),
    },
    window:{innerWidth:1280,innerHeight:800,devicePixelRatio:1,addEventListener:register('window')},
    navigator:{maxTouchPoints:0}, performance:{now:() => 0},
    requestAnimationFrame(){}, cancelAnimationFrame(){},
    setTimeout(){return 0;}, clearTimeout(){},
    localStorage:{getItem(){return null;},setItem(){}},
    dispatch(target, name, values = {}){
      const event = {type:name, repeat:false, preventDefault(){}, ...values};
      for(const callback of listeners.get(target + ':' + name) || []) callback(event);
    },
  });
  for(const filename of ['boss-model.js', 'city-visual.js', 'unit-visual.js', 'kaiju-visual.js']){
    const fullpath = path.join(root, filename);
    if(fs.existsSync(fullpath)) vm.runInContext(fs.readFileSync(fullpath, 'utf8'), context, {filename});
  }
  vm.runInContext(script.slice(0, startup), context, {filename:'kaiju-destroyer.html'});
  vm.runInContext(`
    // Rendering is tested separately; this suite exercises the production rules.
    renderer = {render(){}};
    scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera();
    sunLight = new THREE.DirectionalLight();
    buildingGroup = new THREE.Group(); entityGroup = new THREE.Group(); fxGroup = new THREE.Group();
    playerMesh = createGodzillaMesh(); aimLine = new THREE.Group(); stompRing = new THREE.Group();
    entityGroup.add(playerMesh, aimLine);
    buildCityMeshes = () => {};
    const productionSpawnFireParticle = spawnFireParticle3D;
    spawnFireParticle3D = () => {};
    updateAimFromMouse = () => {};
    game = new Game();
    game.draw = () => {};
    map.fill(0); buildDying.fill(-1); buildHP.fill(0); buildMaxHP.fill(0); buildHeight.fill(0);
    game.spawnTimer = 1e9; game.bossSpawnTimer = 1e9;
    function building(x, y, hp = 100, floors = 3){
      const ci = Math.floor(y) * MAP + Math.floor(x);
      map[ci] = 1; buildDying[ci] = -1;
      buildHP[ci] = buildMaxHP[ci] = hp; buildHeight[ci] = floors;
      return ci;
    }
  `, context);
  return context;
}

let passed = 0;
let failed = 0;
function test(name, source){
  try{
    vm.runInContext(`(() => {${source}})()`, createHarness(), {filename:name});
    passed++;
    console.log('PASS ' + name);
  }catch(error){
    failed++;
    console.error('FAIL ' + name + ': ' + error.message);
  }
}

test('火焰只命中有限前方，拒绝背后、超射程和侧面目标', `
  player.aimAngle = 0;
  for(const offset of [[-10,0],[BALANCE.fireRange+5,0],[6,5]]){
    enemies = []; spawnEnemy('tank', player.x + offset[0], player.y + offset[1]);
    const e = enemies[0], hp = e.hp;
    game.doFireBreath(); assert.equal(e.hp, hp, 'Out-of-beam tank stays unharmed: ' + offset);
  }
  enemies = []; spawnEnemy('tank', player.x + 6, player.y);
  const e = enemies[0], hp = e.hp;
  game.doFireBreath(); assert.equal(e.hp, hp - BALANCE.fireDamage);
`);

test('近处敌人先挡火，与生成顺序无关', `
  player.aimAngle = 0;
  spawnEnemy('tank', player.x + 8, player.y);
  spawnEnemy('tank', player.x + 4, player.y);
  const [far,near] = enemies, farHP = far.hp, nearHP = near.hp;
  game.doFireBreath();
  assert.equal(far.hp, farHP); assert.equal(near.hp, nearHP - BALANCE.fireDamage);
`);

test('每次喷火每栋楼只结算一次，完整近楼挡住后方，身后楼不受伤', `
  player.aimAngle = 0;
  const near = building(player.x + 5, player.y);
  const far = building(player.x + 10, player.y);
  const behind = building(player.x - 2, player.y);
  game.doFireBreath();
  assert.equal(buildHP[near], 100 - (BALANCE.fireBuildDamage ?? BALANCE.fireDamage));
  assert.equal(buildHP[far], 100); assert.equal(buildHP[behind], 100);
`);

test('建筑遮挡身后敌人，心态减益按比例作用于火焰伤害', `
  player.aimAngle = 0;
  const ci = building(player.x + 4, player.y);
  spawnEnemy('tank', player.x + 7, player.y);
  const e = enemies[0], hp = e.hp;
  player.insultDebuff = 20; game.doFireBreath();
  assert.equal(e.hp, hp);
  const expected = 100 - (BALANCE.fireBuildDamage ?? BALANCE.fireDamage) * BALANCE.insultFireMult;
  assert(Math.abs(buildHP[ci] - expected) < 1e-4);
`);

test('火焰高度取目标距离，远处低楼掠过而高楼可命中', `
  player.aimAngle = 0;
  const low = building(player.x + 23, player.y, 100, 2);
  game.doFireBreath(); assert.equal(buildHP[low], 100);
  buildHeight[low] = 6;
  game.doFireBreath(); assert(buildHP[low] < 100);
`);

test('火焰射程末端可命中高楼，越过射程即不伤害', `
  player.aimAngle = 0;
  const ci = building(player.x + BALANCE.fireRange, player.y, 100, 6);
  game.doFireBreath(); assert(buildHP[ci] < 100);
  buildHP[ci] = 100; player.x -= 0.001;
  game.doFireBreath(); assert.equal(buildHP[ci], 100);
`);

test('踩踏只伤地面敌人，打工人和直升机及楼顶老板免疫', `
  spawnEnemy('soldier', player.x + 1, player.y);
  spawnEnemy('helicopter', player.x + 2, player.y);
  spawnEnemy('tank', player.x + 2, player.y + 1);
  const ci = building(player.x + 2, player.y - 1, 100);
  spawnEnemy('boss', player.x + 2, player.y - 1);
  const [worker,heli,tank,boss] = enemies, before = enemies.map(e => e.hp);
  game.doStompHit();
  assert.equal(worker.hp, before[0]); assert.equal(heli.hp, before[1]);
  assert.equal(tank.hp, before[2] - BALANCE.stompDamage); assert.equal(boss.hp, before[3]);
  assert(buildHP[ci] < 100);
`);

test('打工人随机巡逻、不主动攻击、免疫玩家火焰，附近助威人数封顶', `
  player.aimAngle = 0;
  spawnEnemy('soldier', player.x + 4, player.y);
  const worker = enemies[0], hp = worker.hp, initialX = worker.x;
  worker.patrolAngle = 0; worker.shootTimer = 0;
  for(let i = 0; i < 60; i++) game.updateEnemy(worker);
  assert(worker.x > initialX, 'Worker follows its patrol heading, away from the player here');
  assert.equal(projectiles.length, 0);
  game.doFireBreath(); assert.equal(worker.hp, hp);
  for(let i = 0; i < 5; i++) spawnEnemy('soldier', player.x + 1, player.y + i * 0.2);
  spawnEnemy('soldier', player.x + WORKER_CHEER_RADIUS + 2, player.y);
  assert.equal(countCheeringWorkers(), WORKER_CHEER_MAX);
  enemies.forEach(e => { e.alive = false; });
  assert.equal(countCheeringWorkers(), 0);
`);

test('完整建筑挡住同事助威，建筑倒塌后恢复可见助威', `
  spawnEnemy('soldier', player.x + 6, player.y);
  const ci = building(player.x + 3, player.y);
  assert.equal(countCheeringWorkers(), 0);
  buildDying[ci] = 30;
  assert.equal(countCheeringWorkers(), 1);
`);

test('敌方流弹会误伤打工人，但同一颗弹只结算一个目标', `
  spawnEnemy('soldier', player.x + 4, player.y);
  const worker = enemies[0];
  const shot = {x:worker.x,y:worker.y,z:1,vx:0,vy:0,life:100,alive:true,damage:12,ptype:'shell'};
  game.updateProjectile(shot); assert.equal(worker.alive, false); assert.equal(shot.alive, false);
  enemies = []; spawnEnemy('soldier', player.x, player.y);
  const overlap = enemies[0]; player.hp = 100; player.invincible = 0;
  game.updateProjectile({...shot, x:player.x,y:player.y,alive:true,life:100});
  assert.equal(Number(player.hp < 100) + Number(!overlap.alive), 1, 'A consumed shell cannot hit both');
`);

test('生存得分不制造或延长战斗连击，同事按人数增加窗口', `
  game.time = 599; player.fireCD = 9999;
  player.combo = 0; player.comboTimer = 0;
  game.update();
  assert.equal(player.combo, 0); assert.equal(player.comboTimer, 0); assert(player.score > 0);
  player.cheerCount = 2; game.addScore(100);
  assert.equal(player.combo, 1);
  assert.equal(player.comboTimer, BALANCE.comboBaseWindow + 2 * BALANCE.comboCheerBonus);
  player.comboTimer = 1; game.time = 600; game.update(); assert.equal(player.combo, 0);
`);

test('老板弹幕覆盖射击距离，伤害随波次成长', `
  game.wave = 30;
  spawnEnemy('boss', player.x + 10, player.y);
  const boss = enemies[0]; boss.onRoof = false; boss.shootTimer = 0;
  game.updateEnemy(boss);
  const shot = projectiles[0]; assert(shot, 'Boss fires');
  assert.equal(shot.damage, Math.round(ENEMY_TYPES.boss.damage * waveScale(30)));
  assert(shot.damage > 8, 'High waves increase boss damage');
  const hp = player.hp;
  for(let i = 0; i < 1000 && shot.alive; i++) game.updateProjectile(shot);
  assert(player.hp < hp, 'Shot reaches a stationary player ten units away');
`);

test('老板弹幕先离开自己的宽屋顶，再俯冲，沿途其他高楼仍可挡住', `
  for(let x = 42; x <= 47; x++) for(let y = 34; y <= 38; y++) building(x,y,100,5);
  function shoot(){
    enemies = []; projectiles = []; player.hp = 100; player.invincible = 0;
    spawnEnemy('boss',46.5,36.5); enemies[0].shootTimer = 0;
    game.updateEnemy(enemies[0]);
    const shot = projectiles[0]; assert(shot);
    for(let i = 0; i < 1000 && shot.alive; i++) game.updateProjectile(shot);
    return shot;
  }
  shoot(); assert(player.hp < 100, 'The boss must not shoot into its own roof');
  building(40,36,100,12);
  shoot(); assert.equal(player.hp,100,'An intervening taller tower still blocks the shot');
`);

test('普通敌人弹道寿命覆盖实际射击距离', `
  for(const type of ['tank','helicopter','fartHero']){
    enemies = []; projectiles = []; player.hp = 100; player.invincible = 0;
    spawnEnemy(type, player.x + 12, player.y);
    const e = enemies[0]; e.facing = Math.PI; e.shootTimer = 0;
    game.updateEnemy(e);
    const shot = projectiles[0]; assert(shot, type + ' fires');
    for(let i = 0; i < 1000 && shot.alive; i++) game.updateProjectile(shot);
    assert(player.hp < 100, type + ' shot reaches a stationary player twelve units away');
  }
`);

test('斜走不会加速，玩家按体积撞墙并可沿墙滑动', `
  const startX = player.x, startY = player.y;
  input.w = true; game.updatePlayer();
  const straight = dist2(startX, startY, player.x, player.y);
  player.x = startX; player.y = startY; input.d = true; game.updatePlayer();
  const diagonal = dist2(startX, startY, player.x, player.y);
  assert(Math.abs(straight - diagonal) < 1e-9);
  player.x = startX; player.y = startY;
  camera.position.set(player.x - 10, 10, player.y);
  const wallX = Math.floor(startX + 2);
  for(let y = 0; y < MAP; y++) building(wallX, y);
  for(let i = 0; i < 60; i++) game.updatePlayer();
  assert(wallX - player.x >= 1.05 - 1e-9, 'The body cannot enter the wall');
  assert(player.y > startY + 1, 'The unblocked movement axis still advances');
`);

test('近距离火焰在生成当帧更新后仍有可见粒子', `
  fireGeometry = new THREE.SphereGeometry(1,6,6);
  player.fireReach = 3;
  productionSpawnFireParticle();
  updateVisualEffects();
  assert(fireParticles.some(p => p.visible && p.userData.life > 0), 'Close-range breath must be visible');
`);

test('暂停和静音忽略键盘自动重复，暂停清除全部移动输入', `
  input.w = input.shift = true; touchState.moveId = 7; touchState.dx = 1;
  dispatch('document','keydown',{key:'p'}); assert.equal(paused, true);
  assert.equal(input.w, false); assert.equal(input.shift, false);
  assert.equal(touchState.moveId, null); assert.equal(touchState.dx, 0);
  dispatch('document','keydown',{key:'p',repeat:true}); assert.equal(paused, true);
  const wasMuted = audio.muted;
  dispatch('document','keydown',{key:'m',repeat:true}); assert.equal(audio.muted, wasMuted);
`);

test('重开清除键盘与触屏残留，取消触摸不触发踩踏', `
  input.w = input.shift = true; touchState.moveId = 9; touchState.dx = 1;
  startGame(); assert.equal(input.w, false); assert.equal(input.shift, false);
  assert.equal(touchState.moveId, null); assert.equal(touchState.dx, 0);
  touchState.aimId = 3; touchState.tapMoved = false; touchState.tapStart = Date.now();
  dispatch('game','touchcancel',{changedTouches:[{identifier:3}]});
  assert.equal(player.stompCD, 0); assert.equal(touchState.aimId, null);
`);

test('失去窗口焦点释放输入并自动暂停', `
  input.w = true; touchState.moveId = 9; touchState.dx = 1;
  dispatch('window','blur');
  assert.equal(input.w, false); assert.equal(touchState.moveId, null); assert.equal(paused, true);
`);

test('60Hz与144Hz推进相同模拟时间，长停顿限制补帧，暂停不推进', `
  const actualUpdate = game.update;
  let ticks = 0; game.update = () => { ticks++; };
  for(const hz of [60,144]){
    ticks = 0; resetFrameClock();
    for(let i = 0; i <= hz * 2; i++) stepGameFrame(i * 1000 / hz);
    assert(Math.abs(ticks - 120) <= 1, hz + 'Hz should simulate about 120 ticks, got ' + ticks);
  }
  ticks = 0; resetFrameClock(); stepGameFrame(0); stepGameFrame(10000);
  assert(ticks <= 6, 'A long suspension catches up at most 100ms');
  ticks = 0; paused = true; resetFrameClock(); stepGameFrame(0); stepGameFrame(1000);
  assert.equal(ticks, 0);
  game.update = actualUpdate;
`);

test('单独重画不推进倒塌或粒子寿命，模拟更新负责清理倒塌状态', `
  const ci = building(player.x + 5, player.y);
  buildDying[ci] = 2;
  const particle = new THREE.Mesh(new THREE.SphereGeometry(1,4,4), new THREE.MeshBasicMaterial());
  particle.userData = {life:10,maxLife:10,vx:0.2,vy:0.1,vz:0.3,pooled:true};
  fireParticles.push(particle);
  const before = {time:game.time,collapse:buildDying[ci],life:particle.userData.life};
  Game.prototype.draw.call(game);
  Game.prototype.draw.call(game);
  assert.deepEqual({time:game.time,collapse:buildDying[ci],life:particle.userData.life}, before);
  player.fireCD = 9999; game.update(); game.update();
  assert.equal(map[ci], 0); assert.equal(buildHeight[ci], 0); assert.equal(buildHP[ci], 0);
  assert(particle.userData.life < before.life);
`);

test('触屏操作按钮随开始、暂停、静音和踩踏状态同步', `
  const controls = document.getElementById('touch-controls');
  assert(controls.classList.contains('hidden'));
  startGame(); game.draw = () => {};
  assert(document.getElementById('start-screen').classList.contains('hidden'));
  assert(!controls.classList.contains('hidden'));
  assert.equal(document.getElementById('pause-button').textContent,'暂停');
  audio.ctx = {state:'running',suspend(){this.state='suspended';},resume(){this.state='running';}};
  togglePause();
  assert.equal(audio.ctx.state,'suspended');
  assert.equal(document.getElementById('pause-button').textContent,'继续');
  assert.match(document.getElementById('game-status').textContent,/暂停/);
  triggerStomp(); assert.equal(player.stompCD,0);
  togglePause();
  assert.equal(audio.ctx.state,'running');
  assert.equal(document.getElementById('pause-button').textContent,'暂停');
  audio.ctx = null;
  audio.master = {gain:{value:0.25}};
  toggleMute(); assert.equal(audio.master.gain.value,0);
  assert.equal(document.getElementById('mute-button').textContent,'开启声音');
  toggleMute(); assert.equal(audio.master.gain.value,0.25);
  assert.equal(document.getElementById('mute-button').textContent,'静音');
  triggerStomp(); assert.equal(player.stompCD,120); assert.equal(player.stompFrame,10);
  player.stompFrame = 7; triggerStomp(); assert.equal(player.stompFrame,7,'Cooldown blocks repeated button presses');
`);

test('结束隐藏操作按钮，重开恢复按钮并保留静音偏好', `
  startGame(); toggleMute();
  const controls = document.getElementById('touch-controls');
  const finalScreen = document.getElementById('gameover-screen');
  player.score = 1234; game.wave = 7; game.running = false;
  loop(0);
  assert.equal(game,null); assert(controls.classList.contains('hidden'));
  assert(!finalScreen.classList.contains('hidden'));
  assert.match(document.getElementById('final-score').innerHTML,/1234/);
  assert.match(document.getElementById('game-status').textContent,/游戏结束/);
  const cd = player.stompCD;
  triggerStomp(); togglePause(); assert.equal(player.stompCD,cd);
  startGame();
  assert(game.running); assert(!paused); assert.equal(player.score,0);
  assert(finalScreen.classList.contains('hidden')); assert(!controls.classList.contains('hidden'));
  assert.equal(document.getElementById('pause-button').textContent,'暂停');
  assert(audio.muted); assert.equal(document.getElementById('mute-button').textContent,'开启声音');
`);

console.log(passed + ' gameplay checks passed; ' + failed + ' failed.');
if(failed) process.exitCode = 1;
