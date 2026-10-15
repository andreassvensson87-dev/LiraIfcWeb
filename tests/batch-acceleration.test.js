import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  buildBatches,
  updateBatchVisibility,
  pickedObject,
} from "../src/batches.js";
import { placeIfcModel } from "../src/model-placement.js";
function fixture() {
  const model = {
    id: "bvh",
    visible: true,
    objects: [],
    parts: [],
    objectMap: new Map(),
  };
  for (let id = 1; id <= 2; id++) {
    const g = new THREE.BoxGeometry(2, 2, 2, 12, 12, 12).translate(
      0,
      0,
      id === 1 ? 2 : -2,
    );
    const object = {
      key: `bvh:${id}`,
      expressId: id,
      modelId: "bvh",
      bounds: new THREE.Box3(),
    };
    model.objects.push(object);
    model.objectMap.set(id, object);
    model.parts.push({
      id,
      positions: g.attributes.position.array,
      normals: g.attributes.normal.array,
      indices: g.index.array,
      color: [1, 1, 1],
      opacity: 1,
    });
  }
  model.batches = buildBatches(model);
  model.batches.forEach((b) => updateBatchVisibility(b, new Set(), null));
  return model;
}
function ray() {
  const r = new THREE.Raycaster(
    new THREE.Vector3(0.15, 0.27, 10),
    new THREE.Vector3(0, 0, -1),
  );
  r.firstHitOnly = true;
  return r;
}
test("BVH retains index order and original object identities, including hidden ranges and clipped front surfaces", () => {
  const model = fixture(),
    batch = model.batches[0],
    g = batch.mesh.geometry;
  assert.ok(g.boundsTree);
  assert.equal(g.boundsTree.indirect, true);
  assert.equal(
    g.index.array,
    batch.originalIndices,
    "all-visible geometry shares its original index buffer",
  );
  const index = Array.from(g.index.array),
    tree = g.boundsTree;
  updateBatchVisibility(batch, new Set(), null);
  assert.equal(g.boundsTree, tree, "unchanged visibility does not rebuild");
  const accelerated = ray().intersectObject(batch.mesh);
  const plain = new THREE.Mesh(g, batch.mesh.material),
    conventional = ray().intersectObject(plain);
  assert.equal(accelerated[0].faceIndex, conventional[0].faceIndex);
  assert.equal(pickedObject(batch, accelerated[0].faceIndex).expressId, 1);
  assert.deepEqual(Array.from(g.index.array), index);
  updateBatchVisibility(batch, new Set(["bvh:1"]), null);
  assert.notEqual(g.boundsTree, tree);
  assert.equal(
    pickedObject(batch, ray().intersectObject(batch.mesh)[0].faceIndex)
      .expressId,
    2,
  );
  updateBatchVisibility(batch, new Set(), null);
  const all = ray();
  all.firstHitOnly = false;
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  const remaining = all
    .intersectObject(batch.mesh)
    .find((h) => plane.distanceToPoint(h.point) >= 0);
  assert.equal(pickedObject(batch, remaining.faceIndex).expressId, 2);
  updateBatchVisibility(batch, new Set(), new Set(["bvh:1"]));
  assert.equal(
    pickedObject(batch, ray().intersectObject(batch.mesh)[0].faceIndex)
      .expressId,
    1,
  );
});
test("Reference placement refits BVH bounds instead of leaving picking at the old location", () => {
  const model = fixture(),
    batch = model.batches[0],
    tree = batch.mesh.geometry.boundsTree;
  placeIfcModel(model, { x: 20, z: 0, elevation: 0, rotation: 0 });
  assert.equal(batch.mesh.geometry.boundsTree, tree);
  assert.equal(ray().intersectObject(batch.mesh).length, 0);
  const moved = ray();
  moved.ray.origin.x += 20;
  assert.equal(
    pickedObject(batch, moved.intersectObject(batch.mesh)[0].faceIndex)
      .expressId,
    1,
  );
});

test("Large opaque IFC batches stay spatially local without losing object identities", () => {
  const model = {
    id: "spatial",
    visible: true,
    objects: [],
    parts: [],
    objectMap: new Map(),
  };
  for (let id = 0; id < 500; id++) {
    const g = new THREE.BoxGeometry(2, 2, 2, 12, 12, 12).translate(
      id % 2 === 0 ? -100 : 100,
      0,
      0,
    );
    const object = {
      key: `spatial:${id}`,
      expressId: id,
      modelId: "spatial",
      bounds: new THREE.Box3(),
    };
    model.objects.push(object);
    model.objectMap.set(id, object);
    model.parts.push({
      id,
      positions: g.attributes.position.array,
      normals: g.attributes.normal.array,
      indices: g.index.array,
      color: [1, 1, 1],
      opacity: 1,
    });
  }
  model.batches = buildBatches(model);
  const crossing = model.batches.filter(
    (b) =>
      b.mesh.geometry.boundingBox.min.x < 0 &&
      b.mesh.geometry.boundingBox.max.x > 0,
  );
  assert.equal(model.batches.length, 3);
  assert.ok(
    crossing.length <= 1,
    "separated spatial regions must not be mixed throughout all batches",
  );
  assert.deepEqual(
    new Set(model.batches.flatMap((b) => b.ranges.map((r) => r.object.key))),
    new Set(model.objects.map((o) => o.key)),
  );
});

test("Edge geometry is reused until visibility or positions change and is released when disabled", async () => {
  const { Viewer } = await import("../src/viewer.js");
  const model = fixture(),
    batch = model.batches[0],
    viewer = {
      scene: new THREE.Scene(),
      batches: model.batches,
      clippingPlanes: [],
      invalidate() {},
    };
  const setEdges = (enabled) => Viewer.prototype.setEdges.call(viewer, enabled);
  setEdges(true);
  const first = batch.edges;
  let disposed = 0;
  first.geometry.addEventListener("dispose", () => disposed++);
  setEdges(true);
  assert.equal(batch.edges, first);
  assert.equal(disposed, 0);
  updateBatchVisibility(batch, new Set(["bvh:1"]), null);
  setEdges(true);
  assert.notEqual(batch.edges, first);
  assert.equal(disposed, 1);
  const visible = batch.edges;
  batch.mesh.geometry.attributes.position.needsUpdate = true;
  setEdges(true);
  assert.notEqual(batch.edges, visible);
  setEdges(false);
  assert.equal(batch.edges, null);
  assert.equal(batch.edgeSourceIndex, null);
  assert.equal(viewer.scene.children.length, 0);
});
