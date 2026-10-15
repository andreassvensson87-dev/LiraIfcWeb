# Prestandatest av stor IFC – 2026-10-15

Testet kördes lokalt med den vanliga filimporten, utan publicering eller uppladdning av modeller.

## Modell och testmiljö

- Offentlig IFC från [web-ifc:s testmodeller](https://github.com/ThatOpen/engine_web-ifc/blob/3351cbabc832b12dbb17ff15e22abc441947eb71/tests/ifcfiles/public/ISSUE_098_R8_F1_MAB_AR_M3_XX_XXX_MO_7000.ifc).
- Filstorlek: 72 882 778 byte (72,9 MB).
- 11 124 renderade objekt, 1 564 719 trianglar, 3 533 089 vertexposter, 17 renderingsbatchar.
- SHA-256: `08ab44c7a0e68efe6c1722c54235b405c0d649195254d92f964eaa47438aa62e`.
- Apple M5, 16 GB RAM, macOS, Chromium 151, ANGLE Metal (hårdvaruacceleration), 1440 × 1000, skärmskala 1.
- Lokal Vite-server, färsk webbläsarkontext per körning. Appen och demot är färdigladdade innan tidtagningen för IFC-importen startar. Laddtiden omfattar filval, lokal lagring, IFC-worker, geometri, modellträd och två bildrutor.
- En fullständig referenskörning före ändringen och tre efter. Det är ett praktiskt riktat test, inte ett generellt kapacitetstak. Windows, andra GPU:er, kantlinjer och aktiva snitt kan ge andra resultat.

## Resultat

| Mått | Före | Efter |
| --- | ---: | ---: |
| Laddtid | 4,00 s | 4,53–4,58 s |
| Rotation | 60,1 FPS | 60,1–60,4 FPS |
| Rotation: P95 bildintervall | 17,0 ms | 17,3–17,8 ms |
| Tyngsta punktens första snaprespons | 30 162 ms | 45–57 ms |
| Tyngsta punktens snaprespons med varm cache | 35 928 ms | 9,6–10,6 ms |
| Träfftest, P95 | 65 ms | 0,2–0,3 ms |
| Geometrins CPU-buffertar | 207,1 MB | 188,4 MB |
| Sökindexets CPU-buffertar | – | 19,2 MB |
| Huvudsidans V8-heap efter GC | 21,7 MB | 22,1 MB |
| Huvudsidans totala backing storage efter GC | 210,5 MB | 211,2 MB |

Rotationen är synkroniserad till ungefär 60 bildrutor/sekund. Testet visar att den nivån hålls, inte att GPU:ns högsta möjliga bildfrekvens har uppmätts. CPU-tiden för att skicka rendering är inte samma sak som GPU-tid.

Snaptestet använder samma 16 pekarlägen i två pass; fem lägen träffar modellen och flera andra ligger på tom bakgrund. Därför är medianen över alla lägen missvisande låg. Tabellen visar det tyngsta läget per pass. P95 med bara 16 prov är samma prov som maxvärdet. Första passet inkluderar uppbyggnad av objektens snapgeometri, andra använder den uppvärmda cachen. Tid för snaprespons omfattar både resolver och highlight; separat träfftest mäts före detta.

### Minnesmätningens gränser

Totalt resident minne för den isolerade Chromium-instansens processer varierade omkring **1,8–2,2 GB**, inklusive IFC-workern, WebAssembly och GPU-processen. Det är en summa RSS-ögonblicksbilder som kan dubbelräkna delade sidor och påverkas av macOS minneskomprimering. Det är inte exakt privat appminne eller en uppmätt minnestopp. Worker-heap och GPU-minne ingår inte i huvudsidans V8-/backing-storage-tal. Filstorleken kan alltså inte användas som RAM-behov.

Inget minskningspåstående görs för totalt processminne. Den kontrollerbara buffertmätningen visar att borttagna indexkopior i stort sett finansierar det nya sökindexet: extra main-thread backing storage är bara cirka 0,7 MB i dessa körningar. Geometribuffertarna i tabellen inkluderar inte GPU-kopior.

## Ändringar

1. Renderingsbatcharna använder ett BVH-index via `three-mesh-bvh` 0.9.16 för meshträffar. Indexet byggs med indirection, så att ursprunglig triangelordning, IFC-identitet, objektranges, rektangelmarkering och geometrisnappning behålls.
2. När inget snitt är aktivt söks bara närmaste träff per mesh. Vid klippning behålls djupare träffar, så att en bortklippt framsida inte blockerar synlig geometri längre bak. Samma acceleration används för snappningens skymningskontroll.
3. Sökindexet återanvänds vid oförändrad synlighet, byggs om när de synliga objekten ändras och refittas när IFC-geometrin flyttas. CAD-linjer använder fortsatt sin tidigare linjeträffning.
4. När alla objekt visas delar GPU-indexattributet och modellens ursprungsindex samma CPU-array. Två onödiga kopieringssteg vid uppbyggnad/visning är borttagna.

Den största flaskhalsen var många fullständiga meshträfftest per snapläge. Förbättringen kostar ungefär en halv sekund extra vid import för detta exempel. Renderingens geometri/detaljnivå är oförändrad. IFC-tolkens minnesåtgång är fortsatt ett viktigt område för större filer.

## Upprepa testet

Installera projektets beroenden och starta `pnpm dev`. Benchmarkskriptet behöver Playwright med installerad Chromium; ange dess modul via `PLAYWRIGHT_MODULE` om den inte finns i vanlig Node-modulupplösning.

```sh
PLAYWRIGHT_MODULE=/absolut/sökväg/till/playwright/index.mjs \
  node tools/performance/benchmark.mjs /absolut/sökväg/modell.ifc /tmp/resultat.json 3
```

`LIRA_BENCH_URL` kan peka på en annan lokal Vite-instans, till exempel en separat referenskopia av koden. Kör jämförda benchmarkserier i turordning, med samma modell och maskin. Det första Vite-anropet kan behöva värmas upp om nya beroenden orsakar en full omladdning. Rådata: [före](performance/large-ifc-before.json), [efter](performance/large-ifc-after.json).

Modellfilen ingår inte i Git, appens demodata eller byggresultatet.

## Stresstest: snittbox, kantlinjer och modellborttagning

Samma IFC och Metal-miljö provades i en separat serie. Fem öppningar/borttagningar per serie, inklusive användning av mätning/snappning före borttagning. Minnet lästes efter garbage collection och en avslutad bildruta. Kantlinjer och olika snittboxlägen roterades i 60 bildrutor per läge. Före/efter-serierna kördes i separata webbläsare. Det är korta stickprov; FPS varierar med GPU-belastning, och antal skickade trianglar är ett stabilare jämförelsetal.

| Kontroll | Före rättningar | Efter rättningar |
| --- | ---: | ---: |
| Snittbox vid modellens yttergräns + kantlinjer | 212 draw calls / 20,0 miljoner trianglar per bildruta | 38 draw calls / 1,59 miljoner trianglar |
| Snittbox 20–80 % + kantlinjer | 212 draw calls / 20,0 miljoner trianglar per bildruta | 146 draw calls / 12,8 miljoner trianglar |
| FPS, yttergräns / aktivt snitt, med kantlinjer | 47,6 / 61,4 | 60,2 / 60,1 |
| Onödig ny kantlinjebyggnad när inget ändrats | 1 626 ms | under mätupplösningen (0 ms) |
| Huvudsidans array/backing storage efter borttagning | cirka 215,6 MB, kvar efter samtliga fem cykler | cirka 3,8 MB efter samtliga fem cykler |
| Kvarhållna snap-bounds efter borttagning | 11 124 | 0 |
| GPU-geometrier efter borttagning | 2 | 2 |
| IFC-workers efter borttagning | 0 | 0 |

Både före och efter återstår två basgeometrier för vyn; det är inga kvarvarande modellgeometrier. Efter rättningen var huvudsidans heap cirka 7,4–7,6 MB efter borttagning. Ingen växande retention av modellbuffertar syntes under de fem cyklerna. Detta är inte ett löfte om att alla möjliga minnesläckor är uteslutna, och inte en mätning av totalt OS-RAM eller GPU-byte.

Den första aktiveringen av kantlinjer tog fortfarande cirka 1,9 sekunder i slutkörningen. Optimeringen återanvänder färdiga kantlinjer när positioner och synligt index är oförändrade; avstängning frigör dem. Ändrad geometri eller ändrat synligt index kräver ny beräkning för berörda batchar. Ingen automatisk förenkling eller dold geometri har införts för att höja bildfrekvensen.

### Hittade fel och åtgärder

- Snap-resolverns skärmbounds behöll objekt, batchar och därmed hela geometribuffertar efter modellborttagning. Reset tömmer nu även dessa referenser och kamerastämplar, så att garbage collection kan frigöra modellen utan att användaren först behöver snappa i nästa modell.
- Kantlinjer byggdes om vid upprepade identiska anrop och vid synlighetsuppdateringar som inte berörde batchen. De återanvänds nu så länge positionsversion och indexattribut är oförändrade. Ändringar och avstängning invaliderar/frigör rätt data.
- Snittfyllningen ritade alla opaka IFC-batchar för samtliga boxsidor, även tangentplan och helt ensidiga batchar. Sådana stencilpass hoppas nu över. Batchar som korsar planet renderas fortfarande i sin helhet, så att fyllningens orienterade ytberäkning och hål bevaras.
- Stora opaka IFC-partier grupperas nu rumsligt vid import. Det gör att snitten kan hoppa över fler hela batchar. Objektidentiteter, material, verklig geometri och detaljnivå behålls. CAD och transparenta partier får inte denna omordning.
- Trädets utfällda nod-ID:n, isoleringsnycklar och workerreferensen städas vid borttagning av referensen.

Ett separat instrumenterat test med aktiva snitt och kantlinjer visade noll nya renderingar/worker-meddelanden under 2,5 sekunders stillastående. Vid vyrotation behölls samma geometri-, index-, BVH- och kantlinjeobjekt; varken snitt eller kantlinjer byggdes om.

Rådata: [före](performance/stress-before.json), [efter](performance/stress-after.json). Upprepa med:

```sh
PLAYWRIGHT_MODULE=/absolut/sökväg/till/playwright/index.mjs \
  node tools/performance/stress.mjs /absolut/sökväg/modell.ifc /tmp/stress.json 5
```

En slutkontroll med den rumsliga batchningen gav 4,42 s laddning, 60,4 FPS och 9,8 ms för det tyngsta varma snapläget. [Rådata för slutkontrollen](performance/large-ifc-current.json).
