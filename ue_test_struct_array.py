"""
Struct Array — Ohne re.escape, direkter Austausch
py "C:/Users/stefa/Documents/GitHub/UEMap/ue_test_struct_array.py"
"""
import unreal, re

BP_PATH = "/Game/_UbahnWorkerGames/TEST/BP_CityTest"

def log(msg):
    unreal.log_warning(f"[TEST] {msg}")

def fill_template(template, values):
    """values: {pos_index: value_string} — KEIN re.escape, direkter Austausch"""
    entries = re.findall(r'([\w]+?)=("[^"]*"|\([^)]*\)|[-\d.]+)', template)
    # Baue die Zeichenkette neu auf: für jedes Feld entweder alter oder neuer Wert
    parts = []
    last_end = 0
    for idx, m in enumerate(re.finditer(r'([\w]+?)=("[^"]*"|\([^)]*\)|[-\d.]+)', template)):
        field_name = m.group(1)
        # Alles VOR diesem Feld unverändert übernehmen
        parts.append(template[last_end:m.start()])
        if idx in values:
            parts.append(f"{field_name}={values[idx]}")
        else:
            parts.append(m.group(0))  # original
        last_end = m.end()
    parts.append(template[last_end:])
    return "".join(parts)

bp_class = unreal.load_asset(BP_PATH).generated_class()
actor = unreal.EditorLevelLibrary.spawn_actor_from_class(bp_class, unreal.Vector(500, 0, 500))

stations = [
    ("Alexanderplatz",    0.0,   (1000, -500, 250), 45, -1),
    ("Schillingstr",      823.5, (1200, -300, 250), 38, -1),
    ("Strausberger Platz",1647.0,(1350, -100, 500), 40, 1),
]

arr = actor.get_editor_property("StationsData")
arr.resize(len(stations))

for i, (name, dist, pos, half_len, level) in enumerate(stations):
    template = arr[i].export_text()
    text = fill_template(template, {
        0: f'"{name}"',
        1: f'"{name}"',
        2: str(dist),
        3: f"(X={pos[0]}.0,Y={pos[1]}.0,Z={pos[2]}.0)",
        4: str(float(half_len)),
        5: str(level),
    })
    elem = arr[i]
    elem.import_text(text)
    arr[i] = elem

actor.set_editor_property("StationsData", arr)

# Verify ALL fields
result = actor.get_editor_property("StationsData")
log(f"─── {len(result)} Stationen ───")
for i in range(len(result)):
    txt = result[i].export_text()
    entries = re.findall(r'([\w]+?)=("[^"]*"|\([^)]*\)|[-\d.]+)', txt)
    labels = ["Key","NameVal","Dist","WorldPos","Platform","Level"]
    for j, (name, val) in enumerate(entries[:6]):
        lbl = labels[j] if j < len(labels) else f"F{j}"
        log(f"  [{i}][{lbl}] = {val}")
