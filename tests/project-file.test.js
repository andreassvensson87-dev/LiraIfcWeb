import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { encodeProject, decodeProject } from "../src/project-file.js";
const buffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
async function fixture() {
  const ifc = await readFile(new URL("reference-box.ifc", import.meta.url));
  const dwg = await readFile(
    new URL("../public/demo/DWG_Solider.dwg", import.meta.url),
  );
  const files = [
    {
      id: "model-a",
      name: "A.ifc",
      buffer: buffer(ifc),
      placement: { x: 1234.5, z: -800, elevation: 2.35, rotation: 37 },
    },
    {
      id: "model-b",
      name: "A.dwg",
      buffer: buffer(dwg),
      placement: {
        x: -4.5,
        z: 8.75,
        elevation: -2,
        rotation: 90,
        unitFactor: 0.001,
      },
    },
  ];
  const view = {
    modelIds: files.map((f) => f.id),
    visibility: { "model-a": true, "model-b": false },
    hidden: ["model-a:42"],
    isolated: null,
    camera: {
      position: [10, 20, 30],
      target: [1, 2, 3],
      up: [0, 1, 0],
      projection: "orthographic",
      zoom: 2,
      span: 50,
      near: 0.1,
      far: 10000,
    },
    section: {
      mode: "box",
      axis: "y",
      position: 40,
      invert: false,
      box: [10, 90, 20, 80, 30, 70],
    },
  };
  return {
    name: "Mitt projekt",
    origin: [654321, 0, -123456],
    grouping: "systems",
    view,
    views: [
      {
        ...view,
        id: "view-a",
        name: "Vy 1",
        date: Date.now(),
        image: "data:image/jpeg;base64,AA==",
      },
    ],
    display: { edges: true, colorMode: "type", grid: false },
    files,
  };
}
const rewrite = (bytes, edit) => {
  const entries = unzipSync(bytes),
    manifest = JSON.parse(strFromU8(entries["project.json"]));
  edit(manifest, entries);
  entries["project.json"] = strToU8(JSON.stringify(manifest));
  return zipSync(entries);
};
test("Portable project roundtrip retains exact IFC/DWG bytes, placements, unit choice, shared origin and views", async () => {
  const source = await fixture(),
    bytes = await encodeProject(source),
    opened = await decodeProject(buffer(bytes));
  for (const key of ["name", "origin", "grouping", "view", "views", "display"])
    assert.deepEqual(opened[key], source[key]);
  for (let i = 0; i < source.files.length; i++) {
    assert.deepEqual(opened.files[i].buffer, source.files[i].buffer);
    assert.deepEqual(opened.files[i].placement, source.files[i].placement);
    assert.equal(opened.files[i].unitConfirmed, true);
  }
});
test("Duplicate original filenames remain distinct archive entries and an empty project can be saved", async () => {
  const source = await fixture();
  source.files[1].name = "A.ifc";
  const opened = await decodeProject(buffer(await encodeProject(source)));
  assert.equal(opened.files.length, 2);
  assert.notDeepEqual(opened.files[0].buffer, opened.files[1].buffer);
  source.files = [];
  source.origin = null;
  source.view = null;
  source.views = [];
  assert.equal(
    (await decodeProject(buffer(await encodeProject(source)))).files.length,
    0,
  );
});
test("Missing or modified embedded data fails before any model is imported", async () => {
  const bytes = await encodeProject(await fixture());
  const missing = rewrite(bytes, (m, entries) => {
    delete entries[m.references[0].path];
  });
  await assert.rejects(
    decodeProject(buffer(missing)),
    /saknas eller är skadad/,
  );
  const corrupt = rewrite(bytes, (m, entries) => {
    entries[m.references[1].path][10] ^= 1;
  });
  await assert.rejects(
    decodeProject(buffer(corrupt)),
    /saknas eller är skadad/,
  );
});
test("Unsupported versions, invalid transforms, duplicate IDs and invalid camera data are rejected", async () => {
  const bytes = await encodeProject(await fixture());
  for (const edit of [
    (m) => {
      m.version = 99;
    },
    (m) => {
      m.references[1].id = m.references[0].id;
    },
    (m) => {
      m.references[1].placement.unitFactor = 0;
    },
    (m) => {
      m.origin = [0, null, 0];
    },
    (m) => {
      m.view.camera.zoom = -1;
    },
    (m) => {
      m.references[0].path = "../A.ifc";
    },
  ]) {
    await assert.rejects(decodeProject(buffer(rewrite(bytes, edit))));
  }
  await assert.rejects(decodeProject(buffer(strToU8("Not a project"))));
});
