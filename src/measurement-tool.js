import * as THREE from "three";
import { closestFeatures } from "./measurement-geometry.js";
export const geometryNames = {
  point: "Punkt",
  line: "Linje",
  face: "Plan yta",
};
export class MeasurementTool {
  constructor(viewer) {
    this.v = viewer;
    this.modes = ["point", "point"];
    this.unit = "m";
    this.decimals = 3;
    this.nextId = 1;
  }
  format(n) {
    const scale = { m: 1, cm: 100, mm: 1000 }[this.unit];
    return `${(n * scale).toLocaleString("sv", { minimumFractionDigits: this.decimals, maximumFractionDigits: this.decimals })} ${this.unit}`;
  }
  get anchor() {
    return this.first?.point || this.first?.pickPoint || null;
  }
  dispose(object) {
    if (!object) return;
    this.v.scene.remove(object);
    object.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) o.material.dispose();
    });
  }
  overlay(feature, color) {
    const group = new THREE.Group();
    if (feature.kind === "face") {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          feature.triangles.flatMap((t) => t.flatMap((p) => p.toArray())),
          3,
        ),
      );
      group.add(
        new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.23,
            side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
          }),
        ),
      );
    } else if (feature.kind === "line") {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([feature.a, feature.b]),
        new THREE.LineBasicMaterial({ color, depthTest: false }),
      );
      line.renderOrder = 12;
      group.add(line);
    } else {
      const radius = this.v.camera.isPerspectiveCamera
        ? this.v.camera.position.distanceTo(feature.point) * 0.004
        : ((this.v.camera.top - this.v.camera.bottom) / this.v.camera.zoom) *
          0.004;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(0.00001, radius), 10, 8),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      marker.position.copy(feature.point);
      marker.renderOrder = 12;
      group.add(marker);
    }
    this.v.scene.add(group);
    return group;
  }
  candidate(event, hit) {
    this.v.snap.resolve(event, hit, this.anchor);
    return this.v.snap.feature(this.modes[this.first ? 1 : 0]);
  }
  hover(event, hit) {
    const feature = this.candidate(event, hit);
    this.hovered = feature;
    this.v.showSnap(
      feature && feature.kind !== "point"
        ? {
            point: feature.pickPoint || hit?.point,
            snap: feature.kind === "line" ? "edge" : "surface",
          }
        : feature
          ? this.v.snap.chosen
          : null,
    );
    if (feature?.kind !== "point" && feature?.id === this.hoverId) {
    } else {
      this.dispose(this.hoverOverlay);
      this.hoverOverlay = feature ? this.overlay(feature, 0x268cba) : null;
      this.hoverId = feature?.id;
    }
    this.clearPreview();
    if (this.first && feature) {
      const result = closestFeatures(this.first, feature);
      if (Number.isFinite(result.distance))
        this.preview = this.drawDistance(result, null, true);
    }
    this.v.invalidate();
  }
  click(event, hit) {
    const feature = this.candidate(event, hit);
    if (!feature) {
      this.v.callbacks.onError(
        this.modes[this.first ? 1 : 0] === "face"
          ? "Välj en sammanhängande plan yta. Böjda ytor och snittlock stöds inte här."
          : this.modes[this.first ? 1 : 0] === "line"
            ? "Välj en synlig rak modellkant eller CAD-linje."
            : "Välj en synlig punkt på modellen.",
      );
      return;
    }
    this.accept(feature);
  }
  accept(feature) {
    if (!this.first) {
      this.first = feature;
      this.v.measureStart = this.anchor?.clone() || null;
      this.firstOverlay = this.overlay(feature, 0xe29c37);
      this.v.callbacks.onMeasureStart();
      this.v.invalidate();
      return;
    }
    const result = closestFeatures(this.first, feature);
    if (!Number.isFinite(result.distance)) return;
    const types = [this.first.kind, feature.kind],
      id = this.nextId++;
    const drawn = this.drawDistance(result, id);
    drawn.group.add(
      this.overlay(this.first, 0xe29c37),
      this.overlay(feature, 0x339f87),
    );
    this.v.measurements.push({
      ...drawn,
      id,
      types,
      start: result.a,
      end: result.b,
      distance: result.distance,
      midpoint: result.a.clone().lerp(result.b, 0.5),
    });
    this.cancelPending();
    this.v.callbacks.onMeasure(result.distance, result.b.clone().sub(result.a));
    this.v.invalidate();
  }
  drawDistance(result, id, preview = false) {
    const group = new THREE.Group(),
      line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([result.a, result.b]),
        new THREE.LineBasicMaterial({
          color: preview ? 0x268cba : 0x247c62,
          depthTest: false,
        }),
      );
    line.renderOrder = 13;
    group.add(line);
    for (const point of [result.a, result.b])
      group.add(
        this.overlay({ kind: "point", point }, preview ? 0x268cba : 0x247c62),
      );
    this.v.scene.add(group);
    const label = document.createElement("div");
    label.className = `measure-label${preview ? " measure-preview" : ""}`;
    const value = document.createElement("span");
    value.dataset.measureValue = "";
    value.textContent = `${preview ? "" : `${id} · `}${this.format(result.distance)}`;
    label.append(value);
    if (!preview) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "measure-remove";
      remove.title = "Ta bort mått";
      remove.setAttribute("aria-label", "Ta bort mått");
      remove.textContent = "×";
      remove.onclick = (e) => {
        e.stopPropagation();
        this.remove(id);
      };
      label.append(remove);
    }
    this.v.host.append(label);
    const midpoint = result.a.clone().lerp(result.b, 0.5);
    this.positionLabel(label, midpoint);
    return { group, line, label, midpoint, distance: result.distance };
  }
  positionLabel(label, point, occupied = []) {
    const p = point.clone().project(this.v.camera);
    label.hidden =
      p.z > 1 || p.z < -1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1;
    if (label.hidden) return;
    const width = label.offsetWidth || 100,
      height = label.offsetHeight || 22;
    const x = THREE.MathUtils.clamp(
        (p.x * 0.5 + 0.5) * this.v.width,
        width / 2 + 4,
        this.v.width - width / 2 - 4,
      ),
      base = (-p.y * 0.5 + 0.5) * this.v.height;
    let top = base - height * 1.3;
    for (let i = 0; i < 100; i++) {
      const offset =
        i === 0 ? 0 : Math.ceil(i / 2) * (height + 4) * (i % 2 ? -1 : 1);
      const y = THREE.MathUtils.clamp(
        base - height * 1.3 + offset,
        4,
        this.v.height - height - 4,
      );
      top = y;
      if (
        !occupied.some(
          (r) =>
            Math.abs(r.x - x) < (r.width + width) / 2 + 3 &&
            y < r.top + r.height + 3 &&
            y + height > r.top - 3,
        )
      )
        break;
    }
    occupied.push({ x, top, width, height });
    label.style.left = `${x}px`;
    label.style.top = `${top + height * 1.3}px`;
  }
  layoutLabels() {
    const occupied = [];
    for (const m of this.v.measurements)
      this.positionLabel(m.label, m.midpoint, occupied);
    if (this.preview)
      this.positionLabel(this.preview.label, this.preview.midpoint, occupied);
  }
  clearPreview() {
    if (this.preview) {
      this.dispose(this.preview.group);
      this.preview.label.remove();
      this.preview = null;
    }
  }
  cancelPending() {
    this.first = null;
    this.v.measureStart = null;
    this.dispose(this.firstOverlay);
    this.firstOverlay = null;
    this.dispose(this.hoverOverlay);
    this.hoverOverlay = null;
    this.hoverId = null;
    this.hovered = null;
    this.clearPreview();
  }
  setModes(index, kind) {
    this.modes[index] = kind;
    this.cancelPending();
    this.v.snap.reset();
    this.v.hideSnap();
    this.v.invalidate();
  }
  updateLabels() {
    for (const m of this.v.measurements)
      m.label.querySelector("[data-measure-value]").textContent =
        `${m.id} · ${this.format(m.distance)}`;
    if (this.preview)
      this.preview.label.querySelector("[data-measure-value]").textContent =
        this.format(this.preview.distance);
    this.v.invalidate();
  }
  remove(id) {
    const i = this.v.measurements.findIndex((m) => m.id === id);
    if (i < 0) return;
    const [m] = this.v.measurements.splice(i, 1);
    this.dispose(m.group);
    m.label.remove();
    this.v.callbacks.onMeasureChange?.();
    this.v.invalidate();
  }
  clear() {
    this.cancelPending();
    for (const m of this.v.measurements) {
      this.dispose(m.group);
      m.label.remove();
    }
    this.v.measurements = [];
    this.nextId = 1;
    this.v.snap.reset();
    this.v.hideSnap();
    this.v.callbacks.onMeasureChange?.();
    this.v.invalidate();
  }
}
