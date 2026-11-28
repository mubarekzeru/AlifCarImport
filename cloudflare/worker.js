const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const MAX_BYTES = 10 * 1024 * 1024;
const B32_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MIME_EXT = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
  "image/webp": "webp", "image/gif": "gif", "image/avif": "avif"
};
let jwksCache = null;
let secTablesReady = false;

const clamp = (v, max, fb = "") => {
  const s = typeof v === "string" ? v : fb;
  return s.length > max ? s.slice(0, max) : s;
};
const cleanId = (v, p) =>
  String(v ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128) || `${p}_${Date.now()}`;
const jsonParse = (s, fb) => {
  try { return typeof s === "string" && s.trim() ? JSON.parse(s) : fb; } catch { return fb; }
};
const cors = (req, env) => {
  const cfg = (env.ALLOWED_ORIGINS || "*").trim();
  const orig = req.headers.get("Origin") || "";
  let allow = "*";
  if (cfg !== "*") {
    const list = cfg.split(",").map((x) => x.trim()).filter(Boolean);
    allow = list.includes(orig) ? orig : list[0] || "*";
  }
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
};
const resJson = (data, status, h, extra) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...h, ...(extra || {}) }
  });

function b64ToBytes(str, urlSafe) {
  const s = urlSafe
    ? str.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(str.length / 4) * 4, "=")
    : str.replace(/\s+/g, "");
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqualStr(a, b) {
  const sa = String(a ?? ""), sb = String(b ?? "");
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

function genBase32Secret(len = 20) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let bits = 0, val = 0, out = "";
  for (const b of bytes) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHA[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHA[(val << (5 - bits)) & 31];
  return out;
}

function decodeBase32(str) {
  const clean = String(str ?? "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, val = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHA.indexOf(ch);
    if (idx < 0) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function computeTotpAt(secret, step) {
  const keyBytes = decodeBase32(secret);
  if (!keyBytes.length) return "";
  const msg = new Uint8Array(8);
  let t = Math.floor(step);
  for (let i = 7; i >= 0; i--) {
    msg[i] = t & 255;
    t = Math.floor(t / 256);
  }
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const off = sig[sig.length - 1] & 15;
  const num =
    ((sig[off] & 127) << 24) | ((sig[off + 1] & 255) << 16) |
    ((sig[off + 2] & 255) << 8) | (sig[off + 3] & 255);
  return String(num % 1000000).padStart(6, "0");
}

async function verifyTotp(secret, code) {
  const clean = String(code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean) || !secret) return false;
  const step = Math.floor(Date.now() / 30000);
  for (const delta of [-1, 0, 1]) {
    const expected = await computeTotpAt(secret, step + delta);
    if (expected && timingSafeEqualStr(expected, clean)) return true;
  }
  return false;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSixDigitCode() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1000000).padStart(6, "0");
}

async function ensureSecurityTables(env) {
  if (secTablesReady) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS admin_security (
        id TEXT PRIMARY KEY,
        two_factor_enabled INTEGER NOT NULL DEFAULT 0,
        totp_secret TEXT NOT NULL DEFAULT '',
        require_device_approval INTEGER NOT NULL DEFAULT 1,
        login_alerts_enabled INTEGER NOT NULL DEFAULT 1,
        trusted_devices_json TEXT NOT NULL DEFAULT '[]',
        updated_at_ms INTEGER NOT NULL DEFAULT 0
      )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS auth_challenges (
        id TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        email TEXT NOT NULL,
        session_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        platform TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT '',
        code_hash TEXT NOT NULL,
        code_display TEXT NOT NULL,
        alert_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        expires_at_ms INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL
      )`
    ),
    env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_auth_challenges_alert ON auth_challenges (alert_id)`
    )
  ]);
  secTablesReady = true;
}

async function getSecurityRow(env) {
  await ensureSecurityTables(env);
  const row = await env.DB.prepare("SELECT * FROM admin_security WHERE id = 'security'").first();
  if (row) return row;
  return {
    id: "security",
    two_factor_enabled: 0,
    totp_secret: "",
    require_device_approval: 1,
    login_alerts_enabled: 1,
    trusted_devices_json: "[]",
    updated_at_ms: 0
  };
}

async function saveSecurityRow(env, patch) {
  const cur = await getSecurityRow(env);
  const next = {
    two_factor_enabled: patch.two_factor_enabled ?? cur.two_factor_enabled,
    totp_secret: patch.totp_secret ?? cur.totp_secret,
    require_device_approval: patch.require_device_approval ?? cur.require_device_approval,
    login_alerts_enabled: patch.login_alerts_enabled ?? cur.login_alerts_enabled,
    trusted_devices_json: patch.trusted_devices_json ?? cur.trusted_devices_json,
    updated_at_ms: Date.now()
  };
  await env.DB.prepare(
    `INSERT INTO admin_security (id,two_factor_enabled,totp_secret,require_device_approval,
     login_alerts_enabled,trusted_devices_json,updated_at_ms) VALUES ('security',?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET two_factor_enabled=excluded.two_factor_enabled,
     totp_secret=excluded.totp_secret,require_device_approval=excluded.require_device_approval,
     login_alerts_enabled=excluded.login_alerts_enabled,trusted_devices_json=excluded.trusted_devices_json,
     updated_at_ms=excluded.updated_at_ms`
  ).bind(
    next.two_factor_enabled ? 1 : 0, next.totp_secret,
    next.require_device_approval ? 1 : 0, next.login_alerts_enabled ? 1 : 0,
    next.trusted_devices_json, next.updated_at_ms
  ).run();
  return next;
}

async function getJwks(force) {
  const now = Date.now();
  if (!force && jwksCache && jwksCache.exp > now) return jwksCache.keys;
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new Error("Failed to load Firebase signing keys.");
  const m = (r.headers.get("cache-control") || "").match(/max-age=(\d+)/i);
  const ttl = m ? Math.min(Math.max(Number(m[1]), 60), 21600) : 3600;
  const body = await r.json();
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache = { keys, exp: now + ttl * 1000 };
  return keys;
}

const getCfg = (env) =>
  env.DB.prepare("SELECT * FROM showroom_config WHERE id = 'showroom'").first();

