import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  closestFeatures,
  clipFeature,
  constrainMove,
} from "../src/measurement-geometry.js";
import { objectFeatures, hitFace } from "../src/geometry-features.js";
import {
  buildBatches,
  updateBatchVisibility,
  pickedObject,
} from "../src/batches.js";
import { SnapResolver } from "../src/snap-resolver.js";
const V = (x, y, z) => new THREE.Vector3(x, y, z),
  P = (x, y, z) => ({ kind: "point", point: V(x, y, z) }),
  L = (a, b) => ({ kind: "line", a: V(...a), b: V(...b) });
const face = (z = 0) => ({
  kind: "face",
  triangles: [
    [V(0, 0, z), V(4, 0, z), V(4, 4, z)],
    [V(0, 0, z), V(4, 4, z), V(0, 4, z)],
  ],
});
function near(a, b) {
  assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
}
test("All point/finite line/bounded face combinations are symmetric and produce actual shortest endpoints", () => {
  const cases = [
    [P(0, 0, 0), P(3, 4, 0), 5],
    [P(8, 2, 0), L([0, 0, 0], [4, 0, 0]), Math.sqrt(20)],
    [P(2, 2, 3), face(), 3],
    [L([0, 0, 0], [4, 0, 0]), L([2, 1, 2], [2, 3, 2]), Math.sqrt(5)],
    [L([2, 2, 3], [3, 3, 3]), face(), 3],
    [face(), face(5), 5],
  ];
  for (const [a, b, d] of cases) {
    const result = closestFeatures(a, b),
      reverse = closestFeatures(b, a);
    near(result.distance, d);
    near(reverse.distance, d);
    near(result.a.distanceTo(result.b), d);
  }
});
test("Crossing, touching, coplanar overlap, disjoint planes and degenerate segments retain finite geometry semantics", () => {
  near(closestFeatures(L([2, 2, -2], [2, 2, 2]), face()).distance, 0);
  near(
    closestFeatures(face(), {
      kind: "face",
      triangles: [[V(2, 2, -2), V(2, 2, 2), V(2, 5, 0)]],
    }).distance,
    0,
  );
  near(
    closestFeatures(face(), {
      kind: "face",
      triangles: [[V(1, 1, 0), V(2, 1, 0), V(1, 2, 0)]],
    }).distance,
    0,
  );
  near(
    closestFeatures(face(), {
      kind: "face",
      triangles: [[V(6, 0, 0), V(8, 0, 0), V(6, 2, 0)]],
    }).distance,
    2,
  );
  near(closestFeatures(L([1, 1, 3], [1, 1, 3]), face()).distance, 3);
});
test("Planar surface holes stay empty and clipping uses only the visible part", () => {
  const shape = new THREE.Shape([
    new THREE.Vector2(-3, -3),
    new THREE.Vector2(3, -3),
    new THREE.Vector2(3, 3),
    new THREE.Vector2(-3, 3),
  ]);
  shape.holes.push(
    new THREE.Path([
      new THREE.Vector2(-1, -1),
      new THREE.Vector2(-1, 1),
      new THREE.Vector2(1, 1),
      new THREE.Vector2(1, -1),
    ]),
  );
  const g = new THREE.ShapeGeometry(shape),
    triangles = [];
  for (let i = 0; i < g.index.count; i += 3)
    triangles.push(
      [0, 1, 2].map((j) =>
        new THREE.Vector3().fromBufferAttribute(
          g.attributes.position,
          g.index.getX(i + j),
        ),
      ),
    );
  near(closestFeatures(P(0, 0, 0), { kind: "face", triangles }).distance, 1);
  const clipped = clipFeature(face(), [new THREE.Plane(V(1, 0, 0), -2)]);
  near(closestFeatures(P(0, 2, 0), clipped).distance, 2);
  assert.equal(
    clipFeature(L([0, 0, 0], [1, 0, 0]), [new THREE.Plane(V(1, 0, 0), -2)]),
    null,
  );
});
function modelFromGeometry(g, id = "test") {
  if (!g.index)
    g.setIndex(
      Array.from({ length: g.attributes.position.count }, (_, i) => i),
    );
  const object = {
    key: `${id}:1`,
    expressId: 1,
    modelId: id,
    bounds: new THREE.Box3(),
  };
  const model = {
    id,
    visible: true,
    objects: [object],
    objectMap: new Map([[1, object]]),
    parts: [
      {
        id: 1,
        positions: g.attributes.position.array,
        normals: g.attributes.normal.array,
        indices: g.index.array,
        color: [1, 1, 1],
        opacity: 1,
      },
    ],
  };
  model.batches = buildBatches(model);
  model.batches.forEach((b) => updateBatchVisibility(b, new Set(), null));
  return model;
}
test("Welded box topology yields 6 bounded planes, 12 true edges and 8 corners, never triangulation diagonals", () => {
  const model = modelFromGeometry(new THREE.BoxGeometry(4, 4, 4)),
    f = objectFeatures(model.objects[0], model);
  assert.equal(f.faces.length, 6);
  assert.equal(f.faces.filter((f) => f.planar).length, 6);
  assert.equal(f.lines.length, 12);
  assert.equal(f.corners.length, 8);
  assert.ok(f.lines.every((e) => e.selectable));
  const b = model.batches[0],
    hit = {
      sourceBatch: b,
      sourceFace: {
        a: b.originalIndices[0],
        b: b.originalIndices[1],
        c: b.originalIndices[2],
      },
    };
  assert.ok(hitFace(f, hit));
  const before = f;
  b.mesh.geometry.attributes.position.needsUpdate = true;
  assert.notEqual(objectFeatures(model.objects[0], model), before);
});
test("Tessellated cylinder sides and sphere facets are not selectable planar surfaces", () => {
  const cylinder = modelFromGeometry(new THREE.CylinderGeometry(2, 2, 4, 32)),
    f = objectFeatures(cylinder.objects[0], cylinder);
  assert.equal(f.faces.filter((f) => f.planar).length, 2);
  assert.ok(
    f.faces.filter((f) => f.planar).every((f) => Math.abs(f.normal.y) > 0.99),
  );
  const sphere = modelFromGeometry(
      new THREE.SphereGeometry(2, 24, 16),
      "sphere",
    ),
    s = objectFeatures(sphere.objects[0], sphere);
  assert.equal(s.faces.filter((f) => f.planar).length, 0);
  assert.equal(s.corners.length, 0);
});
test("Screen-space snaps prioritize corners and midpoints, reject hidden occluded geometry, and permit cycling", () => {
  const model = modelFromGeometry(new THREE.BoxGeometry(4, 4, 4)),
    camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.set(0, 10, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const v = {
    camera,
    width: 1000,
    height: 1000,
    models: [model],
    batches: model.batches,
    hidden: new Set(),
    isolated: null,
    clippingPlanes: [],
    snapRevision: 0,
    renderer: {
      domElement: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    },
    raycaster: new THREE.Raycaster(),
  };
  v.raycaster.params.Line.threshold = 0.02;
  const snap = new SnapResolver(v);
  const hit = (e) => {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(e.clientX / 500 - 1, 1 - e.clientY / 500),
      camera,
    );
    const h = ray.intersectObject(model.batches[0].mesh)[0];
    if (!h) return null;
    return {
      ...h,
      sourceBatch: model.batches[0],
      sourceFace: h.face,
      object: pickedObject(model.batches[0], h.faceIndex),
    };
  };
  const corner = { clientX: 700, clientY: 700 };
  assert.equal(snap.resolve(corner, hit(corner)).snap, "endpoint");
  assert.equal(snap.feature("auto").kind, "point");
  snap.cycle();
  assert.notEqual(snap.resolve(corner, hit(corner)).snap, "endpoint");
  snap.reset();
  const mid = { clientX: 500, clientY: 700 };
  assert.equal(snap.resolve(mid, hit(mid)).snap, "midpoint");
  assert.equal(snap.feature("auto").kind, "point");
  const edge = { clientX: 600, clientY: 700 };
  snap.resolve(edge, hit(edge));
  assert.equal(snap.feature("auto").kind, "line");
  const insideEdge = { clientX: 600, clientY: 691 };
  snap.resolve(insideEdge, hit(insideEdge));
  assert.equal(
    snap.feature("auto").kind,
    "face",
    "automatic edges use a tighter tolerance so nearby faces remain accessible",
  );
  snap.reset();
  const center = { clientX: 500, clientY: 500 };
  assert.equal(snap.resolve(center, hit(center)).snap, "surface");
  assert.equal(snap.feature("auto").kind, "face");
  snap.cycle("auto");
  snap.resolve(center, hit(center));
  assert.equal(
    snap.feature("auto").kind,
    "point",
    "Tab offers a point on the face",
  );
  snap.resolve(
    { clientX: 510, clientY: 500 },
    hit({ clientX: 510, clientY: 500 }),
  );
  assert.equal(
    snap.feature("auto").kind,
    "face",
    "moving restores automatic inference",
  );
  assert.equal(
    snap.lines.length,
    0,
    "the face diagonal must not snap as an edge",
  );
  v.hidden.add("test:1");
  v.snapRevision++;
  model.batches[0].mesh.visible = false;
  assert.equal(snap.resolve(corner, null), undefined);
  assert.equal(snap.feature("auto"), null);
});
test("Reference move constraints operate in world metres without changing the unlocked origin", () => {
  assert.deepEqual(
    constrainMove(V(1, 2, 3), V(5, 6, 7), "x").toArray(),
    [5, 2, 3],
  );
  assert.deepEqual(
    constrainMove(V(1, 2, 3), V(5, 6, 7), "xz").toArray(),
    [5, 2, 7],
  );
  near(
    constrainMove(V(1, 2, 3), V(5, 6, 7), "free", 2).distanceTo(V(1, 2, 3)),
    2,
  );
});

