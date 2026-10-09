# Proposed domain additions

These definitions are drafted for CONTEXT.md once the scope is approved. They are not a second authoritative glossary.

**Prüfansicht (Rehearse review)**:
Der zusammenhängende Arbeitsbereich zum Prüfen eines Probelaufergebnisses anhand seiner Dateien, Inhalte und räumlichen Darstellung.
_Avoid_: Pull-Request-Review, wenn damit GitHub-Kommentare oder Freigaben gemeint sind.

**Prüfstand**:
Das eindeutig bezeichnete Ergebnis eines Probelaufs, auf das sich eine Inhaltsprüfung und eine gewünschte Übernahme beziehen.
_Avoid_: Probelauf-ID als alleinige Bezeichnung eines unveränderlichen Ergebnisses.

**Vergleichsumfang**:
Die Auswahl der zusammengehörigen Vorher- und Nachher-Inhalte: entweder des ursprünglichen getrackten Arbeitsstands einschließlich mitgenommener Arbeit oder einer betroffenen Referenz.

**Konfliktentwurf**:
Die aufbewahrte Bearbeitung einer Konfliktdatei, die noch nicht ausdrücklich in der Sandbox gespeichert und gestagt wurde.
_Avoid_: Gespeicherte Konfliktlösung, wenn lediglich der Entwurf gesichert ist.

## Proposed ADR if strict result matching is approved

An Apply request names the exact reviewed result revision. The rehearsal ID identifies a retained operation but is insufficient to identify an unchanged result after Continue or external tool activity. Therefore the tool must compare the expected result while holding ownership and apply that same candidate; an app-only precheck is insufficient for this contract. This costs an upstream schema/tool release but makes the cross-process guarantee explicit. Ordinary CLI callers can keep the older unconditional syntax with its separately documented guarantees. This revision is not a secret authorization token.
