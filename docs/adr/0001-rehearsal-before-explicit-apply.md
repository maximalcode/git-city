# Probelauf und Übernahme bleiben getrennte Entscheidungen

Die bestätigte Produktrichtung für die git-rehearse-Integration umfasst Merge,
normales und interaktives Rebase, einzelne Cherry-picks, mehrere Worktrees sowie
die direkte Konfliktbearbeitung in der Sandbox. Pull mit Rebase bleibt außerhalb
dieses Umfangs. Der Probelauf-Modus ist pro Repository einstellbar: automatisch
(Standard), ausdrücklich angefordert oder aus. Ein fehlgeschlagener oder
abgelehnter automatischer Probelauf stoppt die Aktion; er wird nicht still durch
die Ausführung im echten Arbeitsverzeichnis ersetzt.

Auch nach der Konfliktlösung wird zuerst der Probelauf abgeschlossen und sein
endgültiges Ergebnis gezeigt. Erst die ausdrückliche Bestätigung der Übernahme
darf den echten Arbeitsstand verändern. Damit automatisiert der Standard die
Prüfung, nicht die Zustimmung zu ihren Folgen. Ein dauerhaft erzwungener Modus
und eine automatische Übernahme nach der Konfliktlösung wurden zugunsten der
Nutzerkontrolle verworfen.

Ändert sich der ursprüngliche Worktree währenddessen, bleibt der Probelauf samt
Konfliktlösung erhalten, wird aber als veraltet markiert und für die Übernahme
gesperrt. Offene und bearbeitete Probeläufe überleben einen Neustart und werden
nicht zeitgesteuert gelöscht; Git City zeigt ihren Speicherverbrauch und bietet
bewusstes Verwerfen an.

Ein Worktree darf mehrere offene Probeläufe besitzen. Einer wird als aktuell
hervorgehoben, ältere bleiben als Historie sichtbar. Textkonflikte und
Binärkonflikte werden mit den bereits in Git City verfügbaren Möglichkeiten in
der Sandbox gelöst; Lösch- und Umbenennungskonflikte werden zunächst ausdrücklich
an einen externen Editor übergeben. Die letzte Übernahme kann über die
git-rehearse-Sicherheitsprüfungen rückgängig gemacht werden; veränderte Branches
führen zu einer Ablehnung statt zu einem erzwungenen Rücksetzen.

Die Vorschau besitzt ein eigenes Panel für Branches, Commits, Dateien, Konflikte,
unerwartete Inhaltsänderungen und mitgenommene lokale Arbeit. Zusätzlich kann die
Stadt zwischen dem Zustand vor und nach dem Probelauf wechseln; zwei parallele
3D-Szenen sind nicht erforderlich. Das Schließen des Panels bewahrt den
Probelauf. Ein Abbruch stoppt die laufende Aktion und bewahrt ihren Zustand.
Gelöscht wird ausschließlich über ein bestätigtes Verwerfen.

Git City zeigt den gesamten Speicherverbrauch der Probeläufe und erlaubt deren
einzelne oder gemeinsame Verwaltung. Knapp werdender Speicherplatz erzeugt eine
Warnung, aber keine automatische Löschung.

Die englische Oberfläche nennt die Funktion `Rehearse` und verwendet `Apply`,
`Keep`, `Discard` und `Undo Apply`; die Modi heißen `Automatic`, `Ask` und `Off`.
`Dry Run` wird vermieden, weil Git in der Sandbox tatsächlich ausgeführt wird.
Vor jeder Übernahme zeigt ein Bestätigungsdialog den ursprünglichen Worktree, die
Aktion, betroffene Branches und lokale Änderungen. `Apply rehearsal` genügt als
bewusste Bestätigung; unmittelbar davor werden die Sicherheitsbedingungen erneut
geprüft und eine unzulässige Übernahme gesperrt.

Der gesamte Ablauf einschließlich Konfliktlösung, Übernahme, Verwerfen und
Rückgängigmachen ist per Tastatur bedienbar. Fokusführung macht den nächsten
Schritt eindeutig; Warnungen werden mit Text und Symbolen statt ausschließlich
mit Farbe vermittelt.

Dies dokumentiert die am 5. September 2026 bestätigten Entscheidungen aus
[Issue #139](https://github.com/maximalcode/git-city/issues/139), keine bereits
implementierte Funktion. Sie bilden die Grundlage für die folgende Spezifikation.
