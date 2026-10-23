import type { AuthOptions } from "./types.js";

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export interface Auth {
  /** 校验通过返回 token，否则 null。 */
  login(user: string, password: string): Promise<string | null>;
  /** 校验通过返回载荷，否则 null。任何畸形输入都返回 null，不抛。 */
  verify(token: string | null): Promise<{ sub: string } | null>;
}

/**
 * 等时比较。
 *
 * 逐字节 XOR 后累加，中途不短路——提前 return 会把"前几个字符对了"这个
 * 信息通过耗时泄露出去。长度不同直接返回 false，长度本身不算秘密。
 */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function sign(secret: Uint8Array, payload: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    secret as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, payload as unknown as ArrayBuffer));
}

export function createAuth(options: AuthOptions & { now?: () => number }): Auth {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const encoder = new TextEncoder();

  let secret = options.secret === undefined ? undefined : encoder.encode(options.secret);
  if (secret === undefined) {
    // 随机 secret 只在这个进程里有效。重启后已签发的 token 全部作废，
    // 所以启动时必须说一声，否则用户会以为是登录坏了。
    secret = crypto.getRandomValues(new Uint8Array(32));
    console.warn("[logo] 未提供 auth.secret，已生成临时密钥：重启后所有登录态失效");
  }
  const keyBytes = secret;

  // 预先编码成字节，比较时不用再分配。
  const credentials = new Map<string, Uint8Array>();
  for (const [name, password] of Object.entries(options.users)) {
    credentials.set(name, encoder.encode(password));
  }

  async function signPayload(sub: string, ttlMs: number): Promise<string> {
    const payload = encoder.encode(JSON.stringify({ sub, exp: now() + ttlMs }));
    const payloadText = toBase64Url(payload);
    const signature = await sign(keyBytes, encoder.encode(payloadText));
    return `${payloadText}.${toBase64Url(signature)}`;
  }

  return {
    async login(user, password) {
      const expected = credentials.get(user);
      if (expected === undefined) return null;
      if (!equalBytes(expected, encoder.encode(password))) return null;

      return signPayload(user, ttlMs);
    },

    async verify(token) {
      if (token === null) return null;

      const parts = token.split(".");
      if (parts.length !== 2) return null;

      const [payloadText, signatureText] = parts as [string, string];
      const payloadBytes = fromBase64Url(payloadText);
      const signatureBytes = fromBase64Url(signatureText);
      if (payloadBytes === null || signatureBytes === null) return null;

      const expected = await sign(keyBytes, encoder.encode(payloadText));
      if (!equalBytes(expected, signatureBytes)) return null;

      try {
        const decoded: unknown = JSON.parse(new TextDecoder().decode(payloadBytes));
        if (typeof decoded !== "object" || decoded === null) return null;
        const { sub, exp } = decoded as { sub?: unknown; exp?: unknown };
        if (typeof sub !== "string" || typeof exp !== "number") return null;
        if (exp <= now()) return null;
        return { sub };
      } catch {
        return null;
      }
    },
  };
}
