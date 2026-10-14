const paths = {
  "rotate-left": '<path d="M4 10a8 8 0 1 1 3 10M4 4v6h6"/>',
  "rotate-right": '<path d="M20 10a8 8 0 1 0-3 10M20 4v6h-6"/>',
  folder: '<path d="M3 7h7l2 2h9v11H3z"/><path d="M3 7V4h7l2 3h9v2"/>',
  models: '<path d="m12 2 8 4v9l-8 5-8-5V6z"/><path d="m4 6 8 5 8-5M12 11v9"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  hide: '<path d="m3 3 18 18M10 5c7-1 12 7 12 7a19 19 0 0 1-4 4M6 6a18 18 0 0 0-4 6s4 7 10 7c2 0 4-1 5-2"/>',
  isolate:
    '<path d="m12 3 8 5v9l-8 4-8-4V8zM4 8l8 5 8-5M12 13v8"/><path d="M1 4V1h3M20 1h3v3M23 20v3h-3M4 23H1v-3"/>',
  ruler:
    '<path d="m3 16 13-13 5 5L8 21zM7 12l2 2M10 9l2 2M13 6l2 2M4 15l2 2"/>',
  cut: '<path d="m4 18 9-14 7 4-9 14zM2 15h20"/>',
  box: '<path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9" stroke-dasharray="3 2"/>',
  save: '<path d="M4 3h13l3 3v15H4zM8 3v6h8V3M8 21v-8h8v8"/>',
  camera: '<path d="M3 7h5l2-3h4l2 3h5v13H3z"/><circle cx="12" cy="13" r="4"/>',
  fit: '<path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6"/><path d="m8 8 8 8m-8 0 8-8"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  properties: '<path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6"/>',
  tree: '<path d="M9 3h6v5H9zM2 16h6v5H2zM16 16h6v5h-6zM12 8v4M5 16v-4h14v4"/>',
  grid: '<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M3 16v5h18v-5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.01"/>',
  settings:
    '<path d="m9 3-.6 2.3-2 .9-2.1-.7-2 3.5 1.6 1.7v2.6L2.3 15l2 3.5 2.1-.7 2 .9L9 21h4l.6-2.3 2-.9 2.1.7 2-3.5-1.6-1.7v-2.6L19.7 9l-2-3.5-2.1.7-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/>',
  cursor: '<path d="m5 3 14 9-7 2-3 7z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  expand: '<path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
  reset: '<path d="M3 10a9 9 0 1 1 1 7M3 3v7h7"/>',
};
export function icon(name, cls = "") {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.models}</svg>`;
}
