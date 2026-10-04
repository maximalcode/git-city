# Der Probelauf-Modus gilt für das gemeinsame Repository

Alle Worktrees desselben Repositorys teilen einen Probelauf-Modus. Neue
Repositorys beginnen im automatischen Modus. Bei Repositorys, die Git City schon
vor Einführung der Funktion kannte, wird die Auswahl einmalig erfragt und danach
gespeichert.

Eine Einstellung pro Worktree wurde verworfen, weil dieselbe Git-Aktion sonst je
nach geöffnetem Arbeitsordner überraschend anders behandelt würde. Die einmalige
Frage schützt bestehende Nutzer zugleich davor, dass ein App-Update ihren
gewohnten Ablauf unangekündigt umstellt.
