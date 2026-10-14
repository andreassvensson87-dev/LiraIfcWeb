import { IfcAPI } from "web-ifc";
import wasmURL from "web-ifc/web-ifc.wasm?url";
import { Matrix4, Matrix3, Vector3 } from "three";
import { readIfcGroups } from "./ifc-groups.js";

let api, model;
const value = (v, fallback = "") => v?.value ?? fallback;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "properties") {
      // Read type definitions separately: some exporters omit HasPropertySets on
      // their type objects and web-ifc's automatic type-set traversal then throws.
      const results = await Promise.allSettled([
        api.properties.getPropertySets(model, data.id, true, false),
        api.properties.getMaterialsProperties(model, data.id, true, false),
        api.properties.getTypeProperties(model, data.id, true),
      ]);
      const [sets, materials, types] = results.map((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
      const warnings = results.flatMap((result, index) =>
        result.status === "rejected"
          ? [
              `${["Property sets", "Material", "Typdefinition"][index]} kunde inte läsas.`,
            ]
          : [],
      );
      self.postMessage({
        type: "properties",
        id: data.id,
        request: data.request,
        line: api.GetLine(model, data.id),
        sets,
        materials,
        types,
        warnings,
      });
      return;
    }
    api = new IfcAPI();
    await api.Init(() => new URL(wasmURL, self.location.href).href, true);
    model = api.OpenModel(new Uint8Array(data.buffer), {
      COORDINATE_TO_ORIGIN: false,
      CIRCLE_SEGMENTS: 24,
    });
    if (model < 0) throw new Error("Filen kunde inte läsas som IFC.");
    let origin = data.origin;
    let parts = [],
      transfers = [],
      count = 0;
    const objects = [];
    const flush = () => {
      if (parts.length)
        self.postMessage({ type: "geometry", parts }, transfers);
      parts = [];
      transfers = [];
    };
    self.postMessage({
      type: "progress",
      label: "Läser IFC och bygger geometri…",
    });
    api.StreamAllMeshes(model, (mesh) => {
      const line = api.GetLine(model, mesh.expressID);
      const object = {
        expressId: mesh.expressID,
        name: value(line?.Name, `Objekt ${mesh.expressID}`),
        globalId: value(line?.GlobalId),
        ifcClass: api.GetNameFromTypeCode(line?.type) || "IfcElement",
      };
      let hasGeometry = false;
      for (let i = 0; i < mesh.geometries.size(); i++) {
        const part = mesh.geometries.get(i);
        const raw = api.GetGeometry(model, part.geometryExpressID);
        try {
          const input = api.GetVertexArray(
            raw.GetVertexData(),
            raw.GetVertexDataSize(),
          );
          const indices = api
            .GetIndexArray(raw.GetIndexData(), raw.GetIndexDataSize())
            .slice();
          if (!input.length || !indices.length) continue;
          const transform = new Matrix4().fromArray(part.flatTransformation);
          if (!origin) {
            origin = transform.elements.slice(12, 15);
            self.postMessage({ type: "origin", origin });
          }
          // Subtract the shared origin in double precision before writing float GPU coordinates.
          transform.elements[12] -= origin[0];
          transform.elements[13] -= origin[1];
          transform.elements[14] -= origin[2];
          const normalMatrix = new Matrix3().getNormalMatrix(transform);
          const positions = new Float32Array(input.length / 2),
            normals = new Float32Array(input.length / 2);
          const p = new Vector3(),
            n = new Vector3();
          for (let v = 0; v < input.length / 6; v++) {
            p.fromArray(input, v * 6)
              .applyMatrix4(transform)
              .toArray(positions, v * 3);
            n.fromArray(input, v * 6 + 3)
              .applyMatrix3(normalMatrix)
              .normalize()
              .toArray(normals, v * 3);
          }
          // Reflecting transforms reverse triangle winding.
          if (transform.determinant() < 0)
            for (let t = 0; t < indices.length; t += 3)
              [indices[t + 1], indices[t + 2]] = [
                indices[t + 2],
                indices[t + 1],
              ];
          parts.push({
            id: mesh.expressID,
            positions,
            normals,
            indices,
            color: [part.color.x, part.color.y, part.color.z],
            opacity: part.color.w,
          });
          transfers.push(positions.buffer, normals.buffer, indices.buffer);
          hasGeometry = true;
          count++;
        } finally {
          raw.delete();
        }
      }
      if (hasGeometry) objects.push(object);
      if (parts.length >= 40) {
        flush();
        self.postMessage({
          type: "progress",
          label: `${objects.length.toLocaleString("sv")} objekt bearbetade`,
        });
      }
    });
    flush();
    if (!count)
      throw new Error("IFC-filen innehåller ingen visningsbar geometri.");
    let spatial = null;
    try {
      spatial = await api.properties.getSpatialStructure(model, true);
    } catch {
      /* Standalone IFC products may lack spatial relations. */
    }
    let grouping = { groups: [], warning: "" };
    try {
      grouping = readIfcGroups(
        api,
        model,
        objects.map((object) => object.expressId),
      );
    } catch {
      grouping.warning =
        "System- och zonrelationer kunde inte läsas i denna fil.";
    }
    self.postMessage({
      type: "done",
      objects,
      spatial,
      groups: grouping.groups,
      groupWarning: grouping.warning,
      origin,
      schema: api.GetModelSchema(model),
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      id: data.id,
      request: data.request,
      message: error.message || "IFC-importen misslyckades.",
    });
    if (data.type !== "properties" && model >= 0) api.CloseModel(model);
  }
};
