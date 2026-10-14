# LiraIFC viewerspecifikation

Uppdaterad 13 oktober 2026. LiraIFC är en lokal IFC-viewer med LiraStructureWebs formspråk och modellgranskning inspirerad av Trimble Connect. Nuvarande omfattning är enbart visning och granskning. Samarbete, inloggning, ärenden, delning och molnlagring ingår inte.

## Arbetsytan

Toppfältet är 54 px högt i petrol `#192f35`. Under det ligger Liras ljusa kommandoband med grupperna Modell, Urval, Granska, Utseende och Vyer. 3D-modellen får hela den återstående ytan till vänster om högerinspektorn.

Modeller ligger i högerinspektorn som en egen flik. Flikarna är Modeller, Egenskaper, Sparade vyer och Granska. En panel visas åt gången. Panelbyte behåller kamera, objekturval och synlighet. På mindre skärmar kan inspektorn fällas undan.

| Del | Utformning |
| --- | --- |
| Typografi | Inter med systemfont som reserv |
| Kommandoband | 124 px på desktop, komprimerat på mindre skärmar |
| Text | `#253e48`, sekundär text i dämpad gråblå ton |
| Accent | Grön `#287c65`, markerat läge `#dbece6` |
| Arbetsyta | Ljusgrå `#e9eef0`, vita paneler |
| Ramar | Tunna linjer `#d3dcdf`, 4–6 px hörnradie |
| Högerinspektor | Cirka 340 px inklusive 40 px vertikal ikonlist |
| Statusrad | 44 px, modellantal, objektantal, urval och vykontroller |

Stilreferenser är LiraStructureWebs `src/lira-shell.css`, `src/ui/workspace.css` och `src/model/ui/model-chrome.css`.

## Viewerns funktioner

| Område | Funktion |
| --- | --- |
| Öppna modeller | Flera IFC-filer genom filväljare eller drag och släpp |
| IFC-import | Separat worker, status under bearbetning och begripligt importfel |
| Modellträd | Modellens faktiska IFC-hierarki, exempelvis projekt, site, byggnad, våning och utrymme. Tänd/släck efter modell- och grennamn styr alla underliggande objekt och visar delvis synliga grenar. Ingen separat modellista ovanför trädet |
| Indelning | Väljare för IFC-struktur, System, Zoner och Objekttyper. Samma objektsynlighet och urval gäller i samtliga indelningar |
| Sökning | Namn, IFC-klass, GlobalId och våning; separat filter för objekttyp |
| Navigering | LiraStructureWebs musgester: mitten/högerdrag panorerar, Shift/Ctrl/Cmd + mitten/högerdrag ger orbit runt träffad modellpunkt och scroll zoomar mot pekaren. Vänsterklick väljer objekt. Mus/styrplatta väljs i inställningsfönstret |
| Navigationsinställningar | Zoomhastighet 25–400 % i steg om 5 %, återställning till 100 %, inverterad scrollzoom samt orbit-dämpning av/på. Sparas lokalt och gäller direkt. Nypning påverkas inte av inverteringen |
| Projektion | Perspektiv och ortografisk projektion; topp-, fram-, sido- och isometrisk vy |
| Urval | Klick, flerval med Shift/Ctrl/Cmd + klick. Högerklick i modellen eller på en objektrad i modellträdet öppnar Info, Fokusera, Visa, Göm och Isolera för hela urvalet. Högerdrag fortsätter att panorera. Markering behåller aktuell inspektorflik; Info öppnar egenskaper. Klick på grennamnet markerar grenen; Shift + klick lägger till eller tar bort grenar. Högerklick på en markerad gren gäller unionen av alla markerade grenar utan dubbla objekt, även för överlappande system och zoner. Trädets pil fäller ut eller ihop grenen. Högerklick på våning, gren eller modellrot markerar alla grenens objekt, oberoende av sökfilter, och erbjuder Fokusera, Visa, Göm och Isolera. Isolera återvisar även tidigare dolda objekt i grenen. Ingen hovertext vid pekaren, flytande objektpanel eller rubrik över modellvyn |
| Egenskaper | IFC-identitet, attribut, property sets, material och typdefinitioner när filen innehåller dem |
| Utseende | Originalfärger, disciplinfärger, färg efter IFC-klass, kantlinjer och rutnät |
| Snitt | Snittplan i X/Y/Z med läge och vänd riktning; snittbox med sex gränser. Slutna, opaka volymer får fyllda och skrafferade snittytor |
| Mätning | Punktavstånd i meter, snap till hörn på träffad triangel och redovisning av axelavstånd |
| Sparade vyer | Kamera, projektion, snitt, modellidentiteter och synlighet |
| Skärmbilder | Export av den aktuella 3D-vyn som PNG |
| Lokal lagring | IFC-filer i IndexedDB, vyer och inställningar i localStorage |
| Demo | Märkt byggnadsmodell med arkitektur, stomme och installationer |

Filerna stannar på användarens enhet. Modeller i samma session delar renderingsorigo. Originalets placering används och ett gemensamt origo dras bort i dubbel precision innan koordinaterna skrivs till GPU-geometrin. Viewern renderar i meter och använder Y som höjdaxel.

## Tekniskt genomförande

Webbklienten använder Vite och JavaScript. Three.js äger rendering, kamera, raycasting och klippning. web-ifc läser IFC i en worker och behåller modellen där för egenskapsförfrågningar. Geometri grupperas i renderingsbatcher med objektintervall så att objektval och synlighet fungerar utan en separat draw call för varje IFC-objekt.

Objektidentiteten består av modellens identitet och IFC-objektets Express ID. GlobalId visas som IFC-identitet. Sparade vyer är bundna till de ursprungliga lokala modellidentiteterna och får inte återställas mot andra filer enbart därför att filnamnen matchar.

