"""Asset-authoring only: fonttools==4.60.1. Preserve copyright/attribution and
license records; rename derivative family/full/unique/PostScript names for OFL.
"""
import sys
from fontTools.ttLib import TTFont

source, target, family = sys.argv[1:]
font = TTFont(source, recalcTimestamp=False)
names = font["name"]
postscript = family.replace(" ", "")
replacements = {1: family, 3: f"DouPu derivative: {family}", 4: family,
                6: postscript, 16: family, 21: family, 25: postscript}
for record in list(names.names):
    if record.nameID in replacements:
        names.setName(replacements[record.nameID], record.nameID,
                      record.platformID, record.platEncID, record.langID)
if "fvar" in font:
    for instance in font["fvar"].instances:
        instance.postscriptNameID = 0xFFFF
font.save(target)
