import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { parseCsv, parseXlsx, parseSheet, excelSerialToDate } from "./sheet.ts";

function makeZip(files: { name: string; body: string }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const content = Buffer.from(file.body, "utf8");
    const deflated = deflateRawSync(content);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, deflated);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + deflated.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, eocd]);
}

describe("CSV parsing", () => {
  test("splits plain rows", () => {
    assert.deepEqual(parseCsv("a,b\n1,2\n"), [
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("handles quoted fields, embedded commas, doubled quotes and newlines", () => {
    const rows = parseCsv('Title,Room\n"Robotics, Part 2","Ballroom ""A"""\n"Two\nlines",X\n');
    assert.deepEqual(rows[1], ["Robotics, Part 2", 'Ballroom "A"']);
    assert.deepEqual(rows[2], ["Two\nlines", "X"]);
  });

  test("ignores blank rows and trailing newlines", () => {
    assert.equal(parseCsv("a,b\n\n\n1,2\n\n").length, 2);
  });

  test("tolerates CRLF", () => {
    assert.deepEqual(parseCsv("a,b\r\n1,2\r\n")[1], ["1", "2"]);
  });
});

describe("XLSX parsing", () => {
  const workbook = (sheet: string, shared: string[] = []) =>
    makeZip([
      {
        name: "xl/sharedStrings.xml",
        body: `<sst>${shared.map((value) => `<si><t>${value}</t></si>`).join("")}</sst>`,
      },
      { name: "xl/worksheets/sheet1.xml", body: `<worksheet><sheetData>${sheet}</sheetData></worksheet>` },
    ]);

  test("reads shared strings, inline strings and numbers", () => {
    const rows = parseXlsx(
      workbook(
        `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
         <row r="2"><c r="A2" t="inlineStr"><is><t>Keynote</t></is></c><c r="B2"><v>212</v></c></row>`,
        ["Session Title", "Room"],
      ),
    );
    assert.deepEqual(rows[0], ["Session Title", "Room"]);
    assert.deepEqual(rows[1], ["Keynote", "212"]);
  });

  test("preserves column positions when cells are skipped", () => {
    const rows = parseXlsx(workbook(`<row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row>`));
    assert.deepEqual(rows[0], ["1", "", "3"]);
  });

  test("unescapes XML entities", () => {
    const rows = parseXlsx(workbook(`<row r="1"><c r="A1" t="s"><v>0</v></c></row>`, ["Q &amp; A"]));
    assert.deepEqual(rows[0], ["Q & A"]);
  });

  test("a file that is not a workbook fails loudly", () => {
    assert.throws(() => parseXlsx(Buffer.from("nope")));
  });
});

describe("parseSheet dispatch and dates", () => {
  test("picks the parser from the file name", () => {
    assert.deepEqual(parseSheet(Buffer.from("a,b\n1,2\n"), "agenda.csv")[1], ["1", "2"]);
  });

  test("Excel serial dates convert against known anchors", () => {
    // 45292 is 2024-01-01 in the 1900 date system — the anchor this is checked against.
    assert.match(excelSerialToDate(45292), /^2024-01-01/);
    assert.match(excelSerialToDate(45293), /^2024-01-02/);
    assert.match(excelSerialToDate(46092), /^2026-03-11/);
  });
});
