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
    assert(parts.length <= 20, type + ' uses at most 20 meshes');
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

test('三个工服变体缓存有界且无未知单位静默回退', () => {
  const a = visual.create('soldier', {variant:1}), b = visual.create('soldier', {variant:4});
  assert.equal(meshes(a)[0].geometry, meshes(b)[0].geometry);
  assert.throws(() => visual.create('boss'), /Unsupported unit type/);
  visual.dispose(a); visual.dispose(b);
});

console.log(checks + ' unit visual regression checks passed.');
