const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const MAX_BYTES = 10 * 1024 * 1024;
const MIME_EXT = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
  "image/webp": "webp", "image/gif": "gif", "image/avif": "avif"
};
let jwksCache = null;

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

async function verifyAdmin(req, env) {
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
    throw new Error("Verified admin email required.");
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
  const email = pay.email.trim().toLowerCase();
  const boot = (env.BOOTSTRAP_ADMIN_EMAIL || "alifcarimports@gmail.com").trim().toLowerCase();
  const cfg = await getCfg(env);
  const list = jsonParse(cfg?.admin_emails_json, [boot]).map((x) => String(x).trim().toLowerCase());
  if (!new Set([boot, ...list]).has(email)) throw new Error("Email not authorized for admin.");
  const authMs = typeof pay.auth_time === "number" ? pay.auth_time * 1000 : 0;
  const cutoff = Number(cfg?.force_sign_out_before_ms ?? 0);
  if (cutoff > 0 && authMs > 0 && authMs < cutoff)
    throw new Error("FORCE_SIGN_OUT: Session invalidated after security change.");
  return { uid: pay.sub, email, authMs };
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
    ? [...new Set(body.adminEmails.filter((e) => typeof e === "string" && e.includes("@")).map((e) => e.trim().toLowerCase()).slice(0, 20))]
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

export default {
  async fetch(req, env) {
    const h = cors(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
    try {
      if (req.method === "GET" && path === "/api/health")
        return resJson({ ok: true, backend: "cloudflare-d1-r2" }, 200, h);

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
          const cfg = await getCfg(env);
          const boot = (env.BOOTSTRAP_ADMIN_EMAIL || "alifcarimports@gmail.com").trim().toLowerCase();
          return resJson({ adminEmails: jsonParse(cfg?.admin_emails_json, [boot]) }, 200, h);
        }
        if (req.method === "PUT" && path === "/api/admin/access") {
          const b = await req.json().catch(() => ({}));
          await upsertConfig({ adminEmails: b.adminEmails }, req, env);
          return resJson({ ok: true }, 200, h);
        }
        if (req.method === "GET" && path === "/api/admin/security") {
          const cfg = await getCfg(env);
          return resJson({ forceSignOutBeforeMs: Number(cfg?.force_sign_out_before_ms ?? 0) }, 200, h);
        }
        if (req.method === "POST" && path === "/api/admin/security/force-sign-out") {
          const now = Date.now();
          if (!(await getCfg(env))) await upsertConfig({}, req, env);
          await env.DB.prepare("UPDATE showroom_config SET force_sign_out_before_ms=?,updated_at_ms=? WHERE id='showroom'").bind(now, now).run();
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
        if (req.method === "GET" && path === "/api/admin/visits/summary") {
          const today = new Date().toISOString().slice(0, 10);
          const [tot, day, rec] = await Promise.all([
            env.DB.prepare("SELECT COUNT(*) AS totalVisits, COUNT(DISTINCT visitor_id) AS uniqueVisitors FROM page_visits").first(),
            env.DB.prepare("SELECT COUNT(*) AS todayVisits, COUNT(DISTINCT visitor_id) AS todayUnique FROM page_visits WHERE date_key=?").bind(today).first(),
            env.DB.prepare("SELECT id,page,visitor_id,date_key,referrer,timestamp_millis FROM page_visits ORDER BY timestamp_millis DESC LIMIT 50").all()
          ]);
          return resJson({
            totalVisits: Number(tot?.totalVisits ?? 0), uniqueVisitors: Number(tot?.uniqueVisitors ?? 0),
            todayVisits: Number(day?.todayVisits ?? 0), todayUnique: Number(day?.todayUnique ?? 0),
            recent: rec.results ?? []
          }, 200, h);
        }
        if (req.method === "GET" && path === "/api/admin/sessions") {
          const r = await env.DB.prepare("SELECT * FROM admin_sessions ORDER BY updated_at_ms DESC LIMIT 50").all();
          return resJson({ sessions: r.results ?? [] }, 200, h);
        }
        if (req.method === "PUT" && path.startsWith("/api/admin/sessions/")) {
          const sid = cleanId(decodeURIComponent(path.slice(20)), "web");
          const b = await req.json().catch(() => ({})), now = Date.now(), st = b.status === "revoked" ? "revoked" : "active";
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
          return resJson({ ok: true, id: sid, status: st }, 200, h);
        }
        if (req.method === "POST" && path.startsWith("/api/admin/sessions/") && path.endsWith("/revoke")) {
          const sid = cleanId(decodeURIComponent(path.slice(20, -7)), "web");
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
