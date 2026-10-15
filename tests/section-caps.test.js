import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  buildBatches,
  updateBatchVisibility,
  disposeBatch,
} from "../src/batches.js";
import { objectAtSectionPoint } from "../src/section-caps.js";

function fixture(geometry) {
  if (!geometry.index)
    geometry.setIndex(
      Array.from({ length: geometry.attributes.position.count }, (_, i) => i),
    );
  const object = { key: "test:1", bounds: new THREE.Box3() };
  const model = {
    visible: true,
    objectMap: new Map([[1, object]]),
    parts: [
      {
        id: 1,
        positions: geometry.attributes.position.array.slice(),
        normals: geometry.attributes.normal.array.slice(),
        indices: geometry.index.array.slice(),
        color: [0.5, 0.5, 0.5],
        opacity: 1,
      },
    ],
  };
  const batches = buildBatches(model);
  batches.forEach((batch) => updateBatchVisibility(batch, new Set(), null));
  geometry.dispose();
  return { object, model, batches };
}

test("a filled cut resolves the correct object in either clipping direction", () => {
  const { object, batches } = fixture(new THREE.BoxGeometry(2, 2, 2));
  for (const axis of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [-1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
  ]) {
    const plane = new THREE.Plane(new THREE.Vector3(...axis), 0);
    assert.equal(
      objectAtSectionPoint(new THREE.Vector3(), plane, batches),
      object,
    );
    assert.equal(
      objectAtSectionPoint(new THREE.Vector3(3, 3, 3), plane, batches),
      null,
    );
  }
  batches.forEach((batch) =>
    updateBatchVisibility(batch, new Set(["test:1"]), null),
  );
  assert.equal(
    objectAtSectionPoint(
      new THREE.Vector3(),
      new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
      batches,
    ),
    null,
  );
  batches.forEach(disposeBatch);
});

test("a hollow solid keeps its opening empty in the cross-section", () => {
  const shape = new THREE.Shape();
  shape.moveTo(-1, -1);
  shape.lineTo(1, -1);
  shape.lineTo(1, 1);
  shape.lineTo(-1, 1);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-0.5, -0.5);
  hole.lineTo(-0.5, 0.5);
  hole.lineTo(0.5, 0.5);
  hole.lineTo(0.5, -0.5);
  hole.closePath();
  shape.holes.push(hole);
  const { object, batches } = fixture(
    new THREE.ExtrudeGeometry(shape, {
      depth: 2,
      bevelEnabled: false,
    }).translate(0, 0, -1),
  );
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  assert.equal(
    objectAtSectionPoint(new THREE.Vector3(0, 0, 0), plane, batches),
    null,
  );
  assert.equal(
    objectAtSectionPoint(new THREE.Vector3(0.75, 0, 0), plane, batches),
    object,
  );
  batches.forEach(disposeBatch);
});

test("Cap passes skip tangent and wholly one-sided batches but retain actual cuts", async () => {
  const { SectionCaps, crossesSectionPlane } = await import(
    "../src/section-caps.js"
  );
  const bounds = new THREE.Box3(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, 1, 1),
  );
  const normal = new THREE.Vector3(1, 0, 0);
  assert.equal(crossesSectionPlane(bounds, new THREE.Plane(normal, 0)), true);
  assert.equal(crossesSectionPlane(bounds, new THREE.Plane(normal, 1)), false);
  assert.equal(crossesSectionPlane(bounds, new THREE.Plane(normal, -1)), false);
  assert.equal(crossesSectionPlane(bounds, new THREE.Plane(normal, 3)), false);
  const previous = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({
        fillRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
      }),
    }),
  };
  const scene = new THREE.Scene(),
    { batches } = fixture(new THREE.BoxGeometry(2, 2, 2));
  const caps = new SectionCaps(scene);
  try {
    caps.update([new THREE.Plane(normal, 1)], bounds, batches);
    assert.equal(caps.passes[0].cap.visible, false);
    assert.ok(
      caps.passes[0].stencils.every((s) => !s.back.visible && !s.front.visible),
    );
    caps.update([new THREE.Plane(normal, 0)], bounds, batches);
    assert.equal(caps.passes[0].cap.visible, true);
    assert.ok(
      caps.passes[0].stencils.every((s) => s.back.visible && s.front.visible),
    );
  } finally {
    caps.clear();
    caps.texture.dispose();
    batches.forEach(disposeBatch);
    globalThis.document = previous;
  }
});
