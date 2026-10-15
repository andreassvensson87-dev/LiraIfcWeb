import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { readCadDrawing } from "../src/cad-data.js";
import { buildCadModel, cadPoint, initialCadOrigin } from "../src/cad-model.js";
import {
  buildBatches,
  updateBatchVisibility,
  pickedObject,
} from "../src/batches.js";
import { selectInRectangle } from "../src/rectangle-selection.js";
const source = await readFile(
  new URL("./reference-plan.dxf", import.meta.url),
  "utf8",
);

test("DXF imports units, Unicode text, layers and curved entities in original double-precision coordinates", () => {
  const drawing = readCadDrawing(source);
  assert.equal(drawing.unitFactor, 0.001);
  assert.equal(drawing.unitKnown, true);
  assert.equal(drawing.entities.length, 4);
  assert.ok(
    drawing.entities.some((e) => e.type === "text" && e.text === "Plan Å"),
  );
  assert.equal(drawing.entities.filter((e) => e.layer === "Vägg").length, 3);
  assert.ok(drawing.entities[2].points.length > 70);
  assert.deepEqual(drawing.entities[0].points[0], [1000000, 2000000]);
  assert.deepEqual(initialCadOrigin(drawing), [1000, 0, -2003]);
});

test("CAD placement converts drawing XY to model XZ in metres before float GPU storage", () => {
  const point = cadPoint(
    [1000, 2000],
    { unitFactor: 0.001, rotation: 90, x: 10, z: 20, elevation: 3 },
    [0, 0, 0],
  );
  assert.ok(Math.abs(point[0] - 8) < 1e-10);
  assert.equal(point[1], 3);
  assert.ok(Math.abs(point[2] - 19) < 1e-10);
  const drawing = readCadDrawing(source);
  drawing.entities = drawing.entities.filter((e) => e.type === "line");
  const model = buildCadModel({
    id: "cad",
    cadData: drawing,
    format: "DXF",
    origin: initialCadOrigin(drawing),
    placement: { unitFactor: 0.001, rotation: 0, x: 0, z: 0, elevation: 2 },
  });
  assert.deepEqual(
    [...model.parts[0].positions.slice(0, 6)],
    [0, 2, 3, 4, 2, 3],
  );
  assert.equal(model.objects[0].referenceProperties.Lager, "Vägg");
});

function fixture() {
  const drawing = readCadDrawing(source);
  drawing.entities = drawing.entities.filter((e) => e.type === "line");
  const model = buildCadModel({
    id: "cad",
    visible: true,
    color: "#405d69",
    cadData: drawing,
    format: "DXF",
    origin: initialCadOrigin(drawing),
    placement: { unitFactor: 0.001, rotation: 0, x: 0, z: 0, elevation: 0 },
  });
  model.objectMap = new Map(
    model.objects.map((object) => {
      object.key = `cad:${object.expressId}`;
      object.bounds = new THREE.Box3();
      return [object.expressId, object];
    }),
  );
  return buildBatches(model);
}

test("CAD line batches retain independent picking and hiding without treating pairs of vertices as triangles", () => {
  const batches = fixture(),
    batch = batches[0];
  assert.equal(batch.primitiveSize, 2);
  assert.equal(batch.mesh.isLineSegments, true);
  updateBatchVisibility(batch, new Set(), null);
  assert.equal(pickedObject(batch, 0).key, "cad:1");
  assert.equal(pickedObject(batch, 1).key, "cad:2");
  updateBatchVisibility(batch, new Set(["cad:1", "cad:3"]), null);
  assert.equal(batch.mesh.geometry.index.count, 2);
  assert.equal(pickedObject(batch, 0).key, "cad:2");
});

test("CAD lines support window/crossing selection and are clipped correctly by sections", () => {
  const batches = fixture(),
    camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.set(0, 10, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  const select = (start, end, planes = []) =>
    selectInRectangle(
      batches,
      camera,
      1000,
      1000,
      start,
      end,
      new Set(),
      null,
      planes,
    ).map((o) => o.key);
  assert.deepEqual(select({ x: 690, y: 790 }, { x: 710, y: 810 }), []);
  assert.deepEqual(select({ x: 710, y: 790 }, { x: 690, y: 810 }), ["cad:1"]);
  const planes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -3)];
  assert.deepEqual(select({ x: 710, y: 790 }, { x: 690, y: 810 }, planes), []);
  assert.deepEqual(select({ x: 790, y: 790 }, { x: 910, y: 810 }, planes), [
    "cad:1",
  ]);
});

