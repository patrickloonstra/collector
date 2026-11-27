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
- Sneltoetsen op het beeld onder de muis (of het geopende beeld): L love, C collect (naar de verzamelbak linksonder, `bak*`), X weggooien naar de prullenbak (het beeld krimpt weg en de rest schuift op, `shrinkAway`, `wallRemove`), spatie voorbeeld. Verder F volledig scherm, H herontdekken, ⌘K snelmenu.
- Geen kleurbolletjes in de zijbalk; zoeken op kleur zit in het snelmenu.
- Beweging hoort erbij, maar respecteer `prefers-reduced-motion` (`calm`).
- Elke start: een kort openingsscherm (logo, naam, getypte begroeting in een willekeurige taal, krabbelpatroon) dat naar beneden wegveegt. Alleen de allereerste keer volgt de uitleg in drie stappen (`onboarded` in de app-instellingen).
- De gegevens van een beeld staan in een zwevend, inklapbaar venster rechts, nooit vastgeklikt aan de rand. Op het canvas opent het bij één klik.
- Het venster heeft geen titelbalk. Linksonder staan alleen Instellingen en een plus (toevoegen). Status, opslag, back-up, versie, extensie en kopen staan in Instellingen.
- De hoofdhandeling is beelden erin slepen; knoppen daarvoor blijven klein.
- Meldingen (update, aanbieding, nieuws) zijn gestapelde kaartjes linksonder (`notes*`), weg te klikken en terug te lezen in Instellingen > Nieuws. Nieuws komt uit `site/nieuws.json` op de website; links mogen alleen naar patrickloonstra.nl wijzen.
- Rechtsklik op een beeld geeft een ruim menu om het aan een collectie toe te voegen (`itemMenu`).
- Delen (`openShare`, `drawPolaroid`, `sharePdf`) maakt van een collectie een polaroid, een verhaal of een PDF. Alles wordt in de app zelf getekend; de PDF is met de hand opgebouwd (`buildPdf`), zonder bibliotheek.
- Geen AI die beelden naar buiten stuurt. Ordenen met AI loopt via de MCP-server (`mcp/server.js`) en de assistent van de gebruiker zelf; de gebruiker zet dat aan in Instellingen > AI-assistent (kijken en ordenen apart, standaard uit; bewaard als `mcp` in de bibliotheek en afgedwongen door de motor in `server/server.js`). De uitleg is `openAssistantHelp`. **Nog niet openbaar:** de instelling verschijnt pas na `mcp` in het snelmenu, en website, README en wijzigingenlijst noemen de functie niet. De gebruiker kondigt haar later apart aan.
- Dubbele beelden (`dupGroups`, `dupIndex`, `cleanDups`): elk beeld krijgt een vingerafdruk van het bestand (`hash`, SHA-256 van het bestand bij toevoegen) en van wat er te zien is (`ph`). Hetzelfde bestand opnieuw toevoegen wordt overgeslagen; wat al dubbel is staat in de zijbalk onder "Dubbele beelden" met een driehoekje. Opruimen gaat altijd naar de prullenbak.
- Eén bibliotheek: er is geen kiezer meer. Onderin de zijbalk staan "Instellingen" (voluit) en de plus. De code voor meer bibliotheken bestaat nog; wisselen kan alleen via het snelmenu als er meer dan één is.
- Love geeft een rimpeling over het beeld (`ripple`) en een hartje; de golf loopt door naar de beelden eromheen en dooft uit met de afstand (`dropWave`).
- Snelle weergave (spatie) kan inzoomen (`qlZoomInit`): wiel of knijpen op de plek van de muis, slepen, plus en min onderin, 0 terug.
- Soort beeld (`renderSoort`, keuzelijst `#soort` naast sorteren): filtert op de soorten uit `AI_LABELS` die het lokale beeldmodel als tag zet.
- Ruimte besparen (`optimizeAll`) zet grote JPG's en PNG's om naar WebP; het origineel verhuist naar `Prullenbak/`.

## Beeldmerk en README

