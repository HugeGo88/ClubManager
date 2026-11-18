# ClubManager-Handbuch

Dieses Handbuch beschreibt die in dieser Version verfügbaren Funktionen. ClubManager arbeitet lokal und funktioniert ohne Internetverbindung.

## Erste Schritte und Navigation

1. Öffnen Sie **Einstellungen → Allgemein** und wählen Sie einen Datenordner. ClubManager erstellt darin für jedes Modul einen Unterordner. Über das Auswahlmenü oben können Sie registrierte Datenordner wechseln; mit **Datenordner hinzufügen** nehmen Sie weitere Ordner auf. Unter **Einstellungen → Allgemein** können Sie die Bezeichnung des aktiven Ordners ändern. Ein Wechsel verschiebt keine vorhandenen Daten.
2. Aktivieren oder deaktivieren Sie Module im jeweiligen Einstellungsbereich. Standardmäßig ist nur **Sitzungen** aktiviert. **Mitglieder** und **Rechnungen** sind noch Platzhalter.
3. Wählen Sie ein Modul in der Seitenleiste. Mit **C** können Sie die Beschriftungen ein- oder ausblenden; die Einstellung bleibt gespeichert. In der schmalen Seitenleiste zeigt ein Tooltip den Namen.
4. **Handbuch**, **Versionsverlauf** und **Einstellungen** sind auch ohne aktivierte Module erreichbar. Der Versionsverlauf öffnet sich beim ersten Start einer neuen Version und zeigt bei datierten Einträgen das Veröffentlichungsdatum.

## Sitzungen

Wählen Sie **Sitzungen → Neue Sitzung**, geben Sie Titel und Datum ein und erfassen Sie bei Bedarf Protokollführer/in und Teilnahme. Datumsfelder zeigen das deutsche Format (TT.MM.JJJJ); die Kalenderwoche beginnt am Montag. Fügen Sie Tagesordnungspunkte (TOPs) hinzu und wählen Sie deren Typ: Information, Diskussion oder Entscheidung.

Details können in Markdown geschrieben und mit den Formatierungsschaltflächen bearbeitet werden. Aufgaben unter einem TOP haben eine Beschreibung, Verantwortliche und optional ein Fälligkeitsdatum. Bei Entscheidungen können Sie ein Abstimmungsergebnis und gegebenenfalls Stimmenzahlen erfassen. Neue Aufgaben können nur bei Informations- und Diskussionsthemen hinzugefügt werden.

Speichern Sie die Sitzung mit **Sitzung speichern** oder Strg+S (auf macOS auch Cmd+S). Die Liste kann nach Titel oder Datum durchsucht werden. Vor einem Datenordnerwechsel können Sie ungespeicherte Änderungen speichern, verwerfen oder den Wechsel abbrechen. Wenn das Speichern fehlschlägt, bleiben Ordner und Änderungen erhalten.

Mit **Protokoll schreibgeschützt** schützen Sie den Inhalt vor versehentlichen Änderungen. Speichern Sie die Sitzung, um die Einstellung dauerhaft zu übernehmen. Zum Aufheben des Schreibschutzes entfernen Sie das Häkchen und bestätigen den Dialog. Aufgaben können auch bei aktiviertem Schreibschutz in der Sitzung oder in der Aufgabenübersicht erledigt und wieder geöffnet werden. Änderungen in der Sitzung müssen gespeichert werden. Der Schreibschutz ist kein Zugriffsschutz für die Dateien.

Mit **PDF exportieren** erstellen Sie ein Protokoll des gespeicherten Stands. Das gespeicherte PDF kann geöffnet und in der App angezeigt werden; spätere Änderungen erfordern einen erneuten Export. Optional können offene Aufgaben früherer, datierter Sitzungen einbezogen werden. Dies setzt ein gültiges Datum der aktuellen Sitzung voraus.

## Sitzungsübersichten

