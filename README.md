# Collector

Een Mac-app om beeldreferenties te verzamelen, te ordenen en terug te vinden. Je bestanden blijven gewone bestanden in een map die jij kiest.

## Waar staat alles?

Standaard in `~/Pictures/Collector` (Afbeeldingen > Collector). Die map is gewoon zichtbaar in Finder en gaat mee in je back-up.

```
Collector/
  Beelden/         je bestanden, met hun eigen naam
  Prullenbak/      wat je verwijdert; er wordt nooit iets definitief gewist
  collector.json   titels, tags, collecties, notities en links
```

- **Zelf bestanden toevoegen kan via Finder:** zet ze in `Beelden/` en ze verschijnen in de app zodra je het venster weer activeert.
- **Andere plek, bijvoorbeeld je NAS:** klik linksonder op "Andere map". Koppel de netwerkschijf eerst in Finder. Is hij een keer niet bereikbaar, dan vraagt de app bij het starten wat je wilt doen.
- **Miniaturen en de zoekindex** staan niet in die map maar in `~/Library/Application Support/Collector/Collector-miniaturen`. Die zijn afgeleid en worden vanzelf opnieuw opgebouwd.

## Installeren

1. Ga naar [Releases](../../releases) en download het nieuwste `.dmg`. De app is er alleen voor Macs met een Apple-chip (M1 en nieuwer).
2. Open het bestand en sleep Collector naar Programma's.
3. De app is niet door Apple ondertekend. De eerste keer weigert macOS hem te openen. Ga naar Systeeminstellingen > Privacy en beveiliging, scrol naar beneden en klik "Open toch". Daarna start hij gewoon.

Daarna werkt Collector zichzelf bij: hij kijkt bij elke start of er een nieuwere versie is, downloadt die en installeert hem als je de app afsluit. Dat werkt alleen als deze repo openbaar is en de app in Programma's staat. Je bibliotheekmap wordt bij een update niet aangeraakt.

## Sneltoetsen

| Toets | Wat |
|---|---|
| L | Love: het beeld onder je muis wordt een favoriet |
| C | Collect: het beeld gaat naar je verzameling linksonder |
| Spatie | Snel voorbeeld |
| F | Volledig scherm |
| ⌘K | Snelmenu: acties, collecties, tags, beelden, zoeken op kleur |
| + en − | Zoomen (of ⌘ + scrollen) |
| N | Nieuwe notitie |
| R | Herontdek een willekeurig beeld |
| ⌘, | Instellingen |

## Bewaren vanuit je browser

Bij elke release zit `Collector-extensie.zip`. Daarmee bewaar je een beeld zonder de pagina te verlaten: rechtsklik op het beeld en kies "Bewaar beeld in Collector", of houd Alt (⌥) ingedrukt en klik erop. Staat de app open, dan landt het beeld rechtstreeks in je bibliotheekmap, met de pagina als bron.

- **Zen en Firefox:** pak het zip-bestand uit, open `about:debugging`, kies "Deze Firefox" (in Zen: "Deze Zen"), klik "Tijdelijke add-on laden" en kies `manifest.json`. Dit verdwijnt na een herstart van de browser; voor blijvend gebruik moet Mozilla de extensie ondertekenen.
- **Chrome, Arc, Brave, Edge:** pak het zip-bestand uit, open `chrome://extensions`, zet "Ontwikkelaarsmodus" aan, klik "Uitgepakte extensie laden" en kies de map.

## Agents (MCP)

Claude, Cursor en andere agents kunnen in je bibliotheek zoeken zolang de app open staat. Er gaat niets naar buiten; de koppeling praat met de app op je eigen Mac.

Voor Claude Code:

```bash
claude mcp add collector --env ELECTRON_RUN_AS_NODE=1 -- /Applications/Collector.app/Contents/MacOS/Collector /Applications/Collector.app/Contents/Resources/app.asar/mcp/server.js
```

Voor Cursor (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "collector": {
      "command": "/Applications/Collector.app/Contents/MacOS/Collector",
      "args": ["/Applications/Collector.app/Contents/Resources/app.asar/mcp/server.js"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

Standaard kan een agent alleen lezen (`search_library`, `list_collections`, `get_item`). Zet `COLLECTOR_MCP_WRITE` op `1` in `env` om ook tags, notities en links te laten toevoegen. Verwijderen kan een agent nooit.

## Ontwikkelen

```bash
npm install
```

```bash
npm start
```

Zonder app-venster, in je browser:

```bash
npm run serve
```

Testen (vereist Playwright en een map met een paar JPG- of PNG-bestanden):

```bash
node test/run.js /pad/naar/testbeelden
```

```bash
node test/mcp.js
```

## Opbouw

| Map | Wat |
|---|---|
| `ui/` | De interface (gewone HTML, CSS en JavaScript, geen bouwstap). Draait ook los in een browser met opslag in IndexedDB |
| `server/` | De motor: leest en schrijft de bibliotheekmap en levert de interface, alleen bereikbaar vanaf deze computer |
| `app/` | De Electron-schil: venster, mapkeuze, standaardmap |
| `mcp/` | MCP-server voor agents |
| `extension/` | Browserextensie (rechtsklik, Alt-klik, werkbalkknop). Bewaart in de app als die open staat, anders in de webversie |
| `.github/workflows/build.yml` | Bouwt bij elke push de app op een Mac, test hem daar en zet het `.dmg` klaar onder Releases |
