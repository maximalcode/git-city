# Übernahme bindet den ausdrücklich geprüften Ergebnisstand

Ein Probelauf kann nach Continue oder einer anderen Werkzeugaktion unter derselben ID ein anderes Ergebnis besitzen. Eine Übernahme benennt deshalb zusätzlich den geprüften Ergebnisstand. git-rehearse prüft diesen unter seiner Ausführungssperre und übernimmt denselben geprüften Kandidaten; Git City verwendet dessen öffentliche Endpunktbeschreibungen für Diff und Stadt.

Ein vorheriger Vergleich allein in der App ließe zwischen Prüfung und CLI-Aufruf eine Lücke. Die gewählte Garantie benötigt deshalb eine Werkzeugerweiterung und kompatible Release-Artefakte. Sie gilt für kooperierende Werkzeugoperationen; beliebige externe Dateisystemzugriffe werden durch eine CLI-Sperre nicht kontrolliert. Die Ergebnisrevision ist kein geheimes Berechtigungsmerkmal. Bestehende unbedingte CLI-Aufrufe können ihre bisherigen, getrennt dokumentierten Garantien behalten; Git City fällt nicht still auf sie zurück.

Der Eigentümer hat diese Entscheidung einschließlich Review-first-Ansicht, dauerhaften Konfliktentwürfen und ausdrücklichem Apply ohne zusätzliche Datei-Abhakpflicht im Rahmen von Git City #195 bestätigt. Dies beschreibt das vereinbarte Ziel, nicht eine bereits ausgelieferte Funktion.
