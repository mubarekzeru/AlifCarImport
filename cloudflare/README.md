# Alif Car Import — Cloudflare (D1 + R2 + Workers) + Firebase Auth Setup

This folder gives you a complete, zero-dependency Cloudflare backend that keeps **Firebase Authentication** for `/admin` and your Android Admin app while moving all showroom data and car/TikTok images to **Cloudflare D1 (5M free reads/day)** and **Cloudflare R2 (10 GB free + $0 bandwidth)**.

---

## 1. Create the Cloudflare D1 Database & R2 Bucket

Install/use Wrangler (`npx wrangler`) and sign in to your free Cloudflare account:

```bash
npx wrangler login
npx wrangler d1 create alif-car-import-db
npx wrangler r2 bucket create alif-car-import-media
```

Copy the `database_id` printed by `d1 create` and paste it into `cloudflare/wrangler.toml` (`database_id = "..."`).

---

## 2. Create the Tables in Cloudflare D1

```bash
npx wrangler d1 execute alif-car-import-db --remote --file=cloudflare/schema.sql
```

---

## 3. Deploy the Cloudflare Worker

```bash
npx wrangler deploy --config cloudflare/wrangler.toml
```

Wrangler will print your live Worker URL, for example:
```
https://alif-car-import-api.<your-subdomain>.workers.dev
```

Verify it is live:
```bash
curl https://alif-car-import-api.<your-subdomain>.workers.dev/api/health
```

---

## 4. Connect the Website to Cloudflare

Set this environment variable in your `.env` (or GitHub Actions / hosting build settings):

```env
VITE_CLOUDFLARE_API_URL="https://alif-car-import-api.<your-subdomain>.workers.dev"
```

Once `VITE_CLOUDFLARE_API_URL` is set and the site is rebuilt:
- Public visitors make **0 Firestore reads** (everything loads from Cloudflare D1 + R2).
- `/admin` continues signing in with **Firebase Authentication** (same shared email/password & Google Sign-In) and sends `Authorization: Bearer <firebaseIdToken>` to the Worker.
- Uploaded car photos and TikTok covers are automatically stored in **Cloudflare R2** and served via `/media/<key>` with immutable CDN caching.

---

## 5. Connect Your Android Admin App

Keep Firebase Authentication in your Android app, get the signed-in user's ID token (`FirebaseAuth.getInstance().currentUser?.getIdToken(false)`), and send it in the header on every admin request:

```http
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
```

### Shared API Endpoints (Website + Android Admin App)

| Action | Method & Path | Auth |
| :--- | :--- | :--- |
| Load showroom (vehicles, TikTok, config, contact) | `GET /api/showroom` | Public |
| Load R2 image | `GET /media/<key>` | Public |
| Submit customer inquiry | `POST /api/inquiries` | Public |
| Record visitor page view | `POST /api/visits` | Public |
| Upload photo to R2 (multipart `file` or JSON `{ dataUrl, folder }`) | `POST /api/admin/upload` | Firebase Admin Token |
| Add or update a vehicle (auto-uploads base64 images to R2) | `PUT /api/admin/vehicles/:id` | Firebase Admin Token |
| Delete a vehicle | `DELETE /api/admin/vehicles/:id` | Firebase Admin Token |
| Add or update a TikTok reel | `PUT /api/admin/tiktok/:id` | Firebase Admin Token |
| Delete a TikTok reel | `DELETE /api/admin/tiktok/:id` | Firebase Admin Token |
| Update branding, hero, TikTok header, contact & socials | `PUT /api/admin/config` | Firebase Admin Token |
| Read / update admin email allowlist | `GET` / `PUT /api/admin/access` | Firebase Admin Token |
| Read / trigger global force sign-out on password change | `GET /api/admin/security` / `POST /api/admin/security/force-sign-out` | Firebase Admin Token |
| List customer inquiries | `GET /api/admin/inquiries` | Firebase Admin Token |
| Visitor analytics summary | `GET /api/admin/visits/summary` | Firebase Admin Token |
| Active admin sessions | `GET /api/admin/sessions`, `PUT /api/admin/sessions/:id`, `POST /api/admin/sessions/:id/revoke` | Firebase Admin Token |