- **Offene Aufgaben** zeigt gespeicherte offene Aufgaben. Überfällige offene Aufgaben stehen in einer eigenen Tabelle darüber; die Zahl am Symbol zählt alle überfälligen offenen Aufgaben unabhängig von Filtern. Mit **Erledigte Aufgaben anzeigen** erscheinen auch abgeschlossene Aufgaben in der unteren Tabelle. Sie können beide Tabellen durchsuchen, nach Verantwortlichen filtern, sortieren, TOP-Details anzeigen und Aufgaben direkt erledigen oder wieder öffnen.
- **Entscheidungen** zeigt Entscheidungen mit Suche und Ergebnisfilter. Details und die zugehörige Sitzung lassen sich öffnen.
- **Alle TOPs** durchsucht und filtert die TOPs gespeicherter Sitzungen; Details und die zugehörige Sitzung lassen sich öffnen.
- **Statistiken** zeigt aktuelle Aufgabenzahlen und einen geschätzten Verlauf. Der Verlauf verwendet Sitzungs- und Erledigungsdaten; er ist keine vollständige Aufgabenhistorie.

## Briefe

Aktivieren Sie **Briefe** unter **Einstellungen → Briefe**. Mit **Neuer Brief** erstellen Sie einen einzelnen Brief. Geben Sie Titel, Datum und den Briefinhalt in Markdown ein. Die Liste gespeicherter Briefe kann nach Titel oder Datum durchsucht werden.

Mit **Adressfeld einfügen** blenden Sie die Felder für Firma, Name, Straße, PLZ und Ort ein. Wenn kein Adressfeld benötigt wird, lassen Sie die Option ausgeschaltet. Bereits eingegebene Werte bleiben beim Ausblenden erhalten.

Unter **Einstellungen → Briefe** können Sie Unterschriftsbilder hinzufügen. Wählen Sie im Brief die gewünschten Unterschriften per Checkbox. Die Originaldateien bleiben an ihrem Speicherort und müssen beim Export verfügbar sein.

Speichern Sie den Brief und wählen Sie **PDF exportieren**. Das gespeicherte PDF zeigt den Stand des letzten Exports. Serienbriefe und die Auswahl von Mitgliedern als Empfänger sind noch nicht verfügbar.

## PDF-Gestaltung

Unter **Einstellungen → Allgemein** können Sie eine gemeinsame CSS-Datei für PDF-Dokumente auswählen. Sie ersetzt das Standardlayout und wird bei jedem Export neu gelesen. Unter **Einstellungen → Sitzungen** und **Einstellungen → Briefe** können Sie jeweils eine eigene HTML-Vorlage auswählen; ohne Vorlage wird das Standardlayout verwendet. Sitzungsprotokolle können die optionale Protokollführung mit `{{recorder}}` ausgeben.

Die verfügbaren Platzhalter stehen in den jeweiligen Einstellungen. Fehlende oder ungültige Dateien werden beim Export als Fehler angezeigt. Bereits exportierte PDFs ändern sich nicht automatisch.

## Daten und Aktualisierungen

ClubManager speichert Daten in den jeweiligen registrierten Ordnern. Erstellen Sie regelmäßig Sicherungskopien. Die Daten sind nicht verschlüsselt; Änderungen durch mehrere gleichzeitig laufende Instanzen werden nicht synchronisiert. Bei einem Konflikt laden Sie den aktuellen Stand erneut, bevor Sie speichern.

Bei unterstützten installierten Versionen prüft ClubManager beim Start auf Updates. Eine neue Version wird automatisch heruntergeladen und installiert; der Startbildschirm informiert Sie darüber. Währenddessen startet ClubManager neu.

Unter Ubuntu prüft das installierte `.deb`-Paket beim Start auf Aktualisierungen. Für die Installation kann eine Bestätigung mit Administratorrechten erforderlich sein. Wenn die Installation fehlschlägt, können Sie das neue Paket aus den GitHub Releases herunterladen und manuell installieren.
