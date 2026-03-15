/**
 * Console 平台文本布局工具。
 *
 * 负责 grapheme 切分、宽字符宽度计算，以及光标/折行所需的辅助函数。
 */

const graphemeSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' })
  : null;

export function splitGraphemes(text: string): string[] {
  if (!text) return [];
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(text), (part: any) => part.segment as string);
  }
  return Array.from(text);
}

function isZeroWidthCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0
    || codePoint === 0x034F
    || (codePoint >= 0x0300 && codePoint <= 0x036F)
    || (codePoint >= 0x0483 && codePoint <= 0x0489)
    || (codePoint >= 0x0591 && codePoint <= 0x05BD)
    || codePoint === 0x05BF
    || (codePoint >= 0x05C1 && codePoint <= 0x05C2)
    || (codePoint >= 0x05C4 && codePoint <= 0x05C5)
    || codePoint === 0x05C7
    || (codePoint >= 0x0610 && codePoint <= 0x061A)
    || (codePoint >= 0x064B && codePoint <= 0x065F)
    || codePoint === 0x0670
    || (codePoint >= 0x06D6 && codePoint <= 0x06ED)
    || (codePoint >= 0x0711 && codePoint <= 0x0711)
    || (codePoint >= 0x0730 && codePoint <= 0x074A)
    || (codePoint >= 0x07A6 && codePoint <= 0x07B0)
    || (codePoint >= 0x07EB && codePoint <= 0x07F3)
    || (codePoint >= 0x0816 && codePoint <= 0x0819)
    || (codePoint >= 0x081B && codePoint <= 0x0823)
    || (codePoint >= 0x0825 && codePoint <= 0x0827)
    || (codePoint >= 0x0829 && codePoint <= 0x082D)
    || (codePoint >= 0x0859 && codePoint <= 0x085B)
    || (codePoint >= 0x08D3 && codePoint <= 0x08E1)
    || (codePoint >= 0x08E3 && codePoint <= 0x0902)
    || codePoint === 0x093A
    || codePoint === 0x093C
    || (codePoint >= 0x0941 && codePoint <= 0x0948)
    || codePoint === 0x094D
    || (codePoint >= 0x0951 && codePoint <= 0x0957)
    || (codePoint >= 0x0962 && codePoint <= 0x0963)
    || codePoint === 0x0981
    || codePoint === 0x09BC
    || codePoint === 0x09C1
    || codePoint === 0x09C4
    || codePoint === 0x09CD
    || (codePoint >= 0x09E2 && codePoint <= 0x09E3)
    || codePoint === 0x0A01
    || codePoint === 0x0A3C
    || (codePoint >= 0x0A41 && codePoint <= 0x0A42)
    || (codePoint >= 0x0A47 && codePoint <= 0x0A48)
    || (codePoint >= 0x0A4B && codePoint <= 0x0A4D)
    || (codePoint >= 0x0A51 && codePoint <= 0x0A51)
    || (codePoint >= 0x0A70 && codePoint <= 0x0A71)
    || (codePoint >= 0x0A75 && codePoint <= 0x0A75)
    || codePoint === 0x0ABC
    || (codePoint >= 0x0AC1 && codePoint <= 0x0AC5)
    || codePoint === 0x0AC7
    || codePoint === 0x0AC8
    || codePoint === 0x0ACD
    || (codePoint >= 0x0AE2 && codePoint <= 0x0AE3)
    || codePoint === 0x0B01
    || codePoint === 0x0B3C
    || codePoint === 0x0B3F
    || codePoint === 0x0B41
    || codePoint === 0x0B44
    || codePoint === 0x0B4D
    || codePoint === 0x0B56
    || codePoint === 0x0B62
    || codePoint === 0x0B63
    || codePoint === 0x0B82
    || codePoint === 0x0BC0
    || codePoint === 0x0BCD
    || codePoint === 0x0C00
    || (codePoint >= 0x0C3E && codePoint <= 0x0C40)
    || (codePoint >= 0x0C46 && codePoint <= 0x0C48)
    || (codePoint >= 0x0C4A && codePoint <= 0x0C4D)
    || (codePoint >= 0x0C55 && codePoint <= 0x0C56)
    || (codePoint >= 0x0C62 && codePoint <= 0x0C63)
    || codePoint === 0x0C81
    || codePoint === 0x0CBC
    || codePoint === 0x0CBF
    || codePoint === 0x0CC6
    || codePoint === 0x0CCC
    || codePoint === 0x0CCD
    || (codePoint >= 0x0CE2 && codePoint <= 0x0CE3)
    || (codePoint >= 0x0D00 && codePoint <= 0x0D01)
    || (codePoint >= 0x0D3B && codePoint <= 0x0D3C)
    || codePoint === 0x0D41
    || codePoint === 0x0D44
    || codePoint === 0x0D4D
    || codePoint === 0x0D62
    || codePoint === 0x0D63
    || codePoint === 0x0DCA
    || codePoint === 0x0DD2
    || codePoint === 0x0DD4
    || codePoint === 0x0DD6
    || codePoint === 0x0E31
    || (codePoint >= 0x0E34 && codePoint <= 0x0E3A)
    || (codePoint >= 0x0E47 && codePoint <= 0x0E4E)
    || codePoint === 0x0EB1
    || (codePoint >= 0x0EB4 && codePoint <= 0x0EBC)
    || (codePoint >= 0x0EC8 && codePoint <= 0x0ECD)
    || codePoint === 0x0F18
    || codePoint === 0x0F19
    || codePoint === 0x0F35
    || codePoint === 0x0F37
    || codePoint === 0x0F39
    || (codePoint >= 0x0F71 && codePoint <= 0x0F7E)
    || (codePoint >= 0x0F80 && codePoint <= 0x0F84)
    || (codePoint >= 0x0F86 && codePoint <= 0x0F87)
    || (codePoint >= 0x0F8D && codePoint <= 0x0F97)
    || (codePoint >= 0x0F99 && codePoint <= 0x0FBC)
    || codePoint === 0x0FC6
    || (codePoint >= 0x102D && codePoint <= 0x1030)
    || codePoint === 0x1032
    || codePoint === 0x1037
    || codePoint === 0x1039
    || codePoint === 0x103A
    || (codePoint >= 0x103D && codePoint <= 0x103E)
    || (codePoint >= 0x1058 && codePoint <= 0x1059)
    || (codePoint >= 0x105E && codePoint <= 0x1060)
    || (codePoint >= 0x1071 && codePoint <= 0x1074)
    || codePoint === 0x1082
    || (codePoint >= 0x1085 && codePoint <= 0x1086)
    || codePoint === 0x108D
    || codePoint === 0x109D
    || (codePoint >= 0x135D && codePoint <= 0x135F)
    || (codePoint >= 0x1712 && codePoint <= 0x1714)
    || (codePoint >= 0x1732 && codePoint <= 0x1734)
    || (codePoint >= 0x1752 && codePoint <= 0x1753)
    || (codePoint >= 0x1772 && codePoint <= 0x1773)
    || (codePoint >= 0x17B4 && codePoint <= 0x17B5)
    || (codePoint >= 0x17B7 && codePoint <= 0x17BD)
    || codePoint === 0x17C6
    || (codePoint >= 0x17C9 && codePoint <= 0x17D3)
    || codePoint === 0x17DD
    || (codePoint >= 0x180B && codePoint <= 0x180D)
    || codePoint === 0x1885
    || codePoint === 0x1886
    || (codePoint >= 0x18A9 && codePoint <= 0x18A9)
    || (codePoint >= 0x1920 && codePoint <= 0x1922)
    || codePoint === 0x1927
    || codePoint === 0x1928
    || (codePoint >= 0x1932 && codePoint <= 0x1932)
    || (codePoint >= 0x1939 && codePoint <= 0x193B)
    || (codePoint >= 0x1A17 && codePoint <= 0x1A18)
    || codePoint === 0x1A1B
    || codePoint === 0x1A56
    || (codePoint >= 0x1A58 && codePoint <= 0x1A5E)
    || codePoint === 0x1A60
    || codePoint === 0x1A62
    || (codePoint >= 0x1A65 && codePoint <= 0x1A6C)
    || (codePoint >= 0x1A73 && codePoint <= 0x1A7C)
    || codePoint === 0x1A7F
    || (codePoint >= 0x1AB0 && codePoint <= 0x1AFF)
    || (codePoint >= 0x1B00 && codePoint <= 0x1B03)
    || codePoint === 0x1B34
    || codePoint === 0x1B36
    || codePoint === 0x1B3A
    || codePoint === 0x1B3C
    || codePoint === 0x1B42
    || (codePoint >= 0x1B6B && codePoint <= 0x1B73)
    || (codePoint >= 0x1B80 && codePoint <= 0x1B81)
    || (codePoint >= 0x1BA2 && codePoint <= 0x1BA5)
    || (codePoint >= 0x1BA8 && codePoint <= 0x1BA9)
    || (codePoint >= 0x1BAB && codePoint <= 0x1BAD)
    || codePoint === 0x1BE6
    || (codePoint >= 0x1BE8 && codePoint <= 0x1BE9)
    || codePoint === 0x1BED
    || (codePoint >= 0x1BEF && codePoint <= 0x1BF1)
    || (codePoint >= 0x1C2C && codePoint <= 0x1C33)
    || (codePoint >= 0x1C36 && codePoint <= 0x1C37)
    || (codePoint >= 0x1CD0 && codePoint <= 0x1CD2)
    || (codePoint >= 0x1CD4 && codePoint <= 0x1CE0)
    || (codePoint >= 0x1CE2 && codePoint <= 0x1CE8)
    || codePoint === 0x1CED
    || codePoint === 0x1CF4
    || codePoint === 0x1CF8
    || codePoint === 0x1CF9
    || (codePoint >= 0x1DC0 && codePoint <= 0x1DFF)
    || (codePoint >= 0x200B && codePoint <= 0x200F)
    || (codePoint >= 0x202A && codePoint <= 0x202E)
    || (codePoint >= 0x2060 && codePoint <= 0x2064)
    || (codePoint >= 0x2066 && codePoint <= 0x2069)
    || codePoint === 0x20D0
    || codePoint === 0x20DC
    || (codePoint >= 0x20DD && codePoint <= 0x20E0)
    || codePoint === 0x20E1
    || (codePoint >= 0x20E2 && codePoint <= 0x20E4)
    || codePoint === 0x20E5
    || codePoint === 0x20E6
    || codePoint === 0x20E7
    || codePoint === 0x20E8
    || codePoint === 0x20E9
    || codePoint === 0x20EA
    || codePoint === 0x20EB
    || codePoint === 0x20EC
    || codePoint === 0x20ED
    || codePoint === 0x20EE
    || codePoint === 0x20EF
    || codePoint === 0x20F0
    || (codePoint >= 0x2CEF && codePoint <= 0x2CF1)
    || codePoint === 0x2D7F
    || (codePoint >= 0x2DE0 && codePoint <= 0x2DFF)
    || (codePoint >= 0x302A && codePoint <= 0x302F)
    || codePoint === 0x3099
    || codePoint === 0x309A
    || (codePoint >= 0xA66F && codePoint <= 0xA672)
    || (codePoint >= 0xA674 && codePoint <= 0xA67D)
    || codePoint === 0xA69E
    || codePoint === 0xA69F
    || (codePoint >= 0xA6F0 && codePoint <= 0xA6F1)
    || codePoint === 0xA802
    || codePoint === 0xA806
    || codePoint === 0xA80B
    || (codePoint >= 0xA825 && codePoint <= 0xA826)
    || codePoint === 0xA82C
    || (codePoint >= 0xA8C4 && codePoint <= 0xA8C5)
    || (codePoint >= 0xA8E0 && codePoint <= 0xA8F1)
    || codePoint === 0xA8FF
    || (codePoint >= 0xA926 && codePoint <= 0xA92D)
    || codePoint === 0xA947
    || (codePoint >= 0xA980 && codePoint <= 0xA982)
    || codePoint === 0xA9B3
    || (codePoint >= 0xA9B6 && codePoint <= 0xA9B9)
    || codePoint === 0xA9BC
    || codePoint === 0xA9BD
    || codePoint === 0xA9E5
    || (codePoint >= 0xAA29 && codePoint <= 0xAA2E)
    || (codePoint >= 0xAA31 && codePoint <= 0xAA32)
    || (codePoint >= 0xAA35 && codePoint <= 0xAA36)
    || codePoint === 0xAA43
    || codePoint === 0xAA4C
    || codePoint === 0xAA7C
    || codePoint === 0xAAB0
    || (codePoint >= 0xAAB2 && codePoint <= 0xAAB4)
    || codePoint === 0xAAB7
    || codePoint === 0xAAB8
    || codePoint === 0xAABE
    || codePoint === 0xAABF
    || codePoint === 0xAAC1
    || codePoint === 0xAAEC
    || codePoint === 0xAAED
    || codePoint === 0xAAF6
    || codePoint === 0xABE5
    || codePoint === 0xABE8
    || codePoint === 0xABED
    || codePoint === 0xFB1E
    || (codePoint >= 0xFE00 && codePoint <= 0xFE0F)
    || codePoint === 0xFEFF
    || (codePoint >= 0xFFF9 && codePoint <= 0xFFFB)
    || (codePoint >= 0x101FD && codePoint <= 0x101FD)
    || (codePoint >= 0x102E0 && codePoint <= 0x102E0)
    || (codePoint >= 0x10376 && codePoint <= 0x1037A)
    || (codePoint >= 0x10A01 && codePoint <= 0x10A03)
    || (codePoint >= 0x10A05 && codePoint <= 0x10A06)
    || (codePoint >= 0x10A0C && codePoint <= 0x10A0F)
    || (codePoint >= 0x10A38 && codePoint <= 0x10A3A)
    || codePoint === 0x10A3F
    || (codePoint >= 0x10AE5 && codePoint <= 0x10AE6)
    || (codePoint >= 0x10D24 && codePoint <= 0x10D27)
    || (codePoint >= 0x10EAB && codePoint <= 0x10EAC)
    || (codePoint >= 0x10F46 && codePoint <= 0x10F50)
    || (codePoint >= 0x11001 && codePoint <= 0x11001)
    || (codePoint >= 0x11038 && codePoint <= 0x11046)
    || (codePoint >= 0x11070 && codePoint <= 0x11070)
    || (codePoint >= 0x11073 && codePoint <= 0x11074)
    || (codePoint >= 0x1107F && codePoint <= 0x11081)
    || (codePoint >= 0x110B3 && codePoint <= 0x110B6)
    || codePoint === 0x110B9
    || codePoint === 0x110BA
    || (codePoint >= 0x11100 && codePoint <= 0x11102)
    || (codePoint >= 0x11127 && codePoint <= 0x1112B)
    || (codePoint >= 0x1112D && codePoint <= 0x11134)
    || codePoint === 0x11173
    || (codePoint >= 0x11180 && codePoint <= 0x11181)
    || (codePoint >= 0x111B6 && codePoint <= 0x111BE)
    || codePoint === 0x111C9
    || (codePoint >= 0x111CF && codePoint <= 0x111CF)
    || (codePoint >= 0x1122F && codePoint <= 0x11231)
    || codePoint === 0x11234
    || (codePoint >= 0x11236 && codePoint <= 0x11237)
    || codePoint === 0x1123E
    || codePoint === 0x112DF
    || (codePoint >= 0x112E3 && codePoint <= 0x112EA)
    || codePoint === 0x11300
    || codePoint === 0x11301
    || codePoint === 0x1133B
    || codePoint === 0x1133C
    || (codePoint >= 0x11340 && codePoint <= 0x11340)
    || codePoint === 0x11366
    || codePoint === 0x1136C
    || (codePoint >= 0x11370 && codePoint <= 0x11374)
    || (codePoint >= 0x11438 && codePoint <= 0x1143F)
    || codePoint === 0x11442
    || (codePoint >= 0x11444 && codePoint <= 0x11446)
    || codePoint === 0x1145E
    || (codePoint >= 0x114B3 && codePoint <= 0x114B8)
    || codePoint === 0x114BA
    || codePoint === 0x114BF
    || codePoint === 0x114C0
    || (codePoint >= 0x114C2 && codePoint <= 0x114C3)
    || (codePoint >= 0x115B2 && codePoint <= 0x115B5)
    || (codePoint >= 0x115BC && codePoint <= 0x115BD)
    || codePoint === 0x115BF
    || codePoint === 0x115C0
    || (codePoint >= 0x115DC && codePoint <= 0x115DD)
    || (codePoint >= 0x11633 && codePoint <= 0x1163A)
    || codePoint === 0x1163D
    || codePoint === 0x1163F
    || codePoint === 0x11640
    || (codePoint >= 0x116AB && codePoint <= 0x116AB)
    || codePoint === 0x116AD
    || (codePoint >= 0x116B0 && codePoint <= 0x116B5)
    || codePoint === 0x116B7
    || (codePoint >= 0x1171D && codePoint <= 0x1171F)
    || (codePoint >= 0x11722 && codePoint <= 0x11725)
    || (codePoint >= 0x11727 && codePoint <= 0x1172B)
    || codePoint === 0x1182F
    || (codePoint >= 0x11839 && codePoint <= 0x1183A)
    || (codePoint >= 0x1193B && codePoint <= 0x1193C)
    || codePoint === 0x1193E
    || codePoint === 0x11943
    || codePoint === 0x119D4
    || codePoint === 0x119D7
    || codePoint === 0x119DA
    || codePoint === 0x119DB
    || codePoint === 0x119E0
    || (codePoint >= 0x11A01 && codePoint <= 0x11A0A)
    || (codePoint >= 0x11A33 && codePoint <= 0x11A38)
    || (codePoint >= 0x11A3B && codePoint <= 0x11A3E)
    || codePoint === 0x11A47
    || (codePoint >= 0x11A51 && codePoint <= 0x11A56)
    || codePoint === 0x11A59
    || codePoint === 0x11A5B
    || codePoint === 0x11A8A
    || (codePoint >= 0x11A8B && codePoint <= 0x11A99)
    || (codePoint >= 0x11C30 && codePoint <= 0x11C36)
    || codePoint === 0x11C38
    || codePoint === 0x11C3D
    || (codePoint >= 0x11C3F && codePoint <= 0x11C3F)
    || (codePoint >= 0x11C92 && codePoint <= 0x11CA7)
    || (codePoint >= 0x11CAA && codePoint <= 0x11CB0)
    || (codePoint >= 0x11CB2 && codePoint <= 0x11CB3)
    || codePoint === 0x11CB5
    || codePoint === 0x11CB6
    || (codePoint >= 0x11D31 && codePoint <= 0x11D36)
    || codePoint === 0x11D3A
    || codePoint === 0x11D3C
    || codePoint === 0x11D3D
    || codePoint === 0x11D3F
    || codePoint === 0x11D45
    || codePoint === 0x11D47
    || (codePoint >= 0x11D90 && codePoint <= 0x11D91)
    || (codePoint >= 0x11D95 && codePoint <= 0x11D95)
    || codePoint === 0x11D97
    || (codePoint >= 0x11EF3 && codePoint <= 0x11EF4)
    || (codePoint >= 0x16AF0 && codePoint <= 0x16AF4)
    || (codePoint >= 0x16B30 && codePoint <= 0x16B36)
    || (codePoint >= 0x16F4F && codePoint <= 0x16F4F)
    || (codePoint >= 0x16F8F && codePoint <= 0x16F92)
    || (codePoint >= 0x16FE4 && codePoint <= 0x16FE4)
    || (codePoint >= 0x1BC9D && codePoint <= 0x1BC9E)
    || (codePoint >= 0x1BCA0 && codePoint <= 0x1BCA3)
    || (codePoint >= 0x1D167 && codePoint <= 0x1D169)
    || (codePoint >= 0x1D17B && codePoint <= 0x1D182)
    || (codePoint >= 0x1D185 && codePoint <= 0x1D18B)
    || (codePoint >= 0x1D1AA && codePoint <= 0x1D1AD)
    || (codePoint >= 0x1D242 && codePoint <= 0x1D244)
    || (codePoint >= 0x1DA00 && codePoint <= 0x1DA36)
    || (codePoint >= 0x1DA3B && codePoint <= 0x1DA6C)
    || (codePoint >= 0x1DA75 && codePoint <= 0x1DA75)
    || codePoint === 0x1DA84
    || (codePoint >= 0x1DA9B && codePoint <= 0x1DA9F)
    || (codePoint >= 0x1DAA1 && codePoint <= 0x1DAAF)
    || (codePoint >= 0x1E000 && codePoint <= 0x1E006)
    || (codePoint >= 0x1E008 && codePoint <= 0x1E018)
    || (codePoint >= 0x1E01B && codePoint <= 0x1E021)
    || (codePoint >= 0x1E023 && codePoint <= 0x1E024)
    || (codePoint >= 0x1E026 && codePoint <= 0x1E02A)
    || (codePoint >= 0x1E130 && codePoint <= 0x1E136)
    || (codePoint >= 0x1E2AE && codePoint <= 0x1E2AE)
    || (codePoint >= 0x1E2EC && codePoint <= 0x1E2EF)
    || (codePoint >= 0x1E8D0 && codePoint <= 0x1E8D6)
    || (codePoint >= 0x1E944 && codePoint <= 0x1E94A)
    || (codePoint >= 0xE0100 && codePoint <= 0xE01EF)
    || codePoint === 0x200D
    || (codePoint >= 0x1F3FB && codePoint <= 0x1F3FF)
  );
}

function isWideCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115F
    || codePoint === 0x2329
    || codePoint === 0x232A
    || (codePoint >= 0x2E80 && codePoint <= 0xA4CF && codePoint !== 0x303F)
    || (codePoint >= 0xAC00 && codePoint <= 0xD7A3)
    || (codePoint >= 0xF900 && codePoint <= 0xFAFF)
    || (codePoint >= 0xFE10 && codePoint <= 0xFE19)
    || (codePoint >= 0xFE30 && codePoint <= 0xFE6F)
    || (codePoint >= 0xFF00 && codePoint <= 0xFF60)
    || (codePoint >= 0xFFE0 && codePoint <= 0xFFE6)
    || (codePoint >= 0x1F300 && codePoint <= 0x1FAFF)
    || (codePoint >= 0x20000 && codePoint <= 0x3FFFD)
  );
}

function getGraphemeWidth(grapheme: string): number {
  if (!grapheme) return 0;
  if (/\p{Extended_Pictographic}/u.test(grapheme)) return 2;

  let width = 0;
  for (const symbol of Array.from(grapheme)) {
    const codePoint = symbol.codePointAt(0) ?? 0;
    if (isZeroWidthCodePoint(codePoint)) continue;
    width = Math.max(width, isWideCodePoint(codePoint) ? 2 : 1);
  }

  return width || 1;
}

