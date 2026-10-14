import * as THREE from "three";
import "./style.css";
import { watchAppUpdate } from "./app-update.js";
import { icon } from "./icons.js";
import { Viewer } from "./viewer.js";
import { createDemoModels } from "./demo.js";
import {
  inputDevice,
  setInputDevice,
  zoomSpeed,
  setZoomSpeed,
  zoomInverted,
  setZoomInverted,
  orbitDamping,
  setOrbitDamping,
} from "./input-device.js";
import {
  buildModelTree,
  buildGroupingTree,
  groupVisibility,
  toggleGroupVisibility,
} from "./model-tree.js";
import {
  objectKey,
  matchesObject,
  safeText as esc,
  flattenProperties,
  propertySetRows,
  viewSnapshot,
  canRestoreView,
} from "./model-state.js";
import {
  storedFiles,
  storeFile,
  deleteFile,
  readSettings,
  saveSettings,
} from "./storage.js";

const $ = (s) => document.querySelector(s);
const settings = readSettings();
const state = {
  models: [],
  selected: new Set(),
  selectedBranches: new Map(),
  hidden: new Set(),
  isolated: null,
  tab: "models",
  query: "",
  type: "",
  grouping: ["ifc", "systems", "zones", "types"].includes(settings.grouping)
    ? settings.grouping
    : "ifc",
  views: settings.views || [],
  origin: settings.origin || null,
  loading: false,
  expanded: new Set(),
  props: new Map(),
  limit: 150,
};
const command = (action, name, glyph, options = "") =>
  `<button class="command" data-action="${action}" ${options}>${icon(glyph)}<span>${name}</span></button>`;
const small = (action, name, glyph, options = "") =>
  `<button class="icon-button" data-action="${action}" title="${name}" aria-label="${name}" ${options}>${icon(glyph)}</button>`;
$("#app").innerHTML = `
  <header class="header">
    <a class="brand" href="${import.meta.env.BASE_URL}" aria-label="LiraIFC"><img src="${import.meta.env.BASE_URL}lira-icon.svg" alt=""/><strong>Lira<span>IFC</span></strong></a>
    <div class="header-divider"></div><span class="workspace-title">Modellgranskning</span><span class="viewer-badge">VIEWER</span>
    <div class="header-right"><button id="app-update" class="lira-update" title="En ny version finns tillgänglig" hidden>Uppdatera appen</button><span class="local-status"><i></i> Lokalt på din enhet</span>${small("settings", "Inställningar", "settings", 'aria-haspopup="dialog" aria-controls="settings-dialog"')}${small("help", "Hjälp och kortkommandon", "help")}<button class="primary header-open" data-action="open">${icon("folder")} Öppna IFC</button></div>
  </header>
  <nav class="ribbon" aria-label="Modellverktyg">
    <div class="ribbon-group"><div class="commands">${command("open", "Öppna IFC", "folder")}${command("demo", "Demomodell", "models")}</div><span class="group-label">Modell</span></div>
    <div class="ribbon-group"><div class="commands">${command("isolate", "Isolera", "isolate", "data-selection")}${command("hide", "Dölj", "hide", "data-selection")}${command("show-all", "Visa alla", "eye")}</div><span class="group-label">Urval</span></div>
    <div class="ribbon-group"><div class="commands">${command("measure", "Mät", "ruler", 'aria-pressed="false"')}${command("section", "Snitt", "cut", 'aria-pressed="false"')}${command("section-box", "Snittbox", "box", 'aria-pressed="false"')}</div><span class="group-label">Granska</span></div>
    <div class="ribbon-group"><div class="commands">${command("edges", "Kantlinjer", "models", 'aria-pressed="false"')}<div class="command-stack"><label class="ribbon-select">Färgsättning<select id="color-mode" aria-label="Färgsättning"><option value="original">Original</option><option value="discipline">Disciplin</option><option value="type">Objekttyp</option></select></label><button class="compact" data-action="grid" aria-pressed="true">${icon("grid")} Rutnät</button></div></div><span class="group-label">Utseende</span></div>
    <div class="ribbon-group"><div class="commands">${command("save-view", "Spara vy", "save")}${command("screenshot", "Skärmbild", "camera")}${command("fit", "Passa vy", "fit")}</div><span class="group-label">Vyer</span></div>
  </nav>
  <main class="workbench">
    <section id="viewport" aria-label="Modellvy">
      <div class="view-cube" aria-label="Standardvyer"><button data-action="view-top" title="Ovanifrån">Topp</button><div><button data-action="view-front">Fram</button><button data-action="view-right">Höger</button></div><button class="cube-iso" data-action="view-iso" title="Isometrisk vy">${icon("models")}</button></div>
      <div id="object-menu" class="object-menu" role="menu" aria-label="Markerade objekt" hidden></div>
      <div id="empty" class="empty-state" hidden>${icon("models")}<h1>Hela modellen. Alla detaljer.</h1><p>Öppna en IFC-modell eller släpp flera filer här<br/>för att granska dem tillsammans.</p><button class="primary" data-action="open">${icon("folder")} Öppna IFC</button><button class="text-button" data-action="demo">Prova demomodellen</button><small>Filerna stannar på din enhet.</small></div>
      <div id="drop-zone" class="drop-zone" hidden>${icon("folder")}<strong>Släpp dina IFC-filer här</strong><span>Öppna flera modeller tillsammans</span></div>
      <div id="loading" class="loading-card" role="status" hidden><span class="spinner"></span><div><strong id="loading-name"></strong><span id="loading-status">Läser modell…</span></div></div>
      <div id="tool-hud" class="tool-hud" hidden></div>
      <button class="panel-toggle icon-button" data-action="toggle-panel" title="Visa eller dölj inspektorn" aria-label="Visa eller dölj inspektorn">${icon("properties")}</button>
    </section>
    <aside class="inspector" aria-label="Högerinspektor">
      <div class="inspector-content"><div id="panel-content"></div></div>
      <div class="inspector-tabs" role="tablist" aria-label="Inspektorpaneler" aria-orientation="vertical">
        ${[
          ["models", "Modeller", "tree"],
          ["properties", "Egenskaper", "properties"],
          ["views", "Sparade vyer", "camera"],
          ["review", "Snitt och mätning", "ruler"],
        ]
          .map(
            ([tab, label, glyph]) =>
              `<button class="inspector-tab" role="tab" id="tab-${tab}" aria-controls="panel-content" aria-selected="${tab === "models"}" tabindex="${tab === "models" ? 0 : -1}" data-tab="${tab}" title="${label}" aria-label="${label}">${icon(glyph)}</button>`,
          )
          .join("")}
      </div>
    </aside>
  </main>
  <footer class="statusbar"><div class="status-counts"><span id="model-count">0 modeller</span><span id="object-count">0 objekt</span><span id="selection-count">Inget valt</span></div><span id="status-message" role="status">Öppnar viewer…</span><div class="view-controls"><select id="projection" aria-label="Projektion"><option value="perspective">Perspektiv</option><option value="orthographic">Ortografisk</option></select><select id="level-filter" aria-label="Våning"><option value="">Alla våningar</option></select><button class="compact" data-action="fit">${icon("fit")} Passa vy</button><span class="unit-label">m</span></div></footer>
  <input id="file-input" type="file" accept=".ifc" multiple hidden />
  <div id="toast" class="toast" role="status" hidden></div>
  <dialog id="help-dialog"><div class="dialog-heading"><h2>LiraIFC</h2>${small("close-dialog", "Stäng", "close")}</div><p>Granska IFC-modeller direkt i webbläsaren. Modeller och sparade vyer lagras lokalt i denna webbläsare.</p><p class="muted">Med styrplatta panorerar tvåfingerscroll och nypning zoomar. Orbit startar runt punkten under pekaren när den träffar modellen.</p><dl class="shortcuts"><dt>Välj objekt</dt><dd>Klicka med vänster musknapp</dd><dt>Orbit</dt><dd>Shift/Ctrl/Cmd + mitten- eller högerdrag</dd><dt>Panorera</dt><dd>Dra med mitten- eller högerknappen</dd><dt>Zooma</dt><dd>Scrolla mot muspekaren eller nyp</dd><dt>Välj flera</dt><dd>Shift/Ctrl/Cmd + klick</dd><dt>Rektangelmarkering</dt><dd>Vänsterdra. Blå ruta väljer helt inneslutna objekt, grön ruta väljer berörda objekt. Shift lägger till; Esc avbryter.</dd><dt>Objektmeny</dt><dd>Högerklick på markeringen</dd><dt>Fokusera objekt</dt><dd>Dubbelklick</dd><dt>Passa vy</dt><dd>F</dd><dt>Mät avstånd</dt><dd>M</dd><dt>Dölj markering</dt><dd>H</dd><dt>Visa alla</dt><dd>A</dd><dt>Avbryt verktyg</dt><dd>Esc</dd></dl><p class="muted">Mätning använder meter. Grön punkt markerar snap till en triangelhörnpunkt. Snittplan och snittbox visar fyllda, skrafferade snittytor i slutna volymer.</p><button class="primary" data-action="close-dialog">Tillbaka till modellen</button></dialog>
  <dialog id="settings-dialog" aria-labelledby="settings-title"><div class="dialog-heading"><h2 id="settings-title">Inställningar</h2>${small("close-dialog", "Stäng", "close")}</div><fieldset class="navigation-settings"><legend>Navigationsinställningar</legend><label class="field-label">Inmatning<select id="navigation-device"><option value="mouse">Mus</option><option value="trackpad">Styrplatta</option></select></label><label class="field-label" for="navigation-zoom-speed">Zoomhastighet <output id="navigation-zoom-value" for="navigation-zoom-speed">100 %</output><input id="navigation-zoom-speed" aria-label="Zoomhastighet" type="range" min="25" max="400" step="5" value="100"/></label><button class="text-button" data-action="reset-zoom-speed">Återställ zoomhastighet</button><label class="navigation-toggle"><span>Invertera zoomriktning</span><input id="navigation-zoom-inverted" type="checkbox"/></label><label class="navigation-toggle"><span>Dämpad orbit</span><input id="navigation-orbit-damping" type="checkbox" checked/></label><p class="muted">Inställningarna sparas automatiskt. Invertering gäller scrollzoom; nypning behåller sin naturliga riktning.</p></fieldset><button class="primary" data-action="close-dialog">Stäng</button></dialog>
  <dialog id="view-dialog"><form id="view-form"><div class="dialog-heading"><h2>Spara aktuell vy</h2>${small("close-dialog", "Stäng", "close", 'type="button"')}</div><label>Namn på vyn<input id="view-name" required maxlength="80" autocomplete="off" placeholder="Exempel: Stomme – plan 02"/></label><p class="muted">Kamera, modeller, synlighet och snitt sparas på din enhet.</p><button class="primary" type="submit">${icon("save")} Spara vy</button></form></dialog>
`;

