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
- Zelftest van de app: `COLLECTOR_SMOKE=1 COLLECTOR_LIBRARY=<tijdelijke map> COLLECTOR_USERDATA=<tijdelijke map> npx electron .` voegt één beeld toe en controleert of het bestand in de map staat. De workflow doet dit op een echte Mac met de gebouwde app.

## Valkuilen die al eens misgingen

- **Noem een map in `userData` nooit `cache`.** macOS maakt geen verschil tussen hoofd- en kleine letters, en Chromium beheert zelf `Cache` en maakt die leeg. Onze map heet daarom `Collector-miniaturen`.
- **De cache mag altijd verdwenen zijn.** Maak mappen aan vlak voor je erin schrijft of leest.

- **Fouten horen in het logboek** (`collector.log` in `userData`, te openen via Help > Toon logboek). De gebruiker kan geen terminal lezen; vraag om het logboek.

## Uitbrengen

Elke push bouwt via GitHub Actions een `.dmg` voor Apple Silicon (bewust geen Intel-versie) en zet die als prerelease onder Releases. Er is geen Apple Developer-account: de app is alleen lokaal ("ad hoc") ondertekend (`build/adhoc-sign.js`), dus de gebruiker moet hem de eerste keer via Systeeminstellingen > Privacy en beveiliging openen. Automatisch bijwerken kan daardoor nog niet op de standaardmanier.

## Het webprototype

Op `dev.patrickloonstra.nl/collector` (repo `patrickloonstra/dev`, map `collector/`) staat het prototype waar `ui/` uit is voortgekomen. De bron van de interface staat vanaf nu hier.
