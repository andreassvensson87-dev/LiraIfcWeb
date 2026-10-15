import * as THREE from "three";
import { isObjectVisible } from "./model-state.js";

// Batch by opacity. Object ranges keep picking, highlighting and visibility independent
// without one draw call per IFC object. Chunks bound the temporary merge allocation.
export function buildBatches(model) {
  const groups = new Map();
  for (const part of model.parts) {
    const opacity = part.opacity < 0.95 ? Math.max(0.12, part.opacity) : 1;
    const key = `${opacity.toFixed(2)}:${part.lines ? "lines" : "mesh"}:${part.texture?.uuid || ""}:${part.smooth ? "smooth" : "flat"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(part);
  }
  const batches = [];
  for (const [opacity, parts] of groups) {
    let chunk = [],
      vertices = 0;
    for (const part of parts) {
      chunk.push(part);
      vertices += part.positions.length / 3;
      if (vertices > 250000) {
        batches.push(makeBatch(model, chunk, Number(opacity.split(":")[0])));
        chunk = [];
        vertices = 0;
      }
    }
    if (chunk.length)
      batches.push(makeBatch(model, chunk, Number(opacity.split(":")[0])));
  }
  model.parts = [];
  return batches;
}
function makeBatch(model, parts, opacity) {
  const vertices = parts.reduce((n, p) => n + p.positions.length, 0);
  const indexCount = parts.reduce((n, p) => n + p.indices.length, 0);
  const positions = new Float32Array(vertices),
    uvs = parts[0].texture ? new Float32Array((vertices / 3) * 2) : null,
    normals = new Float32Array(vertices),
    colors = new Float32Array(vertices);
  const indices = new Uint32Array(indexCount),
    ranges = [];
  let vOffset = 0,
    iOffset = 0;
  const bounds = new THREE.Box3(),
    point = new THREE.Vector3();
  for (const part of parts) {
    const object = model.objectMap.get(part.id);
    positions.set(part.positions, vOffset);
    normals.set(part.normals, vOffset);
    if (part.uvs) uvs.set(part.uvs, (vOffset / 3) * 2);
    const rgb = new THREE.Color(...part.color).convertSRGBToLinear().toArray();
    for (let j = 0; j < part.positions.length; j += 3) {
      colors.set(rgb, vOffset + j);
      bounds.expandByPoint(point.fromArray(part.positions, j));
      object.bounds.expandByPoint(point);
    }
    for (let j = 0; j < part.indices.length; j++)
      indices[iOffset + j] = part.indices[j] + vOffset / 3;
    ranges.push({
      object,
      vertexStart: vOffset,
      vertexLength: part.positions.length,
      indexStart: iOffset,
      indexLength: part.indices.length,
    });
    vOffset += part.positions.length;
    iOffset += part.indices.length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  if (parts[0].texture)
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices.slice(), 1));
  geometry.boundingBox = bounds;
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.78,
    flatShading: !!model.cadData && !parts[0].smooth,
    metalness: 0.06,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity === 1,
  });
  let drawMaterial = material;
  if (parts[0].lines || parts[0].texture) {
    material.dispose();
    drawMaterial = parts[0].lines
      ? new THREE.LineBasicMaterial({ vertexColors: true, depthWrite: false })
      : new THREE.MeshBasicMaterial({
          vertexColors: true,
          map: parts[0].texture,
          side: THREE.DoubleSide,
          transparent: true,
          alphaTest: 0.1,
          depthWrite: false,
        });
  }
  const mesh = parts[0].lines
    ? new THREE.LineSegments(geometry, drawMaterial)
    : new THREE.Mesh(geometry, drawMaterial);
  mesh.frustumCulled = true;
  const batch = {
    mesh,
    primitiveSize: parts[0].lines ? 2 : 3,
    model,
    ranges,
    originalIndices: indices,
    originalColors: colors.slice(),
    faceObjects: [],
    edges: null,
  };
  mesh.userData.batch = batch;
  return batch;
}
export function updateBatchVisibility(batch, hidden, isolated) {
  const { ranges, model } = batch;
  const shown = ranges.filter((r) =>
    isObjectVisible(r.object, model, hidden, isolated),
  );
  const count = shown.reduce((n, r) => n + r.indexLength, 0);
  const indices = new Uint32Array(count),
    faceObjects = [];
  let offset = 0;
  for (const range of shown) {
    indices.set(
      batch.originalIndices.subarray(
        range.indexStart,
        range.indexStart + range.indexLength,
      ),
      offset,
    );
    faceObjects.push({
      end: (offset + range.indexLength) / (batch.primitiveSize || 3),
      object: range.object,
    });
    offset += range.indexLength;
  }
  batch.mesh.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  batch.mesh.visible = count > 0;
  batch.faceObjects = faceObjects;
  if (batch.edges) batch.edges.visible = false;
}
export function pickedObject(batch, faceIndex) {
  // Binary search avoids scanning all objects for every hit in a large model.
  let lo = 0,
    hi = batch.faceObjects.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (faceIndex < batch.faceObjects[mid].end) hi = mid - 1;
    else lo = mid + 1;
  }
  return batch.faceObjects[lo]?.object;
}
export function highlightBatch(batch, selected, colorMode) {
  const colors = batch.mesh.geometry.attributes.color;
  colors.array.set(batch.originalColors);
  const selection = new THREE.Color("#46c797").toArray();
  const discipline = new THREE.Color(batch.model.color).toArray();
  const typeColors = [
    "#739caf",
    "#baa07d",
    "#8da488",
    "#ad8296",
    "#b2b3a0",
    "#8b93b4",
  ];
  for (const range of batch.ranges) {
    let color = null;
    if (selected.has(range.object.key)) color = selection;
    else if (colorMode === "discipline") color = discipline;
    else if (colorMode === "type")
      color = new THREE.Color(
        typeColors[
          [...range.object.ifcClass].reduce((n, c) => n + c.charCodeAt(0), 0) %
            typeColors.length
        ],
      ).toArray();
    if (color)
      for (
        let v = range.vertexStart;
        v < range.vertexStart + range.vertexLength;
        v += 3
      )
        colors.array.set(color, v);
  }
  colors.needsUpdate = true;
}
export function disposeBatch(batch) {
  batch.mesh.geometry.dispose();
  batch.mesh.material.map?.dispose();
  batch.mesh.material.dispose();
  if (batch.edges) {
    batch.edges.geometry.dispose();
    batch.edges.material.dispose();
  }
}
