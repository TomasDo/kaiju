// 程序化城市美术。Three.js r160 / 本地脚本；不依赖图片或网络。
// Cell 的根节点位于格子中心、地面 y=0，整体缩放 y 即可从地面倒塌。
// 一格一个 Mesh。模板几何、贴图和材质属于模块，disposeCell 不销毁共享资源。
const CityVisual = (() => {
  // 游戏仅使用 2–5 层、固定 BUILD_UNIT。屋顶设备只用于 mask=0，
  // 因而跨随机地图重开最多缓存 4 × (15 + 3) × 2 = 144 个几何模板。
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

  // 轻量几何合并器：所有面共用同一张图集，一个格子只有一次提交。
  function builder(textured){
    const positions=[], normals=[], uvs=[], colors=[];
    function quad(a,b,c,d,key='wall',color){
      const ab = new THREE.Vector3().subVectors(new THREE.Vector3(...b),new THREE.Vector3(...a));
      const ac = new THREE.Vector3().subVectors(new THREE.Vector3(...c),new THREE.Vector3(...a));
      const n = ab.cross(ac).normalize();
      const r = atlas[key] || atlas.wall;
      const uv = [[(r[0]+1)/512,1-(r[1]+r[3]-1)/512],[(r[0]+r[2]-1)/512,1-(r[1]+r[3]-1)/512],[(r[0]+r[2]-1)/512,1-(r[1]+1)/512],[(r[0]+1)/512,1-(r[1]+1)/512]];
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

  function createCell({ci,x,y,floors=3,colorId=0,map,mapSize,buildUnit=2.2}){
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
    return {geometries:geometryCache.size,materials:materials.size,templateTriangles:triangles};
  }
  return {createCell,disposeCell,createGround,disposeGround,stats};
})();
