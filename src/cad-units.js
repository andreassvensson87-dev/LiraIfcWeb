export const dxfUnits = [
  { name: "Millimeter", code: 4, factor: 1 },
  { name: "Centimeter", code: 5, factor: 10 },
  { name: "Decimeter", code: 14, factor: 100 },
  { name: "Meter", code: 6, factor: 1000 },
  { name: "Kilometer", code: 7, factor: 1000000 },
  { name: "Tum", code: 1, factor: 25.4 },
  { name: "Fot", code: 2, factor: 304.8 },
  { name: "Yard", code: 10, factor: 914.4 },
  { name: "Engelsk mil", code: 3, factor: 1609344 },
  { name: "US survey foot", code: 21, factor: 1200000 / 3937 },
];

// Declared or explicitly chosen units are authoritative. Geometry extents,
// plot scales and filenames cannot safely disambiguate an unlabelled drawing.
export function cadImportUnit(data, record = {}) {
  const saved = record.placement?.unitFactor;
  const valid = (value) => Number.isFinite(value) && value > 0;
  if (data.unitKnown) return valid(saved) ? saved : data.unitFactor;
  if ((record.unitConfirmed || record.demo) && valid(saved)) return saved;
  return null;
}
