// Stand-in "GENIUS" host for local testing of the GENIUS standard URLs
// (docs/genius-standard-urls.md). It signs local test tokens, iframes
// /create, /edit, /view, /delete and /launch, and logs every message received.
//
// Local only: binds to 127.0.0.1 and signs with a throwaway secret you choose.
// Never point it at production or reuse the production SSO_SECRET.
//
//   export SSO_SECRET=$(openssl rand -hex 32)
//   SSO_SECRET=$SSO_SECRET ENGAGE_APP_URL=http://localhost:3000 \
//     GENIUS_EMBED_ORIGIN=http://localhost:3100 ALLOWED_ORIGINS=http://localhost:3100 \
//     ENGAGE_LOCAL_DATA_DIR=/absolute/path/to/scratch/engage-data DYNAMODB_TABLE= npm run dev
//   SSO_SECRET=$SSO_SECRET node scripts/genius-standin.mjs
//   open http://localhost:3100
import http from "node:http";
import { SignJWT } from "jose";

const secret = process.env.SSO_SECRET;
const port = Number(process.env.STANDIN_PORT || 3100);
const engage = new URL(process.env.ENGAGE_APP_URL || "http://localhost:3000").origin;
if (process.env.NODE_ENV === "production") throw new Error("The GENIUS stand-in is for local testing only.");
if (!secret) throw new Error("Set SSO_SECRET to the same throwaway value EngageAgent's dev server uses.");
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(engage).hostname)) throw new Error("ENGAGE_APP_URL must be a loopback origin.");

const text = (value, max = 160) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
async function token(fields) {
  const role = ["teacher", "student", "guest"].includes(fields.role) ? fields.role : "teacher";
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: text(fields.sub) || `local-${role}`, role, name: text(fields.name) || `Local ${role}`, email: null,
    aud: "engageagent-embed",
    ...(text(fields.classId) ? { classId: text(fields.classId) } : {}),
    ...(text(fields.assignmentId) ? { assignmentId: text(fields.assignmentId) } : {}),
  }).setProtectedHeader({ alg: "HS256" }).setIssuer("genius-learning-platform")
    .setIssuedAt(now).setExpirationTime(now + 3600).sign(new TextEncoder().encode(secret));
}

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>GENIUS stand-in</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 0; display: grid; grid-template-columns: 340px 1fr; height: 100vh; }
  aside { padding: 16px; border-right: 1px solid #ddd; overflow: auto; background: #fafafa; }
  label { display: block; margin-top: 8px; font-weight: 600; } input, select { width: 100%; box-sizing: border-box; padding: 4px; }
  button { margin-top: 12px; padding: 6px 12px; } iframe { width: 100%; height: 100%; border: 0; }
  #log { font: 12px ui-monospace, monospace; white-space: pre-wrap; margin-top: 16px; }
  .bad { color: #b00; } .ok { color: #070; }
</style></head><body>
<aside>
  <h1 style="font-size:16px">GENIUS stand-in</h1>
  <p>Frames <code>${engage}</code></p>
  <label>URL <select id="route">${["create", "edit", "view", "delete", "launch"].map(r => `<option>${r}</option>`).join("")}</select></label>
  <label>task_id <input id="taskId" placeholder="filled in after genius.task-created"></label>
  <label>Role <select id="role"><option>teacher</option><option>student</option><option>guest</option></select></label>
  <label>GENIUS ID (sub) <input id="sub" value="local-teacher"></label>
  <label>Name <input id="name" value="Local Teacher"></label>
  <label>classId <input id="classId" placeholder="empty = no class"></label>
  <label>assignmentId <input id="assignmentId" placeholder="empty = no assignment"></label>
  <button id="open">Open in iframe</button>
  <div id="log"></div>
</aside>
<iframe id="frame" title="EngageAgent" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"></iframe>
<script>
  const ENGAGE = ${JSON.stringify(engage)};
  const $ = id => document.getElementById(id);
  const frame = $("frame");
  window.receivedMessages = [];
  $("role").onchange = () => { const r = $("role").value; $("sub").value = "local-" + r; $("name").value = "Local " + r[0].toUpperCase() + r.slice(1); };
  $("open").onclick = async () => {
    const fields = Object.fromEntries(["role", "sub", "name", "classId", "assignmentId"].map(id => [id, $(id).value]));
    const { token } = await (await fetch("/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) })).json();
    const url = new URL("/" + $("route").value, ENGAGE);
    if ($("route").value !== "create" && $("taskId").value) url.searchParams.set("task_id", $("taskId").value);
    url.searchParams.set("sso_token", token);
    frame.src = url.href;
    log("opened /" + $("route").value + ($("taskId").value && $("route").value !== "create" ? "?task_id=" + $("taskId").value : "") + " as " + fields.role + " " + fields.sub + (fields.classId ? " in " + fields.classId + "/" + fields.assignmentId : " (no class)"));
  };
  function log(line, cls) { const p = document.createElement("div"); if (cls) p.className = cls; p.textContent = new Date().toLocaleTimeString() + "  " + line; $("log").prepend(p); }
  // What GENIUS should do: accept only messages from this iframe and the EngageAgent origin.
  window.addEventListener("message", event => {
    const fromFrame = event.source === frame.contentWindow, fromEngage = event.origin === ENGAGE;
    const entry = { origin: event.origin, fromFrame, data: event.data };
    window.receivedMessages.push(entry);
    log((fromFrame && fromEngage ? "ACCEPTED " : "REJECTED ") + JSON.stringify(entry), fromFrame && fromEngage ? "ok" : "bad");
    if (fromFrame && fromEngage && event.data?.type === "genius.task-created") $("taskId").value = event.data.agentTaskId;
  });
</script></body></html>`;

http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/token") {
    let body = "";
    for await (const chunk of req) { body += chunk; if (body.length > 4096) return res.writeHead(413).end(); }
    try {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ token: await token(JSON.parse(body)) }));
    } catch { return res.writeHead(400).end(); }
  }
  if (req.method === "GET" && (req.url === "/" || req.url?.startsWith("/?"))) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(page);
  }
  res.writeHead(404).end();
}).listen(port, "127.0.0.1", () => console.log(`GENIUS stand-in on http://localhost:${port}, framing ${engage}`));
