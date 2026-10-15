import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
const status = document.querySelector("#status"),
  report = document.querySelector("#report");
const scene = new THREE.Scene();
scene.background = new THREE.Color("#e5edef");
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 10000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.querySelector("#view").append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x587275, 2.5));
const light = new THREE.DirectionalLight(0xffffff, 3);
light.position.set(8, 20, 10);
scene.add(light);
const group = new THREE.Group();
scene.add(group);
function resize() {
  renderer.setSize(innerWidth, Math.max(200, innerHeight - 260));
  camera.aspect = renderer.domElement.width / renderer.domElement.height;
  camera.updateProjectionMatrix();
}
resize();
addEventListener("resize", resize);
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
window.runProbe = (data) =>
  new Promise((resolve, reject) => {
    status.textContent = "Konverterar DWG-solider lokalt i WebAssembly…";
    const worker = new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(Error("Konverteringen tog över 60 sekunder."));
    }, 60000);
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      reject(Error(e.message));
    };
    worker.onmessage = ({ data }) => {
      clearTimeout(timer);
      worker.terminate();
      if (data.error || data.result?.error) {
        reject(Error(data.error || data.result.error));
        return;
      }
      while (group.children.length) {
        const old = group.children[0];
        old.geometry.dispose();
        old.material.dispose();
        group.remove(old);
      }
      const solids = data.result.solids,
        summaries = [];
      solids.forEach((solid, i) => {
        summaries.push({
          solid: i + 1,
          complete: solid.complete,
          triangles: solid.indices?.length / 3 || 0,
          missingFaces: solid.missingFaces,
          lostSurfaces: solid.lostSurfaces,
          lostCurves: solid.lostCurves,
          broken: solid.broken,
          error: solid.error,
        });
        if (!solid.indices?.length) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(
            solid.positions.flatMap(([x, y, z]) => [x, z, -y]),
            3,
          ),
        );
        geometry.setAttribute(
          "normal",
          new THREE.Float32BufferAttribute(
            solid.normals.flatMap(([x, y, z]) => [x, z, -y]),
            3,
          ),
        );
        geometry.setIndex(solid.indices);
        group.add(
          new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({
              color: solid.complete
                ? ["#2d9381", "#689bab", "#bf9e69", "#9387b6"][i % 4]
                : "#d97030",
              side: THREE.DoubleSide,
              roughness: 0.5,
            }),
          ),
        );
      });
      if (group.children.length) {
        const box = new THREE.Box3().setFromObject(group),
          center = box.getCenter(new THREE.Vector3()),
          size = box.getSize(new THREE.Vector3()).length();
        controls.target.copy(center);
        camera.position
          .copy(center)
          .add(new THREE.Vector3(0.6, 0.65, 1).multiplyScalar(size));
        camera.far = Math.max(1000, size * 20);
        camera.updateProjectionMatrix();
        controls.update();
      }
      const summary = {
        entities: data.result.entities,
        solids: solids.length,
        complete: solids.filter((s) => s.complete).length,
        triangles: solids.reduce((n, s) => n + (s.indices?.length || 0) / 3, 0),
        milliseconds: Math.round(data.milliseconds),
        bytes: data.bytes,
        details: summaries,
      };
      window.probeResult = summary;
      status.textContent = `${summary.solids} solider · ${summary.complete} fullständiga · ${summary.triangles} trianglar · ${summary.milliseconds} ms`;
      report.textContent = JSON.stringify(summary, null, 2);
      resolve({ ...summary, raw: data.result, fixture: data.fixture });
    };
    worker.postMessage(data);
  }).catch((e) => {
    status.textContent = String(e);
    throw e;
  });
document.querySelector("#fixture").onclick = () =>
  window.runProbe({ fixture: true });
document.querySelector("#file").onchange = async (e) => {
  const f = e.target.files[0];
  if (f) await window.runProbe({ buffer: await f.arrayBuffer() });
};
