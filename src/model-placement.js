import * as THREE from "three";

// Always transform the original buffers, so repeated edits never accumulate drift.
export function placeIfcModel(model, placement) {
  const matrix = new THREE.Matrix4().makeRotationY(
    THREE.MathUtils.degToRad(placement.rotation),
  );
  matrix.setPosition(placement.x, placement.elevation, placement.z);
  const point = new THREE.Vector3();
  model.objects.forEach((object) => object.bounds.makeEmpty());
  for (const batch of model.batches) {
    const geometry = batch.mesh.geometry;
    const positions = geometry.attributes.position,
      normals = geometry.attributes.normal;
    batch.placementSource ||= {
      positions: positions.array.slice(),
      normals: normals.array.slice(),
    };
    for (let i = 0; i < positions.array.length; i += 3) {
      point
        .fromArray(batch.placementSource.positions, i)
        .applyMatrix4(matrix)
        .toArray(positions.array, i);
      point
        .fromArray(batch.placementSource.normals, i)
        .transformDirection(matrix)
        .toArray(normals.array, i);
    }
    positions.needsUpdate = normals.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    for (const range of batch.ranges)
      for (
        let i = range.vertexStart;
        i < range.vertexStart + range.vertexLength;
        i += 3
      )
        range.object.bounds.expandByPoint(point.fromArray(positions.array, i));
  }
  model.placement = { ...placement };
}
