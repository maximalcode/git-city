# Probeläufe bewahren Signierung, führen aber keine Repository-Hooks aus

Probeläufe und ihre Übernahme führen keine Repository-Hooks aus. Git City weist
in der Vorschau ausdrücklich darauf hin; direkte Aktionen im Modus `Off` behalten
das heutige Hook-Verhalten. Ein Hook-Opt-in wird nicht angeboten, weil Code aus
dem Repository auch aus einer Sandbox heraus beliebige externe Nebenwirkungen
haben könnte. Die Übernahme muss als hook-frei garantiert und getestet werden.

Signierungseinstellungen werden dagegen respektiert, weil in der Sandbox erzeugte
Commits später unverändert übernommen werden. Fehlt Schlüssel oder
Signierprogramm, schlägt der Probelauf sichtbar fehl; ein stilles Zurückfallen auf
unsignierte Commits ist ausgeschlossen. Systemdialoge des Signierprogramms dürfen
erscheinen, ein Terminal-Editor wird von Git City nicht geöffnet. Die Vorschau
kennzeichnet den Signaturzustand.

Vorhandene `rerere`-Einstellungen und gespeicherte Konfliktlösungen werden in die
Sandbox kopiert, damit bekannte Lösungen den Probelauf wie im echten Repository
beeinflussen. Neu in der Sandbox entstandene Lösungen werden in der ersten
Version nicht in den echten `rerere`-Speicher zurückgeschrieben; Apply übernimmt
nur das geprüfte Ergebnis und die Vorschau erklärt diese Einschränkung.
