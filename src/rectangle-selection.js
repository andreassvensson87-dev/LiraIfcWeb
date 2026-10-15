import * as THREE from "three";
import { isObjectVisible } from "./model-state.js";

const epsilon = 1e-7;
// Clip in world space before perspective projection, including the camera's near plane.
function clipPolygon(points, planes) {
  for (const plane of planes) {
    if (!points.length) break;
    const clipped = [];
    let previous = points.at(-1),
      previousDistance = plane.distanceToPoint(previous);
    for (const point of points) {
      const distance = plane.distanceToPoint(point);
      if (distance >= -epsilon !== previousDistance >= -epsilon) {
        clipped.push(
          previous
            .clone()
            .lerp(point, previousDistance / (previousDistance - distance)),
        );
      }
      if (distance >= -epsilon) clipped.push(point);
      previous = point;
      previousDistance = distance;
    }
    points = clipped;
  }
  return points;
}
function clipSegment(points, planes) {
  let [start, end] = points;
  for (const plane of planes) {
    const a = plane.distanceToPoint(start),
      b = plane.distanceToPoint(end);
    if (a < -epsilon && b < -epsilon) return [];
    if (a >= -epsilon !== b >= -epsilon) {
      const point = start.clone().lerp(end, a / (a - b));
      if (a < -epsilon) start = point;
      else end = point;
    }
  }
  return [start, end];
}
function intersectsTriangle(points, rect) {
  const corners = [
    [rect.left, rect.top],
    [rect.right, rect.top],
    [rect.right, rect.bottom],
    [rect.left, rect.bottom],
  ];
  const axes = [
    [1, 0],
    [0, 1],
  ];
  for (let i = 0; i < 3; i++) {
    const a = points[i],
      b = points[(i + 1) % 3];
    axes.push([a.y - b.y, b.x - a.x]);
  }
  for (const [x, y] of axes) {
    if (Math.abs(x) + Math.abs(y) < epsilon) continue;
    const a = points.map((point) => point.x * x + point.y * y);
    const b = corners.map(([px, py]) => px * x + py * y);
    if (
      Math.max(...a) < Math.min(...b) - epsilon ||
      Math.max(...b) < Math.min(...a) - epsilon
    )
      return false;
  }
  return true;
}