async function verifyFirebaseToken(req, env) {
  const m = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!m) throw new Error("Missing Authorization Bearer token.");
  const parts = m[1].trim().split(".");
  if (parts.length !== 3) throw new Error("Malformed Firebase token.");
  const dec = new TextDecoder();
  const hdr = JSON.parse(dec.decode(b64ToBytes(parts[0], true)));
  const pay = JSON.parse(dec.decode(b64ToBytes(parts[1], true)));
  const pid = (env.FIREBASE_PROJECT_ID || "").trim();
  const now = Math.floor(Date.now() / 1000);
  if (!pid || hdr.alg !== "RS256" || !hdr.kid) throw new Error("Invalid Firebase token config.");
  if (pay.aud !== pid || pay.iss !== `https://securetoken.google.com/${pid}`)
    throw new Error("Firebase token project mismatch.");
  if (typeof pay.exp !== "number" || pay.exp <= now) throw new Error("Firebase token expired.");
  if (!pay.sub || !pay.email || pay.email_verified !== true)
    throw new Error("Verified email required.");
  let jwk = (await getJwks(false)).find((k) => k.kid === hdr.kid);
  if (!jwk) jwk = (await getJwks(true)).find((k) => k.kid === hdr.kid);
  if (!jwk) throw new Error("Unknown Firebase signing key.");
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, b64ToBytes(parts[2], true),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!ok) throw new Error("Invalid Firebase token signature.");
  return {
    uid: String(pay.sub),
    email: String(pay.email).trim().toLowerCase(),
    authMs: typeof pay.auth_time === "number" ? pay.auth_time * 1000 : 0
  };
}

async function getAuthorizedEmails(env) {
  const boot = (env.BOOTSTRAP_ADMIN_EMAIL || "alifcarimports@gmail.com").trim().toLowerCase();
  const cfg = await getCfg(env);
  const list = jsonParse(cfg?.admin_emails_json, [boot])
    .map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  return { boot, cfg, allowedSet: new Set([boot, ...list]), allowedList: [...new Set([boot, ...list])] };
}

async function verifyAdmin(req, env) {
  const user = await verifyFirebaseToken(req, env);
  const { cfg, allowedSet } = await getAuthorizedEmails(env);
  if (!allowedSet.has(user.email)) throw new Error("Email not authorized for admin.");
  const cutoff = Number(cfg?.force_sign_out_before_ms ?? 0);
  if (cutoff > 0 && user.authMs > 0 && user.authMs < cutoff)
    throw new Error("FORCE_SIGN_OUT: Session invalidated after security change.");
  return user;
}

const mediaUrl = (req, env, key) => {
  const base = (env.PUBLIC_MEDIA_BASE_URL || "").trim().replace(/\/+$/, "");
  return base ? `${base}/${key}` : `${new URL(req.url).origin}/media/${key}`;
};

async function saveImage(val, folder, req, env) {
  const s = typeof val === "string" ? val.trim() : "";
  if (!s || !s.startsWith("data:")) return s.slice(0, 2000);
  const m = s.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) throw new Error("Unsupported image data URL.");
  const mime = m[1].toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) throw new Error(`Unsupported image type: ${mime}`);
  const bytes = b64ToBytes(m[2], false);
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) throw new Error("Image exceeds 10 MB.");
  const key = `${folder}/${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}.${ext}`;
  await env.MEDIA_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: mime, cacheControl: "public, max-age=31536000, immutable" }
  });
  return mediaUrl(req, env, key);
}

const mapVehicle = (r) => ({
  id: String(r.id ?? ""), title: String(r.title ?? ""), make: String(r.make ?? ""),
  model: String(r.model ?? ""), year: Number(r.year ?? 2024), price: Number(r.price ?? 0),
  ...(typeof r.original_price === "number" ? { originalPrice: r.original_price } : {}),
  mileage: String(r.mileage ?? ""), transmission: String(r.transmission ?? ""),
  fuelType: String(r.fuel_type ?? ""), color: String(r.color ?? ""), origin: String(r.origin ?? ""),
  imageUrl: String(r.image_url ?? ""), galleryImages: jsonParse(r.gallery_images_json, []),
  description: String(r.description ?? ""), tiktokUrl: String(r.tiktok_url ?? ""),
  status: r.status === "reserved" || r.status === "sold" ? r.status : "available",
  featured: Boolean(r.featured), createdAt: String(r.created_at ?? "")
});

const mapTikTok = (r) => ({
  id: String(r.id ?? ""), title: String(r.title ?? ""), caption: String(r.caption ?? ""),
  tiktokUrl: String(r.tiktok_url ?? ""), coverImageUrl: String(r.cover_image_url ?? ""),
  sortOrder: Number(r.sort_order ?? 0), updatedAtMillis: Number(r.updated_at_ms ?? 0)
});

const mapSession = (r) => ({
  id: String(r.id ?? ""),
  uid: String(r.uid ?? ""),
  deviceId: String(r.device_id ?? ""),
  deviceName: String(r.device_name ?? "Device"),
  platform: String(r.platform ?? "Website"),
  email: String(r.email ?? ""),
  location: String(r.location ?? ""),
  loginAtMillis: Number(r.login_at_millis ?? 0),
  lastActiveMillis: Number(r.last_active_millis ?? 0),
  status: String(r.status ?? "active"),
  userAgent: String(r.user_agent ?? ""),
  createdAtMs: Number(r.created_at_ms ?? 0),
  updatedAtMs: Number(r.updated_at_ms ?? 0)
});

const mapAlert = (r, codeByAlert) => {
  const sid = String(r.session_id ?? "");
  const isUnauth = sid.startsWith("unauth_");
  const code = codeByAlert ? codeByAlert.get(String(r.id ?? "")) || "" : "";
  return {
    id: String(r.id ?? ""),
    sessionId: sid,
    uid: String(r.uid ?? ""),
    email: String(r.email ?? ""),
    deviceName: String(r.device_name ?? "Unknown Device"),
    platform: String(r.platform ?? "Website"),
    location: String(r.location ?? ""),
    timestampMillis: Number(r.timestamp_millis ?? 0),
    decision: String(r.decision ?? "pending"),
    alertType: isUnauth ? "unauthorized_email" : "new_device",
    ...(code ? { verificationCode: code } : {}),
    createdAtMs: Number(r.created_at_ms ?? 0),
    updatedAtMs: Number(r.updated_at_ms ?? 0)
  };
};

