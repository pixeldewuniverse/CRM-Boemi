-- Global search: trigram indexes make ILIKE '%term%' fast.
-- pg_trgm ships with Neon and Cloud SQL. If the extension can't be created
-- (no privilege / not available), search still works with plain ILIKE.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm not available (%), global search falls back to plain ILIKE', SQLERRM;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  idx text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RETURN;
  END IF;
  FOREACH idx SLICE 1 IN ARRAY ARRAY[
    ['customers_name_trgm', 'customers', 'name'],
    ['contacts_name_trgm', 'contacts', 'name'],
    ['leads_company_trgm', 'leads', 'company'],
    ['opportunities_title_trgm', 'opportunities', 'title'],
    ['quotations_quote_no_trgm', 'quotations', 'quote_no'],
    ['orders_order_no_trgm', 'orders', 'order_no'],
    ['products_name_trgm', 'products', 'name'],
    ['products_sku_trgm', 'products', 'sku'],
    ['tasks_title_trgm', 'tasks', 'title'],
    ['campaigns_name_trgm', 'campaigns', 'name'],
    ['events_name_trgm', 'events', 'name']
  ] LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING gin (%I gin_trgm_ops)', idx[1], idx[2], idx[3]);
  END LOOP;
END $$;