export function getTextWidth(text: string): number {
  return splitGraphemes(text).reduce((total, grapheme) => total + getGraphemeWidth(grapheme), 0);
}

export function getLineLength(text: string): number {
  return splitGraphemes(text).length;
}

export function splitLineAtIndex(text: string, index: number): { before: string; after: string } {
  const graphemes = splitGraphemes(text);
  return {
    before: graphemes.slice(0, index).join(''),
    after: graphemes.slice(index).join(''),
  };
}

export function insertTextAtIndex(text: string, index: number, input: string): string {
  const graphemes = splitGraphemes(text);
  graphemes.splice(index, 0, ...splitGraphemes(input));
  return graphemes.join('');
}

export function removeGraphemeBeforeIndex(text: string, index: number): { nextText: string; nextIndex: number } {
  const graphemes = splitGraphemes(text);
  if (index <= 0 || graphemes.length === 0) {
    return { nextText: text, nextIndex: 0 };
  }

  graphemes.splice(index - 1, 1);
  return {
    nextText: graphemes.join(''),
    nextIndex: index - 1,
  };
}

export function getCellOffsetForIndex(text: string, index: number): number {
  const graphemes = splitGraphemes(text);
  let width = 0;
  for (let i = 0; i < Math.min(index, graphemes.length); i += 1) {
    width += getGraphemeWidth(graphemes[i]);
  }
  return width;
}

