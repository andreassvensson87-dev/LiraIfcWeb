import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { buildBatches } from "../src/batches.js";
import { selectInRectangle } from "../src/rectangle-selection.js";

function modelWith(definitions) {
  const model = { visible: true, objectMap: new Map(), parts: [] };
  for (const [id, geometries] of definitions.entries()) {
    model.objectMap.set(id, { key: `model:${id}`, bounds: new THREE.Box3() });
    geometries.forEach((geometry, i) => {
      model.parts.push({
        id,
        positions: geometry.attributes.position.array,
        normals:
          geometry.attributes.normal?.array ||
          new Float32Array(geometry.attributes.position.array.length),
        indices:
          geometry.index?.array ||
          Uint32Array.from(
            { length: geometry.attributes.position.count },
            (_, j) => j,
          ),
        opacity: i % 2 ? 0.5 : 1,
        color: [0.6, 0.6, 0.6],
      });
    });
  }
  return buildBatches(model);
}
const box = (x, y, z, size = 1) =>
  new THREE.BoxGeometry(size, size, size).translate(x, y, z);
const triangle = (points) =>
  new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points.flat(), 3),
  );
function camera(perspective = false) {
  const camera = perspective
    ? new THREE.PerspectiveCamera(60, 1, 1, 100)
    : new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}
const select = (batches, start, end, options = {}) =>
  selectInRectangle(
    batches,
    options.camera || camera(),
    1000,
    1000,
    start,
    end,
    options.hidden,
    options.isolated,
    options.planes,
  ).map((o) => o.key);

test("window encloses whole objects, crossing intersects surfaces rather than just bounds", () => {
  const batches = modelWith([
    [
      triangle([
        [0, 0, 0],
        [3, 0, 0],
        [0, 3, 0],
      ]),
    ],
  ]);
  assert.deepEqual(select(batches, { x: 490, y: 190 }, { x: 810, y: 510 }), [
    "model:0",
  ]);
  assert.deepEqual(select(batches, { x: 490, y: 400 }, { x: 610, y: 510 }), []);
  assert.deepEqual(select(batches, { x: 610, y: 400 }, { x: 490, y: 510 }), [
    "model:0",
  ]);
  assert.deepEqual(select(batches, { x: 790, y: 210 }, { x: 750, y: 250 }), []);
  // A rectangle entirely inside a projected triangle still intersects its surface.
  assert.deepEqual(select(batches, { x: 550, y: 450 }, { x: 520, y: 480 }), [
    "model:0",
  ]);
});

test("multipart IFC object must be enclosed across all batches; hidden and isolated objects are excluded", () => {
  const batches = modelWith([[box(-2, 0, 0), box(2, 0, 0)], [box(0, 0, -2)]]);
  const left = [
    { x: 240, y: 440 },
    { x: 360, y: 560 },
  ];
  assert.deepEqual(select(batches, ...left), []);
  assert.deepEqual(select(batches, ...left.toReversed()), ["model:0"]);
  const full = [
    { x: 0, y: 0 },
    { x: 1000, y: 1000 },
  ];
  assert.deepEqual(select(batches, ...full), ["model:0", "model:1"]);
  assert.deepEqual(select(batches, ...full, { hidden: new Set(["model:0"]) }), [
    "model:1",
  ]);
  assert.deepEqual(
    select(batches, ...full, { isolated: new Set(["model:0"]) }),
    ["model:0"],
  );
  batches[0].model.visible = false;
  assert.deepEqual(select(batches, ...full), []);
});

test("camera depth clipping works in both projections and selects occluded objects too", () => {
  for (const perspective of [false, true]) {
    const batches = modelWith([
      [box(0, 0, 0)],
      [box(0, 0, -3)],
      [box(0, 0, 12)],
      [box(0, 0, -110)],
    ]);
    assert.deepEqual(
      select(
        batches,
        { x: 0, y: 0 },
        { x: 1000, y: 1000 },
        { camera: camera(perspective) },
      ),
      ["model:0", "model:1"],
    );
  }
  const batches = modelWith([
    [
      triangle([
        [-0.1, -0.1, 8.5],
        [0.1, -0.1, 10.5],
        [0, 0.1, 8.5],
      ]),
    ],
  ]);
  assert.deepEqual(
    select(
      batches,
      { x: 1000, y: 0 },
      { x: 0, y: 1000 },
      { camera: camera(true) },
    ),
    ["model:0"],
  );
});

test("window and crossing use actual clipped polygons, not the original object bounds", () => {
  const batches = modelWith([
    [
      triangle([
        [-2, -1, 0],
        [2, -1, 0],
        [0, 1, 0],
      ]),
    ],
    [box(-3, 0, 0)],
  ]);
  const planes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 0)];
  assert.deepEqual(
    select(batches, { x: 495, y: 390 }, { x: 710, y: 610 }, { planes }),
    ["model:0"],
  );
  assert.deepEqual(
    select(batches, { x: 400, y: 400 }, { x: 250, y: 600 }, { planes }),
    [],
  );
});

test("section box caps remain selectable even when the entire cut box lies inside a solid", () => {
  const batches = modelWith([[box(0, 0, 0, 8)]]);
  const planes = [];
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      const normal = new THREE.Vector3().setComponent(axis, sign);
      planes.push(new THREE.Plane(normal, 1));
    }
  assert.deepEqual(
    select(batches, { x: 390, y: 390 }, { x: 610, y: 610 }, { planes }),
    ["model:0"],
  );
  assert.deepEqual(
    select(batches, { x: 550, y: 450 }, { x: 450, y: 550 }, { planes }),
    ["model:0"],
  );
  assert.deepEqual(
    select(batches, { x: 800, y: 100 }, { x: 700, y: 200 }, { planes }),
    [],
  );
});

test("section cap holes remain empty during crossing selection", () => {
  const shape = new THREE.Shape();
  shape.moveTo(-3, -3);
  shape.lineTo(3, -3);
  shape.lineTo(3, 3);
  shape.lineTo(-3, 3);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-1, -1);
  hole.lineTo(-1, 1);
  hole.lineTo(1, 1);
  hole.lineTo(1, -1);
  hole.closePath();
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 8,
    bevelEnabled: false,
  }).translate(0, 0, -4);
  const batches = modelWith([[geometry]]);
  // Only cap surfaces remain inside this slab: the original front/back faces are clipped away.
  const planes = [
    new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.5),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.5),
  ];
  assert.deepEqual(
    select(batches, { x: 550, y: 450 }, { x: 450, y: 550 }, { planes }),
    [],
  );
  assert.deepEqual(
    select(batches, { x: 760, y: 300 }, { x: 650, y: 400 }, { planes }),
    ["model:0"],
  );
});
