import * as THREE from "three";
import { SnapResolver, snapNames } from "./snap-resolver.js";
import { MeasurementTool } from "./measurement-tool.js";
import { constrainMove } from "./measurement-geometry.js";
import { placeIfcModel } from "./model-placement.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { selectInRectangle } from "./rectangle-selection.js";
import { installRectangleSelection } from "./rectangle-input.js";
import { ViewCube } from "./view-cube.js";
import { ViewTransition, viewOrientation } from "./view-navigation.js";
import { SectionCaps } from "./section-caps.js";
import {
  configureNavigation,
  installInputNavigation,
  rotateAroundPoint,
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
    this.viewTransition = new ViewTransition();
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
    this.snapRevision = 0;
    this.snap = new SnapResolver(this);
    this.measureTool = new MeasurementTool(this);
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
      "3D-modell. Vänsterdra för rektangelmarkering. Shift lägger till i markeringen. Mitten- eller högerdra för att panorera. Håll Shift, Ctrl eller Cmd samtidigt för att rotera. Rulla för att zooma mot pekaren.",
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
    host.addEventListener(
      "pointerdown",
      () => this.viewTransition.cancel(),
      true,
    );
    host.addEventListener("wheel", () => this.viewTransition.cancel(), {
      capture: true,
      passive: true,
    });
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
    this.snapBadge = document.createElement("div");
    this.snapBadge.className = "snap-badge";
    this.snapBadge.hidden = true;
    this.host.append(this.snapBadge);
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
      ) {
        if (this.tool === "move") {
          this.setTool("select");
          this.callbacks.onPointMoveCancel?.();
        } else this.callbacks.onContextMenu?.(hit?.object, e);
      } else if (start.button === 0) {
        if (this.tool === "move") {
          this.addMovePoint(e, hit);
        } else if (this.tool === "measure") {
          this.measureTool.click(e, hit);
        } else
          this.callbacks.onSelect(
            hit?.object,
            e.shiftKey || e.metaKey || e.ctrlKey,
          );
      }
    });
    canvas.addEventListener("dblclick", (e) => {
      const hit = this.pick(e);
      if (hit && this.tool === "select") this.fit(hit.object.bounds);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5)
        down.moved = true;
      if (e.buttons) {
        this.hideSnap();
        this.measureTool.clearPreview();
        this.measureTool.dispose(this.measureTool.hoverOverlay);
        this.measureTool.hoverOverlay = null;
        this.measureTool.hoverId = null;
        return;
      }
      if (this.tool === "move") {
        this.previewMove(e);
        return;
      }
      if (this.tool === "measure") {
        this.lastToolEvent = { clientX: e.clientX, clientY: e.clientY };
        this.measureTool.hover(e, this.pick(e));
      } else this.hideSnap();
    });
    canvas.addEventListener("pointerleave", () => {
      this.hideSnap();
      this.measureTool.dispose(this.measureTool.hoverOverlay);
      this.measureTool.hoverOverlay = null;
      this.measureTool.hoverId = null;
      this.measureTool.clearPreview();
      this.invalidate();
    });
    let rectangleControlsEnabled;
    this.rectangleSelection = installRectangleSelection({
      host,
      canvas,
      enabled: () => this.tool === "select" && this.models.length > 0,
      onStart: () => {
        this.viewTransition.cancel();
        this.inputNavigation.cancel();
        rectangleControlsEnabled = this.controls.enabled;
        this.controls.enabled = false;
      },
      onFinish: () => {
        this.controls.enabled = rectangleControlsEnabled;
      },
      onClick: (event, additive) =>
        this.callbacks.onSelect(this.pick(event)?.object, additive),
      onRectangle: (start, end, additive) => {
        const objects = selectInRectangle(
          this.batches,
          this.camera,
          this.width,
          this.height,
          start,
          end,
          this.hidden,
          this.isolated,
          this.clippingPlanes,
        );
        this.callbacks.onSelectMany(objects, additive);
      },
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.callbacks.onError(
        "3D-grafiken avbröts. Ladda om sidan för att återställa viewern.",
      );
    });
    this.viewCube = new ViewCube(host, {
      select: (direction) => this.navigateView(direction),
      roll: (direction) => this.rollView(direction),
      home: () => this.navigateView([1, 0.7, -1]),
      dragStart: () => this.prepareViewNavigation(),
      drag: (dx, dy) => {
        rotateAroundPoint(
          this.camera,
          this.controls.target,
          this.controls.target.clone(),
          dx,
          dy,
          300,
        );
        this.invalidate();
      },
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.invalidate();
  }
  invalidate() {
    if (this.frame != null) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = null;
      if (this.viewTransition.active) {
        this.viewTransition.update(now);
        if (this.viewTransition.active) this.invalidate();
        else this.controls.update();
      } else if (!this.rectangleSelection?.active) {
        const orbiting = this.inputNavigation.update();
        if (this.controls.update() || orbiting) this.invalidate();
      }
      this.viewCube?.update(this.camera);
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
      if (this.snapMarker.visible && !this.snapBadge.hidden) {
        const point = this.snapMarker.position.clone().project(this.camera);
        this.snapBadge.style.left = `${(point.x * 0.5 + 0.5) * this.width + 14}px`;
        this.snapBadge.style.top = `${(-point.y * 0.5 + 0.5) * this.height + 10}px`;
      }
      this.measureTool.layoutLabels();
    });
  }
  resize() {
    this.rectangleSelection?.cancel();
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
    this.snapRevision++;
    model.batches = buildBatches(model);
    this.models.push(model);
    this.batches.push(...model.batches);
    model.batches.forEach((batch) => {
      this.scene.add(batch.mesh);
      updateBatchVisibility(batch, this.hidden, this.isolated);
    });
    if (
      !model.cadData &&
      model.placement &&
      Object.values(model.placement).some((v) => v !== 0)
    )
      placeIfcModel(model, model.placement);
    this.updateBounds();
    this.setSection(this.section);
    this.recolor();
  }
  setModelPlacement(model, placement) {
    this.snapRevision++;
    placeIfcModel(model, placement);
    this.clearMeasurements();
    this.updateBounds();
    this.setSection(this.section);
    this.setEdges(this.edgesEnabled);
    this.invalidate();
  }
  removeModel(model) {
    this.snapRevision++;
    if (this.pointMove?.model === model) {
      this.setTool("select");
      this.callbacks.onPointMoveCancel?.();
    }
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
    this.snapRevision++;
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
    this.viewTransition.cancel();
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
    this.viewTransition.cancel();
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
  prepareViewNavigation() {
    this.rectangleSelection.cancel();
    this.inputNavigation.cancel();
    this.viewTransition.cancel();
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damping;
  }
  navigateView(direction) {
    this.prepareViewNavigation();
    const { quaternion, up } = viewOrientation(direction);
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    this.viewTransition.start(
      this.camera,
      this.controls.target,
      quaternion,
      up,
      performance.now(),
      reduced ? 1 : 320,
    );
    this.invalidate();
  }
  rollView(direction) {
    this.prepareViewNavigation();
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(
      this.camera.quaternion,
    );
    const rotation = new THREE.Quaternion().setFromAxisAngle(
      axis,
      (direction * -Math.PI) / 2,
    );
    const quaternion = this.camera.quaternion.clone().premultiply(rotation);
    const up = this.camera.up.clone().applyQuaternion(rotation);
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    this.viewTransition.start(
      this.camera,
      this.controls.target,
      quaternion,
      up,
      performance.now(),
      reduced ? 1 : 320,
    );
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
    this.viewTransition.cancel();
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
    this.snapRevision++;
    const hadPendingMeasure = !!this.measureTool.first;
    this.measureTool.cancelPending();
    if (hadPendingMeasure) this.callbacks.onMeasureChange?.();
    this.hideSnap();
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
      if (
        enabled &&
        batch.mesh.visible &&
        !batch.mesh.material.map &&
        batch.primitiveSize !== 2
      ) {
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
    const viewHeight = this.camera.isOrthographicCamera
      ? (this.camera.top - this.camera.bottom) / this.camera.zoom
      : 2 *
        this.camera.position.distanceTo(this.controls.target) *
        Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.raycaster.params.Line.threshold = (viewHeight / this.height) * 4;
    const hits = this.raycaster.intersectObjects(
      this.batches
        .filter(
          (b) =>
            b.mesh.visible &&
            (!(this.tool === "measure" || this.tool === "move") ||
              !b.mesh.material.map),
        )
        .map((b) => b.mesh),
      false,
    );
    const hit = hits.find(
      (h) =>
        !this.clippingPlanes?.some((p) => p.distanceToPoint(h.point) < -1e-5),
    );
    const cap = this.sectionCaps.pick(this.raycaster, hit?.distance);
    if (cap) return cap;
    if (!hit) return null;
    hit.sourceBatch = hit.object.userData.batch;
    hit.sourceFace = hit.face;
    hit.object = pickedObject(
      hit.object.userData.batch,
      hit.faceIndex ?? hit.index / 2,
    );
    return hit.object ? hit : null;
  }
  snapPoint(hit) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const event = {
      clientX: rect.left + ((this.pointer.x + 1) * this.width) / 2,
      clientY: rect.top + ((1 - this.pointer.y) * this.height) / 2,
    };
    return (
      this.snap
        .resolve(event, hit, this.pointMove?.start || this.measureTool.anchor)
        ?.point.clone() || hit.point.clone()
    );
  }
  showSnap(snap) {
    this.snapMarker.visible = !!snap;
    this.snapBadge.hidden = !snap;
    if (snap) {
      this.snapMarker.position.copy(snap.point);
      const scale = this.camera.isPerspectiveCamera
        ? this.camera.position.distanceTo(snap.point) * 0.0035
        : this.orthoSpan * 0.003;
      this.snapMarker.scale.setScalar(Math.max(0.08, scale / 0.045));
      const symbols = {
        endpoint: "□",
        midpoint: "△",
        center: "⊕",
        perpendicular: "∟",
        edge: "×",
        surface: "○",
        ground: "○",
      };
      this.snapBadge.dataset.kind = snap.snap;
      this.snapBadge.textContent = `${symbols[snap.snap] || "○"} ${snapNames[snap.snap] || "Punkt"} · Tab`;
    }
    this.invalidate();
  }
  hideSnap() {
    this.snapMarker.visible = false;
    if (this.snapBadge) this.snapBadge.hidden = true;
  }
  cycleSnap() {
    this.snap.cycle(
      this.tool === "measure"
        ? this.measureTool.modes[this.measureTool.first ? 1 : 0]
        : "point",
    );
    if (this.tool === "measure" && this.lastToolEvent)
      this.measureTool.hover(this.lastToolEvent, this.pick(this.lastToolEvent));
    else if (this.tool === "move" && this.lastToolEvent)
      this.previewMove(this.lastToolEvent);
  }
  beginPointMove(model, onComplete, onStage) {
    this.setTool("move");
    this.pointMove = {
      model,
      onComplete,
      onStage,
      start: null,
      axis: "free",
      distance: null,
    };
    onStage();
  }
  movePoint(event, hit = this.pick(event)) {
    this.lastToolEvent = { clientX: event.clientX, clientY: event.clientY };
    const move = this.pointMove;
    const snap = this.snap.resolve(
      event,
      hit,
      move.start,
      move.start ? null : move.model.id,
    );
    let point = snap?.point.clone();
    if (!point && move.start && !hit)
      point = this.raycaster.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 1, 0), -move.start.y),
        new THREE.Vector3(),
      );
    if (!point) return null;
    const constrained = move.start
      ? constrainMove(move.start, point, move.axis, move.distance)
      : point;
    this.showSnap({
      ...snap,
      point: constrained,
      snap: snap?.snap || "ground",
    });
    return constrained;
  }
  addMovePoint(event, hit) {
    const move = this.pointMove;
    if (!move) return;
    const point = this.movePoint(event, hit);
    if (!point) {
      this.callbacks.onError(
        move.start
          ? "Välj en slutpunkt på modellen eller arbetsplanet."
          : `Välj startpunkten på ${move.model.name}.`,
      );
      return;
    }
    if (!move.start) {
      move.start = point.clone();
      const marker = new THREE.Mesh(
        this.snapMarker.geometry.clone(),
        this.snapMarker.material.clone(),
      );
      marker.position.copy(point);
      marker.scale.copy(this.snapMarker.scale);
      marker.renderOrder = 12;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([point, point]),
        new THREE.LineBasicMaterial({ color: 0x287c65, depthTest: false }),
      );
      line.renderOrder = 11;
      this.scene.add(marker, line);
      move.marker = marker;
      move.line = line;
      move.onStage();
      this.invalidate();
      return;
    }
    const delta = point.clone().sub(move.start);
    const complete = move.onComplete;
    this.setTool("select");
    complete(delta);
  }
  previewMove(event) {
    const point = this.movePoint(event);
    this.snapMarker.visible = !!point;
    if (!point) this.hideSnap();
    if (point) {
      this.snapMarker.position.copy(point);
      const scale = this.camera.isPerspectiveCamera
        ? this.camera.position.distanceTo(point) * 0.0035
        : this.orthoSpan * 0.003;
      this.snapMarker.scale.setScalar(Math.max(0.08, scale / 0.045));
      if (this.pointMove.line) {
        this.pointMove.line.geometry.attributes.position.setXYZ(
          1,
          point.x,
          point.y,
          point.z,
        );
        this.pointMove.line.geometry.attributes.position.needsUpdate = true;
        this.pointMove.line.geometry.computeBoundingSphere();
      }
    }
    if (this.pointMove.line) this.pointMove.line.visible = !!point;
    this.invalidate();
  }
  setTool(tool) {
    if (this.pointMove) {
      for (const object of [this.pointMove.marker, this.pointMove.line])
        if (object) {
          this.scene.remove(object);
          object.geometry.dispose();
          object.material.dispose();
        }
      this.pointMove = null;
    }
    this.viewTransition.cancel();
    this.rectangleSelection.cancel();
    this.tool = tool;
    this.measureStart = null;
    this.measureTool.cancelPending();
    this.snap.reset();
    this.hideSnap();
    this.renderer.domElement.style.cursor =
      tool === "measure" || tool === "move" ? "crosshair" : "default";
    this.invalidate();
  }
  addMeasurePoint(point) {
    this.measureTool.accept({ kind: "point", point });
  }
  clearMeasurements() {
    this.measureTool.clear();
  }
  cameraSnapshot() {
    return {
      position: this.camera.position.toArray(),
      up: this.camera.up.toArray(),
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
    this.viewTransition.cancel();
    this.inputNavigation.cancel();
    this.setProjection(snapshot.projection);
    this.camera.up.fromArray(snapshot.up || [0, 1, 0]);
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