export function selectInRectangle(
  batches,
  camera,
  width,
  height,
  start,
  end,
  hidden = new Set(),
  isolated = null,
  clippingPlanes = [],
) {
  camera.updateMatrixWorld();
  const projection = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const frustum = new THREE.Frustum().setFromProjectionMatrix(projection);
  const depthPlanes = [frustum.planes[4], frustum.planes[5]];
  const planes = [...clippingPlanes, ...depthPlanes];
  const rect = {
    left: Math.min(start.x, end.x),
    right: Math.max(start.x, end.x),
    top: Math.min(start.y, end.y),
    bottom: Math.max(start.y, end.y),
  };
  const crossing = end.x < start.x;
  const inside = (point) =>
    point.x >= rect.left - epsilon &&
    point.x <= rect.right + epsilon &&
    point.y >= rect.top - epsilon &&
    point.y <= rect.bottom + epsilon;
  const project = (point) => {
    const projected = point.clone().applyMatrix4(projection);
    return {
      x: ((projected.x + 1) * width) / 2,
      y: ((1 - projected.y) * height) / 2,
    };
  };
  const objects = new Map();
  for (const batch of batches) {
    if (!batch.mesh.visible || !batch.model.visible) continue;
    batch.mesh.updateWorldMatrix(true, false);
    const position = batch.mesh.geometry.attributes.position;
    for (const range of batch.ranges) {
      const object = range.object;
      if (
        !range.indexLength ||
        !isObjectVisible(object, batch.model, hidden, isolated)
      )
        continue;
      let result = objects.get(object.key);
      if (!result) {
        const bounds = object.bounds
          .clone()
          .applyMatrix4(batch.mesh.matrixWorld);
        const corners = [];
        for (const x of [bounds.min.x, bounds.max.x])
          for (const y of [bounds.min.y, bounds.max.y])
            for (const z of [bounds.min.z, bounds.max.z])
              corners.push(new THREE.Vector3(x, y, z));
        const outside = planes.some((plane) =>
          corners.every((point) => plane.distanceToPoint(point) < -epsilon),
        );
        const unclipped = planes.every((plane) =>
          corners.every((point) => plane.distanceToPoint(point) >= -epsilon),
        );
        const inDepth = depthPlanes.every((plane) =>
          corners.every((point) => plane.distanceToPoint(point) >= -epsilon),
        );
        const projected = inDepth ? corners.map(project) : [];
        const enclosed = unclipped && projected.every(inside);
        const disjoint =
          inDepth &&
          (Math.max(...projected.map((p) => p.x)) < rect.left ||
            Math.min(...projected.map((p) => p.x)) > rect.right ||
            Math.max(...projected.map((p) => p.y)) < rect.top ||
            Math.min(...projected.map((p) => p.y)) > rect.bottom);
        result = {
          object,
          entries: [],
          capPlanes: clippingPlanes.filter(
            (plane) =>
              corners.some(
                (point) => plane.distanceToPoint(point) < -epsilon,
              ) &&
              corners.some((point) => plane.distanceToPoint(point) > epsilon),
          ),
          any: enclosed,
          allInside: true,
          hit: enclosed,
          done: outside || disjoint || enclosed,
        };
        objects.set(object.key, result);
      }
      result.entries.push({ batch, range });
      if (result.done || (crossing ? result.hit : !result.allInside)) continue;
      for (
        let i = range.indexStart;
        i < range.indexStart + range.indexLength;
        i += batch.primitiveSize || 3
      ) {
        const triangle = (batch.primitiveSize === 2 ? [0, 1] : [0, 1, 2]).map(
          (offset) =>
            new THREE.Vector3()
              .fromBufferAttribute(position, batch.originalIndices[i + offset])
              .applyMatrix4(batch.mesh.matrixWorld),
        );
        const polygon = (
          batch.primitiveSize === 2
            ? clipSegment(triangle, planes)
            : clipPolygon(triangle, planes)
        ).map(project);
        if (batch.primitiveSize === 2 && polygon.length === 2)
          polygon.push(polygon[1]);
        if (polygon.length < 3) continue;
        result.any = true;
        if (!crossing) {
          if (!polygon.every(inside)) {
            result.allInside = false;
            break;
          }
        } else {
          for (let j = 1; j < polygon.length - 1; j++) {
            if (
              intersectsTriangle([polygon[0], polygon[j], polygon[j + 1]], rect)
            ) {
              result.hit = true;
              break;
            }
          }
          if (result.hit) break;
        }
      }
    }
  }
  if (clippingPlanes.length) {
    for (const result of objects.values()) {
      if (result.done || (crossing ? result.hit : !result.allInside)) continue;
      for (const plane of result.capPlanes) {
        for (const triangle of sectionTriangles(result.entries, plane)) {
          const polygon = clipPolygon(triangle, planes).map(project);
          if (polygon.length < 3) continue;
          result.any = true;
          if (!crossing) {
            if (!polygon.every(inside)) {
              result.allInside = false;
              break;
            }
          } else {
            for (let j = 1; j < polygon.length - 1; j++) {
              if (
                intersectsTriangle(
                  [polygon[0], polygon[j], polygon[j + 1]],
                  rect,
                )
              ) {
                result.hit = true;
                break;
              }
            }
            if (result.hit) break;
          }
        }
        if (crossing ? result.hit : !result.allInside) break;
      }
    }
  }
  return [...objects.values()]
    .filter((result) =>
      crossing ? result.hit : result.any && result.allInside,
    )
    .map((result) => result.object);
}