let viewer;
try {
  viewer = new Viewer($("#viewport"), {
    onSelect: selectObject,
    onSelectMany: selectObjects,
    onContextMenu: (object, event) => {
      if (object) openObjectMenu(object, event);
      else openBackgroundMenu(event);
    },
    onMeasureStart: () => status("Välj andra punkten. Esc avbryter."),
    onMeasure: (distance) => {
      status(
        `Avstånd: ${format(distance)} m. Välj två punkter för nästa mått.`,
      );
      renderPanel();
    },
    onError: notify,
  });
} catch (error) {
  $("#empty").hidden = false;
  $("#empty").innerHTML =
    `<h1>3D-grafiken kunde inte startas</h1><p>${esc(error.message)}</p>`;
  throw error;
}

function format(n) {
  return n.toLocaleString("sv", { maximumFractionDigits: 3 });
}
function status(message) {
  $("#status-message").textContent = message;
}
let toastTimer;
function notify(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 6500);
  status(message);
}
function persist() {
  if (
    !saveSettings({
      initialized: true,
      grouping: state.grouping,
      views: state.views,
      origin: state.origin,
      demo: state.models.some((m) => m.demo),
    })
  )
    notify(
      "Vyn kunde inte sparas lokalt. Webbläsarens lagring är full eller blockerad.",
    );
}
function allObjects() {
  return state.models.flatMap((m) => m.objects);
}
function selectedObjects() {
  return allObjects().filter((o) => state.selected.has(o.key));
}
function modelFor(object) {
  return state.models.find((m) => m.id === object.modelId);
}
function setTab(tab) {
  state.tab = tab;
  if (tab === "properties") selectedObjects().forEach(requestProperties);
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.setAttribute("aria-selected", active);
    button.tabIndex = active ? 0 : -1;
  });
  $(".workbench").classList.remove("panel-collapsed");
  renderPanel();
}
function registerModel(model) {
  model.objectMap = new Map();
  for (const object of model.objects) {
    object.key = objectKey(model.id, object.expressId);
    object.modelId = model.id;
    object.bounds = new THREE.Box3();
    model.objectMap.set(object.expressId, object);
  }
  model.tree = buildModelTree(model);
  model.trees = {
    ifc: model.tree,
    systems: buildGroupingTree(model, "systems"),
    zones: buildGroupingTree(model, "zones"),
    types: buildGroupingTree(model, "types"),
  };
  model.objects.forEach((o) => {
    o.level ||= "Övrigt";
  });
  viewer.addModel(model);
  state.models.push(model);
  state.expanded.add(model.id);
  function expandStructure(node) {
    if (node.children.length) {
      state.expanded.add(node.id);
      node.children.forEach(expandStructure);
    }
  }
  model.tree.roots.forEach(expandStructure);
}
function refresh() {
  viewer.updateVisibility(state.hidden, state.isolated);
  viewer.setSelected(state.selected);
  $("#empty").hidden = state.models.length > 0;
  $("#model-count").textContent =
    `${state.models.length} ${state.models.length === 1 ? "modell" : "modeller"}`;
  $("#object-count").textContent =
    `${allObjects().length.toLocaleString("sv")} objekt`;
  $("#selection-count").textContent = state.selected.size
    ? `${state.selected.size} ${state.selected.size === 1 ? "objekt valt" : "objekt valda"}`
    : "Inget valt";
  document.querySelectorAll("[data-selection]").forEach((b) => {
    b.disabled = !state.selected.size;
  });
  for (const action of [
    "save-view",
    "screenshot",
    "fit",
    "measure",
    "section",
    "section-box",
    "edges",
  ])
    document.querySelectorAll(`[data-action="${action}"]`).forEach((b) => {
      b.disabled = !state.models.length;
    });
  const currentLevel = $("#level-filter").value;
  const levels = [...new Set(allObjects().map((o) => o.level))].sort((a, b) =>
    a.localeCompare(b, "sv", { numeric: true }),
  );
  $("#level-filter").innerHTML =
    '<option value="">Alla våningar</option>' +
    levels.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join("");
  $("#level-filter").value = levels.includes(currentLevel) ? currentLevel : "";
  renderPanel();
  closeObjectMenu();
}
function closeObjectMenu() {
  $("#object-menu").hidden = true;
}
function branchKey(model, node = null) {
  return JSON.stringify([model.id, state.grouping, node?.id || null]);
}
function branchFromSummary(summary) {
  const visibility = summary?.querySelector(".visibility[data-model]");
  if (!visibility) return null;
  const model = state.models.find(
    (model) => model.id === visibility.dataset.model,
  );
  const node = visibility.dataset.node
    ? model?.trees[state.grouping].nodes.get(visibility.dataset.node)
    : null;
  return model && (!visibility.dataset.node || node) ? { model, node } : null;
}
function selectBranch(branch, additive = false) {
  const key = branchKey(branch.model, branch.node);
  if (!additive) state.selectedBranches.clear();
  if (additive && state.selectedBranches.has(key))
    state.selectedBranches.delete(key);
  else state.selectedBranches.set(key, branch);
  // Recompute the union so removing a parent or overlapping group keeps other branches selected.
  state.selected = new Set(
    [...state.selectedBranches.values()].flatMap(({ model, node }) =>
      (node ? node.members : model.objects).map((object) => object.key),
    ),
  );
  refresh();
  status(
    `${state.selectedBranches.size} grenar markerade · ${state.selected.size} objekt`,
  );
}
function openObjectMenu(object, event, branch = null) {
  if (
    branch &&
    !state.selectedBranches.has(branchKey(branch.model, branch.node))
  )
    selectBranch(branch);
  if (object && !state.selected.has(object.key)) selectObject(object);
  if (!state.selected.size) return;
  showContextMenu(
    `${branch ? `${state.selectedBranches.size > 1 ? `${state.selectedBranches.size} grenar markerade` : esc(branch.node?.name || branch.model.name)}<br/>` : ""}${state.selected.size} ${state.selected.size === 1 ? "objekt valt" : "objekt valda"}`,
    [
      ...(!branch ? [["info", "Info", "properties"]] : []),
      ["focus-selection", "Fokusera", "fit"],
      ["show-selection", "Visa", "eye"],
      ["hide", "Göm", "hide"],
      [branch ? "isolate-branch" : "isolate", "Isolera", "isolate"],
    ],
    event,
  );
}
function openBackgroundMenu(event) {
  showContextMenu(
    "Modellvy",
    [
      ["show-all", "Visa alla", "eye", !state.models.length],
      ["fit", "Anpassa modell", "fit", !state.models.length],
      [
        "fullscreen",
        document.fullscreenElement ? "Avsluta helskärm" : "Helskärm",
        "expand",
      ],
    ],
    event,
  );
}
function showContextMenu(title, items, event) {
  const menu = $("#object-menu");
  menu.setAttribute(
    "aria-label",
    title === "Modellvy" ? "Modellvy" : "Markerade objekt",
  );
  menu.innerHTML =
    `<div class="object-menu-title">${title}</div>` +
    items
      .map(
        ([action, label, glyph, disabled]) =>
          `<button role="menuitem" data-action="${action}" ${disabled ? "disabled" : ""}>${icon(glyph)}${label}</button>`,
      )
      .join("");
  menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8))}px`;
  menu.querySelector("button:not(:disabled)").focus({ preventScroll: true });
}
$("#empty").addEventListener("contextmenu", (event) => {
  if (event.target.closest("button")) return;
  event.preventDefault();
  openBackgroundMenu(event);
});
$("#object-menu").addEventListener("contextmenu", (event) =>
  event.preventDefault(),
);
$("#object-menu").addEventListener("keydown", (event) => {
  const buttons = [
    ...event.currentTarget.querySelectorAll("button:not(:disabled)"),
  ];
  if (event.key === "Escape") {
    event.stopPropagation();
    closeObjectMenu();
    viewer.renderer.domElement.focus({ preventScroll: true });
  } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement);
    buttons[
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length
    ].focus();
  } else if (event.key === "Tab") closeObjectMenu();
});
document.addEventListener(
  "pointerdown",
  (event) => {
    if (!event.target.closest("#object-menu")) closeObjectMenu();
  },
  true,
);
window.addEventListener("resize", closeObjectMenu);
function selectObjects(objects, additive = false) {
  state.selectedBranches.clear();
  if (!additive) state.selected.clear();
  objects.forEach((object) => state.selected.add(object.key));
  if (state.tab === "properties") selectedObjects().forEach(requestProperties);
  refresh();
  status(
    `${state.selected.size} objekt markerade · Högerklick på markeringen för objektmenyn`,
  );
}
function selectObject(object, additive = false) {
  state.selectedBranches.clear();
  if (!additive) state.selected.clear();
  if (object) {
    if (additive && state.selected.has(object.key))
      state.selected.delete(object.key);
    else state.selected.add(object.key);
    if (state.tab === "properties") requestProperties(object);
    status(`${object.name} · ${object.ifcClass}`);
  } else
    status("Mitten/högerdra: panorera · Shift + dra: orbit · Scrolla: zoom");
  viewer.setSelected(state.selected);
  refresh();
}
let requestId = 0;
function requestProperties(object) {
  if (object.demoProperties || state.props.has(object.key)) return;
  const model = modelFor(object);
  if (!model?.worker) return;
  state.props.set(object.key, { loading: true });
  model.worker.postMessage({
    type: "properties",
    id: object.expressId,
    request: ++requestId,
  });
}
function renderPanel() {
  const panel = $("#panel-content");
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", `tab-${state.tab}`);
  panel.innerHTML =
    state.tab === "models"
      ? modelsPanel()
      : state.tab === "properties"
        ? propertiesPanel()
        : state.tab === "views"
          ? viewsPanel()
          : reviewPanel();
}
function visibilityButton(model, objects, node = null) {
  const visibility = groupVisibility(
    objects,
    model,
    state.hidden,
    state.isolated,
  );
  const name = node ? node.name : model.name;
  const show = visibility !== "all";
  return `<button class="visibility ${visibility === "all" ? "on" : visibility === "mixed" ? "mixed" : ""}" data-action="${node ? "branch-visibility" : "model-visibility"}" data-model="${model.id}" ${node ? `data-node="${esc(node.id)}"` : ""} ${objects.length ? "" : "disabled"} title="${show ? "Visa" : "Dölj"} ${esc(name)}${visibility === "mixed" ? " · delvis synlig" : ""}" aria-label="${show ? "Visa" : "Dölj"} ${esc(name)}" aria-pressed="${visibility === "all" ? "true" : visibility === "mixed" ? "mixed" : "false"}">${icon(visibility === "all" ? "check" : "minus")}</button>`;
}
function matchesTreeObject(object, node) {
  const nodeQuery = state.query.trim().toLocaleLowerCase("sv");
  return (
    matchesObject(object, state.query, state.type) ||
    (nodeQuery &&
      node.name.toLocaleLowerCase("sv").includes(nodeQuery) &&
      matchesObject(object, "", state.type))
  );
}
function treeSearchCount() {
  const keys = new Set();
  for (const model of state.models)
    for (const node of model.trees[state.grouping].nodes.values()) {
      for (const object of node.members)
        if (matchesTreeObject(object, node)) keys.add(object.key);
    }
  return keys.size;
}
function renderTreeNode(model, node) {
  const match = (object) => matchesTreeObject(object, node);
  const matches = node.members.filter(match);
  if (!matches.length && (node.members.length || state.query || state.type))
    return "";
  const objects = node.objects.filter((o) => match(o));
  const open = state.query || state.type || state.expanded.has(node.id);
  return `<details class="level-tree" data-tree="${esc(node.id)}" ${open ? "open" : ""}><summary class="${state.selectedBranches.has(branchKey(model, node)) ? "selected-branch" : ""}">${icon("folder")}<span class="branch-name" title="${esc(node.name)}${node.type ? ` · ${esc(node.type)}` : ""}">${esc(node.name)}</span>${visibilityButton(model, node.members, node)}<small>${matches.length}</small></summary>${node.children.map((child) => renderTreeNode(model, child)).join("")}${objects.slice(0, state.limit).map(objectRow).join("")}${objects.length > state.limit ? '<button class="text-button" data-action="more-results">Visa fler objekt</button>' : ""}</details>`;
}
function modelsPanel() {
  const types = [...new Set(allObjects().map((o) => o.ifcClass))].sort();
  const queryActive = state.query || state.type;
  return `<div class="panel-heading"><h1>Modeller</h1><div>${small("open", "Lägg till IFC-modell", "plus")}</div></div>
    <div class="search-field">${icon("search")}<input id="object-search" placeholder="Sök objekt, typ eller GUID" aria-label="Sök objekt" value="${esc(state.query)}"/></div>
    <label class="grouping-field">Indelning<select id="tree-grouping" aria-label="Indelning i modellträdet">${[
      ["ifc", "IFC-struktur"],
      ["systems", "System"],
      ["zones", "Zoner"],
      ["types", "Objekttyper"],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}" ${state.grouping === value ? "selected" : ""}>${label}</option>`,
      )
      .join("")}</select></label>
    <select id="type-filter" class="type-filter" aria-label="Filtrera objekttyp"><option value="">Alla objekttyper</option>${types.map((type) => `<option value="${esc(type)}" ${state.type === type ? "selected" : ""}>${esc(type)}</option>`).join("")}</select>
    ${!state.models.length ? '<div class="panel-empty">Inga modeller öppna.<br/>Öppna IFC för att börja granska.</div>' : ""}
    ${
      queryActive
        ? `<div class="results-label">${treeSearchCount().toLocaleString("sv")} träffar</div>`
        : ""
    }
    <div class="model-tree">${state.models.map((model) => `<details data-tree="${model.id}" ${queryActive || state.expanded.has(model.id) ? "open" : ""}><summary class="model-root ${state.selectedBranches.has(branchKey(model)) ? "selected-branch" : ""}">${icon("folder")}<span class="model-filename" title="${esc(model.name)} · ${model.objects.length.toLocaleString("sv")} objekt · ${esc(model.schema)}">${esc(model.name)}</span>${visibilityButton(model, model.objects)}${small("remove-model", `Ta bort ${model.name}`, "close", `data-model="${model.id}"`)}</summary>${model.trees[state.grouping].roots.map((node) => renderTreeNode(model, node)).join("")}${model.groupWarning && ["systems", "zones"].includes(state.grouping) ? `<p class="muted">${esc(model.groupWarning)}</p>` : ""}</details>`).join("")}</div>
    <div class="panel-note">${icon("properties")}<span>${state.models.some((model) => model.demo) ? "Demomodell · genererad geometri för att prova viewern." : "IFC-filer bearbetas och sparas lokalt i denna webbläsare."}</span></div>`;
}
function objectRow(o) {
  const visible =
    modelFor(o).visible &&
    !state.hidden.has(o.key) &&
    (!state.isolated || state.isolated.has(o.key));
  return `<div class="object-row ${state.selected.has(o.key) ? "selected" : ""} ${visible ? "" : "muted-object"}"><button data-action="select-object" data-key="${o.key}" title="${esc(o.name)}">${icon("models")}<span>${esc(o.name)}<small>${esc(o.ifcClass)}</small></span></button>${small("object-visibility", `${visible ? "Dölj" : "Visa"} objekt`, visible ? "eye" : "hide", `data-key="${o.key}"`)}</div>`;
}
const propRows = (rows) =>
  `<dl class="property-rows">${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd title="${esc(value)}">${esc(value)}</dd></div>`).join("")}</dl>`;
function propertiesPanel() {
  const objects = selectedObjects();
  if (!objects.length)
    return `<div class="panel-heading"><h1>Egenskaper</h1></div><div class="panel-empty">${icon("cursor")}<strong>Välj ett objekt</strong><p>Klicka i modellen eller välj ett objekt i modellträdet för att se IFC-data.</p></div>`;
  if (objects.length > 1) {
    const bounds = new THREE.Box3();
    objects.forEach((o) => bounds.union(o.bounds));
    const size = bounds.getSize(new THREE.Vector3());
    return `<div class="panel-heading"><h1>Egenskaper</h1><span class="count-badge">${objects.length}</span></div><h2>${objects.length} objekt valda</h2>${propRows(
      [
        ["Modeller", new Set(objects.map((o) => o.modelId)).size],
        ["Bredd", `${format(size.x)} m`],
        ["Höjd", `${format(size.y)} m`],
        ["Djup", `${format(size.z)} m`],
      ],
    )}<div class="panel-actions"><button class="compact" data-action="isolate">${icon("isolate")} Isolera</button><button class="compact" data-action="focus-selection">${icon("fit")} Fokusera</button></div>${objects.slice(0, 100).map(objectRow).join("")}`;
  }
  const o = objects[0],
    model = modelFor(o),
    props = state.props.get(o.key);
  const size = o.bounds.getSize(new THREE.Vector3());
  let sets = "";
  if (o.demoProperties)
    sets = `<details class="property-set" open><summary>Objektdata</summary>${propRows(Object.entries(o.demoProperties))}</details>`;
  else if (props?.loading)
    sets =
      '<p class="muted"><span class="spinner small-spinner"></span> Läser IFC-egenskaper…</p>';
  else if (props?.error)
    sets = `<p class="error-text">${esc(props.error)}</p><button class="compact" data-action="retry-properties" data-key="${o.key}">Försök igen</button>`;
  else if (props) {
    const base = flattenProperties(props.line).filter(
      ([key]) => !["Name", "GlobalId"].includes(key),
    );
    sets = `<details class="property-set"><summary>IFC-attribut</summary>${propRows(base)}</details>`;
    for (const set of props.sets || [])
      sets += `<details class="property-set" open><summary>${esc(set.Name?.value || "Property set")}</summary>${propRows(propertySetRows(set.HasProperties || set.Quantities || []))}</details>`;
    if (props.materials?.length)
      sets += `<details class="property-set"><summary>Material</summary>${props.materials.map((m) => propRows(flattenProperties(m))).join("")}</details>`;
    if (props.types?.length)
      sets += `<details class="property-set"><summary>Typdefinition</summary>${props.types.map((t) => propRows(flattenProperties(t))).join("")}</details>`;
    if (props.warnings?.length)
      sets += `<p class="muted">${props.warnings.map(esc).join(" ")}</p>`;
  }
  return `<div class="panel-heading"><h1>Egenskaper</h1>${small("clear-selection", "Avmarkera", "close")}</div><div class="selected-card"><span class="eyebrow">${esc(o.ifcClass)}</span><h2>${esc(o.name)}</h2>${propRows(
    [
      ["Modell", model.name],
      ["Våning", o.level],
      ["GlobalId", o.globalId || "—"],
      ["Express ID", o.expressId],
    ],
  )}</div><div class="panel-actions"><button class="compact" data-action="focus-selection">${icon("fit")} Fokusera</button><button class="compact" data-action="isolate">${icon("isolate")} Isolera</button></div>${sets}<details class="property-set"><summary>Geometrins utbredning</summary>${propRows(
    [
      ["X", `${format(size.x)} m`],
      ["Y · höjd", `${format(size.y)} m`],
      ["Z", `${format(size.z)} m`],
    ],
  )}</details>${model.demo ? '<p class="panel-note">Demodata – dessa egenskaper illustrerar gränssnittet.</p>' : ""}`;
}
function viewsPanel() {
  return `<div class="panel-heading"><h1>Sparade vyer</h1>${small("save-view", "Spara aktuell vy", "plus")}</div><p class="panel-intro">Återvänd till samma kamera, synlighet och snitt.</p>${!state.views.length ? '<div class="panel-empty">Inga sparade vyer ännu.<br/>Ställ in modellen och välj Spara vy.</div>' : state.views.map((view) => `<article class="saved-view"><button class="view-preview" data-action="restore-view" data-view="${view.id}" ${canRestoreView(view, state.models) ? "" : "disabled"}>${view.image ? `<img src="${view.image}" alt="${esc(view.name)}"/>` : icon("camera")}</button><div><button class="view-title" data-action="restore-view" data-view="${view.id}">${esc(view.name)}</button><span>${canRestoreView(view, state.models) ? `${view.modelIds.length} modeller · ${new Date(view.date).toLocaleDateString("sv")}` : "Öppna vyns modeller för att återställa"}</span>${small("delete-view", "Ta bort vy", "trash", `data-view="${view.id}"`)}</div></article>`).join("")}<div class="panel-note">${icon("save")}<span>Vyer och modeller sparas i den här webbläsaren.</span></div>`;
}
function reviewPanel() {
  const s = viewer.section;
  return `<div class="panel-heading"><h1>Granska</h1></div><h2 class="section-heading">Snitt</h2><div class="segmented">${[
    ["none", "Av"],
    ["plane", "Plan"],
    ["box", "Box"],
  ]
    .map(
      ([mode, label]) =>
        `<button data-action="clip-${mode}" aria-pressed="${s.mode === mode}">${label}</button>`,
    )
    .join("")}</div>
    ${s.mode === "plane" ? `<label class="field-label">Riktning<select id="clip-axis"><option value="x" ${s.axis === "x" ? "selected" : ""}>X – sida</option><option value="y" ${s.axis === "y" ? "selected" : ""}>Y – höjd</option><option value="z" ${s.axis === "z" ? "selected" : ""}>Z – djup</option></select></label><label class="field-label">Snittläge <output>${s.position}%</output><input id="clip-position" type="range" min="0" max="100" value="${s.position}"/></label><label class="checkbox-label"><input id="clip-invert" type="checkbox" ${s.invert ? "checked" : ""}/> Vänd snittriktning</label>` : ""}
    ${s.mode === "box" ? ["X", "Y · höjd", "Z"].map((axis, i) => `<div class="box-range"><strong>${axis}</strong>${["Min", "Max"].map((label, j) => `<label>${label}<input type="range" data-box-index="${i * 2 + j}" min="0" max="100" value="${s.box[i * 2 + j]}" aria-label="${axis} ${label}"/><output>${s.box[i * 2 + j]}%</output></label>`).join("")}</div>`).join("") : ""}
    <p class="muted">Snitt påverkar bara visningen. Modellens geometri ändras inte.</p><h2 class="section-heading">Mät avstånd</h2><button class="wide-button ${viewer.tool === "measure" ? "active" : ""}" data-action="measure">${icon("ruler")} ${viewer.tool === "measure" ? "Avsluta mätning" : "Starta mätning"}</button><p class="muted">Välj två punkter på modellen. Snap till triangelhörn inom 12 skärmpixlar.</p>${viewer.measurements.map((m, i) => `<div class="measurement-result"><span>Mått ${i + 1}</span><strong>${format(m.distance)} m</strong><small>ΔX ${format(m.end.x - m.start.x)} · ΔY ${format(m.end.y - m.start.y)} · ΔZ ${format(m.end.z - m.start.z)}</small></div>`).join("")}${viewer.measurements.length ? '<button class="text-button" data-action="clear-measures">Rensa alla mått</button>' : ""}`;
}

function toolState() {
  for (const [action, active] of [
    ["measure", viewer.tool === "measure"],
    ["section", viewer.section.mode === "plane"],
    ["section-box", viewer.section.mode === "box"],
  ])
    document
      .querySelectorAll(`[data-action="${action}"]`)
      .forEach((b) => b.setAttribute("aria-pressed", active));
  const hud = $("#tool-hud");
  hud.hidden = viewer.tool !== "measure" && viewer.section.mode === "none";
  hud.innerHTML =
    viewer.tool === "measure"
      ? `${icon("ruler")}<span>Välj två punkter på modellen</span>${small("clear-measures", "Rensa mått", "trash")}${small("exit-tool", "Avsluta mätning", "close")}`
      : `${icon("cut")}<span>${viewer.section.mode === "plane" ? "Snittplan aktivt" : "Snittbox aktiv"}</span><button class="compact" data-tab="review">Justera</button>${small("clip-none", "Stäng snitt", "close")}`;
}
function setClip(mode) {
  viewer.setSection({ ...viewer.section, mode });
  if (mode !== "none") setTab("review");
  toolState();
  renderPanel();
}
async function removeModel(model, save = true) {
  model.worker?.terminate();
  viewer.removeModel(model);
  state.models = state.models.filter((m) => m !== model);
  for (const [key, branch] of state.selectedBranches)
    if (branch.model === model) state.selectedBranches.delete(key);
  for (const o of model.objects) {
    state.selected.delete(o.key);
    state.hidden.delete(o.key);
    state.props.delete(o.key);
  }
  if (!state.models.length) {
    state.origin = null;
    state.isolated = null;
    viewer.setSection({ ...viewer.section, mode: "none" });
  }
  if (!model.demo && save)
    try {
      await deleteFile(model.id);
    } catch {
      notify("Kunde inte radera den lokala filkopian.");
    }
  if (save) persist();
  refresh();
  toolState();
}
async function showDemo() {
  if (state.loading) return;
  for (const model of [...state.models]) await removeModel(model);
  state.origin = null;
  state.hidden.clear();
  state.isolated = null;
  state.selected.clear();
  createDemoModels().forEach(registerModel);
  const beam = allObjects().find((o) => o.name === "Balk K-204");
  if (beam) state.selected.add(beam.key);
  viewer.standardView("iso");
  setTab("models");
  refresh();
  persist();
  status("Demomodell · Öppna IFC för att granska dina egna modeller");
}
async function importRecord(record, persistFile = true) {
  $("#loading").hidden = false;
  $("#loading-name").textContent = record.name;
  $("#loading-status").textContent = "Läser IFC och bygger geometri…";
  if (state.models.some((m) => m.demo))
    for (const model of [...state.models]) await removeModel(model, false);
  if (persistFile)
    try {
      await storeFile(record);
    } catch {
      notify("Modellen öppnas, men kunde inte sparas lokalt.");
    }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./ifc.worker.js", import.meta.url), {
      type: "module",
    });
    const model = {
      id: record.id,
      name: record.name,
      visible: true,
      parts: [],
      worker,
      color: ["#769faf", "#b79c77", "#9aa88d"][state.models.length % 3],
    };
    worker.onmessage = async ({ data }) => {
      if (data.type === "progress")
        $("#loading-status").textContent = data.label;
      if (data.type === "geometry") model.parts.push(...data.parts);
      if (data.type === "origin") state.origin ||= data.origin;
      if (data.type === "done") {
        try {
          model.objects = data.objects;
          model.schema = data.schema;
          model.spatial = data.spatial;
          model.groups = data.groups;
          model.groupWarning = data.groupWarning;
          model.origin = data.origin;
          state.origin ||= data.origin;
          registerModel(model);
          refresh();
          viewer.fit();
          persist();
          status(
            `${record.name} · ${model.objects.length.toLocaleString("sv")} objekt · ${model.schema}`,
          );
          resolve();
        } catch (error) {
          worker.terminate();
          reject(error);
        }
      }
      if (data.type === "properties") {
        state.props.set(objectKey(model.id, data.id), data);
        if (state.tab === "properties") renderPanel();
      }
      if (data.type === "error") {
        if (data.request) {
          const object = model.objectMap.get(data.id);
          if (object) state.props.set(object.key, { error: data.message });
          renderPanel();
        } else {
          worker.terminate();
          if (!state.models.length) state.origin = null;
          if (persistFile)
            try {
              await deleteFile(record.id);
            } catch {}
          reject(new Error(data.message));
        }
      }
    };
    worker.onerror = (error) => {
      worker.terminate();
      reject(new Error(error.message || "IFC-importen avbröts."));
    };
    worker.postMessage(
      { type: "open", buffer: record.buffer, origin: state.origin },
      [record.buffer],
    );
  });
}
async function importFiles(files) {
  if (state.loading) {
    notify("Vänta tills den pågående importen är klar.");
    return;
  }
  const valid = [...files].filter((f) => /\.ifc$/i.test(f.name));
  if (!valid.length) {
    notify("Välj en fil med ändelsen .ifc.");
    return;
  }
  state.loading = true;
  for (const file of valid) {
    try {
      await importRecord({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        buffer: await file.arrayBuffer(),
      });
    } catch (error) {
      notify(`${file.name}: ${error.message}`);
    }
  }
  state.loading = false;
  $("#loading").hidden = true;
  setTab("models");
  refresh();
  persist();
}

