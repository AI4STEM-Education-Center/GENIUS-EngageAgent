// Local browser acceptance host. Uses a throwaway SSO_SECRET and isolated data.
// Start EngageAgent on 3210, then: node scripts/materials-qa-host.mjs
import http from "node:http";
import fs from "node:fs/promises";
import { config } from "dotenv";
import { SignJWT } from "jose";
config({ path: ".env.local", quiet: true });
const origin = new URL(process.env.ENGAGE_APP_URL || "http://localhost:3210");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("Local testing only.");
if (!process.env.SSO_SECRET || !process.env.ENGAGE_LOCAL_DATA_DIR?.includes("qa")) throw new Error("Configure a throwaway secret and isolated QA data first.");
const port = Number(process.env.QA_HOST_PORT || 3211);
const token = async role => new SignJWT({ sub: `qa-${role}`, name: role === "teacher" ? "QA Teacher" : "QA Student", role, email: null,
  classId: "qa-class", className: "Materials acceptance", assignmentId: "qa-materials", taskId: "qa-task" })
  .setProtectedHeader({ alg: "HS256" }).setIssuer("genius-learning-platform").setAudience("engageagent-embed")
  .setIssuedAt().setExpirationTime("8h").sign(new TextEncoder().encode(process.env.SSO_SECRET));
const launch = async role => `${origin.origin}/?sso_token=${encodeURIComponent(await token(role))}`;
const header = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Materials local acceptance</title><style>body{margin:0;font:16px system-ui;background:#f6f7f9;color:#0f172a}nav{padding:16px;background:white;border-bottom:1px solid #e2e8f0;display:flex;gap:20px;align-items:center}a{color:#ba0c2f}main{padding:30px;max-width:900px;margin:auto}iframe{width:100%;height:calc(100vh - 60px);border:0}</style>';
http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/prototype" && process.env.UI_REFERENCE_FILE) {
    try { res.setHeader("Content-Type", "text/html"); return res.end(await fs.readFile(process.env.UI_REFERENCE_FILE)); } catch { res.writeHead(404); return res.end("Reference unavailable"); }
  }
  const role = url.pathname.includes("student") ? "student" : "teacher";
  if (["/teacher", "/student"].includes(url.pathname)) { res.writeHead(302, { Location: await launch(role) }); return res.end(); }
  if (["/embedded-teacher", "/embedded-student"].includes(url.pathname)) {
    res.setHeader("Content-Type", "text/html");
    return res.end(`${header}<nav><b>GENIUS local stand-in</b><a href="/">Acceptance home</a><span id="completion">Activity in progress</span></nav><iframe title="EngageAgent local activity" src="${await launch(role)}"></iframe><script>window.addEventListener('message',e=>{if(e.origin===${JSON.stringify(origin.origin)}&&e.source===document.querySelector('iframe').contentWindow){document.getElementById('completion').textContent=JSON.stringify(e.data)}})</script></html>`);
  }
  if (url.pathname !== "/") { res.writeHead(404); return res.end(); }
  res.setHeader("Content-Type", "text/html");
  res.end(`${header}<main><h1>Materials acceptance</h1><p>Local test class and isolated data. Teacher and student use real scoped authentication.</p><ul><li><a href="/teacher">Teacher workspace</a></li><li><a href="/student">Student workspace</a></li><li><a href="/embedded-teacher">Teacher in GENIUS iframe</a></li><li><a href="/embedded-student">Student in GENIUS iframe</a></li>${process.env.UI_REFERENCE_FILE ? '<li><a href="/prototype">v8.4 reference</a></li>' : ''}</ul></main></html>`);
}).listen(port, "127.0.0.1", () => console.log(`Materials acceptance host: http://localhost:${port}`));
