import * as THREE from "three";
const cache = new WeakMap();
export function objectFeatures(object, model) {
  const old = cache.get(object);
  if (
    old &&
    old.sources.every(
      (s) =>
        model.batches.includes(s.batch) &&
        s.version === s.batch.mesh.geometry.attributes.position.version,
    )
  )
    return old;
  const origin = object.bounds.min,
    step = Math.max(
      1e-6,
      object.bounds.getSize(new THREE.Vector3()).length() * 1e-8,
    );
  const points = [],
    ids = new Map(),
    edges = new Map(),
    triangles = [],
    hitMap = new Map(),
    sources = [];
  const weld = (p) => {
    const key = [p.x - origin.x, p.y - origin.y, p.z - origin.z]
      .map((v) => Math.round(v / step))
      .join(",");
    if (!ids.has(key)) {
      ids.set(key, points.length);
      points.push(p);
    }
    return ids.get(key);
  };
  const edge = (a, b, tri) => {
    if (a === b) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (!edges.has(key)) edges.set(key, { a, b, triangles: [] });
    if (tri !== null) edges.get(key).triangles.push(tri);
  };
  for (const batch of model.batches) {
    const ranges = batch.ranges.filter((r) => r.object === object);
    if (!ranges.length || batch.mesh.material.map) continue;
    const pos = batch.mesh.geometry.attributes.position;
    sources.push({ batch, version: pos.version });
    for (const range of ranges)
      for (
        let i = range.indexStart;
        i < range.indexStart + range.indexLength;
        i += batch.primitiveSize
      ) {
        const indices = Array.from(
          batch.originalIndices.subarray(i, i + batch.primitiveSize),
        );
        const p = indices.map((id) =>
            new THREE.Vector3().fromBufferAttribute(pos, id),
          ),
          v = p.map(weld);
        if (batch.primitiveSize === 2) {
          edge(v[0], v[1], null);
          continue;
        }
        const normal = p[1]
          .clone()
          .sub(p[0])
          .cross(p[2].clone().sub(p[0]))
          .normalize();
        if (!normal.lengthSq()) continue;
        const index = triangles.length;
        triangles.push({ p, v, normal, neighbors: [], patch: -1 });
        hitMap.set(
          `${batch.mesh.uuid}:${indices
            .slice()
            .sort((a, b) => a - b)
            .join(",")}`,
          index,
        );
        for (let j = 0; j < 3; j++) edge(v[j], v[(j + 1) % 3], index);
      }
  }
  for (const e of edges.values())
    for (const a of e.triangles)
      for (const b of e.triangles)
        if (a !== b) {
          const A = triangles[a],
            B = triangles[b];
          if (
            Math.abs(A.normal.dot(B.normal)) > 1 - 1e-8 &&
            Math.abs(A.normal.dot(B.p[0].clone().sub(A.p[0]))) < step * 3
          )
            A.neighbors.push(b);
        }
  const faces = [];
  for (let i = 0; i < triangles.length; i++) {
    if (triangles[i].patch >= 0) continue;
    const patch = faces.length,
      stack = [i],
      members = [];
    triangles[i].patch = patch;
    while (stack.length) {
      const t = triangles[stack.pop()];
      members.push(t);
      for (const n of t.neighbors)
        if (triangles[n].patch < 0) {
          triangles[n].patch = patch;
          stack.push(n);
        }
    }
    faces.push({
      kind: "face",
      id: `${object.key}:f${patch}`,
      object,
      triangles: members.map((t) => t.p),
      normal: members[0].normal,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(
        members[0].normal,
        members[0].p[0],
      ),
      mild: new Set(),
      boundary: [],
    });
  }
  const visibleEdges = [];
  for (const e of edges.values()) {
    const patches = [...new Set(e.triangles.map((i) => triangles[i].patch))];
    if (e.triangles.length && patches.length === 1 && e.triangles.length > 1)
      continue;
    for (const a of patches) {
      faces[a].boundary.push([points[e.a], points[e.b]]);
      for (const b of patches)
        if (a !== b) {
          const dot = Math.abs(faces[a].normal.dot(faces[b].normal));
          if (dot > Math.cos(Math.PI / 9) && dot < 1 - 1e-8)
            faces[a].mild.add(b);
        }
    }
    const sharp =
      !e.triangles.length ||
      e.triangles.length === 1 ||
      e.triangles.some((a) =>
        e.triangles.some(
          (b) =>
            Math.abs(triangles[a].normal.dot(triangles[b].normal)) <
            Math.cos(Math.PI / 9),
        ),
      );
    if (sharp) visibleEdges.push(e);
  }
  faces.forEach((f) => (f.planar = f.mild.size < 2));
  const adjacent = points.map(() => []);
  visibleEdges.forEach((e, i) => {
    adjacent[e.a].push(i);
    adjacent[e.b].push(i);
  });
  const straightAt = (v) => {
    const list = adjacent[v];
    if (list.length !== 2) return false;
    const dirs = list.map((i) => {
      const e = visibleEdges[i];
      return points[e.a === v ? e.b : e.a].clone().sub(points[v]).normalize();
    });
    return dirs[0].dot(dirs[1]) < -1 + 1e-8;
  };
  const isCorner = (v) => {
    const list = adjacent[v];
    if (list.length !== 2) return list.length > 0;
    const dirs = list.map((i) => {
      const e = visibleEdges[i];
      return points[e.a === v ? e.b : e.a].clone().sub(points[v]).normalize();
    });
    return dirs[0].dot(dirs[1]) > -Math.cos(Math.PI / 9);
  };
  const used = new Set(),
    lines = [];
  const walk = (vertex, index) => {
    let v = vertex,
      i = index;
    while (!used.has(i)) {
      used.add(i);
      const e = visibleEdges[i];
      v = e.a === v ? e.b : e.a;
      if (!straightAt(v)) break;
      i = adjacent[v].find((k) => k !== i);
    }
    return v;
  };
  for (let i = 0; i < visibleEdges.length; i++) {
    if (used.has(i)) continue;
    const e = visibleEdges[i];
    used.add(i);
    const ends = [e.a, e.b].map((v) =>
      straightAt(v)
        ? walk(
            v,
            adjacent[v].find((k) => k !== i),
          )
        : v,
    );
    const [a, b] = ends.map((v) => points[v]);
    if (a.distanceToSquared(b) < step * step) continue;
    lines.push({
      kind: "line",
      id: `${object.key}:e${lines.length}`,
      a,
      b,
      object,
      selectable: !object.cadCurve && (isCorner(ends[0]) || isCorner(ends[1])),
    });
  }
  const corners = points.flatMap((p, i) =>
    isCorner(i)
      ? [
          {
            kind: "point",
            id: `${object.key}:v${i}`,
            point: p,
            object,
            snap: "endpoint",
          },
        ]
      : [],
  );
  const data = { sources, faces, lines, corners, hitMap, triangles };
  cache.set(object, data);
  return data;
}
export function hitFace(features, hit) {
  if (!hit.sourceFace || !hit.sourceBatch) return null;
  const indices = [hit.sourceFace.a, hit.sourceFace.b, hit.sourceFace.c].sort(
    (a, b) => a - b,
  );
  const tri = features.hitMap.get(
    `${hit.sourceBatch.mesh.uuid}:${indices.join(",")}`,
  );
  const face = features.faces[features.triangles[tri]?.patch];
  return face?.planar ? face : null;
}
