#!/usr/bin/env python3
"""Independent fake source sets for CI, not substitutes for the supplied originals."""
import json
import sys
import zipfile
from pathlib import Path

small_groups = {
    'book-main': 'Group 2136136335', 'book-background': 'Group 2136136341',
    'pen-main': 'Group 2136136336', 'pen-background': 'Group 2136136343',
    'folder-main': 'Group 2136136337', 'folder-background': 'Group 2136136342',
    'flowers-main': 'Group 2136136345', 'flowers-background': 'Group 2136136346',
}
root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
manifest = json.loads(Path('web/public/assets/manifest.json').read_text())
for size in ['large', 'small']:
    filename = 'assets.zip' if size == 'large' else 'assets-small.zip'
    with zipfile.ZipFile(root / filename, 'w') as archive:
        for index, asset in enumerate(manifest['assets']):
            large = asset['viewBox']
            w, h = ((large[2], large[3]) if size == 'large'
                    else ((large[2] + 1) // 2, (large[3] + 1) // 2))
            if size == 'large':
                if asset['id'] == 'flowers-main':
                    source = 'Group 2136136344'
                elif asset['id'] == 'flowers-background':
                    source = 'Group 2136136347'
                else:
                    source = asset['displayName'] + ('-1' if asset['variant'] == 'background' else '')
            else:
                source = small_groups.get(asset['id'], asset['displayName'] + ('-1' if asset['variant'] == 'background' else ''))
            color = '#181817' if asset['variant'] == 'main' else '#7864d7'
            paths = f'<path fill="{color}" d="M0 0H{w}V{h}H0Z"/>'
            if size == 'large':
                paths += f'<path fill="{color}" d="M10 10H{w / 2}V{h / 2}Z"/>'
            else:
                paths += f'<circle fill="{color}" cx="{w / 2}" cy="{h / 2}" r="10"/>'
            archive.writestr(source + '.svg', (
                f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">'
                f'<defs><clipPath id="clip"><rect width="{w}" height="{h}"/>'
                f'</clipPath></defs><g clip-path="url(#clip)">{paths}</g></svg>'
            ))
        w = 1000 if size == 'large' else 500
        for index, color in enumerate(['#d7cdf5', '#beebeb', '#fdd7b9']):
            name = 'Фон' + ('' if index == 0 else '-' + str(index)) + '.svg'
            archive.writestr(name, (
                f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {w}">'
                f'<rect fill="{color}" width="{w}" height="{w}"/></svg>'
            ))