const surfaces = readCadDrawing(
  await readFile(new URL("./reference-surfaces.dxf", import.meta.url), "utf8"),
);
function surfaceModel() {
  return buildCadModel({
    id: "surfaces",
    visible: true,
    color: "#405d69",
    format: "DXF",
    cadData: surfaces,
    origin: [0, 0, 0],
    placement: { unitFactor: 1, rotation: 0, x: 0, z: 0, elevation: 0 },
  });
}
test("CAD surfaces retain 3D topology for faces, SOLID/TRACE, polyface, polygon mesh, concave MESH and elevated blocks", () => {
  assert.equal(surfaces.entities.length, 8);
  assert.deepEqual(surfaces.skipped, []);
  assert.equal(surfaces.entities.filter((e) => e.type === "mesh").length, 7);
  const model = surfaceModel();
  assert.equal(model.objects.filter((o) => o.ifcClass === "CADMesh").length, 7);
  assert.equal(model.parts[0].indices.length, 6);
  assert.deepEqual([...model.parts[0].positions.slice(6, 9)], [4, 2, -4]);
  assert.equal(model.parts[5].indices.length, 9);
  assert.deepEqual([...model.parts[6].positions.slice(0, 3)], [18, 5, 0]);
  assert.deepEqual([...model.parts[6].positions.slice(6, 9)], [18, 8, -2]);
  assert.deepEqual([...model.parts[7].positions.slice(-3)], [18, 6, -10]);
  for (const part of model.parts.slice(0, 7)) {
    assert.ok([...part.normals].every(Number.isFinite));
    assert.ok(part.normals.some((n) => Math.abs(n) > 0.5));
  }
  // SOLID corners are stored in strip order. The two triangles must cover the full square.
  const part = model.parts[1],
    p = part.positions;
  let area = 0;
  for (let i = 0; i < part.indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((j) =>
      new THREE.Vector3().fromArray(p, 3 * part.indices[i + j]),
    );
    area += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  assert.equal(area, 16);
});
test("Filled CAD surfaces support picking, hiding and clipped rectangle selection", () => {
  const model = surfaceModel();
  model.objectMap = new Map(
    model.objects.map((o) => {
      o.key = `surfaces:${o.expressId}`;
      o.bounds = new THREE.Box3();
      return [o.expressId, o];
    }),
  );
  const batches = buildBatches(model),
    batch = batches.find((b) => b.primitiveSize === 3);
  updateBatchVisibility(batch, new Set(), null);
  assert.equal(pickedObject(batch, 0).key, "surfaces:1");
  assert.equal(pickedObject(batch, 2).key, "surfaces:2");
  const ray = new THREE.Raycaster(
    new THREE.Vector3(2, 20, -2),
    new THREE.Vector3(0, -1, 0),
  );
  assert.ok(ray.intersectObject(batch.mesh).length > 0);
  const count = batch.mesh.geometry.index.count;
  updateBatchVisibility(batch, new Set(["surfaces:1"]), null);
  assert.equal(batch.mesh.geometry.index.count, count - 6);
  assert.equal(ray.intersectObject(batch.mesh).length, 0);
  updateBatchVisibility(batch, new Set(), null);
  const camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 100);
  camera.position.set(10, 30, -5);
  camera.up.set(0, 0, -1);
  camera.lookAt(10, 0, -5);
  camera.updateMatrixWorld();
  const select = (planes = []) =>
    selectInRectangle(
      batches,
      camera,
      1000,
      1000,
      { x: 1000, y: 0 },
      { x: 0, y: 1000 },
      new Set(),
      null,
      planes,
    );
  assert.equal(select().length, 8);
  assert.equal(
    select([new THREE.Plane(new THREE.Vector3(1, 0, 0), -100)]).length,
    0,
  );
});
test("Malformed mesh indices fail explicitly instead of creating corrupt GPU geometry", () => {
  // Exercise source validation through the public importer.
  return readFile(
    new URL("./reference-surfaces.dxf", import.meta.url),
    "utf8",
  ).then((s) => {
    assert.throws(
      () => readCadDrawing(s.replace("90\n4\n94", "90\n99\n94")),
      /index/,
    );
  });
});

