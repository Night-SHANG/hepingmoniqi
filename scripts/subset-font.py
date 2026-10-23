"""Regenerate the small OFL font subset from an installed Noto Sans CJK collection."""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
root=Path(__file__).resolve().parent.parent
source=Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
font=TTFont(source,fontNumber=2)
chars=set(''.join(p.read_text() for p in (root/'src').glob('*.ts')))
chars.update(chr(i) for i in range(32,127))
opts=subset.Options();opts.flavor='woff';opts.notdef_glyph=True;opts.notdef_outline=True
sub=subset.Subsetter(options=opts);sub.populate(unicodes=[ord(c) for c in chars if ord(c)>=32]);sub.subset(font)
for record in font['name'].names:
    if record.nameID in (1,4,6,16,17):
        value='Regular' if record.nameID==17 else ('CourtyardSans' if record.nameID==6 else 'Courtyard Sans')
        record.string=value.encode(record.getEncoding())
if 'CFF ' in font:
    cff=font['CFF '].cff;cff.fontNames=['CourtyardSans'];cff.topDictIndex[0].FullName='Courtyard Sans';cff.topDictIndex[0].FamilyName='Courtyard Sans'
font.flavor='woff';font.save(root/'public/fonts/courtyard-sans.woff')
license=Path('/usr/share/doc/fonts-noto-cjk/copyright').read_text();license=license[license.index('License: SIL-1.1\n ------------------------------------------------'):];license='Copyright 2014-2021 Adobe (http://www.adobe.com/)\nCopyright 2010-2012 Google Corporation\n\n'+license
(root/'public/fonts/LICENSE.txt').write_text(license)
(root/'public/fonts/SOURCE.md').write_text('# Courtyard Sans subset\n\nDerived from Noto Sans CJK SC Regular, supplied by the fonts-noto-cjk package. Only characters used by the game plus printable ASCII are retained. Renamed Courtyard Sans and redistributed under SIL Open Font License 1.1.\n\nUpstream: https://github.com/notofonts/noto-cjk\n')
print('Font subset:',(root/'public/fonts/courtyard-sans.woff').stat().st_size,'bytes')
