# ClubManager-Handbuch

Dieses Handbuch beschreibt die in dieser Version verfügbaren Funktionen. ClubManager arbeitet lokal und funktioniert ohne Internetverbindung.

## Erste Schritte und Navigation

1. Öffnen Sie **Einstellungen → Allgemein** und wählen Sie einen Datenordner. ClubManager erstellt darin für jedes Modul einen Unterordner. Über das Auswahlmenü oben können Sie registrierte Datenordner wechseln; mit **Datenordner hinzufügen** nehmen Sie weitere Ordner auf. Unter **Einstellungen → Allgemein** können Sie die Bezeichnung des aktiven Ordners ändern. Ein Wechsel verschiebt keine vorhandenen Daten.
2. Aktivieren oder deaktivieren Sie Module im jeweiligen Einstellungsbereich für den dort genannten aktiven Datenordner. Die Auswahl wird im Datenordner gespeichert und auf andere Computer mitgenommen. Neue Datenordner starten nur mit **Sitzungen**; bereits vorhandene ClubManager-Ordner übernehmen einmalig die bisherige Modulauswahl. Ohne verwendbaren Datenordner sind die Schalter deaktiviert. **Mitglieder** ist noch ein Platzhalter; unter **Rechnungen** steht der Kalender zur Verfügung. Das Ausblenden eines Moduls löscht keine Daten.
3. Wählen Sie ein Modul in der Seitenleiste. Mit dem App-Symbol oben können Sie die Beschriftungen ein- oder ausblenden; die Einstellung bleibt gespeichert. In der schmalen Seitenleiste zeigt ein Tooltip den Namen.
4. **Handbuch**, **Versionsverlauf** und **Einstellungen** sind auch ohne aktivierte Module erreichbar. Der Versionsverlauf öffnet sich beim ersten Start einer neuen Version und zeigt bei datierten Einträgen das Veröffentlichungsdatum.

Die Überschriften **Sitzungen** und **Rechnungen** öffnen ihre jeweilige Modulansicht und klappen die zugehörigen Unterpunkte ein oder aus.

ClubManager liest die Modulauswahl beim Öffnen oder Wechseln eines Datenordners, beim Aufrufen der Einstellungen und über **Modul-Einstellungen neu laden**. Änderungen auf anderen Computern werden nicht laufend übernommen. Erkennt die letzte Prüfung vor dem Ersetzen der Datei eine Änderung seit dem Laden, lehnt ClubManager das Speichern mit einem Konflikt ab. Laden Sie die Modul-Einstellungen neu, prüfen Sie die Auswahl und nehmen Sie Ihre Änderung erneut vor. Eine Änderung, die erst nach dieser Prüfung und vor dem Ersetzen der Datei geschrieben wird, ist nicht geschützt und kann überschrieben werden.

Ein geöffneter Sitzungs- oder Briefentwurf bleibt beim Aufrufen der Einstellungen erhalten, sofern sein Modul sichtbar bleibt. Würde eine Änderung oder Aktualisierung das bearbeitete Modul ausblenden, können Sie den Entwurf speichern, verwerfen oder abbrechen. Ein Abbruch oder ein Fehler beim Speichern des Entwurfs lässt den Editor und die bisherige Auswahl unverändert. Beim Abbrechen einer Aktualisierung bleiben auch die neueren Einstellungen auf dem Datenträger unverändert.

Fehlende, beschädigte oder nicht lesbare Modul-Einstellungen eines bereits eingerichteten Datenordners werden nicht durch Standardwerte ersetzt. Stellen Sie die Datei wieder her oder wählen Sie einen anderen Datenordner. Scheitert ein Ordnerwechsel, bleibt der bisherige Ordner aktiv. Beim Start ohne verwendbaren Datenordner bleiben Einstellungen und Ordnerauswahl verfügbar.

## Datenordner und Zugriff

Registrierte Datenordner werden in **Einstellungen → Allgemein** aufgelistet. Dort können Sie die Bezeichnung des aktiven Ordners ändern, einen nicht verfügbaren Ordner erneut verknüpfen oder seine Registrierung entfernen.

**Bezeichnung:** ClubManager speichert die Bezeichnung im Datenordner. Sie bleibt beim Verschieben, Kopieren oder erneuten Hinzufügen erhalten. Fehlt bei einem registrierten Ordner die gespeicherte Bezeichnung, übernimmt ClubManager den zuletzt bekannten Namen. Bei einem neuen Ordner ohne gespeicherte Bezeichnung verwendet ClubManager den Verzeichnisnamen. Wenn die Bezeichnung nicht gelesen oder gespeichert werden kann, meldet ClubManager das Problem, ohne den Zugriff auf ansonsten lesbare Daten zu sperren.

