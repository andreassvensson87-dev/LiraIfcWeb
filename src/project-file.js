import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

export const projectExtension = ".liraifc";
const format = "LiraIFC-project";
const maxBytes = 2 * 1024 ** 3;
const vector = (v) =>
  Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const fail = (message = "Projektfilen är skadad eller har fel format.") => {
  throw Error(message);
};
const strings = (v) =>
  Array.isArray(v) && v.every((s) => typeof s === "string");
const digest = async (bytes) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");

function validateView(view, ids) {
  if (
    !view ||
    !strings(view.modelIds) ||
    !view.modelIds.every((id) => ids.has(id)) ||
    !view.visibility ||
    view.modelIds.some((id) => typeof view.visibility[id] !== "boolean") ||
    !strings(view.hidden) ||
    !(view.isolated === null || strings(view.isolated))
  )
    fail();
  const c = view.camera,
    s = view.section;
  if (
    !c ||
    !vector(c.position) ||
    !vector(c.target) ||
    !vector(c.up) ||
    !["perspective", "orthographic"].includes(c.projection) ||
    ![c.zoom, c.span, c.near, c.far].every(
      (n) => Number.isFinite(n) && n > 0,
    ) ||
    c.far <= c.near
  )
    fail();
  if (
    !s ||
    !["none", "plane", "box"].includes(s.mode) ||
    !["x", "y", "z"].includes(s.axis) ||
    !Number.isFinite(s.position) ||
    typeof s.invert !== "boolean" ||
    !Array.isArray(s.box) ||
    s.box.length !== 6 ||
    !s.box.every((n) => Number.isFinite(n) && n >= 0 && n <= 100)
  )
    fail();
}
function validateManifest(m) {
  if (m?.format !== format || m.version !== 1)
    fail("Projektfilens format eller version stöds inte.");
  if (
    typeof m.name !== "string" ||
    (!vector(m.origin) && m.origin !== null) ||
    !["ifc", "systems", "zones", "types"].includes(m.grouping) ||
    !Array.isArray(m.references) ||
    m.references.length > 1000
  )
    fail();
  const ids = new Set(),
    paths = new Set();
  for (const r of m.references) {
    if (
      !r ||
      typeof r.id !== "string" ||
      !/^[\w-]{1,100}$/.test(r.id) ||
      ids.has(r.id) ||
      typeof r.name !== "string" ||
      !/\.(ifc|dwg|dxf)$/i.test(r.name) ||
      r.name.length > 1024 ||
      typeof r.path !== "string" ||
      !/^references\/\d+\.(ifc|dwg|dxf)$/.test(r.path) ||
      paths.has(r.path) ||
      !Number.isSafeInteger(r.size) ||
      r.size < 1 ||
      r.size > maxBytes ||
      !/^[a-f0-9]{64}$/.test(r.sha256)
    )
      fail();
    if (/\.(dwg|dxf)$/i.test(r.name) && r.size > 50 * 1024 ** 2)
      fail("CAD-filen i projektet överstiger 50 MB.");
    const p = r.placement;
    if (
      !p ||
      ![p.x, p.z, p.elevation, p.rotation].every(
        (n) => Number.isFinite(n) && Math.abs(n) <= 1e9,
      ) ||
      (/\.(dwg|dxf)$/i.test(r.name) &&
        !(
          Number.isFinite(p.unitFactor) &&
          p.unitFactor > 0 &&
          p.unitFactor <= 1e9
        ))
    )
      fail();
    ids.add(r.id);
    paths.add(r.path);
  }
  if (m.view !== null) validateView(m.view, ids);
  if (!Array.isArray(m.views) || m.views.length > 1000) fail();
  for (const v of m.views) {
    if (
      typeof v.id !== "string" ||
      typeof v.name !== "string" ||
      !Number.isFinite(v.date) ||
      (v.image != null &&
        (typeof v.image !== "string" ||
          !/^data:image\/(png|jpeg);base64,/.test(v.image)))
    )
      fail();
    validateView(v, ids);
  }
  if (
    m.display &&
    (!["original", "discipline", "type"].includes(m.display.colorMode) ||
      typeof m.display.edges !== "boolean" ||
      typeof m.display.grid !== "boolean")
  )
    fail();
  return m;
}

// Called in a dedicated worker so compression never stalls model navigation.
export async function encodeProject({
  name,
  origin,
  grouping,
  view,
  views,
  display,
  files,
}) {
  const entries = Object.create(null),
    references = [];
  let total = 0;
  for (const [i, file] of files.entries()) {
    const bytes = new Uint8Array(file.buffer);
    total += bytes.byteLength;
    if (total > maxBytes)
      fail("Projektet är för stort för att sparas i en projektfil (max 2 GB).");
    const path = `references/${i}.${file.name.split(".").at(-1).toLowerCase()}`;
    references.push({
      id: file.id,
      name: file.name,
      path,
      size: bytes.byteLength,
      sha256: await digest(bytes),
      placement: file.placement,
    });
    entries[path] = [bytes, { level: /\.ifc$/i.test(file.name) ? 1 : 0 }];
  }
  const manifest = validateManifest({
    format,
    version: 1,
    name,
    origin,
    grouping,
    references,
    view,
    views,
    display,
  });
  entries["project.json"] = strToU8(JSON.stringify(manifest));
  return zipSync(entries, { level: 1 });
}

export async function decodeProject(buffer) {
  if (buffer.byteLength > maxBytes)
    fail("Projektfilen är för stor (max 2 GB).");
  let total = 0,
    count = 0;
  const entries = unzipSync(new Uint8Array(buffer), {
    filter: (file) => {
      total += file.originalSize;
      if (
        ++count > 1002 ||
        total > maxBytes ||
        (file.name === "project.json" && file.originalSize > 32 * 1024 ** 2)
      )
        fail("Projektfilen innehåller för mycket data.");
      return true;
    },
  });
  if (!entries["project.json"]) fail();
  const manifest = validateManifest(
    JSON.parse(strFromU8(entries["project.json"])),
  );
  const files = [];
  for (const r of manifest.references) {
    const bytes = entries[r.path];
    if (
      !bytes ||
      bytes.byteLength !== r.size ||
      (await digest(bytes)) !== r.sha256
    )
      fail(`Referensen ${r.name} saknas eller är skadad.`);
    files.push({
      id: r.id,
      name: r.name,
      size: r.size,
      buffer: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ),
      placement: r.placement,
      unitConfirmed: true,
    });
  }
  return { ...manifest, files };
}
