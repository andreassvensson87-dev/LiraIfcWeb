export function installRectangleSelection({
  host,
  canvas,
  enabled,
  onClick,
  onRectangle,
  onStart,
  onFinish,
}) {
  const box = document.createElement("div");
  box.className = "selection-box";
  box.hidden = true;
  box.setAttribute("aria-hidden", "true");
  host.append(box);
  const root = canvas.ownerDocument;
  let gesture = null;
  const local = (event) => {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    };
  };
  const cancel = () => {
    if (!gesture) return;
    const id = gesture.id;
    gesture = null;
    box.hidden = true;
    onFinish?.();
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  };
  const start = (event) => {
    if (gesture) cancel();
    if (
      event.target !== canvas ||
      event.button !== 0 ||
      event.pointerType === "touch" ||
      !enabled()
    )
      return;
    event.stopImmediatePropagation();
    gesture = {
      id: event.pointerId,
      start: local(event),
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
      additive: event.shiftKey,
      clickAdditive: event.shiftKey || event.ctrlKey || event.metaKey,
    };
    onStart();
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
  };
  const move = (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    event.stopImmediatePropagation();
    if (
      Math.hypot(
        event.clientX - gesture.clientX,
        event.clientY - gesture.clientY,
      ) >= 5
    )
      gesture.moved = true;
    if (!gesture.moved) return;
    const a = gesture.start,
      b = local(event);
    box.hidden = false;
    box.classList.toggle("crossing", b.x < a.x);
    Object.assign(box.style, {
      left: `${Math.min(a.x, b.x)}px`,
      top: `${Math.min(a.y, b.y)}px`,
      width: `${Math.abs(b.x - a.x)}px`,
      height: `${Math.abs(b.y - a.y)}px`,
    });
  };
  const end = (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    event.stopImmediatePropagation();
    const current = gesture,
      point = local(event);
    const moved =
      current.moved ||
      Math.hypot(
        event.clientX - current.clientX,
        event.clientY - current.clientY,
      ) >= 5;
    cancel();
    if (moved) onRectangle(current.start, point, current.additive);
    else onClick(event, current.clickAdditive);
  };
  const pointerCancel = (event) => {
    if (event.pointerId === gesture?.id) cancel();
  };
  const key = (event) => {
    if (gesture && event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    }
  };
  const wheel = (event) => {
    if (gesture) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  root.addEventListener("pointerdown", start, true);
  root.addEventListener("pointermove", move, true);
  root.addEventListener("pointerup", end, true);
  root.addEventListener("pointercancel", pointerCancel, true);
  root.addEventListener("keydown", key, true);
  root.addEventListener("wheel", wheel, { capture: true, passive: false });
  root.defaultView.addEventListener("blur", cancel);
  return {
    get active() {
      return !!gesture;
    },
    cancel,
    dispose() {
      cancel();
      box.remove();
      root.removeEventListener("pointerdown", start, true);
      root.removeEventListener("pointermove", move, true);
      root.removeEventListener("pointerup", end, true);
      root.removeEventListener("pointercancel", pointerCancel, true);
      root.removeEventListener("keydown", key, true);
      root.removeEventListener("wheel", wheel, true);
      root.defaultView.removeEventListener("blur", cancel);
    },
  };
}
