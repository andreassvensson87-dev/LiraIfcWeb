import { captureDroppedFiles } from "./dropped-files.js";
import {
  SourceMonitor,
  createSourceLink,
  createFileSource,
  sourceAccessHandle,
  fileStamp,
  sourceFile,
} from "./source-monitor.js";
import * as THREE from "three";
import "./style.css";
import { processProject } from "./project-io.js";
import { watchAppUpdate } from "./app-update.js";
import { registerFileHandling } from "./file-handling.js";
import { buildCadModel, initialCadOrigin } from "./cad-model.js";
import { dxfUnits, cadImportUnit } from "./cad-units.js";
import { chooseCadUnit } from "./cad-unit-dialog.js";
import { icon } from "./icons.js";
import { geometryNames } from "./measurement-tool.js";
import { snapNames } from "./snap-resolver.js";
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
  storedFile,
  storeSource,
  storeFile,
  storePlacement,
  deleteFile,
  clearStoredFiles,
  replaceStoredFiles,
  readSettings,
  saveSettings,
} from "./storage.js";

const $ = (s) => document.querySelector(s);
const settings = readSettings();
const state = {
  projectName: settings.projectName || "LiraIFC-projekt",
  models: [],
  selected: new Set(),
  selectedBranches: new Map(),
  placementHistory: [],
  showMoveUndo: false,
  undoBusy: false,
  undoTask: Promise.resolve(),
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
    <div class="header-right"><button class="header-new-project" data-action="new-project" title="Börja med ett tomt projekt">${icon("plus")} Nytt projekt</button><button id="app-update" class="lira-update" title="Kontrollera om det finns en ny version av LiraIFC">Sök uppdatering</button><span class="local-status"><i></i> Lokalt på din enhet</span>${small("settings", "Inställningar", "settings", 'aria-haspopup="dialog" aria-controls="settings-dialog"')}${small("help", "Hjälp och kortkommandon", "help")}<button class="primary header-open" data-action="open">${icon("folder")} Öppna modell</button></div>
  </header>
  <nav class="ribbon" aria-label="Modellverktyg">
    <div class="ribbon-group project-commands"><div class="commands">${command("open-project", "Öppna projekt", "folder")}${command("save-project", "Spara projekt", "save")}</div><span class="group-label">Projekt</span></div>
    <div class="ribbon-group"><div class="commands">${command("open", "Öppna modell", "folder")}${command("demo", "Demomodell", "models")}</div><span class="group-label">Modell</span></div>
    <div class="ribbon-group"><div class="commands">${command("isolate", "Isolera", "isolate", "data-selection")}${command("hide", "Dölj", "hide", "data-selection")}${command("show-all", "Visa alla", "eye")}</div><span class="group-label">Urval</span></div>
    <div class="ribbon-group"><div class="commands">${command("measure", "Mät", "ruler", 'aria-pressed="false"')}${command("section", "Snitt", "cut", 'aria-pressed="false"')}${command("section-box", "Snittbox", "box", 'aria-pressed="false"')}</div><span class="group-label">Granska</span></div>
    <div class="ribbon-group"><div class="commands">${command("edges", "Kantlinjer", "models", 'aria-pressed="false"')}<div class="command-stack"><label class="ribbon-select">Färgsättning<select id="color-mode" aria-label="Färgsättning"><option value="original">Original</option><option value="discipline">Disciplin</option><option value="type">Objekttyp</option></select></label><button class="compact" data-action="grid" aria-pressed="true">${icon("grid")} Rutnät</button></div></div><span class="group-label">Utseende</span></div>
    <div class="ribbon-group"><div class="commands">${command("save-view", "Spara vy", "save")}${command("screenshot", "Skärmbild", "camera")}${command("fit", "Passa vy", "fit")}</div><span class="group-label">Vyer</span></div>
  </nav>
  <main class="workbench">
    <section id="viewport" aria-label="Modellvy">
      <div id="object-menu" class="object-menu" role="menu" aria-label="Markerade objekt" hidden></div>
      <div id="empty" class="empty-state" hidden>${icon("models")}<h1>Hela modellen. Alla detaljer.</h1><p>Öppna IFC, DXF eller DWG eller släpp filer här<br/>för att granska dem tillsammans.</p><button class="primary" data-action="open">${icon("folder")} Öppna modell</button><button class="text-button" data-action="demo">Prova demomodellen</button><small>Filerna stannar på din enhet.</small></div>
      <div id="drop-zone" class="drop-zone" hidden>${icon("folder")}<strong>Släpp IFC, DXF eller DWG här</strong><span>Modeller och ritningsreferenser tillsammans</span></div>
      <div id="loading" class="loading-card" role="status" hidden><span class="spinner"></span><div><strong id="loading-name"></strong><span id="loading-status">Läser modell…</span></div></div>
      <div id="tool-hud" class="tool-hud" hidden></div>
    </section>
    <aside class="inspector" aria-label="Högerinspektor">
      <div class="inspector-content"><div id="panel-content"></div></div>
      <div class="inspector-rail"><button class="inspector-collapse icon-button" data-action="toggle-panel" aria-label="Fäll ihop inspektorn" title="Fäll ihop inspektorn" aria-expanded="true" aria-controls="panel-content">${icon("chevron")}</button><div class="inspector-tabs" role="tablist" aria-label="Inspektorpaneler" aria-orientation="vertical">
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
      </div></div>
    </aside>
  </main>
  <footer class="statusbar"><div class="status-counts"><span id="model-count">0 modeller</span><span id="object-count">0 objekt</span><span id="selection-count">Inget valt</span></div><span id="status-message" role="status">Öppnar viewer…</span><div class="view-controls"><select id="projection" aria-label="Projektion"><option value="perspective">Perspektiv</option><option value="orthographic">Ortografisk</option></select><select id="level-filter" aria-label="Våning"><option value="">Alla våningar</option></select><button class="compact" data-action="fit">${icon("fit")} Passa vy</button><span class="unit-label">m</span></div></footer>
  <input id="project-input" type="file" accept=".liraifc" hidden />
  <input id="file-input" type="file" accept=".ifc,.dxf,.dwg,.liraifc" multiple hidden />
  <div id="toast" class="toast" role="status" hidden></div>
  <dialog id="help-dialog"><div class="dialog-heading"><h2>LiraIFC</h2>${small("close-dialog", "Stäng", "close")}</div><p>Granska IFC-modeller direkt i webbläsaren. Modeller och sparade vyer lagras lokalt i denna webbläsare.</p><p class="muted">Med styrplatta panorerar tvåfingerscroll och nypning zoomar. Orbit startar runt punkten under pekaren när den träffar modellen.</p><dl class="shortcuts"><dt>Välj objekt</dt><dd>Klicka med vänster musknapp</dd><dt>Orbit</dt><dd>Shift/Ctrl/Cmd + mitten- eller högerdrag</dd><dt>Panorera</dt><dd>Dra med mitten- eller högerknappen</dd><dt>Zooma</dt><dd>Scrolla mot muspekaren eller nyp</dd><dt>Välj flera</dt><dd>Shift/Ctrl/Cmd + klick</dd><dt>Rektangelmarkering</dt><dd>Vänsterdra. Blå ruta väljer helt inneslutna objekt, grön ruta väljer berörda objekt. Shift lägger till; Esc avbryter.</dd><dt>Objektmeny</dt><dd>Högerklick på markeringen</dd><dt>Fokusera objekt</dt><dd>Dubbelklick</dd><dt>Passa vy</dt><dd>F</dd><dt>Mät avstånd</dt><dd>M</dd><dt>Dölj markering</dt><dd>H</dd><dt>Visa alla</dt><dd>A</dd><dt>Avbryt verktyg</dt><dd>Esc</dd></dl><p class="muted">Mått kan visas i meter, centimeter eller millimeter. Snapmarkören visar typen av geometripunkt; Tab växlar mellan alternativ. Snittplan och snittbox visar fyllda, skrafferade snittytor i slutna volymer.</p><button class="primary" data-action="close-dialog">Tillbaka till modellen</button></dialog>
  <dialog id="settings-dialog" aria-labelledby="settings-title"><div class="dialog-heading"><h2 id="settings-title">Inställningar</h2>${small("close-dialog", "Stäng", "close")}</div><fieldset class="navigation-settings"><legend>Navigationsinställningar</legend><label class="field-label">Inmatning<select id="navigation-device"><option value="mouse">Mus</option><option value="trackpad">Styrplatta</option></select></label><label class="field-label" for="navigation-zoom-speed">Zoomhastighet <output id="navigation-zoom-value" for="navigation-zoom-speed">100 %</output><input id="navigation-zoom-speed" aria-label="Zoomhastighet" type="range" min="25" max="400" step="5" value="100"/></label><button class="text-button" data-action="reset-zoom-speed">Återställ zoomhastighet</button><label class="navigation-toggle"><span>Invertera zoomriktning</span><input id="navigation-zoom-inverted" type="checkbox"/></label><label class="navigation-toggle"><span>Dämpad orbit</span><input id="navigation-orbit-damping" type="checkbox" checked/></label><p class="muted">Inställningarna sparas automatiskt. Invertering gäller scrollzoom; nypning behåller sin naturliga riktning.</p></fieldset><button class="primary" data-action="close-dialog">Stäng</button></dialog>
  <dialog id="cad-placement-dialog" aria-labelledby="cad-placement-title"></dialog>
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
    onPointMoveCancel: () => {
      toolState();
      status("Flytt avbruten.");
    },
    onMeasureStart: () => {
      toolState();
      renderPanel();
      status("Välj andra geometrin. Esc avbryter pågående mått.");
    },
    onMeasureChange: () => {
      toolState();
      renderPanel();
    },
    onMeasure: (distance) => {
      status(
        `Avstånd: ${viewer.measureTool.format(distance)}. Välj geometri för nästa mått.`,
      );
      toolState();
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

const sourceMonitor = new SourceMonitor({
  onChange: updateSourceIndicator,
  isBusy: () => state.loading || document.hidden,
});
sourceMonitor.start({ window, document });

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
      projectName: state.projectName,
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
function setPanelCollapsed(collapsed) {
  $(".workbench").classList.toggle("panel-collapsed", collapsed);
  const button = $(".inspector-collapse");
  button.setAttribute("aria-expanded", String(!collapsed));
  button.title = button.ariaLabel = collapsed
    ? "Öppna inspektorn"
    : "Fäll ihop inspektorn";
}
function setTab(tab) {
  state.tab = tab;
  if (tab === "properties") selectedObjects().forEach(requestProperties);
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.setAttribute("aria-selected", active);
    button.tabIndex = active ? 0 : -1;
  });
  setPanelCollapsed(false);
  renderPanel();
}
function registerModel(model) {
  if (!model.cadData)
    model.placement ||= { x: 0, z: 0, elevation: 0, rotation: 0 };
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
  const levels = [
    ...new Set(
      state.models
        .filter((model) => !model.cadData)
        .flatMap((model) => model.objects.map((object) => object.level)),
    ),
  ].sort((a, b) => a.localeCompare(b, "sv", { numeric: true }));
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
      ...(branch && !branch.node
        ? [
            ["cad-placement", "Placering…", "settings", false, branch.model.id],
            ...(!branch.model.demo
              ? [
                  [
                    "link-source-folder",
                    "Koppla originalmapp…",
                    "folder",
                    false,
                    branch.model.id,
                  ],
                  [
                    "refresh-reference",
                    "Uppdatera referens",
                    "refresh",
                    !sourceMonitor.links.has(branch.model.id),
                    branch.model.id,
                  ],
                ]
              : []),
          ]
        : []),
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
        "clear-measures",
        "Rensa mått",
        "ruler",
        !viewer.measurements.length && !viewer.measureTool.first,
      ],
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
        ([action, label, glyph, disabled, modelId]) =>
          `<button role="menuitem" data-action="${action}" ${modelId ? `data-model="${esc(modelId)}"` : ""} ${disabled ? "disabled" : ""}>${icon(glyph)}${label}</button>`,
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
  if (
    object.referenceProperties ||
    object.demoProperties ||
    state.props.has(object.key)
  )
    return;
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
  return `<button class="visibility ${visibility === "all" ? "on" : visibility === "mixed" ? "mixed" : ""}" data-action="${node ? "branch-visibility" : "model-visibility"}" data-model="${model.id}" ${node ? `data-node="${esc(node.id)}"` : ""} ${objects.length ? "" : "disabled"} title="${show ? "Visa" : "Dölj"} ${esc(name)}${visibility === "mixed" ? " · delvis synlig" : ""}" aria-label="${show ? "Visa" : "Dölj"} ${esc(name)}" aria-pressed="${visibility === "all" ? "true" : visibility === "mixed" ? "mixed" : "false"}">${icon(visibility === "all" ? "eye" : visibility === "mixed" ? "eye-partial" : "hide")}</button>`;
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
  return `<div class="panel-heading"><h1>Modeller</h1><div>${small("link-source-folder", "Koppla originalmapp för automatisk kontroll", "folder")}${small("open", "Lägg till IFC-modell", "plus")}</div></div>
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
    ${!state.models.length ? '<div class="panel-empty">Inga modeller öppna.<br/>Öppna modell för att börja granska.</div>' : ""}
    ${
      queryActive
        ? `<div class="results-label">${treeSearchCount().toLocaleString("sv")} träffar</div>`
        : ""
    }
    <div class="model-tree">${state.models.map((model) => `<details data-tree="${model.id}" ${queryActive || state.expanded.has(model.id) ? "open" : ""}><summary class="model-root ${state.selectedBranches.has(branchKey(model)) ? "selected-branch" : ""}">${icon("folder")}<span class="model-filename" title="${esc(model.name)} · ${model.objects.length.toLocaleString("sv")} objekt · ${esc(model.schema)}">${esc(model.name)}</span><span class="source-status" data-source-id="${model.id}">${sourceIndicator(model.id)}</span>${visibilityButton(model, model.objects)}${small("remove-model", `Ta bort ${model.name}`, "close", `data-model="${model.id}"`)}</summary>${model.trees[state.grouping].roots.map((node) => renderTreeNode(model, node)).join("")}${model.groupWarning && ["systems", "zones"].includes(state.grouping) ? `<p class="muted">${esc(model.groupWarning)}</p>` : ""}</details>`).join("")}</div>
    <div class="panel-note">${icon("properties")}<span>${state.models.some((model) => model.demo) ? "Demomodell · genererad geometri för att prova viewern." : "Filer bearbetas och sparas lokalt i denna webbläsare."}</span></div>`;
}
function cadPlacementPanel(model) {
  const p = model.placement;
  const units = dxfUnits.map((unit) => [unit.factor / 1000, unit.name]);
  return `<div class="cad-placement">${model.cadData ? `<label>Enhet<select aria-label="Enhet för ${esc(model.name)}" data-cad-model="${model.id}" data-placement="unitFactor">${units.map(([factor, name]) => `<option value="${factor}" ${p.unitFactor === factor ? "selected" : ""}>${name}</option>`).join("")}</select></label>` : ""}${[
    ["x", "X-förskjutning (m)"],
    ["z", "Z-förskjutning (m)"],
    ["elevation", "Höjd (m)"],
    ["rotation", "Rotation (°)"],
  ]
    .map(
      ([key, label]) =>
        `<label>${label}<input type="number" step="any" aria-label="${label} för ${esc(model.name)}" value="${p[key]}" data-cad-model="${model.id}" data-placement="${key}"/></label>`,
    )
    .join(
      "",
    )}<button class="wide-button" data-action="pick-placement" data-model="${model.id}">${icon("cursor")} Flytta med två punkter</button><button class="compact" data-action="undo-placement" data-model="${model.id}" ${state.placementHistory.some((entry) => entry.model === model) ? "" : "disabled"}>Ångra flytt</button><button class="compact" data-action="center-cad" data-model="${model.id}">${icon("fit")} Placera vid modellen</button><p class="muted">${model.cadData ? `Ritningens XY visas i modellens XZ-plan; Z blir höjd. ${model.cadData.unitKnown ? "" : "Enheten har valts vid import och sparas med filen."}` : "Förskjutning anges i meter. Rotation sker runt den gemensamma modellnollpunkten."}</p>${model.cadData?.skipped.length ? `<p class="muted">Importanmärkningar: ${esc(model.cadData.skipped.join(", "))}</p>` : ""}</div>`;
}
function openCadPlacement(model) {
  if (!model) return;
  if (state.loading) {
    notify("Vänta tills den pågående importen är klar.");
    return;
  }
  viewer.setTool("select");
  toolState();
  const dialog = $("#cad-placement-dialog");
  dialog.dataset.model = model.id;
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="cad-placement-title">Placering</h2>${small("close-dialog", "Stäng", "close")}</div><p class="cad-placement-filename">${esc(model.name)}</p>${cadPlacementPanel(model)}<p class="muted">Inställningarna sparas automatiskt.</p><button class="primary" data-action="close-dialog">Stäng</button>`;
  dialog.showModal();
}
function syncCadPlacementFields(model) {
  const undoButton = $("#cad-placement-dialog").querySelector(
    '[data-action="undo-placement"]',
  );
  if (undoButton?.dataset.model === model.id)
    undoButton.disabled =
      state.undoBusy ||
      !state.placementHistory.some((entry) => entry.model === model);
  $("#cad-placement-dialog")
    .querySelectorAll("[data-placement]")
    .forEach((input) => {
      if (input.dataset.cadModel === model.id)
        input.value = model.placement[input.dataset.placement];
    });
}
$("#cad-placement-dialog").addEventListener("close", () => {
  const id = $("#cad-placement-dialog").dataset.model;
  document
    .querySelector(
      `.model-tree > details[data-tree="${CSS.escape(id)}"] > summary`,
    )
    ?.focus({ preventScroll: true });
});
async function applyCadPlacement(model, values, recordHistory = true) {
  const before = { ...model.placement };
  const placement = { ...model.placement, ...values };
  if (
    !Object.values(placement).every(Number.isFinite) ||
    placement.unitFactor <= 0 ||
    Object.values(placement).some((value) => Math.abs(value) > 1e9)
  ) {
    notify("Ange giltig enhet och placering.");
    syncCadPlacementFields(model);
    renderPanel();
    return false;
  }
  if (Object.keys(placement).every((key) => placement[key] === before[key]))
    return false;
  if (model.cadData) {
    const next = buildCadModel({ ...model, placement });
    const index = state.models.indexOf(model);
    viewer.removeModel(model);
    state.models.splice(index, 1);
    Object.assign(model, next);
    registerModel(model);
    state.models.splice(state.models.indexOf(model), 1);
    state.models.splice(index, 0, model);
    for (const [key, branch] of state.selectedBranches)
      if (branch.model === model) state.selectedBranches.delete(key);
  } else {
    viewer.setModelPlacement(model, placement);
  }
  if (recordHistory) {
    state.placementHistory.push({ model, before });
    if (state.placementHistory.length > 50) state.placementHistory.shift();
  }
  refresh();
  syncCadPlacementFields(model);
  toolState();
  viewer.fit();
  try {
    await storePlacement(
      model.id,
      placement,
      model.cadData && "unitFactor" in values ? true : undefined,
    );
  } catch {
    notify("Placeringen ändrades men kunde inte sparas lokalt.");
  }
  return true;
}
function undoPlacement(modelId) {
  state.undoTask = state.undoTask
    .then(() => performUndoPlacement(modelId))
    .catch((error) => notify(error.message));
  return state.undoTask;
}
async function performUndoPlacement(modelId) {
  if (state.undoBusy) return;
  const index = state.placementHistory.findLastIndex(
    (entry) => !modelId || entry.model.id === modelId,
  );
  if (index < 0) return;
  const [entry] = state.placementHistory.splice(index, 1);
  state.undoBusy = true;
  viewer.setTool("select");
  try {
    await applyCadPlacement(entry.model, entry.before, false);
    status(`Flytt ångrad · ${entry.model.name}`);
  } catch (error) {
    state.placementHistory.splice(index, 0, entry);
    notify(error.message);
  } finally {
    state.undoBusy = false;
    state.showMoveUndo = state.placementHistory.length > 0;
    syncCadPlacementFields(entry.model);
    toolState();
  }
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
  if (o.referenceProperties || o.demoProperties)
    sets = `<details class="property-set" open><summary>Objektdata</summary>${propRows(Object.entries(o.referenceProperties || o.demoProperties))}</details>`;
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
      [model.cadData ? "Lager" : "Våning", o.level],
      ...(!model.cadData ? [["GlobalId", o.globalId || "—"]] : []),
      [model.cadData ? "Objekt-ID" : "Express ID", o.expressId],
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
function measurementModes() {
  return `<div class="measurement-modes">${viewer.measureTool.modes
    .map(
      (kind, index) =>
        `<label>Val ${index + 1}<select data-measure-mode="${index}" aria-label="Mätgeometri ${index + 1}">${Object.entries(
          geometryNames,
        )
          .map(
            ([key, name]) =>
              `<option value="${key}" ${kind === key ? "selected" : ""}>${name}</option>`,
          )
          .join("")}</select></label>`,
    )
    .join("")}</div>`;
}
function measurementPrompt() {
  const step = viewer.measureTool.first ? 1 : 0;
  const mode = viewer.measureTool.modes[step];
  return mode === "auto"
    ? `Peka på punkt, kant eller plan yta · val ${step + 1}`
    : `Välj ${geometryNames[mode].toLowerCase()} ${step + 1}`;
}
function measurementSettings() {
  const tool = viewer.measureTool;
  return `${measurementModes()}<div class="measurement-modes"><label>Enhet<select data-measure-unit aria-label="Måttenhet">${["m", "cm", "mm"].map((unit) => `<option ${unit === tool.unit ? "selected" : ""}>${unit}</option>`).join("")}</select></label><label>Decimaler<select data-measure-decimals aria-label="Antal decimaler">${[0, 1, 2, 3, 4].map((n) => `<option ${n === tool.decimals ? "selected" : ""}>${n}</option>`).join("")}</select></label></div><details class="snap-settings"><summary>Snappning</summary>${["enabled", "endpoint", "midpoint", "center", "perpendicular", "edge", "surface"].map((key) => `<label><input type="checkbox" data-snap-setting="${key}" ${viewer.snap.settings[key] ? "checked" : ""}/> ${key === "enabled" ? "Aktivera snap" : snapNames[key]}</label>`).join("")}</details>`;
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
    <p class="muted">Snitt påverkar bara visningen. Modellens geometri ändras inte.</p><h2 class="section-heading">Mät avstånd</h2>${measurementSettings()}<button class="wide-button ${viewer.tool === "measure" ? "active" : ""}" data-action="measure">${icon("ruler")} ${viewer.tool === "measure" ? "Avsluta mätning" : "Starta mätning"}</button>${viewer.measurements.length ? '<button class="text-button" data-action="clear-measures">Rensa mått</button>' : ""}`;
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
  if (viewer.tool === "move" && viewer.pointMove) {
    const move = viewer.pointMove;
    const message = move.start
      ? "Välj slutpunkt – dit startpunkten ska flyttas"
      : `Välj startpunkt på ${move.model.name}`;
    hud.hidden = false;
    hud.innerHTML = `${icon("cursor")}<span>${esc(message)}</span><label>Riktning<select data-move-axis aria-label="Lås flyttriktning">${[
      ["free", "Fri XYZ"],
      ["x", "X"],
      ["y", "Y · höjd"],
      ["z", "Z"],
      ["xz", "Horisontellt"],
    ]
      .map(
        ([key, name]) =>
          `<option value="${key}" ${move.axis === key ? "selected" : ""}>${name}</option>`,
      )
      .join(
        "",
      )}</select></label>${move.start ? `<label>Exakt avstånd (m)<input data-move-distance aria-label="Exakt flyttavstånd i meter" type="number" step="any" value="${move.distance ?? ""}" placeholder="Valfritt"/></label>` : ""}${small("exit-tool", "Avbryt flytt", "close")}`;
    return;
  }
  const undo = state.placementHistory.at(-1);
  if (viewer.tool === "select" && state.showMoveUndo && undo) {
    hud.hidden = false;
    hud.innerHTML = `<span>${esc(undo.model.name)}</span><button class="compact" data-action="undo-placement" title="Ctrl+Z / Cmd+Z" ${state.undoBusy ? "disabled" : ""}>Ångra flytt</button>${small("dismiss-move-undo", "Stäng", "close")}`;
    return;
  }
  hud.hidden = viewer.tool === "measure" || viewer.section.mode === "none";
  hud.innerHTML = hud.hidden
    ? ""
    : `${icon("cut")}<span>${viewer.section.mode === "plane" ? "Snittplan aktivt" : "Snittbox aktiv"}</span><button class="compact" data-tab="review">Justera</button>${small("clip-none", "Stäng snitt", "close")}`;
}
function setClip(mode) {
  viewer.setSection({ ...viewer.section, mode });
  if (mode !== "none") setTab("review");
  toolState();
  renderPanel();
}
async function removeModel(model, save = true) {
  sourceMonitor.set(model.id, null);
  model.worker?.terminate();
  model.worker = null;
  viewer.removeModel(model);
  state.models = state.models.filter((m) => m !== model);
  for (const key of state.expanded)
    if (key === model.id || key.startsWith(`${model.id}/`))
      state.expanded.delete(key);
  state.placementHistory = state.placementHistory.filter(
    (entry) => entry.model !== model,
  );
  for (const [key, branch] of state.selectedBranches)
    if (branch.model === model) state.selectedBranches.delete(key);
  for (const o of model.objects) {
    state.selected.delete(o.key);
    state.hidden.delete(o.key);
    state.props.delete(o.key);
    state.isolated?.delete(o.key);
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
function sourceIndicator(id) {
  const status = sourceMonitor.status(id);
  if (!status) return "";
  const changed = status === "changed";
  const action = changed
    ? "refresh-reference"
    : status === "permission"
      ? "source-permission"
      : "link-source-folder";
  const title = changed
    ? "Ny filversion i originalmappen – uppdatera referensen"
    : status === "missing"
      ? "Originalfilen saknas – koppla originalmappen igen"
      : status === "permission"
        ? "Ge läsbehörighet för att kontrollera originalfilen"
        : "Originalmappen kunde inte kontrolleras – koppla mappen igen";
  return `<button class="icon-button source-indicator source-${status}" data-action="${action}" data-model="${id}" title="${title}" aria-label="${title}">${icon(changed ? "refresh" : "link-broken")}</button>`;
}
function updateSourceIndicator(id) {
  const wrapper = document.querySelector(
    `[data-source-id="${CSS.escape(id)}"]`,
  );
  if (wrapper) wrapper.innerHTML = sourceIndicator(id);
}
async function chooseSourceFolder(modelId) {
  if (state.loading) {
    notify("Vänta tills den pågående importen är klar.");
    return;
  }
  if (!window.showDirectoryPicker) {
    notify("Koppling till originalmapp kräver Chrome eller Edge på datorn.");
    return;
  }
  try {
    // Must open the picker directly from the user's click, before queued work.
    const directory = await window.showDirectoryPicker({
      id: "lira-original-references",
      mode: "read",
    });
    importQueue = importQueue
      .then(() => linkSourceFolder(directory, modelId))
      .catch((error) => notify(error.message));
  } catch (error) {
    if (error.name !== "AbortError")
      notify(
        "Originalmappen kunde inte kopplas. Ge appen läsbehörighet och försök igen.",
      );
  }
}
async function linkSourceFolder(directory, modelId) {
  let linked = 0,
    failed = 0;
  state.loading = true;
  try {
    for (const model of state.models.filter(
      (model) => !model.demo && (!modelId || model.id === modelId),
    )) {
      try {
        const file = await (
          await directory.getFileHandle(model.name, { create: false })
        ).getFile();
        const record = await storedFile(model.id);
        if (!record) throw Error("Ingen lokal filkopia");
        const source = await createSourceLink(directory, record, file);
        await storeSource(model.id, source);
        sourceMonitor.set(model.id, source);
        linked++;
      } catch {
        failed++;
      }
    }
    notify(
      linked
        ? `${linked} referenser kopplade till ${directory.name}.${failed ? ` ${failed} filer hittades inte i mappen.` : " Automatisk kontroll är aktiv."}`
        : "Inga referensfiler hittades i den valda mappen. Välj mappen som innehåller originalfilerna.",
    );
  } finally {
    state.loading = false;
    await sourceMonitor.check();
  }
}
async function grantSourcePermission(id) {
  const source = sourceMonitor.links.get(id);
  if (!source) return;
  try {
    if (
      (await sourceAccessHandle(source).requestPermission({ mode: "read" })) !==
      "granted"
    ) {
      notify("Läsbehörighet behövs för att kontrollera originalfilerna.");
      return;
    }
    await sourceMonitor.check();
  } catch {
    notify("Läsbehörighet kunde inte ges. Koppla originalmappen igen.");
  }
}
function disposeStagedReference(model) {
  model?.worker?.terminate();
  const textures = new Set(
    model?.parts?.map((part) => part.texture).filter(Boolean),
  );
  textures.forEach((texture) => texture.dispose());
}
async function refreshReference(id) {
  const old = state.models.find((model) => model.id === id);
  const source = sourceMonitor.links.get(id);
  if (!old || !source) return;
  if (state.loading) {
    notify("Vänta tills den pågående importen är klar.");
    return;
  }
  await state.undoTask;
  state.loading = true;
  const camera = viewer.cameraSnapshot(),
    section = structuredClone(viewer.section);
  const origin = state.origin,
    index = state.models.indexOf(old),
    visible = old.visible;
  const oldIsolated = state.isolated ? new Set(state.isolated) : null;
  const hiddenGlobalIds = new Set(
    old.objects
      .filter((o) => o.globalId && state.hidden.has(o.key))
      .map((o) => o.globalId),
  );
  const selectedGlobalIds = new Set(
    old.objects
      .filter((o) => o.globalId && state.selected.has(o.key))
      .map((o) => o.globalId),
  );
  const isolatedGlobalIds = new Set(
    old.objects
      .filter((o) => o.globalId && state.isolated?.has(o.key))
      .map((o) => o.globalId),
  );
  let staged,
    backup,
    swapped = false,
    stored = false;
  try {
    viewer.setTool("select");
    $("#cad-placement-dialog").close();
    const file = await sourceFile(source);
    if (/\.(dwg|dxf)$/i.test(old.name) && file.size > 50 * 1024 ** 2)
      throw Error("CAD-filer får vara högst 50 MB.");
    backup = await storedFile(id);
    if (!backup)
      throw Error("Den lokala filkopian saknas. Öppna referensen på nytt.");
    const record = {
      ...backup,
      size: file.size,
      buffer: await file.arrayBuffer(),
      placement: { ...old.placement },
      unitConfirmed: true,
      sourceStamp: fileStamp(file),
      source: { ...source, baseline: fileStamp(file) },
    };
    // Parse first; the old reference remains visible and intact if reading fails.
    staged = await importRecord(
      { ...record, buffer: record.buffer.slice(0) },
      false,
      true,
    );
    await storeFile(record);
    stored = true;
    await removeModel(old, false);
    swapped = true;
    staged.visible = visible;
    staged.color = old.color;
    registerModel(staged);
    state.models.splice(state.models.indexOf(staged), 1);
    state.models.splice(index, 0, staged);
    // IFC express IDs can change across revisions. Reuse only stable GlobalIds.
    for (const object of staged.objects) {
      if (hiddenGlobalIds.has(object.globalId)) state.hidden.add(object.key);
      if (selectedGlobalIds.has(object.globalId))
        state.selected.add(object.key);
    }
    if (oldIsolated) {
      const oldKeys = new Set(old.objects.map((o) => o.key));
      state.isolated = new Set(
        [...oldIsolated].filter((key) => !oldKeys.has(key)),
      );
      for (const object of staged.objects)
        if (isolatedGlobalIds.has(object.globalId))
          state.isolated.add(object.key);
    }
    sourceMonitor.set(id, record.source);
    viewer.setSection(section);
    refresh();
    viewer.restoreCamera(camera);
    toolState();
    persist();
    notify(`${old.name} uppdaterad · Placering, rotation och skala behölls.`);
  } catch (error) {
    if (swapped) {
      const candidate = state.models.find((model) => model.id === id);
      if (candidate) await removeModel(candidate, false);
    } else disposeStagedReference(staged);
    if (stored) {
      try {
        await storeFile(backup);
        if (swapped) {
          state.origin = origin;
          await importRecord(
            { ...backup, buffer: backup.buffer.slice(0) },
            false,
          );
          const restored = state.models.find((model) => model.id === id);
          restored.visible = visible;
        }
      } catch {
        notify(
          "Referensen kunde inte återställas i vyn. Den tidigare filkopian finns kvar lokalt.",
        );
      }
    }
    state.origin = origin;
    sourceMonitor.set(id, source);
    viewer.setSection(section);
    refresh();
    viewer.restoreCamera(camera);
    notify(
      `${old.name}: Uppdateringen misslyckades. Den tidigare versionen behålls. ${error.message}`,
    );
  } finally {
    state.loading = false;
    $("#loading").hidden = true;
    await sourceMonitor.check();
  }
}

function projectSnapshot(files) {
  const records = new Map(files.map((file) => [file.id, file]));
  const models = state.models.filter((model) => !model.demo);
  return {
    name: state.projectName,
    origin: state.origin,
    grouping: state.grouping,
    view: viewSnapshot(
      models,
      state.hidden,
      state.isolated,
      viewer.cameraSnapshot(),
      viewer.section,
    ),
    views: state.views.filter((view) => canRestoreView(view, models)),
    display: {
      colorMode: viewer.colorMode,
      edges: viewer.edgesEnabled,
      grid: viewer.grid.visible,
    },
    files: models.map((model) => {
      const record = records.get(model.id);
      if (!record?.buffer?.byteLength)
        throw Error(
          `${model.name}: Originalfilen saknas i den lokala lagringen. Öppna referensen på nytt innan projektet sparas.`,
        );
      return {
        ...record,
        placement: { ...model.placement },
        unitConfirmed: true,
      };
    }),
  };
}
function applyProjectView(project) {
  state.projectName = project.name;
  state.grouping = project.grouping;
  state.views = project.views;
  const view = project.view;
  if (view) {
    state.models.forEach((model) => {
      model.visible = view.visibility[model.id] ?? true;
    });
    state.hidden = new Set(view.hidden);
    state.isolated = view.isolated ? new Set(view.isolated) : null;
    viewer.setSection(view.section);
    viewer.restoreCamera(view.camera);
    $("#projection").value = view.camera.projection;
  }
  if (project.display) {
    viewer.setColorMode(project.display.colorMode);
    viewer.setEdges(project.display.edges);
    viewer.grid.visible = project.display.grid;
    $("#color-mode").value = project.display.colorMode;
    document
      .querySelector('[data-action="edges"]')
      .setAttribute("aria-pressed", project.display.edges);
    document
      .querySelector('[data-action="grid"]')
      .setAttribute("aria-pressed", project.display.grid);
  }
  setTab("models");
  refresh();
  toolState();
  persist();
}
async function loadProjectReferences(project) {
  state.origin = project.origin;
  state.grouping = project.grouping;
  // Keep project buffers available until the whole project has opened, including rollback.
  for (const record of project.files) {
    try {
      await importRecord({ ...record, buffer: record.buffer.slice(0) }, false);
    } catch {
      throw Error(
        `Referensen ${record.name} kunde inte öppnas. Kontrollera originalfilen.`,
      );
    }
  }
  applyProjectView(project);
}
async function saveProject() {
  if (state.loading) {
    notify("Vänta tills den pågående importen är klar.");
    return;
  }
  if (state.models.some((model) => model.demo)) {
    notify(
      "Öppna dina egna referenser innan projektet sparas. Demomodellen är endast ett visningsexempel.",
    );
    return;
  }
  state.loading = true;
  try {
    await state.undoTask;
    status("Packar projekt med alla referenser…");
    const project = projectSnapshot(await storedFiles());
    const { bytes } = await processProject({ type: "save", project });
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/zip" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${state.projectName.replace(/[\\/:*?"<>|]/g, "_")}.liraifc`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    notify(`Projektfil skapad · ${project.files.length} referenser ingår.`);
  } finally {
    state.loading = false;
  }
}
async function openProject(file) {
  state.loading = true;
  let previous,
    previousFiles,
    wasDemo = false,
    replaced = false;
  try {
    $("#loading").hidden = false;
    $("#loading-name").textContent = file.name;
    $("#loading-status").textContent =
      "Kontrollerar projektfil och referenser…";
    // Validate every embedded file before touching the current project or storage.
    const { project } = await processProject({
      type: "open",
      buffer: await file.arrayBuffer(),
    });
    await state.undoTask;
    previousFiles = await storedFiles();
    previous = projectSnapshot(previousFiles);
    wasDemo = state.models.some((model) => model.demo);
    await replaceStoredFiles(project.files);
    replaced = true;
    await resetProjectScene();
    await loadProjectReferences(project);
    state.projectName = file.name.replace(/\.liraifc$/i, "") || project.name;
    persist();
    notify(
      `Projekt öppnat · ${project.files.length} referenser med placeringar.`,
    );
  } catch (error) {
    if (replaced) {
      try {
        await replaceStoredFiles(previousFiles);
        await resetProjectScene();
        if (wasDemo) {
          state.loading = false;
          await showDemo();
          state.loading = true;
        } else await loadProjectReferences(previous);
        notify(`${error.message} Föregående projekt har återställts.`);
      } catch {
        notify(
          `${error.message} Föregående filer finns i den lokala lagringen; starta om appen för att läsa dem igen.`,
        );
      }
    } else notify(error.message);
  } finally {
    state.loading = false;
    $("#loading").hidden = true;
  }
}

async function resetProjectScene() {
  state.projectName = "LiraIFC-projekt";
  viewer.setTool("select");
  viewer.clearMeasurements();
  for (const model of [...state.models]) await removeModel(model, false);
  state.selected.clear();
  state.selectedBranches.clear();
  state.hidden.clear();
  state.expanded.clear();
  state.props.clear();
  state.isolated = null;
  state.origin = null;
  state.views = [];
  state.query = "";
  state.type = "";
  state.limit = 150;
  state.placementHistory = [];
  state.showMoveUndo = false;
  viewer.setSection({ ...viewer.section, mode: "none" });
  $("#level-filter").value = "";
  sessionStorage.removeItem(updateSnapshotKey);
  setTab("models");
  refresh();
  toolState();
  viewer.standardView("iso");
  viewer.fit();
}
async function newProject() {
  if (state.loading) {
    notify("Vänta tills den pågående importen är klar.");
    return;
  }
  state.loading = true;
  const button = document.querySelector('[data-action="new-project"]');
  button.disabled = true;
  try {
    await state.undoTask;
    // Clear the local working copies atomically before clearing the scene.
    // Original files on disk are never modified.
    await clearStoredFiles();
    await resetProjectScene();
    persist();
    notify("Nytt tomt projekt · Släpp IFC, DXF eller DWG i modellvyn.");
  } catch {
    notify("Kunde inte skapa ett nytt projekt. Försök igen.");
  } finally {
    state.loading = false;
    button.disabled = false;
    $("#loading").hidden = true;
  }
}
async function showDemo() {
  if (state.loading) return;
  state.loading = true;
  try {
    for (const model of [...state.models]) await removeModel(model);
    state.origin = [0, 0, 0];
    state.hidden.clear();
    state.isolated = null;
    state.selected.clear();
    createDemoModels().forEach(registerModel);
    const beam = allObjects().find((o) => o.name === "Balk K-204");
    if (beam) state.selected.add(beam.key);
    setTab("models");
    refresh();
    $("#loading").hidden = false;
    $("#loading-name").textContent = "DWG_Solider.dwg";
    $("#loading-status").textContent = "Läser demomodellens DWG-solider…";
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}demo/DWG_Solider.dwg`,
      );
      if (!response.ok) throw Error("DWG-testfilen kunde inte hämtas.");
      await importCadRecord(
        {
          id: "demo-dwg-solids",
          name: "DWG_Solider.dwg",
          demo: true,
          buffer: await response.arrayBuffer(),
          placement: {
            unitFactor: 1,
            x: -10,
            z: -12,
            elevation: 0,
            rotation: 0,
          },
        },
        false,
      );
    } catch (error) {
      notify(`DWG-demot kunde inte öppnas: ${error.message}`);
    }
    state.models.sort(
      (a, b) =>
        Number(b.id === "demo-dwg-solids") - Number(a.id === "demo-dwg-solids"),
    );
    viewer.standardView("iso");
    refresh();
    persist();
    status(
      state.models.some((m) => m.id === "demo-dwg-solids")
        ? "Demomodell · DWG_Solider.dwg: låda, cylinder, sfär och ring framför byggnaden"
        : "Demomodell · DWG-testfilen kunde inte öppnas",
    );
  } finally {
    state.loading = false;
    $("#loading").hidden = true;
  }
}
async function importRecord(record, persistFile = true, staged = false) {
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
  if (/\.(dxf|dwg)$/i.test(record.name))
    return importCadRecord(record, persistFile, staged);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./ifc.worker.js", import.meta.url), {
      type: "module",
    });
    const model = {
      id: record.id,
      name: record.name,
      visible: true,
      parts: [],
      placement: record.placement || { x: 0, z: 0, elevation: 0, rotation: 0 },
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
          if (staged) {
            resolve(model);
            return;
          }
          sourceMonitor.set(model.id, record.source);
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
async function importCadRecord(record, persistFile, staged = false) {
  const format = record.name.split(".").at(-1).toUpperCase();
  $("#loading-status").textContent = `Läser ${format}-ritning…`;
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./cad.worker.js", import.meta.url), {
      type: "module",
    });
    const fail = async (message) => {
      worker.terminate();
      if (persistFile)
        try {
          await deleteFile(record.id);
        } catch {}
      reject(new Error(message));
    };
    worker.onerror = (error) =>
      fail(error.message || `${format}-importen avbröts.`);
    worker.onmessage = async ({ data }) => {
      if (data.type === "progress")
        $("#loading-status").textContent = data.label;
      if (data.type === "error") {
        fail(data.message);
        return;
      }
      if (data.type !== "done") return;
      worker.terminate();
      try {
        const unitFactor =
          cadImportUnit(data, record) ??
          (await chooseCadUnit(record.name, data));
        const placement = {
          x: 0,
          z: 0,
          elevation: 0,
          rotation: 0,
          ...record.placement,
          unitFactor,
        };
        const origin = state.origin || initialCadOrigin(data, unitFactor);
        const model = buildCadModel({
          id: record.id,
          name: record.name,
          demo: !!record.demo,
          format,
          schema: `${format} · CAD`,
          visible: true,
          color: "#6e9a8c",
          origin,
          placement,
          cadData: data,
        });
        if (staged) {
          resolve(model);
          return;
        }
        state.origin ||= origin;
        sourceMonitor.set(model.id, record.source);
        registerModel(model);
        refresh();
        viewer.fit();
        persist();
        if (!record.demo)
          try {
            await storePlacement(record.id, placement, true);
          } catch {
            notify("Placeringen kunde inte sparas lokalt.");
          }
        status(
          `${record.name} · ${model.objects.length.toLocaleString("sv")} ritningsobjekt${data.skipped.length ? ` · ${data.skipped.length} anmärkningar` : ""}`,
        );
        resolve();
      } catch (error) {
        fail(error.message);
      }
    };
    worker.postMessage({ format, buffer: record.buffer }, [record.buffer]);
  });
}
let importQueue = Promise.resolve();
function importFiles(files, handles = new Map()) {
  const pendingFiles = [...files];
  const pending = importQueue.then(() => importFilesNow(pendingFiles, handles));
  importQueue = pending.catch(() => {});
  return pending;
}
async function importFilesNow(files, handles = new Map()) {
  if (state.loading) {
    notify("Vänta tills den pågående importen är klar.");
    return;
  }
  const valid = [...files].filter((f) =>
    /\.(ifc|dxf|dwg|liraifc)$/i.test(f.name),
  );
  if (valid.some((f) => /\.liraifc$/i.test(f.name))) {
    if (valid.length !== 1) {
      notify("Öppna ett projekt i taget, separat från modellfiler.");
      return;
    }
    return openProject(valid[0]);
  }
  if (!valid.length) {
    notify("Välj IFC, DXF, DWG eller ett LiraIFC-projekt.");
    return;
  }
  state.loading = true;
  for (const file of valid) {
    if (/\.(dxf|dwg)$/i.test(file.name) && file.size > 50 * 1024 * 1024) {
      notify(`${file.name}: CAD-filer får vara högst 50 MB.`);
      continue;
    }
    try {
      await importRecord({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        sourceStamp: fileStamp(file),
        ...(handles.has(file)
          ? { source: createFileSource(handles.get(file), file) }
          : {}),
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
  await sourceMonitor.check();
}

const actions = {
  "link-source-folder": (button) => chooseSourceFolder(button.dataset.model),
  "source-permission": (button) => grantSourcePermission(button.dataset.model),
  "refresh-reference": (button) => {
    button.disabled = true;
    importQueue = importQueue
      .then(() => refreshReference(button.dataset.model))
      .catch((error) => notify(error.message));
  },
  "open-project": () => $("#project-input").click(),
  "save-project": () => {
    importQueue = importQueue
      .then(saveProject)
      .catch((error) => notify(error.message));
  },
  "new-project": () => {
    importQueue = importQueue
      .then(newProject)
      .catch((error) => notify(error.message));
  },
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
  "undo-placement": (button) => undoPlacement(button?.dataset.model),
  "dismiss-move-undo": () => {
    state.showMoveUndo = false;
    toolState();
  },
  "pick-placement": (button) => {
    const model = state.models.find((m) => m.id === button.dataset.model);
    if (!model) return;
    if (
      !model.visible ||
      model.objects.every(
        (o) =>
          state.hidden.has(o.key) ||
          (state.isolated && !state.isolated.has(o.key)),
      )
    ) {
      notify("Visa modellen innan du väljer startpunkt.");
      return;
    }
    $("#cad-placement-dialog").close();
    closeObjectMenu();
    viewer.beginPointMove(
      model,
      async (delta) => {
        toolState();
        try {
          const changed = await applyCadPlacement(model, {
            x: model.placement.x + delta.x,
            z: model.placement.z + delta.z,
            elevation: model.placement.elevation + delta.y,
          });
          if (!changed) return;
          state.showMoveUndo = true;
          toolState();
          status(
            `${model.name} flyttad · ΔX ${format(delta.x)} · ΔY ${format(delta.y)} · ΔZ ${format(delta.z)} m`,
          );
        } catch (error) {
          notify(error.message);
        }
      },
      () => {
        toolState();
        status(
          viewer.pointMove.start
            ? "Välj slutpunkt på ett objekt eller arbetsplanet. Esc avbryter."
            : `Välj startpunkt på ${model.name}. Esc avbryter.`,
        );
      },
    );
    viewer.renderer.domElement.focus({ preventScroll: true });
  },
  "cad-placement": (button) =>
    openCadPlacement(
      state.models.find((model) => model.id === button.dataset.model),
    ),
  "center-cad": (button) => {
    const model = state.models.find(
      (model) => model.id === button.dataset.model,
    );
    const target = new THREE.Box3(),
      source = new THREE.Box3();
    state.models
      .filter((other) => other !== model)
      .forEach((other) =>
        other.objects.forEach((object) => target.union(object.bounds)),
      );
    model.objects.forEach((object) => source.union(object.bounds));
    if (target.isEmpty())
      target.setFromCenterAndSize(
        new THREE.Vector3(),
        new THREE.Vector3(1, 0, 1),
      );
    const delta = target
      .getCenter(new THREE.Vector3())
      .sub(source.getCenter(new THREE.Vector3()));
    applyCadPlacement(model, {
      x: model.placement.x + delta.x,
      z: model.placement.z + delta.z,
      elevation: model.placement.elevation + target.min.y - source.min.y,
    });
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
      status(measurementPrompt());
    }
    toolState();
    renderPanel();
  },
  "exit-tool": () => {
    const moving = viewer.tool === "move";
    viewer.setTool("select");
    toolState();
    renderPanel();
    status(moving ? "Flytt avbruten" : "Mätning avslutad");
  },
  "remove-measure": (button) =>
    viewer.measureTool.remove(Number(button.dataset.measure)),
  "clear-measures": () => {
    viewer.clearMeasurements();
    renderPanel();
    toolState();
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
    setPanelCollapsed(!$(".workbench").classList.contains("panel-collapsed"));
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
$("#project-input").addEventListener("change", (e) => {
  importFiles(e.target.files);
  e.target.value = "";
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
  if (e.target.dataset.measureMode !== undefined) {
    viewer.measureTool.setModes(
      Number(e.target.dataset.measureMode),
      e.target.value,
    );
    toolState();
    renderPanel();
    return;
  }
  if (
    e.target.hasAttribute("data-measure-unit") ||
    e.target.hasAttribute("data-measure-decimals")
  ) {
    if (e.target.hasAttribute("data-measure-unit"))
      viewer.measureTool.unit = e.target.value;
    else viewer.measureTool.decimals = Number(e.target.value);
    viewer.measureTool.updateLabels();
    renderPanel();
    return;
  }
  if (e.target.dataset.snapSetting) {
    viewer.snap.settings[e.target.dataset.snapSetting] = e.target.checked;
    viewer.snap.reset();
    viewer.hideSnap();
    return;
  }
  if (e.target.hasAttribute("data-move-axis") && viewer.pointMove) {
    viewer.pointMove.axis = e.target.value;
    viewer.snap.reset();
    return;
  }
  if (e.target.hasAttribute("data-move-distance") && viewer.pointMove) {
    const n = e.target.value.trim() === "" ? null : Number(e.target.value);
    if (n === null || Number.isFinite(n)) viewer.pointMove.distance = n;
    return;
  }

  if (e.target.dataset.cadModel) {
    const model = state.models.find(
      (model) => model.id === e.target.dataset.cadModel,
    );
    if (model)
      applyCadPlacement(model, {
        [e.target.dataset.placement]: Number(e.target.value),
      }).catch((error) => notify(error.message));
    return;
  }
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
            .filter((o) => modelFor(o).cadData || o.level === e.target.value)
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
    const moving = viewer.tool === "move";
    closeObjectMenu();
    viewer.setTool("select");
    toolState();
    renderPanel();
    if (moving) status("Flytt avbruten.");
    return;
  }
  if (
    !e.target.closest("input,select,textarea,dialog") &&
    (viewer.tool === "measure" || viewer.tool === "move") &&
    e.key === "Tab"
  ) {
    e.preventDefault();
    viewer.cycleSnap();
    return;
  }
  if (
    !e.target.closest("input,select,textarea,dialog") &&
    viewer.tool === "move" &&
    ["x", "y", "z"].includes(e.key.toLowerCase())
  ) {
    e.preventDefault();
    const key = e.key.toLowerCase();
    viewer.pointMove.axis = viewer.pointMove.axis === key ? "free" : key;
    toolState();
    return;
  }
  if (
    (e.ctrlKey || e.metaKey) &&
    !e.shiftKey &&
    e.key.toLowerCase() === "z" &&
    !e.target.closest("input,select,textarea") &&
    !document.querySelector("dialog[open]:not(#cad-placement-dialog)")
  ) {
    const dialog = $("#cad-placement-dialog");
    const modelId = dialog.open ? dialog.dataset.model : undefined;
    if (
      state.placementHistory.some(
        (entry) => !modelId || entry.model.id === modelId,
      )
    ) {
      e.preventDefault();
      undoPlacement(modelId);
    }
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
  const captured = captureDroppedFiles(e.dataTransfer);
  const pending = importQueue.then(async () => {
    const { files, handles } = await captured;
    const previousIds = new Set(state.models.map((model) => model.id));
    await importFilesNow(files, handles);
    if (files.some((file) => /\.(ifc|dwg|dxf)$/i.test(file.name))) {
      const unlinked = state.models.filter(
        (model) =>
          !model.demo &&
          !previousIds.has(model.id) &&
          !sourceMonitor.links.has(model.id),
      ).length;
      if (unlinked)
        notify(
          `${unlinked} referenser öppnades utan direkt filkoppling. Koppla originalmapp för automatisk kontroll.`,
        );
    }
  });
  importQueue = pending.catch((error) => notify(error.message));
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
      ? "Demomodell · Öppna modell för dina egna modeller"
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
importQueue = start()
  .then(() => sourceMonitor.check())
  .catch((error) => notify(error.message));
registerFileHandling({ openFiles: importFiles, onError: notify });
