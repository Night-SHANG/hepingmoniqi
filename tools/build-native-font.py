from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
root=Path(__file__).resolve().parent.parent
font=TTFont('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',fontNumber=2)
text=''.join(p.read_text() for p in (root/'scripts').glob('*.gd'))+''.join(chr(i) for i in range(32,127))
opts=subset.Options();opts.notdef_glyph=True;opts.notdef_outline=True
sub=subset.Subsetter(options=opts);sub.populate(unicodes=sorted(set(map(ord,text))));sub.subset(font)
for record in font['name'].names:
 if record.nameID in (1,4,6,16,17):record.string=('Regular' if record.nameID==17 else 'NativeSliceSans').encode(record.getEncoding())
if 'CFF ' in font:
 cff=font['CFF '].cff;cff.fontNames=['NativeSliceSans'];cff.topDictIndex[0].FullName='Native Slice Sans';cff.topDictIndex[0].FamilyName='Native Slice Sans'
font.flavor=None
out=root/'assets/fonts/native-slice-sans.otf';font.save(out)
check=TTFont(out).getBestCmap()
assert all(ord(c) in check for c in text if '\u4e00'<=c<='\u9fff')
print(out.stat().st_size)
