// Real app import/removal and GPU-rendered rotation. Models stay on this device.
import { writeFileSync } from "node:fs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const [file, output = "/tmp/lira-stress.json", cycleArg = "5"] =
  process.argv.slice(2);
if (!file)
  throw Error(
    "Usage: node tools/performance/stress.mjs file.ifc result.json [cycles]",
  );
const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-gpu",
    ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
    "--ignore-gpu-blocklist",
    "--enable-precise-memory-info",
  ],
});
const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const result = {
  timestamp: new Date().toISOString(),
  cycles: [],
  rendering: [],
  errors,
};
const save = () => writeFileSync(output, JSON.stringify(result, null, 2));
try {
  await page.goto(process.env.LIRA_BENCH_URL || "http://127.0.0.1:5173/");
  await page.waitForFunction(
    () =>
      document.querySelector("#loading")?.hidden &&
      document.querySelector(".model-root"),
    null,
    { timeout: 90000 },
  );
  await page.evaluate(async () => {
    const u = performance
      .getEntriesByType("resource")
      .find((e) => e.name.includes("/src/viewer.js")).name;
    const { Viewer } = await import(u);
    const original = Viewer.prototype.invalidate;
    Viewer.prototype.invalidate = function (...args) {
      window.stressViewer = this;
      return original.apply(this, args);
    };
  });
  await page.locator('[data-action="fit"]').first().click();
  await page.waitForFunction(() => !!window.stressViewer);
  const cdp = await page.context().newCDPSession(page);
  const memory = async () => {
    await page.waitForTimeout(250);
    await cdp.send("HeapProfiler.collectGarbage");
    return {
      ...(await cdp.send("Runtime.getHeapUsage")),
      workers: page.workers().length,
      ...(await page.evaluate(() => ({
        gpuGeometryCount: stressViewer.renderer.info.memory.geometries,
        gpuTextureCount: stressViewer.renderer.info.memory.textures,
        snapRectCount: stressViewer.snap.rects?.length || 0,
        models: stressViewer.models.length,
        sceneChildren: stressViewer.scene.children.length,
      }))),
    };
  };
  for (let cycle = 0; cycle < Number(cycleArg); cycle++) {
    const started = Date.now();
    await page.locator("#file-input").setInputFiles(file);
    await page.waitForFunction(
      () =>
        document.querySelector("#loading")?.hidden &&
        stressViewer.models.length === 1 &&
        !stressViewer.models[0].demo,
      null,
      { timeout: 180000 },
    );
    const loadedMs = Date.now() - started;
    console.log(`Cycle ${cycle + 1}: loaded in ${loadedMs} ms`);
    // Exercise topology cache and renderer-held references before removing.
    await page.evaluate(() => {
      const v = stressViewer,
        rect = v.renderer.domElement.getBoundingClientRect();
      v.setTool("measure");
      const e = {
        clientX: rect.x + v.width * 0.45,
        clientY: rect.y + v.height * 0.45,
      };
      v.measureTool.hover(e, v.pick(e));
      v.setTool("select");
    });
    if (cycle === 0) {
      result.loadedMemory = await memory();
      for (const setup of [
        { name: "normal", mode: "none", edges: false },
        { name: "edges", mode: "none", edges: true },
        {
          name: "box-full",
          mode: "box",
          box: [0, 100, 0, 100, 0, 100],
          edges: true,
        },
        {
          name: "box-cut",
          mode: "box",
          box: [20, 80, 20, 80, 20, 80],
          edges: true,
        },
        {
          name: "box-cut-no-edges",
          mode: "box",
          box: [20, 80, 20, 80, 20, 80],
          edges: false,
        },
      ]) {
        const r = await page.evaluate(async (s) => {
          const v = stressViewer,
            wasInvalidate = v.invalidate;
          v.invalidate = () => {};
          if (v.frame != null) {
            cancelAnimationFrame(v.frame);
            v.frame = null;
          }
          const started = performance.now();
          v.setEdges(s.edges);
          v.setSection({
            ...v.section,
            mode: s.mode,
            box: s.box || v.section.box,
          });
          const setupMs = performance.now() - started;
          const frames = [],
            calls = [],
            tris = [];
          let previous = performance.now(),
            begin = previous;
          for (let i = 0; i < 60; i++) {
            await new Promise(requestAnimationFrame);
            const t = performance.now();
            frames.push(t - previous);
            previous = t;
            const p = v.camera.position.clone().sub(v.controls.target),
              x = p.x,
              z = p.z;
            p.x = x * Math.cos(0.01) - z * Math.sin(0.01);
            p.z = x * Math.sin(0.01) + z * Math.cos(0.01);
            v.camera.position.copy(v.controls.target).add(p);
            v.camera.lookAt(v.controls.target);
            v.camera.updateMatrixWorld();
            v.renderer.setViewport(0, 0, v.width, v.height);
            v.renderer.render(v.scene, v.camera);
            calls.push(v.renderer.info.render.calls);
            tris.push(v.renderer.info.render.triangles);
          }
          const elapsed = performance.now() - begin;
          v.invalidate = wasInvalidate;
          v.controls.update();
          v.invalidate();
          const sorted = frames.slice(5).sort((a, b) => a - b);
          return {
            name: s.name,
            setupMs,
            fps: 60000 / elapsed,
            frameP95Ms: sorted[Math.floor(sorted.length * 0.95)],
            drawCalls: calls.at(-1),
            trianglesPerFrame: tris.at(-1),
            geometries: v.renderer.info.memory.geometries,
          };
        }, setup);
        result.rendering.push(r);
        save();
        console.log(
          `${r.name}: ${r.fps.toFixed(1)} fps, setup ${r.setupMs.toFixed(0)} ms, ${r.drawCalls} calls, ${r.trianglesPerFrame} triangles/frame`,
        );
      }
      result.repeatedEdgesMs = await page.evaluate(() => {
        const v = stressViewer;
        v.setSection({ ...v.section, mode: "none" });
        v.setEdges(true);
        const t = performance.now();
        v.setEdges(true);
        return performance.now() - t;
      });
    }
    const removed = Date.now();
    await page.locator('[data-action="remove-model"]').click();
    await page.waitForFunction(() => stressViewer.models.length === 0);
    const unloaded = await memory();
    result.cycles.push({
      cycle: cycle + 1,
      loadMs: loadedMs,
      removeMs: Date.now() - removed,
      unloaded,
    });
    save();
    console.log(
      `Cycle ${cycle + 1}: removed; arrays ${(unloaded.backingStorageSize / 1e6).toFixed(1)} MB, heap ${(unloaded.usedSize / 1e6).toFixed(1)} MB, GPU geometry ${unloaded.gpuGeometryCount}, workers ${unloaded.workers}, stale snap boxes ${unloaded.snapRectCount}`,
    );
  }
  save();
  console.log("Saved", output);
} finally {
  await browser.close();
}
