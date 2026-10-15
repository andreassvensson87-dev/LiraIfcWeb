// Runs the normal IFC file import in an isolated Chromium context. No models are uploaded.
import { writeFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const file = process.argv[2],
  output = process.argv[3] || "/tmp/lira-performance.json",
  runs = Number(process.argv[4] || 1);
if (!file)
  throw Error(
    "Usage: node tools/performance/benchmark.mjs model.ifc output.json [runs]",
  );
const results = [];
for (let run = 0; run < runs; run++) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--enable-precise-memory-info",
      "--enable-gpu",
      ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
      "--ignore-gpu-blocklist",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
        window.benchViewer = this;
        return original.apply(this, args);
      };
    });
    await page.locator('[data-action="fit"]').first().click();
    await page.waitForFunction(() => !!window.benchViewer);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    const emptyHeap = await cdp.send("Runtime.getHeapUsage");
    const start = Date.now();
    await page.locator("#file-input").setInputFiles(file);
    console.log(`Run ${run + 1}: loading ${statSync(file).size} bytes`);
    await page.waitForFunction(
      () =>
        document.querySelector("#loading")?.hidden &&
        window.benchViewer.models.length === 1 &&
        !window.benchViewer.models[0].demo,
      null,
      { timeout: 240000 },
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const loadMs = Date.now() - start;
    console.log(`Run ${run + 1}: loaded in ${loadMs} ms`);
    await cdp.send("HeapProfiler.collectGarbage");
    const loadedHeap = await cdp.send("Runtime.getHeapUsage");
    const system = await browser.newBrowserCDPSession();
    const processes = (await system.send("SystemInfo.getProcessInfo"))
      .processInfo;
    const rss = processes.map((p) => {
      try {
        return {
          type: p.type,
          rssBytes:
            Number(
              execFileSync("ps", ["-o", "rss=", "-p", String(p.id)], {
                encoding: "utf8",
              }).trim(),
            ) * 1024,
        };
      } catch {
        return { type: p.type, rssBytes: 0 };
      }
    });
    const metadata = await page.evaluate(() => {
      const v = benchViewer,
        gl = v.renderer.getContext(),
        ext = gl.getExtension("WEBGL_debug_renderer_info");
      const buffers = new Set();
      let bytes = 0,
        triangles = 0,
        vertices = 0;
      for (const b of v.batches) {
        triangles +=
          b.primitiveSize === 3 ? b.mesh.geometry.index.count / 3 : 0;
        vertices += b.mesh.geometry.attributes.position.count;
        for (const a of [
          ...Object.values(b.mesh.geometry.attributes),
          b.mesh.geometry.index,
          { array: b.originalIndices },
          { array: b.originalColors },
        ])
          if (!buffers.has(a.array.buffer)) {
            buffers.add(a.array.buffer);
            bytes += a.array.buffer.byteLength;
          }
      }
      return {
        objects: v.models[0].objects.length,
        triangles,
        vertices,
        batches: v.batches.length,
        geometryArrayBytes: bytes,
        accelerationArrayBytes: v.batches.reduce(
          (sum, b) =>
            sum +
            (b.mesh.geometry.boundsTree?._roots?.reduce(
              (s, r) => s + r.byteLength,
              0,
            ) || 0) +
            (b.mesh.geometry.boundsTree?._indirectBuffer?.byteLength || 0),
          0,
        ),
        gpu: ext
          ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
        userAgent: navigator.userAgent,
      };
    });
    const rotation = await page.evaluate(async () => {
      const v = benchViewer,
        gl = v.renderer.getContext(),
        invalidate = v.invalidate;
      v.invalidate = () => {};
      if (v.frame != null) {
        cancelAnimationFrame(v.frame);
        v.frame = null;
      }
      const samples = [],
        frames = [],
        started = performance.now();
      let last = started;
      for (let i = 0; i < 90; i++) {
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        frames.push(now - last);
        last = now;
        const start = performance.now(),
          p = v.camera.position.clone().sub(v.controls.target);
        const x = p.x,
          z = p.z;
        p.x = x * Math.cos(0.012) - z * Math.sin(0.012);
        p.z = x * Math.sin(0.012) + z * Math.cos(0.012);
        v.camera.position.copy(v.controls.target).add(p);
        v.camera.lookAt(v.controls.target);
        v.camera.updateMatrixWorld();
        v.viewCube.update(v.camera);
        v.renderer.setViewport(0, 0, v.width, v.height);
        v.renderer.render(v.scene, v.camera);
        gl.finish();
        samples.push(performance.now() - start);
      }
      v.invalidate = invalidate;
      v.controls.update();
      v.invalidate();
      const stats = (a) => {
        const s = [...a].sort((a, b) => a - b);
        return {
          median: s[Math.floor(s.length * 0.5)],
          p95: s[Math.floor(s.length * 0.95)],
          max: s.at(-1),
        };
      };
      return {
        renderMs: stats(samples),
        frameMs: stats(frames.slice(5)),
        fps: (90 * 1000) / (performance.now() - started),
      };
    });
    console.log(
      `Run ${run + 1}: ${metadata.objects} objects, ${metadata.triangles} triangles`,
    );
    console.log(
      `Run ${run + 1}: rotation ${rotation.fps.toFixed(1)} fps (${metadata.gpu})`,
    );
    const snap = await page.evaluate(async () => {
      const v = benchViewer,
        invalidate = v.invalidate;
      v.invalidate = () => {};
      v.setTool("measure");
      const rect = v.renderer.domElement.getBoundingClientRect();
      const positions = [];
      for (const y of [0.3, 0.45, 0.6, 0.75])
        for (const x of [0.3, 0.45, 0.6, 0.75])
          positions.push({
            clientX: rect.left + x * v.width,
            clientY: rect.top + y * v.height,
          });
      const stats = (a) => {
        if (!a.length) return null;
        const s = [...a].sort((a, b) => a - b);
        return {
          samples: s.length,
          median: s[Math.floor(s.length * 0.5)],
          p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))],
          max: s.at(-1),
        };
      };
      const passes = [];
      for (let pass = 0; pass < 2; pass++) {
        const pick = [],
          hover = [],
          resolve = [],
          visible = [];
        let hits = 0;
        const originalResolve = v.snap.resolve,
          originalVisible = v.snap.visible;
        v.snap.resolve = function (...args) {
          const t = performance.now();
          const r = originalResolve.apply(this, args);
          resolve.push(performance.now() - t);
          return r;
        };
        v.snap.visible = function (...args) {
          const t = performance.now();
          const r = originalVisible.apply(this, args);
          visible.push(performance.now() - t);
          return r;
        };
        for (const e of positions) {
          const t = performance.now();
          const hit = v.pick(e);
          pick.push(performance.now() - t);
          if (hit) hits++;
          const a = performance.now();
          v.measureTool.hover(e, hit);
          hover.push(performance.now() - a);
          await new Promise((r) => setTimeout(r, 0));
        }
        v.snap.resolve = originalResolve;
        v.snap.visible = originalVisible;
        passes.push({
          hits,
          pickMs: stats(pick),
          hoverMs: stats(hover),
          resolveMs: stats(resolve),
          visibilityRayMs: stats(visible),
          visibilityTotalMs: visible.reduce((a, b) => a + b, 0),
        });
      }
      v.setTool("select");
      v.invalidate = invalidate;
      v.invalidate();
      return passes;
    });
    console.log(
      `Run ${run + 1}: snap warm median ${snap[1].hoverMs.median.toFixed(1)} ms, p95 ${snap[1].hoverMs.p95.toFixed(1)} ms`,
    );
    await cdp.send("HeapProfiler.collectGarbage");
    const snapHeap = await cdp.send("Runtime.getHeapUsage");
    results.push({
      run: run + 1,
      fileBytes: statSync(file).size,
      loadMs,
      metadata,
      memory: {
        emptyHeap,
        loadedHeap,
        snapHeap,
        processRss: rss,
        processRssSumBytes: rss.reduce((s, p) => s + p.rssBytes, 0),
      },
      rotation,
      snap,
      errors,
    });
    writeFileSync(
      output,
      JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2),
    );
  } finally {
    await browser.close();
  }
}
console.log("Saved", output);
