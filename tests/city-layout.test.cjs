// Eight commercial-city styles, deterministic placement and shared-resource contracts.
// Uses the production generator and geometry builder with the repository's Three.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const THREE = require(path.join(root, 'vendor/three.min.js'));
const drawing = new Proxy({measureText:text => ({width:String(text).length * 20})}, {
  get:(object, key) => key in object ? object[key] : () => {},
});
const context = vm.createContext({THREE, console, document:{
  createElement:() => ({width:0, height:0, getContext:() => drawing}),
}});
vm.runInContext(fs.readFileSync(path.join(root, 'city-visual.js'), 'utf8'), context);
const CityVisual = vm.runInContext('CityVisual', context);
const SIZE = 72;
const spawnRect = {minX:31, maxX:41, minY:31, maxY:41};
const plain = value => JSON.parse(JSON.stringify(value));
function randomFor(seed){
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function layoutFor(seed){
  return CityVisual.generateLayout({mapSize:SIZE, blockStep:11, random:randomFor(seed), spawnRect});
}
function buildingFor(type, orientation = 0, paletteId = 1){
  return CityVisual.createBuilding({id:1, typeId:type.id, x:12, y:12, orientation, paletteId});
}
function roofCenters(building){
  const byPoint = new Map(building.cells.map(cell => [cell.x + ':' + cell.y, cell]));
  return building.cells.filter(center => {
    for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){
      const cell = byPoint.get((center.x + dx) + ':' + (center.y + dy));
      if(!cell || !cell.roofWalkable || cell.floors !== center.floors) return false;
    }
    return true;
  });
}
function renderLayout(layout){
  const map = layout.cells.map(cell => cell ? 1 : 0);
  const byId = new Map(layout.buildings.map(building => [building.id, building]));
  return layout.cells.flatMap((cell, ci) => cell ? [CityVisual.createCell({
    ci, x:cell.x, y:cell.y, floors:cell.floors, map, mapSize:SIZE, buildUnit:2.2,
    building:byId.get(cell.buildingId), cell, cellMap:layout.cells,
  })] : []);
}

let passed = 0;
let failed = 0;
function test(name, callback){
  try{callback(); passed++; console.log('PASS ' + name);}
  catch(error){failed++; console.error('FAIL ' + name + ': ' + error.message);}
}

test('八款目录保持批准的名称、尺寸和配色，真实高度区分轮廓', () => {
  const expected = [
    ['彩盒公寓',4,6,['#50C9B0','#FF8066','#FFF0CC']],
    ['阶梯写字楼',6,6,['#3299D6','#24486B','#E9F5FF']],
    ['转角百货',6,6,['#9B68DB','#FFD05A','#FFF4DB']],
    ['爆米花影院',6,4,['#E85A58','#FFD789','#3F4358']],
    ['像素电玩中心',4,4,['#5F4CCB','#49DDE2','#FF6FA8']],
    ['糖果双塔酒店',6,4,['#F5A5BD','#FFE9BD','#5ABAB5']],
    ['钟塔商馆',5,5,['#EDA942','#397C89','#FFF0D0']],
    ['积木仓库',6,4,['#D98558','#4E7086','#D9E3DB']],
  ];
  assert.equal(CityVisual.catalog.length, expected.length);
  assert.equal(new Set(CityVisual.catalog.map(type => type.id)).size, 8);
  for(const [name,width,depth,colors] of expected){
    const type = CityVisual.catalog.find(entry => entry.name === name);
    assert(type, name + ' exists');
    assert.equal(type.width, width); assert.equal(type.depth, depth);
    assert.deepEqual(plain(type.colors).map(color => color.toUpperCase()), colors);
    const building = buildingFor(type);
    assert.equal(building.width, width); assert.equal(building.depth, depth);
    assert.equal(building.typeId, type.id); assert.equal(building.paletteId, 1);
    assert(building.cells.every(cell => cell.floors >= 2 && cell.floors <= 5));
    const at = (x,y) => building.cells.find(cell => cell.lx === x && cell.ly === y);
    if(name === '彩盒公寓'){
      assert.equal(at(1,0).floors,4); assert.equal(at(1,2).floors,3); assert.equal(at(1,5).floors,4);
    }else if(name === '阶梯写字楼'){
      assert.equal(at(0,0).floors,3); assert.equal(at(2,2).floors,5);
      assert.equal(building.cells.filter(cell => cell.floors === 5).length,16);
    }else if(name === '转角百货'){
      assert.equal(building.cells.length,27,'The 3×3 L-shaped plaza is actual empty space');
      assert(building.cells.every(cell => cell.floors === 3));
      assert.equal(building.cells.filter(cell => cell.lx >= 3 && cell.ly >= 3).length,0);
    }else if(name === '爆米花影院' || name === '积木仓库'){
      assert.equal(building.cells.length,24); assert(building.cells.every(cell => cell.floors === 2));
    }else if(name === '像素电玩中心'){
      assert.deepEqual([...new Set(building.cells.map(cell => cell.floors))].sort(),[2,3,4]);
    }else if(name === '糖果双塔酒店'){
      assert.equal(building.cells.filter(cell => cell.floors === 5).length,12);
      assert.equal(at(2,1).floors,2); assert.equal(at(3,1).floors,2);
    }else if(name === '钟塔商馆'){
      assert.equal(at(0,0).floors,2); assert.equal(at(2,2).floors,5);
      assert.equal(building.cells.filter(cell => cell.floors === 5).length,9);
    }
  }
});