**Nicht verfügbare Ordner:** Falls ein registrierter Datenordner verschoben, gelöscht oder das Speichergerät entfernt wurde, zeigt ClubManager ihn als „Nicht verfügbar" an. Der Ordner bleibt registriert und die Daten bleiben erhalten. Sie können einen nicht verfügbaren Ordner weder aktivieren noch verwenden, bis er wieder verfügbar ist oder Sie ihn erneut verknüpfen.

**Erneut verknüpfen:** Mit **Erneut verknüpfen** können Sie einen nicht verfügbaren Ordner mit einem neuen Speicherort verbinden. Dies ist nützlich, wenn der Ordner auf ein anderes Laufwerk verschoben wurde. Die Bezeichnung bleibt erhalten. Wählen Sie den neuen Speicherort aus, und ClubManager verbindet ihn wieder.

**Registrierung entfernen:** Mit **Registrierung entfernen** nehmen Sie einen Ordner aus der ClubManager-Liste auf. Dieser Schritt löscht die Daten **nicht** – der Ordner und alle Dateien bleiben an ihrem Speicherort erhalten und können später manuell wieder hinzugefügt werden. Wenn Sie den aktiven Ordner entfernen, müssen Sie einen anderen Ordner auswählen.

## Sitzungen

Wählen Sie **Sitzungen → Neue Sitzung**, geben Sie Titel und Datum ein und erfassen Sie bei Bedarf Sitzungsleitung, Protokollführer/in und Teilnahme. Sitzungsleitung und Protokollführung können dieselbe Person sein. Datumsfelder zeigen das deutsche Format (TT.MM.JJJJ); die Kalenderwoche beginnt am Montag. Fügen Sie Tagesordnungspunkte (TOPs) hinzu und wählen Sie deren Typ: Information, Diskussion oder Entscheidung.

Details können in Markdown geschrieben und mit den Formatierungsschaltflächen bearbeitet werden. Aufgaben unter einem TOP haben eine Beschreibung, Verantwortliche und optional ein Fälligkeitsdatum. Bei Entscheidungen können Sie ein Abstimmungsergebnis und gegebenenfalls Stimmenzahlen erfassen. Neue Aufgaben können nur bei Informations- und Diskussionsthemen hinzugefügt werden.

Speichern Sie die Sitzung mit **Sitzung speichern** oder Strg+S (auf macOS auch Cmd+S). Die Liste kann nach Titel oder Datum durchsucht werden. Vor einem Datenordnerwechsel können Sie ungespeicherte Änderungen speichern, verwerfen oder den Wechsel abbrechen. Wenn das Speichern fehlschlägt, bleiben Ordner und Änderungen erhalten.

Mit **Protokoll schreibgeschützt** schützen Sie den Inhalt vor versehentlichen Änderungen. In der Sitzungsliste kennzeichnet ein Schlosssymbol neben dem Titel den gespeicherten Schreibschutz. Speichern Sie die Sitzung, um die Einstellung dauerhaft zu übernehmen. Zum Aufheben des Schreibschutzes entfernen Sie das Häkchen und bestätigen den Dialog. Aufgaben können auch bei aktiviertem Schreibschutz in der Sitzung oder in der Aufgabenübersicht erledigt und wieder geöffnet werden. Änderungen in der Sitzung müssen gespeichert werden. Der Schreibschutz ist kein Zugriffsschutz für die Dateien.

Mit **PDF exportieren** erstellen Sie ein Protokoll des gespeicherten Stands. Das gespeicherte PDF kann geöffnet und in der App angezeigt werden; spätere Änderungen erfordern einen erneuten Export. Optional können offene Aufgaben früherer, datierter Sitzungen einbezogen werden. Dies setzt ein gültiges Datum der aktuellen Sitzung voraus.

Mit dem Augensymbol öffnen Sie die PDF-Vorschau. Wählen Sie eine andere Sitzung aus der Liste, bleibt die Vorschau in derselben Breite geöffnet und zeigt das zuletzt exportierte Protokoll ab der ersten Seite. Fehlt das PDF oder kann es nicht gelesen werden, erscheint stattdessen ein Hinweis. Exportieren Sie die gerade ausgewählte Sitzung erneut, schließen und öffnen Sie die Vorschau, um das neue PDF zu sehen.

