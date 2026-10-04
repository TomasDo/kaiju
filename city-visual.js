// 程序化城市美术。Three.js r160 / 本地脚本；不依赖图片或网络。
// Cell 的根节点位于格子中心、地面 y=0，整体缩放 y 即可从地面倒塌。
// 一格一个 Mesh。模板几何、贴图和材质属于模块，disposeCell 不销毁共享资源。
const CityVisual = (() => {
  // 旧 createCell 调用仍保留最多 144 个模板；八款建筑另存于有限类型缓存。
  // 两套资源都只包含局部几何，不让随机地图世界坐标进入缓存。
  const geometryCache = new Map();
  const materials = new Map();
  const palettes = [
    ['#b9c3c5', '#e2e7df', '#697c85'], ['#c7bba6', '#e8dfcc', '#7d817d'],
    ['#9eafb6', '#d7e1e0', '#596d79'], ['#bdafa6', '#e6d7c9', '#716c6a'],
    ['#b6bcb1', '#e1e4d5', '#667a76'], ['#afbac5', '#dce3ec', '#5c708a'],
    ['#c2b7ac', '#eee5d7', '#887b71'], ['#a7b8bc', '#dce8e5', '#536e78']
  ];
  const atlas = {
    wall:[0,0,128,128], roof:[128,0,128,128], trim:[256,0,128,128], base:[384,0,128,128],
    window:[0,128,128,256], entrance:[128,128,128,256], store:[256,128,128,256],
    vent:[384,128,128,128], metal:[384,256,128,128]
  };
  const directions = [[0,-1],[1,0],[0,1],[-1,0]];
  // 每项是一栋完整建筑的设计；paletteId 只改变明度，不打乱建筑自身的配色。
  const catalog = Object.freeze([
    {id:0,name:'彩盒公寓',width:4,depth:6,colors:['#50C9B0','#FF8066','#FFF0CC'],description:'薄荷绿住区，珊瑚色错位阳台与独立入口；两端四层、中段三层。'},
    {id:1,name:'阶梯写字楼',width:6,depth:6,colors:['#3299D6','#24486B','#E9F5FF'],description:'三层裙房托起五层中央塔楼，蓝色连续玻璃与浅色竖向立柱。'},
    {id:2,name:'转角百货',width:6,depth:6,colors:['#9B68DB','#FFD05A','#FFF4DB'],description:'紫色 L 形三层商场，金色连续雨棚，内侧保留可以走入的庭院。'},
    {id:3,name:'爆米花影院',width:6,depth:4,colors:['#E85A58','#FFD789','#3F4358'],description:'珊瑚红两层影院，梯形门头、爆米花墙徽和成排海报橱窗。'},
    {id:4,name:'像素电玩中心',width:4,depth:4,colors:['#5F4CCB','#49DDE2','#FF6FA8'],description:'紫色二至四层像素阶梯，青粉色灯带和像素窗。'},
    {id:5,name:'糖果双塔酒店',width:6,depth:4,colors:['#F5A5BD','#FFE9BD','#5ABAB5'],description:'奶油粉双塔，五层窄塔由两层裙房相连，中间形成清晰凹口。'},
    {id:6,name:'钟塔商馆',width:5,depth:5,colors:['#EDA942','#397C89','#FFF0D0'],description:'金黄色两层基座与五层中央钟塔，四面大钟盘和层叠檐口。'},
    {id:7,name:'积木仓库',width:6,depth:4,colors:['#D98558','#4E7086','#D9E3DB'],description:'砖橙色低层长楼，锯齿女儿墙、宽卷帘门和后排通风设备。'}
  ].map(item=>Object.freeze({...item,colors:Object.freeze(item.colors)})));
  const typedGeometryCache = new Map(), typedMaterials = new Map(), typedTextures = new Map();
  const typedAtlas = {icon:[0,384,128,128],sign:[128,384,256,64],poster:[384,384,128,128],neon:[128,448,128,64],shutter:[266,194,108,179]};
  let neonTexture=null;
  Object.assign(atlas,typedAtlas);
  const modulo=(n,m)=>((n%m)+m)%m;

  function createBuilding({id=0,typeId=0,x=0,y=0,orientation=0,paletteId=1}={}){
    typeId=modulo(Math.floor(typeId),catalog.length);
    orientation=modulo(Math.floor(orientation),4);
    paletteId=Math.max(0,Math.min(2,Math.floor(paletteId)));
    const type=catalog[typeId], width=orientation%2?type.depth:type.width, depth=orientation%2?type.width:type.depth;
    const cells=[];
    for(let ly=0;ly<type.depth;ly++) for(let lx=0;lx<type.width;lx++){
      if(typeId===2&&lx>=3&&ly>=3) continue;
      let floors=3;
      if(typeId===0) floors=ly===0||ly===type.depth-1?4:3;
      if(typeId===1) floors=lx>=1&&lx<=4&&ly>=1&&ly<=4?5:3;
      if(typeId===3||typeId===7) floors=2;
      if(typeId===4) floors=2+Math.min(2,Math.floor((lx+ly)/2));
      if(typeId===5) floors=(lx<2||lx>=4)&&ly>=1?5:2;
      if(typeId===6) floors=lx>=1&&lx<=3&&ly>=1&&ly<=3?5:2;
      const equipment=typeId===7&&ly===type.depth-1&&lx%2===1?1:0;
      const roofWalkable=typeId!==4&&!equipment;
      const positions=[[lx,ly],[type.depth-1-ly,lx],[type.width-1-lx,type.depth-1-ly],[ly,type.width-1-lx]];
      const [rx,ry]=positions[orientation];
      cells.push({buildingId:id,typeId,paletteId,orientation,x:x+rx,y:y+ry,lx,ly,floors,roofWalkable,equipment});
    }
    return {id,typeId,name:type.name,x,y,width,depth,orientation,paletteId,cells};
  }

  // 先安排完整地块，再选择城市分区中的建筑。中心出生区域从地块层面避让。
  function generateLayout({mapSize=72,blockStep=11,random=Math.random,spawnRect={minX:31,maxX:41,minY:31,maxY:41}}={}){
    const slots=[], lookup=new Map(), buildings=[], cells=Array(mapSize*mapSize).fill(null);
    const pick=n=>Math.min(n-1,Math.max(0,Math.floor(random()*n)));
    for(let gy=0;gy*blockStep+9<mapSize;gy++) for(let gx=0;gx*blockStep+9<mapSize;gx++){
      const bx=gx*blockStep,by=gy*blockStep,px=bx+Math.floor((blockStep-6)/2),py=by+Math.floor((blockStep-6)/2);
      if(spawnRect&&px<=spawnRect.maxX&&px+5>=spawnRect.minX&&py<=spawnRect.maxY&&py+5>=spawnRect.minY) continue;
      const distance=Math.hypot(px+3-mapSize/2,py+3-mapSize/2);
      const slot={gx,gy,bx,by,distance,typeId:null}; slots.push(slot);lookup.set(`${gx}:${gy}`,slot);
    }
    const ranked=[...slots].sort((a,b)=>a.distance-b.distance||a.gy-b.gy||a.gx-b.gx);
    const reserve=(typeId,outer=false)=>{
      const candidates=(outer?[...ranked].reverse():ranked).filter(s=>s.typeId===null);
      if(!candidates.length) return;
      const band=candidates.slice(0,Math.min(5,candidates.length));band[pick(band.length)].typeId=typeId;
    };
    // 有足够地块时，八款都有至少一次；六款至少包含一个 3×3 同高安全屋面。
    [1,2,3,4,6].forEach(typeId=>reserve(typeId));
    [0,5,7].forEach(typeId=>reserve(typeId,true));
    if(slots.length>10&&pick(3)===0) reserve(6,true);
    const createsTriple=(s,typeId)=>{
      for(const [dx,dy] of [[1,0],[0,1]]) for(let start=-2;start<=0;start++){
        let equal=true;
        for(let k=0;k<3;k++){
          const p=lookup.get(`${s.gx+(start+k)*dx}:${s.gy+(start+k)*dy}`);
          if(!p||(p!==s&&p.typeId!==typeId)){equal=false;break;}
        }
        if(equal) return true;
      }
      return false;
    };
    for(const slot of slots){
      if(slot.typeId!==null) continue;
      const pool=slot.distance<mapSize*.31?[1,1,2,2,3,4,4,0,5]:[0,0,5,5,7,7,1,2];
      const offset=pick(pool.length);
      slot.typeId=pool.map((_,i)=>pool[(i+offset)%pool.length]).find(typeId=>!createsTriple(slot,typeId));
      if(slot.typeId===undefined) slot.typeId=[0,1,2,3,4,5,7].find(typeId=>!createsTriple(slot,typeId));
    }
    for(const slot of slots){
      const orientation=pick(4),type=catalog[slot.typeId],width=orientation%2?type.depth:type.width,depth=orientation%2?type.width:type.depth;
      const x=slot.bx+Math.floor((blockStep-width)/2),y=slot.by+Math.floor((blockStep-depth)/2);
      const building=createBuilding({id:buildings.length,typeId:slot.typeId,x,y,orientation,paletteId:pick(3)});
      building.blockX=slot.gx;building.blockY=slot.gy;buildings.push(building);
      for(const cell of building.cells) cells[cell.y*mapSize+cell.x]=cell;
    }
    return {buildings,cells};
  }

  function textureFor(id){
    const [wall, trim, base] = palettes[id];
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d');
    const rect = (x,y,w,h,color) => { g.fillStyle=color; g.fillRect(x,y,w,h); };
    rect(0,0,512,512,wall);
    rect(128,0,128,128,'#a2acac');
    rect(256,0,128,128,trim);
    rect(384,0,128,128,base);
    // 楼层窗不是独立对象：玻璃、内窗、窗框和窗台阴影烘焙成共享图集。
    rect(0,128,128,256,wall);
    rect(14,158,100,186,'#6b777b');
    rect(18,153,92,184,trim);
    rect(24,159,80,170,'#425d69');
    rect(27,162,35,163,'#688b96');
    rect(65,162,35,163,'#7898a0');
    rect(28,162,33,58,'#8eafb5');
    rect(66,162,33,58,'#a4bbbd');
    rect(27,242,73,4,'#bed0d0');
    rect(60,158,5,172,trim);
    rect(23,326,83,5,'#d9d8cc');
    rect(15,341,99,5,'#8e9998');
    // 首层商业基座：雨棚下的通高玻璃和双扇门。
    for(const [x,entry] of [[128,true],[256,false]]){
      rect(x,128,128,256,base);
      rect(x+6,158,116,26,trim);
      rect(x+11,164,106,13,entry?'#476a6d':'#7d7061');
      rect(x+9,192,110,181,'#d2d5cb');
      rect(x+15,200,98,173,'#41616c');
      rect(x+20,205,42,118,'#8cabb0');
      rect(x+66,205,42,118,'#71969f');
      rect(x+60,196,6,179,'#d0d4cf');
      rect(x+16,325,96,6,'#b7c9c7');
      if(entry){rect(x+52,280,4,29,'#dfd8b7');rect(x+72,280,4,29,'#dfd8b7');}
      else{rect(x+20,257,88,28,'#b6c7c2');}
      rect(x+9,375,111,7,'#697875');
    }
    rect(384,128,128,128,'#647780');
    for(let y=136;y<251;y+=12){rect(391,y,114,5,'#364b56');rect(391,y+5,114,2,'#9dacac');}
    rect(384,256,128,128,'#b7c4c4');
    rect(388,260,120,2,'#dee4dc');
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.name = `city-facade-${id}`;
    return texture;
  }

  function getMaterial(colorId){
    const id = ((colorId % palettes.length) + palettes.length) % palettes.length;
    if(!materials.has(id)){
      const m = new THREE.MeshLambertMaterial({map:textureFor(id)});
      m.name = `city-shared-${id}`; materials.set(id,m);
    }
    return materials.get(id);
  }

  function textureForType(typeId){
    if(typedTextures.has(typeId)) return typedTextures.get(typeId);
    const [wall,accent,light]=catalog[typeId].colors;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
    const g=canvas.getContext('2d');
    const rect=(x,y,w,h,color)=>{g.fillStyle=color;g.fillRect(x,y,w,h);};
    const text=(value,x,y,size,color,align='center')=>{
      if(!g.fillText) return;
      g.fillStyle=color;g.font=`bold ${size}px sans-serif`;g.textAlign=align;g.textBaseline='middle';g.fillText(value,x,y);
    };
    const circle=(x,y,r,color)=>{
      if(!g.beginPath||!g.arc||!g.fill){rect(x-r,y-r,r*2,r*2,color);return;}
      g.fillStyle=color;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();
    };
    rect(0,0,512,512,wall);rect(128,0,128,128,accent);rect(256,0,128,128,light);rect(384,0,128,128,accent);
    // 屋面接缝与防水层：由图集表现，不在每格重复添加独立构件。
    rect(131,3,122,122,light);rect(132,4,120,3,accent);rect(132,119,120,3,accent);
    rect(0,128,128,256,wall);
    if(typeId===1){
      rect(3,136,122,238,'#164D76');rect(10,139,108,228,'#70BEDD');rect(13,142,45,219,'#409ECB');
      rect(67,142,47,64,'#BCE9F3');rect(63,135,5,240,light);rect(5,255,118,6,accent);rect(5,360,118,9,light);
    }else if(typeId===4){
      for(let row=0;row<3;row++) for(let col=0;col<3;col++){
        rect(16+col*34,155+row*65,25,40,(row+col)%3===0?light:accent);
        rect(19+col*34,158+row*65,18,10,'#C1FBF2');
      }
      rect(0,370,128,6,accent);rect(0,380,128,4,light);
    }else if(typeId===5){
      rect(5,128,13,256,light);rect(109,128,13,256,light);
      rect(26,149,76,204,accent);rect(33,157,62,188,'#BCE7DF');rect(60,149,7,205,light);rect(28,250,73,6,light);
      rect(24,355,80,8,light);
    }else if(typeId===7){
      rect(9,154,110,171,accent);rect(16,162,96,150,'#B9D3DC');
      for(let row=0;row<4;row++) rect(15,180+row*34,97,5,accent);
      rect(60,162,6,149,light);rect(8,329,112,9,light);
    }else{
      rect(17,154,96,189,light);rect(24,161,82,174,accent);rect(29,166,71,159,typeId===3?'#F7C95C':'#427B92');
      if(typeId===0){rect(32,169,30,65,'#BCECDD');rect(65,169,32,65,'#90D9CC');}
      else{rect(31,168,65,64,typeId===2?'#FFDD86':'#A6D4DA');}
      rect(61,156,5,182,light);rect(23,248,85,5,light);rect(15,344,100,8,accent);
      if(typeId===3){rect(35,239,51,46,wall);text('★',61,262,39,light);}
    }
    for(const [x,isEntry] of [[128,true],[256,false]]){
      rect(x,128,128,256,accent);rect(x+6,152,116,27,light);rect(x+13,159,102,12,wall);
      rect(x+10,194,108,179,light);rect(x+17,202,94,170,typeId===7?'#879DA7':'#28566A');
      if(typeId===7){
        for(let row=0;row<12;row++) rect(x+17,206+row*13,94,4,light);
        rect(x+49,330,31,6,accent);
      }else{
        rect(x+22,207,36,113,'#8DCAD1');rect(x+70,207,35,113,'#70ADB9');rect(x+60,201,7,173,light);
        if(isEntry){rect(x+51,276,4,31,'#FFE6A0');rect(x+74,276,4,31,'#FFE6A0');}
        else if(typeId===3){rect(x+25,244,76,65,wall);text('★',x+64,275,48,light);}
      }
      rect(x+8,376,112,7,wall);
    }
    rect(384,128,128,128,accent);
    for(let row=0;row<10;row++) rect(391,135+row*12,114,5,light);
    rect(384,256,128,128,light);rect(390,262,116,116,accent);rect(393,265,110,5,light);
    // 大图案使用完整墙面的分片 UV；绝不跨格悬挂不可破坏的独立招牌。
    rect(0,384,128,128,wall);
    if(typeId===6){
      circle(64,448,61,accent);circle(64,448,52,light);
      for(let i=0;i<12;i++){
        const angle=i*Math.PI/6;rect(62+Math.sin(angle)*43,446-Math.cos(angle)*43,4,4,accent);
      }
      rect(61,414,6,36,accent);rect(64,445,28,6,accent);circle(64,448,6,wall);
    }else if(typeId===3){
      for(const [cx,cy,r] of [[33,418,19],[62,408,23],[93,421,21],[48,433,23],[80,436,22]]) circle(cx,cy,r,accent);
      rect(29,443,72,59,'#FFF4DF');rect(36,446,11,53,wall);rect(58,446,11,53,wall);rect(80,446,11,53,wall);
      rect(34,495,62,9,accent);
    }else if(typeId===4){
      for(const [px,py,pw,ph] of [[25,415,77,13],[14,428,101,40],[26,468,18,17],[84,468,18,17]]) rect(px,py,pw,ph,accent);
      rect(34,438,11,11,wall);rect(83,438,11,11,wall);rect(55,453,18,7,light);
    }else if(typeId===5){text('H',64,450,104,light);}
    else if(typeId===2){text('角',64,450,84,accent);}
    else if(typeId===1){rect(28,413,22,79,light);rect(57,398,22,94,light);rect(86,429,17,63,light);}
    else if(typeId===0){rect(23,408,35,35,accent);rect(67,408,35,35,light);rect(23,453,35,35,light);rect(67,453,35,35,accent);}
    else{text('BOX',64,450,42,light);}
    rect(128,384,256,64,typeId===3?'#FFF4DF':accent);rect(131,387,250,58,typeId===3?wall:light);
    const signNames=['彩盒生活','BLUE BOX','角角百货','POP CINEMA','PIXEL PLAY','糖果旅居','TIME HALL','STACK DEPOT'];
    text(signNames[typeId],256,416,typeId===3||typeId===7?25:28,typeId===3?'#FFF4DF':wall);
    rect(384,384,128,128,accent);rect(392,393,112,106,light);rect(401,402,94,70,wall);text('★',448,438,56,accent);text('OPEN',448,488,17,wall);
    rect(128,448,128,64,accent);rect(132,452,120,56,'#CCFFF8');
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;texture.name=`city-atlas-${typeId}`;
    typedTextures.set(typeId,texture);return texture;
  }

  function getTypedMaterial(typeId,paletteId){
    const key=`${typeId}:${paletteId}`;
    if(!typedMaterials.has(key)){
      const texture=textureForType(typeId),factor=[.92,1,1.08][paletteId];
      if(typeId===4&&!neonTexture){
        const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const g=canvas.getContext('2d');
        g.fillStyle='#000000';g.fillRect(0,0,512,512);g.fillStyle='#FFFFFF';g.fillRect(128,448,128,64);
        neonTexture=new THREE.CanvasTexture(canvas);neonTexture.name='city-neon-mask';neonTexture.colorSpace=THREE.SRGBColorSpace;
      }
      const material=new THREE.MeshLambertMaterial({map:texture,color:new THREE.Color().setRGB(factor,factor,factor),
        emissive:typeId===4?0x70eee7:0x000000,emissiveMap:typeId===4?neonTexture:null,emissiveIntensity:.3});
      material.name=`city-${typeId}-palette-${paletteId}`;typedMaterials.set(key,material);
    }
    return typedMaterials.get(key);
  }

  // 轻量几何合并器：所有面共用同一张图集，一个格子只有一次提交。
  function builder(textured){
    const positions=[], normals=[], uvs=[], colors=[];
    function quad(a,b,c,d,key='wall',color,region){
      const ab = new THREE.Vector3().subVectors(new THREE.Vector3(...b),new THREE.Vector3(...a));
      const ac = new THREE.Vector3().subVectors(new THREE.Vector3(...c),new THREE.Vector3(...a));
      const n = ab.cross(ac).normalize();
      const r = region || atlas[key] || atlas.wall;
      // 普通图集格内缩 1px 防串色；跨建筑格的连续招牌不可在拼缝重复内缩。
      const inset=region?0:1;
      const uv = [[(r[0]+inset)/512,1-(r[1]+r[3]-inset)/512],[(r[0]+r[2]-inset)/512,1-(r[1]+r[3]-inset)/512],[(r[0]+r[2]-inset)/512,1-(r[1]+inset)/512],[(r[0]+inset)/512,1-(r[1]+inset)/512]];
      const verts=[a,b,c,d], shade=new THREE.Color(color === undefined ? 0xffffff : color);
      for(const i of [0,1,2,0,2,3]){
        positions.push(...verts[i]); normals.push(n.x,n.y,n.z);
        if(textured) uvs.push(...uv[i]); else colors.push(shade.r,shade.g,shade.b);
      }
    }
    function box(x,y,z,w,h,d,key='wall',color){
      const l=x-w/2,r=x+w/2,b=y-h/2,t=y+h/2,f=z+d/2,k=z-d/2;
      quad([l,b,f],[r,b,f],[r,t,f],[l,t,f],key,color);
      quad([r,b,k],[l,b,k],[l,t,k],[r,t,k],key,color);
      quad([r,b,f],[r,b,k],[r,t,k],[r,t,f],key,color);
      quad([l,b,k],[l,b,f],[l,t,f],[l,t,k],key,color);
      quad([l,t,f],[r,t,f],[r,t,k],[l,t,k],key,color);
      quad([l,b,k],[r,b,k],[r,b,f],[l,b,f],key,color);
    }
    function finish(){
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      geo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
      if(textured) geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
      else geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
      geo.computeBoundingBox(); geo.computeBoundingSphere(); return geo;
    }
    return {quad,box,finish};
  }

  function exposedMask(x,y,map,mapSize){
    let mask=0;
    directions.forEach(([dx,dy],i)=>{
      const nx=x+dx,ny=y+dy;
      if(nx<0||ny<0||nx>=mapSize||ny>=mapSize||map[ny*mapSize+nx]!==1) mask|=1<<i;
    });
    return mask;
  }

  function cellGeometry(floors,unit,mask,equipment,entry){
    const key=[floors,unit,mask,equipment,entry].join(':');
    if(geometryCache.has(key)) return geometryCache.get(key);
    const b=builder(true), h=floors*unit;
    // 精确一格，连续屋面不留旧版 0.06 格宽的棋盘缝。
    b.box(0,h/2,0,1,h,1,'wall');
    b.quad([-.5,h+.003,.5],[.5,h+.003,.5],[.5,h+.003,-.5],[-.5,h+.003,-.5],'roof');
    function face(side,y0,y1,key){
      const q=[[-.5,y0,.501],[.5,y0,.501],[.5,y1,.501],[-.5,y1,.501]];
      // 从 +z 方向按 90 度旋转，方向编号与地图邻居一致。
      const angle=[Math.PI,Math.PI/2,0,-Math.PI/2][side];
      const cs=Math.cos(angle),sn=Math.sin(angle);
      const pts=q.map(([x,y,z])=>[x*cs+z*sn,y,-x*sn+z*cs]);
      b.quad(...pts,key);
    }
    function ledge(side,y,height,width=.998,depth=.07,key='trim'){
      const [dx,dz]=directions[side];
      b.box(dx*.496,y,dz*.496,dx?depth:width,height,dx?width:depth,key);
    }
    for(let side=0;side<4;side++){
      // 内部的立面也有贴图，隔壁格子破坏后仍然是完整墙面。
      for(let floor=0;floor<floors;floor++) face(side,floor*unit+.015,(floor+1)*unit-.018,floor? 'window':entry?'entrance':'store');
      if(!(mask&(1<<side))) continue;
      ledge(side,.1,.2,1,.08,'base');
      for(let floor=1;floor<floors;floor++) ledge(side,floor*unit,.065,1,.075);
      ledge(side,h-.075,.15,1,.095);
      // 女儿墙只在街区外轮廓，避免每个格子屋顶都出现一圈围墙。
      ledge(side,h+.10,.20,1,.065,'trim');
      ledge(side,unit-.26,.07,.96,.14,entry?'metal':'trim');
    }
    if(equipment===1){
      b.box(0,h+.16,0,.52,.3,.62,'metal');
      b.quad([-.225,h+.312,.265],[.225,h+.312,.265],[.225,h+.312,-.265],[-.225,h+.312,-.265],'vent');
      b.box(-.17,h+.022,.1,.08,.044,.82,'base');
      b.box(.17,h+.022,.1,.08,.044,.82,'base');
    } else if(equipment===2){
      b.box(.03,h+.16,-.03,.28,.32,.3,'base');
      b.box(.03,h+.33,-.03,.34,.04,.36,'metal');
    }
    const geo=b.finish(); geo.name=`city-cell-${key}`; geometryCache.set(key,geo); return geo;
  }

  function typedCellGeometry(cell,mask,unit){
    const {typeId,lx,ly,floors,equipment}=cell,type=catalog[typeId];
    // 200 个原始格子 × 16 种外露面；没有世界坐标、随机数或明度进入缓存键。
    const key=[typeId,lx,ly,mask,unit].join(':');
    if(typedGeometryCache.has(key)) return typedGeometryCache.get(key);
    const b=builder(true),h=floors*unit;
    b.box(0,h/2,0,1,h,1,'wall');
    b.quad([-.5,h+.003,.5],[.5,h+.003,.5],[.5,h+.003,-.5],[-.5,h+.003,-.5],'roof');
    function face(side,y0,y1,key='window',region=null,left=-.5,right=.5,depth=.501){
      const angle=[Math.PI,Math.PI/2,0,-Math.PI/2][side],cs=Math.cos(angle),sn=Math.sin(angle);
      const points=[[left,y0,depth],[right,y0,depth],[right,y1,depth],[left,y1,depth]];
      b.quad(...points.map(([x,y,z])=>[x*cs+z*sn,y,-x*sn+z*cs]),key,undefined,region);
    }
    function ledge(side,y,height,depth=.08,key='trim',width=1){
      const [dx,dz]=directions[side];
      b.box(dx*.497,y,dz*.497,dx?depth:width,height,dx?width:depth,key);
    }
    function pillar(side,offset,y,height,width=.055,depth=.07,key='trim'){
      const [dx,dz]=directions[side];
      b.box(dx*.496+(dz?offset:0),y,dz*.496+(dx?offset:0),dx?depth:width,height,dx?width:depth,key);
    }
    function patch(side,lo,hi,y0,y1,key='sign',depth=.507){
      const coordinate=[type.width-1-lx,type.depth-1-ly,lx,ly][side];
      const start=Math.max(lo,coordinate),end=Math.min(hi,coordinate+1);
      if(end<=start) return;
      const r=atlas[key],u0=(start-lo)/(hi-lo),u1=(end-lo)/(hi-lo);
      face(side,y0,y1,key,[r[0]+u0*r[2],r[1],(u1-u0)*r[2],r[3]],start-coordinate-.5,end-coordinate-.5,depth);
    }
    for(let side=0;side<4;side++){
      for(let floor=0;floor<floors;floor++){
        const entry=side===0&&ly===0&&(lx===Math.floor(type.width/2)||typeId===0&&lx%2===0);
        const wideShutterWall=typeId===7&&side===0&&ly===0&&floor===0;
        face(side,floor*unit+.01,(floor+1)*unit-.018,wideShutterWall?'wall':floor?'window':entry?'entrance':'store');
      }
      if(!(mask&(1<<side))) continue;
      ledge(side,.085,.17,.07,'base');
      ledge(side,h-.07,.14,.10,typeId===4?'neon':'trim');
      if(typeId!==7) ledge(side,h+.065,.13,.065,typeId===0?'base':'trim');
      if(typeId===0){
        for(let floor=1;floor<floors;floor++){
          if((lx+ly+floor)%2===0){
            ledge(side,floor*unit+.04,.105,.43,'base',.80);
            const [dx,dz]=directions[side];
            b.box(dx*.68,floor*unit+.32,dz*.68,dx?.055:.78,.43,dx?.78:.055,'base');
          }
        }
      }else if(typeId===1){
        pillar(side,-.456,h/2,h,.055,.09);pillar(side,.456,h/2,h,.055,.09);
        if(floors===3) ledge(side,h-.3,.11,.19,'base');
      }else if(typeId===2){
        ledge(side,unit-.18,.15,.45,'base');
        for(let floor=1;floor<floors;floor++) ledge(side,floor*unit,.075,.08,'trim');
        if(side===0||side===3) patch(side,.22,(side===0?type.width:type.depth)-.22,unit+.23,unit+.95);
      }else if(typeId===3){
        ledge(side,unit-.04,.13,.22,'trim');
        if(side===0&&ly===0){
          // 单格切分的梯形门头，左右末端斜切，面板只凸出 0.22 格。
          const coordinate=type.width-1-lx,left=-.5+(coordinate===0?.19:0),right=.5-(coordinate===type.width-1?.19:0);
          const y0=unit-.54,y1=unit+.17,depth=-.72;
          b.quad([.5,y0,depth],[-.5,y0,depth],[-right,y1,depth],[-left,y1,depth],'base');
          ledge(side,y0,.10,.43,'trim');ledge(side,y1,.08,.43,'trim');
          patch(side,.22,type.width-.22,y0+.1,y1-.09,'sign',.724);
          patch(side,1.85,4.15,unit+.35,h-.11,'icon');
        }
      }else if(typeId===4){
        for(let floor=1;floor<floors;floor++) ledge(side,floor*unit,.075,.10,floor%2?'neon':'base');
        if((lx+ly)%2===0) ledge(side,h+.18,.13,.13,'base',.42);
        if(side===0&&ly===0) patch(side,.18,3.82,unit+.23,unit+.87);
        if((side===1||side===2)&&floors===4) patch(side,1.3,3.65,h-2.05,h-.3,'icon');
      }else if(typeId===5){
        pillar(side,-.46,h/2,h,.07,.10);pillar(side,.46,h/2,h,.07,.10);
        ledge(side,unit,.10,.12,'trim');
        if(floors===5) ledge(side,h-.3,.13,.18,'base');
        if(side===0&&ly===0) patch(side,.25,type.width-.25,unit+.36,h-.20);
      }else if(typeId===6){
        ledge(side,h-.36,.14,.16,'base');ledge(side,h+.17,.08,.22,'trim');
        if(floors===5){
          // 3 格宽塔体的大钟盘分片贴在四个实际外墙上。
          patch(side,1.15,3.85,h-3.0,h-.42,'icon');
          pillar(side,-.47,h/2,h,.075,.1,'base');
        }else if(side===0&&ly===0) patch(side,.35,type.width-.35,unit+.3,h-.35);
      }else if(typeId===7){
        ledge(side,h+.055,.11,.09,'base');
        ledge(side,h+.175,.13,.13,'base',.58);
        if(side===0&&ly===0){
          patch(side,.3,type.width-.3,unit+.42,h-.3);
          // 两扇 2.6 格宽的装卸门，按单格切分同一卷帘纹理，破坏后随所属格消失。
          patch(side,.2,2.8,.08,unit-.13,'shutter');
          patch(side,3.2,5.8,.08,unit-.13,'shutter');
        }
        for(let floor=1;floor<floors;floor++) ledge(side,floor*unit,.08,.075,'base');
      }
    }
    if(equipment){
      b.box(0,h+.1,0,.65,.2,.48,'metal');
      b.quad([-.29,h+.203,.20],[.29,h+.203,.20],[.29,h+.203,-.20],[-.29,h+.203,-.20],'vent');
    }
    const geometry=b.finish();geometry.name=`city-type-cell-${key}`;typedGeometryCache.set(key,geometry);return geometry;
  }

  function createCell({ci,x,y,floors=3,colorId=0,map,mapSize,buildUnit=2.2,building=null,cell=null,cellMap=null}){
    const meta=cell||(cellMap&&cellMap[ci])||(building&&building.cells.find(c=>c.x===x&&c.y===y));
    if(meta&&Number.isInteger(meta.typeId)&&meta.typeId>=0&&meta.typeId<catalog.length){
      const orientation=meta.orientation||0;let mask=0;
      for(let side=0;side<4;side++){
        const worldSide=(side+orientation)%4,[dx,dy]=directions[worldSide],nx=x+dx,ny=y+dy;
        const neighbor=cellMap?cellMap[ny*mapSize+nx]:building&&building.cells.find(c=>c.x===nx&&c.y===ny);
        if(nx<0||ny<0||nx>=mapSize||ny>=mapSize||map&&map[ny*mapSize+nx]!==1||!neighbor||neighbor.buildingId!==meta.buildingId||neighbor.floors<meta.floors) mask|=1<<side;
      }
      const paletteId=building?building.paletteId:meta.paletteId===undefined?1:meta.paletteId;
      const mesh=new THREE.Mesh(typedCellGeometry(meta,mask,buildUnit),getTypedMaterial(meta.typeId,paletteId));
      mesh.position.set(x+.5,0,y+.5);mesh.rotation.y=-orientation*Math.PI/2;
      mesh.castShadow=true;mesh.receiveShadow=true;mesh.name=`city-cell-${ci}`;
      let worldMask=0;for(let side=0;side<4;side++) if(mask&(1<<side)) worldMask|=1<<((side+orientation)%4);
      mesh.userData={ci,cityCell:true,grounded:true,exposedMask:worldMask,equipment:meta.equipment||0,
        typeId:meta.typeId,buildingId:meta.buildingId,roofWalkable:meta.roofWalkable,paletteId};
      return mesh;
    }
    const mask=exposedMask(x,y,map,mapSize);
    const equipment=mask===0 && (x*13+y*7)%11===0?1:mask===0&&(x*7+y*3)%29===0?2:0;
    const entry=(x+y)%4===0?1:0;
    const mesh=new THREE.Mesh(cellGeometry(floors,buildUnit,mask,equipment,entry),getMaterial(colorId));
    mesh.position.set(x+.5,0,y+.5);
    mesh.castShadow=true; mesh.receiveShadow=true;
    mesh.name=`city-cell-${ci}`;
    mesh.userData={ci,cityCell:true,grounded:true,exposedMask:mask,equipment};
    return mesh;
  }

  function disposeCell(root){
    if(root?.parent) root.parent.remove(root);
    // 所有 cell 资源都由模块共享，重开及逐格摧毁均不释放模板。
  }

  function createGround({map,mapSize}){
    const g=new THREE.Group(); g.name='city-streets'; g.userData.cityGround=true;
    const b=builder(false), n=mapSize, sidewalks=new Uint8Array(n*n);
    const occupied=(x,y)=>x>=0&&y>=0&&x<n&&y<n&&map[y*n+x]===1;
    b.quad([-n*.2,.002,n*1.2],[n*1.2,.002,n*1.2],[n*1.2,.002,-n*.2],[-n*.2,.002,-n*.2],'wall',0x64747d);
    for(let y=0;y<n;y++) for(let x=0;x<n;x++){
      if(occupied(x,y)) continue;
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) if(occupied(x+dx,y+dy)) sidewalks[y*n+x]=1;
    }
    for(let y=0;y<n;y++) for(let x=0;x<n;x++){
      if(!sidewalks[y*n+x]) continue;
      b.box(x+.5,.029,y+.5,1,.054,1,'wall',0xb8beb6);
      for(const [dx,dy] of directions){
        const nx=x+dx,ny=y+dy;
        if(nx<0||ny<0||nx>=n||ny>=n||occupied(nx,ny)||sidewalks[ny*n+nx]) continue;
        b.box(x+.5+dx*.47,.061,y+.5+dy*.47,dx?.065:.998,.07,dx?.998:.065,'wall',0xd3d4c8);
      }
      // 少量接缝让人行道有尺度感；不会把路面分成方格。
      if((x+y)%3===0) b.box(x+.5,.057,y+.5,.012,.003,.86,'wall',0x9aa7a3);
    }
    function safeRect(x,z,w,d){
      const loX=Math.floor(x-w/2),hiX=Math.floor(x+w/2),loY=Math.floor(z-d/2),hiY=Math.floor(z+d/2);
      for(let y=loY;y<=hiY;y++) for(let x=loX;x<=hiX;x++){
        if(x<0||y<0||x>=n||y>=n||occupied(x,y)||sidewalks[y*n+x]) return false;
      }
      return true;
    }
    // 从实际地图提取整条通路，而不是假定街区固定宽度或把标线穿过建筑。
    function corridors(vertical){
      const result=[]; let start=-1;
      for(let a=0;a<=n;a++){
        let clear=a<n;
        if(clear) for(let j=1;j<n-1;j++) if(occupied(vertical?a:j,vertical?j:a)){clear=false;break;}
        if(clear&&start<0) start=a;
        if(!clear&&start>=0){
          const width=a-start;
          if(width>=3&&start>0&&a<n) result.push((start+a)/2);
          start=-1;
        }
      }
      return result;
    }
    const xs=corridors(true), zs=corridors(false);
    const stripes=[];
    function marking(x,z,w,d,color){
      if(!safeRect(x,z,w,d)) return;
      b.quad([x-w/2,.066,z+d/2],[x+w/2,.066,z+d/2],[x+w/2,.066,z-d/2],[x-w/2,.066,z-d/2],'wall',color);
      stripes.push({x,z,width:w,depth:d});
    }
    for(const z of zs) for(let x=1.5;x<n-1;x+=2.6){
      if(xs.some(a=>Math.abs(a-x)<2.1)) continue;
      marking(x,z,1.12,.055,0xe3c982);
    }
    for(const x of xs) for(let z=1.5;z<n-1;z+=2.6){
      if(zs.some(a=>Math.abs(a-z)<2.1)) continue;
      marking(x,z,.055,1.12,0xe3c982);
    }
    for(const x of xs) for(const z of zs) for(const sign of [-1,1]){
      for(let i=-3;i<=3;i++){
        marking(x+sign*1.8,z+i*.26,.62,.13,0xe4e4d5);
        marking(x+i*.26,z+sign*1.8,.13,.62,0xe4e4d5);
      }
    }
    const mesh=new THREE.Mesh(b.finish(),new THREE.MeshLambertMaterial({vertexColors:true}));
    mesh.name='city-ground-merged'; mesh.receiveShadow=true; g.add(mesh);
    g.userData.markings=stripes; g.userData.sidewalks=sidewalks;
    g.userData.corridors={x:xs,z:zs};
    return g;
  }

  function disposeGround(root){
    if(!root) return;
    root.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});
    if(root.parent) root.parent.remove(root);
  }

  function stats(){
    let triangles=0;
    geometryCache.forEach(g=>{triangles+=g.attributes.position.count/3;});
    typedGeometryCache.forEach(g=>{triangles+=g.attributes.position.count/3;});
    return {geometries:geometryCache.size+typedGeometryCache.size,materials:materials.size+typedMaterials.size,templateTriangles:triangles};
  }
  return {catalog,createBuilding,generateLayout,createCell,disposeCell,createGround,disposeGround,stats};
})();
