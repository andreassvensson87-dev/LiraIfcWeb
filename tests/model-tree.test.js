import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildModelTree,
  groupVisibility,
  toggleGroupVisibility,
} from "../src/model-tree.js";

function fixture() {
  const objects = [1, 2, 3].map((expressId) => ({
    expressId,
    key: `m:${expressId}`,
  }));
  const leaf = (id) => ({ expressID: id, type: "IfcWall", children: [] });
  const node = (id, type, name, children) => ({
    expressID: id,
    type,
    Name: { value: name },
    children,
  });
  const model = {
    id: "m",
    visible: true,
    objects,
    objectMap: new Map(objects.map((o) => [o.expressId, o])),
    spatial: node(10, "IfcProject", "Projekt", [
      node(11, "IfcSite", "Site", [
        node(12, "IfcBuilding", "Hus A", [
          node(13, "IfcBuildingStorey", "Plan 01", [leaf(1), leaf(2)]),
        ]),
        node(14, "IfcBuilding", "Hus B", [
          node(15, "IfcBuildingStorey", "Plan 01", [leaf(3)]),
        ]),
      ]),
    ]),
  };
  model.tree = buildModelTree(model);
  return model;
}
test("IFC hierarchy retains equal floor names in separate buildings and scopes all descendants", () => {
  const model = fixture();
  assert.equal(model.tree.roots[0].name, "Projekt");
  assert.equal(model.tree.nodes.get("m/ifc/11").members.length, 3);
  assert.deepEqual(
    model.tree.nodes.get("m/ifc/13").members.map((o) => o.key),
    ["m:1", "m:2"],
  );
  assert.deepEqual(
    model.tree.nodes.get("m/ifc/15").members.map((o) => o.key),
    ["m:3"],
  );
  assert.equal(model.objects[0].level, "Plan 01");
  assert(model.objects[0].spatialPath.includes("Hus A"));
});
test("whole-branch visibility reflects partial hiding and is independent of search", () => {
  const model = fixture(),
    floor = model.tree.nodes.get("m/ifc/13"),
    hidden = new Set(),
    isolated = null;
  assert.equal(groupVisibility(floor.members, model, hidden, isolated), "all");
  toggleGroupVisibility(floor.members, model, hidden, isolated);
  assert.equal(groupVisibility(floor.members, model, hidden, isolated), "none");
  assert.equal(
    groupVisibility(
      model.tree.nodes.get("m/ifc/15").members,
      model,
      hidden,
      isolated,
    ),
    "all",
  );
  hidden.delete("m:1");
  assert.equal(
    groupVisibility(floor.members, model, hidden, isolated),
    "mixed",
  );
  toggleGroupVisibility(floor.members, model, hidden, isolated);
  assert.equal(groupVisibility(floor.members, model, hidden, isolated), "all");
});
test("showing one branch under a hidden model does not reveal other branches and handles isolation", () => {
  const model = fixture(),
    hidden = new Set(),
    isolated = new Set(["m:1"]);
  model.visible = false;
  toggleGroupVisibility(
    model.tree.nodes.get("m/ifc/13").members,
    model,
    hidden,
    isolated,
  );
  assert.equal(model.visible, true);
  assert(hidden.has("m:3"));
  assert.deepEqual([...isolated], ["m:1", "m:2"]);
});
test("standalone objects without spatial containment remain accessible", () => {
  const model = fixture();
  model.spatial.children = [];
  const tree = buildModelTree(model);
  assert.equal(tree.roots[0].name, "Övrigt");
  assert.equal(tree.roots[0].members.length, 3);
});
