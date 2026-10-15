import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
import { readFile, writeFile, mkdir } from "node:fs/promises";
const base = fileURLToPath(new URL("./results", import.meta.url));
await mkdir(base, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(
    process.env.PROBE_URL ||
      "http://127.0.0.1:5173/experiments/solid-mesh/index.html",
  );
  await page.waitForFunction(() => typeof window.runProbe === "function");
  const results = [];
  for (const version of [2000, 2018]) {
    const result = await page.evaluate(async (version) => {
      const r = await window.runProbe({ fixture: true, version });
      return { ...r, fixture: [...r.fixture] };
    }, version);
    const { raw, fixture, ...summary } = result;
    assert.equal(result.solids, 4);
    assert.equal(result.complete, 4);
    const expected = [
      64,
      Math.PI * 4 * 5,
      (4 / 3) * Math.PI * 8,
      2 * Math.PI ** 2 * 2 * 0.6 ** 2,
    ];
    for (const [i, solid] of raw.solids.entries()) {
      assert.ok(solid.positions.flat().every(Number.isFinite));
      assert.ok(solid.normals.flat().every(Number.isFinite));
      assert.ok(
        solid.indices.every(
          (k) => Number.isInteger(k) && k >= 0 && k < solid.positions.length,
        ),
      );
      let volume = 0;
      for (let j = 0; j < solid.indices.length; j += 3) {
        const [a, b, c] = solid.indices
          .slice(j, j + 3)
          .map((k) => solid.positions[k]);
        volume +=
          (a[0] * (b[1] * c[2] - b[2] * c[1]) +
            a[1] * (b[2] * c[0] - b[0] * c[2]) +
            a[2] * (b[0] * c[1] - b[1] * c[0])) /
          6;
      }
      assert.ok(
        Math.abs(volume - expected[i]) / expected[i] < 0.01,
        `solid ${i + 1} volume deviates over 1%`,
      );
    }
    results.push({ file: `generated-${version}.dwg`, ...summary });
    await writeFile(
      `${base}/generated-${version}.dwg`,
      new Uint8Array(fixture),
    );
    await writeFile(
      `${base}/generated-${version}-mesh.json`,
      JSON.stringify(raw),
    );
    await page.screenshot({ path: `${base}/generated-${version}.png` });
    console.log(JSON.stringify(results.at(-1)));
  }
  for (const filename of process.argv.slice(2)) {
    const bytes = [...(await readFile(filename))];
    try {
      const result = await page.evaluate(
        async (bytes) =>
          window.runProbe({ buffer: new Uint8Array(bytes).buffer }),
        bytes,
      );
      const { raw, ...summary } = result;
      results.push({ file: filename, ...summary });
      console.log(JSON.stringify(results.at(-1)));
      await writeFile(
        `${base}/${filename.split("/").at(-1)}-mesh.json`,
        JSON.stringify(raw),
      );
      await page.screenshot({
        path: `${base}/${filename.split("/").at(-1)}.png`,
      });
    } catch (e) {
      results.push({ file: filename, error: String(e) });
      console.log(String(e));
    }
  }
  await writeFile(
    `${base}/summary.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: browser conversion, complete fixtures, valid triangles, volume within 1%, no browser errors.",
  );
} finally {
  await browser.close();
}
