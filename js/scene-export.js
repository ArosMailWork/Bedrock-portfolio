// Scene export (Settings > GARDEN > Export): the current scene as .glb (three's GLTFExporter) or
// .fbx (a small ASCII FBX 7.4 writer below; three.js ships no FBX exporter). What is exported:
// every visible mesh except objects flagged userData.skipBake / skipExport (sky, clouds, wind lines,
// falling leaves, player, grass) and shader-only materials (sea, sky, career labels). The scene is
// baked first: world transforms applied; GLB keeps InstancedMesh as GPU instances (per-instance
// colour), FBX expands and merges the instances per mesh, instance colours as vertex colours. Shader tweaks (wind sway, pop-in, sinking) are not
// exported: it is the current, still state (walking view: built trees, no voxels; map: voxels).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const skipped = (object) => {
  for (let o = object; o; o = o.parent) if (!o.visible || o.userData.skipBake || o.userData.skipExport) return true;
  return false;
};
const exportable = (material) => material && !material.isShaderMaterial && !material.isRawShaderMaterial && !material.isPointsMaterial && !material.isLineBasicMaterial;

// One baked geometry (position, normal, color, uv) in world space.
function bakeGeometry(source, matrix, tint, instanceTint) {
  // Indexed (shared vertices) keeps the files small; non-indexed sources get a trivial index.
  const geometry = source.clone();
  if (!geometry.index) geometry.setIndex([...Array(geometry.attributes.position.count).keys()]);
  for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) geometry.deleteAttribute(name);
  geometry.morphAttributes = {};
  geometry.applyMatrix4(matrix);
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  // Drop faces looking straight down (tile and block undersides lie on the ground, never seen).
  const nrm = geometry.attributes.normal, idx = geometry.index.array, keep = [];
  for (let i = 0; i < idx.length; i += 3) {
    if (nrm.getY(idx[i]) + nrm.getY(idx[i + 1]) + nrm.getY(idx[i + 2]) > -2.85) keep.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  if (keep.length < idx.length) geometry.setIndex(keep);
  if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
  const count = geometry.attributes.position.count, colors = new Float32Array(count * 3), base = geometry.attributes.color;
  for (let i = 0; i < count; i++) {
    const r = base ? base.getX(i) : 1, g = base ? base.getY(i) : 1, b = base ? base.getZ(i) : 1;
    colors[i * 3] = r * tint.r * instanceTint.r; colors[i * 3 + 1] = g * tint.g * instanceTint.g; colors[i * 3 + 2] = b * tint.b * instanceTint.b;
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

// Scene -> group of plain meshes, named by their parents. instancing = true (GLB): instanced meshes
// stay instanced (EXT_mesh_gpu_instancing: one mesh + per-instance transform and colour, small
// files); false (FBX): every instance is baked into one merged mesh per source.
export function bakeScene(scene, { instancing = false } = {}) {
  scene.updateMatrixWorld(true);
  const out = new THREE.Group(), white = new THREE.Color(1, 1, 1), instance = new THREE.Matrix4(), tint = new THREE.Color();
  out.name = 'portfolio-garden';
  let index = 0;
  scene.traverse((object) => {
    if (!object.isMesh || skipped(object)) return;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    if (!exportable(material) || !object.geometry?.attributes.position) return;
    const color = material.color ?? white, parts = [];
    const newMaterial = () => new THREE.MeshStandardMaterial({
      vertexColors: true, map: material.map ?? null, side: material.side, roughness: 0.9,
      transparent: material.transparent, alphaTest: material.alphaMap || material.alphaTest ? 0.3 : 0,
    });
    if (object.isInstancedMesh && instancing) {
      if (!object.count) return;
      const geometry = bakeGeometry(object.geometry, new THREE.Matrix4(), color, white);
      const mesh = new THREE.InstancedMesh(geometry, newMaterial(), object.count);
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, instance);
        mesh.setMatrixAt(i, instance.premultiply(object.matrixWorld));
        if (object.instanceColor) { object.getColorAt(i, tint); mesh.setColorAt(i, tint); }
      }
      mesh.name = `${object.name || object.parent?.name || 'instanced'}_${index++}`;
      out.add(mesh);
      return;
    }
    if (object.isInstancedMesh) {
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, instance);
        if (object.instanceColor) object.getColorAt(i, tint); else tint.copy(white);
        parts.push(bakeGeometry(object.geometry, instance.clone().premultiply(object.matrixWorld), color, tint));
      }
    } else parts.push(bakeGeometry(object.geometry, object.matrixWorld, color, white));
    if (!parts.length) return;
    const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts);
    if (!geometry) return;
    const baked = new THREE.Mesh(geometry, newMaterial());
    let owner = object;
    while (owner && !owner.name && owner.parent && owner.parent !== scene) owner = owner.parent;
    baked.name = `${owner?.name || object.name || object.type}_${index++}`;
    out.add(baked);
  });
  return out;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000); // big files: give the download time to start
}

export async function exportGLB(scene) {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const group = bakeScene(scene, { instancing: true });
  const data = await new GLTFExporter().parseAsync(group, { binary: true, onlyVisible: true });
  download(new Blob([data], { type: 'application/octet-stream' }), 'portfolio-garden.glb');
  return group.children.length;
}

// ---------- ASCII FBX 7.4 ----------
// Per mesh: a Geometry (indexed triangles; normals, vertex colours, UVs per vertex), a Model and a
// Material (white diffuse; colours live in the vertex colour layer). Y up, 1 unit = 1 m.
const num = (v) => (Math.abs(v) < 1e-5 ? '0' : Number(v.toFixed(4)).toString());
const array = (name, values) => `\t\t${name}: *${values.length} {\n\t\t\ta: ${values.map(num).join(',')}\n\t\t}\n`;
const intArray = (name, values) => `\t\t${name}: *${values.length} {\n\t\t\ta: ${values.join(',')}\n\t\t}\n`;

