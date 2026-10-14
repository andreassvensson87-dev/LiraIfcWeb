import * as THREE from "three";
import { cubeRegions } from "./view-navigation.js";
import { icon } from "./icons.js";
const ns = "http://www.w3.org/2000/svg";
function svgNode(tag, attributes) {
  const node = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attributes))
    node.setAttribute(key, value);
  return node;
}

export class ViewCube {
  constructor(host, { select, roll, home, dragStart, drag }) {
    this.root = document.createElement("div");
    this.root.className = "view-cube";
    this.root.setAttribute("role", "group");
    this.root.setAttribute("aria-label", "Vykub – standardvyer och rotation");
    this.root.innerHTML = `<button class="cube-roll cube-roll-left" title="Vrid vyn 90° åt vänster" aria-label="Vrid vyn 90° åt vänster">${icon("rotate-left")}</button><button class="cube-roll cube-roll-right" title="Vrid vyn 90° åt höger" aria-label="Vrid vyn 90° åt höger">${icon("rotate-right")}</button><button class="cube-home" title="Standardvy – behåll zoom" aria-label="Standardvy – behåll zoom">${icon("home")}</button>`;
    this.svg = svgNode("svg", {
      viewBox: "0 0 160 150",
      class: "cube-surface",
      "aria-label":
        "Dra kuben för att rotera. Klicka en sida, kant eller hörn för att byta vy.",
    });
    const ring = svgNode("g", { class: "cube-ring", "aria-hidden": "true" });
    ring.append(svgNode("ellipse", { cx: 80, cy: 122, rx: 66, ry: 20 }));
    for (const [x1, y1, x2, y2] of [
      [11, 122, 20, 122],
      [140, 122, 149, 122],
      [80, 98, 80, 104],
      [80, 140, 80, 146],
    ])
      ring.append(svgNode("line", { x1, y1, x2, y2 }));
    this.svg.append(ring);
    this.regions = cubeRegions().map((region) => {
      const group = svgNode("g", {
        role: "button",
        tabindex: "-1",
        class: `cube-region cube-${region.kind}`,
        "aria-label": region.label,
        "data-direction": region.key,
      });
      const title = svgNode("title", {});
      title.textContent = region.label;
      const polygon = svgNode("polygon", {});
      group.append(title, polygon);
      let text = null;
      if (region.kind === "face") {
        text = svgNode("text", {
          "text-anchor": "middle",
          "dominant-baseline": "central",
        });
        text.textContent = region.label;
        group.append(text);
      }
      group.addEventListener("keydown", (event) => {
        if (["Enter", " "].includes(event.key)) {
          event.preventDefault();
          select(region.direction);
        }
      });
      this.svg.append(group);
      return { ...region, group, polygon, text };
    });
    this.root.prepend(this.svg);
    host.append(this.root);
    this.root.querySelector(".cube-roll-left").onclick = () => roll(-1);
    this.root.querySelector(".cube-roll-right").onclick = () => roll(1);
    this.root.querySelector(".cube-home").onclick = home;
    let gesture = null;
    const finish = (event, cancelled = false) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const current = gesture;
      gesture = null;
      this.root.classList.remove("cube-dragging");
      if (this.svg.hasPointerCapture(event.pointerId))
        this.svg.releasePointerCapture(event.pointerId);
      if (!cancelled && !current.moved && current.region)
        select(current.region.direction);
    };
    this.svg.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragStart();
      const key = event.target.closest("[data-direction]")?.dataset.direction;
      gesture = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        region: this.regions.find((region) => region.key === key),
      };
      this.svg.setPointerCapture(event.pointerId);
    });
    this.svg.addEventListener("pointermove", (event) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      event.preventDefault();
      const dx = event.clientX - gesture.x,
        dy = event.clientY - gesture.y;
      if (
        Math.hypot(
          event.clientX - gesture.startX,
          event.clientY - gesture.startY,
        ) > 4
      )
        gesture.moved = true;
      if (gesture.moved) {
        this.root.classList.add("cube-dragging");
        drag(dx, dy);
      }
      gesture.x = event.clientX;
      gesture.y = event.clientY;
    });
    this.svg.addEventListener("pointerup", (event) => finish(event));
    this.svg.addEventListener("pointercancel", (event) => finish(event, true));
    this.root.addEventListener("contextmenu", (event) =>
      event.preventDefault(),
    );
    this.root.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && gesture)
        finish({ pointerId: gesture.id }, true);
    });
    window.addEventListener("blur", () => {
      if (gesture) finish({ pointerId: gesture.id }, true);
    });
  }
  update(camera) {
    const signature = camera.quaternion
      .toArray()
      .map((value) => value.toFixed(5))
      .join(":");
    if (signature === this.signature) return;
    this.signature = signature;
    const inverse = camera.quaternion.clone().invert();
    const project = (point) => {
      const local = point.clone().applyQuaternion(inverse);
      return { x: 80 + local.x * 38, y: 72 - local.y * 38, z: local.z };
    };
    const rendered = this.regions
      .map((region) => {
        const normal = region.normal.clone().applyQuaternion(inverse);
        const visible = normal.z > 1e-4;
        region.group.style.display = visible ? "" : "none";
        region.group.setAttribute("tabindex", visible ? "0" : "-1");
        region.group.classList.toggle("cube-current", normal.z > 0.9999);
        const points = region.points.map(project);
        region.polygon.setAttribute(
          "points",
          points.map((point) => `${point.x},${point.y}`).join(" "),
        );
        if (region.text) {
          const center = region.points
            .reduce((sum, point) => sum.add(point), new THREE.Vector3())
            .divideScalar(region.points.length);
          // Text lives in the face plane: both axes are projected with the cube.
          // SVG text's positive Y points down, hence the negated face-up vector.
          const up =
            Math.abs(region.normal.y) > 0.9
              ? new THREE.Vector3(0, 0, region.normal.y > 0 ? -1 : 1)
              : new THREE.Vector3(0, 1, 0);
          const right = up.clone().cross(region.normal).normalize();
          const origin = project(center);
          const horizontal = project(
            center.clone().addScaledVector(right, 1 / 38),
          );
          const vertical = project(center.clone().addScaledVector(up, -1 / 38));
          region.text.setAttribute(
            "transform",
            `matrix(${horizontal.x - origin.x} ${horizontal.y - origin.y} ${vertical.x - origin.x} ${vertical.y - origin.y} ${origin.x} ${origin.y})`,
          );
        }
        return {
          region,
          z: points.reduce((sum, p) => sum + p.z, 0) / points.length,
        };
      })
      .sort((a, b) => a.z - b.z);
    rendered.forEach(({ region }) => this.svg.append(region.group));
  }
}
