import palette from "dxf-parser/dist/AutoCadColorIndex.js";
import * as THREE from "three";

// These handlers retain mesh topology that dxf-parser 1.1.2 otherwise discards.
export function registerCadGeometry(parser) {
  for (const type of [
    "3DFACE",
    "SOLID",
    "TRACE",
    "POLYLINE",
    "MESH",
    "3DSOLID",
    "INSERT",
  ]) {
    parser.registerEntityHandler(
      class {
        ForEntityName = type;
        parseEntity(scanner) {
          const read = () => {
            const groups = [];
            let g = scanner.next();
            while (g.code !== 0) {
              groups.push(g);
              g = scanner.next();
            }
            return groups;
          };
          const groups = read(),
            value = (code, fallback) =>
              groups.find((g) => g.code === code)?.value ?? fallback;
          const point = (code) => ({
            x: value(code, 0),
            y: value(code + 10, 0),
            z: value(code + 20, 0),
          });
          const entity = {
            type,
            layer: value(8, "0"),
            handle: value(5),
            visible: value(60, 0) === 0,
            inPaperSpace: value(67, 0) !== 0,
            color: value(420, palette[Math.abs(value(62, 256))]),
            colorIndex: value(62, 256),
            trueColor: value(420),
            extrusionDirection: point(210),
          };
          entity.extrusionDirection.z = value(230, 1);
          if (type === "INSERT") {
            Object.assign(entity, {
              name: value(2),
              position: point(10),
              xScale: value(41, 1),
              yScale: value(42, 1),
              zScale: value(43, 1),
              rotation: value(50, 0),
              columnCount: value(70, 1),
              rowCount: value(71, 1),
              columnSpacing: value(44, 0),
              rowSpacing: value(45, 0),
            });
          } else if (type === "POLYLINE") {
            const flags = value(70, 0);
            Object.assign(entity, {
              shape: !!(flags & 1),
              includesCurveFitVertices: !!(flags & 2),
              includesSplineFitVertices: !!(flags & 4),
              is3dPolyline: !!(flags & 8),
              is3dPolygonMesh: !!(flags & 16),
              is3dPolygonMeshClosed: !!(flags & 32),
              isPolyfaceMesh: !!(flags & 64),
              mCount: value(71, 0),
              nCount: value(72, 0),
              vertices: [],
            });
            while (scanner.lastReadGroup.value === "VERTEX") {
              const tags = read(),
                v = (code) => tags.find((g) => g.code === code)?.value;
              entity.vertices.push({
                x: v(10),
                y: v(20),
                z: v(30) ?? 0,
                bulge: v(42),
                faceA: v(71),
                faceB: v(72),
                faceC: v(73),
                faceD: v(74),
              });
            }
            if (scanner.lastReadGroup.value !== "SEQEND")
              throw Error("Ogiltig POLYLINE.");
            read();
          } else if (type === "MESH") {
            entity.subdivisionLevel = value(91, 0);
            entity.vertices = [];
            let vertex;
            for (const g of groups) {
              if (g.code === 10) {
                vertex = { x: g.value, y: 0, z: 0 };
                entity.vertices.push(vertex);
              } else if (g.code === 20 && vertex) vertex.y = g.value;
              else if (g.code === 30 && vertex) vertex.z = g.value;
            }
            const start = groups.findIndex((g) => g.code === 93),
              count = value(93, 0);
            const list = groups.slice(start + 1, start + 1 + count);
            if (
              start < 0 ||
              list.length !== count ||
              list.some((g) => g.code !== 90)
            )
              throw Error("Ogiltig MESH-topologi.");
            entity.faces = [];
            for (let i = 0; i < list.length; ) {
              const n = list[i++].value;
              if (n < 3 || n > list.length - i)
                throw Error("Ogiltig MESH-yta.");
              entity.faces.push(list.slice(i, i + n).map((g) => g.value));
              i += n;
            }
          } else
            entity.vertices = [10, 11, 12, 13]
              .filter((code) => groups.some((g) => g.code === code))
              .map(point);
          return entity;
        }
      },
    );
  }
}

export const xyz = (p) => {
  const result = [p?.x, p?.y, p?.z ?? 0];
  if (!result.every(Number.isFinite)) throw Error("Ogiltiga CAD-koordinater.");
  return result;
};
export function surfaceGeometry(e) {
  let vertices = e.vertices,
    faces;
  if (["3DFACE", "SOLID", "TRACE"].includes(e.type)) {
    faces = [
      e.type === "3DFACE"
        ? vertices.map((_, i) => i)
        : vertices.length === 4
          ? [0, 1, 3, 2]
          : [0, 1, 2],
    ];
  } else if (e.type === "MESH") faces = e.faces;
  else if (e.isPolyfaceMesh) {
    faces = vertices
      .filter((v) => v.faceA !== undefined)
      .map((v) =>
        [v.faceA, v.faceB, v.faceC, v.faceD]
          .filter((i) => i !== undefined && i !== 0)
          .map((i) => Math.abs(i) - 1),
      );
    vertices = vertices.filter((v) => v.faceA === undefined);
  } else if (e.is3dPolygonMesh) {
    const m = e.mCount,
      n = e.nCount;
    faces = [];
    if (m < 2 || n < 2 || m * n !== vertices.length)
      throw Error("Ogiltigt polygonmesh.");
    for (let i = 0; i < m - (e.shape ? 0 : 1); i++)
      for (let j = 0; j < n - (e.is3dPolygonMeshClosed ? 0 : 1); j++)
        faces.push([
          i * n + j,
          ((i + 1) % m) * n + j,
          ((i + 1) % m) * n + ((j + 1) % n),
          i * n + ((j + 1) % n),
        ]);
  } else return null;
  const points = vertices.map(xyz),
    indices = [];
  for (let face of faces) {
    if (face.some((i) => !Number.isInteger(i) || i < 0 || i >= points.length))
      throw Error("Ogiltigt CAD-meshindex.");
    face = face.filter(
      (id, i) => !i || points[id].some((v, k) => v !== points[face[i - 1]][k]),
    );
    if (
      face.length > 2 &&
      points[face[0]].every((v, k) => v === points[face.at(-1)][k])
    )
      face.pop();
    if (face.length < 3) continue;
    // Project on the dominant plane before ear clipping (also handles concave faces).
    const normal = new THREE.Vector3();
    for (let i = 0; i < face.length; i++) {
      const a = points[face[i]],
        b = points[face[(i + 1) % face.length]];
      normal.x += (a[1] - b[1]) * (a[2] + b[2]);
      normal.y += (a[2] - b[2]) * (a[0] + b[0]);
      normal.z += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const axis = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)],
      drop = axis.indexOf(Math.max(...axis));
    if (axis[drop] < 1e-15) continue;
    const dims = [0, 1, 2].filter((i) => i !== drop),
      base = points[face[0]];
    const contour = face.map(
      (id) =>
        new THREE.Vector2(
          points[id][dims[0]] - base[dims[0]],
          points[id][dims[1]] - base[dims[1]],
        ),
    );
    for (const tri of THREE.ShapeUtils.triangulateShape(contour, []))
      indices.push(...tri.map((i) => face[i]));
  }
  return { points, indices };
}
