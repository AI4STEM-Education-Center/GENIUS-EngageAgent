import { readLocalMaterial } from "@/lib/local-material-storage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const asset = await readLocalMaterial(request);
    return new Response(new Uint8Array(asset.bytes), { headers: {
      "Content-Type": asset.mime,
      "Content-Length": String(asset.bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...(asset.fileName ? { "Content-Disposition": `attachment; filename="${asset.fileName}"` } : {}),
    } });
  } catch {
    // Do not disclose file existence, token errors, paths or storage configuration.
    return new Response("Material unavailable or link expired.", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
