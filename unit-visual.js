// 城市单位的本地程序模型。统一 +Z 朝前；地面角色脚底 y = 0，直升机以机身中心为原点。
// 模板几何全局复用，实例材质独立；每个骨骼按材质合批，避免细节带来大量绘制调用。
const UnitVisual = (() => {
  const templates = new Map();
  const TAU = Math.PI * 2;

  function material(color, roughness = 0.72, metalness = 0){
    const mat = new THREE.MeshStandardMaterial({color, roughness, metalness});
    mat.emissive.setHex(color);
    mat.emissiveIntensity = 0.09;
    return mat;
  }
  function group(parent, name, position = [0, 0, 0]){
    const g = new THREE.Group();
    g.name = name;
    g.position.fromArray(position);
    parent.add(g);
    return g;
  }
  function part(parent, geometry, mat, position, scale, rotation){
    const mesh = new THREE.Mesh(geometry, mat);
    if(position) mesh.position.fromArray(position);
    if(scale) mesh.scale.fromArray(scale);
    if(rotation) mesh.rotation.set(...rotation);
    parent.add(mesh);
    return mesh;
  }
  function box(parent, mat, position, size, rotation){
    return part(parent, new THREE.BoxGeometry(...size), mat, position, null, rotation);
  }
  function oval(parent, mat, position, size, rotation){
    return part(parent, new THREE.SphereGeometry(1, 12, 8), mat, position, size, rotation);
  }
  function cylinder(parent, mat, position, radii, height, rotation, segments = 12){
    return part(parent, new THREE.CylinderGeometry(radii[0], radii[1], height, segments), mat, position, null, rotation);
  }
  function rod(parent, mat, a, b, radius = 0.025, segments = 8){
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const mesh = part(parent, new THREE.CylinderGeometry(radius, radius, direction.length(), segments), mat);
    mesh.position.copy(start.add(end).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return mesh;
  }
  function panel(parent, mat, points, z, depth = 0.012){
    const shape = new THREE.Shape();
    shape.moveTo(...points[0]);
    points.slice(1).forEach(point => shape.lineTo(...point));
    shape.closePath();
    return part(parent, new THREE.ExtrudeGeometry(shape, {depth, bevelEnabled:false, steps:1}), mat, [0, 0, z]);
  }
  function torso(parent, mat, points, depthScale){
    return part(parent, new THREE.LatheGeometry(points.map(point => new THREE.Vector2(...point)), 14), mat, null, [1, 1, depthScale]);
  }

  function batch(parent){
    const buckets = new Map();
    for(const child of [...parent.children]){
      if(!child.isMesh){ batch(child); continue; }
      child.updateMatrix();
      const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
      geometry.applyMatrix4(child.matrix);
      if(!buckets.has(child.material)) buckets.set(child.material, []);
      buckets.get(child.material).push(geometry);
      child.geometry.dispose();
      parent.remove(child);
    }
    for(const [mat, geometries] of buckets){
      const geometry = new THREE.BufferGeometry();
      for(const attribute of ['position', 'normal', 'uv']){
        const attributes = geometries.map(g => g.getAttribute(attribute));
        const merged = new Float32Array(attributes.reduce((sum, a) => sum + a.array.length, 0));
        let offset = 0;
        attributes.forEach(a => { merged.set(a.array, offset); offset += a.array.length; });
        geometry.setAttribute(attribute, new THREE.BufferAttribute(merged, attributes[0].itemSize));
      }
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();
      geometries.forEach(g => g.dispose());
      const mesh = part(parent, geometry, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.baseHex = mat.color.getHex();
    }
  }

  function worker(variant){
    const root = new THREE.Group();
    const dark = material([0x303c4d, 0x443f42, 0x283e49][variant]);
    const shoes = material(0x172129, 0.42);
    const shirt = material([0xc5dfeb, 0xf0e7d6, 0xa6c5d6][variant]);
    const white = material(0xf5efe2);
    const skin = material([0xddad88, 0xc38b66, 0xe2ba99][variant]);
    const accent = material([0x207c80, 0xac5c48, 0x607d50][variant]);
    const body = group(root, 'unit-body');

    // 衬衫有收腰、肩部、卷袖、开领与松领带，不再使用三块积木表示上班族。
    torso(body, shirt, [[0, 0.77], [0.22, 0.78], [0.25, 0.97], [0.285, 1.30], [0.26, 1.43], [0.13, 1.49], [0, 1.49]], 0.67);
    box(body, dark, [0, 0.80, 0], [0.46, 0.095, 0.30]);
    box(body, accent, [0, 0.80, 0.16], [0.07, 0.07, 0.025]);
    cylinder(body, skin, [0, 1.49, 0], [0.10, 0.10], 0.14);
    panel(body, white, [[-0.17, 1.46], [-0.07, 1.32], [0, 1.40], [-0.055, 1.49]], 0.11);
    panel(body, white, [[0.17, 1.46], [0.07, 1.32], [0, 1.40], [0.055, 1.49]], 0.11);
    panel(body, accent, [[-0.04, 1.36], [-0.045, 1.29], [-0.017, 1.27], [-0.065, 1.05], [-0.015, 1.00], [0.033, 1.05], [0.012, 1.28], [0.028, 1.32]], 0.185);
    // 斜挂工牌的轮廓在游戏镜头下仍可辨认。
    rod(body, accent, [0.16, 1.41, 0.12], [0.115, 1.19, 0.188], 0.009, 6);
    box(body, accent, [0.125, 1.16, 0.187], [0.14, 0.19, 0.025], [0, 0, -0.10]);
    box(body, white, [0.127, 1.16, 0.205], [0.10, 0.15, 0.012], [0, 0, -0.10]);
    box(body, dark, [0.11, 1.183, 0.215], [0.037, 0.046, 0.009]);
    box(body, accent, [0.138, 1.125, 0.215], [0.045, 0.011, 0.009]);

    const head = group(body, 'unit-head', [0, 1.74, 0]);
    oval(head, skin, [0, 0, 0], [0.215, 0.25, 0.20]);
    for(const side of [-1, 1]){
      oval(head, skin, [side * 0.211, -0.01, 0], [0.034, 0.062, 0.046]);
      oval(head, dark, [side * 0.078, 0.018, 0.183], [0.019, 0.023, 0.012]);
      box(head, dark, [side * 0.08, 0.065, 0.182], [0.062, 0.016, 0.014], [0, 0, side * 0.10]);
    }
    oval(head, skin, [0, -0.035, 0.205], [0.035, 0.042, 0.028]);
    box(head, dark, [0, -0.097, 0.177], [0.070, 0.011, 0.012]);
    part(head, new THREE.SphereGeometry(1, 14, 7, 0, TAU, 0, 1.34), dark, [0, 0.015, -0.006], [0.225, 0.255, 0.214], [0, 0, -0.11]);
    oval(head, dark, [-0.085, 0.145, 0.14], [0.15, 0.07, 0.08], [0, 0, -0.25]);
    if(variant === 1){
      for(const x of [-0.078, 0.078]){
        box(head, dark, [x, 0.027, 0.196], [0.12, 0.013, 0.015]);
        box(head, dark, [x, -0.028, 0.196], [0.12, 0.013, 0.015]);
        for(const edge of [-0.055, 0.055]) box(head, dark, [x + edge, 0, 0.196], [0.012, 0.06, 0.015]);
      }
      box(head, dark, [0, 0.02, 0.205], [0.035, 0.015, 0.015]);
    }

    for(const side of [-1, 1]){
      const leg = group(root, side < 0 ? 'unit-left-leg' : 'unit-right-leg', [side * 0.125, 0.78, 0]);
      cylinder(leg, dark, [0, -0.305, 0], [0.105, 0.088], 0.61, null, 10);
      oval(leg, shoes, [0, -0.69, 0.052], [0.108, 0.09, 0.19]);
      const arm = group(body, side < 0 ? 'unit-left-arm' : 'unit-right-arm', [side * 0.29, 1.39, 0]);
      oval(arm, shirt, [side * 0.037, -0.14, 0], [0.095, 0.185, 0.105], [0, 0, side * 0.12]);
      cylinder(arm, shirt, [side * 0.055, -0.29, 0], [0.090, 0.083], 0.065, null, 10);
      oval(arm, skin, [side * 0.060, -0.375, 0.012], [0.066, 0.12, 0.066]);
      oval(arm, skin, [side * 0.06, -0.493, 0.02], [0.067, 0.082, 0.063]);
      if(side === 1){
        // 公文包与提包手臂同骨骼，不为小配饰增加独立 draw call。
        rod(arm, dark, [0.00, -0.60, 0.02], [0.00, -0.51, 0.02], 0.015);
        rod(arm, dark, [0.00, -0.51, 0.02], [0.12, -0.51, 0.02], 0.015);
        rod(arm, dark, [0.12, -0.51, 0.02], [0.12, -0.60, 0.02], 0.015);
        box(arm, dark, [0.06, -0.70, 0.02], [0.36, 0.27, 0.11]);
      }
    }
    return root;
  }

  function tank(){
    const root = new THREE.Group();
    const body = group(root, 'unit-body');
    const armor = material(0x6b8060);
    const edge = material(0x91a075);
    const dark = material(0x222c30, 0.87);
    const steel = material(0x4b5960, 0.48, 0.35);
    const lamp = material(0xe9d5a0, 0.30);
    // 双履带、轮组和挡泥板形成清晰的横向宽体轮廓。
    box(body, armor, [0, 0.38, 0], [1.12, 0.35, 1.52]);
    box(body, armor, [0, 0.52, 0.15], [1.20, 0.16, 1.30], [0.06, 0, 0]);
    for(const side of [-1, 1]){
      box(body, dark, [side * 0.67, 0.255, 0], [0.30, 0.43, 1.62]);
      for(let i = 0; i < 5; i++){
        cylinder(body, steel, [side * 0.833, 0.25, -0.59 + i * 0.295], [0.152, 0.152], 0.032, [0, 0, Math.PI / 2]);
        cylinder(body, dark, [side * 0.854, 0.25, -0.59 + i * 0.295], [0.052, 0.052], 0.032, [0, 0, Math.PI / 2]);
      }
      for(let i = 0; i < 11; i++){
        box(body, steel, [side * 0.67, 0.477, -0.76 + i * 0.15], [0.305, 0.026, 0.046]);
        box(body, steel, [side * 0.67, 0.031, -0.76 + i * 0.15], [0.305, 0.026, 0.046]);
      }
      box(body, edge, [side * 0.66, 0.52, 0], [0.37, 0.05, 1.73]);
      box(body, dark, [side * 0.40, 0.44, 0.785], [0.20, 0.13, 0.05]);
      box(body, lamp, [side * 0.40, 0.45, 0.816], [0.13, 0.074, 0.024]);
    }
    for(let i = 0; i < 5; i++) box(body, dark, [-0.28 + i * 0.14, 0.615, -0.57], [0.055, 0.025, 0.25]);
    const turret = group(body, 'unit-turret', [0, 0.59, -0.07]);
    cylinder(turret, dark, [0, 0, 0], [0.39, 0.39], 0.10);
    torso(turret, armor, [[0, 0.01], [0.44, 0.02], [0.38, 0.25], [0.30, 0.31], [0, 0.31]], 0.98);
    cylinder(turret, edge, [0, 0.335, -0.09], [0.18, 0.18], 0.035);
    box(turret, steel, [0, 0.20, 0.40], [0.27, 0.22, 0.24]);
    cylinder(turret, armor, [0, 0.20, 0.88], [0.071, 0.096], 0.88, [Math.PI / 2, 0, 0]);
    cylinder(turret, steel, [0, 0.20, 1.34], [0.103, 0.103], 0.13, [Math.PI / 2, 0, 0]);
    cylinder(turret, dark, [0, 0.20, 1.412], [0.067, 0.067], 0.006, [Math.PI / 2, 0, 0]);
    rod(turret, dark, [-0.24, 0.22, -0.24], [-0.24, 0.78, -0.28], 0.012, 6);
    return root;
  }

  function helicopter(){
    const root = new THREE.Group();
    const body = group(root, 'unit-body');
    const shell = material(0x657a87, 0.55, 0.18);
    const glass = material(0x79bbcc, 0.22, 0.32);
    const dark = material(0x28343c, 0.48);
    const edge = material(0xc4cfbd, 0.48, 0.2);
    const light = material(0xebad68, 0.35);
    oval(body, shell, [0, 0, 0.12], [0.40, 0.33, 0.70]);
    oval(body, glass, [0, 0.06, 0.49], [0.36, 0.26, 0.40]);
    rod(body, dark, [0, 0.31, 0.39], [0, -0.08, 0.865], 0.019);
    for(const side of [-1, 1]){
      rod(body, dark, [0, 0.31, 0.37], [side * 0.34, 0.065, 0.40], 0.024);
      box(body, glass, [side * 0.392, 0.07, 0.025], [0.014, 0.23, 0.25]);
      box(body, edge, [side * 0.397, -0.10, -0.025], [0.02, 0.022, 0.10]);
      rod(body, dark, [side * 0.27, -0.20, 0.30], [side * 0.49, -0.47, 0.35], 0.030);
      rod(body, dark, [side * 0.27, -0.20, -0.27], [side * 0.49, -0.47, -0.35], 0.030);
      rod(body, edge, [side * 0.49, -0.47, -0.65], [side * 0.49, -0.47, 0.64], 0.037);
      rod(body, edge, [side * 0.49, -0.47, 0.64], [side * 0.49, -0.38, 0.81], 0.037);
      cylinder(body, dark, [side * 0.34, -0.13, 0.57], [0.045, 0.045], 0.34, [Math.PI / 2, 0, 0]);
    }
    cylinder(body, shell, [0, 0.06, -0.91], [0.085, 0.20], 1.04, [-Math.PI / 2, 0, 0]);
    box(body, edge, [0, 0.09, -1.31], [0.77, 0.045, 0.25], [0.10, 0, 0]);
    panel(body, shell, [[-0.02, 0.09], [-0.02, 0.59], [0.02, 0.59], [0.02, 0.09]], -1.52, 0.33);
    oval(body, light, [0, 0.59, -1.40], [0.055, 0.048, 0.055]);
    oval(body, shell, [0, 0.31, -0.12], [0.25, 0.16, 0.32]);
    cylinder(body, dark, [0, 0.48, -0.07], [0.045, 0.055], 0.31);
    const rotor = group(body, 'unit-rotor', [0, 0.65, -0.07]);
    for(let i = 0; i < 4; i++){
      const blade = group(rotor, 'blade-' + i);
      blade.rotation.y = i * Math.PI / 2;
      box(blade, dark, [0.76, 0, 0], [1.40, 0.026, 0.11], [0, 0, -0.018]);
      box(blade, edge, [1.40, -0.013, 0], [0.14, 0.027, 0.11]);
    }
    // 将叶片静态变换烘焙到同一旋翼骨骼，四片共 2 个 Mesh。
    rotor.children.slice().forEach(blade => {
      blade.updateMatrix();
      [...blade.children].forEach(mesh => { mesh.updateMatrix(); mesh.applyMatrix4(blade.matrix); rotor.add(mesh); });
      rotor.remove(blade);
    });
    const tail = group(body, 'unit-tail-rotor', [0.095, 0.30, -1.39]);
    for(const angle of [0, Math.PI / 2]) box(tail, dark, [0, 0, 0], [0.030, 0.55, 0.055], [angle, 0, 0]);
    cylinder(tail, edge, [0.024, 0, 0], [0.060, 0.060], 0.05, [0, 0, Math.PI / 2]);
    return root;
  }

  function hero(){
    const root = new THREE.Group();
    const suit = material(0x378b59);
    const capeMat = material(0x235a42);
    capeMat.side = THREE.DoubleSide;
    const dark = material(0x193b32, 0.53);
    const trim = material(0xc6b869, 0.42, 0.2);
    const skin = material(0xd7ae85);
    const weak = material(0xf5a160, 0.38);
    weak.emissive.setHex(0xee7039);
    weak.emissiveIntensity = 0.35;
    const body = group(root, 'unit-body');
    torso(body, suit, [[0, 0.63], [0.25, 0.64], [0.25, 0.84], [0.36, 1.12], [0.32, 1.27], [0.15, 1.35], [0, 1.35]], 0.62);
    cylinder(body, trim, [0, 0.71, 0], [0.27, 0.26], 0.074, null, 14).scale.z = 0.64;
    oval(body, trim, [0, 1.095, 0.216], [0.14, 0.15, 0.025]);
    panel(body, dark, [[0.035, 1.21], [-0.065, 1.08], [0.005, 1.08], [-0.035, 0.98], [0.073, 1.12], [0.010, 1.12]], 0.242);
    cylinder(body, skin, [0, 1.37, 0], [0.095, 0.10], 0.15);
    const head = group(body, 'unit-head', [0, 1.54, 0]);
    oval(head, skin, [0, 0, 0], [0.21, 0.23, 0.19]);
    part(head, new THREE.SphereGeometry(1, 14, 7, 0, TAU, 0, 1.58), dark, [0, 0.02, -0.015], [0.222, 0.24, 0.207]);
    box(head, suit, [0, 0.01, 0.169], [0.36, 0.13, 0.055]);
    for(const side of [-1, 1]){
      oval(head, skin, [side * 0.075, 0.02, 0.202], [0.040, 0.022, 0.012]);
      box(head, dark, [side * 0.075, 0.022, 0.214], [0.012, 0.026, 0.009]);
    }
    box(head, dark, [0, -0.11, 0.165], [0.065, 0.018, 0.015]);
    for(const side of [-1, 1]){
      const leg = group(root, side < 0 ? 'unit-left-leg' : 'unit-right-leg', [side * 0.14, 0.69, 0]);
      oval(leg, suit, [0, -0.23, 0], [0.12, 0.28, 0.12]);
      cylinder(leg, dark, [0, -0.46, 0], [0.116, 0.10], 0.24);
      oval(leg, dark, [0, -0.605, 0.058], [0.123, 0.085, 0.20]);
      const arm = group(body, side < 0 ? 'unit-left-arm' : 'unit-right-arm', [side * 0.32, 1.23, 0]);
      oval(arm, suit, [side * 0.055, -0.19, 0], [0.13, 0.245, 0.13], [0, 0, side * 0.15]);
      oval(arm, dark, [side * 0.11, -0.41, 0.025], [0.09, 0.145, 0.095]);
    }
    const cape = group(body, 'unit-cape', [0, 1.29, -0.20]);
    const geo = new THREE.BufferGeometry();
    const positions = [], uvs = [], indices = [];
    const rows = 5, columns = 8;
    for(let y = 0; y <= rows; y++){
      const t = y / rows;
      for(let x = 0; x <= columns; x++){
        const u = x / columns, across = u * 2 - 1;
        positions.push(across * (0.32 + t * 0.19), -t * 0.94, -t * 0.23 - Math.cos(across * Math.PI * 3) * 0.026 * t);
        uvs.push(u, t);
        if(y && x < columns){ const a = y * (columns + 1) + x, b = a - columns - 1; indices.push(b, a, b + 1, b + 1, a, a + 1); }
      }
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices); geo.computeVertexNormals();
    part(cape, geo, capeMat);
    // 背部弱点是明亮排气芯，完全朝后；与绕后五倍暴击的方向保持一致。
    const weakness = group(body, 'unit-weakness', [0, 0.98, -0.38]);
    part(weakness, new THREE.TorusGeometry(0.145, 0.035, 8, 16), trim);
    oval(weakness, weak, [0, 0, -0.018], [0.12, 0.12, 0.029]);
    for(const x of [-0.052, 0, 0.052]) box(weakness, dark, [x, 0, -0.051], [0.012, 0.16, 0.015]);
    return root;
  }

  function create(type, {variant = 0} = {}){
    if(!['soldier', 'tank', 'helicopter', 'fartHero'].includes(type)) throw new Error('Unsupported unit type: ' + type);
    variant = Number.isFinite(variant) ? ((Math.trunc(variant) % 3) + 3) % 3 : 0;
    const key = type + ':' + (type === 'soldier' ? variant : 0);
    if(!templates.has(key)){
      const template = type === 'soldier' ? worker(variant) : type === 'tank' ? tank() : type === 'helicopter' ? helicopter() : hero();
      template.name = 'unit-' + type;
      template.userData.unitType = type;
      batch(template);
      templates.set(key, template);
    }
    const root = templates.get(key).clone(true);
    const materials = new Map();
    root.traverse(mesh => {
      if(!mesh.isMesh) return;
      if(!materials.has(mesh.material)) materials.set(mesh.material, mesh.material.clone());
      mesh.material = materials.get(mesh.material);
    });
    root.userData.rig = {};
    for(const name of ['body', 'head', 'left-leg', 'right-leg', 'left-arm', 'right-arm', 'turret', 'rotor', 'tail-rotor', 'cape', 'weakness']){
      root.userData.rig[name] = root.getObjectByName('unit-' + name);
    }
    animate(root, {time:0});
    return root;
  }

  function animate(root, {time = 0, moving = false, cheering = false, panic = false} = {}){
    const rig = root.userData.rig;
    if(!rig) return;
    const type = root.userData.unitType;
    const motion = typeof moving === 'number' ? Math.max(0, Math.min(1, moving)) : moving ? 1 : 0;
    const cheer = typeof cheering === 'number' ? Math.max(0, Math.min(1, cheering)) : cheering ? 1 : 0;
    const pace = panic ? 12.5 : 7.5;
    const step = Math.sin(time * pace) * motion;
    if(type === 'soldier' || type === 'fartHero'){
      rig.body.position.y = Math.abs(Math.sin(time * pace)) * motion * 0.018 + Math.sin(time * 2.2) * 0.005;
      rig.body.rotation.x = panic ? 0.11 * motion : 0.025 * motion;
      rig['left-leg'].rotation.x = step * (panic ? 0.57 : 0.38);
      rig['right-leg'].rotation.x = -step * (panic ? 0.57 : 0.38);
      rig['left-arm'].rotation.x = -step * 0.32 - cheer * (2.50 + Math.sin(time * 9) * 0.16);
      rig['left-arm'].rotation.z = cheer * 0.48;
      rig['right-arm'].rotation.x = step * 0.22;
      rig['right-arm'].rotation.z = -0.06;
      rig.head.rotation.set(-cheer * 0.09, Math.sin(time * 0.8) * 0.06 * (1 - motion), 0);
      if(rig.cape){
        rig.cape.rotation.x = 0.04 + Math.sin(time * 3.5) * 0.03 + motion * 0.10;
        rig.cape.rotation.z = Math.sin(time * 2) * 0.03;
      }
    }else if(type === 'helicopter'){
      rig.rotor.rotation.y = time * 35;
      rig['tail-rotor'].rotation.x = time * 48;
      rig.body.rotation.x = motion * 0.05 + Math.sin(time * 1.8) * 0.025;
      rig.body.rotation.z = Math.sin(time * 1.4) * 0.025;
    }else if(type === 'tank'){
      rig.body.position.y = Math.sin(time * 19) * motion * 0.007;
      rig.body.rotation.x = Math.sin(time * 13) * motion * 0.007;
    }
  }

  function dispose(root){
    if(root.userData.unitDisposed) return;
    const materials = new Set();
    root.traverse(mesh => { if(mesh.isMesh) materials.add(mesh.material); });
    materials.forEach(mat => mat.dispose());
    root.userData.unitDisposed = true;
    // 不 dispose 共享几何；下一波、重新开局和其他实例继续使用同一模板。
  }

  return {create, animate, dispose};
})();
