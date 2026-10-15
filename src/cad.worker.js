import { readCadDrawing } from "./cad-data.js";
import wasmUrl from "../node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm?url";
self.onmessage = async ({ data }) => {
  try {
    let bytes = data.buffer;
    if (data.format === "DWG") {
      self.postMessage({ type: "progress", label: "Läser DWG…" });
      const { LibreDwg, createModule } = await import(
        "@mlightcad/libredwg-web"
      );
      const wasm = await createModule({ locateFile: () => wasmUrl });
      bytes = LibreDwg.createByWasmInstance(wasm).dwg_write_dxf(bytes);
      if (!bytes)
        throw Error(
          "DWG-filen kunde inte läsas. Prova att exportera den som ASCII-DXF.",
        );
    }
    const head = new TextDecoder().decode(
      bytes instanceof ArrayBuffer
        ? bytes.slice(0, 8192)
        : bytes.subarray(0, 8192),
    );
    const encoding =
      /ANSI_1252/.test(head) && !/(AC1021|AC1024|AC1027|AC1032)/.test(head)
        ? "windows-1252"
        : "utf-8";
    const source = new TextDecoder(encoding).decode(bytes);
    let solids = [],
      conversionWarning;
    if (
      data.format === "DWG" &&
      /(?:^|\r?\n)\s*3DSOLID\s*(?:\r?\n)/.test(source)
    ) {
      self.postMessage({
        type: "progress",
        label: "Omvandlar DWG-solider till mesh…",
      });
      try {
        const engine = await import("./solid-mesh/lira_solid_mesh_probe.js");
        await engine.default();
        const result = JSON.parse(engine.convert(new Uint8Array(data.buffer)));
        if (result.error) throw Error(result.error);
        solids = result.solids;
      } catch (error) {
        conversionWarning = `3DSOLID: konverteringen misslyckades (${error.message || error})`;
      }
    }
    let drawing;
    try {
      drawing = readCadDrawing(source, { solids });
    } catch (error) {
      throw Error(conversionWarning || error.message);
    }
    if (conversionWarning) drawing.skipped.push(conversionWarning);
    self.postMessage({ type: "done", ...drawing });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error.message || "Ritningsreferensen kunde inte läsas.",
    });
  }
};