test('每栋支持四向旋转和三个固定配色，局部体块与世界格保持一致', () => {
  for(const type of CityVisual.catalog){
    const original = buildingFor(type);
    for(let orientation=0; orientation<4; orientation++) for(let paletteId=0; paletteId<3; paletteId++){
      const building = buildingFor(type,orientation,paletteId);
      assert.equal(building.width,orientation % 2 ? type.depth : type.width);
      assert.equal(building.depth,orientation % 2 ? type.width : type.depth);
      assert.equal(building.cells.length,original.cells.length);
      assert.equal(new Set(building.cells.map(cell => cell.x + ':' + cell.y)).size,building.cells.length);
      for(const cell of building.cells){
        assert(cell.x >= building.x && cell.x < building.x + building.width);
        assert(cell.y >= building.y && cell.y < building.y + building.depth);
        assert.equal(cell.floors,original.cells.find(base => base.lx === cell.lx && base.ly === cell.ly).floors);
        assert.equal(cell.buildingId,building.id); assert.equal(cell.typeId,type.id);
        assert.equal(cell.paletteId,paletteId);
      }
    }
  }
});

test('固定随机种子复现整栋布局，注入随机数不会读取全局Math.random', () => {
  const expected = plain(layoutFor(731));
  assert.deepEqual(plain(layoutFor(731)),expected);
  const original = vm.runInContext('Math.random',context);
  vm.runInContext('Math.random = () => { throw new Error("Global random is forbidden"); };',context);
  try{assert.deepEqual(plain(layoutFor(731)),expected);}
  finally{context.__restoreRandom = original; vm.runInContext('Math.random = __restoreRandom;',context);}
  assert.notDeepEqual(plain(layoutFor(732)),expected,'Other seeds provide another usable city');
});