export function findIndexByCellOffset(text: string, targetCell: number): number {
  const graphemes = splitGraphemes(text);
  const safeTarget = Math.max(0, targetCell);
  let width = 0;

  for (let index = 0; index < graphemes.length; index += 1) {
    const nextWidth = width + getGraphemeWidth(graphemes[index]);
    if (safeTarget < nextWidth) {
      return safeTarget - width < nextWidth - safeTarget ? index : index + 1;
    }
    if (safeTarget === nextWidth) {
      return index + 1;
    }
    width = nextWidth;
  }

  return graphemes.length;
}

export interface VisualChunk {
  graphemes: string[];
  startIndex: number;
  endIndex: number;
  width: number;
}

export function splitVisualChunks(text: string, maxWidth: number): VisualChunk[] {
  const graphemes = splitGraphemes(text);
  if (graphemes.length === 0) {
    return [{ graphemes: [], startIndex: 0, endIndex: 0, width: 0 }];
  }

  const chunks: VisualChunk[] = [];
  let current: string[] = [];
  let currentStart = 0;
  let currentWidth = 0;

  graphemes.forEach((grapheme, index) => {
    const graphemeWidth = getGraphemeWidth(grapheme);
    if (current.length > 0 && currentWidth + graphemeWidth > maxWidth) {
      chunks.push({
        graphemes: [...current],
        startIndex: currentStart,
        endIndex: index,
        width: currentWidth,
      });
      current = [grapheme];
      currentStart = index;
      currentWidth = graphemeWidth;
      return;
    }

    current.push(grapheme);
    currentWidth += graphemeWidth;
  });

  chunks.push({
    graphemes: [...current],
    startIndex: currentStart,
    endIndex: graphemes.length,
    width: currentWidth,
  });

  return chunks;
}