## Sitzungsübersichten

- **Offene Aufgaben** zeigt gespeicherte offene Aufgaben. Überfällige offene Aufgaben stehen in einer eigenen Tabelle darüber; die Zahl am Symbol zählt alle überfälligen offenen Aufgaben unabhängig von Filtern. Mit **Erledigte Aufgaben anzeigen** erscheinen auch abgeschlossene Aufgaben in der unteren Tabelle. Sie können beide Tabellen durchsuchen, nach Verantwortlichen filtern, sortieren, TOP-Details anzeigen und Aufgaben direkt erledigen oder wieder öffnen.
- **Entscheidungen** zeigt Entscheidungen mit Suche und Ergebnisfilter. Details und die zugehörige Sitzung lassen sich öffnen.
- **Alle TOPs** durchsucht und filtert die TOPs gespeicherter Sitzungen; Details und die zugehörige Sitzung lassen sich öffnen.
- **Statistiken** zeigt aktuelle Aufgabenzahlen und einen geschätzten Verlauf. Der Verlauf verwendet Sitzungs- und Erledigungsdaten; er ist keine vollständige Aufgabenhistorie.

## Briefe

Aktivieren Sie **Briefe** unter **Einstellungen → Briefe**. Mit **Neuer Brief** erstellen Sie einen einzelnen Brief. Geben Sie Titel, Datum und den Briefinhalt in Markdown ein. Die Liste gespeicherter Briefe kann nach Titel oder Datum durchsucht werden.

Mit **Adressfeld einfügen** blenden Sie die Felder für Firma, Name, Straße, PLZ und Ort ein. Wenn kein Adressfeld benötigt wird, lassen Sie die Option ausgeschaltet. Bereits eingegebene Werte bleiben beim Ausblenden erhalten.

Unter **Einstellungen → Briefe** können Sie Unterschriftsbilder hinzufügen. Wählen Sie im Brief die gewünschten Unterschriften per Checkbox. Die Bilder werden in den Anpassungsordner des aktiven Datenordners kopiert.

Für Briefe können Sie unter **Einstellungen → Briefe** benutzerdefinierte Briefplatzhalter mit einem Schlüssel und einem einzeiligen Textwert anlegen. Diese Werte gelten für alle Briefe des aktiven Datenordners. Verwenden Sie eindeutige Schlüssel, die mit einem Kleinbuchstaben beginnen und danach Kleinbuchstaben, Zahlen oder Unterstriche enthalten, zum Beispiel `club_name`; die eingebauten Schlüssel `title`, `date`, `address`, `content` und `signatures` sind reserviert. ClubManager zeigt den passenden Token `{{club_name}}` an und kann ihn in die Zwischenablage kopieren. Verwenden Sie den Token in der HTML-Vorlage oder im Markdown-Briefinhalt. Werte dürfen leer sein und werden als Text, nicht als HTML, eingesetzt.

Speichern Sie den Brief und wählen Sie **PDF exportieren**. Das gespeicherte PDF zeigt den Stand des letzten Exports. Mit dem Augensymbol öffnen Sie das PDF in der Vorschau; die Vorschau lässt sich mit der Maus oder Tastatur in der Breite anpassen. Wählen Sie einen anderen Brief aus der Liste, bleibt dieselbe Breite erhalten und die Vorschau zeigt dessen letzten Export ab der ersten Seite. Fehlt das PDF oder kann es nicht gelesen werden, erscheint stattdessen ein Hinweis. Exportieren Sie den gerade ausgewählten Brief erneut, schließen und öffnen Sie die Vorschau, um das neue PDF zu sehen. Das PDF kann weiterhin über **Gespeichertes PDF öffnen** geöffnet werden. Serienbriefe und die Auswahl von Mitgliedern als Empfänger sind noch nicht verfügbar.

## Online-Kalender unter Rechnungen

Aktivieren Sie das Modul **Rechnungen** und öffnen Sie **Einstellungen → Rechnungen**. Dort können Sie eine einzelne ICS-Abonnementadresse für den aktiven Datenordner speichern oder löschen. Die URL wird in diesem Datenordner gespeichert, folgt beim Wechsel des Datenordners dessen eigener Einstellung und wird mit allen Personen geteilt, die auf diesen Ordner zugreifen. Eine gespeicherte URL kann einen Zugangstoken enthalten; diese URL ist deshalb für alle Personen mit Datenordnerzugriff sichtbar.

