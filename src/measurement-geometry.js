import * as THREE from "three";

const clamp = THREE.MathUtils.clamp;
const EPS = 1e-18;
const pair = (a, b) => ({
  a: a.clone(),
  b: b.clone(),
  distance: a.distanceTo(b),
});
export function closestSegments(a, b, c, d) {
  const u = b.clone().sub(a),
    v = d.clone().sub(c),
    w = a.clone().sub(c);
  const A = u.dot(u),
    B = u.dot(v),
    C = v.dot(v),
    D = u.dot(w),
    E = v.dot(w);
  let s = 0,
    t = 0;
  if (A <= EPS && C <= EPS) return pair(a, c);
  if (A <= EPS) t = clamp(E / C, 0, 1);
  else if (C <= EPS) s = clamp(-D / A, 0, 1);
  else {
    const denom = A * C - B * B;
    s = denom > EPS ? clamp((B * E - C * D) / denom, 0, 1) : 0;
    t = (B * s + E) / C;
    if (t < 0) {
      t = 0;
      s = clamp(-D / A, 0, 1);
    } else if (t > 1) {
      t = 1;
      s = clamp((B - D) / A, 0, 1);
    }
  }
  return pair(a.clone().addScaledVector(u, s), c.clone().addScaledVector(v, t));
}
function pointTriangle(p, tri) {
  return pair(
    p,
    new THREE.Triangle(...tri).closestPointToPoint(p, new THREE.Vector3()),
  );
}
function segmentTriangle(a, b, tri) {
  let best = pointTriangle(a, tri),
    next = pointTriangle(b, tri);
  if (next.distance < best.distance) best = next;
  const direction = b.clone().sub(a),
    length = direction.length();
  if (length > 1e-12) {
    const hit = new THREE.Ray(
      a,
      direction.divideScalar(length),
    ).intersectTriangle(...tri, false, new THREE.Vector3());
    if (hit && hit.distanceTo(a) <= length + 1e-9) return pair(hit, hit);
  }
  for (let i = 0; i < 3; i++) {
    next = closestSegments(a, b, tri[i], tri[(i + 1) % 3]);
    if (next.distance < best.distance) best = next;
  }
  return best;
}
function primitivePair(a, b) {
  if (a.length === 1 && b.length === 1) return pair(a[0], b[0]);
  if (a.length === 1 && b.length === 2)
    return pair(
      a[0],
      new THREE.Line3(...b).closestPointToPoint(
        a[0],
        true,
        new THREE.Vector3(),
      ),
    );
  if (a.length === 1 && b.length === 3) return pointTriangle(a[0], b);
  if (a.length > b.length) {
    const result = primitivePair(b, a);
    return { a: result.b, b: result.a, distance: result.distance };
  }
  if (a.length === 2 && b.length === 2) return closestSegments(...a, ...b);
  if (a.length === 2 && b.length === 3) return segmentTriangle(...a, b);
  let best = { distance: Infinity };
  for (let i = 0; i < 3; i++) {
    const p = segmentTriangle(a[i], a[(i + 1) % 3], b);
    if (p.distance < best.distance) best = p;
    const q = segmentTriangle(b[i], b[(i + 1) % 3], a);
    if (q.distance < best.distance)
      best = { a: q.b, b: q.a, distance: q.distance };
    if (best.distance < 1e-10) break;
  }
  return best;
}
function primitives(feature) {
  return feature.kind === "point"
    ? [[feature.point]]
    : feature.kind === "line"
      ? [[feature.a, feature.b]]
      : feature.triangles;
}
function tree(items) {
  const bounds = new THREE.Box3();
  for (const p of items) for (const v of p) bounds.expandByPoint(v);
  if (items.length <= 8) return { bounds, items };
  const size = bounds.getSize(new THREE.Vector3()),
    axis =
      size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
  items.sort(
    (a, b) =>
      a.reduce((n, p) => n + p[axis], 0) / a.length -
      b.reduce((n, p) => n + p[axis], 0) / b.length,
  );
  const mid = Math.floor(items.length / 2);
  return {
    bounds,
    left: tree(items.slice(0, mid)),
    right: tree(items.slice(mid)),
  };
}
function boxDistanceSquared(a, b) {
  let n = 0;
  for (const k of ["x", "y", "z"]) {
    const d = Math.max(0, a.min[k] - b.max[k], b.min[k] - a.max[k]);
    n += d * d;
  }
  return n;
}
export function closestFeatures(a, b) {
  // The hierarchy avoids a quadratic face/face scan on tessellated slabs and holes.
  const A = (a.distanceTree ||= tree(primitives(a).slice())),
    B = (b.distanceTree ||= tree(primitives(b).slice()));
  let best = { distance: Infinity };
  const visit = (x, y) => {
    if (
      boxDistanceSquared(x.bounds, y.bounds) >
      best.distance * best.distance + EPS
    )
      return;
    if (x.items && y.items) {
      for (const p of x.items)
        for (const q of y.items) {
          const candidate = primitivePair(p, q);
          if (candidate.distance < best.distance) best = candidate;
          if (best.distance < 1e-10) return;
        }
      return;
    }
    const children = x.items
      ? [
          [x, y.left],
          [x, y.right],
        ]
      : y.items
        ? [
            [x.left, y],
            [x.right, y],
          ]
        : x.bounds.getSize(new THREE.Vector3()).lengthSq() >
            y.bounds.getSize(new THREE.Vector3()).lengthSq()
          ? [
              [x.left, y],
              [x.right, y],
            ]
          : [
              [x, y.left],
              [x, y.right],
            ];
    children.sort(
      (p, q) =>
        boxDistanceSquared(p[0].bounds, p[1].bounds) -
        boxDistanceSquared(q[0].bounds, q[1].bounds),
    );
    for (const [p, q] of children) {
      visit(p, q);
      if (best.distance < 1e-10) break;
    }
  };
  visit(A, B);
  return best;
}
export function clipFeature(feature, planes = []) {
  if (!planes.length) return feature;
  const inside = (p) =>
    planes.every((plane) => plane.distanceToPoint(p) >= -1e-7);
  if (feature.kind === "point") return inside(feature.point) ? feature : null;
  if (feature.kind === "line") {
    let a = feature.a.clone(),
      b = feature.b.clone();
    for (const plane of planes) {
      const da = plane.distanceToPoint(a),
        db = plane.distanceToPoint(b);
      if (da < 0 && db < 0) return null;
      if (da < 0 !== db < 0) {
        const p = a.clone().lerp(b, da / (da - db));
        if (da < 0) a = p;
        else b = p;
      }
    }
    return { ...feature, a, b, distanceTree: null };
  }
  const triangles = [];
  for (const tri of feature.triangles) {
    let polygon = tri;
    for (const plane of planes) {
      const out = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i],
          b = polygon[(i + 1) % polygon.length],
          da = plane.distanceToPoint(a),
          db = plane.distanceToPoint(b);
        if (da >= 0) out.push(a);
        if (da < 0 !== db < 0) out.push(a.clone().lerp(b, da / (da - db)));
      }
      polygon = out;
    }
    for (let i = 1; i < polygon.length - 1; i++)
      triangles.push([polygon[0], polygon[i], polygon[i + 1]]);
  }
  return triangles.length
    ? { ...feature, triangles, distanceTree: null }
    : null;
}
export function constrainMove(start, end, axis = "free", distance = null) {
  const delta = end.clone().sub(start);
  if (axis === "xz") delta.y = 0;
  else if (axis !== "free")
    for (const k of ["x", "y", "z"]) if (k !== axis) delta[k] = 0;
  if (
    distance !== null &&
    Number.isFinite(distance) &&
    delta.lengthSq() > 1e-20
  )
    delta.normalize().multiplyScalar(distance);
  return start.clone().add(delta);
}