const actions = {
  open: () => $("#file-input").click(),
  demo: showDemo,
  fit: () => viewer.fit(),
  "zoom-in": () => viewer.zoom(1.2),
  "zoom-out": () => viewer.zoom(1 / 1.2),
  info: () => {
    setTab("properties");
  },
  "focus-selection": () => {
    const bounds = new THREE.Box3();
    selectedObjects().forEach((o) => bounds.union(o.bounds));
    viewer.fit(bounds);
  },
  "clear-selection": () => selectObject(null),
  isolate: () => {
    if (state.selected.size) {
      state.isolated = new Set(state.selected);
      $("#level-filter").value = "";
      refresh();
      viewer.fit();
      status("Markeringen isolerad · Visa alla återställer modellen");
    }
  },
  "show-selection": () => {
    selectedObjects().forEach((object) => {
      const model = modelFor(object);
      // Turning on a hidden model must not reveal its other hidden branches.
      if (!model.visible) {
        model.objects.forEach((member) => state.hidden.add(member.key));
        model.visible = true;
      }
      state.hidden.delete(object.key);
      state.isolated?.add(object.key);
    });
    $("#level-filter").value = "";
    refresh();
    status("Markeringen visas");
  },
  "isolate-branch": () => {
    // A branch may contain previously hidden objects or belong to a hidden model.
    selectedObjects().forEach((object) => {
      state.hidden.delete(object.key);
      modelFor(object).visible = true;
    });
    actions.isolate();
  },
  hide: () => {
    state.selected.forEach((key) => state.hidden.add(key));
    state.selected.clear();
    state.selectedBranches.clear();
    refresh();
    status("Markeringen dold");
  },
  "show-all": () => {
    state.hidden.clear();
    state.isolated = null;
    state.models.forEach((m) => {
      m.visible = true;
    });
    $("#level-filter").value = "";
    refresh();
    status("Alla objekt visas");
  },
  "model-visibility": (b) => {
    const focused = document.activeElement === b;
    const m = state.models.find((m) => m.id === b.dataset.model);
    if (groupVisibility(m.objects, m, state.hidden, state.isolated) === "all")
      m.visible = false;
    else toggleGroupVisibility(m.objects, m, state.hidden, state.isolated);
    refresh();
    if (focused)
      document
        .querySelector(
          `[data-action="model-visibility"][data-model="${CSS.escape(m.id)}"]`,
        )
        ?.focus();
  },
  "branch-visibility": (b) => {
    const focused = document.activeElement === b;
    const model = state.models.find((model) => model.id === b.dataset.model);
    const node = model.trees[state.grouping].nodes.get(b.dataset.node);
    toggleGroupVisibility(node.members, model, state.hidden, state.isolated);
    $("#level-filter").value = "";
    refresh();
    if (focused)
      document
        .querySelector(
          `[data-action="branch-visibility"][data-node="${CSS.escape(node.id)}"]`,
        )
        ?.focus();
  },
  "remove-model": (b) =>
    removeModel(state.models.find((m) => m.id === b.dataset.model)),
  "select-object": (b, e) =>
    selectObject(
      allObjects().find((o) => o.key === b.dataset.key),
      e.shiftKey || e.metaKey || e.ctrlKey,
    ),
  "object-visibility": (b) => {
    const object = allObjects().find((o) => o.key === b.dataset.key),
      model = modelFor(object);
    const visible =
      model.visible &&
      !state.hidden.has(object.key) &&
      (!state.isolated || state.isolated.has(object.key));
    if (visible) state.hidden.add(object.key);
    else {
      model.visible = true;
      state.hidden.delete(object.key);
      state.isolated?.add(object.key);
    }
    refresh();
  },
  "retry-properties": (b) => {
    state.props.delete(b.dataset.key);
    requestProperties(allObjects().find((o) => o.key === b.dataset.key));
    renderPanel();
  },
  "more-results": () => {
    state.limit += 150;
    renderPanel();
  },
  measure: () => {
    viewer.setTool(viewer.tool === "measure" ? "select" : "measure");
    if (viewer.tool === "measure") {
      setTab("review");
      status("Välj första punkten på modellen");
    }
    toolState();
    renderPanel();
  },
  "exit-tool": () => {
    viewer.setTool("select");
    toolState();
    renderPanel();
    status("Mätning avslutad");
  },
  "clear-measures": () => {
    viewer.clearMeasurements();
    renderPanel();
    status("Måtten rensade");
  },
  section: () => setClip(viewer.section.mode === "plane" ? "none" : "plane"),
  "section-box": () => setClip(viewer.section.mode === "box" ? "none" : "box"),
  "clip-none": () => setClip("none"),
  "clip-plane": () => setClip("plane"),
  "clip-box": () => setClip("box"),
  edges: (b) => {
    viewer.setEdges(!viewer.edgesEnabled);
    b.setAttribute("aria-pressed", viewer.edgesEnabled);
  },
  grid: (b) => {
    viewer.grid.visible = !viewer.grid.visible;
    b.setAttribute("aria-pressed", viewer.grid.visible);
    viewer.invalidate();
  },
  "save-view": () => {
    if (!state.models.length) return;
    $("#view-name").value = `Vy ${state.views.length + 1}`;
    $("#view-dialog").showModal();
    $("#view-name").select();
  },
  "restore-view": (b) => {
    const view = state.views.find((v) => v.id === b.dataset.view);
    if (!canRestoreView(view, state.models)) {
      notify(
        "Vyns ursprungliga modeller saknas. Öppna dem innan du återställer vyn.",
      );
      return;
    }
    state.models.forEach((m) => {
      m.visible = view.visibility[m.id] ?? false;
    });
    state.hidden = new Set(view.hidden);
    state.isolated = view.isolated ? new Set(view.isolated) : null;
    viewer.setSection(view.section);
    viewer.restoreCamera(view.camera);
    $("#projection").value = view.camera.projection;
    refresh();
    toolState();
    status(`Vy återställd: ${view.name}`);
  },
  "delete-view": (b) => {
    state.views = state.views.filter((v) => v.id !== b.dataset.view);
    persist();
    renderPanel();
  },
  screenshot: () => {
    const a = document.createElement("a");
    a.download = `lira-ifc-${new Date().toISOString().slice(0, 10)}.png`;
    a.href = viewer.screenshot();
    a.click();
    status("Skärmbild sparad");
  },
  help: () => $("#help-dialog").showModal(),
  settings: () => {
    $("#navigation-device").value = inputDevice();
    $("#navigation-zoom-speed").value = zoomSpeed() * 100;
    $("#navigation-zoom-value").textContent = `${zoomSpeed() * 100} %`;
    $("#navigation-zoom-inverted").checked = zoomInverted();
    $("#navigation-orbit-damping").checked = orbitDamping();
    $("#settings-dialog").showModal();
  },
  "reset-zoom-speed": () => {
    setZoomSpeed(1);
    viewer.controls.zoomSpeed = 1;
    $("#navigation-zoom-speed").value = 100;
    $("#navigation-zoom-value").textContent = "100 %";
  },
  "close-dialog": () =>
    document.querySelectorAll("dialog[open]").forEach((d) => d.close()),
  "toggle-panel": () => {
    $(".workbench").classList.toggle("panel-collapsed");
  },
  fullscreen: () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else
      $("#app")
        .requestFullscreen()
        .catch(() => notify("Helskärm stöds inte i den här webbläsaren."));
  },
};
$("#panel-content").addEventListener("contextmenu", (event) => {
  const row = event.target.closest(".object-row");
  const key = row?.querySelector('[data-action="select-object"]')?.dataset.key;
  if (key) {
    const object = allObjects().find((object) => object.key === key);
    if (!object) return;
    event.preventDefault();
    openObjectMenu(object, event);
    return;
  }
  const summary = event.target.closest(".model-tree summary");
  const branch = branchFromSummary(summary);
  if (!branch) return;
  event.preventDefault();
  openObjectMenu(null, event, branch);
});
$("#panel-content").addEventListener("click", (event) => {
  const summary = event.target.closest(".model-tree summary");
  if (!summary || event.target.closest("button")) return;
  // Leave the disclosure arrow available for expanding and collapsing the tree.
  if (!event.shiftKey && !event.target.closest(".branch-name, .model-filename"))
    return;
  const branch = branchFromSummary(summary);
  if (!branch) return;
  event.preventDefault();
  selectBranch(branch, event.shiftKey);
});
document.addEventListener("click", (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) setTab(tab.dataset.tab);
  const b = e.target.closest("[data-action]");
  if (!b || b.disabled) return;
  if (b.closest("summary")) e.preventDefault();
  const action = b.dataset.action;
  if (b.closest("#object-menu")) closeObjectMenu();
  if (action.startsWith("view-")) viewer.standardView(action.slice(5));
  else actions[action]?.(b, e);
});
document.addEventListener(
  "toggle",
  (e) => {
    const key = e.target.dataset?.tree;
    if (key && !state.query && !state.type)
      e.target.open ? state.expanded.add(key) : state.expanded.delete(key);
  },
  true,
);
$(".inspector-tabs").addEventListener("keydown", (e) => {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  const tabs = [...document.querySelectorAll(".inspector-tab")],
    index = tabs.indexOf(document.activeElement);
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? tabs.length - 1
        : (index + (e.key === "ArrowDown" ? 1 : -1) + tabs.length) %
          tabs.length;
  setTab(tabs[next].dataset.tab);
  tabs[next].focus();
});
$("#file-input").addEventListener("change", (e) => {
  importFiles(e.target.files);
  e.target.value = "";
});
document.addEventListener("input", (e) => {
  if (e.target.id === "navigation-zoom-speed") {
    setZoomSpeed(Number(e.target.value) / 100);
    viewer.controls.zoomSpeed = zoomSpeed();
    $("#navigation-zoom-value").textContent = `${zoomSpeed() * 100} %`;
  }
  if (e.target.id === "object-search") {
    const pos = e.target.selectionStart;
    state.query = e.target.value;
    state.limit = 150;
    renderPanel();
    $("#object-search").focus();
    $("#object-search").setSelectionRange(pos, pos);
  }
  if (e.target.id === "clip-position") {
    viewer.setSection({ ...viewer.section, position: Number(e.target.value) });
    e.target.previousElementSibling.value = `${e.target.value}%`;
  }
  if (e.target.dataset.boxIndex != null) {
    const index = Number(e.target.dataset.boxIndex),
      box = [...viewer.section.box];
    box[index] = Number(e.target.value);
    if (index % 2 === 0) box[index] = Math.min(box[index], box[index + 1]);
    else box[index] = Math.max(box[index], box[index - 1]);
    e.target.value = box[index];
    e.target.nextElementSibling.value = `${box[index]}%`;
    viewer.setSection({ ...viewer.section, box });
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "navigation-zoom-inverted")
    setZoomInverted(e.target.checked);
  if (e.target.id === "navigation-orbit-damping") {
    setOrbitDamping(e.target.checked);
    viewer.inputNavigation.cancel();
    viewer.controls.enableDamping = orbitDamping();
    viewer.invalidate();
  }
  if (e.target.id === "navigation-device") {
    setInputDevice(e.target.value);
    status(
      e.target.value === "trackpad"
        ? "Styrplatta: tvåfingerscroll panorerar · nyp zoomar"
        : "Mus: mitten/högerdrag panorerar · Shift + dra roterar · scroll zoomar",
    );
  }
  if (e.target.id === "tree-grouping") {
    state.selectedBranches.clear();
    state.grouping = e.target.value;
    state.limit = 150;
    renderPanel();
    persist();
    $("#tree-grouping").focus();
  }
  if (e.target.id === "projection") viewer.setProjection(e.target.value);
  if (e.target.id === "color-mode") viewer.setColorMode(e.target.value);
  if (e.target.id === "type-filter") {
    state.type = e.target.value;
    state.limit = 150;
    renderPanel();
  }
  if (e.target.id === "clip-axis")
    viewer.setSection({ ...viewer.section, axis: e.target.value });
  if (e.target.id === "clip-invert")
    viewer.setSection({ ...viewer.section, invert: e.target.checked });
  if (e.target.id === "level-filter") {
    state.isolated = e.target.value
      ? new Set(
          allObjects()
            .filter((o) => o.level === e.target.value)
            .map((o) => o.key),
        )
      : null;
    refresh();
    viewer.fit();
  }
});
$("#view-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const image = document.createElement("canvas");
  image.width = 480;
  image.height = Math.round((480 * viewer.height) / viewer.width);
  image
    .getContext("2d")
    .drawImage(viewer.renderer.domElement, 0, 0, image.width, image.height);
  state.views.unshift({
    ...viewSnapshot(
      state.models,
      state.hidden,
      state.isolated,
      viewer.cameraSnapshot(),
      viewer.section,
    ),
    id: crypto.randomUUID(),
    name: $("#view-name").value.trim() || "Namnlös vy",
    date: Date.now(),
    image: image.toDataURL("image/jpeg", 0.65),
  });
  persist();
  $("#view-dialog").close();
  setTab("views");
  status("Vyn sparad lokalt");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeObjectMenu();
    viewer.setTool("select");
    toolState();
    renderPanel();

    return;
  }
  if (
    e.target.closest("input,select,textarea,dialog") ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey
  )
    return;
  const map = { f: "fit", m: "measure", h: "hide", a: "show-all" };
  if (map[e.key.toLowerCase()]) {
    e.preventDefault();
    actions[map[e.key.toLowerCase()]]();
  }
});
let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  if (e.dataTransfer.types.includes("Files")) {
    e.preventDefault();
    dragDepth++;
    $("#drop-zone").hidden = false;
  }
});
document.addEventListener("dragover", (e) => {
  e.preventDefault();
});
document.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $("#drop-zone").hidden = true;
  }
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("#drop-zone").hidden = true;
  importFiles(e.dataTransfer.files);
});

