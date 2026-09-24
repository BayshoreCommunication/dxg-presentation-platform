import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TEMPLATES, MERGE_FIELDS, renderTemplate, talkFields } from "./comms.ts";

/**
 * A speaker with several presentations gets one email that names them all (D-087).
 * These pin the wording: `{{presentations}}` lists every one, and a template written
 * before that field existed still reads correctly — as a list, not as the first talk.
 */
const TZ = "America/New_York";
const KEYNOTE = { title: "Keynote", room: "Hall A", starts_at: "2027-03-10T14:00:00Z" };
const PANEL = { title: "Panel", room: "Room 3", starts_at: "2027-03-11T18:30:00Z" };

describe("talkFields", () => {
  test("one presentation reads exactly as before", () => {
    const fields = talkFields([KEYNOTE], TZ);
    assert.equal(fields.talk_title, "Keynote");
    assert.equal(fields.room, "Hall A");
    assert.match(fields.session_time, /Mar 10, 09:00 EST/);
    assert.equal(fields.presentations.split("\n").length, 1);
  });

  test("several presentations are one line each, on the event's clock (EST: DST starts Mar 14)", () => {
    const lines = talkFields([KEYNOTE, PANEL], TZ).presentations.split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /^• Keynote — Hall A, Wed, Mar 10, 09:00 EST$/);
    assert.match(lines[1]!, /^• Panel — Room 3, Thu, Mar 11, 13:30 EST$/);
  });

  test("the single-value fields become lists, so an older template still names every one", () => {
    const fields = talkFields([KEYNOTE, PANEL, { ...PANEL, title: "Workshop" }], TZ);
    assert.equal(fields.talk_title, "Keynote, Panel and Workshop");
    assert.equal(fields.room, "Hall A and Room 3", "a room is named once");
  });

  test("a presentation with no room says so", () => {
    assert.match(talkFields([{ ...KEYNOTE, room: null }], TZ).presentations, /Room TBC/);
  });
});

describe("default templates", () => {
  test("both name every presentation, and use only known merge fields", () => {
    for (const template of DEFAULT_TEMPLATES) {
      assert.ok(template.body.includes("{{presentations}}"), `${template.name} lists the presentations`);
      const used = [...`${template.subject}\n${template.body}`.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]);
      for (const field of used) assert.ok((MERGE_FIELDS as readonly string[]).includes(field!), field);
    }
  });

  test("a rendered invitation for two presentations names both", () => {
    const invitation = DEFAULT_TEMPLATES[0];
    const { body } = renderTemplate(invitation, {
      speaker_first: "Priya",
      event_name: "MedTech",
      deadline: "Mar 1",
      upload_link: "https://portal.example/t/x",
      ...talkFields([KEYNOTE, PANEL], TZ),
    });
    assert.ok(body.includes("• Keynote") && body.includes("• Panel"));
    assert.ok(!body.includes("{{"), "every field is filled");
  });
});
