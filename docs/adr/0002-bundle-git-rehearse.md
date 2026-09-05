# Git City liefert git-rehearse mit

Die fertige Integration liefert eine passende git-rehearse-Version mit Git City
aus. Nutzer sollen für diese Funktion kein zweites Programm installieren müssen;
eine separat installierte Version genügt nur für Entwicklungstests.

Die Entscheidung nimmt zusätzlichen Aufwand für plattformspezifische Pakete und
gemeinsame Auslieferung in Kauf, damit die Funktion ohne zusätzliche Einrichtung
verfügbar ist. Sie ist eine gezielte Erweiterung gegenüber der bisherigen
Projektvorgabe, keine neuen Laufzeitabhängigkeiten einzuführen, keine allgemeine
Freigabe zusätzlicher Abhängigkeiten. Git City und die mitgelieferte Version
werden gemeinsam getestet und aktualisiert; ein unabhängiges stilles Update des
Werkzeugs findet nicht statt. Kompatibilität und Migration bestehender Probeläufe
gehören deshalb zum gemeinsamen Update. Vor der Auslieferung muss für jede von
Git City unterstützte Plattform und Architektur ein passendes Programm vorliegen,
einschließlich Intel-macOS. Die Funktion wird auf keiner offiziell unterstützten
Plattform durch eine nachträgliche manuelle Installation ersetzt. Die Auslieferung
ist noch nicht umgesetzt.

Fehlt das mitgelieferte Programm, ist es beschädigt oder passt es nicht zur
Plattform, wird der Probelauf-Modus mit einer Reparatur- oder
Aktualisierungsmeldung gesperrt. Im automatischen Modus darf dieser Fehler niemals
still die echte Git-Aktion ausführen. Direkte Ausführung wird erst wieder möglich,
wenn der Nutzer den Modus bewusst ausschaltet.
