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
- `node test/run.js <map met beelden>` test motor en interface in een echte browser (Playwright nodig).
- Zelftest van de app: `COLLECTOR_SMOKE=1 COLLECTOR_LIBRARY=<tijdelijke map> COLLECTOR_USERDATA=<tijdelijke map> npx electron .` voegt één beeld toe en controleert of het bestand in de map staat. De workflow doet dit op een echte Mac met de gebouwde app.

## Uitbrengen

Elke push bouwt via GitHub Actions een `.dmg` voor Apple Silicon en Intel en zet die als prerelease onder Releases. Er is geen Apple Developer-account: de app is alleen lokaal ("ad hoc") ondertekend (`build/adhoc-sign.js`), dus de gebruiker moet hem de eerste keer via Systeeminstellingen > Privacy en beveiliging openen. Automatisch bijwerken kan daardoor nog niet op de standaardmanier.

## Het webprototype

Op `dev.patrickloonstra.nl/collector` (repo `patrickloonstra/dev`, map `collector/`) staat het prototype waar `ui/` uit is voortgekomen. De bron van de interface staat vanaf nu hier.
