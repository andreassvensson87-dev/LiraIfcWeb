# LiraIFC DWG solid converter

Production source for the local, offline 3DSOLID → mesh worker. `src/solid-mesh` contains the generated JS/WASM, so normal `pnpm build` and GitHub Actions do not require Rust.

## Build

Requires Rust (verified with 1.99.0), the wasm32-unknown-unknown target, and wasm-bindgen-cli **0.2.129** on PATH.

```sh
rustup target add wasm32-unknown-unknown
./tools/solid-mesh/build.sh
```

Cargo.lock pins dependency sources. opencadcodec d36331d9e4f01576cdd29e8420caeb6503675c2c and opencadkernel 60f086bd6200924f9f96f31de4722d1216bb29b9 are MPL-2.0. License/source references are in src/solid-mesh/NOTICE.md. No commercial SDK or key is used.

`convert(Uint8Array)` returns JSON containing one source mesh per solid definition, keyed by its hex DWG handle (including uninserted definitions). The JavaScript importer attaches it to the matching DXF placeholder, then expands only actual model-space block instances with their transforms, layer and color inheritance. No bare block definitions are drawn. Geometry stays f64 until the shared model origin and reference placement are applied. Original normals and reflected triangle winding are preserved. Source body transforms are handled by the ACIS kernel; instance transforms are applied once by the drawing importer.

The converter is dynamically imported only for DWG files containing 3DSOLID placeholders, and runs in the existing CAD Worker. Partial tessellation and per-solid failures are reported in import remarks; the rest of the drawing is retained where possible. The engine's complete flag means no known lift/tessellation loss, not a guarantee against every vendor's original model. CAD meshes are clipped but do not yet receive generated section caps. DXF 3DSOLID payloads are not converted by this path.

The `fixtures` feature additionally exports `fixture(version)` and `block_fixture()` for browser QA. The production binary excludes fixture generators and DWG writing. The standalone experiment at experiments/solid-mesh shares this source via include! and enables fixtures; its build script still generates its own pkg/.

## Verification

- Existing CAD/IFC node suite, including independent handle matching, inherited layer/ByBlock/truecolor and nested mirrored nonuniform block transforms.
- Ordinary app import with generated DWG 2000/2018 solids, cylinders/spheres/tori, plus linework.
- Block fixture with repeated cylinder definition, two nested bases, XYZ nonuniform scale, reflection, 30°/90° rotations, layer inheritance, ByBlock color and explicit RGB. Expected world bounds and colors checked.
- Production worker/JS/WASM loading under /LiraIfcWeb/ plus local persistence and IFC coexistence.

The standalone experiment README documents the initial upstream file corpus. Real customer DWGs may expose additional unsupported ACIS variants and should be tested before publication.
