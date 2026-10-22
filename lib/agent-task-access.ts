import { decodeJwt } from "jose";
import { verifySSOToken, type UserContext } from "./auth";
import { WorkspaceError } from "./workspace";

/** GENIUS standard-URL requests (/create, /edit, /view, /delete, /launch) carry the
 * embedded launch token. Unlike the class-scoped APIs, a class is optional here:
 * /create and an unassigned /edit have none. The token is the only identity used;
 * an invalid one never falls back to a standalone session cookie. */
export async function agentTaskRequestUser(request: Request): Promise<UserContext> {
  const token = /^Bearer ([^\s]+)$/iu.exec(request.headers.get("authorization") || "")?.[1];
  if (!token || token.length > 16_384) throw new WorkspaceError("Open this activity from GENIUS to sign in.", 401);
  let user: UserContext;
  try {
    user = await verifySSOToken(token);
    const claims = decodeJwt(token); // Signature, issuer, algorithm and expiry were verified above.
    if (claims.aud !== "engageagent-embed" || typeof claims.exp !== "number" || typeof claims.iat !== "number"
      || claims.exp <= claims.iat || claims.iat > Math.floor(Date.now() / 1000) + 60
      || !user.geniusId.trim() || user.geniusId.length > 160) throw new Error("Invalid embedded claims");
  } catch { throw new WorkspaceError("Open this activity from GENIUS to sign in.", 401); }
  return user;
}
