import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  cubeRegions,
  viewOrientation,
  ViewTransition,
} from "../src/view-navigation.js";

test("view cube has 26 unique physical surfaces with matching normals and named axes", () => {
  const regions = cubeRegions();
  assert.equal(regions.length, 26);
  assert.equal(new Set(regions.map((r) => r.key)).size, 26);
  for (const [kind, count] of [
    ["face", 6],
    ["edge", 12],
    ["corner", 8],
  ])
    assert.equal(regions.filter((r) => r.kind === kind).length, count);
  assert.equal(regions.find((r) => r.key === "0:1:0").label, "Topp");
  assert.equal(regions.find((r) => r.key === "0:0:-1").label, "Fram");
  assert.equal(regions.find((r) => r.key === "1:0:0").label, "Höger");
  for (const region of regions) {
    const distance = region.points[0].dot(region.normal);
    assert.ok(
      region.points.every(
        (point) => Math.abs(point.dot(region.normal) - distance) < 1e-9,
      ),
    );
  }
});

test("all face, edge and corner transitions preserve target, zoom and camera distance in both projections", () => {
  for (const perspective of [true, false])
    for (const region of cubeRegions()) {
      const camera = perspective
        ? new THREE.PerspectiveCamera(40, 1, 0.1, 1000)
        : new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 1000);
      const target = new THREE.Vector3(3, 7, -2);
      camera.position.set(-10, 20, -30);
      camera.zoom = 2.3;
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      const distance = camera.position.distanceTo(target),
        start = camera.position.clone(),
        projection = camera.projectionMatrix.clone();
      const pose = viewOrientation(region.direction),
        transition = new ViewTransition();
      transition.start(camera, target, pose.quaternion, pose.up, 1000);
      transition.update(1000);
      assert.ok(camera.position.distanceTo(start) < 1e-9);
      for (const t of [1020, 1100, 1160, 1260, 1320]) {
        transition.update(t);
        assert.ok(
          Math.abs(camera.position.distanceTo(target) - distance) < 1e-9,
        );
        assert.equal(camera.zoom, 2.3);
        assert.deepEqual(camera.projectionMatrix.elements, projection.elements);
        assert.ok(camera.up.toArray().every(Number.isFinite));
      }
      assert.equal(transition.active, false);
      assert.ok(
        camera.position
          .clone()
          .sub(target)
          .normalize()
          .distanceTo(region.normal) < 1e-9,
      );
      assert.ok(camera.quaternion.angleTo(pose.quaternion) < 1e-7);
      assert.deepEqual(target.toArray(), [3, 7, -2]);
    }
});

test("a cancelled transition keeps the current pose and a new one starts from it without jumping", () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(7, 8, 9);
  const target = new THREE.Vector3();
  camera.lookAt(target);
  const transition = new ViewTransition(),
    top = viewOrientation([0, 1, 0]);
  transition.start(camera, target, top.quaternion, top.up, 0);
  transition.update(120);
  const current = camera.position.clone();
  transition.cancel();
  assert.equal(transition.update(500), false);
  assert.deepEqual(camera.position.toArray(), current.toArray());
  const back = viewOrientation([0, 0, 1]);
  transition.start(camera, target, back.quaternion, back.up, 500);
  transition.update(500);
  assert.ok(camera.position.distanceTo(current) < 1e-9);
});