Vid borttagning av en modell avslutas dess worker och geometrins GPU-resurser frigörs. Vyer som refererar till den borttagna modellen markeras som otillgängliga. Webbläsarens webbplatsdata är den lokala lagringsgränsen; om den rensas försvinner modellerna och vyerna.

## Verifieringskrav

- En verklig IFC-fil ska importeras med rätt objektidentitet och enheter.
- Objektval i modellen och modellträdet ska ge rätt egenskaper.
- Synlighet och isolering ska påverka både rendering och träfftestning.
- Modeller med samma Express ID ska ha olika objektidentiteter.
- Mätning ska redovisa verkliga modellavstånd i meter.
- Snitt ska klippa modellen utan att ändra dess geometri.
- En sparad vy ska återställa kamera, snitt och synlighet.
- Lokal återöppning ska fungera efter omladdning av sidan.
- Importfel ska visa ett begripligt meddelande och lämna andra öppna modeller användbara.
- Gränssnittet ska fungera på desktop och med inspektorn som utfällbar panel på mobil.

Prestanda för stora produktionsmodeller behöver mätas med representativa IFC-filer. Modellstorlek och bildfrekvens utlovas först efter sådana mätningar.

## Fortsatt utveckling av viewern

Grundträdet följer filens rumsliga struktur med nodidentiteter från IFC. Nivåer som saknas i filen hittas inte på. Objekt utan koppling till hierarkin visas under Övrigt. Två likadant namngivna våningar i olika byggnader hålls isär. Sökning begränsar vilka rader som visas, men grenens tänd/släck-knapp styr alltid hela grenen.

System, zoner och IFC-klasser visas som alternativa indelningar med samma objektreferenser och synlighetsstyrning. System läses från IfcSystem och dess undertyper, med IfcZone i zonvyn. Zoner läses från IfcZone och IfcSpatialZone. Medlemskap följer explicita IFC-relationer, även via undergrupper, rumsliga noder och objekttyper. Ett objekt kan finnas i flera grupper utan att dess geometri kopieras. Objekt utan tillhörighet finns i en egen gren. Väljaren och grenarnas öppna/stängda lägen behålls när användaren växlar indelning; den valda indelningen sparas lokalt. Indelning efter valfria egenskaper kan tillkomma senare. [buildingSMART om rumslig struktur](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/concepts/Object_Composition/Aggregation/Spatial_Decomposition/content.html) och [grupprelationer](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcRelAssignsToGroup.htm).

Prioriterade utökningar är mer avancerad geometrisnap, snabbare träfftestning för mycket stora modeller, manuell koordinatkorrigering och förbättrad återställning av vyer när filer byts ut. Dessa är viewerfunktioner och kräver inga samarbetsfunktioner.

IFC2x3 och IFC4 är målformat. Kompatibiliteten beror på den importerade filens geometri och parserns stöd och behöver verifieras med användarens modellmaterial.

## Bildreferens

![Modeller i högerinspektorn](design/modellvisare-koncept-v2.png)

Det senaste bildförslaget fastställer placeringen av modellträdet och Liras formspråk. Samarbetsknappar som syns i den tidigare konceptbilden ingår inte i implementationen.

## Appuppdateringar

Toppfältets gröna Uppdatera appen visas när versionskontrollen hittar en ny publicerad version. Kontrollen görs vid start, när appen återfår fokus och var 15:e minut. Användaren startar uppdateringen med knappen; inga automatiska omladdningar. En pågående IFC-import måste bli klar först. Kamera, snitt, synlighet, markering och utseende återställs efter omladdningen; modeller och sparade vyer finns kvar i lokal lagring.

Visa i objekt- och grenmenyn återvisar hela markeringen, även under isolering. Om modellen var släckt visas bara markerade objekt eller grenar; modellens övriga objekt förblir dolda.

Högerklick på modellvyns tomma bakgrund öppnar Visa alla, Anpassa modell och Helskärm. Menyn visas även om objekt är markerade, utan att markeringen ändras. Högerdrag fortsätter att panorera. Den tidigare flytande knappstapeln för passning, zoom och helskärm är borttagen; zoom sker med scroll eller nypning.

## Rektangelmarkering

Vänsterdrag i modellvyn startar rektangelmarkering direkt. Vänster till höger visar en blå ruta med heldragen kant och väljer objekt vars återstående geometri är helt innesluten. Höger till vänster visar en grön ruta med streckad kant och väljer objekt vars ytor berör rutan. Shift vid dragstart lägger till utan att avmarkera tidigare urval; utan Shift ersätts urvalet. Ett kort klick behåller vanlig objektmarkering och Shift/Ctrl/Cmd-flerval.

Urvalet använder objektens verkliga trianglar och snittytor, inklusive öppningar, i perspektiv och ortografisk vy. Påslagna objekt bakom andra objekt ingår. Dolda objekt, släckta modeller, geometri utanför kamerans djupområde och bortklippta delar ingår inte. Objekt med flera delar eller renderingsbatcher behandlas som ett gemensamt IFC-objekt. Kameran pausas under dragningen. Esc, förlorat fönsterfokus eller ändrad viewportstorlek avbryter utan att ändra urvalet. Mätverktygets vänstergester behåller sin funktion.

## Installerad app och ikoner

Appmanifestet anger LiraIFC som namn, fristående appfönster och relativ start-URL/scope för GitHub Pages och lokal preview. Windows installationsikoner (32, 44, 48, 64, 128, 192, 256 och 512 px), favicon och Apple-ikonen är exporter från samma public/lira-icon.svg som används i toppfältet. Ingen separat eller alternativ logga används för installationen. Äldre installationer kan behöva läsa in uppdaterad appmetadata för att få rätt ikon.
