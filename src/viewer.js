import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SectionCaps } from "./section-caps.js";
import {
  configureNavigation,
  installInputNavigation,
} from "./input-navigation.js";
import {
  buildBatches,
  updateBatchVisibility,
  pickedObject,
  highlightBatch,
  disposeBatch,
} from "./batches.js";

export class Viewer {
  constructor(host, callbacks) {
    this.host = host;
    this.callbacks = callbacks;
    this.models = [];
    this.batches = [];
    this.hidden = new Set();
    this.isolated = null;
    this.selected = new Set();
    this.colorMode = "original";
    this.edgesEnabled = false;
    this.tool = "select";
    this.section = {
      mode: "none",
      axis: "y",
      position: 50,
      invert: false,
      box: [0, 100, 0, 100, 0, 100],
    };
    this.measurements = [];
    this.measureStart = null;
    this.frame = null;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#e9eef0");
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      stencil: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.localClippingEnabled = true;
    this.sectionCaps = new SectionCaps(this.scene);
    host.prepend(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "3D-modell. Mitten- eller högerdra för att panorera. Håll Shift, Ctrl eller Cmd samtidigt för att rotera. Rulla för att zooma mot pekaren.",
    );
    this.renderer.domElement.tabIndex = 0;
    this.perspective = new THREE.PerspectiveCamera(40, 1, 0.01, 10000);
    this.orthographic = new THREE.OrthographicCamera(
      -20,
      20,
      20,
      -20,
      0.01,
      10000,
    );
    this.camera = this.perspective;
    this.camera.position.set(-27, 20, -28);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    configureNavigation(this.controls);
    this.inputNavigation = installInputNavigation(
      host,
      this.renderer.domElement,
      () => this.controls,
      (event) => this.pick(event),
      () => this.invalidate(),
    );
    this.controls.target.set(0, 6, 0);
    this.controls.addEventListener("change", () => this.invalidate());
    this.scene.add(new THREE.HemisphereLight("#f4fafb", "#a6afac", 2.1));
    const sun = new THREE.DirectionalLight("#fff5e4", 2.8);
    sun.position.set(-20, 40, -30);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight("#d9eaf0", 1.4);
    fill.position.set(30, 15, 10);
    this.scene.add(fill);
    this.grid = new THREE.GridHelper(100, 100, "#bbc9cb", "#d4dfe0");
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.62;
    this.scene.add(this.grid);
    this.axisScene = new THREE.Scene();
    this.axisScene.add(new THREE.AxesHelper(1.4));
    this.axisCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.snapMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 10, 8),
      new THREE.MeshBasicMaterial({ color: "#287c65", depthTest: false }),
    );
    this.snapMarker.renderOrder = 10;
    this.snapMarker.visible = false;
    this.scene.add(this.snapMarker);
    let down;
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.addEventListener("pointerdown", (e) => {
      down = {
        x: e.clientX,
        y: e.clientY,
        button: e.button,
        id: e.pointerId,
        moved: false,
        modified: e.shiftKey || e.metaKey || e.ctrlKey || e.altKey,
      };
    });
    canvas.addEventListener("pointercancel", () => {
      down = null;
    });
    canvas.addEventListener("pointerup", (e) => {
      const start = down;
      down = null;
      if (
        !start ||
        start.id !== e.pointerId ||
        start.moved ||
        Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5
      )
        return;
      const hit = this.pick(e);
      if (
        start.button === 2 &&
        !start.modified &&
        !(e.shiftKey || e.metaKey || e.ctrlKey || e.altKey)
      )
        this.callbacks.onContextMenu?.(hit?.object, e);
      else if (start.button === 0) {
        if (this.tool === "measure") {
          if (hit) this.addMeasurePoint(this.snapPoint(hit));
        } else
          this.callbacks.onSelect(
            hit?.object,
            e.shiftKey || e.metaKey || e.ctrlKey,
          );
      }
    });
    canvas.addEventListener("dblclick", (e) => {
      const hit = this.pick(e);
      if (hit && this.tool !== "measure") this.fit(hit.object.bounds);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5)
        down.moved = true;
      if (e.buttons) return;
      const hit = this.pick(e);
      if (this.tool === "measure" && hit) {
        const point = this.snapPoint(hit);
        this.snapMarker.position.copy(point);
        this.snapMarker.visible = true;
        const scale = this.camera.isPerspectiveCamera
          ? this.camera.position.distanceTo(point) * 0.0035
          : this.orthoSpan * 0.003;
        this.snapMarker.scale.setScalar(Math.max(0.08, scale / 0.045));
        this.invalidate();
      } else if (this.snapMarker.visible) {
        this.snapMarker.visible = false;
        this.invalidate();
      }
      this.callbacks.onHover(hit?.object, e);
    });
    canvas.addEventListener("pointerleave", () => {
      this.snapMarker.visible = false;
      this.callbacks.onHover(null);
      this.invalidate();
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.callbacks.onError(
        "3D-grafiken avbröts. Ladda om sidan för att återställa viewern.",
      );
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.invalidate();
  }
  invalidate() {
    if (this.frame != null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const orbiting = this.inputNavigation.update();
      if (this.controls.update() || orbiting) this.invalidate();
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, this.width, this.height);
      this.renderer.render(this.scene, this.camera);
      if (this.grid.visible) {
        this.renderer.autoClear = false;
        this.renderer.clearDepth();
        this.renderer.setScissorTest(true);
        this.renderer.setScissor(16, 16, 64, 64);
        this.renderer.setViewport(16, 16, 64, 64);
        this.axisCamera.position
          .copy(this.camera.position)
          .sub(this.controls.target)
          .normalize()
          .multiplyScalar(5);
        this.axisCamera.up.copy(this.camera.up);
        this.axisCamera.lookAt(0, 0, 0);
        this.renderer.render(this.axisScene, this.axisCamera);
        this.renderer.autoClear = true;
        this.renderer.setScissorTest(false);
      }
      this.measurements.forEach((m) => {
        const p = m.midpoint.clone().project(this.camera);
        m.label.style.left = `${(p.x * 0.5 + 0.5) * this.width}px`;
        m.label.style.top = `${(-p.y * 0.5 + 0.5) * this.height}px`;
        m.label.hidden = p.z > 1 || p.z < -1;
      });
    });
  }
  resize() {
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(this.width, this.height);
    this.perspective.aspect = this.width / this.height;
    this.perspective.updateProjectionMatrix();
    this.updateOrtho();
    this.invalidate();
  }
  updateOrtho() {
    const span = this.orthoSpan || 30,
      aspect = this.width / this.height;
    this.orthographic.left = (-span * aspect) / 2;
    this.orthographic.right = (span * aspect) / 2;
    this.orthographic.top = span / 2;
    this.orthographic.bottom = -span / 2;
    this.orthographic.updateProjectionMatrix();
  }
  addModel(model) {
    model.batches = buildBatches(model);
    this.models.push(model);
    this.batches.push(...model.batches);
    model.batches.forEach((batch) => {
      this.scene.add(batch.mesh);
      updateBatchVisibility(batch, this.hidden, this.isolated);
    });
    this.updateBounds();
    this.setSection(this.section);
    this.recolor();
  }
  removeModel(model) {
    model.batches.forEach((batch) => {
      this.scene.remove(batch.mesh);
      if (batch.edges) this.scene.remove(batch.edges);
      disposeBatch(batch);
    });
    this.batches = this.batches.filter((b) => b.model !== model);
    this.models = this.models.filter((m) => m !== model);
    this.updateBounds();
    this.clearMeasurements();
    this.setSection(this.section);
    this.invalidate();
  }
  updateBounds() {
    this.bounds = new THREE.Box3();
    for (const model of this.models)
      for (const object of model.objects)
        if (model.visible) this.bounds.union(object.bounds);
    if (this.bounds.isEmpty())
      this.bounds.set(
        new THREE.Vector3(-10, 0, -10),
        new THREE.Vector3(10, 10, 10),
      );
    this.grid.position.y = this.bounds.min.y - 0.05;
    const size = this.bounds.getSize(new THREE.Vector3());
    const scale = Math.max(1, Math.ceil(Math.max(size.x, size.z) / 60));
    this.grid.scale.setScalar(scale);
    const center = this.bounds.getCenter(new THREE.Vector3());
    this.grid.position.x = center.x;
    this.grid.position.z = center.z;
  }
  updateVisibility(hidden, isolated) {
    this.hidden = hidden;
    this.isolated = isolated;
    this.batches.forEach((b) => updateBatchVisibility(b, hidden, isolated));
    this.updateBounds();
    this.setSection(this.section);
    if (this.edgesEnabled) this.setEdges(true);
    this.invalidate();
  }
  setSelected(keys) {
    this.selected = keys;
    this.recolor();
  }
  recolor() {
    this.batches.forEach((b) =>
      highlightBatch(b, this.selected, this.colorMode),
    );
    this.invalidate();
  }
  setColorMode(mode) {
    this.colorMode = mode;
    this.recolor();
  }
  fit(bounds = null) {
    this.inputNavigation.cancel();
    if (!bounds) {
      bounds = new THREE.Box3();
      this.batches.forEach((b) =>
        b.ranges.forEach((r) => {
          if (
            b.model.visible &&
            !this.hidden.has(r.object.key) &&
            (!this.isolated || this.isolated.has(r.object.key))
          )
            bounds.union(r.object.bounds);
        }),
      );
      if (bounds.isEmpty()) bounds = this.bounds;
    }
    if (!bounds || bounds.isEmpty()) return;
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const target = sphere.center,
      radius = Math.max(sphere.radius, 0.15);
    const halfFov = THREE.MathUtils.degToRad(this.perspective.fov / 2);
    const distance =
      (radius /
        Math.sin(
          Math.min(
            halfFov,
            Math.atan((Math.tan(halfFov) * this.width) / this.height),
          ),
        )) *
      1.12;
    let direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    if (!direction.length()) direction.set(-1, 0.65, -1).normalize();
    this.camera.position.copy(target).addScaledVector(direction, distance);
    this.controls.target.copy(target);
    this.perspective.near = Math.max(0.001, radius / 10000);
    this.perspective.far = Math.max(1000, distance + radius * 30);
    this.orthographic.near = 0.001;
    this.orthographic.far = this.perspective.far;
    this.orthoSpan = (radius * 2.3) / Math.min(1, this.width / this.height);
    this.orthographic.zoom = 1;
    this.updateOrtho();
    this.perspective.updateProjectionMatrix();
    this.controls.maxDistance = Math.max(distance * 10, 100);
    this.controls.minDistance = 0.01;
    this.controls.update();
    this.invalidate();
  }
  setProjection(mode) {
    this.inputNavigation.cancel();
    const previous = this.camera,
      next = mode === "orthographic" ? this.orthographic : this.perspective;
    if (previous === next) return;
    next.position.copy(previous.position);
    next.quaternion.copy(previous.quaternion);
    next.up.copy(previous.up);
    if (next.isOrthographicCamera) {
      this.orthoSpan =
        2 *
        previous.position.distanceTo(this.controls.target) *
        Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
      next.zoom = 1;
      this.updateOrtho();
    } else {
      const distance =
        this.orthoSpan /
        previous.zoom /
        (2 * Math.tan(THREE.MathUtils.degToRad(next.fov / 2)));
      next.position
        .copy(this.controls.target)
        .addScaledVector(
          previous.position.clone().sub(this.controls.target).normalize(),
          distance,
        );
    }
    this.camera = next;
    this.controls.object = next;
    this.controls.update();
    this.invalidate();
  }
  standardView(name) {
    const directions = {
      iso: [-1, 0.4, -1],
      front: [0, 0, -1],
      right: [1, 0, 0],
      left: [-1, 0, 0],
      top: [0, 1, 0.0001],
      back: [0, 0, 1],
    };
    const d = new THREE.Vector3(
      ...(directions[name] || directions.iso),
    ).normalize();
    this.camera.position
      .copy(this.controls.target)
      .addScaledVector(
        d,
        Math.max(1, this.camera.position.distanceTo(this.controls.target)),
      );
    this.camera.up.set(0, 1, 0);
    this.controls.update();
    this.fit();
  }
  zoom(factor) {
    if (this.camera.isOrthographicCamera) {
      this.camera.zoom *= factor;
      this.camera.updateProjectionMatrix();
    } else
      this.camera.position
        .sub(this.controls.target)
        .multiplyScalar(1 / factor)
        .add(this.controls.target);
    this.controls.update();
    this.invalidate();
  }
  setSection(section) {
    this.section = structuredClone(section);
    this.clippingPlanes = [];
    if (!this.bounds) return;
    if (section.mode === "plane") {
      const axis = ["x", "y", "z"].indexOf(section.axis);
      const min = this.bounds.min.getComponent(axis),
        max = this.bounds.max.getComponent(axis);
      const position = THREE.MathUtils.lerp(min, max, section.position / 100);
      const normal = new THREE.Vector3();
      normal.setComponent(axis, section.invert ? 1 : -1);
      this.clippingPlanes.push(
        new THREE.Plane(normal, section.invert ? -position : position),
      );
    } else if (section.mode === "box") {
      for (let axis = 0; axis < 3; axis++) {
        const min = this.bounds.min.getComponent(axis),
          max = this.bounds.max.getComponent(axis);
        const low = THREE.MathUtils.lerp(min, max, section.box[axis * 2] / 100);
        const high = THREE.MathUtils.lerp(
          min,
          max,
          section.box[axis * 2 + 1] / 100,
        );
        const n = new THREE.Vector3();
        n.setComponent(axis, 1);
        this.clippingPlanes.push(
          new THREE.Plane(n, -low),
          new THREE.Plane(n.clone().negate(), high),
        );
      }
    }
    this.batches.forEach((b) => {
      b.mesh.material.clippingPlanes = this.clippingPlanes;
      b.mesh.renderOrder = 100;
      if (b.edges) b.edges.material.clippingPlanes = this.clippingPlanes;
    });
    this.sectionCaps.update(this.clippingPlanes, this.bounds, this.batches);
    this.invalidate();
  }
  setEdges(enabled) {
    this.edgesEnabled = enabled;
    this.batches.forEach((batch) => {
      if (batch.edges) {
        this.scene.remove(batch.edges);
        batch.edges.geometry.dispose();
        batch.edges.material.dispose();
        batch.edges = null;
      }
      if (enabled && batch.mesh.visible) {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(batch.mesh.geometry, 35),
          new THREE.LineBasicMaterial({
            color: "#485c60",
            transparent: true,
            opacity: 0.22,
            clippingPlanes: this.clippingPlanes,
          }),
        );
        batch.edges = edges;
        this.scene.add(edges);
      }
    });
    this.invalidate();
  }
  pick(event) {
    const rect = this.host.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.batches.filter((b) => b.mesh.visible).map((b) => b.mesh),
      false,
    );
    const hit = hits.find(
      (h) =>
        !this.clippingPlanes?.some((p) => p.distanceToPoint(h.point) < -1e-5),
    );
    const cap = this.sectionCaps.pick(this.raycaster, hit?.distance);
    if (cap) return cap;
    if (!hit) return null;
    hit.object = pickedObject(hit.object.userData.batch, hit.faceIndex);
    return hit.object ? hit : null;
  }
  snapPoint(hit) {
    if (hit.sectionCap) return hit.point.clone();
    // Snap to a vertex on the hit triangle only if it lies within 12 screen pixels.
    const batch = this.batches.find((b) =>
      b.ranges.some((r) => r.object === hit.object),
    );
    // Multi-part objects can span batches; find the actual raycast triangle again.
    const hits = this.raycaster.intersectObjects(
      this.batches.filter((b) => b.mesh.visible).map((b) => b.mesh),
      false,
    );
    const actual = hits.find(
      (h) =>
        h.point.distanceTo(hit.point) < 1e-5 &&
        pickedObject(h.object.userData.batch, h.faceIndex) === hit.object,
    );
    if (!actual || !batch) return hit.point.clone();
    const geometry = actual.object.geometry;
    const point = new THREE.Vector3();
    let nearest = hit.point.clone(),
      distance = 12;
    for (const index of [actual.face.a, actual.face.b, actual.face.c]) {
      point.fromBufferAttribute(geometry.attributes.position, index);
      const screen = point.clone().project(this.camera);
      const pixels = Math.hypot(
        ((screen.x - this.pointer.x) * this.width) / 2,
        ((screen.y - this.pointer.y) * this.height) / 2,
      );
      if (pixels < distance) {
        nearest.copy(point);
        distance = pixels;
      }
    }
    return nearest;
  }
  setTool(tool) {
    this.tool = tool;
    this.measureStart = null;
    this.snapMarker.visible = false;
    this.renderer.domElement.style.cursor =
      tool === "measure" ? "crosshair" : "default";
    this.invalidate();
  }
  addMeasurePoint(point) {
    if (!this.measureStart) {
      this.measureStart = point;
      this.callbacks.onMeasureStart();
      return;
    }
    const start = this.measureStart;
    this.measureStart = null;
    const distance = start.distanceTo(point);
    if (distance < 1e-6) return;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([start, point]),
      new THREE.LineBasicMaterial({ color: "#287c65", depthTest: false }),
    );
    line.renderOrder = 11;
    this.scene.add(line);
    const label = document.createElement("div");
    label.className = "measure-label";
    label.textContent = `${distance.toLocaleString("sv", { maximumFractionDigits: 3 })} m`;
    this.host.append(label);
    this.measurements.push({
      start,
      end: point,
      midpoint: start.clone().lerp(point, 0.5),
      distance,
      line,
      label,
    });
    this.callbacks.onMeasure(distance, point.clone().sub(start));
    this.invalidate();
  }
  clearMeasurements() {
    this.measureStart = null;
    this.measurements.forEach((m) => {
      this.scene.remove(m.line);
      m.line.geometry.dispose();
      m.line.material.dispose();
      m.label.remove();
    });
    this.measurements = [];
    this.invalidate();
  }
  cameraSnapshot() {
    return {
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      projection: this.camera.isOrthographicCamera
        ? "orthographic"
        : "perspective",
      zoom: this.camera.zoom,
      span: this.orthoSpan || 30,
      near: this.camera.near,
      far: this.camera.far,
    };
  }
  restoreCamera(snapshot) {
    this.inputNavigation.cancel();
    this.setProjection(snapshot.projection);
    this.camera.position.fromArray(snapshot.position);
    this.controls.target.fromArray(snapshot.target);
    this.orthoSpan = snapshot.span;
    this.camera.zoom = snapshot.zoom;
    this.camera.near = snapshot.near;
    this.camera.far = snapshot.far;
    this.updateOrtho();
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.invalidate();
  }
  screenshot() {
    // Use the full viewport; the normal render ends in the small axes inset.
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }
}
