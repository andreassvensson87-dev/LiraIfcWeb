import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { cameraPanOffset, rotateAroundPoint } from "../src/input-navigation.js";
import { inputWheelGesture } from "../src/input-device.js";

test("orbit around an off-centre surface point preserves its screen position in both projections", () => {
  for (const camera of [
    new THREE.PerspectiveCamera(40, 1.5, 0.01, 100),
    new THREE.OrthographicCamera(-3, 3, 2, -2, 0.01, 100),
  ]) {
    camera.position.set(3, 3, 5);
    const target = new THREE.Vector3();
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const pivot = new THREE.Vector3(0.8, 0.2, 0.4);
    const before = pivot.clone().project(camera);
    const distance = camera.position.distanceTo(pivot);
    rotateAroundPoint(camera, target, pivot, 70, -20, 600);
    const after = pivot.clone().project(camera);
    assert(before.distanceTo(after) < 1e-6);
    assert(Math.abs(camera.position.distanceTo(pivot) - distance) < 1e-6);
    // OrbitControls' look-at update must preserve the same orientation.
    camera.lookAt(target);
    camera.updateMatrixWorld();
    assert(before.distanceTo(pivot.clone().project(camera)) < 1e-6);
  }
});
test("pan moves in screen axes with equivalent scaling for both projections", () => {
  const ortho = new THREE.OrthographicCamera(-3, 3, 2, -2, 0.01, 100);
  const perspective = new THREE.PerspectiveCamera(40, 1.5, 0.01, 100);
  perspective.position.z = 2 / Math.tan(THREE.MathUtils.degToRad(20));
  const a = cameraPanOffset(ortho, new THREE.Vector3(), 100, 60, 900, 600);
  const b = cameraPanOffset(
    perspective,
    new THREE.Vector3(),
    100,
    60,
    900,
    600,
  );
  assert(a.distanceTo(b) < 1e-6);
  assert(a.x > 0 && a.y < 0);
});
test("trackpad scroll pans, shift scroll pans horizontally and pinch zooms", () => {
  const event = {
    deltaMode: 0,
    deltaX: 0,
    deltaY: 50,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };
  assert.equal(inputWheelGesture(event, "mouse").action, "zoom");
  assert.deepEqual(inputWheelGesture(event, "trackpad"), {
    action: "pan",
    x: 0,
    y: 50,
  });
  assert.deepEqual(
    inputWheelGesture({ ...event, shiftKey: true }, "trackpad"),
    { action: "pan", x: 50, y: 0 },
  );
  assert.equal(
    inputWheelGesture({ ...event, ctrlKey: true }, "trackpad").action,
    "zoom",
  );
});