HTTPS- und webcal-Adressen werden unterstützt. ClubManager wandelt eine webcal-Adresse in HTTPS um. Tokenisierte HTTPS-Adressen benötigen keine separate Anmeldung in der App. Eine HTTP-Adresse funktioniert nur mit dem sichtbaren Sicherheitshinweis, dass die Verbindung unverschlüsselt und für Mitlesende oder Veränderungen anfällig ist.

Ohne gespeicherte URL erklärt der **Kalender**-Eintrag unter Rechnungen den fehlenden Aufbau und führt zu den Rechnungseinstellungen. Ungültige URLs und nicht erreichbare oder fehlerhafte Kalenderdienste werden ausdrücklich gemeldet. Erfolgreich geladene Kalenderdaten werden zusammen mit dem Abrufzeitpunkt im aktiven Datenordner gespeichert und stehen damit auch auf anderen Computern mit Zugriff auf diesen Ordner zur Verfügung. Beim Öffnen und über **Neu laden** versucht ClubManager, den Kalender zu aktualisieren. Schlägt die Aktualisierung fehl, zeigt die App die letzte erfolgreiche Fassung derselben Kalenderadresse mit Abrufzeitpunkt und einer deutlichen Warnung an. Gibt es dafür keinen verwendbaren Cache, wird der Fehler ausdrücklich angezeigt. Beim Ändern oder Löschen der Kalenderadresse werden keine Daten der vorherigen Quelle angezeigt. Der Kalender zeigt normale terminierte Ereignisse eines Monats in einem Montag-ersten Raster, einschließlich Tagen des angrenzenden Monats. Mit den Pfeilen wechseln Sie den Monat, **Heute** springt zum aktuellen Tag. Wählen Sie einen angezeigten Termin aus, um Zeit, Ort und Beschreibung in einer schreibgeschützten Ansicht zu lesen. Ist ein Ort oder eine Beschreibung nicht angegeben, bleibt dieser Bereich leer. An Tagen mit mehr Terminen als in das Raster passen, zeigt **+ weitere** die übrigen Termine; deren Auswahl öffnet dieselbe schreibgeschützte Ansicht. Titel, Ort und Beschreibung des Kalenderdienstes werden nur als Text angezeigt und nicht als App-Inhalt ausgeführt.

Terminierte ICS-Ereignisse mit Zeitzonenangabe werden in der Ortszeit des Computers angezeigt. Ganztägige Termine bleiben ganztägig und werden nicht in einen Uhrzeittermin umgewandelt. Mehrtägige Termine erscheinen als zusammenhängende Balken über den abgedeckten Kalendertagen und werden bei einem Wochenwechsel in der nächsten Zeile fortgesetzt; der exklusive Endtag zählt nicht dazu. Passt ein Balken nicht in die Woche, ist der Termin an jedem betroffenen Tag über **+ weitere** erreichbar. Wiederholungen erscheinen an ihren regelmäßigen Datumsangaben. Verlegte Termine werden am neuen Datum gezeigt, abgesagte oder ausgeschlossene Wiederholungen nicht am ursprünglichen Datum.

Bereits geladene Termine und einzelne Wiederholungen bleiben auch dann im Kalender, wenn die Quelle sie nicht mehr liefert – auch zukünftige Termine und entfallene Termine einer verkürzten Serie. Nach dem jeweiligen Ende bleiben fehlende Termine noch zwei Jahre erhalten; weiterhin gelieferte Termine werden unabhängig vom Alter angezeigt. Aktualisierungen und Verschiebungen erkannter Termine ersetzen die gespeicherte Fassung. Ausdrückliche Absagen und Ausschlüsse entfernen betroffene Termine; eine Serienabsage entfernt alle gespeicherten Wiederholungen. Sie erscheinen erst wieder, wenn die Quelle sie erneut als aktiv liefert. Termine ohne UID werden nach ihrem Inhalt zugeordnet; bei Änderungen können Duplikate entstehen, und ansonsten identische Serien ohne UID lassen sich nicht sicher unterscheiden. Absagen ohne UID lassen sich früheren Terminen nicht zuverlässig zuordnen. Diese Verlaufsdaten liegen getrennt nach Kalenderadresse im jeweiligen Datenordner; beim Zurückwechseln zu einer früheren Adresse stehen deren gespeicherte Termine wieder bereit.

