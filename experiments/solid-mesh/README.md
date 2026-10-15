# Lokalt prov: DWG 3DSOLID → mesh i webbläsaren

Testvyn är fristående. Samma konverterarkälla används nu även av LiraIFC:s vanliga DWG-import; se tools/solid-mesh/README.md. Inget publicerat.

## Resultat 2026-10-15

**Ja: automatisk konvertering fungerar för de provade soliderna i Chromium, helt lokalt i en Web Worker.** Ingen konverteringstjänst eller installerad CAD-applikation används vid körning.

| Fil | Källa | 3DSOLID | Fullständiga enligt motorn | Trianglar | Konvertering |
| --- | --- | ---: | ---: | ---: | ---: |
| generated-2000.dwg | Egen kontrollfil, codec-genererad | 4 | 4 | 17 174 | ca 101 ms |
| generated-2018.dwg | Egen kontrollfil, codec-genererad | 4 | 4 | 17 174 | ca 128 ms |
| example_2018.dwg | LibreDWG | 1 | 1 | 24 | ca 45 ms |
| sample_AC1032.dwg | ACadSharp | 2 | 2 | 28 | ca 64 ms |

Två ytterligare kontrollfiler (LibreDWG sample_2018 och 2000/entities-3d) innehöll inga direkt lästa 3DSOLID och räknas inte som lyckade solidprov. Testtiderna gäller dessa små filer på den aktuella datorn och exkluderar hämtning/initialisering av WASM och generering av kontrollfiler.

Kontrollfilerna innehåller låda, cylinder, sfär och torus (ring med hål). Deras volymer beräknade från trianglarna avviker 0 %, 0,16 %, 0,29 % respektive 0,23 % från analytiska volymer. Index och koordinater är giltiga; inga rapporterade förlorade kurvor, ytor eller saknade meshytor. Vyerna kontrollerades visuellt. Inga JavaScript-fel i Chromium.

**Begränsning:** kontrollfilerna skrivs av samma codec som sedan läser dem. De externa filerna ger en oberoende läskontroll, men har bara tre enkla solider. Motorns fullständighetsflagga är en intern kontroll, ingen garanti mot original-CAD:s geometri. Användarens verkliga filer, komplicerade snitt/hål, NURBS, nästlade INSERT, olika blocktransformationer och stora koordinater återstår att verifiera. Detta prov läser direkt tillgängliga Solid3D-entiteter; det expanderar inte block och importerar inte resten av ritningen till testvyn.

## Teknik och källor

- opencadcodec `d36331d9e4f01576cdd29e8420caeb6503675c2c`: DWG-läsning och SAT/SAB-avkodning.
- opencadkernel `60f086bd6200924f9f96f31de4722d1216bb29b9`: ACIS → B-rep → trianglar, med bevarade kroppstransformationer.
- Båda komponenterna anger MPL-2.0. Ingen betald SDK eller licensnyckel används. Respektive licens och notices behöver följa en eventuell distribution.
- Testbryggan är egen kod; ingen kod från OpenCADStudios GPL-applikation har kopierats. Dess [beskrivning av tesselleringen](https://github.com/happyrust/pid-cad/blob/main/docs/tessellation.md) användes som teknisk referens.
- [Geometrimotor](https://github.com/HakanSeven12/opencadkernel), [DWG-codec](https://github.com/HakanSeven12/opencadcodec).
- Externa testfiler: [LibreDWG example_2018](https://github.com/LibreDWG/libredwg/blob/master/test/test-data/example_2018.dwg), [ACadSharp sample_AC1032](https://github.com/DomCR/ACadSharp/blob/master/samples/sample_AC1032.dwg). Nedladdade till temporär katalog, inte inlagda i projektet.

Bygget använder Rust 1.99.0, mål wasm32-unknown-unknown och wasm-bindgen 0.2.129. Cargo.lock låser beroenden. Genererad WASM är cirka 3,4 MiB. Rust installerades isolerat i /tmp/lira-cargo och /tmp/lira-rustup; användarens vanliga utvecklingsmiljö ändrades inte.

## Öppna testet

När appens vanliga utvecklingsserver körs:

http://127.0.0.1:5173/experiments/solid-mesh/index.html

Välj en DWG eller tryck **Testa genererad DWG**. Gröna/blå ytor har godkänts av motorns fullständighetskontroll; orange visar partiell geometri. Tomt resultat anges som noll solider. Varje prov får en ny Worker och en timeout på 60 sekunder. Inga filer skickas till en extern server.

## Bygg om

Med Rust/Cargo och wasm-bindgen-cli 0.2.129 på PATH:

```sh
rustup target add wasm32-unknown-unknown
./experiments/solid-mesh/build.sh
```

Byggutdata i pkg/ och target/ samt testresultat i results/ ignoreras av Git. Experimentsidan ingår inte i appens vanliga Vite-produktionsbygge.

## Automatisk webbläsarkontroll

Med Playwright tillgängligt och utvecklingsservern igång:

```sh
node experiments/solid-mesh/test-browser.mjs /sökväg/till/ytterligare.dwg
```

PLAYWRIGHT_MODULE kan ange en absolut sökväg till Playwright-modulen. PROBE_URL kan ändra adressen. Testet kontrollerar båda genererade DWG-versionerna, giltig geometri och analytisk volym inom 1 %, sparar mesh, skärmbilder och summary.json i results/. Externa filer får en resultatrad; inga krav på antal solider antas för dem.

## Ursprunglig integrationsplan (nu genomförd för DWG)

Behåll nuvarande ritningsimport och komplettera med solidmesh från original-DWG i samma importjobb. Innan detta slås på krävs koppling via DWG-handle, bibehållen lager/färg/blockplacering, gemensamt koordinatursprung före Float32, cache/persistens, avbrytning och tydligt redovisade ofullständiga solider. Runda meshytor bör använda de genererade normalerna för slät visning; öppna eller partiella kroppar ska inte ge falska snittlock. Provets material är dubbelsidigt för inspektion, vilket inte i sig verifierar slutenhet eller orientering.
