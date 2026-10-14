export const INPUT_DEVICE_KEY = "lirastructure.input-device.v1";
export const normalizeInputDevice = (value) =>
  value === "trackpad" ? "trackpad" : "mouse";
let device;
export function inputDevice() {
  if (!device) {
    try {
      device = normalizeInputDevice(localStorage.getItem(INPUT_DEVICE_KEY));
    } catch {
      device = "mouse";
    }
  }
  return device;
}
export function setInputDevice(value) {
  device = normalizeInputDevice(value);
  try {
    localStorage.setItem(INPUT_DEVICE_KEY, device);
  } catch {
    /* Keep the choice for this session. */
  }
}
/** Trackpad scrolling pans; pinch (browser Ctrl-wheel) and mouse wheels zoom. */
export function inputWheelGesture(event, mode = inputDevice(), pageSize = 800) {
  const factor =
    event.deltaMode === 1 ? 15 : event.deltaMode === 2 ? pageSize : 1;
  let x = event.deltaX * factor,
    y = event.deltaY * factor;
  if (mode === "trackpad" && !event.ctrlKey && !event.metaKey) {
    if (event.shiftKey && !x) {
      x = y;
      y = 0;
    }
    return { action: "pan", x, y };
  }
  return { action: "zoom", x, y: y * zoomSpeed() * zoomDirection(event) };
}

export const ZOOM_SPEED_KEY = "lirastructure.zoom-speed.v1";
export const normalizeZoomSpeed = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0.25 && number <= 4 ? number : 1;
};
let speed;
export function zoomSpeed() {
  if (speed === undefined) {
    try {
      speed = normalizeZoomSpeed(localStorage.getItem(ZOOM_SPEED_KEY));
    } catch {
      speed = 1;
    }
  }
  return speed;
}
export function setZoomSpeed(value) {
  speed = normalizeZoomSpeed(value);
  try {
    localStorage.setItem(ZOOM_SPEED_KEY, String(speed));
  } catch {
    /* Keep the choice for this session. */
  }
}

export const ORBIT_DAMPING_KEY = "lirastructure.orbit-damping.v1";
let damping;
export function orbitDamping() {
  if (damping === undefined) {
    try {
      damping = localStorage.getItem(ORBIT_DAMPING_KEY) !== "false";
    } catch {
      damping = true;
    }
  }
  return damping;
}
export function setOrbitDamping(value) {
  damping = Boolean(value);
  try {
    localStorage.setItem(ORBIT_DAMPING_KEY, String(damping));
  } catch {
    /* Keep the choice for this session. */
  }
}

export const ZOOM_INVERTED_KEY = "lirastructure.zoom-inverted.v1";
let inverted;
export function zoomInverted() {
  if (inverted === undefined) {
    try {
      inverted = localStorage.getItem(ZOOM_INVERTED_KEY) === "true";
    } catch {
      inverted = false;
    }
  }
  return inverted;
}
export function setZoomInverted(value) {
  inverted = Boolean(value);
  try {
    localStorage.setItem(ZOOM_INVERTED_KEY, String(inverted));
  } catch {
    /* Keep the choice for this session. */
  }
}
/** Invert wheel zoom while keeping pinch gestures in their natural direction. */
export function zoomDirection(event) {
  return zoomInverted() && !event.ctrlKey && !event.metaKey ? -1 : 1;
}
