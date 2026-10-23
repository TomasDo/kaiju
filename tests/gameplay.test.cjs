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
        open:false, isConnected:true,
        focus(){context.document.activeElement = this;},
        showModal(){this.open = true; element('guide-close').focus();},
        close(){this.open = false;},
        classList:{
          add(...names){names.forEach(name => classes.add(name));},
          remove(...names){names.forEach(name => classes.delete(name));},
          contains(name){return classes.has(name);},
          toggle(name, force){
            const add = typeof force === 'boolean' ? force : !classes.has(name);
            if(add) classes.add(name); else classes.delete(name);
            return add;
          },
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
      body:element('body'), activeElement:element('body'),
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
    renderer = {render(){},setSize(){}};
    scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera();
    sunLight = new THREE.DirectionalLight();
    buildingGroup = new THREE.Group(); entityGroup = new THREE.Group(); fxGroup = new THREE.Group();
    playerMesh = createGodzillaMesh(); aimLine = new THREE.Group(); stompRing = new THREE.Group();
    entityGroup.add(playerMesh, aimLine);
    const productionBuildCityMeshes = buildCityMeshes;
    buildCityMeshes = () => {};
    const productionSpawnFireParticle = spawnFireParticle3D;
    spawnFireParticle3D = () => {};
    updateAimFromMouse = () => {};
    game = new Game();
    game.draw = () => {};
    map.fill(0); buildDying.fill(-1); buildHP.fill(0); buildMaxHP.fill(0); buildHeight.fill(0);
    buildMeta.fill(null); buildRoofWalkable.fill(0); cityBuildings.length = 0;
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

test('Fire hits only within its forward beam, excluding rear, out-of-range, and side targets', `
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

test('Nearer enemies block fire regardless of spawn order', `
  player.aimAngle = 0;
  spawnEnemy('tank', player.x + 8, player.y);
  spawnEnemy('tank', player.x + 4, player.y);
  const [far,near] = enemies, farHP = far.hp, nearHP = near.hp;
  game.doFireBreath();
  assert.equal(far.hp, farHP); assert.equal(near.hp, nearHP - BALANCE.fireDamage);
`);

test('Each breath damages a building once; intact near buildings block farther targets and rear buildings remain unharmed', `
  player.aimAngle = 0;
  const near = building(player.x + 5, player.y);
  const far = building(player.x + 10, player.y);
  const behind = building(player.x - 2, player.y);
  game.doFireBreath();
  assert.equal(buildHP[near], 100 - (BALANCE.fireBuildDamage ?? BALANCE.fireDamage));
  assert.equal(buildHP[far], 100); assert.equal(buildHP[behind], 100);
`);

test('Buildings shield enemies behind them and morale debuffs scale fire damage', `
  player.aimAngle = 0;
  const ci = building(player.x + 4, player.y);
  spawnEnemy('tank', player.x + 7, player.y);
  const e = enemies[0], hp = e.hp;
  player.insultDebuff = 20; game.doFireBreath();
  assert.equal(e.hp, hp);
  const expected = 100 - (BALANCE.fireBuildDamage ?? BALANCE.fireDamage) * BALANCE.insultFireMult;
  assert(Math.abs(buildHP[ci] - expected) < 1e-4);
`);

test('Fire height follows target distance, passing over low distant buildings while hitting taller ones', `
  player.aimAngle = 0;
  const low = building(player.x + 23, player.y, 100, 2);
  game.doFireBreath(); assert.equal(buildHP[low], 100);
  buildHeight[low] = 6;
  game.doFireBreath(); assert(buildHP[low] < 100);
`);

test('Fire hits tall buildings at its range limit and causes no damage beyond it', `
  player.aimAngle = 0;
  const ci = building(player.x + BALANCE.fireRange, player.y, 100, 6);
  game.doFireBreath(); assert(buildHP[ci] < 100);
  buildHP[ci] = 100; player.x -= 0.001;
  game.doFireBreath(); assert.equal(buildHP[ci], 100);
`);

test('Stomp damages ground enemies while workers, helicopters, and rooftop Bosses are immune', `
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

test('Workers patrol randomly, never initiate attacks, resist player fire, and have a capped nearby cheer count', `
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

test('Intact buildings block coworker cheering until their collapse restores visibility', `
  spawnEnemy('soldier', player.x + 6, player.y);
  const ci = building(player.x + 3, player.y);
  assert.equal(countCheeringWorkers(), 0);
  buildDying[ci] = 30;
  assert.equal(countCheeringWorkers(), 1);
`);

test('Enemy stray shots can hit workers, but each projectile affects only one target', `
  spawnEnemy('soldier', player.x + 4, player.y);
  const worker = enemies[0];
  const shot = {x:worker.x,y:worker.y,z:1,vx:0,vy:0,life:100,alive:true,damage:12,ptype:'shell'};
  game.updateProjectile(shot); assert.equal(worker.alive, false); assert.equal(shot.alive, false);
  enemies = []; spawnEnemy('soldier', player.x, player.y);
  const overlap = enemies[0]; player.hp = 100; player.invincible = 0;
  game.updateProjectile({...shot, x:player.x,y:player.y,alive:true,life:100});
  assert.equal(Number(player.hp < 100) + Number(!overlap.alive), 1, 'A consumed shell cannot hit both');
`);

test('Survival score does not create or extend combat combos; coworkers add to the combo window by count', `
  game.time = 599; player.fireCD = 9999;
  player.combo = 0; player.comboTimer = 0;
  game.update();
  assert.equal(player.combo, 0); assert.equal(player.comboTimer, 0); assert(player.score > 0);
  player.cheerCount = 2; game.addScore(100);
  assert.equal(player.combo, 1);
  assert.equal(player.comboTimer, BALANCE.comboBaseWindow + 2 * BALANCE.comboCheerBonus);
  player.comboTimer = 1; game.time = 600; game.update(); assert.equal(player.combo, 0);
`);

test('Boss barrages cover firing distance and scale damage with waves', `
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

test('Boss barrages clear their own wide rooftop before diving and can still be blocked by other tall buildings', `
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

test('Regular enemy projectile lifetime covers actual firing distance', `
  for(const type of ['tank','helicopter']){
    enemies = []; projectiles = []; player.hp = 100; player.invincible = 0;
    spawnEnemy(type, player.x + 12, player.y);
    const e = enemies[0]; e.facing = Math.PI; e.shootTimer = 0;
    game.updateEnemy(e);
    const shot = projectiles[0]; assert(shot, type + ' fires');
    for(let i = 0; i < 1000 && shot.alive; i++) game.updateProjectile(shot);
    assert(player.hp < 100, type + ' shot reaches a stationary player twelve units away');
  }
`);

test('Bloom Hero base stats, wave scaling, and a two-unit living cap remain consistent', `
  assert.equal(ENEMY_TYPES.fartHero.hp, 80);
  assert.equal(ENEMY_TYPES.fartHero.damage, 12);
  game.wave = 20;
  const first = spawnEnemy('fartHero', player.x + 5, player.y);
  const second = spawnEnemy('fartHero', player.x - 5, player.y);
  assert(first && second);
  assert.equal(first.hp, Math.round(80 * waveScale(20)));
  assert.equal(first.damage, Math.round(12 * waveScale(20)));
  assert.equal(first.heroState, 'chase');
  assert.equal(spawnEnemy('fartHero', player.x, player.y + 5), null);
  assert.equal(enemies.filter(e => e.alive && e.type === 'fartHero').length, BALANCE.heroMaxAlive);
  killEnemy(first, game);
  assert(spawnEnemy('fartHero', player.x, player.y + 5), 'A dying model does not consume an alive slot');
`);

test('Bloom Hero charges only within eight unobstructed cells after cooldown', `
  const e = spawnEnemy('fartHero', player.x + BALANCE.heroRange + 0.1, player.y);
  e.shootTimer = 0; e.facing = Math.PI;
  game.updateEnemy(e); assert.equal(e.heroState, 'chase');
  e.x = player.x + 6;
  const wall = building(player.x + 3, player.y);
  game.updateEnemy(e); assert.equal(e.heroState, 'chase');
  map[wall] = 0;
  e.shootTimer = 2; game.updateEnemy(e); assert.equal(e.heroState, 'chase');
  e.shootTimer = 0; game.updateEnemy(e);
  assert.equal(e.heroState, 'charge');
  assert.equal(e.heroStateTimer, BALANCE.heroChargeFrames);
  assert.equal(projectiles.length, 0, 'Charging is a warning, not immediate damage');
`);

test('Bloom Hero locks its ray, follows 42/18/72-frame phases, then cools down for 90 frames after recovery', `
  const e = spawnEnemy('fartHero', player.x + 6, player.y);
  e.shootTimer = 0; e.facing = Math.PI;
  game.updateEnemy(e);
  const lockedAngle = e.attackAngle, startX = e.x, startY = e.y;
  player.y += 3;
  for(let i = 0; i < BALANCE.heroChargeFrames; i++){
    const priorFacing = e.facing;
    game.updateEnemy(e);
    assert(Math.abs(normAngle(e.facing - priorFacing)) <= Math.PI / BALANCE.heroChargeFrames + 1e-9);
    assert.equal(e.attackAngle, lockedAngle, 'The warning does not chase the player');
    assert.equal(e.x, startX); assert.equal(e.y, startY);
    if(i < BALANCE.heroChargeFrames - 1) assert.equal(e.heroState, 'charge');
  }
  assert.equal(e.heroState, 'spray');
  assert.equal(e.heroStateTimer, BALANCE.heroSprayFrames);
  assert(Math.abs(normAngle(e.facing - lockedAngle - Math.PI)) < 1e-9, 'Back faces the committed shot');
  assert.equal(projectiles.length, 1);
  const shot = projectiles[0];
  assert.equal(shot.ptype, 'fart');
  assert(Math.abs(Math.atan2(shot.vy, shot.vx) - lockedAngle) < 1e-9);
  assert(Math.abs(Math.hypot(shot.vx, shot.vy) - BALANCE.heroProjectileSpeed) < 1e-9);
  const recoveryFacing = e.facing;
  for(let i = 0; i < BALANCE.heroSprayFrames; i++) game.updateEnemy(e);
  assert.equal(e.heroState, 'recover');
  assert.equal(e.heroStateTimer, BALANCE.heroRecoverFrames);
  for(let i = 0; i < BALANCE.heroRecoverFrames; i++){
    game.updateEnemy(e);
    assert.equal(e.facing, recoveryFacing);
    assert.equal(e.x, startX); assert.equal(e.y, startY);
  }
  assert.equal(e.heroState, 'chase');
  assert.equal(e.shootTimer, BALANCE.heroCooldownFrames);
  assert.equal(projectiles.length, 1, 'One cycle releases exactly one gameplay projectile');
  game.updateEnemy(e); assert.equal(e.shootTimer, BALANCE.heroCooldownFrames - 1);
  assert.equal(e.heroState, 'chase');
`);

test('Bloom Hero has no rear bonus while closed and takes fivefold fire damage only from behind during recovery', `
  player.aimAngle = 0;
  for(const state of ['chase','charge','spray','recover']){
    for(const [direction, facing] of [['front', Math.PI], ['side', Math.PI / 2], ['rear', 0]]){
      enemies = []; projectiles = []; effects = [];
      const e = spawnEnemy('fartHero', player.x + 5, player.y);
      e.heroState = state; e.heroStateTimer = 20; e.facing = facing;
      const hp = e.hp; game.doFireBreath();
      const critical = state === 'recover' && direction === 'rear';
      assert.equal(hp - e.hp, BALANCE.fireDamage * (critical ? BALANCE.critMult : 1), state + '/' + direction);
      assert.equal(effects.some(effect => effect.type === 'crit'), critical);
    }
  }
  enemies = []; const e = spawnEnemy('fartHero', player.x + 5, player.y);
  e.heroState = 'recover'; e.heroStateTimer = 20; e.facing = 0;
  player.insultDebuff = 10; const hp = e.hp; game.doFireBreath();
  assert(Math.abs(hp - e.hp - BALANCE.fireDamage * BALANCE.critMult * BALANCE.insultFireMult) < 1e-9);
`);

test('Stomp interrupts Bloom Hero charge or spray, preserves emitted clouds, and never refreshes recovery', `
  for(const state of ['charge','spray']){
    enemies = []; projectiles = [];
    const e = spawnEnemy('fartHero', player.x + 2, player.y);
    e.shootTimer = 0; game.updateEnemy(e);
    if(state === 'spray') for(let i = 0; i < BALANCE.heroChargeFrames; i++) game.updateEnemy(e);
    assert.equal(e.heroState, state);
    const emitted = projectiles.length, hp = e.hp;
    game.doStompHit();
    assert.equal(e.hp, hp - BALANCE.stompDamage);
    assert.equal(e.heroState, 'recover');
    assert.equal(e.heroStateTimer, BALANCE.heroRecoverFrames);
    assert.equal(projectiles.length, emitted);
    assert(projectiles.every(p => p.alive), 'A released cloud survives the interrupt');
    for(let i = 0; i < 12; i++) game.updateEnemy(e);
    const remaining = e.heroStateTimer;
    game.doStompHit(); assert.equal(e.heroStateTimer, remaining);
    assert.equal(projectiles.length, emitted, 'Interrupted charging never emits later');
  }
`);

test('Bloom Hero chase avoids obstacles within its body turn limit while allowing movement along walls', `
  player.x = 46.5; player.y = 36.5;
  const e = spawnEnemy('fartHero', 40.64, 36.5);
  e.facing = 0; e.moveAngle = 0; e.shootTimer = 999;
  building(41,36);
  const x = e.x, y = e.y, before = e.facing;
  game.updateEnemy(e);
  assert.equal(e.heroState, 'chase');
  assert(Math.abs(normAngle(e.facing - before)) <= BALANCE.fartTurnRate + 1e-9);
  assert(dist2(x, y, e.x, e.y) > 0, 'The body can choose a separate safe movement direction');
  assert(canOccupy(e.x, e.y, 0.35));
`);

test('Bloom Hero gas projectiles follow their locked direction, damage once, and restore movement after a 90-frame slow', `
  const e = spawnEnemy('fartHero', player.x + 6, player.y);
  e.shootTimer = 0; e.facing = Math.PI; game.updateEnemy(e);
  for(let i = 0; i < BALANCE.heroChargeFrames; i++) game.updateEnemy(e);
  const shot = projectiles[0]; assert(shot);
  for(let i = 0; i < 200 && shot.alive; i++) game.updateProjectile(shot);
  assert.equal(player.hp, BALANCE.maxHp - e.damage);
  assert.equal(player.fartDebuff, BALANCE.fartDebuffFrames);
  game.updateProjectile(shot); assert.equal(player.hp, BALANCE.maxHp - e.damage);
  input.w = true;
  const x = player.x, y = player.y;
  game.updatePlayer(); const slowed = dist2(x, y, player.x, player.y);
  player.x = x; player.y = y; player.fartDebuff = 0;
  game.updatePlayer(); const normal = dist2(x, y, player.x, player.y);
  assert(Math.abs(slowed / normal - BALANCE.fartSlowMult) < 1e-9);
  input.w = false; player.fartDebuff = BALANCE.fartDebuffFrames;
  enemies = []; projectiles = []; player.fireCD = 9999;
  for(let i = 0; i < BALANCE.fartDebuffFrames; i++) game.update();
  assert.equal(player.fartDebuff, 0);
`);

test('Gas projectiles travel at most eight cells, collide before expiring on the last step, and are blocked by intact buildings', `
  const startX = player.x, startY = player.y;
  function shot(){ return {x:startX,y:startY,z:1.5,vx:BALANCE.heroProjectileSpeed,vy:0,ptype:'fart',damage:12,alive:true,life:200,alpha:1,travel:0,maxTravel:BALANCE.heroRange}; }
  player.x = startX + BALANCE.heroRange + PLAYER_HIT_RADIUS - 0.01;
  let p = shot();
  for(let i = 0; i < 200 && p.alive; i++) game.updateProjectile(p);
  assert.equal(player.hp, BALANCE.maxHp - 12, 'The final clamped segment still hits');
  assert(p.travel <= BALANCE.heroRange + 1e-9);
  player.hp = BALANCE.maxHp; player.invincible = 0; player.x = startX + BALANCE.heroRange + PLAYER_HIT_RADIUS + 0.01;
  p = shot(); for(let i = 0; i < 200 && p.alive; i++) game.updateProjectile(p);
  assert.equal(player.hp, BALANCE.maxHp);
  assert(Math.abs(p.travel - BALANCE.heroRange) < 1e-9);
  assert(Math.abs(p.x - startX - BALANCE.heroRange) < 1e-9);
  player.x = startX + 6; building(startX + 3, startY);
  p = shot(); for(let i = 0; i < 200 && p.alive; i++) game.updateProjectile(p);
  assert.equal(player.hp, BALANCE.maxHp); assert(p.travel < BALANCE.heroRange);
`);

test('A failed wave-three Bloom Hero debut retries and never repeats after success', `
  game.wave = 2; game.heroIntroduced = false;
  let calls = 0;
  getFirstHeroSpawnPos = () => { calls++; return null; };
  game.spawnFirstHero(); assert.equal(calls, 0);
  game.wave = 3;
  game.spawnFirstHero(); assert.equal(calls, 1); assert.equal(game.heroIntroduced, false);
  game.wave = 4;
  getFirstHeroSpawnPos = () => { calls++; return {x:player.x + 6,y:player.y}; };
  game.spawnFirstHero();
  assert.equal(game.heroIntroduced, true);
  assert.equal(enemies.filter(e => e.type === 'fartHero').length, 1);
  game.spawnFirstHero(); assert.equal(calls, 2);
  assert.equal(enemies.filter(e => e.type === 'fartHero').length, 1);
  game.heroIntroduced = false;
  spawnEnemy('fartHero', player.x - 6, player.y);
  game.spawnFirstHero(); assert.equal(game.heroIntroduced, false, 'A full roster must not consume the first-appearance guarantee');
  killEnemy(enemies[0], game);
  game.spawnFirstHero(); assert.equal(game.heroIntroduced, true);
  assert.equal(enemies.filter(e => e.alive && e.type === 'fartHero').length, BALANCE.heroMaxAlive);
`);

test('Bloom Hero joins regular spawns from wave six, replacing capped slots with regular enemies without losing quota', `
  game.heroIntroduced = true;
  getSpawnPos = () => ({x:player.x + 6,y:player.y});
  Math.random = () => 0.99;
  game.wave = 5; game.spawnWaveEnemies();
  assert.equal(enemies.filter(e => e.type === 'fartHero').length, 0);
  enemies = []; game.wave = 6; game.spawnWaveEnemies();
  assert.equal(enemies.length, 5);
  assert.equal(enemies.filter(e => e.type === 'fartHero').length, BALANCE.heroMaxAlive);
  assert.equal(enemies.filter(e => e.type === 'tank' || e.type === 'helicopter').length, 3);
`);

test('Bloom Hero death stops abilities and drops one health pack; recovery still respects building fire obstruction', `
  player.aimAngle = 0;
  const e = spawnEnemy('fartHero', player.x + 6, player.y);
  e.heroState = 'recover'; e.heroStateTimer = 60; e.facing = 0;
  const wall = building(player.x + 3, player.y);
  const hp = e.hp; game.doFireBreath(); assert.equal(e.hp, hp);
  map[wall] = 0; e.hp = 1;
  game.doFireBreath(); assert.equal(e.alive, false);
  const score = player.score;
  killEnemy(e, game); game.doFireBreath();
  for(let i = 0; i < 80; i++) game.updateEnemy(e);
  assert.equal(player.score, score); assert.equal(projectiles.length, 0);
  assert.equal(pickups.length, 1); assert.equal(pickups[0].healAmount, BALANCE.fartHeal);
  enemies = []; pickups = []; effects = [];
  const interrupted = spawnEnemy('fartHero', player.x + 2, player.y);
  interrupted.shootTimer = 0; game.updateEnemy(interrupted); interrupted.hp = BALANCE.stompDamage;
  game.doStompHit();
  for(let i = 0; i < 80; i++) game.updateEnemy(interrupted);
  assert.equal(interrupted.alive, false); assert.equal(projectiles.length, 0); assert.equal(pickups.length, 1);
  enemies = []; pickups = [];
  const distant = spawnEnemy('fartHero', player.x + BALANCE.enemyDespawnDist + 1, player.y);
  distant.heroState = 'charge'; distant.heroStateTimer = 1;
  game.updateEnemy(distant);
  assert.equal(distant.alive, false); assert.equal(pickups.length, 0); assert.equal(projectiles.length, 0);
`);

test('Restart clears Bloom Hero state and debut flags, and pause does not advance abilities', `
  const e = spawnEnemy('fartHero', player.x + 6, player.y);
  e.shootTimer = 0; game.updateEnemy(e); game.heroIntroduced = true;
  player.fireCD = 9999;
  const timer = e.heroStateTimer;
  paused = true; resetFrameClock(); stepGameFrame(0); stepGameFrame(1000);
  assert.equal(e.heroStateTimer, timer);
  startGame(); game.draw = () => {};
  assert.equal(game.heroIntroduced, false);
  assert.equal(enemies.length, 0); assert.equal(projectiles.length, 0);
  assert.equal(player.fartDebuff, 0); assert(!paused);
`);

test('Bloom Hero practice uses production abilities, supports fire toggle, pause, and reset, and never spawns regular waves', `
  HeroPractice.restart(); game.draw = () => {};
  assert(game.heroPractice); assert.equal(enemies.length, 1); assert.equal(enemies[0].type, 'fartHero');
  assert(!document.getElementById('practice-controls').classList.contains('hidden'));
  assert.equal(map.some(cell => cell === 1), false);
  const hero = enemies[0], hp = hero.hp;
  HeroPractice.setAutoFire(false); game.update(); assert.equal(hero.hp, hp);
  HeroPractice.setAutoFire(true); player.fireCD = 0; game.update();
  assert(hero.hp < hp); assert.equal(HeroPractice.getState().autoFire, true);
  HeroPractice.pause(true);
  const frozen = HeroPractice.getState().time;
  resetFrameClock(); stepGameFrame(0); stepGameFrame(1000);
  assert.equal(HeroPractice.getState().time, frozen);
  HeroPractice.pause(false); assert.equal(HeroPractice.getState().paused, false);
  HeroPractice.setAutoFire(false); player.hp = player.maxHp = 10000;
  for(let i = 0; i < 1000; i++) game.update();
  assert.equal(game.wave, 1); assert.equal(enemies.length, 1); assert.equal(enemies[0], hero);
  assert(hero.hp > 0);
  HeroPractice.restart(); game.draw = () => {};
  assert.equal(enemies[0].hp, ENEMY_TYPES.fartHero.hp);
  assert.equal(player.hp, BALANCE.maxHp); assert.equal(projectiles.length, 0);
  assert(!document.getElementById('practice-controls').classList.contains('hidden'));
  startGame({heroPractice:false});
  assert(!game.heroPractice); assert(document.getElementById('practice-controls').classList.contains('hidden'));
`);

test('Ending Bloom Hero practice preserves the high score and allows another practice session', `
  let writes = 0; localStorage.setItem = () => { writes++; };
  highScore = 100; HeroPractice.restart(); game.draw = () => {};
  player.score = 99999; game.running = false; loop(0);
  assert.equal(game, null); assert.equal(highScore, 100); assert.equal(writes, 0);
  assert.match(document.getElementById('final-score').innerHTML, /Practice complete/);
  HeroPractice.restart();
  assert(game.heroPractice && game.running); assert.equal(player.score, 0); assert.equal(enemies.length, 1);
`);

test('Bloom Hero warnings, three-cloud opacity, and restart cleanup use production rendering paths', `
  const e = spawnEnemy('fartHero', player.x + 6, player.y);
  e.shootTimer = 0; game.updateEnemy(e); syncEntityMeshes();
  assert.equal(heroWarningMap.size, 1);
  const warning = heroWarningMap.get(e), position = warning.position.clone(), rotation = warning.rotation.y;
  player.y += 3; game.updateEnemy(e); syncEntityMeshes();
  assert(warning.position.equals(position)); assert.equal(warning.rotation.y, rotation);
  for(let i = 1; i < BALANCE.heroChargeFrames; i++) game.updateEnemy(e);
  syncEntityMeshes();
  assert.equal(heroWarningMap.size, 0); assert.equal(warning.parent, null);
  assert.equal(projectiles.length, 1);
  const shot = projectiles[0], cloud = projMeshMap.get(shot);
  assert(cloud && cloud.isGroup); assert.equal(cloud.children.length, 3);
  const opacity = cloud.children.map(puff => puff.material.opacity);
  shot.alpha = 0.4; syncEntityMeshes();
  cloud.children.forEach((puff, i) => assert(Math.abs(puff.material.opacity - opacity[i] * 0.4) < 1e-9));
  let disposed = 0;
  cloud.children.forEach(puff => puff.material.addEventListener('dispose', () => disposed++));
  const second = spawnEnemy('fartHero', player.x - 6, player.y);
  second.shootTimer = 0; game.updateEnemy(second); syncEntityMeshes();
  assert.equal(heroWarningMap.size, 1);
  startGame();
  assert.equal(heroWarningMap.size, 0); assert.equal(cloud.parent, null); assert.equal(disposed, 3);
  assert.equal(projectiles.length, 0);
`);

test('Restarting practice from a high-wave game gives Bloom Hero practice-wave-one stats', `
  game.wave = 30;
  const scaled = spawnEnemy('fartHero', player.x + 6, player.y);
  assert(scaled.hp > ENEMY_TYPES.fartHero.hp);
  HeroPractice.restart();
  assert.equal(game.wave, 1); assert(game.heroPractice);
  assert.equal(enemies.length, 1);
  assert.equal(enemies[0].hp, 80); assert.equal(enemies[0].maxHp, 80);
  assert.equal(enemies[0].damage, 12); assert.equal(enemies[0].score, 1000);
  assert.equal(HeroPractice.getState().maxHp, 80);
`);

test('Regular spawns cannot add Bloom Hero before a valid debut location is found and successfully used', `
  game.heroIntroduced = false;
  getFirstHeroSpawnPos = () => null;
  getSpawnPos = () => ({x:player.x + 6,y:player.y});
  Math.random = () => 0.99;
  for(const wave of [3,6,12,20]){
    enemies = []; effects = []; game.wave = wave;
    game.spawnWaveEnemies();
    assert.equal(game.heroIntroduced, false);
    assert.equal(enemies.some(e => e.type === 'fartHero'), false, 'No ordinary hero before introduction at wave ' + wave);
    assert(enemies.length > 0, 'Other enemy slots remain populated');
    assert.equal(effects.some(e => e.type === 'hero-intro'), false);
  }
  enemies = []; effects = [];
  getFirstHeroSpawnPos = () => ({x:player.x + 6,y:player.y});
  game.spawnWaveEnemies();
  assert.equal(game.heroIntroduced, true);
  assert(effects.some(e => e.type === 'hero-intro'));
  assert.equal(enemies.filter(e => e.type === 'fartHero').length, BALANCE.heroMaxAlive);
`);

test('Gas projectiles crossing a corner or short wall within one frame are blocked unless above the roof', `
  const wall = building(40,36,100,3);
  const velocity = BALANCE.heroProjectileSpeed / Math.SQRT2;
  for(const startY of [36.02,36.025]){
    const p = {x:39.98,y:startY,z:1.5,vx:velocity,vy:-velocity,ptype:'fart',damage:12,alive:true,life:100,travel:0,maxTravel:8};
    assert(!isWall(Math.floor(p.x), Math.floor(p.y)));
    assert(!isWall(Math.floor(p.x + p.vx), Math.floor(p.y + p.vy)), 'Both endpoints lie outside the blocking cell');
    game.updateProjectile(p); assert.equal(p.alive, false, 'The swept segment intersects the wall at y=' + startY);
  }
  const high = {x:39.98,y:36.025,z:buildHeight[wall] * BUILD_UNIT + 1,vx:velocity,vy:-velocity,ptype:'fart',damage:12,alive:true,life:100,travel:0,maxTravel:8};
  game.updateProjectile(high); assert.equal(high.alive, true, 'Vertical clearance still applies to a swept segment');
`);

test('Gas hits retain a 90-frame slow on impact and affect exactly 90 subsequent movement steps', `
  input.w = true; player.fireCD = 9999;
  projectiles.push({x:player.x+0.2,y:player.y,z:1.5,vx:BALANCE.heroProjectileSpeed,vy:0,ptype:'fart',damage:12,alive:true,life:100,travel:0,maxTravel:8});
  game.update();
  assert.equal(player.hp, BALANCE.maxHp - 12);
  assert.equal(player.fartDebuff, BALANCE.fartDebuffFrames, 'The impact frame has already moved before receiving the status');
  for(let tick = 0; tick < BALANCE.fartDebuffFrames; tick++){
    const x = player.x, y = player.y;
    game.update();
    assert(Math.abs(dist2(x,y,player.x,player.y) - player.speed * BALANCE.fartSlowMult) < 1e-9, 'Slowed move ' + (tick + 1));
    assert.equal(player.fartDebuff, BALANCE.fartDebuffFrames - tick - 1);
  }
  const x = player.x, y = player.y;
  game.update();
  assert(Math.abs(dist2(x,y,player.x,player.y) - player.speed) < 1e-9, 'The next move is full speed');
`);

test('Narrow practice views frame both opponents from the first frame across poses, resizing, and kills', `
  window.innerWidth = 390; window.innerHeight = 844;
  camera.fov = 42; resize();
  game = new Game({heroPractice:true});
  const hero = enemies[0];
  function assertFramed(model, label){
    model.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    for(const x of [bounds.min.x,bounds.max.x]){
      for(const y of [bounds.min.y,bounds.max.y]){
        for(const z of [bounds.min.z,bounds.max.z]){
          const point = new THREE.Vector3(x,y,z).project(camera);
          assert(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
          assert(Math.abs(point.x) <= 1, label + ' must fit horizontally, projected x=' + point.x);
          assert(point.z >= -1 && point.z <= 1, label + ' remains within camera depth');
          if(y === bounds.min.y) assert(point.y >= -1, label + ' feet remain in the viewport');
        }
      }
    }
  }
  function assertPair(label){
    syncEntityMeshes();
    assertFramed(playerMesh,label + '/player');
    assertFramed(enemyMeshMap.get(hero),label + '/hero');
  }
  assertPair('390px constructor frame');
  for(const state of ['chase','charge','recover']){
    hero.heroState = state;
    hero.heroStateTimer = state === 'charge' ? BALANCE.heroChargeFrames / 2 : BALANCE.heroRecoverFrames / 2;
    hero.attackAngle = Math.PI; hero.facing = state === 'chase' ? Math.PI : 0;
    updateCamera(); assertPair('390px ' + state);
  }
  for(const [width,height] of [[1280,800],[320,844]]){
    window.innerWidth = width; window.innerHeight = height; resize();
    for(let i = 0; i < 60; i++) updateCamera();
    assert.equal(camera.aspect,width / height);
    assertPair(width + 'px after camera settles');
  }
  killEnemy(hero,game);
  for(let i = 0; i < 60; i++) updateCamera();
  syncEntityMeshes(); assertFramed(playerMesh,'320px after hero defeat');
`);

test('Diagonal movement has no speed bonus and player volume collides with walls while allowing sliding', `
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

test('Close-range fire retains visible particles after the first update', `
  fireGeometry = new THREE.SphereGeometry(1,6,6);
  player.fireReach = 3;
  productionSpawnFireParticle();
  updateVisualEffects();
  assert(fireParticles.some(p => p.visible && p.userData.life > 0), 'Close-range breath must be visible');
`);

test('Pause and mute ignore key repeat, and pausing clears all movement input', `
  input.w = input.shift = true; touchState.moveId = 7; touchState.dx = 1;
  dispatch('document','keydown',{key:'p'}); assert.equal(paused, true);
  assert.equal(input.w, false); assert.equal(input.shift, false);
  assert.equal(touchState.moveId, null); assert.equal(touchState.dx, 0);
  dispatch('document','keydown',{key:'p',repeat:true}); assert.equal(paused, true);
  const wasMuted = audio.muted;
  dispatch('document','keydown',{key:'m',repeat:true}); assert.equal(audio.muted, wasMuted);
`);

test('Restart clears keyboard and touch input, and canceled touches never trigger stomp', `
  input.w = input.shift = true; touchState.moveId = 9; touchState.dx = 1;
  startGame(); assert.equal(input.w, false); assert.equal(input.shift, false);
  assert.equal(touchState.moveId, null); assert.equal(touchState.dx, 0);
  touchState.aimId = 3; touchState.tapMoved = false; touchState.tapStart = Date.now();
  dispatch('game','touchcancel',{changedTouches:[{identifier:3}]});
  assert.equal(player.stompCD, 0); assert.equal(touchState.aimId, null);
`);

test('Losing window focus releases input and automatically pauses', `
  input.w = true; touchState.moveId = 9; touchState.dx = 1;
  dispatch('window','blur');
  assert.equal(input.w, false); assert.equal(touchState.moveId, null); assert.equal(paused, true);
`);

test('60Hz and 144Hz advance equal simulation time, long delays cap catch-up, and pause freezes simulation', `
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

test('Rendering alone does not advance collapse or particle lifetime; simulation updates clean up collapse state', `
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

test('Touch controls synchronize with start, pause, mute, and stomp state', `
  const controls = document.getElementById('touch-controls');
  assert(controls.classList.contains('hidden'));
  startGame(); game.draw = () => {};
  assert(document.getElementById('start-screen').classList.contains('hidden'));
  assert(!controls.classList.contains('hidden'));
  assert.equal(document.getElementById('pause-button').textContent,'Pause');
  audio.ctx = {state:'running',suspend(){this.state='suspended';},resume(){this.state='running';}};
  togglePause();
  assert.equal(audio.ctx.state,'suspended');
  assert.equal(document.getElementById('pause-button').textContent,'Resume');
  assert.match(document.getElementById('game-status').textContent,/Game paused/);
  triggerStomp(); assert.equal(player.stompCD,0);
  togglePause();
  assert.equal(audio.ctx.state,'running');
  assert.equal(document.getElementById('pause-button').textContent,'Pause');
  audio.ctx = null;
  audio.master = {gain:{value:0.25}};
  toggleMute(); assert.equal(audio.master.gain.value,0);
  assert.equal(document.getElementById('mute-button').textContent,'Unmute');
  toggleMute(); assert.equal(audio.master.gain.value,0.25);
  assert.equal(document.getElementById('mute-button').textContent,'Mute');
  triggerStomp(); assert.equal(player.stompCD,120); assert.equal(player.stompFrame,10);
  player.stompFrame = 7; triggerStomp(); assert.equal(player.stompFrame,7,'Cooldown blocks repeated button presses');
`);

test('Game over hides controls; restart restores them and preserves mute preference', `
  startGame(); toggleMute();
  const controls = document.getElementById('touch-controls');
  const finalScreen = document.getElementById('gameover-screen');
  player.score = 1234; game.wave = 7; game.running = false;
  loop(0);
  assert.equal(game,null); assert(controls.classList.contains('hidden'));
  assert(!finalScreen.classList.contains('hidden'));
  assert.match(document.getElementById('final-score').innerHTML,/1234/);
  assert.match(document.getElementById('game-status').textContent,/Game over/);
  const cd = player.stompCD;
  triggerStomp(); togglePause(); assert.equal(player.stompCD,cd);
  startGame();
  assert(game.running); assert(!paused); assert.equal(player.score,0);
  assert(finalScreen.classList.contains('hidden')); assert(!controls.classList.contains('hidden'));
  assert.equal(document.getElementById('pause-button').textContent,'Pause');
  assert(audio.muted); assert.equal(document.getElementById('mute-button').textContent,'Unmute');
`);

test('Opening the guide on start and end screens preserves match and score state and restores opener focus on close', `
  game = null; player.score = 1234; highScore = 4321;
  assert.equal(playGuide.open,false,'Guide is never opened automatically');
  const start = document.getElementById('start-guide-button');
  start.focus(); dispatch('document','keydown',{key:'h'});
  assert(playGuide.open); assert.equal(game,null); assert.equal(paused,false);
  assert.equal(document.activeElement,document.getElementById('guide-close'));
  const session = guideSession;
  dispatch('document','keydown',{key:'h',repeat:true}); assert.equal(guideSession,session);
  dispatch('document','keydown',{key:'Escape'});
  assert.equal(playGuide.open,false); assert.equal(document.activeElement,start);
  document.getElementById('start-screen').classList.add('hidden');
  const end = document.getElementById('end-guide-button');
  openPlayGuide(end); closePlayGuide();
  assert.equal(document.activeElement,end); assert.equal(game,null);
  assert.equal(player.score,1234); assert.equal(highScore,4321);
`);

test('The guide pauses simulation and audio, freezes health, score, and cooldowns, and resumes the same match on close', `
  startGame(); game.draw = () => {};
  const match = game, opener = document.getElementById('play-guide-button');
  assert(!opener.classList.contains('hidden'));
  audio.ctx = {state:'running',suspend(){this.state='suspended';},resume(){this.state='running';}};
  input.w = input.shift = true; touchState.moveId = 7; touchState.dx = 1;
  touchState.aimId = 8; touchState.tapMoved = false; touchState.tapStart = Date.now();
  player.stompCD = 60;
  const before = {time:game.time,hp:player.hp,score:player.score,cd:player.stompCD};
  openPlayGuide(opener);
  assert(paused); assert.equal(audio.ctx.state,'suspended');
  assert.equal(input.w,false); assert.equal(input.shift,false);
  assert.equal(touchState.moveId,null); assert.equal(touchState.aimId,null);
  stepGameFrame(0); stepGameFrame(10000);
  assert.deepEqual({time:game.time,hp:player.hp,score:player.score,cd:player.stompCD},before);
  closePlayGuide();
  assert.equal(game,match); assert.equal(paused,false); assert.equal(audio.ctx.state,'running');
  assert.equal(document.activeElement,opener);
  assert.equal(stepGameFrame(20000),0,'Closing resets the clock without catching up reading time');
`);

test('Repeated guide visits preserve paused matches and stale close events cannot close a reopened guide', `
  togglePause(); assert(paused);
  for(let i = 0; i < 3; i++){
    openPlayGuide(); closePlayGuide(); assert(paused);
  }
  openPlayGuide(); closePlayGuide(); openPlayGuide();
  const current = guideSession;
  dispatch('play-guide','close');
  assert.equal(guideSession,current); assert(playGuide.open); assert(paused);
  dispatch('play-guide','cancel');
  assert.equal(playGuide.open,false); assert.equal(guideSession,null); assert(paused);
`);

test('The guide blocks gameplay shortcuts, aiming, and touch while Space activates buttons without stomping', `
  const muted = audio.muted, mouseX = mouseScreen.x, angle = player.aimAngle;
  openPlayGuide();
  for(const key of ['w','ArrowRight','Shift',' ','p','m','h']) dispatch('document','keydown',{key});
  dispatch('document','mousemove',{clientX:10,clientY:20});
  dispatch('game','touchstart',{changedTouches:[{identifier:1,clientX:10,clientY:20}]});
  dispatch('game','touchmove',{changedTouches:[{identifier:1,clientX:100,clientY:80}]});
  dispatch('game','touchend',{changedTouches:[{identifier:1,clientX:100,clientY:80}]});
  triggerStomp(); togglePause(); toggleMute();
  assert(paused); assert.equal(input.w,false); assert.equal(input.d,false); assert.equal(input.shift,false);
  assert.equal(touchState.moveId,null); assert.equal(touchState.aimId,null);
  assert.equal(player.stompCD,0); assert.equal(audio.muted,muted);
  assert.equal(mouseScreen.x,mouseX); assert.equal(player.aimAngle,angle);
  closePlayGuide(); assert.equal(paused,false);
  dispatch('document','keydown',{key:' ',target:{closest(){return document.getElementById('play-guide-button');}}});
  assert.equal(player.stompCD,0,'Focused button retains native Space activation');
`);

test('Losing focus or hiding the page during the guide keeps the game paused on close and clears input', `
  for(const reason of ['blur','hidden']){
    if(paused) togglePause();
    openPlayGuide();
    if(reason === 'blur') dispatch('window','blur');
    else { document.hidden = true; dispatch('document','visibilitychange'); document.hidden = false; }
    closePlayGuide();
    assert(paused,reason + ' invalidates automatic resume');
    assert.equal(input.w,false); assert.equal(touchState.moveId,null);
  }
`);

test('Resizing with the guide open redraws the scene and updates canvas size without advancing the match', `
  let draws = 0;
  game.draw = () => { draws++; Game.prototype.draw.call(game); };
  openPlayGuide();
  const before = {time:game.time,hp:player.hp,score:player.score};
  window.innerWidth = 320; window.innerHeight = 720;
  dispatch('window','resize');
  assert.equal(draws,1); assert.equal(H.width,320); assert.equal(H.height,720);
  assert.deepEqual({time:game.time,hp:player.hp,score:player.score},before);
  closePlayGuide();
`);

test('Restart discards guide and resume state; delayed native close events cannot affect the new match', `
  openPlayGuide(); const oldMatch = game;
  startGame(); game.draw = () => {};
  const newMatch = game;
  assert.notEqual(newMatch,oldMatch); assert.equal(guideSession,null); assert.equal(playGuide.open,false);
  assert.equal(paused,false); assert.equal(player.score,0);
  dispatch('play-guide','close');
  assert.equal(game,newMatch); assert.equal(paused,false);
  openPlayGuide();
  assert.equal(guideSession.game,newMatch); closePlayGuide(); assert.equal(paused,false);
`);

test('The practice guide explains auto fire, preserves practice and high score state, and hides its in-game opener after the match', `
  highScore = 4321;
  HeroPractice.restart(); game.draw = () => {};
  HeroPractice.setAutoFire(true);
  const match = game, before = HeroPractice.getState();
  openPlayGuide();
  assert(!document.getElementById('guide-practice-note').classList.contains('hidden'));
  assert.equal(HeroPractice.pause(false),true,'Practice API cannot resume through the guide');
  closePlayGuide();
  assert.equal(game,match); assert.deepEqual(HeroPractice.getState(),before); assert.equal(highScore,4321);
  startGame({heroPractice:false}); game.draw = () => {};
  openPlayGuide(); assert(document.getElementById('guide-practice-note').classList.contains('hidden'));
  closePlayGuide();
  game.running = false; loop(0);
  assert(document.getElementById('play-guide-button').classList.contains('hidden'));
`);

test('The production map uses all eight building definitions per cell, with health and shape metadata matching the layout', `
  genMap();
  assert.equal(new Set(cityBuildings.map(b => b.typeId)).size,8);
  assert.equal(map.length,MAP*MAP); assert.equal(buildMeta.length,MAP*MAP);
  let occupied = 0;
  for(const b of cityBuildings){
    const hp = buildMaxHP[b.cells[0].y*MAP+b.cells[0].x];
    assert(hp >= 8 && hp <= 20,'Existing building HP range remains in use');
    for(const cell of b.cells){
      const ci = cell.y*MAP+cell.x;
      occupied++;
      assert.equal(map[ci],1); assert.equal(buildHeight[ci],cell.floors);
      assert.equal(buildHP[ci],hp); assert.equal(buildMaxHP[ci],hp);
      assert.equal(buildDying[ci],-1);
      assert.equal(buildMeta[ci].buildingId,b.id); assert.equal(buildMeta[ci].typeId,b.typeId);
      assert.equal(buildMeta[ci].paletteId,b.paletteId);
      assert.equal(Boolean(buildRoofWalkable[ci]),Boolean(cell.roofWalkable));
    }
  }
  assert.equal(map.filter(cell => cell === 1).length,occupied);
  for(let y=31; y<=41; y++) for(let x=31; x<=41; x++){
    const ci=y*MAP+x;
    assert.equal(map[ci],0); assert.equal(buildMeta[ci],null); assert.equal(buildRoofWalkable[ci],0);
  }
`);

test('Production building rendering reads styles and local cells while retaining one shared model per cell', `
  genMap();
  const typeIds = new Set();
  for(const b of cityBuildings){
    if(typeIds.has(b.typeId)) continue;
    typeIds.add(b.typeId);
    const cell = b.cells[0], ci = cell.y*MAP+cell.x;
    addBuildingMesh(ci,cell.x,cell.y);
    const mesh = buildingMeshes.get(ci);
    assert(mesh && mesh.isMesh); assert.equal(mesh.position.y,0);
    assert.equal(mesh.userData.typeId,b.typeId); assert.equal(mesh.userData.buildingId,b.id);
    assert.equal(Boolean(mesh.userData.roofWalkable),Boolean(cell.roofWalkable));
    let disposed = 0;
    mesh.geometry.addEventListener('dispose',() => disposed++);
    mesh.material.addEventListener('dispose',() => disposed++);
    removeBuildingMesh(ci);
    assert.equal(disposed,0,'Individual destruction keeps the module-owned shared assets');
    assert(!buildingMeshes.has(ci)); assert.equal(mesh.parent,null);
  }
  assert.equal(typeIds.size,8);
`);

test('Boss rooftops require an intact walkable 3x3 area of one building at one height, while legacy flat-roof fixtures remain supported', `
  const cx=44,cy=36;
  for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){
    const ci=building(cx+dx,cy+dy,100,5);
    buildMeta[ci]={buildingId:101,typeId:'office'}; buildRoofWalkable[ci]=1;
  }
  assert.equal(isRoofSafe(cx,cy),true);
  const neighbor=(cy+1)*MAP+cx+1;
  buildRoofWalkable[neighbor]=0; assert.equal(isRoofSafe(cx,cy),false,'Equipment prohibits landing');
  buildRoofWalkable[neighbor]=1; buildMeta[neighbor].buildingId=102;
  assert.equal(isRoofSafe(cx,cy),false,'Two adjoining houses are not a combined Boss roof');
  buildMeta[neighbor].buildingId=101; buildHeight[neighbor]=4;
  assert.equal(isRoofSafe(cx,cy),false,'Setbacks prohibit landing');
  buildHeight[neighbor]=5; buildDying[neighbor]=30;
  assert.equal(isRoofSafe(cx,cy),false,'A collapsing neighbor invalidates the landing zone immediately');
  buildDying[neighbor]=-1;
  player.x=cx+.5+7.5; player.y=cy+.5; Math.random=()=>.5;
  const roof=getRoofPos(); assert(roof); assert.equal(roof.x,cx+.5); assert.equal(roof.y,cy+.5);
  assert.equal(roof.z,5*BUILD_UNIT);
  buildMeta.fill(null); buildRoofWalkable.fill(0);
  assert.equal(isRoofSafe(cx,cy),true,'A manually prepared legacy flat roof is still a valid test fixture');
`);

test('Boss barrage cruising covers only its own building and dives when it reaches an adjacent building of the same height', `
  for(let x=42; x<=48; x++) for(let y=35; y<=37; y++){
    const ci=building(x,y,100,5);
    buildMeta[ci]={buildingId:x>=46?1:2,typeId:'office'}; buildRoofWalkable[ci]=1;
  }
  spawnEnemy('boss',46.5,36.5);
  const boss=enemies[0]; assert(boss.onRoof); boss.shootTimer=0;
  game.updateEnemy(boss);
  const shot=projectiles[0]; assert(shot);
  assert.equal(shot.cruiseFrames,15,'Cruise ends at the first quarter-step crossing into another building');
`);

test('Cell destruction grants health and score once, immediately invalidates Boss landing sites, and clears city metadata after collapse', `
  const ci=building(player.x+5,player.y,12,3);
  buildMeta[ci]={buildingId:77,typeId:'apartment',paletteId:2}; buildRoofWalkable[ci]=1;
  player.hp=50; player.combo=0; player.comboTimer=0;
  const first=destroyBuilding(ci,game), score=player.score;
  assert.equal(first,18); assert.equal(player.hp,68); assert.equal(score,1200);
  assert.equal(buildRoofWalkable[ci],0); assert.equal(buildDying[ci],30);
  assert.equal(destroyBuilding(ci,game),0);
  assert.equal(player.hp,68); assert.equal(player.score,score);
  assert(buildMeta[ci],'Render metadata remains available during the collapse animation');
  for(let i=0; i<30; i++) updateVisualEffects();
  assert.equal(map[ci],0); assert.equal(buildMeta[ci],null); assert.equal(buildRoofWalkable[ci],0);
  assert.equal(buildHeight[ci],0); assert.equal(buildHP[ci],0); assert.equal(buildMaxHP[ci],0);
`);

test('City restart rebuilds the layout without stale metadata and Bloom Hero practice retains an empty city', `
  buildMeta[0]={buildingId:999,typeId:'obsolete'}; buildRoofWalkable[0]=1;
  cityBuildings.push({id:999,typeId:'obsolete',cells:[]});
  buildCityMeshes=productionBuildCityMeshes;
  startGame(); game.draw=()=>{};
  assert.equal(buildMeta[0],null); assert.equal(buildRoofWalkable[0],0);
  assert(!cityBuildings.some(b => b.typeId === 'obsolete'));
  assert.equal(new Set(cityBuildings.map(b => b.typeId)).size,8);
  assert.equal(buildingMeshes.size,map.filter(cell => cell === 1).length);
  const oldMesh=buildingMeshes.values().next().value, oldGround=cityGround;
  HeroPractice.restart(); game.draw=()=>{};
  assert.equal(cityBuildings.length,0);
  assert.equal(buildMeta.some(Boolean),false); assert.equal(buildRoofWalkable.some(Boolean),false);
  assert.equal(buildColorId.some(Boolean),false); assert.equal(map.some(Boolean),false);
  assert.equal(oldMesh.parent,null); assert.equal(oldGround.parent,null);
  assert.equal(buildingMeshes.size,0); assert.equal(buildingGroup.children.length,0);
  startGame({heroPractice:false});
  assert.equal(new Set(cityBuildings.map(b => b.typeId)).size,8);
  assert(buildMeta.some(Boolean)); assert(buildRoofWalkable.some(Boolean));
`);

console.log(passed + ' gameplay checks passed; ' + failed + ' failed.');
if(failed) process.exitCode = 1;
