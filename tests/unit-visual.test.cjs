// 新单位模型：尺寸、动画、共享资源、受击隔离的无浏览器回归检查。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const project = path.join(__dirname, '..');
const THREE = require(path.join(project, 'vendor/three.min.js'));
const context = vm.createContext({THREE});
vm.runInContext(fs.readFileSync(path.join(project, 'unit-visual.js'), 'utf8'), context);
const visual = vm.runInContext('UnitVisual', context);
const models = ['soldier', 'tank', 'helicopter', 'fartHero'];
function meshes(root){ const list = []; root.traverse(o => { if(o.isMesh) list.push(o); }); return list; }
let checks = 0;
function test(name, check){ check(); checks++; console.log('PASS ' + name); }

test('全部模型的顶点有效、绘制调用有界、单位比例稳定', () => {
  for(const type of models){
    const model = visual.create(type);
    const parts = meshes(model);
    assert(parts.length <= (type === 'fartHero' ? 36 : 20), type + ' bounded meshes including independently hinged petals');
    assert(parts.reduce((sum, mesh) => sum+mesh.geometry.attributes.position.count/3,0) < 18000, type+' bounded geometry');
    for(const mesh of parts){
      for(const attribute of ['position', 'normal', 'uv']){
        assert([...mesh.geometry.getAttribute(attribute).array].every(Number.isFinite), type + ' ' + attribute);
      }
      assert.equal(mesh.userData.baseHex, mesh.material.color.getHex());
    }
    const bounds = new THREE.Box3().setFromObject(model);
    if(type !== 'helicopter') assert(Math.abs(bounds.min.y) < 0.025, type + ' feet/tracks meet ground');
    if(type === 'soldier') assert(bounds.max.y > 1.95 && bounds.max.y < 2.08, 'Workers have normal human proportions');
    if(type === 'fartHero') assert(bounds.max.y > 1.7 && bounds.max.y < 1.85);
    if(type === 'tank') assert(bounds.max.z > 1.3 && bounds.min.z < -0.8, 'Tank has a forward barrel and full tracks');
    if(type === 'helicopter'){
      assert(bounds.min.z < -1.4, 'Helicopter has a tail');
      assert(bounds.max.x > 1.4 && bounds.min.x < -1.4, 'Rotor spans exceed fuselage width');
    }
    const size = bounds.getSize(new THREE.Vector3());
    console.log(type + ': ' + parts.length + ' meshes, ' + parts.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0) + ' triangles; bounds ' + [size.x,size.y,size.z].map(n => n.toFixed(3)).join(' × '));
    visual.dispose(model);
  }
});

test('同类共享几何但受击材质彼此独立，释放幂等且不释放共享几何', () => {
  for(const type of models){
    const first = visual.create(type), second = visual.create(type);
    const a = meshes(first), b = meshes(second);
    assert.equal(a.length, b.length);
    a.forEach((part, i) => {
      assert.equal(part.geometry, b[i].geometry);
      assert.notEqual(part.material, b[i].material);
    });
    const otherColor = b[0].material.color.getHex();
    a[0].material.color.setHex(0xff6666);
    assert.equal(b[0].material.color.getHex(), otherColor);
    let disposedGeometry = 0, disposedMaterial = 0;
    a[0].geometry.addEventListener('dispose', () => disposedGeometry++);
    a[0].material.addEventListener('dispose', () => disposedMaterial++);
    visual.dispose(first); visual.dispose(first);
    assert.equal(disposedMaterial, 1);
    assert.equal(disposedGeometry, 0);
    const fresh = visual.create(type);
    assert.equal(meshes(fresh)[0].geometry, b[0].geometry);
    assert.equal(meshes(fresh)[0].material.color.getHex(), otherColor);
    visual.dispose(second); visual.dispose(fresh);
  }
});

test('行走摆腿、助威抬手、快走与复位是确定姿态', () => {
  const worker = visual.create('soldier');
  const rig = worker.userData.rig;
  visual.animate(worker, {time:0.21, moving:true});
  assert(Math.abs(rig['left-leg'].rotation.x) > 0.3);
  assert.equal(rig['left-leg'].rotation.x, -rig['right-leg'].rotation.x);
  visual.animate(worker, {time:0.21, cheering:true});
  assert(rig['left-arm'].rotation.x < -2.3);
  assert.equal(rig['left-leg'].rotation.x, 0);
  const pose = rig['left-arm'].rotation.toArray().join();
  visual.animate(worker, {time:0.21, cheering:true});
  assert.equal(rig['left-arm'].rotation.toArray().join(), pose);
  visual.animate(worker, {time:0.126, moving:true, panic:true});
  assert(Math.abs(rig['left-leg'].rotation.x) > 0.5);
  assert(rig.body.rotation.x > 0.1);
  visual.animate(worker, {time:0, moving:false, cheering:false, panic:false});
  assert.equal(rig['left-leg'].rotation.x, 0);
  assert(Math.abs(rig['left-arm'].rotation.x) < 1e-9);
  assert.equal(rig['left-arm'].rotation.z, 0);
  assert.equal(rig.body.rotation.x, 0);
  visual.dispose(worker);
});

test('直升机双旋翼和英雄披风独立动画，弱点留在背面', () => {
  const helicopter = visual.create('helicopter'), hero = visual.create('fartHero');
  visual.animate(helicopter, {time:2, moving:true});
  assert.equal(helicopter.userData.rig.rotor.rotation.y, 70);
  assert.equal(helicopter.userData.rig['tail-rotor'].rotation.x, 96);
  visual.animate(hero, {time:2, moving:true});
  assert(hero.userData.rig.cape.rotation.x > 0.1);
  assert(hero.userData.rig.weakness.position.z < -0.3);
  assert(hero.userData.rig.weakness.position.y > 0.9);
  visual.dispose(helicopter); visual.dispose(hero);
});

