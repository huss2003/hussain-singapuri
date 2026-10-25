-- Hussain Singapuri portfolio: schema. Applied by ensureSchema() on boot. Money is integer minor units.
create table if not exists meta (key text primary key, value jsonb not null);

-- Work reel (editable from /admin; seeded from data/content.json)
create table if not exists projects (
  id serial primary key,
  slug text unique not null,
  title text not null,
  client text not null default '',
  kind text not null default 'web',            -- web | ai
  clip text not null default '',
  url text not null default '',
  repo text not null default '',
  tags jsonb not null default '[]',
  year integer,
  poster text not null default '',
  summary text not null default '',
  visible boolean not null default true,
  position integer not null default 0,
  clicks integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id serial primary key,
  email text unique not null,
  name text not null default '',
  password_hash text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  id text primary key, customer_id integer not null references users(id) on delete cascade,
  expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table if not exists auth_throttle (key text primary key, failures integer not null default 0, window_start timestamptz not null default now());
-- generic fixed-window rate limit shared by every serverless instance
create table if not exists rate_limits (key text primary key, hits integer not null default 0, window_start timestamptz not null default now());

create table if not exists leads (
  id text primary key,
  name text not null,
  email text not null,
  company text not null default '',
  need text not null default '',
  budget text not null default '',
  timeline text not null default '',
  message text not null,
  status text not null default 'new' check (status in ('new','contacted','proposal','won','lost')),
  notes text not null default '',
  ip_hash text,
  user_agent text,
  referer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Calls. The partial unique index is what stops two people taking the same slot:
-- a held (unpaid) and a confirmed booking compete for one row.
create table if not exists bookings (
  id text primary key,
  service_id text not null,
  service_name text not null,
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  slot_local text not null,
  timezone text not null,
  name text not null,
  email text not null,
  company text not null default '',
  notes text not null default '',
  status text not null check (status in ('held','confirmed','expired','cancelled')),
  amount integer not null default 0,
  currency text not null default 'USD',
  hold_expires_at timestamptz,
  stripe_session_id text unique,
  stripe_url text,
  payment_intent text,
  refunded integer not null default 0,
  meet_url text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create unique index if not exists one_active_booking_per_slot on bookings (slot_start) where status in ('held','confirmed');

create table if not exists emails (
  id serial primary key, to_email text not null, subject text not null, html text not null,
  kind text not null default 'transactional', status text not null default 'logged', ref text, created_at timestamptz not null default now()
);

create table if not exists events (
  id serial primary key,
  source text not null,                        -- stripe | system | admin | crm
  type text not null,
  ref text,
  verified boolean not null default true,
  data jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists events_stripe_ref on events (ref) where source = 'stripe' and verified
