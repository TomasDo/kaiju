// 城市建模与逐格摧毁契约；只使用仓库内的 Three.js。
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const THREE=require(path.join(root,'vendor/three.min.js'));
const context=vm.createContext({THREE,console,document:{createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){}})})}});
vm.runInContext(fs.readFileSync(path.join(root,'city-visual.js'),'utf8'),context);
const CityVisual=vm.runInContext('CityVisual',context);
const size=72,map=Array(size*size).fill(0),cells=[];
// 固定的 36 个街区，覆盖 2-5 层、8 套配色及全部朝向。
for(let by=0;by<6;by++) for(let bx=0;bx<6;bx++){
  const x0=bx*11+1,y0=by*11+1,w=4+(bx+by)%3,d=4+(2*bx+by)%3;
  for(let y=y0;y<y0+d;y++) for(let x=x0;x<x0+w;x++) map[y*size+x]=1;
}
for(let y=0;y<size;y++) for(let x=0;x<size;x++) if(map[y*size+x]){
  cells.push(CityVisual.createCell({ci:y*size+x,x,y,floors:2+(Math.floor(x/11)+Math.floor(y/11))%4,colorId:Math.floor(x/11)%8,map,mapSize:size,buildUnit:2.2}));
}
let totalTriangles=0;
for(const cell of cells){
  assert(cell.isMesh,'Every destructible cell stays one draw call');
  assert.equal(cell.position.y,0,'Collapse origin must stay on ground');
  const positions=cell.geometry.attributes.position;
  assert([...positions.array].every(Number.isFinite));
  assert.equal(cell.geometry.boundingBox.min.y,0);
  assert(cell.geometry.boundingBox.min.x<=-.5&&cell.geometry.boundingBox.max.x>=.5,'No gaps between contiguous building cells');
  totalTriangles+=positions.count/3;
}
console.log(`PASS ${cells.length} building cells, ${totalTriangles} triangles, ${JSON.stringify(CityVisual.stats())}`);
const sample=cells.find(c=>c.userData.exposedMask===0&&c.userData.equipment===0);
// 销毁一格不得让其它使用同一材质的格子失去资源。
let geometryDisposed=0,materialDisposed=0,textureDisposed=0;
sample.geometry.addEventListener('dispose',()=>geometryDisposed++);
sample.material.addEventListener('dispose',()=>materialDisposed++);
sample.material.map.addEventListener('dispose',()=>textureDisposed++);
const group=new THREE.Group();group.add(sample);CityVisual.disposeCell(sample);
assert.equal(sample.parent,null);assert.equal(geometryDisposed,0);assert.equal(materialDisposed,0);assert.equal(textureDisposed,0);
sample.scale.y=.15;
assert.equal(new THREE.Box3().setFromObject(sample).min.y,0,'Scaled collapse remains grounded');
console.log('PASS destruction preserves shared geometry, material and texture; collapse remains grounded');
const ground=CityVisual.createGround({map,mapSize:size});
assert.equal(ground.children.length,1);
assert(ground.userData.markings.length>100,'Road markings exist in actual empty corridors');
for(const line of ground.userData.markings){
  for(let y=Math.floor(line.z-line.depth/2);y<=Math.floor(line.z+line.depth/2);y++) for(let x=Math.floor(line.x-line.width/2);x<=Math.floor(line.x+line.width/2);x++){
    assert.equal(map[y*size+x],0,'Road marking cannot cross a building');
    assert.equal(ground.userData.sidewalks[y*size+x],0,'Road marking cannot overlap a curb');
  }
}
let groundGeometry=0,groundMaterial=0;
ground.children[0].geometry.addEventListener('dispose',()=>groundGeometry++);
ground.children[0].material.addEventListener('dispose',()=>groundMaterial++);
CityVisual.disposeGround(ground);
assert.equal(groundGeometry,1);assert.equal(groundMaterial,1);
console.log(`PASS 1 ground draw call, ${ground.children[0].geometry.attributes.position.count/3} triangles, ${ground.userData.markings.length} safe road markings; ground resources disposed`);
// 相同地图重开复用全部模板，无增长。
const before=CityVisual.stats();
for(const c of cells){
  const x=c.position.x-.5,y=c.position.z-.5;
  const fresh=CityVisual.createCell({ci:c.userData.ci,x,y,floors:2+(Math.floor(x/11)+Math.floor(y/11))%4,colorId:Math.floor(x/11)%8,map,mapSize:size,buildUnit:2.2});
  assert.equal(c.geometry,fresh.geometry);assert.equal(c.material,fresh.material);
  CityVisual.disposeCell(fresh);
}
assert.deepEqual(CityVisual.stats(),before);
console.log('PASS restarting same city reuses all templates without growth');

// 内部格子仍有四向立面，邻楼倒塌/删除后不会显露空洞。
const interior=sample.geometry.attributes.position, normal=sample.geometry.attributes.normal;
for(const [axis,sign] of [[0,-1],[0,1],[2,-1],[2,1]]){
  let vertices=0;
  for(let i=0;i<interior.count;i++){
    if(Math.abs(interior.array[i*3+axis]-.501*sign)<.00001&&normal.array[i*3+axis]*sign>.999) vertices++;
  }
  assert(vertices>=12,'Each internal side keeps full facade planes after its neighbor is removed');
}
console.log('PASS all four interior facades remain closed and detailed after adjacent destruction');

// 随机地图重开覆盖颜色、楼层、入口和屋顶变体；共享缓存有固定上界。
let seed=731;
const random=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/4294967296*max);};
let peakGeometry=0;
for(let round=0;round<64;round++){
  const next=Array(size*size).fill(0),meta=[];
  for(let by=0;by<6;by++) for(let bx=0;bx<6;bx++){
    const x0=bx*11+random(2),y0=by*11+random(2),w=4+random(3),d=4+random(3);
    const floors=2+random(4),colorId=random(8);
    for(let y=Math.max(1,y0);y<y0+d;y++) for(let x=Math.max(1,x0);x<x0+w;x++){
      const ci=y*size+x;
      if(x>=34&&x<=38&&y>=34&&y<=38) continue;
      next[ci]=1;meta.push({ci,x,y,floors,colorId});
    }
  }
  for(const cell of meta) CityVisual.disposeCell(CityVisual.createCell({...cell,map:next,mapSize:size,buildUnit:2.2}));
  const current=CityVisual.stats();
  peakGeometry=Math.max(peakGeometry,current.geometries);
  assert(current.geometries<=144,'Fixed gameplay floor/unit variants bound shared geometry cache');
  assert(current.materials<=8,'Palette material cache is bounded');
}
console.log(`PASS 64 random city restarts: cache bounded at ${peakGeometry}/144 geometry templates, ${CityVisual.stats().materials}/8 materials`);
