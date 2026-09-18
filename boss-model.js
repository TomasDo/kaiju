// 西装老板：程序化角色、分组动画和资源复用。保持本地脚本，支持 file:// 离线打开。
const BossVisual = (() => {
  let template;

  function material(color, roughness = 0.65, metalness = 0){
    return new THREE.MeshStandardMaterial({ color, roughness, metalness });
  }

  function part(parent, geometry, mat, position, scale, rotation){
    const mesh = new THREE.Mesh(geometry, mat);
    if(position) mesh.position.fromArray(position);
    if(scale) mesh.scale.fromArray(scale);
    if(rotation) mesh.rotation.set(...rotation);
    parent.add(mesh);
    return mesh;
  }

  function oval(parent, mat, position, scale, rotation){
    return part(parent, new THREE.SphereGeometry(1, 20, 12), mat, position, scale, rotation);
  }

  function roundedBox(width, height, depth, radius = 0.02){
    const x = -width / 2, y = -height / 2;
    const r = Math.min(radius, width / 2, height / 2, depth / 2);
    const s = new THREE.Shape();
    s.moveTo(x + r, y);
    s.lineTo(x + width - r, y);
    s.quadraticCurveTo(x + width, y, x + width, y + r);
    s.lineTo(x + width, y + height - r);
    s.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    s.lineTo(x + r, y + height);
    s.quadraticCurveTo(x, y + height, x, y + height - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: depth - r, bevelEnabled: true, bevelSegments: 2,
      steps: 1, bevelSize: r / 2, bevelThickness: r / 2, curveSegments: 5
    });
    geo.translate(0, 0, -(depth - r) / 2);
    geo.computeVertexNormals();
    return geo;
  }

  function box(parent, mat, position, size, radius, rotation){
    return part(parent, roundedBox(...size, radius), mat, position, null, rotation);
  }

  function curve(parent, mat, points, radius = 0.006, segments = 16){
    const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    return part(parent, new THREE.TubeGeometry(path, segments, radius, 6, false), mat);
  }

  function panel(parent, mat, points, depth = 0.012){
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach(p => shape.lineTo(p[0], p[1]));
    shape.closePath();
    return part(parent, new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.003,
      bevelThickness: 0.003, steps: 1
    }), mat, [0, 0, points[0][2]]);
  }

  // 连续截面塑形，避免圆柱躯干和球形脸带来的积木感。
  function volume(parent, mat, rings, segments = 32){
    const positions = [], uvs = [], indices = [];
    rings.forEach(([y, rx, rz, z = 0], row) => {
      for(let i = 0; i <= segments; i++){
        const a = i / segments * Math.PI * 2;
        positions.push(Math.sin(a) * rx, y, Math.cos(a) * rz + z);
        uvs.push(i / segments, row / (rings.length - 1));
        if(row && i < segments){
          const b = row * (segments + 1) + i, a0 = b - segments - 1;
          indices.push(a0, a0 + 1, b, b, a0 + 1, b + 1);
        }
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return part(parent, geometry, mat);
  }

  function makeFabric(){
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f0f2f7';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#bcc6d5';
    for(let x = 0; x < 128; x += 16) ctx.fillRect(x, 0, 1, 128);
    ctx.fillStyle = 'rgba(55,65,80,0.07)';
    for(let y = 0; y < 128; y += 4) ctx.fillRect(0, y, 128, 1);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 2);
    return texture;
  }

  function hairCap(){
    const positions = [], uvs = [], indices = [];
    const rows = 18, segments = 40;
    for(let row = 0; row <= rows; row++){
      for(let i = 0; i <= segments; i++){
        const a = i / segments * Math.PI * 2;
        // 额头露出，后脑与两鬓覆盖到耳后，发际线不是齐平半球。
        const end = 1.12 + (1 - Math.cos(a)) * 0.56;
        const t = row / rows * end;
        positions.push(Math.sin(a) * Math.sin(t) * 0.246 - Math.max(0, Math.cos(t)) * 0.012,
          0.311 + Math.cos(t) * 0.264, -0.016 + Math.cos(a) * Math.sin(t) * 0.207);
        uvs.push(i / segments, row / rows);
        if(row && i < segments){
          const b = row * (segments + 1) + i, p = b - segments - 1;
          indices.push(p, b, p + 1, b, b + 1, p + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  // 每个骨骼内按材质合批；细节数量不直接变成每帧的绘制调用数量。
  function batch(group){
    const buckets = new Map();
    for(const child of [...group.children]){
      if(!child.isMesh){ batch(child); continue; }
      child.updateMatrix();
      const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
      geometry.applyMatrix4(child.matrix);
      if(!buckets.has(child.material)) buckets.set(child.material, []);
      buckets.get(child.material).push(geometry);
      child.geometry.dispose();
      group.remove(child);
    }
    for(const [mat, geometries] of buckets){
      const merged = new THREE.BufferGeometry();
      for(const name of ['position', 'normal', 'uv']){
        const arrays = geometries.map(g => g.getAttribute(name));
        const data = new Float32Array(arrays.reduce((n, a) => n + a.array.length, 0));
        let offset = 0;
        arrays.forEach(a => { data.set(a.array, offset); offset += a.array.length; });
        merged.setAttribute(name, new THREE.BufferAttribute(data, arrays[0].itemSize));
      }
      merged.computeBoundingSphere();
      geometries.forEach(g => g.dispose());
      const mesh = part(group, merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.baseHex = mat.color.getHex();
    }
  }

  function build(){
    const root = new THREE.Group();
    root.name = 'executive-boss';
    root.userData.bossModel = true;
    const suit = material(0x35465f, 0.88);
    suit.map = makeFabric();
    const lapel = material(0x22314a, 0.43);
    const seam = material(0x60718a, 0.82);
    const shirt = material(0xf2e9dc, 0.76);
    const tie = material(0x9b293e, 0.4);
    const skin = material(0xd9a07c, 0.72);
    const blush = material(0xb77660, 0.82);
    const hair = material(0x28252a, 0.58);
    const hairLight = material(0x423b42, 0.6);
    const dark = material(0x161b24, 0.28);
    const gold = material(0xd7aa55, 0.28, 0.65);
    const leather = material(0x703f2d, 0.66);
    const leatherEdge = material(0x372923, 0.5);

    // 鞋底落在 y = 0，裤缝与鞋面高光分开塑形。
    for(const side of [-1, 1]){
      const x = side * 0.155;
      oval(root, suit, [x, 0.29, -0.01], [0.116, 0.25, 0.12]);
      curve(root, seam, [[x, 0.13, 0.109], [x, 0.28, 0.116], [x, 0.43, 0.102]], 0.0035);
      box(root, dark, [x, 0.032, 0.065], [0.245, 0.044, 0.35], 0.02);
      oval(root, dark, [x, 0.08, 0.07], [0.123, 0.076, 0.187]);
      curve(root, lapel, [[x - 0.095, 0.094, 0.15], [x, 0.123, 0.185], [x + 0.095, 0.094, 0.15]], 0.004);
    }

    const body = new THREE.Group();
    body.name = 'boss-body';
    root.add(body);
    volume(body, suit, [
      [0.43, 0.02, 0.03], [0.44, 0.29, 0.18], [0.50, 0.32, 0.19],
      [0.65, 0.305, 0.205], [0.82, 0.315, 0.19], [0.97, 0.37, 0.155],
      [1.035, 0.29, 0.135], [1.055, 0.16, 0.105], [1.06, 0.015, 0.025]
    ]);
    oval(body, skin, [0, 1.075, 0], [0.105, 0.14, 0.095]);
    panel(body, shirt, [[-0.15, 1.033, 0.176], [0.15, 1.033], [0.06, 0.69], [-0.075, 0.69]]);
    panel(body, lapel, [[-0.17, 1.04, 0.201], [-0.29, 0.93], [-0.215, 0.86], [-0.26, 0.81], [0.04, 0.60], [-0.065, 0.93]]);
    panel(body, lapel, [[0.17, 1.04, 0.209], [0.29, 0.93], [0.215, 0.86], [0.26, 0.81], [-0.015, 0.62], [0.06, 0.94]]);
    curve(body, seam, [[-0.165, 1.031, 0.221], [-0.075, 0.87, 0.223], [0.026, 0.632, 0.221]], 0.0035);
    curve(body, seam, [[0.163, 1.031, 0.229], [0.069, 0.864, 0.231], [-0.013, 0.645, 0.23]], 0.0035);
    panel(body, shirt, [[-0.10, 1.053, 0.23], [-0.015, 1.017], [-0.06, 0.947], [-0.145, 1.013]]);
    panel(body, shirt, [[0.10, 1.053, 0.232], [0.015, 1.017], [0.06, 0.947], [0.145, 1.013]]);
    box(body, tie, [0, 0.987, 0.245], [0.062, 0.063, 0.035], 0.01, [0, 0, 0.10]);
    panel(body, tie, [[-0.022, 0.961, 0.24], [0.023, 0.961], [0.046, 0.779], [0.004, 0.733], [-0.04, 0.779]]);
    box(body, gold, [0, 0.865, 0.261], [0.071, 0.012, 0.012], 0.003);
    for(const y of [0.64, 0.535]) for(const x of [-0.105, 0.105]){
      oval(body, gold, [x, y, 0.203], [0.014, 0.014, 0.008]);
    }
    box(body, lapel, [0.232, 0.882, 0.17], [0.105, 0.024, 0.022], 0.004);
    panel(body, shirt, [[0.187, 0.894, 0.174], [0.21, 0.932], [0.23, 0.902], [0.256, 0.924], [0.277, 0.894]]);
    oval(body, gold, [-0.207, 0.953, 0.224], [0.016, 0.021, 0.009]);
    for(const side of [-1, 1]) box(body, lapel, [side * 0.238, 0.592, 0.156], [0.115, 0.033, 0.02], 0.008, [0, side * 0.25, side * -0.06]);
    curve(body, seam, [[0, 0.49, -0.195], [0, 0.73, -0.2], [0, 1.01, -0.149]], 0.003);

    // 大下颌、鼻梁、眼袋与眉弓：在俯视游戏镜头下保留严厉表情。
    const head = new THREE.Group();
    head.name = 'boss-head';
    head.position.set(0, 1.06, 0);
    body.add(head);
    volume(head, skin, [
      [0.01, 0.07, 0.08, 0.025], [0.05, 0.155, 0.14, 0.035],
      [0.13, 0.205, 0.177, 0.024], [0.25, 0.236, 0.188, 0.007],
      [0.37, 0.229, 0.179, -0.006], [0.46, 0.19, 0.148, -0.017],
      [0.50, 0.09, 0.08, -0.02], [0.51, 0.006, 0.01, -0.02]
    ]);
    oval(head, skin, [0, 0.105, 0.17], [0.115, 0.047, 0.04]);
    for(const side of [-1, 1]){
      oval(head, skin, [side * 0.229, 0.26, -0.006], [0.044, 0.07, 0.036]);
      oval(head, blush, [side * 0.254, 0.26, 0.011], [0.013, 0.041, 0.018]);
      oval(head, skin, [side * 0.132, 0.202, 0.159], [0.081, 0.048, 0.027]);
      oval(head, blush, [side * 0.103, 0.277, 0.18], [0.067, 0.025, 0.019]);
      oval(head, shirt, [side * 0.098, 0.312, 0.185], [0.064, 0.031, 0.024]);
      oval(head, dark, [side * 0.089, 0.31, 0.21], [0.016, 0.021, 0.009]);
      oval(head, shirt, [side * 0.089 - 0.004, 0.319, 0.218], [0.004, 0.005, 0.003]);
      oval(head, skin, [side * 0.105, 0.352, 0.176], [0.086, 0.038, 0.044], [0, 0, side * 0.16]);
      curve(head, hair, [[side * 0.036, 0.355, 0.209], [side * 0.091, 0.376, 0.209], [side * 0.16, 0.372, 0.181]], 0.014);
      curve(head, blush, [[side * 0.051, 0.217, 0.227], [side * 0.075, 0.18, 0.217], [side * 0.10, 0.154, 0.2]], 0.004);
    }
    oval(head, skin, [0, 0.294, 0.203], [0.035, 0.069, 0.044]);
    oval(head, skin, [0, 0.251, 0.249], [0.049, 0.039, 0.043]);
    for(const side of [-1, 1]) oval(head, blush, [side * 0.028, 0.235, 0.273], [0.011, 0.007, 0.007]);
    curve(head, blush, [[-0.079, 0.157, 0.204], [-0.03, 0.168, 0.23], [0.035, 0.16, 0.229], [0.077, 0.148, 0.211]], 0.009);
    curve(head, skin, [[-0.063, 0.146, 0.211], [0, 0.143, 0.234], [0.06, 0.14, 0.217]], 0.008);
    const jaw = new THREE.Group();
    jaw.name = 'boss-mouth';
    jaw.position.set(0, 0.155, 0.226);
    head.add(jaw);
    oval(jaw, dark, [0, 0, 0], [0.056, 0.026, 0.01]);
    box(jaw, shirt, [0, 0.012, 0.008], [0.077, 0.012, 0.008], 0.003);

    // 连续后梳发壳 + 少量成束发脊，比互相叠球更清晰。
    part(head, hairCap(), hair);
    const hairPoint = (x, z) => {
      const a = 1 + Math.pow(0.012 / 0.246, 2);
      const b = 2 * x * 0.012 / Math.pow(0.246, 2);
      const c = Math.pow(x / 0.246, 2) + Math.pow((z + 0.016) / 0.207, 2) - 1;
      const height = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
      return [x, 0.3115 + 0.264 * height, z];
    };
    for(let i = 0; i < 8; i++){
      const x = -0.167 + i * 0.033;
      const points = Array.from({length:17}, (_, n) => {
        const t = n / 16;
        return hairPoint(x + 0.046 * Math.sin(t * Math.PI * 0.85), 0.135 - t * 0.265);
      });
      curve(head, hairLight, points, 0.0026, 28);
    }
    curve(head, dark, Array.from({length:17}, (_, n) => {
      const t = n / 16;
      return hairPoint(0.128 + 0.035 * Math.sin(t * Math.PI), 0.131 - t * 0.26);
    }), 0.004, 28);
    for(const side of [-1, 1]){
      oval(head, hair, [side * 0.219, 0.316, -0.035], [0.022, 0.073, 0.078]);
      curve(head, hairLight, [[side * 0.237, 0.373, -0.005], [side * 0.24, 0.335, -0.064], [side * 0.218, 0.303, -0.12]], 0.0035);
    }

    // 方形金属眼镜不遮挡眼睛，保留金色鼻梁和侧镜腿。
    for(const side of [-1, 1]){
      const x = side * 0.104;
      curve(head, dark, [[x - 0.077, 0.341, 0.221], [x, 0.351, 0.234], [x + 0.071, 0.337, 0.218]], 0.010);
      curve(head, gold, [[x - 0.077, 0.339, 0.221], [x - 0.07, 0.285, 0.222], [x + 0.059, 0.285, 0.221], [x + 0.071, 0.337, 0.218]], 0.005);
      curve(head, gold, [[side * 0.177, 0.33, 0.219], [side * 0.232, 0.33, 0.11], [side * 0.243, 0.305, -0.021]], 0.005);
    }
    curve(head, gold, [[-0.032, 0.323, 0.233], [0, 0.335, 0.249], [0.032, 0.323, 0.233]], 0.006);

    // 右手抬起指责，左手提公文包；动画围绕肩部转动。
    const pointArm = new THREE.Group();
    pointArm.name = 'boss-point-arm';
    pointArm.position.set(-0.325, 0.955, 0);
    body.add(pointArm);
    oval(pointArm, suit, [-0.065, -0.13, 0.013], [0.106, 0.193, 0.105], [0, 0, -0.27]);
    oval(pointArm, suit, [-0.115, -0.258, 0.113], [0.084, 0.093, 0.16], [-0.35, 0, 0]);
    box(pointArm, shirt, [-0.115, -0.213, 0.238], [0.138, 0.12, 0.061], 0.025, [-0.23, 0, 0]);
    box(pointArm, gold, [-0.182, -0.208, 0.24], [0.017, 0.026, 0.032], 0.007);
    oval(pointArm, skin, [-0.115, -0.193, 0.301], [0.076, 0.065, 0.085]);
    for(let i = 0; i < 3; i++) oval(pointArm, skin, [-0.151 + i * 0.036, -0.208, 0.362], [0.02, 0.039, 0.034]);
    curve(pointArm, skin, [[-0.153, -0.159, 0.332], [-0.161, -0.129, 0.42], [-0.17, -0.11, 0.503]], 0.022);
    oval(pointArm, skin, [-0.17, -0.11, 0.503], [0.023, 0.023, 0.026]);
    oval(pointArm, skin, [-0.052, -0.166, 0.325], [0.025, 0.047, 0.028], [0.4, 0, -0.3]);

    const bagArm = new THREE.Group();
    bagArm.name = 'boss-bag-arm';
    bagArm.position.set(0.335, 0.956, 0);
    body.add(bagArm);
    oval(bagArm, suit, [0.056, -0.207, -0.01], [0.102, 0.238, 0.1], [0, 0, 0.13]);
    box(bagArm, shirt, [0.085, -0.416, 0.013], [0.143, 0.058, 0.136], 0.021);
    oval(bagArm, gold, [0.103, -0.418, 0.08], [0.04, 0.032, 0.014]);
    oval(bagArm, dark, [0.103, -0.418, 0.093], [0.028, 0.024, 0.004]);
    curve(bagArm, gold, [[0.089, -0.406, 0.099], [0.103, -0.418, 0.099], [0.113, -0.415, 0.099]], 0.0025, 6);
    oval(bagArm, skin, [0.084, -0.482, 0.023], [0.064, 0.071, 0.063]);

    const bag = new THREE.Group();
    bag.name = 'boss-bag';
    bag.position.set(0.099, -0.575, 0.019);
    bagArm.add(bag);
    curve(bag, leatherEdge, [[-0.066, 0.001, 0], [-0.057, 0.098, 0], [0.057, 0.098, 0], [0.066, 0.001, 0]], 0.015);
    box(bag, leatherEdge, [0, -0.142, 0], [0.382, 0.275, 0.136], 0.026);
    box(bag, leather, [0, -0.138, 0.014], [0.362, 0.246, 0.137], 0.024);
    box(bag, leather, [0, -0.064, 0.083], [0.364, 0.087, 0.014], 0.011);
    curve(bag, gold, [[-0.169, -0.12, 0.087], [-0.169, -0.246, 0.087], [0.169, -0.246, 0.087], [0.169, -0.12, 0.087]], 0.0022);
    for(const x of [-0.115, 0.115]) box(bag, gold, [x, -0.096, 0.096], [0.041, 0.039, 0.019], 0.007);
    box(bag, gold, [0, -0.184, 0.087], [0.055, 0.02, 0.01], 0.003);
    batch(root);
    return root;
  }

  function create({fill = 0} = {}){
    if(!template) template = build();
    const root = template.clone(true);
    const materials = new Map();
    root.traverse(mesh => {
      if(!mesh.isMesh) return;
      const original = mesh.material;
      if(!materials.has(original)){
        const instance = original.clone();
        // 原游戏使用较低强度的光照，少量补色使远处的西装与五官保持可读。
        instance.emissive.copy(original.color);
        instance.emissiveIntensity = fill * (1 - original.metalness * 0.6);
        materials.set(original, instance);
      }
      mesh.material = materials.get(original);
    });
    // 几何体和纹理全角色共享；材质逐角色独立，受击变色不会影响其他老板。
    root.userData.rig = {
      body: root.getObjectByName('boss-body'), head: root.getObjectByName('boss-head'),
      mouth: root.getObjectByName('boss-mouth'), pointArm: root.getObjectByName('boss-point-arm'),
      bagArm: root.getObjectByName('boss-bag-arm'), bag: root.getObjectByName('boss-bag')
    };
    return root;
  }

  function animate(root, time, talk = 0, hit = 0){
    const rig = root.userData.rig;
    if(!rig) return;
    const breath = Math.sin(time * 2.2);
    rig.body.position.y = breath * 0.007;
    rig.body.rotation.x = talk * 0.025 - hit * 0.065;
    rig.head.rotation.set(-0.04 + breath * 0.018 - talk * 0.09, Math.sin(time * 0.9) * 0.055, -0.035 - talk * 0.045);
    rig.pointArm.rotation.set(-0.18 - talk * 0.8, -0.12 - talk * 0.15, -0.07 - talk * 0.14);
    rig.bagArm.rotation.set(Math.sin(time * 1.7) * 0.022, 0, -0.035);
    rig.bag.rotation.z = Math.sin(time * 1.7 - 0.5) * 0.045;
    rig.mouth.scale.y = 0.08 + talk * (0.55 + 0.45 * Math.abs(Math.sin(time * 19)));
  }

  function dispose(root){
    const materials = new Set();
    root.traverse(mesh => { if(mesh.isMesh) materials.add(mesh.material); });
    materials.forEach(mat => mat.dispose());
    // 共享模板的几何体和 CanvasTexture 保留，重开/刷新老板不重复上传。
  }

  return { create, animate, dispose };
})();
