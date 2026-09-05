# Ein Probelauf gehört zu seinem ursprünglichen Worktree

Repositorys mit mehreren Worktrees werden unterstützt, aber ein Probelauf gehört
zu genau dem Worktree, in dem er begonnen wurde. Seine Übernahme darf keinen
Branch verschieben, der in einem anderen Worktree ausgecheckt ist. In diesem Fall
stoppt Git City mit einer Erklärung, anstatt Dateien oder Index des anderen
Worktrees automatisch anzupassen.

Diese Unterstützung gehört bereits zur ersten nutzbaren Integration.
git-rehearse muss dafür sicher erweitert werden; seine bisherige Ablehnung von
Repositorys mit mehreren Worktrees lediglich zu entfernen, genügt nicht.

Worktrees teilen Branch-Referenzen, besitzen aber jeweils eigenes HEAD, Index und
Arbeitsverzeichnis. Die verworfene Alternative, nur die gemeinsamen Referenzen zu
verschieben, ließe einen anderen Worktree mit widersprüchlichem Zustand zurück.
Die strengere Regel begrenzt zwar mögliche Übernahmen, bewahrt dafür die
Eigenständigkeit jedes Arbeitsstands.

Probeläufe dürfen in mehreren Worktrees gleichzeitig laufen. Überschneiden sich
die Branches, die sie verändern würden, kann nur das zuerst übernommene Ergebnis
angewendet werden. Diese Übernahme verändert die gemeinsame Referenz und macht
den anderen Probelauf veraltet; dessen Arbeit bleibt sichtbar, aber gesperrt.
Details der sicheren Erkennung werden erst in der Spezifikation festgelegt.