async function start() {
  let files = [];
  try {
    files = await storedFiles();
  } catch {
    notify(
      "Lokal fillagring är inte tillgänglig. Du kan fortfarande öppna IFC-filer.",
    );
  }
  if (files.length) {
    state.loading = true;
    for (const file of files)
      try {
        await importRecord(file, false);
      } catch (error) {
        notify(`${file.name}: ${error.message}`);
      }
    state.loading = false;
    $("#loading").hidden = true;
  } else if (!settings.initialized || settings.demo) await showDemo();
  restoreUpdateView();
  refresh();
  status(
    state.models.some((m) => m.demo)
      ? "Demomodell · Öppna IFC för dina egna modeller"
      : "Mitten/högerdra: panorera · Shift + dra: orbit · Scrolla: zoom",
  );
}
const updateSnapshotKey = "lira-ifc-update-view";
function restoreUpdateView() {
  try {
    const saved = sessionStorage.getItem(updateSnapshotKey);
    sessionStorage.removeItem(updateSnapshotKey);
    if (!saved) return;
    const view = JSON.parse(saved);
    if (!canRestoreView(view, state.models)) return;
    state.models.forEach((model) => {
      model.visible = view.visibility[model.id] ?? false;
    });
    state.hidden = new Set(view.hidden);
    state.isolated = view.isolated ? new Set(view.isolated) : null;
    const keys = new Set(allObjects().map((object) => object.key));
    state.selected = new Set(view.selected.filter((key) => keys.has(key)));
    for (const { modelId, nodeId } of view.branches || []) {
      const model = state.models.find((model) => model.id === modelId);
      const node = nodeId
        ? model?.trees[state.grouping].nodes.get(nodeId)
        : null;
      if (model && (!nodeId || node))
        state.selectedBranches.set(branchKey(model, node), { model, node });
    }
    state.expanded = new Set(view.expanded || []);
    state.query = view.query || "";
    state.type = view.type || "";
    viewer.setSection(view.section);
    viewer.restoreCamera(view.camera);
    viewer.setColorMode(view.colorMode);
    viewer.setEdges(view.edges);
    viewer.grid.visible = view.grid;
    $("#projection").value = view.camera.projection;
    $("#color-mode").value = view.colorMode;
    document
      .querySelector('[data-action="edges"]')
      .setAttribute("aria-pressed", view.edges);
    document
      .querySelector('[data-action="grid"]')
      .setAttribute("aria-pressed", view.grid);
    setTab(view.tab);
    toolState();
  } catch {
    notify("Aktuell vy kunde inte återställas efter uppdateringen.");
  }
  const url = new URL(location.href);
  if (url.searchParams.has("lira-update")) {
    url.searchParams.delete("lira-update");
    history.replaceState(null, "", url.href);
  }
}
watchAppUpdate({
  button: $("#app-update"),
  currentVersion: __APP_VERSION__,
  baseUrl: import.meta.env.BASE_URL,
  status: notify,
  beforeUpdate: async () => {
    if (state.loading)
      return "Vänta tills IFC-modellerna har lästs klart innan du uppdaterar.";
    persist();
    sessionStorage.setItem(
      updateSnapshotKey,
      JSON.stringify({
        ...viewSnapshot(
          state.models,
          state.hidden,
          state.isolated,
          viewer.cameraSnapshot(),
          viewer.section,
        ),
        selected: [...state.selected],
        branches: [...state.selectedBranches.values()].map(
          ({ model, node }) => ({
            modelId: model.id,
            nodeId: node?.id || null,
          }),
        ),
        expanded: [...state.expanded],
        query: state.query,
        type: state.type,
        tab: state.tab,
        colorMode: $("#color-mode").value,
        edges: viewer.edgesEnabled,
        grid: viewer.grid.visible,
      }),
    );
  },
});
start();
