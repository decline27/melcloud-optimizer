#!/usr/bin/env python3
"""Generate entsoe_area_map.json from ENTSO-E area XML.

The official area directory can be downloaded from
https://transparency.entsoe.eu/content/static_content/Static%20files/AreaDirectory.xml
(or fetched via the ENTSO-E API with documentType=A86).

Usage examples:

    python3 scripts/generate_entsoe_area_map.py --source AreaDirectory.xml --output entsoe_area_map.json
    python3 scripts/generate_entsoe_area_map.py --source https://example/AreaDirectory.xml --merge-existing entsoe_area_map.json

The script performs best-effort ISO country detection. Always review the
resulting JSON before shipping it with the app.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path
from typing import DefaultDict, Iterable

# ENTSO-E uses IEC namespaces in their XML responses.
NAMESPACES = {
    'gl': 'urn:iec62325.351:tc57wg16:451-6:area:3:0',
    'cim': 'urn:iec62325.351:tc57wg16:451-6:area:3:0'
}

# Known overrides for EIC codes that lack an obvious ISO substring.
FORCE_ISO = {
    '10Y1001A1001A48H': 'NO',  # NO5
    '10YBE----------2': 'BE',
    '10YNL----------L': 'NL',
    '10YPT-REN------W': 'PT',
    '10YFR-RTE------C': 'FR',
    '10YDE-VE-------2': 'DE',
    '10YDE-ENBW-----N': 'DE',
    '10YDE-RWENET---I': 'DE',
    '10YDE-EON------1': 'DE',
    '10YGB----------A': 'GB',
    '10YGB-NIR------Y': 'GB',
    '10YIE-1001A00010': 'IE',
    '10YCH-SWISSGRIDZ': 'CH'
}

ISO_LABELS = {
    'SE': 'Sweden',
    'NO': 'Norway',
    'DK': 'Denmark',
    'FI': 'Finland',
    'DE': 'Germany',
    'FR': 'France',
    'NL': 'Netherlands',
    'BE': 'Belgium',
    'AT': 'Austria',
    'PL': 'Poland',
    'EE': 'Estonia',
    'LV': 'Latvia',
    'LT': 'Lithuania',
    'IE': 'Ireland',
    'GB': 'Great Britain',
    'PT': 'Portugal',
    'ES': 'Spain',
    'IT': 'Italy',
    'CH': 'Switzerland',
    'CZ': 'Czech Republic',
    'SK': 'Slovakia',
    'SI': 'Slovenia',
    'HU': 'Hungary',
    'RO': 'Romania',
    'BG': 'Bulgaria',
    'HR': 'Croatia',
    'GR': 'Greece',
    'RS': 'Serbia',
    'BA': 'Bosnia & Herzegovina',
    'ME': 'Montenegro',
    'MK': 'North Macedonia',
    'AL': 'Albania',
    'TR': 'Turkey'
}


def load_source(source: str) -> str:
    if source.startswith(('http://', 'https://')):
        with urllib.request.urlopen(source) as response:  # nosec: trusted admin usage
            return response.read().decode('utf-8')
    path = Path(source).expanduser()
    return path.read_text(encoding='utf-8')


def guess_iso(name: str, eic: str) -> str | None:
    if eic in FORCE_ISO:
        return FORCE_ISO[eic]

    upper_name = name.upper()
    tokens = [token.strip('()[]:/') for token in upper_name.split() if token]
    for token in tokens:
        if len(token) == 2 and token.isalpha():
            return token
        if len(token) >= 3 and token[:2].isalpha() and token[2].isdigit():
            return token[:2]
    if len(eic) >= 5 and eic.startswith('10Y'):
        # Many price areas keep their ISO code immediately after 10Y
        candidate = ''.join(ch for ch in eic[3:5] if ch.isalpha())
        if len(candidate) == 2:
            return candidate
    return None


def normalise_iso(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip().upper()
    return value if len(value) == 2 else None


def merge_existing(area_map: DefaultDict[str, list[str]], existing_paths: Iterable[Path]) -> None:
    for path in existing_paths:
        if not path.exists():
            continue
        try:
            loaded = json.loads(path.read_text(encoding='utf-8'))
        except json.JSONDecodeError as exc:
            print(f"Warning: failed to parse {path}: {exc}", file=sys.stderr)
            continue
        for iso, codes in loaded.items():
            iso_key = normalise_iso(iso)
            if not iso_key or not isinstance(codes, list):
                continue
            bucket = area_map[iso_key]
            for code in codes:
                if isinstance(code, str) and code and code not in bucket:
                    bucket.append(code)


def main() -> int:
    parser = argparse.ArgumentParser(description='Generate entsoe_area_map.json from ENTSO-E XML data.')
    parser.add_argument('--source', required=True, help='Path or URL to AreaDirectory.xml or ENTSO-E area XML response.')
    parser.add_argument('--output', default='entsoe_area_map.json', help='Where to write the JSON map (default: ./entsoe_area_map.json).')
    parser.add_argument('--merge-existing', nargs='*', type=Path, help='Optional existing JSON maps that should be merged into the output.')
    parser.add_argument('--default-iso', help='Fallback ISO code when detection fails.')
    args = parser.parse_args()

    try:
        xml_text = load_source(args.source)
    except (OSError, urllib.error.URLError) as exc:  # type: ignore[attr-defined]
        print(f'Error: failed to load source {args.source}: {exc}', file=sys.stderr)
        return 1

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        print(f'Error: invalid XML received from {args.source}: {exc}', file=sys.stderr)
        return 1

    result: DefaultDict[str, list[str]] = defaultdict(list)
    default_iso = normalise_iso(args.default_iso)

    domains = root.findall('.//gl:Domain', NAMESPACES) or root.findall('.//cim:Domain', NAMESPACES)
    if not domains:
        domains = root.findall('.//Domain')

    if not domains:
        print('Warning: no <Domain> elements found. Check if the namespace needs updating.', file=sys.stderr)

    for domain in domains:
        eic = (domain.findtext('gl:mRID', namespaces=NAMESPACES) or domain.findtext('mRID') or '').strip()
        if not eic:
            continue
        name = (
            domain.findtext('gl:name', namespaces=NAMESPACES)
            or domain.findtext('gl:shortName', namespaces=NAMESPACES)
            or domain.findtext('name')
            or domain.findtext('shortName')
            or ''
        ).strip()
        iso = normalise_iso(guess_iso(name, eic)) or default_iso
        if not iso:
            continue
        bucket = result[iso]
        if eic not in bucket:
            bucket.append(eic)

    if args.merge_existing:
        merge_existing(result, args.merge_existing)

    for codes in result.values():
        codes.sort()

    sorted_result = dict(sorted(result.items(), key=lambda item: item[0]))
    output_path = Path(args.output).expanduser()
    output_path.write_text(json.dumps(sorted_result, indent=2) + '\n', encoding='utf-8')

    print(f'Wrote {len(sorted_result)} ISO entries to {output_path}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
