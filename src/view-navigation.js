import * as THREE from "three";

export function viewOrientation(direction) {
  const position = new THREE.Vector3(...direction).normalize();
  const up =
    Math.abs(position.y) > 0.9999
      ? new THREE.Vector3(0, 0, position.y > 0 ? -1 : 1)
      : new THREE.Vector3(0, 1, 0);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(position, new THREE.Vector3(), up),
  );
  return { quaternion, up };
}

// Animate only orientation; camera distance, zoom and the orbit target stay fixed.
export class ViewTransition {
  constructor() {
    this.motion = null;
  }
  get active() {
    return !!this.motion;
  }
  start(camera, target, quaternion, finalUp, now, duration = 320) {
    this.motion = {
      camera,
      target: target.clone(),
      distance: camera.position.distanceTo(target),
      from: camera.quaternion.clone(),
      to: quaternion.clone(),
      up: finalUp.clone(),
      now,
      duration,
    };
  }
  update(now) {
    const motion = this.motion;
    if (!motion) return false;
    const progress = Math.min(
      1,
      Math.max(0, (now - motion.now) / Math.max(1, motion.duration)),
    );
    const t = progress * progress * (3 - 2 * progress);
    const { camera } = motion;
    camera.quaternion.slerpQuaternions(motion.from, motion.to, t);
    camera.position
      .copy(motion.target)
      .addScaledVector(
        new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion),
        motion.distance,
      );
    camera.up.copy(
      progress === 1
        ? motion.up
        : new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion),
    );
    camera.updateMatrixWorld();
    if (progress === 1) this.motion = null;
    return true;
  }
  cancel() {
    this.motion = null;
  }
}

const names = {
  "1:1": "Topp",
  "1:-1": "Botten",
  "0:1": "Höger",
  "0:-1": "Vänster",
  "2:1": "Bak",
  "2:-1": "Fram",
};
// Chamfered cube: six faces, twelve edges and eight corners, each a real hit surface.
export function cubeRegions() {
  const bevel = 0.72,
    regions = [];
  const label = (direction) =>
    [1, 2, 0]
      .filter((axis) => direction[axis])
      .map((axis) => names[`${axis}:${direction[axis]}`])
      .join(" · ");
  function add(direction, points, kind) {
    const key = direction.join(":");
    regions.push({
      key,
      direction,
      points: points.map((point) => new THREE.Vector3(...point)),
      normal: new THREE.Vector3(...direction).normalize(),
      kind,
      label: label(direction),
    });
  }
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      const others = [0, 1, 2].filter((i) => i !== axis),
        direction = [0, 0, 0];
      direction[axis] = sign;
      const points = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([a, b]) => {
        const p = [0, 0, 0];
        p[axis] = sign;
        p[others[0]] = a * bevel;
        p[others[1]] = b * bevel;
        return p;
      });
      add(direction, points, "face");
    }
  for (let axis = 0; axis < 3; axis++)
    for (const a of [-1, 1])
      for (const b of [-1, 1]) {
        const others = [0, 1, 2].filter((i) => i !== axis),
          direction = [0, 0, 0];
        direction[others[0]] = a;
        direction[others[1]] = b;
        const points = [
          [-bevel, 1, bevel],
          [bevel, 1, bevel],
          [bevel, bevel, 1],
          [-bevel, bevel, 1],
        ].map(([t, u, v]) => {
          const p = [0, 0, 0];
          p[axis] = t;
          p[others[0]] = u * a;
          p[others[1]] = v * b;
          return p;
        });
        add(direction, points, "edge");
      }
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1])
        add(
          [x, y, z],
          [
            [x, y * bevel, z * bevel],
            [x * bevel, y, z * bevel],
            [x * bevel, y * bevel, z],
          ],
          "corner",
        );
  return regions;
}