test('菊花侠四阶段有明确姿态，喷气与喘气显示开口，关闭后复位', () => {
  const hero=visual.create('fartHero'), rig=hero.userData.rig;
  visual.animate(hero,{time:0.21,moving:true});
  assert(Math.abs(rig['left-leg'].rotation.x)>0.3,'chase walks');
  assert(!rig['weak-core'].visible,'closed flower conceals the core');
  visual.animate(hero,{time:0.21,moving:true,heroState:'charge',phase:1});
  assert(rig.belly.scale.z>1.4,'charge visibly inflates belly');
  assert(rig['left-knee'].rotation.x<-0.5,'charge bends knees');
  assert.equal(rig['left-leg'].rotation.x,rig['right-leg'].rotation.x,'charge stops stride');
  visual.animate(hero,{time:0.21,heroState:'spray',phase:0.3});
  assert(rig.body.position.z>0.03,'spray recoils forward from rear nozzle');
  assert(rig.petals.every(petal=>petal.rotation.x>0.9),'spray opens the exhaust');
  assert(rig['weak-core'].visible);
  visual.animate(hero,{time:0.21,heroState:'recover',phase:0.4,weaknessOpen:true});
  assert(rig.mouth.scale.y>1.6,'recover visibly pants');
  assert(rig.petals.every(petal=>petal.rotation.x>1.2),'recover fully exposes core');
  assert(meshes(rig['weak-core'])[0].material.emissiveIntensity>=1,'weak core glows');
  visual.animate(hero,{time:0,heroState:'chase'});
  assert.equal(rig.belly.scale.z,1);
  assert(Math.abs(rig['left-knee'].rotation.x)<1e-12);
  assert(rig.petals.every(petal=>petal.rotation.x===0));
  assert.equal(rig.mouth.scale.y,1);
  assert(!rig['weak-core'].visible);
  visual.dispose(hero);
});

test('后腰公开锚点与真实核心一致，各阶段不移动，短披风不挡背面核心', () => {
  const hero=visual.create('fartHero'), rig=hero.userData.rig;
  assert(Object.isFrozen(visual.HERO_NOZZLE));
  assert.equal(rig.weakness.parent,hero,'nozzle position is independent of torso motion');
  const expected=new THREE.Vector3(visual.HERO_NOZZLE.x,visual.HERO_NOZZLE.y,visual.HERO_NOZZLE.z);
  for(const heroState of ['chase','charge','spray','recover']){
    visual.animate(hero,{time:1.2,moving:true,heroState,phase:0.6,weaknessOpen:heroState==='recover'});
    hero.updateMatrixWorld(true);
    assert(rig['weak-core'].getWorldPosition(new THREE.Vector3()).distanceTo(expected)<1e-12);
  }
  const ray=new THREE.Raycaster(new THREE.Vector3(0,visual.HERO_NOZZLE.y,-2),new THREE.Vector3(0,0,1));
  const intersections=ray.intersectObject(hero,true).filter(hit=>hit.object.parent!==rig['weak-core']||rig['weak-core'].visible);
  assert(intersections.length>0);
  assert.equal(intersections[0].object.parent,rig['weak-core'],'back view can directly see the exposed core');
  visual.dispose(hero);
});

test('英雄动画不推进状态，重复渲染与回到追击确定复位，实例姿态和受击发光隔离', () => {
  const a=visual.create('fartHero'), b=visual.create('fartHero');
  function snapshot(root){
    const list=[];root.traverse(node=>{
      list.push([node.name,node.visible,...node.position.toArray(),...node.rotation.toArray(),...node.scale.toArray(),...(node.isMesh?[node.material.color.getHex(),node.material.emissive.getHex(),node.material.emissiveIntensity]:[])]);
    });return JSON.stringify(list);
  }
  const input={time:1.34,heroState:'recover',phase:0.3,weaknessOpen:true,hit:0.7};
  const bBefore=snapshot(b);
  visual.animate(a,input);const once=snapshot(a);visual.animate(a,input);
  assert.equal(snapshot(a),once,'same input gives the same pose without changing state');
  assert.equal(snapshot(b),bBefore,'second hero animation and glow are untouched');
  assert.notEqual(meshes(a)[0].material.color.getHex(),meshes(b)[0].material.color.getHex(),'hit color is instance local');
  visual.animate(a,{time:0.5,moving:true});visual.animate(b,{time:0.5,moving:true});
  assert.equal(snapshot(a),snapshot(b),'all charged/recovery/hit transforms reset');
  visual.animate(a,{time:0,heroState:'charge',phase:99,hit:-4});
  assert.equal(a.userData.rig.belly.scale.z,1.45,'phase is clamped');
  visual.dispose(a);visual.dispose(b);
});

test('三个工服变体缓存有界且无未知单位静默回退', () => {
  const a = visual.create('soldier', {variant:1}), b = visual.create('soldier', {variant:4});
  assert.equal(meshes(a)[0].geometry, meshes(b)[0].geometry);
  assert.throws(() => visual.create('boss'), /Unsupported unit type/);
  visual.dispose(a); visual.dispose(b);
});

console.log(checks + ' unit visual regression checks passed.');
