import init, { convert, fixture } from "./pkg/lira_solid_mesh_probe.js";
const ready = init();
self.onmessage = async ({ data }) => {
  try {
    await ready;
    const bytes = data.fixture
      ? fixture(data.version || 2018)
      : new Uint8Array(data.buffer);
    const start = performance.now();
    const result = JSON.parse(convert(bytes));
    self.postMessage({
      result,
      milliseconds: performance.now() - start,
      bytes: bytes.length,
      fixture: data.fixture ? bytes : undefined,
    });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