test('64次城市布局覆盖全部款式、完整出生空地、道路、Boss屋顶与同款连排上限', () => {
  for(let seed=1; seed<=64; seed++){
    const layout = layoutFor(seed);
    assert.equal(layout.cells.length,SIZE*SIZE);
    assert.equal(new Set(layout.buildings.map(building => building.typeId)).size,8);
    const clock = CityVisual.catalog.find(type => type.name === '钟塔商馆');
    const clockCount = layout.buildings.filter(building => building.typeId === clock.id).length;
    assert(clockCount >= 1 && clockCount <= 2,'Only one or two landmark clocks per city');
    assert(layout.buildings.filter(building => roofCenters(building).length > 0).length >= 4,'At least four distinct safe Boss roofs');
    const occupied = new Set();
    const blockGrid = new Map();
    for(const building of layout.buildings){
      assert(building.x >= 1 && building.y >= 1);
      assert(building.x + building.width < SIZE && building.y + building.depth < SIZE);
      assert.equal(new Set(building.cells.map(cell => cell.paletteId)).size,1,'One coherent palette per building');
      assert(building.x + building.width - 1 < spawnRect.minX || building.x > spawnRect.maxX ||
        building.y + building.depth - 1 < spawnRect.minY || building.y > spawnRect.maxY,'No partly clipped building intersects the spawn rectangle');
      const bx = Math.floor(building.x/11), by = Math.floor(building.y/11);
      assert(!blockGrid.has(bx + ':' + by),'One full building per street block');
      blockGrid.set(bx + ':' + by,building.typeId);
      for(const cell of building.cells){
        const ci = cell.y*SIZE+cell.x;
        assert(!occupied.has(ci),'Buildings never overlap'); occupied.add(ci);
        assert.equal(layout.cells[ci].buildingId,building.id);
        assert.equal(layout.cells[ci].floors,cell.floors);
        assert.equal(layout.cells[ci].paletteId,building.paletteId);
      }
    }
    assert.equal(layout.cells.filter(Boolean).length,occupied.size,'All building cells reach the map without trimming');
    for(let y=spawnRect.minY; y<=spawnRect.maxY; y++) for(let x=spawnRect.minX; x<=spawnRect.maxX; x++) assert.equal(layout.cells[y*SIZE+x],null);
    for(let by=0; by<6; by++) for(let bx=0; bx<6; bx++){
      const type = blockGrid.get(bx + ':' + by);
      if(type === undefined) continue;
      assert(!(blockGrid.get((bx+1) + ':' + by) === type && blockGrid.get((bx+2) + ':' + by) === type),'Horizontal triples are forbidden');
      assert(!(blockGrid.get(bx + ':' + (by+1)) === type && blockGrid.get(bx + ':' + (by+2)) === type),'Vertical triples are forbidden');
    }
    // The last two cells of every 11-cell block are through streets.
    for(let y=0; y<SIZE; y++) for(let x=0; x<SIZE; x++) if(x%11 >= 9 || y%11 >= 9) assert.equal(layout.cells[y*SIZE+x],null);
  }
});

test('中心商业款与外围居住仓储款按城市区域分布', () => {
  const business = new Set(CityVisual.catalog.filter(type => ['阶梯写字楼','转角百货','爆米花影院','像素电玩中心'].includes(type.name)).map(type => type.id));
  const outer = new Set(CityVisual.catalog.filter(type => ['彩盒公寓','糖果双塔酒店','积木仓库'].includes(type.name)).map(type => type.id));
  const counts = {centerBusiness:0, centerOuter:0, edgeBusiness:0, edgeOuter:0};
  for(let seed=101; seed<=164; seed++) for(const building of layoutFor(seed).buildings){
    const dx = building.x + building.width/2 - SIZE/2, dy = building.y + building.depth/2 - SIZE/2;
    const central = Math.hypot(dx,dy) <= 22;
    const key = central ? 'center' : 'edge';
    if(business.has(building.typeId)) counts[key+'Business']++;
    if(outer.has(building.typeId)) counts[key+'Outer']++;
  }
  assert(counts.centerBusiness > counts.centerOuter,'Commerce dominates the central blocks: '+JSON.stringify(counts));
  assert(counts.edgeOuter > counts.edgeBusiness,'Residential and warehouse styles dominate the outer blocks: '+JSON.stringify(counts));
});

