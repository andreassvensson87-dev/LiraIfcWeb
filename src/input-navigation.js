import * as THREE from "three";
import {
  inputDevice,
  inputWheelGesture,
  zoomSpeed,
  orbitDamping,
  zoomDirection,
} from "./input-device.js";

export function configureNavigation(controls) {
  controls.mouseButtons.LEFT = null;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  controls.enableDamping = orbitDamping();
  controls.dampingFactor = 0.05;
  controls.zoomToCursor = true;
  controls.zoomSpeed = zoomSpeed();
  controls.minZoom = 0.001;
  controls.maxZoom = 1000;
  controls.screenSpacePanning = true;
}

export function cameraPanOffset(camera, target, x, y, width, height) {
  const viewHeight = camera.isOrthographicCamera
    ? (camera.top - camera.bottom) / camera.zoom
    : 2 *
      camera.position.distanceTo(target) *
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const viewWidth = camera.isOrthographicCamera
    ? (camera.right - camera.left) / camera.zoom
    : viewHeight * camera.aspect;
  return new THREE.Vector3(1, 0, 0)
    .applyQuaternion(camera.quaternion)
    .multiplyScalar((x * viewWidth) / Math.max(width, 1))
    .addScaledVector(
      new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion),
      (-y * viewHeight) / Math.max(height, 1),
    );
}

export function rotateAroundPoint(
  camera,
  target,
  pivot,
  dx,
  dy,
  height,
  speed = 1,
) {
  const up = camera.up.clone().normalize();
  const yaw = new THREE.Quaternion().setFromAxisAngle(
    up,
    ((-2 * Math.PI * dx) / Math.max(height, 1)) * speed,
  );
  const right = new THREE.Vector3(1, 0, 0)
    .applyQuaternion(camera.quaternion)
    .applyQuaternion(yaw);
  const polar = camera.position.clone().sub(target).angleTo(up);
  const wanted = ((-2 * Math.PI * dy) / Math.max(height, 1)) * speed;
  const pitchAngle =
    THREE.MathUtils.clamp(polar + wanted, 1e-5, Math.PI - 1e-5) - polar;
  const pitch = new THREE.Quaternion().setFromAxisAngle(right, pitchAngle);
  const rotation = pitch.multiply(yaw);
  // Rotate camera and its look target together. Unlike changing controls.target
  // at pointer-down, this preserves an off-centre picked pivot on screen in both
  // perspective and orthographic views without an initial jump.
  camera.position.sub(pivot).applyQuaternion(rotation).add(pivot);
  target.sub(pivot).applyQuaternion(rotation).add(pivot);
  camera.quaternion.premultiply(rotation);
  camera.updateMatrixWorld();
}

export function installInputNavigation(
  host,
  canvas,
  getControls,
  pick,
  invalidate,
) {
  let drag = null;
  const pending = new THREE.Vector2();
  let pivot = new THREE.Vector3();
  const forwarded = new WeakSet();
  const start = (event) => {
    pending.set(0, 0);
    if (
      event.pointerType === "touch" ||
      ![1, 2].includes(event.button) ||
      !(event.shiftKey || event.ctrlKey || event.metaKey)
    )
      return;
    const controls = getControls();
    if (!controls.enabled || !controls.enableRotate) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pivot.copy(pick(event)?.point || controls.target);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  };
  const move = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pending.x += event.clientX - drag.x;
    pending.y += event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    invalidate();
  };
  const end = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
  };
  const cancel = () => {
    drag = null;
    pending.set(0, 0);
  };
  const lost = () => {
    if (drag) cancel();
  };
  const wheel = (event) => {
    event.preventDefault();
    if (forwarded.has(event)) return;
    pending.set(0, 0);
    const controls = getControls();
    const gesture = inputWheelGesture(event, inputDevice(), host.clientHeight);
    controls.zoomSpeed = zoomSpeed();
    if (gesture.action === "pan") {
      event.stopImmediatePropagation();
      if (!controls.enabled || !controls.enablePan) return;
      const offset = cameraPanOffset(
        controls.object,
        controls.target,
        gesture.x,
        gesture.y,
        host.clientWidth,
        host.clientHeight,
      );
      controls.object.position.add(offset);
      controls.target.add(offset);
      controls.update();
      invalidate();
      return;
    }
    const direction = zoomDirection(event);
    if (event.target === canvas && direction === 1) return;
    event.stopImmediatePropagation();
    const next = new WheelEvent("wheel", {
      cancelable: true,
      bubbles: false,
      clientX: event.clientX,
      clientY: event.clientY,
      deltaX: event.deltaX,
      deltaY: event.deltaY * direction,
      deltaMode: event.deltaMode,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    });
    forwarded.add(next);
    canvas.dispatchEvent(next);
  };
  host.addEventListener("pointerdown", start, true);
  host.addEventListener("pointermove", move, true);
  host.addEventListener("pointerup", end, true);
  host.addEventListener("pointercancel", cancel, true);
  canvas.addEventListener("lostpointercapture", lost);
  host.addEventListener("wheel", wheel, { capture: true, passive: false });
  return {
    update() {
      if (pending.lengthSq() < 1e-5) {
        pending.set(0, 0);
        return false;
      }
      const controls = getControls();
      if (!controls.enabled) {
        pending.set(0, 0);
        return false;
      }
      const factor = controls.enableDamping ? controls.dampingFactor : 1;
      rotateAroundPoint(
        controls.object,
        controls.target,
        pivot,
        pending.x * factor,
        pending.y * factor,
        host.clientHeight,
        controls.rotateSpeed,
      );
      pending.multiplyScalar(1 - factor);
      return true;
    },
    cancel,
    dispose() {
      host.removeEventListener("pointerdown", start, true);
      host.removeEventListener("pointermove", move, true);
      host.removeEventListener("pointerup", end, true);
      host.removeEventListener("pointercancel", cancel, true);
      canvas.removeEventListener("lostpointercapture", lost);
      host.removeEventListener("wheel", wheel, true);
    },
  };
}