async function upsertVehicle(id, v, req, env) {
  const vid = cleanId(id || v.id, "veh");
  const img = await saveImage(v.imageUrl, "vehicles", req, env);
  const gal = [];
  for (const g of Array.isArray(v.galleryImages) ? v.galleryImages.slice(0, 20) : []) {
    const u = await saveImage(g, "vehicles", req, env);
    if (u) gal.push(u);
  }
  const now = Date.now();
  const yr = Math.min(Math.max(Math.round(Number(v.year) || 2024), 1950), 2100);
  const pr = Math.min(Math.max(Number(v.price) || 0, 0), 1e8);
  const op = typeof v.originalPrice === "number" && v.originalPrice >= 0 ? Math.min(v.originalPrice, 1e8) : null;
  const st = v.status === "reserved" || v.status === "sold" ? v.status : "available";
  await env.DB.prepare(
    `INSERT INTO vehicles (id,title,make,model,year,price,original_price,mileage,transmission,
     fuel_type,color,origin,image_url,gallery_images_json,description,tiktok_url,status,
     featured,created_at,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title,make=excluded.make,model=excluded.model,
     year=excluded.year,price=excluded.price,original_price=excluded.original_price,
     mileage=excluded.mileage,transmission=excluded.transmission,fuel_type=excluded.fuel_type,
     color=excluded.color,origin=excluded.origin,image_url=excluded.image_url,
     gallery_images_json=excluded.gallery_images_json,description=excluded.description,
     tiktok_url=excluded.tiktok_url,status=excluded.status,featured=excluded.featured,
     updated_at_ms=excluded.updated_at_ms`
  ).bind(
    vid, clamp(v.title, 200, "Vehicle") || "Vehicle", clamp(v.make, 80, "Import") || "Import",
    clamp(v.model, 120, "Model") || "Model", yr, pr, op, clamp(v.mileage, 60, "0 km"),
    clamp(v.transmission, 80, "Automatic"), clamp(v.fuelType, 80, "Petrol"), clamp(v.color, 80),
    clamp(v.origin, 100, "Direct Import"), img, JSON.stringify(gal),
    clamp(v.description, 4000, "Imported vehicle.") || "Imported vehicle.",
    clamp(v.tiktokUrl, 500), st, v.featured ? 1 : 0,
    clamp(v.createdAt, 64, new Date(now).toISOString()), now
  ).run();
}

async function upsertTikTok(id, p, req, env) {
  const tid = cleanId(id || p.id, "tt");
  const cover = await saveImage(p.coverImageUrl, "tiktok", req, env);
  const order = Math.min(Math.max(Math.round(Number(p.sortOrder) || 0), 0), 1000);
  await env.DB.prepare(
    `INSERT INTO tiktok_posts (id,title,caption,tiktok_url,cover_image_url,sort_order,updated_at_ms)
     VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,
     caption=excluded.caption,tiktok_url=excluded.tiktok_url,cover_image_url=excluded.cover_image_url,
     sort_order=excluded.sort_order,updated_at_ms=excluded.updated_at_ms`
  ).bind(tid, clamp(p.title, 200), clamp(p.caption, 2000), clamp(p.tiktokUrl, 500), cover, order, Date.now()).run();
}

async function upsertConfig(body, req, env) {
  const ex = await getCfg(env);
  const bIn = body.branding && typeof body.branding === "object" ? body.branding : jsonParse(ex?.branding_json, {});
  const hIn = body.hero && typeof body.hero === "object" ? body.hero : jsonParse(ex?.hero_json, {});
  const tIn = body.tiktok && typeof body.tiktok === "object" ? body.tiktok : jsonParse(ex?.tiktok_header_json, {});
  const cIn = body.contact && typeof body.contact === "object" ? body.contact : jsonParse(ex?.contact_json, {});
  const branding = {
    companyName: clamp(bIn.companyName, 120, "Alif Car Import") || "Alif Car Import",
    logoUrl: await saveImage(bIn.logoUrl, "branding", req, env),
    tagline: clamp(bIn.tagline, 240)
  };
  const hero = {
    kicker: clamp(hIn.kicker, 120),
    title: clamp(hIn.title, 200, "Alif Car Import") || "Alif Car Import",
    description: clamp(hIn.description, 1200),
    imageUrl: await saveImage(hIn.imageUrl, "branding", req, env),
    ...(typeof hIn.videoUrl === "string" && hIn.videoUrl.trim() ? { videoUrl: clamp(hIn.videoUrl, 1000) } : {}),
    ctaLabel: clamp(hIn.ctaLabel, 80, "Browse Inventory") || "Browse Inventory"
  };
  const tiktok = {
    title: clamp(tIn.title, 160, "Walkaround Reels on TikTok") || "Walkaround Reels on TikTok",
    description: clamp(tIn.description, 1200),
    profileUrl: clamp(tIn.profileUrl, 500),
    handle: clamp(tIn.handle, 80)
  };
  const contact = {
    addressLine: clamp(cIn.addressLine, 240), cityCountry: clamp(cIn.cityCountry, 160),
    hours: clamp(cIn.hours, 160), phone: clamp(cIn.phone, 60), whatsapp: clamp(cIn.whatsapp, 200),
    telegram: clamp(cIn.telegram, 200), instagram: clamp(cIn.instagram, 200),
    facebook: clamp(cIn.facebook, 200), x: clamp(cIn.x, 200), email: clamp(cIn.email, 254),
    mapsUrl: clamp(cIn.mapsUrl, 500), landmarkNote: clamp(cIn.landmarkNote, 240)
  };
  const boot = (env.BOOTSTRAP_ADMIN_EMAIL || "alifcarimports@gmail.com").trim().toLowerCase();
  const cur = jsonParse(ex?.admin_emails_json, [boot]);
  const next = Array.isArray(body.adminEmails)
    ? [...new Set([boot, ...body.adminEmails.filter((e) => typeof e === "string" && e.includes("@")).map((e) => e.trim().toLowerCase())])].slice(0, 20)
    : cur;
  await env.DB.prepare(
    `INSERT INTO showroom_config (id,branding_json,hero_json,tiktok_header_json,contact_json,
     admin_emails_json,force_sign_out_before_ms,updated_at_ms) VALUES ('showroom',?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET branding_json=excluded.branding_json,hero_json=excluded.hero_json,
     tiktok_header_json=excluded.tiktok_header_json,contact_json=excluded.contact_json,
     admin_emails_json=excluded.admin_emails_json,updated_at_ms=excluded.updated_at_ms`
  ).bind(
    JSON.stringify(branding), JSON.stringify(hero), JSON.stringify(tiktok), JSON.stringify(contact),
    JSON.stringify(next.length ? next : [boot]), Number(ex?.force_sign_out_before_ms ?? 0), Date.now()
  ).run();
}

