-- ============================================================
--  StockBook — PostgreSQL / Supabase schema (optional migration)
--
--  The bundled app runs on SQLite (server/db.js) and needs no
--  setup. Use this file if you would rather host the data in
--  Supabase: run it in the Supabase SQL editor, then point a
--  Postgres-compatible driver at the same tables.
--
--  Stock is never stored as a mutable column — it is always
--  recalculated from stock_transactions (see product_stock).
-- ============================================================

create table if not exists warehouses (
  id          bigserial primary key,
  name        text not null unique,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- the application is fixed to these three warehouses
insert into warehouses (name, sort_order) values
  ('AKASHARWDI', 1), ('TABLE 1', 2), ('CHAIR', 3)
on conflict (name) do nothing;

create table if not exists products (
  id              bigserial primary key,
  name            text not null,
  warehouse_id    bigint not null references warehouses(id),
  pcs_per_carton  int not null default 1 check (pcs_per_carton > 0),
  image_path      text,                       -- or a Supabase Storage URL
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists stock_transactions (
  id              bigserial primary key,
  product_id      bigint not null references products(id),
  warehouse_id    bigint not null references warehouses(id),
  type            text not null check (type in ('OPENING','INBOUND','OUTBOUND','ADJUSTMENT','TRANSFER')),
  tx_date         date not null default current_date,
  carton          int not null default 0,     -- exactly as typed by the user
  pcs             int not null default 0,     -- exactly as typed by the user
  pcs_per_carton  int not null,               -- rate snapshot at entry time
  qty_pcs         bigint not null,            -- signed total in pieces
  note            text,
  voided_at       timestamptz,                -- soft delete, never a hard delete
  void_reason     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists transaction_revisions (
  id              bigserial primary key,
  transaction_id  bigint not null references stock_transactions(id),
  action          text not null,              -- EDIT | VOID | RESTORE
  before_json     jsonb not null,
  after_json      jsonb,
  reason          text,
  created_at      timestamptz not null default now()
);

create table if not exists product_revisions (
  id           bigserial primary key,
  product_id   bigint not null references products(id),
  before_json  jsonb not null,
  after_json   jsonb not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_tx_product    on stock_transactions(product_id);
create index if not exists idx_tx_warehouse  on stock_transactions(warehouse_id);
create index if not exists idx_tx_date       on stock_transactions(tx_date);
create index if not exists idx_tx_type       on stock_transactions(type);
create index if not exists idx_prod_wh       on products(warehouse_id);

-- live stock per product, always derived from the transaction log
create or replace view product_stock as
select
  p.id                                            as product_id,
  p.name,
  p.warehouse_id,
  w.name                                          as warehouse_name,
  p.pcs_per_carton,
  coalesce(sum(t.qty_pcs), 0)                     as total_pcs,
  floor(abs(coalesce(sum(t.qty_pcs), 0)) / p.pcs_per_carton)
      * sign(coalesce(sum(t.qty_pcs), 0))         as current_cartons,
  abs(coalesce(sum(t.qty_pcs), 0)) % p.pcs_per_carton
      * sign(coalesce(sum(t.qty_pcs), 0))         as current_pcs,
  coalesce(sum(t.qty_pcs) filter (where t.type = 'OPENING'), 0)  as opening_pcs,
  coalesce(sum(t.qty_pcs) filter (where t.type = 'INBOUND'), 0)  as inbound_pcs,
  coalesce(sum(-t.qty_pcs) filter (where t.type = 'OUTBOUND'), 0) as outbound_pcs,
  coalesce(sum(t.qty_pcs) filter (where t.type = 'INBOUND'  and t.tx_date = current_date), 0) as today_in_pcs,
  coalesce(sum(-t.qty_pcs) filter (where t.type = 'OUTBOUND' and t.tx_date = current_date), 0) as today_out_pcs
from products p
join warehouses w on w.id = p.warehouse_id
left join stock_transactions t
       on t.product_id = p.id and t.voided_at is null
group by p.id, p.name, p.warehouse_id, w.name, p.pcs_per_carton;

-- Warehouse-wise summary
create or replace view warehouse_stock as
select
  w.id, w.name,
  count(distinct ps.product_id)  as products,
  coalesce(sum(ps.total_pcs), 0) as total_pcs,
  coalesce(sum(ps.today_in_pcs), 0)  as today_in_pcs,
  coalesce(sum(ps.today_out_pcs), 0) as today_out_pcs
from warehouses w
left join product_stock ps on ps.warehouse_id = w.id
group by w.id, w.name;

-- Outbound must never push a product below zero.
create or replace function guard_outbound() returns trigger as $$
declare available bigint;
begin
  if new.qty_pcs < 0 then
    select coalesce(sum(qty_pcs), 0) into available
      from stock_transactions
     where product_id = new.product_id and voided_at is null and id <> new.id;
    if available + new.qty_pcs < 0 then
      raise exception 'Insufficient stock.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end; $$ language plpgsql;

drop trigger if exists stock_transactions_guard on stock_transactions;
create trigger stock_transactions_guard
  before insert or update on stock_transactions
  for each row execute function guard_outbound();

-- If the app is exposed through Supabase directly (no Node server),
-- enable row level security and add a policy for your users, e.g.:
--   alter table stock_transactions enable row level security;
--   create policy "staff write" on stock_transactions for all using (auth.role() = 'authenticated');
