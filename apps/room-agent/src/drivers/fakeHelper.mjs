// A stand-in for helper/ppt-helper.ps1 that speaks the same JSON-line protocol, so the
// helper driver can be tested without Windows. FAKE_HELPER=crash-on-start|hang-status.
import { createInterface } from "node:readline";

let running = false;
const mode = process.env.FAKE_HELPER ?? "";
const reply = (id, body) => process.stdout.write(JSON.stringify({ id, ...body }) + "\n");
process.stdout.write("WARNING: noise that is not JSON\n");

createInterface({ input: process.stdin }).on("line", (line) => {
  const req = JSON.parse(line);
  if (req.cmd === "start") {
    if (mode === "crash-on-start") process.exit(3);
    if (String(req.file).endsWith("broken.pptx")) return reply(req.id, { ok: false, code: "com_error", message: "cannot open" });
    running = true;
    return reply(req.id, { ok: true, firstSlideMs: 12, pid: 777 });
  }
  if (req.cmd === "status") {
    if (mode === "hang-status") return; // never answers
    return reply(req.id, running ? { ok: true, running: true, responsive: true, slide: 1 } : { ok: true, running: false, responsive: true });
  }
  if (req.cmd === "stop") {
    running = false;
    return reply(req.id, { ok: true });
  }
  if (req.cmd === "shutdown") {
    running = false;
    reply(req.id, { ok: true });
    return;
  }
  reply(req.id, { ok: false, code: "unknown_command", message: req.cmd });
});
