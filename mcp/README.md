# Koppeling voor AI-assistenten

Nog niet aangekondigd. In de app verschijnt de instelling pas als je in het snelmenu (⌘K) `mcp` typt.

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

De koppeling staat standaard uit. Zet hem aan in de app: Instellingen > AI-assistent. Daar staat ook de kant-en-klare regel om te kopiëren en kies je of de assistent mag ordenen.

Alleen kijken: `search_library`, `list_collections`, `get_item`, `view_items`. Met ordenen aan ook: `add_tags`, `remove_tags`, `set_details`, `add_to_collection`, `remove_from_collection`, `add_note` en `add_link`. Verwijderen kan een agent nooit, en zijn eigen rechten aanpassen ook niet.

