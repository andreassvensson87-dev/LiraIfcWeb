import * as THREE from "three";
import { MeshBVH, CENTER, acceleratedRaycast } from "three-mesh-bvh";
import { isObjectVisible } from "./model-state.js";

// Keep large opaque IFC chunks spatially local. The stencil renderer can then
// skip whole chunks that do not cross a cut instead of redrawing the building.
function spatialParts(parts) {
  if (parts.length < 256) return parts;
  const lower = [Infinity, Infinity, Infinity],
    upper = [-Infinity, -Infinity, -Infinity];
  const centers = parts.map((part) => {
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < part.positions.length; i += 3)
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], part.positions[i + axis]);
        max[axis] = Math.max(max[axis], part.positions[i + axis]);
      }
    const center = min.map((v, axis) => (v + max[axis]) / 2);
    center.forEach((v, axis) => {
      lower[axis] = Math.min(lower[axis], v);
      upper[axis] = Math.max(upper[axis], v);
    });
    return { part, center };
  });
  const spread = (v) => {
    v = (v | (v << 16)) & 0x030000ff;
    v = (v | (v << 8)) & 0x0300f00f;
    v = (v | (v << 4)) & 0x030c30c3;
    return (v | (v << 2)) & 0x09249249;
  };
  for (const entry of centers) {
    const xyz = entry.center.map((v, axis) =>
      Math.round((1023 * (v - lower[axis])) / (upper[axis] - lower[axis] || 1)),
    );
    entry.key = spread(xyz[0]) | (spread(xyz[1]) << 1) | (spread(xyz[2]) << 2);
  }
  centers.sort((a, b) => a.key - b.key);
  return centers.map((entry) => entry.part);
}

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
    for (const part of model.cadData || Number(opacity.split(":")[0]) < 1
      ? parts
      : spatialParts(parts)) {
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
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
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
  if (!parts[0].lines) mesh.raycast = acceleratedRaycast;
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
  if (
    batch.shownRanges?.length === shown.length &&
    shown.every((range, i) => range === batch.shownRanges[i])
  )
    return;
  batch.shownRanges = shown;
  const count = shown.reduce((n, r) => n + r.indexLength, 0);
  const allShown = shown.length === ranges.length;
  const indices = allShown ? batch.originalIndices : new Uint32Array(count),
    faceObjects = [];
  let offset = 0;
  for (const range of shown) {
    if (!allShown)
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
  // Indirection preserves triangle order and therefore IFC identities, original
  // ranges, face snapping and visibility. Rebuild only when the index changes.
  const geometry = batch.mesh.geometry;
  if (batch.bvhIndices !== indices) {
    geometry.boundsTree = null;
    if (batch.primitiveSize === 3 && count >= 3000)
      geometry.boundsTree = new MeshBVH(geometry, {
        indirect: true,
        strategy: CENTER,
        targetLeafSize: 12,
      });
    batch.bvhIndices = indices;
  }
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
  batch.mesh.geometry.boundsTree = null;
  batch.mesh.geometry.dispose();
  batch.mesh.material.map?.dispose();
  batch.mesh.material.dispose();
  if (batch.edges) {
    batch.edges.geometry.dispose();
    batch.edges.material.dispose();
  }
}
