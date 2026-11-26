# Collector

Mac-app (Electron) voor beeldreferenties. De gebruiker is ontwerper, geen ontwikkelaar: schrijf uitleg in gewoon Nederlands.

## Uitgangspunten

- **Bestanden blijven gewone bestanden.** De bibliotheek is een map (`Beelden/`, `Prullenbak/`, `collector.json`), standaard `~/Pictures/Collector`, verplaatsbaar naar bijvoorbeeld een NAS. Zie `server/library.js`.
- **Nooit iets definitief wissen.** Verwijderen verplaatst naar `Prullenbak/`. Bestaande bestanden worden nooit overschreven (dubbele naam krijgt een volgnummer).
- **Afgeleide data hoort niet in de bibliotheekmap** maar in de cache (miniaturen, AI-vingerafdrukken). Een netwerkschijf mag traag of weg zijn.
- **De motor luistert alleen op 127.0.0.1** en weigert verzoeken van andere websites (Origin-controle plus de kop `X-Collector`).
- **Geen bouwstap voor de interface.** `ui/` is gewone HTML, CSS en JavaScript. `ui/app.js` kiest zelf de opslag: `HttpDB` in de app, `IdbDB` in een losse browser.
- **Vormgeving:** Atlas (atlasformac.com) is de basis. Rustig, bijna kleurloos, beelden in rijen, zwevende balk onderin.

## Testen

- `node test/mcp.js` test de MCP-server (geen extra afhankelijkheden).
- `node test/run.js` test motor en interface in een echte browser (Playwright met browsers nodig; gebruikt `test/fixtures/`).
- `node test/extension.js` test de extensie samen met de motor (Playwright met browsers nodig, poort 4317 moet vrij zijn).
- `node test/app.js` test de echte app-schil via het venster: bestanden kiezen, slepen, instellingen, logboek. Op Linux met `xvfb-run -a`. Met `COLLECTOR_APP_BIN=<pad naar Collector>` test hij de gebouwde app; de workflow doet dat op de Mac.
- `node test/ui.js` test de vorm: ontdekwand, sneltoetsen L en C, verzamelbak, zijbalk (Playwright met browsers nodig). Met `SHOTS=<map>` bewaart hij schermafbeeldingen; bekijk die na elke wijziging aan de vormgeving.
- `node test/update-mac.js <pad naar Collector.app>` test het bijwerken van oud naar nieuw; draait alleen op macOS (in de workflow).
- Zelftest van de app: `COLLECTOR_SMOKE=1 COLLECTOR_LIBRARY=<tijdelijke map> COLLECTOR_USERDATA=<tijdelijke map> npx electron .` voegt één beeld toe en controleert of het bestand in de map staat. De workflow doet dit op een echte Mac met de gebouwde app.

## Vorm

- De app opent in **Ontdek** (een eindeloze, drijvende wand, `wall*` in `ui/app.js`), niet in een lijst. Raster is de tweede keuze.
- Sneltoetsen op het beeld onder de muis: L love, C collect (naar de verzamelbak linksonder, `bak*`), spatie voorbeeld, F volledig scherm, ⌘K snelmenu.
- Geen kleurbolletjes in de zijbalk; zoeken op kleur zit in het snelmenu.
- Beweging hoort erbij, maar respecteer `prefers-reduced-motion` (`calm`).

## Beeldmerk en README

- Icoon: een handgeschreven C in heel donkergroen (`#062b1e`) op wit, `build/icon.svg`. Krabbelpatroon in dezelfde kleur: `build/krabbels.js`.
- `node build/dmg-background.js` tekent de achtergrond van het installatievenster opnieuw.
- `python3 docs/maak-voorbeelden.py <map>` en daarna `node docs/maak-media.js <map>` maken de kop en de bewegende schermopname voor de README opnieuw. Doe dat na een zichtbare wijziging aan de vorm. Gebruik in de openbare repo alleen eigen voorbeeldbeelden, nooit werk van anderen.

## Valkuilen die al eens misgingen

- **Noem een map in `userData` nooit `cache`.** macOS maakt geen verschil tussen hoofd- en kleine letters, en Chromium beheert zelf `Cache` en maakt die leeg. Onze map heet daarom `Collector-miniaturen`.
- **Een test die zelf een server speelt mag niet blokkerend wachten** (`spawnSync`), anders kan hij niet antwoorden en hangt de app.
- **De cache mag altijd verdwenen zijn.** Maak mappen aan vlak voor je erin schrijft of leest.

- **Fouten horen in het logboek** (`collector.log` in `userData`, te openen via Help > Toon logboek). De gebruiker kan geen terminal lezen; vraag om het logboek.

## Uitbrengen

Elke push bouwt en test de app via GitHub Actions op een Mac (Apple Silicon, bewust geen Intel-versie). Een release komt er alleen als de versie in `package.json` nog niet is uitgebracht: verhoog voor elke release het laatste cijfer (0.1.1, 0.1.2, ...), ook in `package-lock.json`, en zet bovenaan `WIJZIGINGEN.md` wat er nieuw is, in gewone taal. De release bevat `Collector-<versie>.dmg` (eerste installatie), `Collector-<versie>.zip` (waarmee de app zichzelf bijwerkt, zie `app/updater.js`) en de extensie.

De repo is openbaar, en dat moet zo blijven: de app leest de lijst met releases zonder in te loggen om zichzelf bij te werken. Zet dus nooit geheimen in deze repo. Er is geen Apple Developer-account: de app is alleen lokaal ("ad hoc") ondertekend (`build/adhoc-sign.js`), dus de gebruiker moet hem de eerste keer via Systeeminstellingen > Privacy en beveiliging openen. Automatisch bijwerken kan daardoor nog niet op de standaardmanier.

## Het webprototype

Op `dev.patrickloonstra.nl/collector` (repo `patrickloonstra/dev`, map `collector/`) staat het prototype waar `ui/` uit is voortgekomen. De bron van de interface staat vanaf nu hier.