async function buildAnalyticsSummary(env) {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const d7 = new Date(now - 6 * 86400000).toISOString().slice(0, 10);
  const [tot, day, week, inq, daily, pages, rec] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS totalVisits, COUNT(DISTINCT visitor_id) AS uniqueVisitors FROM page_visits").first(),
    env.DB.prepare("SELECT COUNT(*) AS todayVisits, COUNT(DISTINCT visitor_id) AS todayUnique FROM page_visits WHERE date_key=?").bind(today).first(),
    env.DB.prepare("SELECT COUNT(*) AS last7DaysVisits FROM page_visits WHERE date_key>=?").bind(d7).first(),
    env.DB.prepare("SELECT COUNT(*) AS inquiriesCount FROM inquiries").first(),
    env.DB.prepare("SELECT date_key AS dateKey, COUNT(*) AS visits, COUNT(DISTINCT visitor_id) AS uniqueVisitors FROM page_visits WHERE date_key>=? GROUP BY date_key ORDER BY date_key ASC").bind(d7).all(),
    env.DB.prepare("SELECT page, COUNT(*) AS visits FROM page_visits GROUP BY page ORDER BY visits DESC LIMIT 10").all(),
    env.DB.prepare("SELECT id,page,visitor_id,date_key,referrer,user_agent,timestamp_millis FROM page_visits ORDER BY timestamp_millis DESC LIMIT 50").all()
  ]);
  return {
    totalVisits: Number(tot?.totalVisits ?? 0),
    uniqueVisitors: Number(tot?.uniqueVisitors ?? 0),
    todayVisits: Number(day?.todayVisits ?? 0),
    todayUnique: Number(day?.todayUnique ?? 0),
    last7DaysVisits: Number(week?.last7DaysVisits ?? 0),
    inquiriesCount: Number(inq?.inquiriesCount ?? 0),
    dailyStats: (daily.results ?? []).map((x) => ({
      dateKey: String(x.dateKey ?? ""),
      visits: Number(x.visits ?? 0),
      uniqueVisitors: Number(x.uniqueVisitors ?? 0)
    })),
    topPages: (pages.results ?? []).map((x) => ({
      page: String(x.page ?? "/"),
      visits: Number(x.visits ?? 0)
    })),
    recent: (rec.results ?? []).map((x) => ({
      id: String(x.id ?? ""),
      page: String(x.page ?? "/"),
      visitorId: String(x.visitor_id ?? ""),
      dateKey: String(x.date_key ?? ""),
      referrer: String(x.referrer ?? ""),
      userAgent: String(x.user_agent ?? ""),
      timestampMillis: Number(x.timestamp_millis ?? 0)
    }))
  };
}

