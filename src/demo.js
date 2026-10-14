import * as THREE from "three";

export function createDemoModels() {
  const models = ["A_Arkitektur.ifc", "K_Stomme.ifc", "V_Installation.ifc"].map(
    (name, i) => ({
      id: `demo-${i}`,
      name,
      schema: "Demo",
      demo: true,
      visible: true,
      objects: [],
      parts: [],
      color: ["#b99a73", "#839299", "#6498ad"][i],
      origin: [0, 0, 0],
    }),
  );
  let id = 1;
  function add(
    model,
    name,
    type,
    level,
    geometry,
    position,
    color,
    extra = {},
    rotation = 0,
    opacity = 1,
  ) {
    geometry.rotateY(rotation).translate(...position);
    const object = {
      expressId: id++,
      name,
      ifcClass: type,
      globalId: `DEMO-${id}`,
      level: `Plan ${String(level + 1).padStart(2, "0")}`,
      demoProperties: { Material: extra.Material || "Betong C30/37", ...extra },
    };
    model.objects.push(object);
    const c = new THREE.Color(color);
    model.parts.push({
      id: object.expressId,
      positions: geometry.attributes.position.array.slice(),
      normals: geometry.attributes.normal.array.slice(),
      indices: geometry.index.array.slice(),
      color: c.toArray(),
      opacity,
    });
    geometry.dispose();
  }
  const box = (m, name, type, level, size, pos, color, extra, opacity) =>
    add(
      m,
      name,
      type,
      level,
      new THREE.BoxGeometry(...size),
      pos,
      color,
      extra,
      0,
      opacity,
    );
  const [a, k, v] = models;
  for (let floor = 0; floor < 4; floor++) {
    const y = floor * 3.6;
    box(
      k,
      `Bjälklag B-${floor + 1}`,
      "IfcSlab",
      floor,
      [18.7, 0.24, 12.7],
      [0, y, 0],
      "#b5b9b5",
      { Tjocklek: "240 mm" },
    );
    for (const x of [-9, -3, 3, 9])
      for (const z of [-6, 0, 6]) {
        box(
          k,
          `Pelare P-${floor + 1}-${x}-${z}`,
          "IfcColumn",
          floor,
          [0.22, 3.36, 0.22],
          [x, y + 1.8, z],
          "#677d83",
          { Profil: "HEA 220", Material: "S355" },
        );
      }
    for (const z of [-6, 0, 6])
      for (const x of [-6, 0, 6]) {
        const name =
          floor === 1 && x === 0 && z === -6
            ? "Balk K-204"
            : `Balk K-${floor + 1}-${x}-${z}`;
        // A real I-shaped section with web and two flanges, rather than a solid box.
        const shape = new THREE.Shape();
        [
          [-0.1, -0.15],
          [0.1, -0.15],
          [0.1, -0.12],
          [0.015, -0.12],
          [0.015, 0.12],
          [0.1, 0.12],
          [0.1, 0.15],
          [-0.1, 0.15],
          [-0.1, 0.12],
          [-0.015, 0.12],
          [-0.015, -0.12],
          [-0.1, -0.12],
        ].forEach(([sx, sy], i) =>
          i ? shape.lineTo(sx, sy) : shape.moveTo(sx, sy),
        );
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: 6,
          bevelEnabled: false,
          steps: 1,
        });
        geo.rotateY(Math.PI / 2).translate(-3, 0, 0);
        // Extrude geometry is unindexed; use a sequential index for the shared batching path.
        geo.setIndex(
          Array.from({ length: geo.attributes.position.count }, (_, i) => i),
        );
        add(k, name, "IfcBeam", floor, geo, [x, y + 3.25, z], "#798b8f", {
          Profil: "HEA 200",
          Material: "S355",
          Längd: "6 000 mm",
          Bärande: "Ja",
        });
      }
    for (const x of [-9, 9])
      for (const z of [-3, 3])
        box(
          k,
          `Tvärbalk ${floor}-${x}-${z}`,
          "IfcBeam",
          floor,
          [0.16, 0.24, 6],
          [x, y + 3.2, z],
          "#8c9c9c",
          { Material: "S355" },
        );
    // A restrained architectural shell leaves the front open for inspection.
    box(
      a,
      `Bakvägg ${floor + 1}`,
      "IfcWall",
      floor,
      [18, 2.8, 0.15],
      [0, y + 1.7, 6.2],
      "#c9c6be",
    );
    for (const x of [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5]) {
      box(
        a,
        `Fasadpanel ${floor}-${x}`,
        "IfcWall",
        floor,
        [2.92, 0.8, 0.12],
        [x, y + 0.6, -6.2],
        "#b39470",
        { Material: "Träpanel" },
      );
      if (x < -3 || floor === 0)
        box(
          a,
          `Fönster ${floor}-${x}`,
          "IfcWindow",
          floor,
          [2.82, 2.45, 0.055],
          [x, y + 2.25, -6.2],
          "#9cc3cb",
          { Material: "Glas" },
          0.17,
        );
      box(
        a,
        `Fönsterpost ${floor}-${x}`,
        "IfcMember",
        floor,
        [0.055, 2.55, 0.075],
        [x - 1.47, y + 2.25, -6.2],
        "#5c6d70",
        { Material: "Aluminium" },
      );
    }
    box(
      a,
      `Gavel ${floor}`,
      "IfcWall",
      floor,
      [0.12, 2.9, 12],
      [9.22, y + 1.8, 0],
      "#c4c0b5",
    );
    if (floor < 3) {
      for (let s = 0; s < 15; s++)
        box(
          a,
          `Trappsteg ${floor}-${s}`,
          "IfcStairFlight",
          floor,
          [1.35, 0.1, 0.29],
          [7.8, y + 0.3 + s * 0.22, -2 + s * 0.28],
          "#a4aaa6",
        );
    }
    for (const x of [-5.5, 0, 5.5]) {
      box(
        v,
        `Ventilationskanal ${floor}-${x}`,
        "IfcDuctSegment",
        floor,
        [0.55, 0.42, 10.8],
        [x, y + 2.87, 0],
        "#79a1b2",
        { Material: "Galvaniserad stålplåt", Dimension: "550 × 420 mm" },
      );
      for (const z of [-3.4, 2])
        box(
          v,
          `Kanalgren ${floor}-${x}-${z}`,
          "IfcDuctSegment",
          floor,
          [4.5, 0.24, 0.28],
          [x + 1, y + 2.87, z],
          "#91b0bf",
          { Dimension: "280 × 240 mm" },
        );
    }
    for (const offset of [-0.18, 0.18]) {
      const pipe = new THREE.CylinderGeometry(0.045, 0.045, 17, 12);
      pipe.rotateZ(Math.PI / 2);
      add(
        v,
        `Värmerör ${floor}-${offset}`,
        "IfcPipeSegment",
        floor,
        pipe,
        [0, y + 2.65, -4.5 + offset],
        offset < 0 ? "#b86654" : "#63848f",
        { Material: "Koppar", Diameter: "90 mm" },
      );
    }
    for (const x of [-5, 1])
      for (const z of [1.5, 4]) {
        box(
          a,
          `Arbetsbord ${floor}-${x}-${z}`,
          "IfcFurnishingElement",
          floor,
          [1.5, 0.08, 0.75],
          [x, y + 0.85, z],
          "#d2c6b2",
          { Material: "Trä" },
        );
        box(
          a,
          `Bordsstativ ${floor}-${x}-${z}`,
          "IfcFurnishingElement",
          floor,
          [0.1, 0.64, 0.5],
          [x, y + 0.49, z],
          "#728184",
        );
      }
  }
  box(
    k,
    "Takbjälklag · öppet demoutsnitt",
    "IfcSlab",
    3,
    [18.7, 0.24, 4.5],
    [0, 14.4, 4.1],
    "#bbbdb7",
  );
  box(
    v,
    "Ventilationsaggregat",
    "IfcUnitaryEquipment",
    3,
    [2.2, 1.2, 2.8],
    [5, 15.12, 3],
    "#aab5b3",
    { Material: "Stål", System: "FTX" },
  );
  for (const model of models) model.groups = [];
  v.groups.push(
    {
      id: "ventilation",
      kind: "systems",
      name: "Ventilation · FTX",
      type: "IfcDistributionSystem",
      memberIds: v.objects
        .filter((o) =>
          ["IfcDuctSegment", "IfcUnitaryEquipment"].includes(o.ifcClass),
        )
        .map((o) => o.expressId),
    },
    {
      id: "heating",
      kind: "systems",
      name: "Värmesystem",
      type: "IfcDistributionSystem",
      memberIds: v.objects
        .filter((o) => o.ifcClass === "IfcPipeSegment")
        .map((o) => o.expressId),
    },
  );
  for (const model of models) {
    model.groups.push(
      {
        id: "entrance",
        kind: "zones",
        name: "Entrézon · Plan 01",
        type: "IfcZone",
        memberIds: model.objects
          .filter((o) => o.level === "Plan 01")
          .map((o) => o.expressId),
      },
      {
        id: "offices",
        kind: "zones",
        name: "Kontorszon · Plan 02–04",
        type: "IfcZone",
        memberIds: model.objects
          .filter((o) => o.level !== "Plan 01")
          .map((o) => o.expressId),
      },
    );
  }
  return models;
}
