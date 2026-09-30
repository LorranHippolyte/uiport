"""Regenerate our original geometric test font: python -m pip install fonttools.
No third-party font outlines. The generated fixture is covered by the project MIT license.
"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
fb=FontBuilder(1000,isTTF=True)
names=['.notdef','space','U','I']
fb.setupGlyphOrder(names)
fb.setupCharacterMap({32:'space',85:'U',73:'I'})
glyphs={}
for name in names:
    pen=TTGlyphPen(None)
    if name!='space':
        pen.moveTo((100,0));pen.lineTo((500,0));pen.lineTo((500,700));pen.lineTo((100,700));pen.closePath()
    glyphs[name]=pen.glyph()
fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics({name:(600,0) for name in names})
fb.setupHorizontalHeader(ascent=800,descent=-200)
fb.setupNameTable({'familyName':'UIport Test','styleName':'Regular','uniqueFontIdentifier':'UIportTest-Regular','fullName':'UIport Test Regular','psName':'UIportTest-Regular','version':'Version 1.0'})
fb.setupOS2(sTypoAscender=800,sTypoDescender=-200,usWinAscent=800,usWinDescent=200)
fb.setupPost()
fb.setupMaxp()
fb.save(Path(__file__).resolve().parents[1]/'test/fixtures/uiport-test.ttf')