test('八款模型每格一次绘制、地面倒塌，屋顶饰件高度和闭合侧墙符合碰撞体', () => {
  const layout = layoutFor(731), cells = renderLayout(layout);
  for(const mesh of cells){
    assert(mesh.isMesh); assert.equal(mesh.children.length,0,'No per-window meshes or dynamic lights');
    assert.equal(mesh.geometry.groups.length,0,'One material and draw submission per cell');
    assert(!Array.isArray(mesh.material)); assert.equal(mesh.position.y,0);
    assert([...mesh.geometry.attributes.position.array].every(Number.isFinite));
    const bounds = mesh.geometry.boundingBox;
    assert(Math.abs(bounds.min.y) < 1e-6,'Destruction scales from the ground');
    const floors = mesh.userData.floors ?? layout.cells[mesh.userData.ci].floors;
    assert(bounds.max.y <= floors*2.2+.25001,'Decorations fit the quarter-cell rooftop allowance');
    assert(bounds.min.x <= -.5 && bounds.max.x >= .5 && bounds.min.z <= -.5 && bounds.max.z >= .5,'Cell body occupies the collision grid');
    const position = mesh.geometry.attributes.position, normal = mesh.geometry.attributes.normal;
    for(const [axis,sign] of [[0,-1],[0,1],[2,-1],[2,1]]){
      let minY=Infinity, maxY=-Infinity;
      for(let i=0; i<position.count; i++){
        if(Math.abs(position.array[i*3+axis] - .5*sign) <= .0011 && normal.array[i*3+axis]*sign > .999){
          minY = Math.min(minY,position.array[i*3+1]); maxY = Math.max(maxY,position.array[i*3+1]);
        }
      }
      assert(minY <= .02 && maxY >= floors*2.2-.02,'All four side walls remain closed when a neighbor collapses');
    }
    mesh.scale.y=.15;
    assert(Math.abs(new THREE.Box3().setFromObject(mesh).min.y) < 1e-6);
    CityVisual.disposeCell(mesh);
  }
});

test('退台和不同建筑身份形成真实外露面，四向旋转与邻格破坏一致', () => {
  const type = CityVisual.catalog.find(type => type.name === '阶梯写字楼');
  const directions = [[0,-1],[1,0],[0,1],[-1,0]];
  for(let orientation=0; orientation<4; orientation++){
    const building = buildingFor(type,orientation);
    const cellMap = Array(SIZE*SIZE).fill(null), map = Array(SIZE*SIZE).fill(0);
    for(const cell of building.cells){cellMap[cell.y*SIZE+cell.x]=cell;map[cell.y*SIZE+cell.x]=1;}
    const cell = building.cells.find(cell => cell.lx === 2 && cell.ly === 2);
    const ci = cell.y*SIZE+cell.x, side=(1+orientation)%4, [dx,dy]=directions[side];
    const adjacent = (cell.y+dy)*SIZE+cell.x+dx, neighbor=cellMap[adjacent];
    const create = () => CityVisual.createCell({ci,x:cell.x,y:cell.y,floors:cell.floors,building,cell,cellMap,map,mapSize:SIZE,buildUnit:2.2});
    const interior = create();
    assert.equal(interior.userData.exposedMask,0,'Same-height cells of one building form a continuous roof');
    neighbor.floors=3;
    const setback = create(); assert.equal(setback.userData.exposedMask,1<<side,'A shorter neighbor exposes the tower facade');
    neighbor.floors=5; neighbor.buildingId=999;
    const otherHouse = create(); assert.equal(otherHouse.userData.exposedMask,1<<side,'Another house is a distinct facade boundary');
    neighbor.buildingId=building.id; map[adjacent]=0;
    const destroyed = create(); assert.equal(destroyed.userData.exposedMask,1<<side,'Removing a neighbor exposes the same complete side');
    assert.equal(setback.geometry,otherHouse.geometry); assert.equal(setback.geometry,destroyed.geometry,'Equivalent boundaries share the finite template');
    [interior,setback,otherHouse,destroyed].forEach(CityVisual.disposeCell);
  }
});

