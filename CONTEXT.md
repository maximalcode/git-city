# Git City

Git City verbindet die Darstellung eines Git-Repositorys als Stadt oder Farm mit
der Arbeit an dessen Versionsgeschichte und Arbeitsständen.

## Language

**Probelauf (Rehearsal)**:
Die isolierte Ausführung einer beabsichtigten Git-Aktion, deren Ergebnis vor einer
Übernahme geprüft und bearbeitet werden kann.
_Avoid_: Simulation, wenn damit eine bloße Vorhersage ohne Ausführung gemeint ist.

**Sandbox**:
Die isolierte Arbeitskopie eines Probelaufs, in der auch dessen Konflikte gelöst
werden. Sie ist nicht das echte Arbeitsverzeichnis des Nutzers.

**Übernahme (Apply)**:
Die ausdrücklich bestätigte Übertragung des fertig geprüften Probelaufergebnisses
in den zugehörigen echten Arbeitsstand.
_Avoid_: Erneute Ausführung der ursprünglichen Aktion.

**Probelauf-Modus**:
Die Einstellung, ob unterstützte Aktionen automatisch als Probelauf beginnen,
Probeläufe ausdrücklich angefordert werden oder die Funktion ausgeschaltet ist.

**Worktree**:
Ein eigener Checkout mit eigenem Arbeitsverzeichnis und Index, der mit anderen
Worktrees desselben Repositorys unter anderem die Branches teilt.
_Avoid_: Sandbox als Synonym für einen verknüpften Worktree.

**Veralteter Probelauf**:
Ein erhaltener Probelauf, dessen ursprünglicher Worktree seit seiner Erstellung
verändert wurde. Er kann angesehen, aber nicht mehr übernommen werden.
_Avoid_: Fehlgeschlagener Probelauf.

**Aktueller Probelauf**:
Der innerhalb eines Worktrees hervorgehobene offene Probelauf. Weitere offene
Probeläufe bleiben als Historie erhalten, werden aber nie automatisch übernommen.

**Abgebrochener Probelauf**:
Ein erhaltener Probelauf, dessen Git-Aktion vor ihrem regulären Ende gestoppt
wurde. Er wird nur durch ausdrückliches Verwerfen gelöscht.
_Avoid_: Veralteter Probelauf.

**Wiederherstellungszustand**:
Ein erkannter Zwischenzustand einer Übernahme, der erst kontrolliert abgeschlossen
oder zurückgesetzt werden muss, bevor weitere schreibende Aktionen erlaubt sind.
_Avoid_: Fehlgeschlagener Probelauf.
