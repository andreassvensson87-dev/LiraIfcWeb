import * as THREE from "three";
export function cadPoint(point, placement, origin) {
  const scale = placement.unitFactor,
    angle = (placement.rotation * Math.PI) / 180;
  const x = point[0] * scale,
    y = point[1] * scale;
  return [
    x * Math.cos(angle) - y * Math.sin(angle) - origin[0] + placement.x,
    (point[2] || 0) * scale - origin[1] + placement.elevation,
    -(x * Math.sin(angle) + y * Math.cos(angle)) - origin[2] + placement.z,
  ];
}
export function cadBounds(data) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const entity of data.entities)
    for (const point of entity.points || [entity.point]) {
      if (!point) continue;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], point[i] || 0);
        max[i] = Math.max(max[i], point[i] || 0);
      }
    }
  return { min, max };
}
export function initialCadOrigin(data, unitFactor = data.unitFactor) {
  if (!(unitFactor > 0) || !Number.isFinite(unitFactor))
    throw Error("Välj ritningens enhet.");
  const { min, max } = cadBounds(data);
  return [min[0] * unitFactor, 0, -max[1] * unitFactor];
}
export function buildCadModel(model) {
  const data = model.cadData,
    origin = model.origin,
    placement = model.placement;
  model.objects = [];
  model.parts = [];
  const textures = new Map();
  data.entities.forEach((entity, index) => {
    const color = new THREE.Color(entity.color || "#405d69");
    if (
      entity.sourceType !== "3DSOLID" &&
      Math.min(color.r, color.g, color.b) > 0.75
    )
      color.set("#405d69");
    else if (
      entity.sourceType !== "3DSOLID" &&
      0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b > 0.7
    )
      color.multiplyScalar(0.45);
    const object = {
      expressId: index + 1,
      name:
        entity.type === "text"
          ? entity.text
          : `${entity.layer || "0"} · ${entity.type === "mesh" ? "Yta" : "Linje"} ${index + 1}`,
      ifcClass:
        entity.type === "text"
          ? "CADText"
          : entity.type === "mesh"
            ? "CADMesh"
            : "CADLine",
      globalId: "",
      cadCurve: !!entity.curve,
      snapCenters: entity.center
        ? [new THREE.Vector3(...cadPoint(entity.center, placement, origin))]
        : [],
      level: entity.layer || "0",
      referenceProperties: {
        Format: model.format,
        ...(entity.sourceHandle
          ? {
              "DWG-handle": entity.sourceHandle,
              Geometri: entity.complete ? "Fullständig" : "Ofullständig",
            }
          : {}),
        Lager: entity.layer || "0",
        Typ:
          entity.type === "text"
            ? "Text"
            : entity.type === "mesh"
              ? `Fylld yta / ${entity.sourceType}`
              : "Linje/kurva",
      },
    };
    let positions = [],
      indices = [],
      normals = [],
      uvs,
      texture;
    if (entity.type === "mesh") {
      positions = entity.points.flatMap((p) => cadPoint(p, placement, origin));
      indices = entity.indices;
    } else if (entity.type === "line") {
      for (let i = 1; i < entity.points.length; i++) {
        positions.push(
          ...cadPoint(entity.points[i - 1], placement, origin),
          ...cadPoint(entity.points[i], placement, origin),
        );
      }
      indices = Array.from({ length: positions.length / 3 }, (_, i) => i);
    } else if (entity.type === "text" && entity.text.trim()) {
      if (!textures.has(entity.text)) {
        const canvas = document.createElement("canvas"),
          ctx = canvas.getContext("2d"),
          lines = entity.text.split("\n");
        ctx.font = "32px Arial";
        canvas.width = Math.max(
          8,
          Math.min(
            4096,
            Math.ceil(
              Math.max(...lines.map((line) => ctx.measureText(line).width)) + 8,
            ),
          ),
        );
        canvas.height = Math.min(2048, lines.length * 40);
        ctx.font = "32px Arial";
        ctx.fillStyle = "white";
        ctx.textBaseline = "alphabetic";
        lines.forEach((line, i) => ctx.fillText(line, 4, 32 + i * 40));
        const map = new THREE.CanvasTexture(canvas);
        map.colorSpace = THREE.SRGBColorSpace;
        textures.set(entity.text, {
          map,
          width: canvas.width / 32,
          height: canvas.height / 32,
        });
      }
      const glyph = textures.get(entity.text);
      texture = glyph.map;
      const width = glyph.width * entity.size,
        height = glyph.height * entity.size,
        offset =
          entity.align === "end"
            ? -width
            : entity.align === "middle"
              ? -width / 2
              : 0;
      const angle = (entity.angle * Math.PI) / 180;
      for (const [x, y] of [
        [offset, -entity.size * 0.25],
        [offset + width, -entity.size * 0.25],
        [offset + width, height - entity.size * 0.25],
        [offset, height - entity.size * 0.25],
      ]) {
        positions.push(
          ...cadPoint(
            [
              entity.point[0] + x * Math.cos(angle) - y * Math.sin(angle),
              entity.point[1] + x * Math.sin(angle) + y * Math.cos(angle),
            ],
            placement,
            origin,
          ),
        );
      }
      indices = [0, 1, 2, 0, 2, 3];
      uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    }
    if (!indices.length) return;
    model.objects.push(object);
    normals = new Float32Array(positions.length);
    if (entity.normals) {
      const angle = (placement.rotation * Math.PI) / 180;
      normals = new Float32Array(
        entity.normals.flatMap(([x, y, z]) => [
          x * Math.cos(angle) - y * Math.sin(angle),
          z,
          -(x * Math.sin(angle) + y * Math.cos(angle)),
        ]),
      );
    } else if (entity.type === "mesh") {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      normals = geometry.attributes.normal.array.slice();
      geometry.dispose();
    }
    model.parts.push({
      id: object.expressId,
      lines: entity.type === "line",
      smooth: !!entity.normals,
      positions: new Float32Array(positions),
      normals,
      indices: new Uint32Array(indices),
      color: color.clone().convertLinearToSRGB().toArray(),
      opacity: 1,
      texture,
      uvs,
    });
  });
  if (!model.parts.length)
    throw Error("Filen saknar ritningsobjekt och ytor som stöds.");
  return model;
}