export default {
  async fetch(req, env) {
    const h = cors(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
    try {
      if (req.method === "GET" && path === "/api/health")
        return resJson({ ok: true, backend: "cloudflare-d1-r2", version: 2 }, 200, h);

      if (req.method === "GET" && path.startsWith("/media/")) {
        const key = decodeURIComponent(path.slice(7));
        if (!key || key.includes("..") || key.startsWith("/") || !/^[a-zA-Z0-9/_.-]+$/.test(key))
          return resJson({ error: "Invalid media key." }, 400, h);
        const obj = await env.MEDIA_BUCKET.get(key);
        if (!obj) return resJson({ error: "Media not found." }, 404, h);
        const mh = new Headers(h);
        mh.set("Content-Type", obj.httpMetadata?.contentType || "application/octet-stream");
        mh.set("Cache-Control", obj.httpMetadata?.cacheControl || "public, max-age=31536000, immutable");
        mh.set("X-Content-Type-Options", "nosniff");
        if (obj.httpEtag) mh.set("ETag", obj.httpEtag);
        return new Response(obj.body, { status: 200, headers: mh });
      }

      if (req.method === "GET" && path === "/api/showroom") {
        const [cfg, veh, tt] = await Promise.all([
          getCfg(env),
          env.DB.prepare("SELECT * FROM vehicles ORDER BY created_at DESC").all(),
          env.DB.prepare("SELECT * FROM tiktok_posts ORDER BY sort_order DESC, updated_at_ms DESC").all()
        ]);
        return resJson({
          hasConfig: Boolean(cfg),
          branding: cfg ? jsonParse(cfg.branding_json, null) : null,
          hero: cfg ? jsonParse(cfg.hero_json, null) : null,
          tiktokHeader: cfg ? jsonParse(cfg.tiktok_header_json, null) : null,
          contact: cfg ? jsonParse(cfg.contact_json, null) : null,
          vehicles: (veh.results ?? []).map(mapVehicle),
          tiktokPosts: (tt.results ?? []).map(mapTikTok),
          updatedAtMs: Number(cfg?.updated_at_ms ?? 0)
        }, 200, h, { "Cache-Control": "public, max-age=10, stale-while-revalidate=30" });
      }

      if (req.method === "POST" && path === "/api/inquiries") {
        const b = await req.json().catch(() => ({}));
        const name = clamp(b.name, 120).trim(), phone = clamp(b.phone, 40).trim(), msg = clamp(b.message, 2000).trim();
        if (!name || !phone || !msg) return resJson({ error: "Name, phone, and message are required." }, 400, h);
        const now = Date.now(), id = cleanId(b.id || `inq_${now}_${crypto.randomUUID().slice(0, 6)}`, "inq");
        const createdAt = new Date(now).toISOString(), email = clamp(b.email, 254).trim(), vt = clamp(b.vehicleTitle, 200).trim();
        await env.DB.prepare(
          "INSERT INTO inquiries (id,name,phone,email,vehicle_title,message,created_at,created_at_ms) VALUES (?,?,?,?,?,?,?,?)"
        ).bind(id, name, phone, email, vt, msg, createdAt, now).run();
        return resJson({ id, name, phone, email, vehicleTitle: vt, message: msg, createdAt }, 201, h);
      }

      if (req.method === "POST" && path === "/api/visits") {
        const b = await req.json().catch(() => ({}));
        const page = clamp(b.page, 200, "/").trim() || "/";
        if (page.toLowerCase().includes("admin")) return resJson({ skipped: true }, 200, h);
        const now = Date.now(), id = cleanId(b.id || `vis_${now}_${crypto.randomUUID().slice(0, 8)}`, "vis");
        await env.DB.prepare(
          "INSERT OR IGNORE INTO page_visits (id,page,visitor_id,date_key,referrer,user_agent,timestamp_millis) VALUES (?,?,?,?,?,?,?)"
        ).bind(
          id, page, clamp(b.visitorId, 128, `v_${now.toString(36)}`),
          clamp(b.dateKey, 10, new Date(now).toISOString().slice(0, 10)),
          clamp(b.referrer, 300), clamp(b.userAgent, 300), Number(b.timestampMillis) || now
        ).run();
        return resJson({ ok: true, id }, 201, h);
      }

      // Any verified Firebase user (including non-admin emails) can report a login attempt / request access grant
      if (req.method === "POST" && path === "/api/auth/login-alert") {
        let user;
        try { user = await verifyFirebaseToken(req, env); }
        catch (err) {
          return resJson({ error: err instanceof Error ? err.message : "Unauthorized." }, 401, h);
        }
        const b = await req.json().catch(() => ({}));
        const { allowedSet } = await getAuthorizedEmails(env);
        const isAuthorized = allowedSet.has(user.email);
        const now = Date.now();
        const alertId = cleanId(`alert_${now}_${crypto.randomUUID().slice(0, 6)}`, "alert");
        const devId = cleanId(b.deviceId || "device", "dev");
        const sid = isAuthorized ? cleanId(b.sessionId || `web_${devId}`, "web") : `unauth_${devId}`;
        const devName = clamp(b.deviceName, 160, "Unknown Device");
        const platform = clamp(b.platform, 40, "Website");
        const location = clamp(b.location, 160, "Unknown");
        await env.DB.prepare(
          `INSERT INTO login_alerts (id,session_id,uid,email,device_name,platform,location,
           timestamp_millis,decision,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(alertId, sid, user.uid, user.email, devName, platform, location, now, "pending", now, now).run();
        return resJson({ ok: true, alertId, authorized: isAuthorized, decision: "pending" }, 201, h);
      }

      // Waiting non-admin user polls their own access request to see if primary admin granted or denied access
      if (req.method === "GET" && path.startsWith("/api/auth/request-status/")) {
        let user;
        try { user = await verifyFirebaseToken(req, env); }
        catch (err) {
          return resJson({ error: err instanceof Error ? err.message : "Unauthorized." }, 401, h);
        }
        const alertId = cleanId(decodeURIComponent(path.slice(25)), "alert");
        const row = await env.DB.prepare("SELECT id,uid,email,decision FROM login_alerts WHERE id=?").bind(alertId).first();
        if (!row || String(row.uid) !== user.uid) return resJson({ error: "Request not found." }, 404, h);
        const { allowedSet } = await getAuthorizedEmails(env);
        return resJson({
          id: String(row.id),
          decision: String(row.decision),
          authorized: allowedSet.has(user.email)
        }, 200, h);
      }

      if (path.startsWith("/api/admin")) {
        let admin;
        try { admin = await verifyAdmin(req, env); }
        catch (err) {
          const msg = err instanceof Error ? err.message : "Unauthorized.";
          return resJson({ error: msg }, msg.startsWith("FORCE_SIGN_OUT") ? 401 : 403, h);
        }

        if (req.method === "POST" && path === "/api/admin/upload") {
          if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
            const fd = await req.formData(), file = fd.get("file");
            const f = String(fd.get("folder") || "vehicles");
            const folder = f === "tiktok" || f === "branding" ? f : "vehicles";
            if (!(file instanceof File)) return resJson({ error: "Missing file." }, 400, h);
            const ext = MIME_EXT[file.type.toLowerCase()];
            if (!ext || !file.size || file.size > MAX_BYTES) return resJson({ error: "Invalid image." }, 400, h);
            const key = `${folder}/${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}.${ext}`;
            await env.MEDIA_BUCKET.put(key, await file.arrayBuffer(), {
              httpMetadata: { contentType: file.type.toLowerCase(), cacheControl: "public, max-age=31536000, immutable" }
            });
            return resJson({ key, url: mediaUrl(req, env, key) }, 201, h);
          }
          const b = await req.json().catch(() => ({}));
          const folder = b.folder === "tiktok" || b.folder === "branding" ? b.folder : "vehicles";
          const url = await saveImage(b.dataUrl, folder, req, env);
          return url ? resJson({ url }, 201, h) : resJson({ error: "Missing dataUrl." }, 400, h);
        }

        if (req.method === "GET" && path === "/api/admin/access") {
          const { allowedList } = await getAuthorizedEmails(env);
          return resJson({ adminEmails: allowedList }, 200, h);
        }
        if (req.method === "PUT" && path === "/api/admin/access") {
          const b = await req.json().catch(() => ({}));
          await upsertConfig({ adminEmails: b.adminEmails }, req, env);
          return resJson({ ok: true }, 200, h);
        }

        if (req.method === "GET" && path === "/api/admin/security") {
          const [cfg, sec] = await Promise.all([getCfg(env), getSecurityRow(env)]);
          const trusted = jsonParse(sec.trusted_devices_json, []);
          return resJson({
            forceSignOutBeforeMs: Number(cfg?.force_sign_out_before_ms ?? 0),
            twoFactorEnabled: Boolean(sec.two_factor_enabled),
            hasTotpSecret: Boolean(sec.totp_secret),
            requireDeviceApproval: Boolean(sec.require_device_approval),
            loginAlertsEnabled: Boolean(sec.login_alerts_enabled),
            trustedDeviceCount: Array.isArray(trusted) ? trusted.length : 0
          }, 200, h);
        }

        if (req.method === "PUT" && path === "/api/admin/security") {
          const b = await req.json().catch(() => ({}));
          const cur = await getSecurityRow(env);
          const patch = {};
          if (typeof b.twoFactorEnabled === "boolean") patch.two_factor_enabled = b.twoFactorEnabled ? 1 : 0;
          if (typeof b.requireDeviceApproval === "boolean") patch.require_device_approval = b.requireDeviceApproval ? 1 : 0;
          if (typeof b.loginAlertsEnabled === "boolean") patch.login_alerts_enabled = b.loginAlertsEnabled ? 1 : 0;
          if (b.clearTrustedDevices === true) patch.trusted_devices_json = "[]";
          const next = await saveSecurityRow(env, patch);
          return resJson({
            ok: true,
            twoFactorEnabled: Boolean(next.two_factor_enabled),
            hasTotpSecret: Boolean(cur.totp_secret),
            requireDeviceApproval: Boolean(next.require_device_approval),
            loginAlertsEnabled: Boolean(next.login_alerts_enabled)
          }, 200, h);
        }

        if (req.method === "POST" && path === "/api/admin/security/totp/setup") {
          const cur = await getSecurityRow(env);
          const secret = cur.totp_secret || genBase32Secret(20);
          if (!cur.totp_secret) await saveSecurityRow(env, { totp_secret: secret });
          const issuer = encodeURIComponent("Alif Car Import");
          const acct = encodeURIComponent(admin.email);
          const otpauthUrl = `otpauth://totp/${issuer}:${acct}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
          return resJson({ secret, otpauthUrl, twoFactorEnabled: Boolean(cur.two_factor_enabled) }, 200, h);
        }

        if (req.method === "POST" && path === "/api/admin/security/totp/enable") {
          const b = await req.json().catch(() => ({}));
          const cur = await getSecurityRow(env);
          if (!cur.totp_secret) return resJson({ error: "Start Authenticator setup first." }, 400, h);
          const valid = await verifyTotp(cur.totp_secret, b.code);
          if (!valid) return resJson({ error: "Invalid 6-digit authenticator code. Please try again." }, 400, h);
          await saveSecurityRow(env, { two_factor_enabled: 1 });
          return resJson({ ok: true, twoFactorEnabled: true }, 200, h);
        }

        if (req.method === "POST" && path === "/api/admin/security/totp/disable") {
          await saveSecurityRow(env, { two_factor_enabled: 0 });
          return resJson({ ok: true, twoFactorEnabled: false }, 200, h);
        }

        if (req.method === "POST" && path === "/api/admin/security/start-login") {
          const b = await req.json().catch(() => ({}));
          const now = Date.now();
          const devId = cleanId(b.deviceId || "browser", "dev");
          const sid = cleanId(b.sessionId || `web_${admin.uid.slice(0, 10)}_${devId.slice(0, 12)}`, "web");
          const devName = clamp(b.deviceName, 160, "Web Browser");
          const platform = clamp(b.platform, 40, "Website");
          const location = clamp(b.location, 160, "Web");
          const ua = clamp(b.userAgent, 300);
          const sec = await getSecurityRow(env);
          const activeOther = await env.DB.prepare(
            "SELECT COUNT(*) AS cnt FROM admin_sessions WHERE status='active' AND id!=?"
          ).bind(sid).first();
          const hasOtherDevices = Number(activeOther?.cnt ?? 0) > 0;
          const trustedList = jsonParse(sec.trusted_devices_json, []);
          const isTrusted = Array.isArray(trustedList) && trustedList.includes(devId);
          const needsTwoFactor = Boolean(sec.two_factor_enabled);
          const needsDeviceApproval = Boolean(sec.require_device_approval) && hasOtherDevices && !isTrusted;
          const needsVerification = needsTwoFactor || needsDeviceApproval;

          const alertId = cleanId(`alert_${now}_${crypto.randomUUID().slice(0, 6)}`, "alert");
          const sessionStatus = needsVerification ? "pending_verification" : "active";

          await env.DB.prepare(
            `INSERT INTO admin_sessions (id,uid,device_id,device_name,platform,email,location,
             login_at_millis,last_active_millis,status,user_agent,created_at_ms,updated_at_ms)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
             device_name=excluded.device_name,platform=excluded.platform,email=excluded.email,
             location=excluded.location,login_at_millis=excluded.login_at_millis,
             last_active_millis=excluded.last_active_millis,status=excluded.status,
             user_agent=excluded.user_agent,updated_at_ms=excluded.updated_at_ms`
          ).bind(sid, admin.uid, devId, devName, platform, admin.email, location, now, now, sessionStatus, ua, now, now).run();

          if (sec.login_alerts_enabled || needsVerification) {
            await env.DB.prepare(
              `INSERT INTO login_alerts (id,session_id,uid,email,device_name,platform,location,
               timestamp_millis,decision,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
            ).bind(
              alertId, sid, admin.uid, admin.email, devName, platform, location,
              now, needsVerification ? "pending" : "notified", now, now
            ).run();
          }

          if (!needsVerification) {
            return resJson({ status: "verified", sessionId: sid, alertId }, 200, h);
          }

          const code = randomSixDigitCode();
          const codeHash = await sha256Hex(code);
          const challengeId = cleanId(`chg_${now}_${crypto.randomUUID().slice(0, 6)}`, "chg");
          await env.DB.prepare(
            `INSERT INTO auth_challenges (id,uid,email,session_id,device_id,device_name,platform,
             location,code_hash,code_display,alert_id,status,expires_at_ms,created_at_ms)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          ).bind(
            challengeId, admin.uid, admin.email, sid, devId, devName, platform,
            location, codeHash, code, alertId, "pending", now + 10 * 60 * 1000, now
          ).run();

          return resJson({
            status: "requires_verification",
            challengeId,
            alertId,
            sessionId: sid,
            twoFactorEnabled: needsTwoFactor,
            hasTotp: Boolean(sec.totp_secret),
            requireDeviceApproval: needsDeviceApproval,
            hasOtherDevices
          }, 200, h);
        }

        if (req.method === "POST" && path === "/api/admin/security/verify-code") {
          const b = await req.json().catch(() => ({}));
          const challengeId = cleanId(b.challengeId, "chg");
          const code = String(b.code ?? "").replace(/\s+/g, "");
          if (!/^\d{6}$/.test(code)) return resJson({ error: "Enter a valid 6-digit authentication code." }, 400, h);
          const sec = await getSecurityRow(env);
          const chg = await env.DB.prepare("SELECT * FROM auth_challenges WHERE id=?").bind(challengeId).first();
          if (!chg || String(chg.uid) !== admin.uid) return resJson({ error: "Verification session expired. Sign in again." }, 404, h);
          if (String(chg.status) === "denied") return resJson({ error: "This login was denied by an administrator." }, 403, h);
          if (Number(chg.expires_at_ms) < Date.now()) return resJson({ error: "Authentication code expired. Please sign in again." }, 400, h);

          let matched = false;
          if (sec.totp_secret && await verifyTotp(sec.totp_secret, code)) matched = true;
          if (!matched) {
            const incomingHash = await sha256Hex(code);
            if (timingSafeEqualStr(incomingHash, String(chg.code_hash))) matched = true;
          }
          if (!matched) return resJson({ error: "Incorrect 6-digit authentication code." }, 400, h);

          const now = Date.now();
          await env.DB.batch([
            env.DB.prepare("UPDATE auth_challenges SET status='approved' WHERE id=?").bind(challengeId),
            env.DB.prepare("UPDATE login_alerts SET decision='approved',updated_at_ms=? WHERE id=?").bind(now, String(chg.alert_id)),
            env.DB.prepare("UPDATE admin_sessions SET status='active',last_active_millis=?,updated_at_ms=? WHERE id=?").bind(now, now, String(chg.session_id))
          ]);
          const trusted = jsonParse(sec.trusted_devices_json, []);
          const devId = String(chg.device_id);
          if (b.trustDevice !== false && devId && !trusted.includes(devId)) {
            await saveSecurityRow(env, { trusted_devices_json: JSON.stringify([...trusted, devId].slice(-30)) });
          }
          return resJson({ ok: true, verified: true, sessionId: String(chg.session_id) }, 200, h);
        }

        if (req.method === "GET" && path.startsWith("/api/admin/security/challenge/")) {
          const cid = cleanId(decodeURIComponent(path.slice(30)), "chg");
          await ensureSecurityTables(env);
          const chg = await env.DB.prepare("SELECT id,uid,session_id,status,expires_at_ms FROM auth_challenges WHERE id=?").bind(cid).first();
          if (!chg || String(chg.uid) !== admin.uid) return resJson({ error: "Challenge not found." }, 404, h);
          return resJson({
            id: String(chg.id),
            sessionId: String(chg.session_id),
            status: Number(chg.expires_at_ms) < Date.now() && chg.status === "pending" ? "expired" : String(chg.status)
          }, 200, h);
        }

        if (req.method === "POST" && path === "/api/admin/security/force-sign-out") {
          const now = Date.now();
          if (!(await getCfg(env))) await upsertConfig({}, req, env);
          await env.DB.batch([
            env.DB.prepare("UPDATE showroom_config SET force_sign_out_before_ms=?,updated_at_ms=? WHERE id='showroom'").bind(now, now),
            env.DB.prepare("UPDATE admin_sessions SET status='revoked',updated_at_ms=? WHERE status='active'").bind(now)
          ]);
          return resJson({ ok: true, forceSignOutBeforeMs: now }, 200, h);
        }

        if (req.method === "PUT" && path === "/api/admin/config") {
          await upsertConfig(await req.json().catch(() => ({})), req, env);
          return resJson({ ok: true }, 200, h);
        }
        if (req.method === "PUT" && path.startsWith("/api/admin/vehicles/")) {
          const id = decodeURIComponent(path.slice(20));
          await upsertVehicle(id, await req.json().catch(() => ({})), req, env);
          return resJson({ ok: true, id: cleanId(id, "veh") }, 200, h);
        }
        if (req.method === "DELETE" && path.startsWith("/api/admin/vehicles/")) {
          const id = decodeURIComponent(path.slice(20));
          await env.DB.prepare("DELETE FROM vehicles WHERE id=?").bind(id).run();
          return resJson({ ok: true, deletedId: id }, 200, h);
        }
        if (req.method === "PUT" && path.startsWith("/api/admin/tiktok/")) {
          const id = decodeURIComponent(path.slice(18));
          await upsertTikTok(id, await req.json().catch(() => ({})), req, env);
          return resJson({ ok: true, id: cleanId(id, "tt") }, 200, h);
        }
        if (req.method === "DELETE" && path.startsWith("/api/admin/tiktok/")) {
          const id = decodeURIComponent(path.slice(18));
          await env.DB.prepare("DELETE FROM tiktok_posts WHERE id=?").bind(id).run();
          return resJson({ ok: true, deletedId: id }, 200, h);
        }
        if (req.method === "POST" && path === "/api/admin/sync-store") {
          const b = await req.json().catch(() => ({}));
          if (b.configUpdated || b.branding || b.hero || b.contact || b.tiktokHeader || b.adminEmails) {
            await upsertConfig({ branding: b.branding, hero: b.hero, tiktok: b.tiktokHeader ?? b.tiktok, contact: b.contact, adminEmails: b.adminEmails }, req, env);
          }
          for (const v of Array.isArray(b.upsertVehicles) ? b.upsertVehicles : [])
            if (v && typeof v === "object") await upsertVehicle(String(v.id ?? ""), v, req, env);
          for (const id of Array.isArray(b.deleteVehicleIds) ? b.deleteVehicleIds : [])
            if (typeof id === "string" && id.trim()) await env.DB.prepare("DELETE FROM vehicles WHERE id=?").bind(id.trim()).run();
          for (const p of Array.isArray(b.upsertTikTokPosts) ? b.upsertTikTokPosts : [])
            if (p && typeof p === "object") await upsertTikTok(String(p.id ?? ""), p, req, env);
          for (const id of Array.isArray(b.deleteTikTokPostIds) ? b.deleteTikTokPostIds : [])
            if (typeof id === "string" && id.trim()) await env.DB.prepare("DELETE FROM tiktok_posts WHERE id=?").bind(id.trim()).run();
          return resJson({ ok: true, syncedBy: admin.email }, 200, h);
        }
        if (req.method === "POST" && path === "/api/admin/reset") {
          const b = await req.json().catch(() => ({}));
          await env.DB.batch([env.DB.prepare("DELETE FROM vehicles"), env.DB.prepare("DELETE FROM tiktok_posts")]);
          await upsertConfig(b, req, env);
          return resJson({ ok: true }, 200, h);
        }
        if (req.method === "GET" && path === "/api/admin/inquiries") {
          const r = await env.DB.prepare("SELECT id,name,phone,email,vehicle_title,message,created_at FROM inquiries ORDER BY created_at_ms DESC LIMIT 200").all();
          return resJson({ inquiries: (r.results ?? []).map((x) => ({
            id: String(x.id ?? ""), name: String(x.name ?? ""), phone: String(x.phone ?? ""),
            email: String(x.email ?? ""), vehicleTitle: String(x.vehicle_title ?? ""),
            message: String(x.message ?? ""), createdAt: String(x.created_at ?? "")
          })) }, 200, h);
        }

        if (req.method === "GET" && (path === "/api/admin/visits/summary" || path === "/api/admin/analytics" || path === "/api/admin/visits")) {
          const summary = await buildAnalyticsSummary(env);
          return resJson(summary, 200, h);
        }

        if (req.method === "GET" && (path === "/api/admin/login-alerts" || path === "/api/admin/alerts")) {
          await ensureSecurityTables(env);
          const now = Date.now();
          const [alertsRes, chgRes] = await Promise.all([
            env.DB.prepare("SELECT * FROM login_alerts ORDER BY timestamp_millis DESC LIMIT 40").all(),
            env.DB.prepare("SELECT alert_id, code_display FROM auth_challenges WHERE status='pending' AND expires_at_ms>?").bind(now).all()
          ]);
          const codeMap = new Map();
          for (const c of chgRes.results ?? []) codeMap.set(String(c.alert_id), String(c.code_display));
          const alerts = (alertsRes.results ?? []).map((r) => mapAlert(r, codeMap));
          const pendingCount = alerts.filter((a) => a.decision === "pending").length;
          return resJson({ alerts, pendingCount }, 200, h);
        }

        if (
          (req.method === "POST" && path.startsWith("/api/admin/login-alerts/") && path.endsWith("/decision")) ||
          (req.method === "PUT" && path.startsWith("/api/admin/login-alerts/"))
        ) {
          await ensureSecurityTables(env);
          const alertId = cleanId(
            decodeURIComponent(path.endsWith("/decision") ? path.slice(24, -9) : path.slice(24)),
            "alert"
          );
          const b = await req.json().catch(() => ({}));
          const rawDec = String(b.decision ?? "").toLowerCase();
          const isApprove = rawDec === "approved" || rawDec === "granted" || rawDec === "allow";
          const isDeny = rawDec === "denied" || rawDec === "revoked" || rawDec === "block";
          if (!isApprove && !isDeny) return resJson({ error: "Decision must be approved or denied." }, 400, h);
          const alert = await env.DB.prepare("SELECT * FROM login_alerts WHERE id=?").bind(alertId).first();
          if (!alert) return resJson({ error: "Login alert not found." }, 404, h);
          const now = Date.now();
          const nextDecision = isApprove ? "approved" : "denied";
          const sid = String(alert.session_id ?? "");

          await env.DB.prepare("UPDATE login_alerts SET decision=?,updated_at_ms=? WHERE id=?").bind(nextDecision, now, alertId).run();
          await env.DB.prepare("UPDATE auth_challenges SET status=? WHERE alert_id=?").bind(nextDecision, alertId).run();

          if (isApprove) {
            if (sid.startsWith("unauth_")) {
              const { allowedList } = await getAuthorizedEmails(env);
              const grantEmail = String(alert.email ?? "").trim().toLowerCase();
              if (grantEmail && !allowedList.includes(grantEmail)) {
                await upsertConfig({ adminEmails: [...allowedList, grantEmail] }, req, env);
              }
            } else if (sid) {
              await env.DB.prepare("UPDATE admin_sessions SET status='active',last_active_millis=?,updated_at_ms=? WHERE id=?").bind(now, now, sid).run();
              const chg = await env.DB.prepare("SELECT device_id FROM auth_challenges WHERE alert_id=?").bind(alertId).first();
              if (chg?.device_id) {
                const sec = await getSecurityRow(env);
                const trusted = jsonParse(sec.trusted_devices_json, []);
                if (!trusted.includes(String(chg.device_id))) {
                  await saveSecurityRow(env, { trusted_devices_json: JSON.stringify([...trusted, String(chg.device_id)].slice(-30)) });
                }
              }
            }
          } else if (sid && !sid.startsWith("unauth_")) {
            await env.DB.prepare("UPDATE admin_sessions SET status='revoked',updated_at_ms=? WHERE id=?").bind(now, sid).run();
          }
          return resJson({ ok: true, id: alertId, decision: nextDecision }, 200, h);
        }

        if (req.method === "GET" && path === "/api/admin/sessions") {
          const r = await env.DB.prepare("SELECT * FROM admin_sessions ORDER BY last_active_millis DESC LIMIT 50").all();
          const sessions = (r.results ?? []).map(mapSession);
          const activeCount = sessions.filter((s) => s.status === "active").length;
          return resJson({ sessions, activeCount }, 200, h);
        }

        if (req.method === "GET" && path.startsWith("/api/admin/sessions/")) {
          const sid = cleanId(decodeURIComponent(path.slice(20)), "web");
          const [row, cfg, pend] = await Promise.all([
            env.DB.prepare("SELECT * FROM admin_sessions WHERE id=?").bind(sid).first(),
            getCfg(env),
            env.DB.prepare("SELECT COUNT(*) AS cnt FROM login_alerts WHERE decision='pending'").first()
          ]);
          return resJson({
            session: row ? mapSession(row) : null,
            forceSignOutBeforeMs: Number(cfg?.force_sign_out_before_ms ?? 0),
            pendingAlertsCount: Number(pend?.cnt ?? 0)
          }, 200, h);
        }

        if (req.method === "PUT" && path.startsWith("/api/admin/sessions/")) {
          const sid = cleanId(decodeURIComponent(path.slice(20)), "web");
          const b = await req.json().catch(() => ({})), now = Date.now();
          const ex = await env.DB.prepare("SELECT status FROM admin_sessions WHERE id=?").bind(sid).first();
          if (ex && String(ex.status) === "revoked" && b.forceActivate !== true) {
            return resJson({ ok: false, id: sid, status: "revoked" }, 401, h);
          }
          const st = b.status === "revoked" ? "revoked" : b.status === "pending_verification" ? "pending_verification" : "active";
          await env.DB.prepare(
            `INSERT INTO admin_sessions (id,uid,device_id,device_name,platform,email,location,
             login_at_millis,last_active_millis,status,user_agent,created_at_ms,updated_at_ms)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
             device_name=excluded.device_name,platform=excluded.platform,email=excluded.email,
             location=excluded.location,last_active_millis=excluded.last_active_millis,
             status=excluded.status,user_agent=excluded.user_agent,updated_at_ms=excluded.updated_at_ms`
          ).bind(
            sid, admin.uid, clamp(b.deviceId, 128, "browser"), clamp(b.deviceName, 160, "Web Browser"),
            clamp(b.platform, 40, "Website"), admin.email, clamp(b.location, 160),
            Number(b.loginAtMillis ?? now), now, st, clamp(b.userAgent, 300), now, now
          ).run();
          if (b.recordAlert === true) {
            const alertId = cleanId(`alert_${now}_${crypto.randomUUID().slice(0, 6)}`, "alert");
            await env.DB.prepare(
              `INSERT INTO login_alerts (id,session_id,uid,email,device_name,platform,location,
               timestamp_millis,decision,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
            ).bind(
              alertId, sid, admin.uid, admin.email, clamp(b.deviceName, 160, "Web Browser"),
              clamp(b.platform, 40, "Website"), clamp(b.location, 160), now, "notified", now, now
            ).run();
          }
          return resJson({ ok: true, id: sid, status: st }, 200, h);
        }

        if (
          (req.method === "POST" && path.startsWith("/api/admin/sessions/") && path.endsWith("/revoke")) ||
          (req.method === "DELETE" && path.startsWith("/api/admin/sessions/"))
        ) {
          const sid = cleanId(
            decodeURIComponent(path.endsWith("/revoke") ? path.slice(20, -7) : path.slice(20)),
            "web"
          );
          await env.DB.prepare("UPDATE admin_sessions SET status='revoked',updated_at_ms=? WHERE id=?").bind(Date.now(), sid).run();
          return resJson({ ok: true, id: sid, status: "revoked" }, 200, h);
        }
        return resJson({ error: "Unknown admin endpoint." }, 404, h);
      }
      return resJson({ error: "Not found." }, 404, h);
    } catch (err) {
      return resJson({ error: err instanceof Error ? err.message : "Internal server error." }, 500, h);
    }
  }
};
