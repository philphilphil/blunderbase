# Dein KI-Assistent

## Was ist die Seite „Assistent“?

Blunderbase enthält keine eigene KI. Unter **Assistent** verbindest du die, die du ohnehin
benutzt: jeden Client, der MCP spricht. Blunderbase stellt unter `/mcp` streamable HTTP
bereit, unter derselben Adresse wie die Web-App. Der Assistent liest also dieselbe Datenbank
wie die App: deine Partien, keine Allgemeinplätze.

## Einen Schlüssel erzeugen

Gib unter **Bearer-Schlüssel** einen Namen ein und erzeuge den Schlüssel. Das Geheimnis
wird nur einmal angezeigt, kopiere es also, bevor du **Fertig** drückst. Erzeuge einen
Schlüssel pro Client; **Widerrufen** zieht einen einzelnen zurück. Dein Passwort wird auch
akzeptiert, aber ein Passwort in einer Konfigurationsdatei liegt im Klartext auf der Platte.

## Einen Client verbinden

Die Seite zeigt fertige Schnipsel mit dem gerade erzeugten Schlüssel: einen Einzeiler für
Claude Code, zwei Zeilen für Codex und JSON für jeden anderen Client. Kopiere den, den du
brauchst.

## Was kann der Assistent? { #what-can-the-coach-do }

Er durchsucht deine Partien, öffnet eine, findet Stellungen, liest den Eröffnungs-Explorer
und die Lichess-Referenzdatenbanken, liefert Statistiken, schreibt und durchsucht Notizen,
pflegt Repertoire-Varianten, reiht Analysen ein und berichtet über die Warteschlange. Er
kann außerdem eine Partie oder eine Stellung auf das [Live](live.md)-Brett legen, damit
ihr beide dasselbe seht.

## Was er nicht kann

Alles, was Geheimnisse oder die Installation selbst betrifft. `runners_status` sagt ihm,
welche Engine-Rechner verbunden sind und worauf der Rückstau wartet; einen Runner anmelden
oder widerrufen kannst nur du. Engines, Schlüssel und Einstellungen ändert er nie.

## Die schreibgeschützte Demo

Eine Installation, die als öffentliche Demo läuft, beantwortet jede Leseanfrage und lehnt
jede Schreibanfrage ab. Ein Assistent, der darauf zeigt, kann also nachsehen, aber nicht
importieren, notieren oder analysieren.
