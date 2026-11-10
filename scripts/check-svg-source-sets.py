#!/usr/bin/env python3
"""Compare served vectors with BOTH independent original archives, byte for byte."""
import hashlib
import json
import sys
import xml.etree.ElementTree as ET
import zipfile
from urllib.request import urlopen


def check(base, large, small, originals=False):
    base = base.rstrip('/')
    with urlopen(base + '/assets/manifest.json', timeout=15) as response:
        manifest = json.load(response)
    assert manifest['version'] == 2 and manifest['objectFactor'] == 1
    assets = manifest['assets']
    assert len(assets) == 20 and len({asset['id'] for asset in assets}) == 20
    archives = {'large': zipfile.ZipFile(large), 'small': zipfile.ZipFile(small)}
    try:
        for asset in [*assets, *manifest['backgrounds']]:
            assert set(asset['sets']) == {'large', 'small'}
            for size, geometry in asset['sets'].items():
                source = archives[size].read(geometry['sourceFile'])
                with urlopen(base + geometry['assetUrl'], timeout=15) as response:
                    served = response.read()
                assert served == source, (asset['id'], size, 'source vectors were changed')
                assert hashlib.sha256(served).hexdigest() == geometry['sha256']
                root = ET.fromstring(served)
                paths = sum(element.tag.rsplit('}', 1)[-1] == 'path' for element in root.iter())
                assert paths == geometry['pathCount']
            assert asset['sets']['large']['assetUrl'] != asset['sets']['small']['assetUrl']
        phone = next(asset for asset in assets if asset['id'] == 'phone-main')['sets']
        assert phone['large']['pathCount'] != phone['small']['pathCount'], (
            'phone must use different source geometry, not scale the same vector'
        )
        if originals:
            assert (phone['large']['pathCount'], phone['small']['pathCount']) == (155, 96)
        print('40 object source versions and palette backgrounds match both archives '
              'byte-for-byte; phone path counts differ')
    finally:
        for archive in archives.values():
            archive.close()


if __name__ == '__main__':
    check(*sys.argv[1:4], originals='--originals' in sys.argv[4:])
