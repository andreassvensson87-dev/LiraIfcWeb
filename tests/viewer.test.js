import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  objectKey,
  matchesObject,
  viewSnapshot,
  canRestoreView,
  flattenProperties,
  propertySetRows,
} from "../src/model-state.js";
import {
  buildBatches,
  updateBatchVisibility,
  pickedObject,
  disposeBatch,
} from "../src/batches.js";

test("IFC identities remain distinct between models", () => {
  assert.notEqual(objectKey("architecture", 20), objectKey("structure", 20));
  const snapshot = viewSnapshot(
    [
      { id: "architecture", visible: true },
      { id: "structure", visible: false },
    ],
    new Set(["architecture:20"]),
    new Set(["structure:20"]),
    {},
    { mode: "none" },
  );
  assert.equal(snapshot.visibility.structure, false);
  assert.deepEqual(snapshot.hidden, ["architecture:20"]);
  assert.equal(canRestoreView(snapshot, [{ id: "architecture" }]), false);
  assert.equal(
    canRestoreView(snapshot, [{ id: "architecture" }, { id: "structure" }]),
    true,
  );
});
test("hidden objects are removed from batched geometry and picking follows the new index", () => {
  const model = { id: "test", visible: true, objectMap: new Map(), parts: [] };
  for (let id = 1; id <= 2; id++) {
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(id * 2, 0, 0);
    const object = {
      key: objectKey(model.id, id),
      expressId: id,
      bounds: new THREE.Box3(),
    };
    model.objectMap.set(id, object);
    model.parts.push({
      id,
      positions: geo.attributes.position.array.slice(),
      normals: geo.attributes.normal.array.slice(),
      indices: geo.index.array.slice(),
      color: [0.5, 0.5, 0.5],
      opacity: 1,
    });
    geo.dispose();
  }
  const [batch] = buildBatches(model);
  updateBatchVisibility(batch, new Set(), null);
  assert.equal(batch.mesh.geometry.index.count, 72);
  assert.equal(pickedObject(batch, 0).expressId, 1);
  assert.equal(pickedObject(batch, 12).expressId, 2);
  updateBatchVisibility(batch, new Set(["test:1"]), null);
  assert.equal(batch.mesh.geometry.index.count, 36);
  assert.equal(pickedObject(batch, 0).expressId, 2);
  updateBatchVisibility(batch, new Set(), new Set(["test:1"]));
  assert.equal(pickedObject(batch, 0).expressId, 1);
  model.visible = false;
  updateBatchVisibility(batch, new Set(), null);
  assert.equal(batch.mesh.visible, false);
  assert.deepEqual(
    model.objectMap.get(1).bounds.getSize(new THREE.Vector3()).toArray(),
    [1, 1, 1],
  );
  disposeBatch(batch);
});
test("search includes IFC IDs, types and storeys and property values survive flattening", () => {
  const object = {
    name: "Balk K-204",
    ifcClass: "IfcBeam",
    globalId: "abc123",
    level: "Plan 02",
  };
  assert.equal(matchesObject(object, "plan 02", "IfcBeam"), true);
  assert.equal(matchesObject(object, "ABC123"), true);
  assert.equal(matchesObject(object, "balk", "IfcColumn"), false);
  assert.deepEqual(
    flattenProperties({
      Name: { type: 1, value: "Balk" },
      IsExternal: { type: 3, value: false },
      Count: { value: 0 },
    }),
    [
      ["Name", "Balk"],
      ["IsExternal", "false"],
      ["Count", "0"],
    ],
  );
  assert.deepEqual(
    propertySetRows([
      {
        Name: { value: "Höjd" },
        NominalValue: {
          _representationValue: "115",
          _internalValue: 115,
          name: "IFCLENGTHMEASURE",
        },
      },
      { Name: { value: "Bärande" }, NominalValue: { value: false } },
      { Name: { value: "Antal" }, CountValue: 0 },
    ]),
    [
      ["Höjd", "115"],
      ["Bärande", "false"],
      ["Antal", "0"],
    ],
  );
});
