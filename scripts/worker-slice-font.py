"""Build an OFL-licensed independent diagnostic-entry subset; never replace game fonts."""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
root=Path(__file__).resolve().parent.parent
font=TTFont('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',fontNumber=2)
text=(root/'worker-slice.html').read_text()+(root/'src/worker-slice/main.ts').read_text()+''.join(chr(i) for i in range(32,127))
opts=subset.Options();opts.flavor='woff';opts.notdef_glyph=True;opts.notdef_outline=True
sub=subset.Subsetter(options=opts);sub.populate(unicodes=sorted(set(map(ord,text))));sub.subset(font)
for record in font['name'].names:
 if record.nameID in (1,4,6,16,17):record.string=('Regular' if record.nameID==17 else 'WorkerSliceSans').encode(record.getEncoding())
if 'CFF ' in font:
 cff=font['CFF '].cff;cff.fontNames=['WorkerSliceSans'];cff.topDictIndex[0].FullName='Worker Slice Sans';cff.topDictIndex[0].FamilyName='Worker Slice Sans'
font.flavor='woff';font.save(root/'public/fonts/worker-slice-sans.woff')
print('worker-slice-sans.woff', (root/'public/fonts/worker-slice-sans.woff').stat().st_size)
