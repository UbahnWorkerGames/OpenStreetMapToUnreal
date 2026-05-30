#!/usr/bin/env python3
"""Fix: replace _fill_struct_template regex in main.js"""
import sys

path = sys.argv[1] if len(sys.argv) > 1 else 'main.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = content[content.find('def _fill_struct_template'):content.find('def _create_transit_bp')]

new = '''def _fill_struct_template(template, values):
    """values: {pos: wert_string}"""
    entries = re.findall(r'([\\w]+?)=("[^"]*"|[(][^)]*[)]|[-\\d.]+)', template)
    parts = []
    last_end = 0
    for idx, m in enumerate(re.finditer(r'([\\w]+?)=("[^"]*"|[(][^)]*[)]|[-\\d.]+)', template)):
        parts.append(template[last_end:m.start()])
        if idx in values:
            parts.append(f"{m.group(1)}={values[idx]}")
        else:
            parts.append(m.group(0))
        last_end = m.end()
    parts.append(template[last_end:])
    return "".join(parts)

'''

content = content.replace(old, new, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")
