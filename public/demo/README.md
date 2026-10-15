# DWG_Solider.dwg

Egen genererad DWG 2018-testfil med fyra riktiga ACIS 3DSOLID: låda, cylinder, sfär och torus. Genereras med fixture(2018) i tools/solid-mesh (fixtures-feature), via den lokala experimentvyn. Inga kunddata eller externa ritningsfiler ingår.

Appens demomodell hämtar filen med vanlig CAD-worker och omvandlar soliderna automatiskt. Referensen placeras i meter framför byggnaden (X=-10, Z=-12). Testfilen sparas inte som en användarfil i IndexedDB och försvinner med övriga demomodellen när en egen fil öppnas.
