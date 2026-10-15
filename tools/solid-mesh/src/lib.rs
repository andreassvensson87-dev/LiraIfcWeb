use std::io::Cursor;
use codec::{DwgReader, EntityType};
use codec::entities::acis::SabReader;
#[cfg(feature = "fixtures")]
use codec::{DwgWriter, CadDocument, DxfVersion};
#[cfg(feature = "fixtures")]
use codec::entities::acis::primitives;
#[cfg(feature = "fixtures")]
use codec::entities::solid3d::Solid3D;
use serde_json::{json, Value};

use wasm_bindgen::prelude::*;
#[wasm_bindgen]
pub fn convert(bytes: &[u8]) -> String {
    let result = convert_dwg(bytes).unwrap_or_else(|e| json!({"error":e}));
    serde_json::to_string(&result).unwrap()
}
fn convert_dwg(bytes: &[u8]) -> Result<Value, String> {
    let document = DwgReader::from_stream(Cursor::new(bytes)).read().map_err(|e| e.to_string())?;
    let mut solids = Vec::new();
    for entity in document.entities() {
        let EntityType::Solid3D(solid) = entity else { continue };
        let handle = format!("{:X}", solid.common.handle);
        let sat = if solid.acis_data.is_binary {
            SabReader::read(&solid.acis_data.sab_data).ok()
        } else { solid.parse_sat() };
        let Some(sat) = sat else { solids.push(json!({"handle":handle, "complete": false, "error":"ACIS parse failed"})); continue };
        let (bodies, loss) = kernel::acis::lift(&sat);
        let mut positions = Vec::new(); let mut normals = Vec::new(); let mut indices = Vec::new();
        let mut missing = 0;
        for body in &bodies {
            let mesh = kernel::brep::mesh::tessellate(body, kernel::brep::mesh::TessellationTolerance::new(0.12, 1e-6));
            missing += mesh.missing_faces.len();
            let base = positions.len();
            positions.extend_from_slice(&mesh.mesh.positions);
            normals.extend_from_slice(&mesh.mesh.normals);
            indices.extend(mesh.mesh.triangles.iter().flat_map(|t| t.map(|i| i+base)));
        }
        let complete = !bodies.is_empty() && loss.is_empty() && missing == 0 && !indices.is_empty();
        solids.push(json!({"handle":handle, "complete":complete, "missingFaces":missing, "lostSurfaces":loss.surfaces.len(), "lostCurves":loss.curves.len(), "broken":loss.broken.len(), "positions":positions, "normals":normals, "indices":indices}));
    }
    Ok(json!({"entities":document.entity_count(), "solids":solids}))
}
#[cfg(feature = "fixtures")]
#[wasm_bindgen]
pub fn fixture(version: u32) -> Vec<u8> {
    let mut document = CadDocument::with_version(if version == 2000 { DxfVersion::AC1015 } else { DxfVersion::AC1032 });
    for sat in [primitives::build_box([0.,0.,2.],4.,4.,4.), primitives::build_cylinder([7.,0.,0.],2.,5.), primitives::build_sphere([14.,0.,3.],2.), primitives::build_torus([21.,0.,3.],2.,0.6)] {
        let mut solid = Solid3D::new(); solid.set_sat_document(&sat);
        document.add_entity(EntityType::Solid3D(solid)).unwrap();
    }
    let mut bytes = Cursor::new(Vec::new());
    match DwgWriter::write_to_writer(&mut bytes, &document) {
        Ok(()) => bytes.into_inner(),
        Err(e) => e.to_string().into_bytes(),
    }
}

#[cfg(feature = "fixtures")]
#[wasm_bindgen]
pub fn block_fixture() -> Vec<u8> {
    use codec::{Color, Layer, Vector3};
    use codec::tables::BlockRecord;
    use codec::entities::{Insert, Line};
    let mut doc = CadDocument::with_version(DxfVersion::AC1032);
    doc.layers.add(Layer::with_color("Red layer", Color::Index(1))).unwrap();
    doc.layers.add(Layer::with_color("Green layer", Color::Index(3))).unwrap();
    doc.layers.add(Layer::with_color("Own layer", Color::Index(5))).unwrap();
    let mut inner = BlockRecord::new("Inner");
    inner.handle = doc.allocate_handle(); inner.block_entity_handle = doc.allocate_handle(); inner.block_end_handle = doc.allocate_handle(); inner.base_point = Vector3::new(1.,2.,3.);
    let inner_handle = inner.handle; doc.block_records.add(inner).unwrap();
    let mut outer = BlockRecord::new("Outer");
    outer.handle = doc.allocate_handle(); outer.block_entity_handle = doc.allocate_handle(); outer.block_end_handle = doc.allocate_handle(); outer.base_point = Vector3::new(2.,0.,0.);
    let outer_handle = outer.handle; doc.block_records.add(outer).unwrap();
    let mut solid = Solid3D::new(); solid.set_sat_document(&primitives::build_cylinder([2.,3.,4.],1.,2.));
    solid.common.owner_handle = inner_handle; solid.common.color = Color::ByBlock;
    doc.add_entity(EntityType::Solid3D(solid)).unwrap();
    let mut nested = Insert::new("Inner", Vector3::new(5.,0.,0.)).with_scale(2.,3.,4.).with_rotation(std::f64::consts::FRAC_PI_2);
    nested.common.owner_handle = outer_handle; nested.common.color = Color::ByBlock;
    doc.add_entity(EntityType::Insert(nested)).unwrap();
    let mut first = Insert::new("Outer", Vector3::new(100.,200.,10.)).with_scale(-1.,2.,1.).with_rotation(std::f64::consts::PI/6.);
    first.common.layer = "Red layer".into(); doc.add_entity(EntityType::Insert(first)).unwrap();
    let mut second = Insert::new("Inner", Vector3::new(50.,0.,0.));
    second.common.layer = "Green layer".into(); second.common.color = Color::ByBlock;
    // Explicit insert truecolor overrides layer color and is inherited by the ByBlock solid.
    second.common.color = Color::Rgb {r:12,g:180,b:140};
    doc.add_entity(EntityType::Insert(second)).unwrap();
    let mut own = Solid3D::new(); own.set_sat_document(&primitives::build_box([0.,0.,0.],2.,2.,2.));
    own.common.layer="Own layer".into(); own.common.color=Color::Rgb{r:18,g:52,b:86};
    doc.add_entity(EntityType::Solid3D(own)).unwrap();
    doc.add_entity(EntityType::Line(Line::from_points(Vector3::ZERO, Vector3::new(4.,0.,0.)))).unwrap();
    let mut bytes = Cursor::new(Vec::new()); DwgWriter::write_to_writer(&mut bytes,&doc).unwrap(); bytes.into_inner()
}
