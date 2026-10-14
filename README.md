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

Representativa stora modeller behöver provas innan någon övre modellstorlek eller FPS-nivå utlovas.

Specifikation och designreferens finns i `docs/specifikation.md` och `docs/design/modellvisare-koncept-v2.png`.