test("Perpendicular and sticky snaps stay stable in pixels and hidden rear objects never win", () => {
  const back = modelFromGeometry(new THREE.BoxGeometry(4, 4, 4), "back"),
    front = modelFromGeometry(
      new THREE.BoxGeometry(4, 1, 4).translate(0, 4, 0),
      "front",
    );
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.set(0, 20, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const v = {
    camera,
    width: 1000,
    height: 1000,
    models: [front, back],
    batches: [...front.batches, ...back.batches],
    hidden: new Set(),
    isolated: null,
    clippingPlanes: [],
    renderer: {
      domElement: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    },
    raycaster: new THREE.Raycaster(),
  };
  v.raycaster.params.Line.threshold = 0.02;
  const snap = new SnapResolver(v),
    event = { clientX: 700, clientY: 700 };
  const hit = { point: V(2, 4.5, 2), object: front.objects[0] };
  assert.equal(snap.resolve(event, hit).snap, "endpoint");
  assert.ok(snap.candidates.every((c) => c.object !== back.objects[0]));
  assert.equal(
    snap.resolve({ clientX: 715, clientY: 700 }, null).snap,
    "endpoint",
  );
  snap.reset();
  const at = { clientX: 600, clientY: 700 };
  assert.equal(
    snap.resolve(
      at,
      { point: V(1, 4.5, 2), object: front.objects[0] },
      V(1, 9, 0),
    ).snap,
    "perpendicular",
  );
});

test("Known CAD circle centers snap in empty canvas without inventing straight selectable chords", () => {
  const points = [];
  for (let i = 0; i < 64; i++)
    points.push(
      V(Math.cos((i * Math.PI) / 32) * 2, 0, Math.sin((i * Math.PI) / 32) * 2),
      V(
        Math.cos(((i + 1) * Math.PI) / 32) * 2,
        0,
        Math.sin(((i + 1) * Math.PI) / 32) * 2,
      ),
    );
  const object = {
    key: "circle:1",
    expressId: 1,
    modelId: "circle",
    bounds: new THREE.Box3(),
    cadCurve: true,
    snapCenters: [V(0, 0, 0)],
  };
  const model = {
    id: "circle",
    visible: true,
    objects: [object],
    objectMap: new Map([[1, object]]),
    parts: [
      {
        id: 1,
        lines: true,
        positions: new Float32Array(points.flatMap((p) => p.toArray())),
        normals: new Float32Array(points.length * 3),
        indices: new Uint32Array(points.map((_, i) => i)),
        color: [1, 1, 1],
        opacity: 1,
      },
    ],
  };
  model.batches = buildBatches(model);
  model.batches.forEach((b) => updateBatchVisibility(b, new Set(), null));
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.set(0, 10, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const v = {
    camera,
    width: 1000,
    height: 1000,
    models: [model],
    batches: model.batches,
    hidden: new Set(),
    isolated: null,
    clippingPlanes: [],
    renderer: {
      domElement: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    },
    raycaster: new THREE.Raycaster(),
  };
  const snap = new SnapResolver(v);
  assert.equal(
    snap.resolve({ clientX: 500, clientY: 500 }, null).snap,
    "center",
  );
  assert.equal(
    objectFeatures(object, model).lines.filter((l) => l.selectable).length,
    0,
  );
});
