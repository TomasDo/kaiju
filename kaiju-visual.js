// 哥斯拉的连续轮廓与外露背鳍。保留原始脚部动画锚点、+Z 朝向和喷火口坐标。
const KaijuVisual = (() => {
  let template;
  function material(color, roughness = 0.8){
    const mat = new THREE.MeshStandardMaterial({color, roughness});
    mat.emissive.setHex(color);
    mat.emissiveIntensity = 0.06;
    return mat;
  }
  function mesh(parent, geometry, mat, position, scale, rotation){
    const part = new THREE.Mesh(geometry, mat);
    if(position) part.position.fromArray(position);
    if(scale) part.scale.fromArray(scale);
    if(rotation) part.rotation.set(...rotation);
    parent.add(part);
    return part;
  }
  function oval(parent, mat, position, size, rotation){
    return mesh(parent, new THREE.SphereGeometry(1, 18, 12), mat, position, size, rotation);
  }
  function scaleBump(parent, mat, position, size, rotation){
    return mesh(parent, new THREE.SphereGeometry(1, 8, 5), mat, position, size, rotation);
  }
  function rod(parent, mat, start, end, radius, radiusEnd = radius){
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), axis = b.clone().sub(a);
    const part = mesh(parent, new THREE.CylinderGeometry(radiusEnd, radius, axis.length(), 12), mat);
    part.position.copy(a.add(b).multiplyScalar(0.5));
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
    return part;
  }
  function sweep(parent, mat, points, radii, segments = 32){
    const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const frames = path.computeFrenetFrames(segments, false);
    const positions = [], uvs = [], indices = [], sides = 14;
    for(let i = 0; i <= segments; i++){
      const t = i / segments, center = path.getPointAt(t);
      const index = Math.min(radii.length - 2, Math.floor(t * (radii.length - 1)));
      const mix = t * (radii.length - 1) - index;
      const radius = radii[index] * (1 - mix) + radii[index + 1] * mix;
      for(let j = 0; j <= sides; j++){
        const angle = j / sides * Math.PI * 2;
        const offset = frames.normals[i].clone().multiplyScalar(Math.cos(angle) * radius)
          .addScaledVector(frames.binormals[i], Math.sin(angle) * radius);
        positions.push(center.x + offset.x, center.y + offset.y, center.z + offset.z);
        uvs.push(j / sides, t);
        if(i && j < sides){
          const a = i * (sides + 1) + j, b = a - sides - 1;
          indices.push(b, b + 1, a, a, b + 1, a + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return mesh(parent, geometry, mat);
  }
  function plate(parent, mat, position, height, length, spread = 0){
    const shape = new THREE.Shape();
    shape.moveTo(-length * 0.52, 0);
    shape.lineTo(-length * 0.42, height * 0.30);
    shape.lineTo(-length * 0.26, height * 0.23);
    shape.lineTo(-length * 0.17, height * 0.72);
    shape.lineTo(-length * 0.04, height);
    shape.lineTo(length * 0.11, height * 0.58);
    shape.lineTo(length * 0.27, height * 0.66);
    shape.lineTo(length * 0.35, height * 0.29);
    shape.lineTo(length * 0.53, 0);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {depth:0.105, bevelEnabled:true, bevelThickness:0.024, bevelSize:0.025, bevelSegments:1, steps:1});
    geometry.translate(0, 0, -0.0525);
    geometry.rotateY(Math.PI / 2);
    return mesh(parent, geometry, mat, position, null, [0, 0, spread]);
  }
  function batch(parent){
    const batches = new Map();
    for(const child of [...parent.children]){
      if(!child.isMesh){batch(child); continue;}
      child.updateMatrix();
      const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
      geometry.applyMatrix4(child.matrix);
      if(!batches.has(child.material)) batches.set(child.material, []);
      batches.get(child.material).push(geometry);
      child.geometry.dispose();
      parent.remove(child);
    }
    for(const [mat, geometries] of batches){
      const merged = new THREE.BufferGeometry();
      for(const name of ['position', 'normal', 'uv']){
        const attributes = geometries.map(g => g.getAttribute(name));
        const values = new Float32Array(attributes.reduce((n, a) => n + a.array.length, 0));
        let offset = 0;
        attributes.forEach(attribute => {values.set(attribute.array, offset); offset += attribute.array.length;});
        merged.setAttribute(name, new THREE.BufferAttribute(values, attributes[0].itemSize));
      }
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      geometries.forEach(geometry => geometry.dispose());
      const part = mesh(parent, merged, mat);
      part.castShadow = true;
      part.receiveShadow = true;
      part.userData.baseHex = mat.color.getHex();
    }
  }
  function build(){
    const root = new THREE.Group();
    root.name = 'kaiju';
    const skin = material(0x376f52);
    const dark = material(0x285440);
    const belly = material(0x6c9567);
    const armor = material(0x478466);
    const plates = material(0xb3d1be, 0.61);
    const plateBase = material(0x6caa92);
    const ivory = material(0xe0d8b9, 0.55);
    const amber = material(0xf0b846, 0.40);
    const black = material(0x182b26, 0.55);
    const mouth = material(0x754435, 0.66);

    oval(root, skin, [0, 3.2, 0], [1.2, 1.65, 1.8]);
    oval(root, belly, [0, 3.68, 1.03], [1.02, 1.18, 1.19]);
    // 颈部从肩背连续连到头骨；无需增加头部命中范围或移动速度。
    sweep(root, skin, [[0, 3.90, 0.72], [0, 4.49, 1.34], [0, 5.05, 1.91], [0, 5.43, 2.43]], [0.88, 0.80, 0.68, 0.62], 24);
    oval(root, skin, [0, 5.45, 2.50], [0.86, 0.72, 0.96]);
    oval(root, skin, [0, 5.48, 3.25], [0.69, 0.30, 0.82]);
    oval(root, dark, [0, 4.97, 3.32], [0.62, 0.17, 0.73]);
    mesh(root, new THREE.BoxGeometry(1.04, 0.105, 0.71), mouth, [0, 5.17, 3.70]);
    for(const side of [-1, 1]){
      oval(root, dark, [side * 0.62, 5.75, 2.94], [0.24, 0.11, 0.37], [0, side * 0.2, -side * 0.16]);
      oval(root, amber, [side * 0.69, 5.61, 3.00], [0.17, 0.105, 0.21]);
      oval(root, black, [side * 0.75, 5.61, 3.17], [0.040, 0.074, 0.070]);
      scaleBump(root, ivory, [side * 0.742, 5.65, 3.225], [0.023, 0.024, 0.018]);
      oval(root, dark, [side * 0.285, 5.69, 3.70], [0.115, 0.070, 0.18]);
      oval(root, black, [side * 0.30, 5.751, 3.78], [0.052, 0.016, 0.062]);
      oval(root, armor, [side * 0.59, 5.29, 2.80], [0.24, 0.25, 0.34]);
    }
    for(let i = -3; i <= 3; i++){
      mesh(root, new THREE.ConeGeometry(0.060, 0.16, 7), ivory, [i * 0.14, 5.13, 3.96], null, [Math.PI, 0, 0]);
    }
    for(const side of [-1, 1]) for(let i = 0; i < 3; i++){
      mesh(root, new THREE.ConeGeometry(0.062, 0.17, 7), ivory, [side * 0.53, 5.13, 3.35 + i * 0.18], null, [Math.PI, 0, 0]);
    }

    // 渐细曲面整体生成尾巴，节间不再露出间隙或平截面。
    sweep(root, dark, [[0, 2.93, -1.10], [0, 2.85, -1.88], [0, 2.56, -2.75], [0, 2.20, -3.64], [0, 1.92, -4.56]], [0.74, 0.56, 0.40, 0.25, 0.008]);
    for(let i = 0; i < 6; i++){
      const z = -1.95 - i * 0.37, y = 2.84 - i * 0.143, width = 0.47 - i * 0.056;
      scaleBump(root, armor, [-width * 0.75, y + width * 0.48, z], [0.13, 0.12, 0.22]);
      scaleBump(root, armor, [width * 0.75, y + width * 0.48, z], [0.13, 0.12, 0.22]);
    }

    // 所有中央背鳍基座均处于椭球外表面；靠背一侧的侧鳍向外展开。
    const dorsal = [
      [5.16, 1.52, 0.72, 0.74], [4.76, 0.72, 1.15, 1.04],
      [4.73, -0.27, 1.24, 1.13], [4.19, -1.23, 1.08, 1.03],
      [3.33, -1.98, 0.80, 0.78], [2.89, -2.81, 0.63, 0.71],
      [2.43, -3.57, 0.43, 0.58], [2.13, -4.15, 0.27, 0.43]
    ];
    dorsal.forEach(([y, z, height, length]) => {
      plate(root, plates, [0, y, z], height, length);
      oval(root, plateBase, [0, y + 0.02, z], [0.15, 0.18, length * 0.39]);
    });
    for(const side of [-1, 1]){
      [[4.44, 0.60, 0.70, 0.76, 0.68], [4.33, -0.30, 0.79, 0.89, 0.72], [3.91, -1.10, 0.69, 0.75, 0.57], [3.14, -1.94, 0.48, 0.53, 0.36]].forEach(([y, z, h, length, x]) => {
        plate(root, plateBase, [side * x, y, z], h, length, -side * 0.28);
      });
      // 肩胛、背侧鳞片给斜俯视镜头提供结构，不依赖图片纹理。
      for(let row = 0; row < 5; row++) for(let column = 0; column < 3; column++){
        const z = -1.13 + row * 0.49;
        const angle = 0.28 + column * 0.32;
        const ring = Math.sqrt(Math.max(0.1, 1 - (z / 1.8) ** 2));
        const x = side * (Math.cos(angle) * 1.215 * ring), y = 3.2 + Math.sin(angle) * 1.68 * ring;
        scaleBump(root, armor, [x, y, z], [0.13, 0.16, 0.22], [0, 0, -side * angle]);
      }
    }
    for(let i = 0; i < 5; i++){
      const y = 2.86 + i * 0.38;
      oval(root, skin, [0, y, 1.95 + Math.sin(i / 4 * Math.PI) * 0.20], [0.79 - Math.abs(i - 2) * 0.08, 0.10, 0.07]);
    }

    for(const side of [-1, 1]){
      const leg = new THREE.Group();
      leg.name = side < 0 ? 'kaiju-left-leg' : 'kaiju-right-leg';
      leg.position.set(side * 0.95, 2.28, 0.35);
      leg.userData.baseZRot = 0.08 * side;
      root.add(leg);
      oval(leg, dark, [0, -0.58, -0.04], [0.49, 0.95, 0.52]);
      rod(leg, dark, [0, -0.95, -0.05], [0, -1.85, 0.28], 0.35, 0.30);
      const foot = new THREE.Group();
      foot.name = 'kaiju-foot';
      foot.position.set(0, -2.06, 0.50);
      foot.userData.baseY = foot.position.y;
      foot.userData.baseZ = foot.position.z;
      leg.add(foot);
      oval(foot, dark, [0, 0, 0], [0.56, 0.22, 0.80]);
      for(let i = -1; i <= 1; i++){
        oval(foot, dark, [i * 0.29, -0.005, 0.53], [0.18, 0.16, 0.36]);
        mesh(foot, new THREE.ConeGeometry(0.105, 0.36, 9), ivory, [i * 0.29, -0.02, 0.88], null, [Math.PI / 2, 0, 0]);
      }
      // 上臂接入肩部，前臂向前弯，避免旧模型像两根浮空木棍。
      oval(root, skin, [side * 1.10, 4.04, 1.03], [0.40, 0.49, 0.50]);
      rod(root, dark, [side * 1.23, 3.98, 1.35], [side * 1.53, 3.35, 1.59], 0.29, 0.23);
      oval(root, armor, [side * 1.50, 3.43, 1.52], [0.28, 0.30, 0.28]);
      rod(root, skin, [side * 1.53, 3.35, 1.59], [side * 1.66, 3.03, 2.03], 0.23, 0.19);
      oval(root, dark, [side * 1.66, 3.03, 2.16], [0.27, 0.22, 0.33]);
      for(let i = -1; i <= 1; i++){
        mesh(root, new THREE.ConeGeometry(0.074, 0.31, 8), ivory, [side * 1.66 + i * 0.15, 2.98, 2.49], null, [Math.PI / 2, 0, 0]);
      }
    }
    batch(root);
    return root;
  }
  function create(){
    if(!template) template = build();
    const root = template.clone(true);
    const materials = new Map();
    root.traverse(part => {
      if(!part.isMesh) return;
      if(!materials.has(part.material)) materials.set(part.material, part.material.clone());
      part.material = materials.get(part.material);
    });
    root.userData.mouth = new THREE.Vector3(0, 5.2, 4.2);
    root.userData.legs = [-1, 1].map(side => ({side, leg:root.getObjectByName(side < 0 ? 'kaiju-left-leg' : 'kaiju-right-leg')}));
    return root;
  }
  function dispose(root){
    if(root.userData.kaijuDisposed) return;
    const materials = new Set();
    root.traverse(part => {if(part.isMesh) materials.add(part.material);});
    materials.forEach(mat => mat.dispose());
    root.userData.kaijuDisposed = true;
  }
  return {create, dispose};
})();
