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
  const g = new THREE.BoxGeometry(2, 4, 6),
    object = { expressId: 1, key: "ifc:1", bounds: new THREE.Box3() };
  const model = {
    visible: true,
    objects: [object],
    objectMap: new Map([[1, object]]),
    parts: [
      {
        id: 1,
        positions: g.attributes.position.array.slice(),
        normals: g.attributes.normal.array.slice(),
        indices: g.index.array.slice(),
        color: [1, 1, 1],
        opacity: 1,
      },
    ],
  };
  model.batches = buildBatches(model);
  return model;
}
test("IFC placement translates/rotates real geometry and updates object bounds without accumulating edits", () => {
  const model = fixture();
  const placement = { x: 5, elevation: 3, z: 7, rotation: 90 };
  placeIfcModel(model, placement);
  for (const [actual, expected] of [
    [model.objects[0].bounds.min.toArray(), [2, 1, 6]],
    [model.objects[0].bounds.max.toArray(), [8, 5, 8]],
  ])
    actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-6));
  const first =
    model.batches[0].mesh.geometry.attributes.position.array.slice();
  placeIfcModel(model, placement);
  assert.deepEqual(
    model.batches[0].mesh.geometry.attributes.position.array,
    first,
  );
  placeIfcModel(model, { x: 0, elevation: 0, z: 0, rotation: 0 });
  assert.deepEqual(model.objects[0].bounds.min.toArray(), [-1, -2, -3]);
  assert.deepEqual(model.objects[0].bounds.max.toArray(), [1, 2, 3]);
});
test("IFC alignment retains identity, hidden ranges, normals and valid ray picking after showing again", () => {
  const model = fixture(),
    batch = model.batches[0],
    object = model.objects[0];
  updateBatchVisibility(batch, new Set(["ifc:1"]), null);
  placeIfcModel(model, { x: 5, elevation: 3, z: 7, rotation: 90 });
  assert.equal(batch.mesh.geometry.index.count, 0);
  assert.equal(model.objects[0], object);
  const n = batch.mesh.geometry.attributes.normal.array;
  for (let i = 0; i < n.length; i += 3)
    assert.ok(Math.abs(Math.hypot(...n.slice(i, i + 3)) - 1) < 1e-6);
  updateBatchVisibility(batch, new Set(), null);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(5, 20, 7),
    new THREE.Vector3(0, -1, 0),
  );
  const hits = ray.intersectObject(batch.mesh);
  assert.ok(hits.length);
  assert.equal(pickedObject(batch, hits[0].faceIndex), object);
});
