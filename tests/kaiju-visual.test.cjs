const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const project = path.join(__dirname, '..');
const THREE = require(path.join(project, 'vendor/three.min.js'));
const context = vm.createContext({THREE});
vm.runInContext(fs.readFileSync(path.join(project, 'kaiju-visual.js'), 'utf8'), context);
const visual = vm.runInContext('KaijuVisual', context);
const model = visual.create(), other = visual.create();
const parts = [], otherParts = [];
model.traverse(o => {if(o.isMesh) parts.push(o);});
other.traverse(o => {if(o.isMesh) otherParts.push(o);});
assert(parts.length < 20);
for(const part of parts) for(const attribute of ['position', 'normal', 'uv']){
  assert([...part.geometry.getAttribute(attribute).array].every(Number.isFinite));
}
const bounds = new THREE.Box3().setFromObject(model);
assert(bounds.min.y > -0.02 && bounds.min.y < 0.02);
assert(bounds.max.y > 6 && bounds.max.y < 6.5);
assert(bounds.max.z > 4.0 && bounds.max.z < 4.2);
assert(bounds.min.z > -4.8 && bounds.min.z < -4.5);
assert.deepEqual(model.userData.mouth.toArray(), [0, 5.2, 4.2]);
assert.equal(model.userData.legs.length, 2);
for(const {side, leg} of model.userData.legs){
  assert.equal(leg.position.x, side * 0.95);
  assert.equal(leg.position.y, 2.28);
  assert.equal(leg.position.z, 0.35);
  assert.equal(leg.userData.baseZRot, side * 0.08);
  const foot = leg.children.find(child => child.userData.baseY !== undefined);
  assert(foot && foot.userData.baseZ !== undefined);
  // 用现有 animateGodzillaLegs 的子节点约定模拟最大步幅，脚爪与脚掌保持同组。
  const baseY = foot.userData.baseY;
  leg.rotation.x = side * 0.34;
  foot.position.y = baseY + Math.max(0, side) * 0.28;
  foot.position.z = foot.userData.baseZ + Math.max(0, side) * 0.16;
  foot.rotation.x = -leg.rotation.x * 0.35;
  assert(foot.children.every(child => child.isMesh));
}
parts.forEach((part, i) => {
  assert.equal(part.geometry, otherParts[i].geometry);
  assert.notEqual(part.material, otherParts[i].material);
});
let geometryDisposed = 0, materialDisposed = 0;
parts[0].geometry.addEventListener('dispose', () => geometryDisposed++);
parts[0].material.addEventListener('dispose', () => materialDisposed++);
visual.dispose(model); visual.dispose(model);
assert.equal(geometryDisposed, 0);
assert.equal(materialDisposed, 1);
visual.dispose(other);
console.log('PASS kaiju geometry, preserved bounds/mouth, existing leg animation contract, shared geometry and isolated materials');
console.log(parts.length + ' meshes, ' + parts.reduce((n, part) => n + part.geometry.attributes.position.count / 3, 0) + ' triangles');
console.log('bounds ' + bounds.getSize(new THREE.Vector3()).toArray().map(n => n.toFixed(3)).join(' × '));
