# DWG solid mesh converter

The generated JavaScript and WebAssembly in this directory are built from the LiraIFC Rust bridge in `tools/solid-mesh`, using:

- opencadcodec, MPL-2.0, https://github.com/HakanSeven12/opencadcodec at d36331d9e4f01576cdd29e8420caeb6503675c2c.
- opencadkernel, MPL-2.0, https://github.com/HakanSeven12/opencadkernel at 60f086bd6200924f9f96f31de4722d1216bb29b9.
- wasm-bindgen 0.2.129 (MIT OR Apache-2.0) and the dependencies locked in tools/solid-mesh/Cargo.lock.

The MPL-2.0 license is included in MPL-2.0.txt. The upstream repositories at the revisions above provide the corresponding source and copyright notices for those components. LiraIFC's bridge does not modify those upstream components. Rebuild instructions and bridge source are included in tools/solid-mesh. No application source code from OpenCADStudio is used.
