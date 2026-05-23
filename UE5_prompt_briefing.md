# UE5 U-Bahn Prompt-Briefing

Du arbeitest an einer UE 5.7 Umsetzung für die Berliner U8.
Ziel: Die Karte, die Spline und die Stationslogik sollen im Spiel **exakt so wie im Web-Export** nachgebaut werden.

## Ziel

- Eine Rail-Blueprint oder C++-Klasse soll die komplette Route aus einem Export aufbauen.
- Die Strecke soll **1:1 der Web-Version entsprechen**.
- Es muss in UE möglich sein, über die Spline-Distanz zu prüfen:
  - wo sich der Zug gerade befindet
  - ob der Abschnitt Tunnel oder Bahnhof ist
  - welcher Bahnhof es ist
  - ob man z. B. 190 m vor Station X ist

## Wichtige Anforderungen

- Kein Neuberechnen der Linie in UE, wenn die finalen Web-Daten bereits vorliegen.
- Die Webapp liefert die **finale Route**, nicht nur grobe Kontrollpunkte.
- Stationslänge und Stationsbreite müssen mit exportiert werden.
- Bahnhöfe werden im Web als gerade Bahnsteigabschnitte mit Blend-Zonen behandelt.
- UE soll diese Struktur exakt übernehmen.
- Overpass ist nur Import-Quelle, nicht mehr die Runtime-Quelle.

## Relevante Exportdaten

Der Export soll mindestens diese Inhalte haben:

- `spline.points[]`
  - finale Route
  - lokale Koordinaten in `cm`
  - Tangenten pro Punkt
- `stations[]`
  - `name`
  - `dist_m`
  - `platform_start_m`
  - `platform_end_m`
  - `half_length_m`
  - `half_width_m`
  - optional: `center_pos_cm`, `tangent_cm`
- `sections[]`
  - `type: "tunnel"` oder `type: "platform"`
  - `from_m`
  - `to_m`
  - bei Plattformen zusätzlich `station`
- `platform_geometry[]`
  - Bahnsteig-Rechtecke oder Eckpunkte
- `meta`
  - blend distance
  - line ref
  - Koordinatensystem / Ursprung

## Konkrete Runtime-Logik in UE

### Spline aufbauen

- Aus `spline.points[]` die `SplineComponent` befüllen
- Punkte in lokaler UE-Space verwenden
- Tangenten übernehmen, damit die Kurve identisch zum Web-Export wird

### Stationen aufbauen

- Für jeden Eintrag in `stations[]` einen Stations-Actor oder ein Station-Struct erzeugen
- Distanz entlang der Spline speichern
- Plattformbereich von `platform_start_m` bis `platform_end_m` nutzen
- Breite/Länge des Bahnsteigs aus `half_length_m` und `half_width_m` nehmen

### Tunnel / Bahnhof erkennen

- Über `sections[]` prüfen, welcher Abschnitt gerade aktiv ist
- Wenn `type == "platform"`, muss klar sein, welcher Bahnhof es ist
- Wenn `type == "tunnel"`, ist es normaler Streckenabschnitt

### Distanzfragen

- Zugposition auf die Spline projizieren
- `DistanceAlongSpline` bzw. `dist_m` ermitteln
- vergleichen mit `stations[].dist_m`
- daraus ableiten:
  - nächste Station
  - Abstand zur nächsten Station
  - ob man in einem Bahnhof ist
  - ob man z. B. 190 m vor Bahnhof X ist

## Datenmodell-Empfehlung für UE

### Route-Struktur

- `RouteRef`
- `SplinePoints`
- `Stations`
- `Sections`
- `PlatformGeometry`

### Station-Struktur

- `Name`
- `DistanceM`
- `PlatformStartM`
- `PlatformEndM`
- `HalfLengthM`
- `HalfWidthM`
- `LocationCm`
- `TangentCm`
- `SectionIndex`

### Section-Struktur

- `Type`
- `FromM`
- `ToM`
- `StationName`

## Wichtige Designentscheidung

Die UE-Seite soll die Route **nicht neu interpretieren**.
Sie soll nur:

1. den Web-Export laden
2. die finale Spline exakt setzen
3. Stationen und Sections daraus erzeugen
4. runtime-seitig Distanzen und Bereiche abfragen

## Was die andere Instanz bauen soll

- Ein `BP_RailRoute` oder eine C++-Klasse, die den Export lädt
- Eine DataTable oder JSON-basierte Datenquelle
- Stations- und Section-Logik
- Spline-Aufbau
- Actor Tags, z. B.:
  - `Line.U8`
  - `Station.<Name>`
  - `Section.Tunnel`
  - `Section.Platform`

## Kurz gesagt

Die Webapp ist die Quelle der Wahrheit.
UE 5.7 soll die Strecke daraus exakt nachbauen, nicht neu erfinden.

