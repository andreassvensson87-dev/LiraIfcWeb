import * as THREE from "three";
import { pickedObject } from "./batches.js";
import { objectFeatures, hitFace } from "./geometry-features.js";
import { clipFeature, closestFeatures } from "./measurement-geometry.js";
export const snapNames = {
  endpoint: "Hörn / ändpunkt",
  midpoint: "Mittpunkt",
  center: "Centrum",
  perpendicular: "Vinkelrät",
  edge: "Kant",
  surface: "Yta",
  ground: "Arbetsplan",
};
const rank = {
  endpoint: 0,
  midpoint: 1,
  center: 1,
  perpendicular: 2,
  edge: 3,
  surface: 4,
};
export class SnapResolver {
  constructor(viewer) {
    this.viewer = viewer;
    this.settings = {
      enabled: true,
      endpoint: true,
      midpoint: true,
      center: true,
      perpendicular: true,
      edge: true,
      surface: true,
    };
    this.reset();
  }
  reset() {
    this.chosen = null;
    this.candidates = [];
    this.lines = [];
    this.face = null;
    this.cursor = null;
    this.lineId = null;
    this.lineCycled = false;
  }
  cycle(kind = "point") {
    if (kind === "line") {
      if (this.lines.length > 1) {
        const index = this.lines.findIndex(
          (l) => l.id === (this.lineId || this.lines[0].id),
        );
        this.lineId = this.lines[(index + 1) % this.lines.length].id;
        this.lineCycled = true;
      }
      return;
    }
    if (this.candidates.length < 2) return;
    const index = this.candidates.findIndex((c) => c.id === this.chosen?.id);
    this.chosen = this.candidates[(index + 1) % this.candidates.length];
    this.cycled = true;
  }
  project(point) {
    const v = this.viewer,
      p = point.clone().project(v.camera);
    return {
      x: ((p.x + 1) * v.width) / 2,
      y: ((1 - p.y) * v.height) / 2,
      z: p.z,
    };
  }
  visible(point, owner) {
    const v = this.viewer,
      p = point.clone().project(v.camera);
    if (
      p.z < -1 ||
      p.z > 1 ||
      v.clippingPlanes.some((plane) => plane.distanceToPoint(point) < -1e-6)
    )
      return false;
    const ray = new THREE.Raycaster();
    ray.params.Line.threshold = v.raycaster.params.Line.threshold * 0.25;
    const meshes = v.batches
      .filter((b) => b.mesh.visible && !b.mesh.material.map)
      .map((b) => b.mesh);
    const test = (x, y, offset = false) => {
      ray.setFromCamera(new THREE.Vector2(x, y), v.camera);
      const depth = ray.ray.direction.dot(point.clone().sub(ray.ray.origin));
      const front = ray
        .intersectObjects(meshes, false)
        .find((h) =>
          v.clippingPlanes.every(
            (plane) => plane.distanceToPoint(h.point) >= -1e-6,
          ),
        );
      if (!front) return true;
      const object = pickedObject(
        front.object.userData.batch,
        front.faceIndex ?? front.index / 2,
      );
      const tolerance =
        offset && object === owner
          ? ((v.camera.isOrthographicCamera
              ? (v.camera.top - v.camera.bottom) / v.camera.zoom
              : depth) *
              0.5) /
            v.height
          : Math.max(1e-5, point.length() * 1e-7);
      return front.distance >= depth - tolerance;
    };
    if (!test(p.x, p.y)) return false;
    // A ray exactly on a silhouette may miss its triangle due to round-off.
    // Check a subpixel step inward, without admitting rear corners as visible.
    if (owner) {
      const center = owner.bounds
        .getCenter(new THREE.Vector3())
        .project(v.camera);
      const direction = new THREE.Vector2(
        center.x - p.x,
        center.y - p.y,
      ).normalize();
      return test(
        p.x + (direction.x * 0.4) / v.width,
        p.y + (direction.y * 0.4) / v.height,
        true,
      );
    }
    return true;
  }
  nearby(cursor, hit) {
    const v = this.viewer;
    const stamp = [
      ...v.camera.matrixWorld.elements,
      ...v.camera.projectionMatrix.elements,
      v.width,
      v.height,
      v.snapRevision || 0,
    ].join(",");
    if (stamp !== this.stamp) {
      this.stamp = stamp;
      this.rects = [];
      for (const model of v.models)
        for (const object of model.objects) {
          if (
            !model.visible ||
            v.hidden.has(object.key) ||
            (v.isolated && !v.isolated.has(object.key))
          )
            continue;
          const lo = object.bounds.min,
            hi = object.bounds.max,
            ps = [];
          for (const x of [lo.x, hi.x])
            for (const y of [lo.y, hi.y])
              for (const z of [lo.z, hi.z])
                ps.push(this.project(new THREE.Vector3(x, y, z)));
          if (ps.every((p) => p.z > 1 || p.z < -1)) continue;
          this.rects.push({
            object,
            model,
            minX: Math.min(...ps.map((p) => p.x)),
            maxX: Math.max(...ps.map((p) => p.x)),
            minY: Math.min(...ps.map((p) => p.y)),
            maxY: Math.max(...ps.map((p) => p.y)),
          });
        }
    }
    return this.rects
      .filter(
        (r) =>
          cursor.x >= r.minX - 18 &&
          cursor.x <= r.maxX + 18 &&
          cursor.y >= r.minY - 18 &&
          cursor.y <= r.maxY + 18,
      )
      .sort((a, b) =>
        a.object === hit?.object
          ? -1
          : b.object === hit?.object
            ? 1
            : (a.maxX - a.minX) * (a.maxY - a.minY) -
              (b.maxX - b.minX) * (b.maxY - b.minY),
      )
      .slice(0, 24);
  }
  resolve(event, hit, anchor = null, modelId = null) {
    const v = this.viewer,
      rect = v.renderer.domElement.getBoundingClientRect(),
      cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const moved =
      !this.cursor ||
      Math.hypot(cursor.x - this.cursor.x, cursor.y - this.cursor.y) > 2 ||
      this.cameraStamp !== this.stamp;
    if (moved) {
      this.cycled = false;
      this.lineCycled = false;
    }
    this.cursor = cursor;
    const candidates = [],
      lines = [];
    const add = (point, snap, id, object) => {
      if (!this.settings.enabled || !this.settings[snap]) return;
      const screen = this.project(point),
        pixels = Math.hypot(screen.x - cursor.x, screen.y - cursor.y);
      if (
        pixels <= (this.chosen?.id === id ? 18 : 12) &&
        screen.z >= -1 &&
        screen.z <= 1 &&
        v.clippingPlanes.every((p) => p.distanceToPoint(point) >= -1e-6)
      )
        candidates.push({ kind: "point", point, id, object, snap, pixels });
    };
    for (const { object, model } of this.nearby(cursor, hit)) {
      if (modelId && model.id !== modelId) continue;
      const f = objectFeatures(object, model);
      for (const corner of f.corners)
        add(corner.point, "endpoint", corner.id, object);
      for (const [i, center] of (object.snapCenters || []).entries())
        add(center, "center", `${object.key}:c${i}`, object);
      for (const raw of f.lines) {
        const edge = clipFeature(raw, v.clippingPlanes);
        if (!edge) continue;
        const A = this.project(edge.a),
          B = this.project(edge.b),
          dx = B.x - A.x,
          dy = B.y - A.y;
        if (
          cursor.x < Math.min(A.x, B.x) - 18 ||
          cursor.x > Math.max(A.x, B.x) + 18 ||
          cursor.y < Math.min(A.y, B.y) - 18 ||
          cursor.y > Math.max(A.y, B.y) + 18
        )
          continue;
        let t = THREE.MathUtils.clamp(
          ((cursor.x - A.x) * dx + (cursor.y - A.y) * dy) /
            (dx * dx + dy * dy || 1),
          0,
          1,
        );
        // Correct the interpolation parameter for perspective projection.
        if (v.camera.isPerspectiveCamera) {
          const a = edge.a.clone().applyMatrix4(v.camera.matrixWorldInverse),
            b = edge.b.clone().applyMatrix4(v.camera.matrixWorldInverse);
          t = t / -b.z / ((1 - t) / -a.z + t / -b.z);
        }
        const point = edge.a.clone().lerp(edge.b, t),
          p = this.project(point),
          pixels = Math.hypot(p.x - cursor.x, p.y - cursor.y);
        if (pixels <= 12 && edge.selectable && this.visible(point, object))
          lines.push({ ...edge, pickPoint: point, pixels });
        add(point, "edge", `${edge.id}:nearest`, object);
        if (edge.selectable) {
          add(
            edge.a.clone().lerp(edge.b, 0.5),
            "midpoint",
            `${edge.id}:mid`,
            object,
          );
          if (anchor) {
            const perpendicular = new THREE.Line3(
              edge.a,
              edge.b,
            ).closestPointToPoint(anchor, false, new THREE.Vector3());
            const d = edge.a.distanceTo(edge.b);
            if (
              perpendicular.distanceTo(edge.a) <= d + 1e-8 &&
              perpendicular.distanceTo(edge.b) <= d + 1e-8
            )
              add(perpendicular, "perpendicular", `${edge.id}:perp`, object);
          }
        }
      }
    }
    this.face = null;
    if (hit && (!modelId || hit.object.modelId === modelId)) {
      const model = v.models.find((m) => m.id === hit.object.modelId),
        f = objectFeatures(hit.object, model),
        raw = hitFace(f, hit);
      this.face = raw ? clipFeature(raw, v.clippingPlanes) : null;
      if (anchor && this.face) {
        const point = this.face.plane.projectPoint(anchor, new THREE.Vector3());
        const d = closestFeatures({ kind: "point", point }, this.face);
        if (d.distance < 1e-7)
          add(point, "perpendicular", `${this.face.id}:perp`, hit.object);
      }
      if (!this.settings.enabled || this.settings.surface)
        candidates.push({
          kind: "point",
          point: hit.point.clone(),
          id: `${hit.object.key}:surface`,
          object: hit.object,
          snap: "surface",
          pixels: 0,
        });
    }
    candidates.sort(
      (a, b) => rank[a.snap] - rank[b.snap] || a.pixels - b.pixels,
    );
    this.candidates = candidates
      .filter(
        (c, i) =>
          c.snap === "surface" || (i < 80 && this.visible(c.point, c.object)),
      )
      .slice(0, 20);
    this.lines = lines.sort((a, b) => a.pixels - b.pixels);
    const old = this.candidates.find((c) => c.id === this.chosen?.id),
      best = this.candidates[0];
    this.chosen =
      old && (this.cycled || rank[old.snap] <= rank[best?.snap]) ? old : best;
    this.cameraStamp = this.stamp;
    return this.chosen;
  }
  feature(kind) {
    if (kind === "line")
      return (
        (this.lineCycled && this.lines.find((l) => l.id === this.lineId)) ||
        this.lines[0] ||
        null
      );
    if (kind === "face") return this.face;
    return this.chosen || null;
  }
}