Ein vorhandener älterer Kalender-Cache wird auch ohne Internet übernommen. Er enthält keine sichere Kennzeichnung für automatisch erzeugte IDs und Wiederholungen. Einzelne Termine mit zufällig wirkender UUID werden übernommen; da ihr ursprünglicher ICS-Inhalt fehlt, kann ein später erneut gelieferter Termin ohne UID daneben erscheinen. IDs im Format einer Wiederholungskennung werden nicht in den Verlauf übernommen; dies kann auch ungewöhnliche UIDs betreffen. Termine, die schon vor diesem Cache aus der Quelle verschwunden waren, lassen sich nicht wiederherstellen.

## PDF-Gestaltung

Wählen Sie zuerst den Datenordner, dessen Dokumente Sie anpassen möchten. Unter **Einstellungen → Allgemein** können Sie eine gemeinsame CSS-Datei importieren. Sie gilt für Sitzungsprotokolle und Briefe dieses Datenordners, wird bei jedem Export neu gelesen und ändert nicht die Gestaltung der App. Unter **Einstellungen → Sitzungen** und **Einstellungen → Briefe** können Sie jeweils eine HTML-Vorlage importieren.

Importierte CSS- und HTML-Dateien werden in den Anpassungsordner des Datenordners kopiert; die Quelldateien können danach verschoben oder gelöscht werden. CSS-Syntax und HTML-Platzhalter werden vor dem Import geprüft. Über **Anpassungsordner öffnen** können Sie die Dateien direkt verwalten. Jede Vorlage und das gemeinsame CSS lassen sich einzeln zurücksetzen; ClubManager fragt vorher nach einer Bestätigung. Für jede fehlende Datei wird unabhängig die passende Standardvorlage oder das passende Standardlayout verwendet. Ungültige oder nicht lesbare Dateien werden als Fehler angezeigt. Bereits exportierte PDFs ändern sich nicht automatisch.

Bestehende app-weite Vorlagen, CSS-Dateien und Unterschriften werden in den aktiven Datenordner kopiert. Gibt es keinen aktiven Ordner, erfolgt die Migration beim ersten Auswählen eines Ordners. Bereits vorhandene Dateien am Ziel bleiben erhalten; ClubManager meldet den Konflikt, statt sie zu überschreiben.

Die verfügbaren Platzhalter stehen in den jeweiligen Einstellungen. In eigenen Sitzungsvorlagen fügt `{{chair}}` den Namen der Sitzungsleitung ein; bestehende Vorlagen müssen dafür ergänzt werden. Benutzerdefinierte Briefplatzhalter werden als `{{schlüssel}}` im Markdown-Briefinhalt oder in Briefvorlagen eingesetzt; in HTML-Vorlagen müssen sie im Textinhalt stehen, nicht in HTML-Attributen. Speichern Sie die Schlüssel in den Einstellungen, bevor Sie eine Vorlage mit ihnen importieren. Ein unbekannter oder später umbenannter oder entfernter Schlüssel führt beim Import oder PDF-Export zu einem Fehler; passen Sie dann die Vorlage an. Wenn Sie mehrere Datenordner verwenden, bleiben Vorlagen, CSS, Unterschriften und benutzerdefinierte Briefplatzhalter jeweils beim zugehörigen Ordner.

## Daten und Aktualisierungen

ClubManager speichert Daten in den jeweiligen registrierten Ordnern. Erstellen Sie regelmäßig Sicherungskopien. Die Daten sind nicht verschlüsselt; Änderungen durch mehrere gleichzeitig laufende Instanzen werden nicht synchronisiert. Bei einem Konflikt laden Sie den aktuellen Stand erneut, bevor Sie speichern.

Beim Start öffnet ClubManager zuerst den Startbildschirm. Unterstützte installierte Versionen prüfen danach die Verbindung, suchen der Reihe nach nach Updates und installieren eine gefundene neue Version automatisch, bevor das Hauptfenster geladen wird. Der Startbildschirm informiert Sie über den Verlauf. Währenddessen startet ClubManager gegebenenfalls neu.

Unter Ubuntu prüft das installierte `.deb`-Paket beim Start auf Aktualisierungen. Für die Installation kann eine Bestätigung mit Administratorrechten erforderlich sein. Wenn die Installation fehlschlägt, können Sie das neue Paket aus den GitHub Releases herunterladen und manuell installieren.
