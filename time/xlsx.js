/* Générateur .xlsx minimal : un vrai classeur Excel (ZIP + XML), sans bibliothèque externe.
   Cellule = chaîne, nombre, ou { v, s } avec s = index de style.
   Feuille = { name, rows, widths, paysage, entete } : chaque feuille est mise en page pour l'impression en A4 (format européen),
   ajustée à la largeur de la page, ligne de titres répétée, pied « Page x / y ». Police Arial 10, dates jj.mm.aaaa, durées h:mm. */
(function (G) {
  'use strict';
  var enc = new TextEncoder();
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function esc(s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function col(i) { var s = ''; i++; while (i > 0) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = (i - r - 1) / 26; } return s; }
  function sheetXml(sh) {
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    if (sh.widths) x += '<cols>' + sh.widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>';
    x += '<sheetData>';
    sh.rows.forEach(function (row, r) {
      x += '<row r="' + (r + 1) + '">';
      row.forEach(function (cell, c) {
        var v = cell, s = 0;
        if (cell && typeof cell === 'object') { v = cell.v; s = cell.s || 0; }
        if (v === '' || v == null) { if (s) x += '<c r="' + col(c) + (r + 1) + '" s="' + s + '"/>'; return; }
        var ref = ' r="' + col(c) + (r + 1) + '"' + (s ? ' s="' + s + '"' : '');
        if (typeof v === 'number' && isFinite(v)) x += '<c' + ref + '><v>' + v + '</v></c>';
        else x += '<c' + ref + ' t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
      });
      x += '</row>';
    });
    var last = sh.rows[0] ? col(sh.rows[0].length - 1) + '1' : 'A1';
    // Impression : A4 (paperSize 9), marges 1,5 cm sur les côtés et 2 cm en haut et en bas, une page de large, autant de pages que nécessaire en hauteur.
    return x + '</sheetData><autoFilter ref="A1:' + last + '"/>' +
      '<printOptions gridLines="1"/><pageMargins left="0.59" right="0.59" top="0.79" bottom="0.79" header="0.39" footer="0.39"/>' +
      '<pageSetup paperSize="9" orientation="' + (sh.paysage ? 'landscape' : 'portrait') + '" fitToWidth="1" fitToHeight="0"/>' +
      '<headerFooter><oddHeader>&amp;L&amp;"Arial,Bold"&amp;10GIOTimePRO · &amp;A&amp;R&amp;"Arial,Regular"&amp;9' + esc(esc(sh.entete || '')).replace(/&amp;amp;/g, '&amp;&amp;') + '</oddHeader>' +
      '<oddFooter>&amp;L&amp;"Arial,Regular"&amp;8&amp;F&amp;R&amp;"Arial,Regular"&amp;8Page &amp;P / &amp;N</oddFooter></headerFooter></worksheet>';
  }
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="4"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/><numFmt numFmtId="165" formatCode="hh:mm"/><numFmt numFmtId="166" formatCode="[h]:mm"/><numFmt numFmtId="167" formatCode="#,##0.00"/></numFmts>' +
    '<fonts count="2"><font><sz val="10"/><name val="Arial"/><family val="2"/></font><font><b/><sz val="10"/><name val="Arial"/><family val="2"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE4E9EF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="11">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="166" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>' +
    '<xf numFmtId="20" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' + // 8 : h:mm (format intégré d'Excel)
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +  // 9 : nombre entier
    '<xf numFmtId="20" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>' + // 10 : h:mm en gras
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  function zip(files) {
    var chunks = [], central = [], off = 0;
    function u16(n) { return [n & 255, (n >>> 8) & 255]; }
    function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      var head = [].concat([0x50, 0x4B, 3, 4], u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      chunks.push(new Uint8Array(head), name, data);
      central.push({ name: name, crc: crc, len: data.length, off: off });
      off += head.length + name.length + data.length;
    });
    var cdStart = off, cdLen = 0;
    central.forEach(function (c) {
      var h = [].concat([0x50, 0x4B, 1, 2], u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(c.crc), u32(c.len), u32(c.len), u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.off));
      chunks.push(new Uint8Array(h), c.name); cdLen += h.length + c.name.length;
    });
    chunks.push(new Uint8Array([].concat([0x50, 0x4B, 5, 6], u16(0), u16(0), u16(central.length), u16(central.length), u32(cdLen), u32(cdStart), u16(0))));
    var total = chunks.reduce(function (a, c) { return a + c.length; }, 0), out = new Uint8Array(total), p = 0;
    chunks.forEach(function (c) { out.set(c, p); p += c.length; });
    return out;
  }
  function build(sheets) {
    var X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    var files = [
      { name: '[Content_Types].xml', data: X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>' },
      { name: '_rels/.rels', data: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: X + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map(function (s, i) { return '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets>' +
        // la ligne de titres se répète en haut de chaque page imprimée
        '<definedNames>' + sheets.map(function (s, i) { return '<definedName name="_xlnm.Print_Titles" localSheetId="' + i + '">' + esc("'" + String(s.name).replace(/'/g, "''") + "'") + '!$1:$1</definedName>'; }).join('') + '</definedNames></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
        '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: STYLES }
    ];
    sheets.forEach(function (s, i) { files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(s) }); });
    return zip(files);
  }
  G.XlsxLite = { build: build };
})(typeof window !== 'undefined' ? window : globalThis);

