import { ifcValue, isObjectVisible } from "./model-state.js";

// Keep IFC node identities, including identically named floors in different
// buildings. Branch controls operate on all descendants, independent of search.
export function buildModelTree(model) {
  const nodes = new Map(),
    assigned = new Set(),
    visited = new Set();
  const names = {
    IFCPROJECT: "Projekt",
    IFCSITE: "Site",
    IFCBUILDING: "Byggnad",
    IFCBUILDINGSTOREY: "Våning",
    IFCSPACE: "Utrymme",
  };
  function visit(raw, path = [], level = "") {
    if (!raw || visited.has(raw.expressID)) return null;
    visited.add(raw.expressID);
    const type = String(raw.type || "IfcSpatialElement");
    const suppliedName = String(ifcValue(raw.Name) || "").trim();
    const name =
      !suppliedName || /^(undefined|null|\$)$/i.test(suppliedName)
        ? names[type.toUpperCase()] || type
        : suppliedName;
    const nextLevel = type.toUpperCase() === "IFCBUILDINGSTOREY" ? name : level;
    const object = model.objectMap.get(raw.expressID);
    const own = object && !assigned.has(object.key) ? [object] : [];
    for (const item of own) {
      assigned.add(item.key);
      item.level = nextLevel || item.level || "Övrigt";
      item.spatialPath = path.join(" / ");
    }
    if (!raw.children?.length && object) return { object: own[0] };
    const node = {
      id: `${model.id}/ifc/${raw.expressID}`,
      name,
      type,
      children: [],
      objects: own,
      members: [],
    };
    for (const rawChild of raw.children || []) {
      const child = visit(rawChild, [...path, name], nextLevel);
      if (child?.object) node.objects.push(child.object);
      else if (child?.members.length) node.children.push(child);
    }
    node.members = [
      ...new Map(
        [
          ...node.objects,
          ...node.children.flatMap((child) => child.members),
        ].map((o) => [o.key, o]),
      ).values(),
    ];
    if (!node.members.length) return null;
    nodes.set(node.id, node);
    return node;
  }
  const root = model.spatial ? visit(model.spatial) : null;
  const roots = root?.members?.length ? [root] : [];
  const remaining = model.objects.filter((o) => !assigned.has(o.key));
  if (root?.object) remaining.unshift(root.object);
  // A standalone geometric IFC may have no spatial containment at all. Demos
  // also use this fallback with their explicitly supplied floor names.
  const groups = new Map();
  for (const object of remaining) {
    const name = model.spatial ? "Övrigt" : object.level || "Övrigt";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(object);
  }
  for (const [name, objects] of [...groups].sort(([a], [b]) =>
    a.localeCompare(b, "sv", { numeric: true }),
  )) {
    const node = {
      id: `${model.id}/${name}`,
      name,
      type: model.demo ? "IfcBuildingStorey" : "",
      children: [],
      objects,
      members: objects,
    };
    roots.push(node);
    nodes.set(node.id, node);
  }
  return { roots, nodes };
}

export function groupVisibility(objects, model, hidden, isolated) {
  const count = objects.filter((object) =>
    isObjectVisible(object, model, hidden, isolated),
  ).length;
  return !count ? "none" : count === objects.length ? "all" : "mixed";
}

export function buildGroupingTree(model, kind) {
  const nodes = new Map(),
    roots = [],
    assigned = new Set();
  function add(id, name, type, objects) {
    const members = [
      ...new Map(objects.map((object) => [object.key, object])).values(),
    ];
    const node = {
      id: `${model.id}/${kind}/${id}`,
      name,
      type,
      children: [],
      objects: members,
      members,
    };
    roots.push(node);
    nodes.set(node.id, node);
    members.forEach((object) => assigned.add(object.key));
  }
  if (kind === "types") {
    const types = new Map();
    for (const object of model.objects) {
      const type = object.ifcClass || "Okänd objekttyp";
      if (!types.has(type)) types.set(type, []);
      types.get(type).push(object);
    }
    for (const [type, objects] of types) add(type, type, type, objects);
  } else {
    for (const group of model.groups || [])
      if (group.kind === kind) {
        add(
          group.id,
          group.name,
          group.type,
          (group.memberIds || [])
            .map((id) => model.objectMap.get(id))
            .filter(Boolean),
        );
      }
    const remaining = model.objects.filter(
      (object) => !assigned.has(object.key),
    );
    if (remaining.length)
      add(
        "unassigned",
        kind === "systems" ? "Ej tilldelat system" : "Ej tilldelad zon",
        "",
        remaining,
      );
  }
  roots.sort((a, b) => a.name.localeCompare(b.name, "sv", { numeric: true }));
  return { roots, nodes };
}

export function toggleGroupVisibility(objects, model, hidden, isolated) {
  const show = groupVisibility(objects, model, hidden, isolated) !== "all";
  if (show) {
    // Revealing one floor in a disabled model must not reveal every other floor.
    if (!model.visible)
      model.objects.forEach((object) => hidden.add(object.key));
    model.visible = true;
    objects.forEach((object) => {
      hidden.delete(object.key);
      isolated?.add(object.key);
    });
  } else objects.forEach((object) => hidden.add(object.key));
  return show;
}
