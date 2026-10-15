import * as THREE from "three";
import { pickedObject } from "./batches.js";

// Tangent or wholly one-sided closed volumes contribute no cut area. This is
// deliberately conservative: a straddling batch still renders in full.
export function crossesSectionPlane(bounds, plane) {
  if (!bounds || bounds.isEmpty()) return false;
  let min = plane.constant,
    max = plane.constant;
  for (const axis of ["x", "y", "z"]) {
    const n = plane.normal[axis];
    min += n * (n >= 0 ? bounds.min[axis] : bounds.max[axis]);
    max += n * (n >= 0 ? bounds.max[axis] : bounds.min[axis]);
  }
  return min < -1e-7 && max > 1e-7;
}

// Count oriented surfaces in the stencil buffer, then draw only the non-zero
// cross-section. Each box face has its own counter and is clipped by the other
// five planes. The geometry is borrowed from the current visible render batches.
// Technique reference: https://threejs.org/examples/webgl_clipping_stencil.html
export class SectionCaps {
  constructor(scene) {
    this.scene = scene;
    this.passes = [];
    this.batches = [];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#dbbf88";
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = "#b2915e";
    ctx.lineWidth = 1.5;
    for (let x = -64; x <= 64; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 64);
      ctx.lineTo(x + 64, 0);
      ctx.stroke();
    }
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.anisotropy = 4;
    this.texture.repeat.setScalar(55);
  }

  update(planes, bounds, batches) {
    const opaque = batches.filter(
      (batch) => !batch.model.cadData && !batch.mesh.material.transparent,
    );
    const changed =
      this.passes.length !== planes.length ||
      opaque.length !== this.batches.length ||
      opaque.some((batch, i) => batch !== this.batches[i]);
    if (changed) {
      this.clear();
      this.batches = opaque;
      for (let i = 0; i < planes.length; i++) this.createPass(i);
    }
    if (!planes.length || !bounds) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = Math.max(
      bounds.getSize(new THREE.Vector3()).length() * 1.1,
      0.01,
    );
    // Relative hatch density remains readable on both small parts and buildings.
    this.passes.forEach((pass, i) => {
      const plane = planes[i];
      pass.back.clippingPlanes = pass.front.clippingPlanes = [plane];
      pass.cap.material.clippingPlanes = planes.filter((_, j) => i !== j);
      pass.cap.userData.plane = plane;
      plane.projectPoint(center, pass.cap.position);
      pass.cap.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        plane.normal.clone().negate(),
      );
      pass.cap.scale.set(size, size, 1);
      let active = false;
      pass.stencils.forEach(({ batch, back, front }) => {
        const crosses =
          batch.mesh.visible &&
          crossesSectionPlane(batch.mesh.geometry.boundingBox, plane);
        back.visible = front.visible = crosses;
        active ||= crosses;
      });
      pass.cap.visible = active;
    });
  }

  createPass(index) {
    // All cap passes finish before regular model rendering (order 100). Depth
    // testing subsequently lets uncut foreground surfaces occlude the caps.
    const order = index * 3 + 1;
    const stencil = new THREE.MeshBasicMaterial({
      depthWrite: false,
      depthTest: false,
      colorWrite: false,
      stencilWrite: true,
      stencilFunc: THREE.AlwaysStencilFunc,
    });
    const back = stencil.clone(),
      front = stencil.clone();
    stencil.dispose();
    back.side = THREE.BackSide;
    front.side = THREE.FrontSide;
    back.stencilFail =
      back.stencilZFail =
      back.stencilZPass =
        THREE.IncrementWrapStencilOp;
    front.stencilFail =
      front.stencilZFail =
      front.stencilZPass =
        THREE.DecrementWrapStencilOp;
    const stencils = this.batches.map((batch) => {
      const b = new THREE.Mesh(batch.mesh.geometry, back),
        f = new THREE.Mesh(batch.mesh.geometry, front);
      b.renderOrder = f.renderOrder = order;
      // Stencil passes must still run when the cap is in view but the source
      // surfaces lie outside the camera frustum.
      b.frustumCulled = f.frustumCulled = false;
      this.scene.add(b, f);
      return { batch, back: b, front: f };
    });
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      side: THREE.DoubleSide,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.ReplaceStencilOp,
    });
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    cap.renderOrder = order + 1;
    cap.frustumCulled = false;
    cap.onAfterRender = (renderer) => renderer.clearStencil();
    this.scene.add(cap);
    this.passes.push({ back, front, stencils, cap });
  }

  pick(raycaster, nearestDistance = Infinity) {
    let result = null;
    const point = new THREE.Vector3();
    for (const pass of this.passes) {
      if (!pass.cap.visible) continue;
      const plane = pass.cap.userData.plane;
      if (!raycaster.ray.intersectPlane(plane, point)) continue;
      const distance = point.distanceTo(raycaster.ray.origin);
      if (
        distance >= nearestDistance ||
        pass.cap.material.clippingPlanes.some(
          (p) => p.distanceToPoint(point) < -1e-6,
        )
      )
        continue;
      const object = objectAtSectionPoint(point, plane, this.batches);
      if (object) {
        result = { point: point.clone(), distance, object, sectionCap: true };
        nearestDistance = distance;
      }
    }
    return result;
  }

  clear() {
    for (const pass of this.passes) {
      pass.stencils.forEach(({ back, front }) =>
        this.scene.remove(back, front),
      );
      pass.back.dispose();
      pass.front.dispose();
      this.scene.remove(pass.cap);
      pass.cap.geometry.dispose();
      pass.cap.material.dispose();
    }
    this.passes = [];
    this.batches = [];
  }
}

// A cap is a screen-space fill. Resolve its object by the same oriented-surface
// winding rule rather than allowing its rectangular carrier plane to be picked.
// This preserves empty holes and permits selection/meter measurements on cuts.
export function objectAtSectionPoint(point, plane, batches) {
  const ray = new THREE.Raycaster(point.clone(), plane.normal.clone(), 1e-7);
  const hits = ray.intersectObjects(
    batches.filter((b) => b.mesh.visible).map((b) => b.mesh),
    false,
  );
  const byObject = new Map();
  for (const hit of hits) {
    const object = pickedObject(hit.object.userData.batch, hit.faceIndex);
    if (!object || !object.bounds.containsPoint(point)) continue;
    const sign = Math.sign(hit.face.normal.dot(plane.normal));
    if (!sign) continue;
    if (!byObject.has(object)) byObject.set(object, []);
    byObject.get(object).push({ distance: hit.distance, sign });
  }
  let result = null,
    nearest = Infinity;
  for (const [object, crossings] of byObject) {
    const unique = [];
    for (const hit of crossings) {
      // Adjacent triangles may both report the same intersection at a diagonal.
      if (
        !unique.some(
          (other) =>
            Math.abs(other.distance - hit.distance) < 1e-6 &&
            other.sign === hit.sign,
        )
      )
        unique.push(hit);
    }
    if (
      unique.reduce((sum, hit) => sum + hit.sign, 0) !== 0 &&
      crossings[0].distance < nearest
    ) {
      result = object;
      nearest = crossings[0].distance;
    }
  }
  return result;
}
