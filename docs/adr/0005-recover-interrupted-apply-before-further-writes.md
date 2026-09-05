# Eine unterbrochene Übernahme wird vor weiteren Änderungen wiederhergestellt

git-rehearse führt die Branch-Änderungen einer Übernahme atomar aus, aktualisiert
Arbeitsverzeichnis und mitgenommene lokale Arbeit aber anschließend in getrennten
Schritten. Vor der Git-City-Integration erhält die Übernahme deshalb ein atomar
geschriebenes Phasenprotokoll. Nach einem Absturz erkennt Git City, ob noch keine
Branch-Änderung stattfand oder ob eine begonnene Übernahme kontrolliert
fertiggestellt beziehungsweise aus dem Undo-Protokoll zurückgesetzt werden muss.

Der gesamte Apply-Befehl wird niemals automatisch wiederholt. Solange ein
Wiederherstellungszustand besteht, bleiben weitere schreibende Git-Aktionen
gesperrt. Diese verpflichtende Reparatur nimmt eine Unterbrechung des normalen
Ablaufs in Kauf, damit ein inkonsistenter Arbeitsstand weder übersehen noch durch
weitere Änderungen schwerer rekonstruierbar wird.
