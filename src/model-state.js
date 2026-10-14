// Object identities are scoped to a model, never just an IFC express ID.
export const objectKey = (modelId, expressId) => `${modelId}:${expressId}`;
export function matchesObject(object, query = "", type = "") {
  const text =
    `${object.name} ${object.ifcClass} ${object.globalId} ${object.level || ""} ${object.spatialPath || ""}`.toLocaleLowerCase(
      "sv",
    );
  return (
    (!type || object.ifcClass === type) &&
    text.includes(query.trim().toLocaleLowerCase("sv"))
  );
}
export function isObjectVisible(object, model, hidden, isolated) {
  return (
    model.visible &&
    !hidden.has(object.key) &&
    (!isolated || isolated.has(object.key))
  );
}
export function viewSnapshot(models, hidden, isolated, camera, section) {
  return {
    modelIds: models.map((m) => m.id),
    visibility: Object.fromEntries(models.map((m) => [m.id, m.visible])),
    hidden: [...hidden],
    isolated: isolated ? [...isolated] : null,
    camera,
    section: structuredClone(section),
  };
}
export function canRestoreView(view, models) {
  const available = new Set(models.map((m) => m.id));
  return view.modelIds.every((id) => available.has(id));
}
export function safeText(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
export function ifcValue(value) {
  if (value == null) return null;
  if (typeof value !== "object") return value;
  if ("value" in value) return ifcValue(value.value);
  if ("_representationValue" in value)
    return ifcValue(value._representationValue);
  if ("_internalValue" in value) return ifcValue(value._internalValue);
  return null;
}
export function propertySetRows(properties) {
  return properties.flatMap((property) => {
    const name = ifcValue(property.Name) || "Egenskap";
    const candidate =
      property.NominalValue ??
      property.LengthValue ??
      property.AreaValue ??
      property.VolumeValue ??
      property.CountValue ??
      property.WeightValue ??
      property.TimeValue;
    const scalar = ifcValue(candidate);
    if (scalar != null) return [[name, String(scalar)]];
    const values = property.EnumerationValues || property.ListValues;
    if (values)
      return [
        [
          name,
          values
            .map(ifcValue)
            .filter((v) => v != null)
            .join(", ") || "—",
        ],
      ];
    if (property.HasProperties)
      return propertySetRows(property.HasProperties).map(([key, value]) => [
        `${name} · ${key}`,
        value,
      ]);
    return [[name, "—"]];
  });
}
export function flattenProperties(data, prefix = "", depth = 0) {
  if (!data || depth > 4) return [];
  const rows = [];
  for (const [key, value] of Object.entries(data)) {
    if (
      [
        "expressID",
        "type",
        "OwnerHistory",
        "ObjectPlacement",
        "Representation",
      ].includes(key) ||
      value == null
    )
      continue;
    const label = prefix ? `${prefix} · ${key}` : key;
    if (typeof value !== "object") rows.push([label, String(value)]);
    else if (ifcValue(value) != null)
      rows.push([label, String(ifcValue(value))]);
    else if (Array.isArray(value))
      value.forEach((item, i) =>
        rows.push(...flattenProperties({ [i + 1]: item }, label, depth + 1)),
      );
    else rows.push(...flattenProperties(value, label, depth + 1));
  }
  return rows;
}
