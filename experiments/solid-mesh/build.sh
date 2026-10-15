#!/bin/sh
set -eu
cd "$(dirname "$0")"
cargo build --locked --target wasm32-unknown-unknown --release
wasm-bindgen target/wasm32-unknown-unknown/release/lira_solid_mesh_probe.wasm --target web --out-dir pkg
