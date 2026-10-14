import {
  IFCSYSTEM,
  IFCZONE,
  IFCSPATIALZONE,
  IFCRELASSIGNSTOGROUP,
  IFCRELAGGREGATES,
  IFCRELNESTS,
  IFCRELCONTAINEDINSPATIALSTRUCTURE,
  IFCRELREFERENCEDINSPATIALSTRUCTURE,
  IFCRELDEFINESBYTYPE,
} from "web-ifc";
import { ifcValue } from "./model-state.js";

// Group membership is many-to-many. Follow explicit IFC relationships instead
// of inferring systems or zones from names or property strings.
export function readIfcGroups(api, modelId, renderedIds) {
  const warnings = [];
  function idsFor(type) {
    const vector = api.GetLineIDsWithType(modelId, type, true);
    try {
      return Array.from({ length: vector.size() }, (_, i) => vector.get(i));
    } finally {
      vector.delete?.();
    }
  }
  function read(id) {
    try {
      return api.GetLine(modelId, id);
    } catch {
      warnings.push(id);
      return null;
    }
  }
  const zones = new Set([...idsFor(IFCZONE), ...idsFor(IFCSPATIALZONE)]);
  const systems = idsFor(IFCSYSTEM).filter((id) => !zones.has(id));
  const edges = new Map();
  function connect(parent, children) {
    if (parent == null) return;
    if (!edges.has(parent)) edges.set(parent, new Set());
    for (const child of children || []) {
      const id = ifcValue(child);
      if (id != null) edges.get(parent).add(id);
    }
  }
  for (const [type, parent, children] of [
    [IFCRELASSIGNSTOGROUP, "RelatingGroup", "RelatedObjects"],
    [IFCRELAGGREGATES, "RelatingObject", "RelatedObjects"],
    [IFCRELNESTS, "RelatingObject", "RelatedObjects"],
    [IFCRELCONTAINEDINSPATIALSTRUCTURE, "RelatingStructure", "RelatedElements"],
    [
      IFCRELREFERENCEDINSPATIALSTRUCTURE,
      "RelatingStructure",
      "RelatedElements",
    ],
    [IFCRELDEFINESBYTYPE, "RelatingType", "RelatedObjects"],
  ])
    for (const id of idsFor(type)) {
      const relation = read(id);
      if (relation) connect(ifcValue(relation[parent]), relation[children]);
    }
  const rendered = new Set(renderedIds);
  const groups = [];
  for (const [kind, ids] of [
    ["systems", systems],
    ["zones", [...zones]],
  ])
    for (const id of ids) {
      const line = read(id);
      if (!line) continue;
      const visited = new Set(),
        members = new Set(),
        queue = [id];
      while (queue.length) {
        const current = queue.pop();
        if (visited.has(current)) continue;
        visited.add(current);
        if (rendered.has(current)) members.add(current);
        for (const child of edges.get(current) || []) queue.push(child);
      }
      const name = String(ifcValue(line.Name) || "").trim();
      groups.push({
        id,
        kind,
        type: api.GetNameFromTypeCode(line.type),
        name:
          !name || /^(undefined|null|\$)$/i.test(name)
            ? `${kind === "systems" ? "System" : "Zon"} #${id}`
            : name,
        memberIds: [...members],
      });
    }
  return {
    groups,
    warning: warnings.length ? "Vissa grupprelationer kunde inte läsas." : "",
  };
}
