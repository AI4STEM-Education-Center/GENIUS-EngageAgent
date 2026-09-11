import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const SSO_ISSUER = "genius-learning-platform";

export type SSORole = "student" | "teacher" | "guest";

export type UserContext = {
  geniusId: string;
  /** @deprecated Use geniusId for cross-application identity. */
  userId: string;
  email: string | null;
  name: string;
  role: SSORole;
  classId?: string;
  className?: string;
  assignmentId?: string;
  taskId?: string;
};

export type SSOPayload = JWTPayload & {
  sub: string;
  email: string | null;
  name: string;
  role: SSORole;
  classId?: string;
  className?: string;
  assignmentId?: string;
  taskId?: string;
  iss: string;
};

export type SSOTokenInput = {
  sub: string;
  email?: string | null;
  name: string;
  role: SSORole;
  classId?: string;
  className?: string;
  assignmentId?: string;
  taskId?: string;
};

const SIGNATURE_ERROR_PATTERN = /signature verification failed/i;

const encodeSecret = (raw: string) => new TextEncoder().encode(raw);

const getSigningSecret = () => {
  const raw = process.env.SSO_SECRET;
  if (!raw) {
    throw new Error("SSO_SECRET environment variable is not set.");
  }
  return encodeSecret(raw);
};

const getVerificationSecrets = () => {
  const primary = process.env.SSO_SECRET;
  if (!primary) {
    throw new Error("SSO_SECRET environment variable is not set.");
  }

  const secrets = [primary];
  const fallback = process.env.SSO_FALLBACK_SECRET;
  if (fallback && fallback !== primary) {
    secrets.push(fallback);
  }

  return secrets.map(encodeSecret);
};

export async function createSSOToken(
  payload: SSOTokenInput,
  options?: { expiresIn?: string | number | Date },
): Promise<string> {
  const secret = getSigningSecret();

  return new SignJWT({
    sub: payload.sub,
    email: payload.email ?? null,
    name: payload.name,
    role: payload.role,
    ...(payload.classId ? { classId: payload.classId } : {}),
    ...(payload.className ? { className: payload.className } : {}),
    ...(payload.assignmentId ? { assignmentId: payload.assignmentId } : {}),
    ...(payload.taskId ? { taskId: payload.taskId } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SSO_ISSUER)
    .setIssuedAt()
    .setExpirationTime(options?.expiresIn ?? "1h")
    .sign(secret);
}

export async function verifySSOToken(token: string, options?: { audience: string; nonce: string }): Promise<UserContext> {
  const secrets = getVerificationSecrets();

  let payload: JWTPayload | undefined;
  let lastError: unknown;

  for (const secret of secrets) {
    try {
      ({ payload } = await jwtVerify(token, secret, {
        issuer: SSO_ISSUER,
        algorithms: ["HS256"],
        ...(options ? { audience: options.audience, requiredClaims: ["exp", "iat", "sub", "nonce"] } : {}),
      }));
      break;
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !SIGNATURE_ERROR_PATTERN.test(error.message)) {
        throw error;
      }
    }
  }

  if (!payload) {
    throw lastError instanceof Error ? lastError : new Error("Unable to verify SSO token.");
  }

  const sso = payload as SSOPayload;
  if (options && (sso.nonce !== options.nonce || sso.geniusId !== sso.sub)) {
    throw new Error("Invalid GENIUS login response.");
  }

  if (!sso.sub) {
    throw new Error("Invalid SSO token: missing sub claim.");
  }
  if (!sso.role || !["student", "teacher", "guest"].includes(sso.role)) {
    throw new Error("Invalid SSO token: missing or invalid role.");
  }

  return {
    geniusId: sso.sub,
    userId: sso.sub,
    email: sso.email ?? null,
    name: sso.name ?? "User",
    role: sso.role,
    classId: sso.classId,
    className: sso.className,
    assignmentId: sso.assignmentId,
    taskId: sso.taskId,
  };
}

export function extractSSOToken(request: Request): string | null {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("sso_token");
  if (fromQuery) return fromQuery;

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  return null;
}
