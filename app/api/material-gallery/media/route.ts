import { readGalleryMediaTicket } from "@/lib/material-gallery-storage";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const { bytes, mime } = await readGalleryMediaTicket(request);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": mime, "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return Response.json({ error: "The media link expired. Reopen the material to refresh it." }, { status: 401, headers: { "Cache-Control": "no-store" } }); }
}