- Icoon: een handgeschreven C in heel donkergroen (`#062b1e`) op wit, `build/icon.svg`. Krabbelpatroon in dezelfde kleur: `build/krabbels.js`.
- `node build/dmg-background.js` tekent de achtergrond van het installatievenster opnieuw.
- `python3 docs/maak-voorbeelden.py <map>` en daarna `node docs/maak-media.js <map>` maken de kop en de bewegende schermopname voor de README opnieuw. Doe dat na een zichtbare wijziging aan de vorm. Gebruik in de openbare repo alleen eigen voorbeeldbeelden, nooit werk van anderen.

## Wat we niet doen in de vormgeving

De gebruiker is ontwerper en herkent standaardoplossingen meteen. Vermijd in de app en op de website:

- één woord in een kop cursief of in een andere letter zetten als accent;
- kleine labels in hoofdletters met extra letterafstand boven koppen, velden of blokken;
- rijen identieke kaartjes met een kopje en twee regels tekst;
- genummerde bolletjes, nepvensters met drie stippen, knoppen die bij aanwijzen omhoog zweven, schaduwen en glas waar een lijn volstaat;
- korte slagzinnen in twee delen ("Een gewone map. Meer niet.") en koppen die iets beloven in plaats van benoemen.

Schrijf koppen als gewone zinnen of gewone namen. De app gebruikt één lettertype (Instrument Sans), met alleen in de begroeting op het openingsscherm een schreefletter. De website volgt op verzoek van de gebruiker de stijl van hey.pi.ai: crème achtergrond (`#FAF3EA`), bijna zwarte tekst, donkergroen, grote rustige koppen in normale dikte, ronde donkere knoppen, en één letter voor alles (Fraunces, vrij te gebruiken; Pi zelf gebruikt het betaalde Grenette Pro).

## Valkuilen die al eens misgingen

- **Noem een map in `userData` nooit `cache`.** macOS maakt geen verschil tussen hoofd- en kleine letters, en Chromium beheert zelf `Cache` en maakt die leeg. Onze map heet daarom `Collector-miniaturen`.
- **Een test die zelf een server speelt mag niet blokkerend wachten** (`spawnSync`), anders kan hij niet antwoorden en hangt de app.
- **De cache mag altijd verdwenen zijn.** Maak mappen aan vlak voor je erin schrijft of leest.

- **Fouten horen in het logboek** (`collector.log` in `userData`, te openen via Help > Toon logboek). De gebruiker kan geen terminal lezen; vraag om het logboek.

## Uitbrengen

Elke push bouwt en test de app via GitHub Actions op een Mac (Apple Silicon, bewust geen Intel-versie). Een release komt er alleen als de versie in `package.json` nog niet is uitgebracht: verhoog voor elke release het laatste cijfer (0.1.1, 0.1.2, ...), ook in `package-lock.json`, en zet bovenaan `WIJZIGINGEN.md` wat er nieuw is, in gewone taal. De release bevat `Collector-<versie>.dmg` (eerste installatie), `Collector-<versie>.zip` (waarmee de app zichzelf bijwerkt, zie `app/updater.js`) en de extensie.

De repo is openbaar, en dat moet zo blijven: de app leest de lijst met releases zonder in te loggen om zichzelf bij te werken. Zet dus nooit geheimen in deze repo. Er is geen Apple Developer-account: de app is alleen lokaal ("ad hoc") ondertekend (`build/adhoc-sign.js`), dus de gebruiker moet hem de eerste keer via Systeeminstellingen > Privacy en beveiliging openen. Automatisch bijwerken kan daardoor nog niet op de standaardmanier.

## De website

De landingspagina met demo staat op `dev.patrickloonstra.nl/collector` (repo `patrickloonstra/dev`, map `collector/`). De bron staat hier in `site/`; op dev staat alleen het resultaat.

- Bouwen: `python3 docs/maak-voorbeelden.py <map>` en dan `node site/bouw.js <doelmap> <map>`. Zet de inhoud van de doelmap in `collector/` van de dev-repo en push daar naar `main`.
- De demo is de echte interface uit `ui/` met `data-demo` (eigen voorbeeldbeelden, geen AI-model).
- "Wat is er nieuw" wordt gemaakt uit `WIJZIGINGEN.md`. Bouw en publiceer de website dus opnieuw na elke release.
- `site/nieuws.json` is de lijst met meldingen die de app toont (aanbieding, nieuws). Leeg is `[]`.
- Prijs: € 9 eenmalig, 7 dagen proberen. De app dwingt de proefperiode nog niet af.
