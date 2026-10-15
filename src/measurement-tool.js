import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { closestFeatures } from "./measurement-geometry.js";
export const geometryNames = {
  auto: "Automatiskt",
  point: "Punkt",
  line: "Linje",
  face: "Plan yta",
};
export class MeasurementTool {
  constructor(viewer) {
    this.v = viewer;
    this.modes = ["auto", "auto"];
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
      o.userData.measureMarker?.remove();
      o.userData.measureChain?.remove();
      o.geometry?.dispose();
      if (o.material) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }
  stroke(positions, color, width) {
    const line = new LineSegments2(
      new LineSegmentsGeometry().setPositions(positions),
      new LineMaterial({
        color,
        linewidth: width,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    line.renderOrder = 112;
    return line;
  }
  overlay(feature, color, emphasized = false) {
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
      const fill = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: emphasized ? 0.28 : 0.12,
          side: THREE.DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      fill.renderOrder = 111;
      group.add(fill);
      // Coplanar internal triangle edges disappear; outer boundaries and holes remain.
      const boundary = new THREE.EdgesGeometry(geometry, 1);
      const positions = Array.from(boundary.attributes.position.array);
      boundary.dispose();
      if (positions.length)
        group.add(this.stroke(positions, color, emphasized ? 2 : 1));
    } else if (feature.kind === "line") {
      const positions = [...feature.a.toArray(), ...feature.b.toArray()];
      if (emphasized) group.add(this.stroke(positions, 0xffffff, 5));
      const core = this.stroke(positions, color, emphasized ? 2.5 : 1.5);
      core.renderOrder = 113;
      group.add(core);
    } else {
      const marker = document.createElement("div");
      marker.hidden = true;
      marker.className = `measure-point${emphasized ? " is-active" : ""}`;
      marker.style.setProperty(
        "--marker-color",
        `#${new THREE.Color(color).getHexString()}`,
      );
      marker.dataset.snap = feature.snap || "point";
      const paths = {
        endpoint: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
        midpoint: '<path d="M12 4 21 20H3Z"/>',
        center: '<circle cx="12" cy="12" r="8"/><path d="M12 1v22M1 12h22"/>',
        perpendicular: '<path d="M5 4v15h15M5 13h6v6"/>',
      };
      marker.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[feature.snap] || '<circle cx="12" cy="12" r="6"/>'}<circle class="measure-point-center" cx="12" cy="12" r="1.5"/></svg>`;
      this.v.host.append(marker);
      group.userData.measureMarker = marker;
      group.userData.measurePoint = feature.point.clone();
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
          ? feature
          : null,
    );
    if (feature?.kind !== "point" && feature?.id === this.hoverId) {
    } else {
      this.dispose(this.hoverOverlay);
      this.hoverOverlay =
        feature && !(feature.kind !== "point" && feature.id === this.first?.id)
          ? this.overlay(feature, 0x008fc7, true)
          : null;
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
      this.dispose(this.hoverOverlay);
      this.hoverOverlay = null;
      this.hoverId = null;
      this.v.hideSnap();
      this.first = feature;
      this.v.measureStart = this.anchor?.clone() || null;
      this.firstOverlay = this.overlay(feature, 0xe29c37, true);
      this.v.callbacks.onMeasureStart();
      this.v.invalidate();
      return;
    }
    const result = closestFeatures(this.first, feature);
    if (!Number.isFinite(result.distance)) return;
    const types = [this.first.kind, feature.kind],
      id = this.nextId++;
    const drawn = this.drawDistance(result, id);
    drawn.label.title = types.map((kind) => geometryNames[kind]).join(" → ");

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
    this.v.hideSnap();
    this.v.callbacks.onMeasure(result.distance, result.b.clone().sub(result.a));
    this.v.invalidate();
  }
  drawDistance(result, id, preview = false) {
    const group = new THREE.Group();
    const chain = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chain.classList.add("measure-chain");
    if (preview) chain.classList.add("is-preview");
    chain.setAttribute("aria-hidden", "true");
    const paths = {};
    for (const name of ["extension", "dimension", "ticks", "leader"]) {
      const path = document.createElementNS(chain.namespaceURI, "path");
      path.classList.add(`measure-${name}`);
      chain.append(path);
      paths[name] = path;
    }
    this.v.host.append(chain);
    group.userData.measureChain = chain;
    for (const point of [result.a, result.b])
      group.add(
        this.overlay({ kind: "point", point }, preview ? 0x268cba : 0x247c62),
      );
    this.v.scene.add(group);
    const label = document.createElement("div");
    label.className = `measure-label${preview ? " measure-preview" : ""}`;
    const value = document.createElement("span");
    value.dataset.measureValue = "";
    value.textContent = this.format(result.distance);
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
    return {
      group,
      line: paths.dimension,
      chain,
      paths,
      label,
      midpoint,
      a: result.a.clone(),
      b: result.b.clone(),
      distance: result.distance,
    };
  }
  positionLabel(label, point, occupied = [], offset = { x: 0, y: 0 }) {
    const p = point.clone().project(this.v.camera);
    label.hidden =
      p.z > 1 || p.z < -1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1;
    if (label.hidden) return;
    const width = label.offsetWidth || 100,
      height = label.offsetHeight || 22;
    const x = THREE.MathUtils.clamp(
        (p.x * 0.5 + 0.5) * this.v.width + offset.x,
        width / 2 + 4,
        this.v.width - width / 2 - 4,
      ),
      base = (-p.y * 0.5 + 0.5) * this.v.height + offset.y;
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
    return { x, y: top + height / 2, width, height };
  }
  layoutDimension(m, occupied) {
    const project = (point) => {
      const p = point.clone().project(this.v.camera);
      return {
        x: ((p.x + 1) * this.v.width) / 2,
        y: ((1 - p.y) * this.v.height) / 2,
        z: p.z,
      };
    };
    const a = project(m.a),
      b = project(m.b);
    const behind = a.z < -1 || a.z > 1 || b.z < -1 || b.z > 1;
    m.chain.style.display = behind ? "none" : "";
    if (behind) {
      m.label.hidden = true;
      return;
    }
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    let nx = length > 1 ? -dy / length : 0,
      ny = length > 1 ? dx / length : -1;
    if (ny > 0 || (Math.abs(ny) < 1e-6 && nx > 0)) {
      nx = -nx;
      ny = -ny;
    }
    const offset = { x: nx * 32, y: ny * 32 };
    const A = { x: a.x + offset.x, y: a.y + offset.y },
      B = { x: b.x + offset.x, y: b.y + offset.y };
    const segment = (p, q) =>
      `M${p.x.toFixed(2)},${p.y.toFixed(2)}L${q.x.toFixed(2)},${q.y.toFixed(2)}`;
    m.paths.extension.setAttribute(
      "d",
      [a, b]
        .map((p) =>
          segment(
            { x: p.x + nx * 4, y: p.y + ny * 4 },
            { x: p.x + nx * 38, y: p.y + ny * 38 },
          ),
        )
        .join(""),
    );
    m.paths.dimension.setAttribute("d", segment(A, B));
    const tx = length > 1 ? dx / length : 1,
      ty = length > 1 ? dy / length : 0;
    const tick = { x: (tx + nx) * 4, y: (ty + ny) * 4 };
    m.paths.ticks.setAttribute(
      "d",
      [A, B]
        .map((p) =>
          segment(
            { x: p.x - tick.x, y: p.y - tick.y },
            { x: p.x + tick.x, y: p.y + tick.y },
          ),
        )
        .join(""),
    );
    const box = this.positionLabel(m.label, m.midpoint, occupied, offset);
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    m.paths.leader.setAttribute(
      "d",
      box && Math.hypot(box.x - mid.x, box.y - mid.y) > 28
        ? segment(mid, { x: box.x, y: box.y + box.height / 2 })
        : "",
    );
  }
  layoutLabels() {
    // Position markers in screen space before painting: no sprite scaling lag,
    // depth fighting, or differently sized symbols between projections.
    for (const group of [
      this.hoverOverlay,
      this.firstOverlay,
      this.preview?.group,
      ...this.v.measurements.map((m) => m.group),
    ]) {
      group?.traverse((o) => {
        const marker = o.userData.measureMarker;
        if (!marker) return;
        const p = o.userData.measurePoint.clone().project(this.v.camera);
        marker.hidden =
          Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z < -1 || p.z > 1;
        marker.style.left = `${((p.x + 1) * this.v.width) / 2}px`;
        marker.style.top = `${((1 - p.y) * this.v.height) / 2}px`;
      });
    }
    const occupied = [];
    for (const m of this.v.measurements) this.layoutDimension(m, occupied);
    if (this.preview) this.layoutDimension(this.preview, occupied);
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
        this.format(m.distance);
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
