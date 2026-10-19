import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { IfcAPI } from "web-ifc";
import { readCadDrawing } from "../src/cad-data.js";
import { cadImportUnit } from "../src/cad-units.js";
import { buildCadModel, initialCadOrigin } from "../src/cad-model.js";
const lineSource = (code, end) =>
  `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${code}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nTest\n10\n0\n20\n0\n30\n0\n11\n${end}\n21\n0\n31\n0\n0\nENDSEC\n0\nEOF\n`;
test("CAD millimetres and metres normalize to the same physical size without using plot scale", () => {
  const mm = readCadDrawing(lineSource(4, 1000)),
    m = readCadDrawing(lineSource(6, 1));
  for (const d of [mm, m]) {
    assert.equal(d.unitKnown, true);
    const factor = cadImportUnit(d);
    const model = buildCadModel({
      cadData: d,
      placement: { unitFactor: factor, x: 0, z: 0, elevation: 0, rotation: 0 },
      origin: initialCadOrigin(d, factor),
      format: "DXF",
    });
    assert.equal(model.parts[0].positions[3] - model.parts[0].positions[0], 1);
  }
});
test("Unitless CAD never silently assumes millimetres; explicit decisions survive reopens and legacy assumptions are rechecked", () => {
  const data = readCadDrawing(lineSource(0, 63));
  assert.equal(data.unitFactor, null);
  assert.equal(data.unitKnown, false);
  assert.equal(cadImportUnit(data), null);
  assert.equal(cadImportUnit(data, { placement: { unitFactor: 0.001 } }), null);
  assert.equal(
    cadImportUnit(data, { placement: { unitFactor: 1 }, unitConfirmed: true }),
    1,
  );
  assert.equal(
    cadImportUnit(data, { demo: true, placement: { unitFactor: 1 } }),
    1,
  );
  assert.throws(() => initialCadOrigin(data), /enhet/);
});
test("CAD origin uses the chosen or restored unit and additional standard length units are recognized", () => {
  const data = {
    entities: [
      {
        points: [
          [1000, 2000, 0],
          [1063, 2057.5, 0],
        ],
      },
    ],
    unitFactor: null,
  };
  assert.deepEqual(initialCadOrigin(data, 1), [1000, 0, -2057.5]);
  assert.deepEqual(initialCadOrigin(data, 0.001), [1, 0, -2.0575]);
  assert.equal(readCadDrawing(lineSource(14, 10)).unitFactor, 0.1);
  assert.equal(readCadDrawing(lineSource(7, 1)).unitFactor, 1000);
});
test("Actual IFC engine normalizes matching millimetre and metre IFC geometry exactly once", async () => {
  const mm = await readFile(
    new URL("./reference-box.ifc", import.meta.url),
    "utf8",
  );
  const m = mm
    .replace(",.MILLI.,.METRE.", ",$,.METRE.")
    .replace("((1000.,2000.,3000.))", "((1.,2.,3.))")
    .replace("#15,200.,400.", "#15,0.2,0.4")
    .replace("#4,#2,600.", "#4,#2,0.6");
  const metre = m;
  const api = new IfcAPI();
  await api.Init();
  const bounds = (source) => {
    const id = api.OpenModel(new TextEncoder().encode(source));
    const b = new THREE.Box3();
    try {
      api.StreamAllMeshes(id, (mesh) => {
        for (let i = 0; i < mesh.geometries.size(); i++) {
          const part = mesh.geometries.get(i),
            g = api.GetGeometry(id, part.geometryExpressID);
          try {
            const vertices = api.GetVertexArray(
                g.GetVertexData(),
                g.GetVertexDataSize(),
              ),
              matrix = new THREE.Matrix4().fromArray(part.flatTransformation);
            for (let j = 0; j < vertices.length; j += 6)
              b.expandByPoint(
                new THREE.Vector3().fromArray(vertices, j).applyMatrix4(matrix),
              );
          } finally {
            g.delete();
          }
        }
      });
      return b;
    } finally {
      api.CloseModel(id);
    }
  };
  try {
    const a = bounds(mm),
      b = bounds(metre);
    assert.ok(a.min.distanceTo(b.min) < 1e-6);
    assert.ok(a.max.distanceTo(b.max) < 1e-6);
    const sizes = a
      .getSize(new THREE.Vector3())
      .toArray()
      .sort((a, b) => a - b);
    sizes.forEach((n, i) => assert.ok(Math.abs(n - [0.2, 0.4, 0.6][i]) < 1e-6));
  } finally {
    api.Dispose();
  }
});