export function toFBX(group) {
  const meshes = group.children, now = new Date();
  let id = 100000;
  const objects = [], connections = [];
  for (const mesh of meshes) {
    const g = mesh.geometry, p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color, uv = g.attributes.uv;
    const geoId = id++, modelId = id++, matId = id++, name = mesh.name.replace(/[^\w-]/g, '_');
    const idx = g.index.array, indices = [];
    for (let i = 0; i < idx.length; i += 3) indices.push(idx[i], idx[i + 1], -idx[i + 2] - 1); // last vertex of a polygon: bitwise NOT
    const colors = [];
    for (let i = 0; i < p.count; i++) colors.push(c.getX(i), c.getY(i), c.getZ(i), 1);
    objects.push(`\tGeometry: ${geoId}, "Geometry::${name}", "Mesh" {
${array('Vertices', Array.from(p.array))}${intArray('PolygonVertexIndex', indices)}\t\tGeometryVersion: 124
\t\tLayerElementNormal: 0 {
\t\t\tVersion: 101
\t\t\tName: ""
\t\t\tMappingInformationType: "ByVertice"
\t\t\tReferenceInformationType: "Direct"
${array('Normals', Array.from(n.array)).replace(/^\t\t/gm, '\t\t\t')}\t\t}
\t\tLayerElementColor: 0 {
\t\t\tVersion: 101
\t\t\tName: "Col"
\t\t\tMappingInformationType: "ByVertice"
\t\t\tReferenceInformationType: "Direct"
${array('Colors', colors).replace(/^\t\t/gm, '\t\t\t')}\t\t}
\t\tLayerElementUV: 0 {
\t\t\tVersion: 101
\t\t\tName: "UVMap"
\t\t\tMappingInformationType: "ByVertice"
\t\t\tReferenceInformationType: "Direct"
${array('UV', Array.from(uv.array)).replace(/^\t\t/gm, '\t\t\t')}\t\t}
\t\tLayerElementMaterial: 0 {
\t\t\tVersion: 101
\t\t\tName: ""
\t\t\tMappingInformationType: "AllSame"
\t\t\tReferenceInformationType: "IndexToDirect"
\t\t\tMaterials: *1 {
\t\t\t\ta: 0
\t\t\t}
\t\t}
\t\tLayer: 0 {
\t\t\tVersion: 100
\t\t\tLayerElement:  {\n\t\t\t\tType: "LayerElementNormal"\n\t\t\t\tTypedIndex: 0\n\t\t\t}
\t\t\tLayerElement:  {\n\t\t\t\tType: "LayerElementColor"\n\t\t\t\tTypedIndex: 0\n\t\t\t}
\t\t\tLayerElement:  {\n\t\t\t\tType: "LayerElementUV"\n\t\t\t\tTypedIndex: 0\n\t\t\t}
\t\t\tLayerElement:  {\n\t\t\t\tType: "LayerElementMaterial"\n\t\t\t\tTypedIndex: 0\n\t\t\t}
\t\t}
\t}
\tModel: ${modelId}, "Model::${name}", "Mesh" {
\t\tVersion: 232
\t\tProperties70:  {
\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
\t\t\tP: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
\t\t}
\t\tShading: T
\t\tCulling: "CullingOff"
\t}
\tMaterial: ${matId}, "Material::${name}_mat", "" {
\t\tVersion: 102
\t\tShadingModel: "lambert"
\t\tProperties70:  {
\t\t\tP: "DiffuseColor", "Color", "", "A",1,1,1
\t\t}
\t}
`);
    connections.push(`\tC: "OO",${modelId},0`, `\tC: "OO",${geoId},${modelId}`, `\tC: "OO",${matId},${modelId}`);
  }
  const count = meshes.length;
  return `; FBX 7.4.0 project file
; Portfolio Garden export (${now.toISOString()})
FBXHeaderExtension:  {
\tFBXHeaderVersion: 1003
\tFBXVersion: 7400
\tCreator: "Portfolio Garden scene-export.js"
}
GlobalSettings:  {
\tVersion: 1000
\tProperties70:  {
\t\tP: "UpAxis", "int", "Integer", "",1
\t\tP: "UpAxisSign", "int", "Integer", "",1
\t\tP: "FrontAxis", "int", "Integer", "",2
\t\tP: "FrontAxisSign", "int", "Integer", "",1
\t\tP: "CoordAxis", "int", "Integer", "",0
\t\tP: "CoordAxisSign", "int", "Integer", "",1
\t\tP: "UnitScaleFactor", "double", "Number", "",100
\t}
}
Definitions:  {
\tVersion: 100
\tCount: ${count * 3 + 1}
\tObjectType: "GlobalSettings" {\n\t\tCount: 1\n\t}
\tObjectType: "Model" {\n\t\tCount: ${count}\n\t}
\tObjectType: "Geometry" {\n\t\tCount: ${count}\n\t}
\tObjectType: "Material" {\n\t\tCount: ${count}\n\t}
}
Objects:  {
${objects.join('')}}
Connections:  {
${connections.join('\n')}
}
`;
}

export function exportFBX(scene) {
  const group = bakeScene(scene);
  download(new Blob([toFBX(group)], { type: 'application/octet-stream' }), 'portfolio-garden.fbx');
  return group.children.length;
}