test("SOLID/TRACE surfaces honor tilted and reversed OCS normals rather than flattening into the drawing plane", async () => {
  const source = await readFile(
    new URL("./reference-surfaces.dxf", import.meta.url),
    "utf8",
  );
  const tilted = readCadDrawing(
    source.replace("0\nTRACE\n", "210\n0\n220\n1\n230\n0\n0\nTRACE\n"),
  );
  assert.deepEqual(tilted.entities[1].points[0], [-6, 2, 0]);
  const reversed = readCadDrawing(
    source.replace("0\nTRACE\n", "210\n0\n220\n0\n230\n-1\n0\nTRACE\n"),
  );
  assert.deepEqual(reversed.entities[1].points[0], [-6, 0, -2]);
});

const blockSource = await readFile(
  new URL("./reference-solid-blocks.dxf", import.meta.url),
  "utf8",
);
const solidTriangle = {
  complete: true,
  positions: [
    [2, 3, 4],
    [3, 3, 4],
    [2, 4, 4],
  ],
  normals: [
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
  ],
  indices: [0, 1, 2],
};
test("DWG solids match by handle, inherit layer/ByBlock colors and preserve nested base points, mirrored nonuniform scale and rotations", () => {
  const drawing = readCadDrawing(blockSource, {
    solids: [
      { handle: "a1", ...solidTriangle },
      { handle: "B2", ...solidTriangle },
    ],
  });
  assert.equal(drawing.entities.length, 4);
  assert.deepEqual(drawing.skipped, []);
  const [nested, repeated, direct, line] = drawing.entities;
  assert.equal(nested.layer, "Red layer");
  assert.equal(nested.color, "#ff0000");
  assert.equal(nested.sourceHandle, "A1");
  assert.equal(repeated.layer, "Green layer");
  assert.equal(repeated.color, "#0cb48c");
  assert.equal(direct.layer, "Own layer");
  assert.equal(direct.color, "#123456");
  assert.equal(line.type, "line");
  assert.ok(Math.abs(nested.points[0][0] - 98) < 1e-10);
  assert.ok(Math.abs(nested.points[0][1] - (200 + 2 * Math.sqrt(3))) < 1e-10);
  assert.equal(nested.points[0][2], 14);
  assert.deepEqual(repeated.points[0], [51, 1, 1]);
  assert.deepEqual(nested.normals[0], [0, 0, 1]);
  assert.deepEqual(nested.indices, [0, 2, 1]);
  const model = buildCadModel({
    id: "solid",
    format: "DWG",
    cadData: drawing,
    origin: [0, 0, 0],
    placement: { unitFactor: 1, rotation: 90, x: 0, z: 0, elevation: 0 },
  });
  assert.equal(model.objects[0].referenceProperties["DWG-handle"], "A1");
  assert.equal(model.objects[0].referenceProperties.Geometri, "Fullständig");
  assert.equal(model.parts[0].smooth, true);
  assert.deepEqual(
    [...model.parts[0].normals.slice(0, 3)].map((n) => n || 0),
    [0, 1, 0],
  );
});
test("Partial or failed solids are reported while the remaining drawing is retained", () => {
  const drawing = readCadDrawing(blockSource, {
    solids: [
      { handle: "A1", ...solidTriangle, complete: false, missingFaces: 2 },
    ],
  });
  assert.equal(drawing.entities.length, 3);
  assert.ok(
    drawing.skipped.some(
      (s) => s.includes("ofullständig") && s.includes("2 saknade"),
    ),
  );
  assert.ok(
    drawing.skipped.some((s) => s.includes("B2") && s.includes("kunde inte")),
  );
  assert.ok(drawing.entities.some((e) => e.type === "line"));
});