// Closed section contours also contribute selectable cap surfaces. Triangulate holes
// separately so a rectangle inside an opening does not select the surrounding solid.
function sectionTriangles(entries, plane) {
  const points = new Map(),
    edges = new Map();
  const tolerance = 1e-6;
  const keyFor = (point) =>
    [point.x, point.y, point.z].map((v) => Math.round(v / tolerance)).join(",");
  for (const { batch, range } of entries) {
    if (
      batch.primitiveSize === 2 ||
      batch.model.cadData ||
      batch.mesh.material.transparent
    )
      continue;
    const position = batch.mesh.geometry.attributes.position;
    for (
      let i = range.indexStart;
      i < range.indexStart + range.indexLength;
      i += 3
    ) {
      const triangle = [0, 1, 2].map((offset) =>
        new THREE.Vector3()
          .fromBufferAttribute(position, batch.originalIndices[i + offset])
          .applyMatrix4(batch.mesh.matrixWorld),
      );
      const distances = triangle.map((p) => plane.distanceToPoint(p));
      if (
        distances.every((d) => d > epsilon) ||
        distances.every((d) => d < -epsilon) ||
        distances.every((d) => Math.abs(d) < epsilon)
      )
        continue;
      const hits = new Map();
      for (let j = 0; j < 3; j++) {
        const a = triangle[j],
          b = triangle[(j + 1) % 3],
          da = distances[j],
          db = distances[(j + 1) % 3];
        if (Math.abs(da) < epsilon) hits.set(keyFor(a), a);
        if (da * db < 0) {
          const point = a.clone().lerp(b, da / (da - db));
          hits.set(keyFor(point), point);
        }
      }
      if (hits.size !== 2) continue;
      const keys = [...hits.keys()];
      for (const [key, point] of hits) points.set(key, point);
      const edgeKey = keys.slice().sort().join("|");
      edges.set(edgeKey, keys);
    }
  }
  const adjacency = new Map();
  for (const [edge, [a, b]] of edges) {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push({ edge, other: b });
    adjacency.get(b).push({ edge, other: a });
  }
  const axis =
    Math.abs(plane.normal.z) < 0.9
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(0, 1, 0);
  const u = axis.cross(plane.normal).normalize(),
    v = plane.normal.clone().cross(u);
  const visited = new Set(),
    loops = [];
  for (const [edge, [start, next]] of edges) {
    if (visited.has(edge)) continue;
    visited.add(edge);
    const loop = [points.get(start)];
    let current = next;
    while (current !== start) {
      loop.push(points.get(current));
      const step = adjacency
        .get(current)
        ?.find((candidate) => !visited.has(candidate.edge));
      if (!step) break;
      visited.add(step.edge);
      current = step.other;
    }
    if (current === start && loop.length >= 3) {
      const flat = loop.map(
        (point) => new THREE.Vector2(point.dot(u), point.dot(v)),
      );
      const area = Math.abs(THREE.ShapeUtils.area(flat));
      if (area > epsilon)
        loops.push({ world: loop, flat, area, parent: null, depth: 0 });
    }
  }
  loops.sort((a, b) => b.area - a.area);
  const contains = (loop, point) => {
    let inside = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[i],
        b = loop[j];
      if (
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      )
        inside = !inside;
    }
    return inside;
  };
  for (let i = 0; i < loops.length; i++) {
    const loop = loops[i];
    for (let j = i - 1; j >= 0; j--) {
      if (contains(loops[j].flat, loop.flat[0])) {
        loop.parent = loops[j];
        loop.depth = loops[j].depth + 1;
        break;
      }
    }
  }
  const triangles = [];
  for (const loop of loops.filter((loop) => loop.depth % 2 === 0)) {
    const holes = loops.filter(
      (hole) => hole.parent === loop && hole.depth % 2 === 1,
    );
    const vertices = [...loop.world, ...holes.flatMap((hole) => hole.world)];
    for (const indices of THREE.ShapeUtils.triangulateShape(
      loop.flat,
      holes.map((hole) => hole.flat),
    ))
      triangles.push(indices.map((index) => vertices[index]));
  }
  return triangles;
}