test('900格均衡款式场景面数不超过旧城市两倍，地面仍一次绘制', () => {
  const templates = CityVisual.catalog.map(type => {
    const building = buildingFor(type);
    const cellMap = Array(SIZE*SIZE).fill(null), map = Array(SIZE*SIZE).fill(0);
    for(const cell of building.cells){cellMap[cell.y*SIZE+cell.x]=cell; map[cell.y*SIZE+cell.x]=1;}
    return {building,cellMap,map};
  });
  let triangles = 0;
  for(let i=0; i<900; i++){
    const {building,cellMap,map} = templates[i%8];
    const cell = building.cells[Math.floor(i/8)%building.cells.length];
    const mesh = CityVisual.createCell({ci:cell.y*SIZE+cell.x,x:cell.x,y:cell.y,floors:cell.floors,building,cell,cellMap,map,mapSize:SIZE,buildUnit:2.2});
    triangles += mesh.geometry.attributes.position.count/3;
    CityVisual.disposeCell(mesh);
  }
  assert(triangles <= 186464,'900-cell budget is twice the original 93,232 triangles; actual='+triangles);
  const layout = layoutFor(731), ground = CityVisual.createGround({map:layout.cells.map(cell => cell ? 1 : 0),mapSize:SIZE});
  assert.equal(ground.children.length,1); assert(ground.children[0].isMesh);
  CityVisual.disposeGround(ground);
  console.log('INFO 900 typed cells: '+triangles+' / 186464 triangles');
});

test('三档亮度共用款式图集，拆除和64次随机重开保留共享资源并限制缓存', () => {
  for(const type of CityVisual.catalog){
    const variants = [0,1,2].map(paletteId => {
      const building = buildingFor(type,0,paletteId), cell = building.cells[0];
      const cellMap = Array(SIZE*SIZE).fill(null), map = Array(SIZE*SIZE).fill(0);
      for(const cell of building.cells){cellMap[cell.y*SIZE+cell.x]=cell;map[cell.y*SIZE+cell.x]=1;}
      return CityVisual.createCell({ci:cell.y*SIZE+cell.x,x:cell.x,y:cell.y,floors:cell.floors,building,cell,cellMap,map,mapSize:SIZE,buildUnit:2.2});
    });
    assert.equal(new Set(variants.map(mesh => mesh.material)).size,3);
    assert.equal(new Set(variants.map(mesh => mesh.material.map)).size,1,'Brightness variants share one local atlas');
    const geometry = variants[0].geometry, material = variants[0].material, texture = material.map;
    let disposed = 0;
    for(const resource of [geometry,material,texture]) resource.addEventListener('dispose',() => disposed++);
    const group = new THREE.Group(); group.add(variants[0]);
    CityVisual.disposeCell(variants[0]); assert.equal(variants[0].parent,null); assert.equal(disposed,0);
  }
  let peakGeometry = 0;
  for(let round=0; round<64; round++){
    const cells = renderLayout(layoutFor(2000+round));
    cells.forEach(CityVisual.disposeCell);
    const current = CityVisual.stats();
    peakGeometry = Math.max(peakGeometry,current.geometries);
    assert(current.geometries <= 3344,'Legacy 144 + typed 200 × 16 bounded border masks');
    assert(current.materials <= 32,'Eight legacy + eight styles × three brightness variants');
  }
  const before = plain(CityVisual.stats());
  renderLayout(layoutFor(2020)).forEach(CityVisual.disposeCell);
  assert.deepEqual(plain(CityVisual.stats()),before,'Rendering another copy does not add coordinate-specific cache entries');
  console.log('INFO 64 city restarts: '+peakGeometry+' / 3344 shared geometries, '+before.materials+' / 32 materials');
});

console.log(passed + ' city layout checks passed; ' + failed + ' failed.');
if(failed) process.exitCode = 1;
