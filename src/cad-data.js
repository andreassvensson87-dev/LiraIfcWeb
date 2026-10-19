import { parseFrameDXF, frameFromDXF, dxfUnits } from "./cad-dxf.js";
export function readCadDrawing(source, { solids = [] } = {}) {
  const doc = parseFrameDXF(source);
  const byHandle = new Map(solids.map((s) => [s.handle?.toUpperCase(), s]));
  const warnings = [];
  const attach = (entity) => {
    if (entity.type !== "3DSOLID") return entity;
    const mesh = byHandle.get(entity.handle?.toUpperCase());
    if (!mesh?.indices?.length) {
      warnings.push(`3DSOLID ${entity.handle || "?"}: kunde inte konverteras`);
      return entity;
    }
    if (!mesh.complete)
      warnings.push(
        `3DSOLID ${entity.handle}: ofullständig geometri (${mesh.missingFaces || 0} saknade ytor)`,
      );
    return {
      ...entity,
      solidMesh: {
        points: mesh.positions,
        normals: mesh.normals,
        indices: mesh.indices,
      },
      solidComplete: mesh.complete,
    };
  };
  const expand = (entity) =>
    entity.type === "DIMENSION" && doc.blocks?.[entity.block]
      ? {
          ...entity,
          type: "INSERT",
          name: entity.block,
          position: { x: 0, y: 0 },
          rotation: 0,
        }
      : entity;
  const visible = (entity) => !entity.inPaperSpace && entity.visible !== false;
  doc.entities = doc.entities.filter(visible).map(expand).map(attach);
  for (const block of Object.values(doc.blocks || {}))
    if (block.entities)
      block.entities = block.entities.filter(visible).map(expand).map(attach);
  doc.omittedTypes = doc.omittedTypes.filter((type) => type !== "DIMENSION");
  let result;
  try {
    result = frameFromDXF(doc, {
      normalizeOrigin: false,
      maxSize: Infinity,
      maxEntities: 100000,
    });
  } catch (error) {
    if (warnings.length)
      throw Error(`Ritningen kunde inte visas. ${warnings.join(". ")}`);
    throw error;
  }
  const unit = dxfUnits.find((unit) => unit.code === doc.header?.$INSUNITS);
  return {
    entities: result.frame.entities,
    unitFactor: unit ? unit.factor / 1000 : null,
    unitName: unit?.name || "Ej angiven",
    unitKnown: !!unit,
    skipped: [...new Set([...result.skipped, ...warnings])],
  };
}
