# LiraIFC

En lokal IFC-viewer med LiraStructureWebs formspråk. Modellträdet ligger i högerinspektorn tillsammans med Egenskaper, Sparade vyer och Granska.

[Öppna LiraIFC](https://andreassvensson87-dev.github.io/LiraIfcWeb/) · [GitHub](https://github.com/andreassvensson87-dev/LiraIfcWeb)

## Starta

Kräver Node.js 20.19+ eller 22.12+ och pnpm.

```sh
pnpm install
pnpm dev
```

Öppna adressen som Vite visar, normalt http://127.0.0.1:5173.

```sh
pnpm test
pnpm build
```

`dist/` innehåller den byggda statiska appen inklusive IFC-worker och WASM-parser. Servera mappen via HTTP; öppna inte index.html direkt som en lokal fil.

GitHub Actions kör tester och produktionsbygge vid ändringar i `main` och publicerar appen på GitHub Pages. Pull requests kör samma kontroller utan publicering.

## Funktioner

- Flera IFC-modeller samtidigt, bearbetade i en worker med web-ifc.
- DXF och DWG som CAD-referenser i samma 3D-vy: linjer, 3D-polylinjer, bågar, cirklar, block, text samt fyllda 3DFACE-, SOLID/TRACE-, polyface-, polygonmesh- och MESH-ytor med bibehållna höjder, med tänd/släck per lager och objekt. Enhet, höjd, förskjutning och rotation sparas lokalt. DWG 3DSOLID konverteras automatiskt till mesh lokalt, med bevarade lager, färger, blockplacering och mjuka normaler. Ofullständiga solider och objekttyper utan stöd redovisas.
- Inspektorn fälls ihop med pilen överst i flikraden. Flikraden ligger kvar och val av flik öppnar panelen igen.
- Geometri grupperad i renderingsbatcher med bibehållen objektidentitet.
- Modellträd som följer IFC-filens rumsliga struktur, med sökning och objekttypfilter.
- Väljare för IFC-struktur, system, zoner och objekttyper med gemensam synlighet mellan indelningarna.
- System och zoner läses från IFC-relationer; objekt utan tillhörighet finns under Ej tilldelat system respektive Ej tilldelad zon.
- Tänd/släck efter modell- och grennamn, inklusive våningar, med synligt blandat läge vid delvis dolda objekt.
- Objektval, flerval, fokusering, isolering och IFC-egenskaper.
- Rektangelmarkering med vänsterdrag: blå ruta från vänster till höger väljer helt inneslutna objekt, grön ruta från höger till vänster väljer berörda objekt. Shift lägger till; Esc avbryter. Snitt och synlighet respekteras.
- Perspektiv, ortografiska vyer, färgsättning och valbara kantlinjer.
- Vykub som följer kameran: klickbara sidor, kanter och hörn, dragrotation, 90°-pilar och hemknapp. Mjuka vyövergångar behåller zoom och rotationscentrum.
- Navigation som i LiraStructureWeb: vänsterklick väljer, mitten/högerdrag panorerar, Shift/Ctrl/Cmd + mitten/högerdrag roterar runt träffad modellpunkt och scroll zoomar mot pekaren.
- Mus/styrplatta väljs i inställningsfönstret. Styrplattans tvåfingerscroll panorerar och nypning zoomar.
- Inställningsknappen i toppfältet öppnar navigationsinställningar för zoomhastighet 25–400 %, inverterad scrollzoom och dämpad orbit. De sparas lokalt och gäller direkt; zoomhastigheten kan återställas till 100 %.
- Snittplan i X/Y/Z och justerbar snittbox med fyllda, skrafferade snittytor.
- Punktmätning i meter med snap till hörn på träffad triangel.
- Sparade kameravyer med synlighet och snitt; PNG-skärmbilder.
- Lokal lagring av importerade filer i IndexedDB och vyer i localStorage.
- En märkt demomodell med arkitektur, stomme och installationer.

Filer skickas inte till någon server. Den lokala lagringen hör till webbläsaren och webbplatsens adress. Rensad webbplatsdata tar bort sparade filer och vyer.

## Avgränsningar

Ingen inloggning, molnlagring, delning eller ärendehantering. Snitt har fyllda, skrafferade ytor för slutna volymer. Fyllningen förutsätter slutna, korrekt orienterade volymer; öppna ytor kan ge ofullständiga snitt. Transparenta material som glas undantas från fyllningen. Mätning snappar till triangelhörn och modellens synliga yta, inte analytiska IFC-kanter. På snittytan mäts den träffade punkten direkt. Viewern renderar med Y som höjdaxel och behåller ett gemensamt lokalt origo mellan importerade modeller. Samordning förutsätter att filerna använder samma ursprungliga koordinatsystem; manuell koordinatkorrigering ingår inte ännu. Sparade vyer kräver att deras ursprungliga modellidentiteter finns i den lokala sessionen.

Ett lokalt före/efter-test med en offentlig IFC på 72,9 MB, 11 124 objekt och 1,56 miljoner trianglar finns i [prestandarapporten](docs/performance.md). Träfftest och snappning använder ett BVH-index från [three-mesh-bvh 0.9.16](https://github.com/gkjohnson/three-mesh-bvh) (MIT). Resultatet är inte ett generellt löfte om modellstorlek eller FPS för andra modeller och datorer.

Specifikation och designreferens finns i `docs/specifikation.md` och `docs/design/modellvisare-koncept-v2.png`.

## CAD-komponenter

DXF-parsern använder [dxf-parser 1.1.2](https://github.com/gdsestimating/dxf-parser) (MIT). DWG läses lokalt i en separat worker med [@mlightcad/libredwg-web 0.7.15](https://github.com/mlightcad/libredwg-web) och GNU LibreDWG (GPL-3.0); respektive projekts licens- och källkodsvillkor gäller för dessa komponenter. Endast DWG-import laddar DWG-läsaren och dess WASM-fil. Ingen ritningsdata skickas till en konverteringstjänst. DXF-expansionen för 2D-objekt är anpassad från LiraStructureWeb.

DWG-solidkonverterarens källkod och bygginstruktioner finns i [tools/solid-mesh](tools/solid-mesh/README.md). Den använder opencadcodec och opencadkernel (MPL-2.0); genererad JS/WASM ligger i src/solid-mesh och laddas enbart när DWG-solider behöver konverteras.

Demomodellen innehåller också DWG_Solider.dwg med låda, cylinder, sfär och ring. De konverteras via den vanliga DWG-importen och visas framför byggnaden, med DWG-referensen överst i modellträdet.
