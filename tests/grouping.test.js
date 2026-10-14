import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IFCZONE,
  IFCSYSTEM,
  IFCSPATIALZONE,
  IFCRELASSIGNSTOGROUP,
  IFCRELAGGREGATES,
  IFCRELNESTS,
  IFCRELCONTAINEDINSPATIALSTRUCTURE,
  IFCRELREFERENCEDINSPATIALSTRUCTURE,
  IFCRELDEFINESBYTYPE,
} from "web-ifc";
import { readIfcGroups } from "../src/ifc-groups.js";
import {
  buildGroupingTree,
  groupVisibility,
  toggleGroupVisibility,
} from "../src/model-tree.js";

test("IFC group extraction resolves nested and overlapping memberships without mixing zones into systems", () => {
  const ids = new Map([
    [IFCSYSTEM, [10, 11, 20]],
    [IFCZONE, [20, 21]],
    [IFCSPATIALZONE, [22]],
    [IFCRELASSIGNSTOGROUP, [100, 101, 102, 103, 104]],
    [IFCRELAGGREGATES, []],
    [IFCRELNESTS, []],
    [IFCRELCONTAINEDINSPATIALSTRUCTURE, [105]],
    [IFCRELREFERENCEDINSPATIALSTRUCTURE, [106]],
    [IFCRELDEFINESBYTYPE, []],
  ]);
  const ref = (value) => ({ value });
  const lines = new Map([
    [10, { Name: ref("Ventilation"), type: IFCSYSTEM }],
    [11, { Name: ref("Huvudsystem"), type: IFCSYSTEM }],
    [20, { Name: ref("Zon A"), type: IFCZONE }],
    [21, { Name: ref("Zon B"), type: IFCZONE }],
    [22, { Name: ref("Rumslig zon"), type: IFCSPATIALZONE }],
    [100, { RelatingGroup: ref(10), RelatedObjects: [ref(1)] }],
    [101, { RelatingGroup: ref(11), RelatedObjects: [ref(10), ref(2)] }],
    [102, { RelatingGroup: ref(20), RelatedObjects: [ref(50)] }],
    [103, { RelatingGroup: ref(21), RelatedObjects: [ref(1)] }],
    [104, { RelatingGroup: ref(10), RelatedObjects: [ref(11)] }], // Defensive cycle handling.
    [105, { RelatingStructure: ref(50), RelatedElements: [ref(1), ref(2)] }],
    [106, { RelatingStructure: ref(22), RelatedElements: [ref(2)] }],
  ]);
  const api = {
    GetLineIDsWithType: (_, type) => ({
      size: () => ids.get(type).length,
      get: (i) => ids.get(type)[i],
    }),
    GetLine: (_, id) => lines.get(id),
    GetNameFromTypeCode: (type) => (type === IFCZONE ? "IfcZone" : "IfcSystem"),
  };
  const { groups, warning } = readIfcGroups(api, 0, [1, 2, 3]);
  assert.equal(warning, "");
  assert.equal(groups.filter((g) => g.kind === "systems").length, 2);
  assert.deepEqual(
    new Set(groups.find((g) => g.id === 20).memberIds),
    new Set([1, 2]),
  );
  assert.deepEqual(groups.find((g) => g.id === 21).memberIds, [1]);
  assert.deepEqual(groups.find((g) => g.id === 22).memberIds, [2]);
  assert.deepEqual(
    new Set(groups.find((g) => g.id === 10).memberIds),
    new Set([1, 2]),
  );
});

test("switching grouping preserves shared visibility, overlapping group state and unassigned objects", () => {
  const objects = [1, 2, 3].map((expressId) => ({
    expressId,
    key: `m:${expressId}`,
    ifcClass: expressId === 3 ? "IfcWall" : "IfcBeam",
  }));
  const model = {
    id: "m",
    visible: true,
    objects,
    objectMap: new Map(objects.map((o) => [o.expressId, o])),
    groups: [
      { id: 10, kind: "systems", name: "Ventilation", memberIds: [1] },
      { id: 20, kind: "zones", name: "Zon A", memberIds: [1, 2] },
      { id: 21, kind: "zones", name: "Zon B", memberIds: [1] },
    ],
  };
  const system = buildGroupingTree(model, "systems"),
    zones = buildGroupingTree(model, "zones"),
    types = buildGroupingTree(model, "types");
  assert.equal(system.nodes.get("m/systems/unassigned").members.length, 2);
  assert.equal(zones.nodes.get("m/zones/unassigned").members.length, 1);
  const hidden = new Set();
  toggleGroupVisibility(
    system.nodes.get("m/systems/10").members,
    model,
    hidden,
    null,
  );
  assert.equal(
    groupVisibility(zones.nodes.get("m/zones/20").members, model, hidden, null),
    "mixed",
  );
  assert.equal(
    groupVisibility(zones.nodes.get("m/zones/21").members, model, hidden, null),
    "none",
  );
  assert.equal(
    groupVisibility(
      types.nodes.get("m/types/IfcBeam").members,
      model,
      hidden,
      null,
    ),
    "mixed",
  );
  toggleGroupVisibility(
    zones.nodes.get("m/zones/20").members,
    model,
    hidden,
    null,
  );
  assert.equal(
    groupVisibility(
      system.nodes.get("m/systems/10").members,
      model,
      hidden,
      null,
    ),
    "all",
  );
});
