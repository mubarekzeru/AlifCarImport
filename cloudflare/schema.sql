-- Alif Car Import — Cloudflare D1 Schema
-- Apply remotely with:
--   npx wrangler d1 execute alif-car-import-db --remote --file=cloudflare/schema.sql

CREATE TABLE IF NOT EXISTS showroom_config (
  id TEXT PRIMARY KEY,
  branding_json TEXT NOT NULL,
  hero_json TEXT NOT NULL,
  tiktok_header_json TEXT NOT NULL,
  contact_json TEXT NOT NULL,
  admin_emails_json TEXT NOT NULL DEFAULT '["alifcarimports@gmail.com"]',
  force_sign_out_before_ms INTEGER NOT NULL DEFAULT 0,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  original_price REAL,
  mileage TEXT NOT NULL DEFAULT '',
  transmission TEXT NOT NULL DEFAULT 'Automatic',
  fuel_type TEXT NOT NULL DEFAULT 'Petrol',
  color TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'Direct Import',
  image_url TEXT NOT NULL,
  gallery_images_json TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL,
  tiktok_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'available',
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vehicles_created_at ON vehicles (created_at DESC);

CREATE TABLE IF NOT EXISTS tiktok_posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  tiktok_url TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tiktok_posts_order ON tiktok_posts (sort_order DESC, updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS inquiries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  vehicle_title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries (created_at_ms DESC);

CREATE TABLE IF NOT EXISTS page_visits (
  id TEXT PRIMARY KEY,
  page TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  referrer TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  timestamp_millis INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_page_visits_date ON page_visits (date_key, timestamp_millis DESC);
CREATE INDEX IF NOT EXISTS idx_page_visits_visitor ON page_visits (visitor_id);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  email TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  login_at_millis INTEGER NOT NULL,
  last_active_millis INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_status ON admin_sessions (status, updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS login_alerts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  email TEXT NOT NULL,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  timestamp_millis INTEGER NOT NULL,
  decision TEXT NOT NULL DEFAULT 'pending',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_alerts_time ON login_alerts (timestamp_millis DESC);
