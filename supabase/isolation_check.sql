-- supabase/isolation_check.sql
--
-- THE TWO-BUSINESS ISOLATION CHECK (§107; docs/AFTER_FIRST_CUSTOMERS.md,
-- principle 4: "data isolation is checked, not assumed").
--
-- Paste the whole file into Supabase → SQL Editor and Run. It works inside
-- ONE transaction and ROLLS BACK at the end, so nothing it creates is kept:
-- two test sign-ups, the two businesses approved for them, their test
-- customers and files, and the master starter refresh.
--
-- What it proves, acting as each person in turn (as the app would, through
-- RLS):
--   1. approval creates a separate business with its own copy of the
--      starter catalogue and a saved default;
--   2. A sees only A's customers, catalogue and default — none of B's, none
--      of biz_default's, none of the master starter;
--   3. A can't write into B's business: no insert, no update, no delete;
--   4. A can't create or join a business, or call the owner-only functions;
--   5. A can write files only under A's own folder;
--   6. "Go back to my default" restores an edited price and a deleted item,
--      and keeps an item added since;
--   7. a sign-up still waiting for approval sees and writes nothing.
--
-- Success: the editor's result shows one row, "ALL ISOLATION CHECKS
-- PASSED". Any failure stops with a red error naming the check. (The
-- numbered OK messages are notices, which psql prints but Supabase's
-- editor doesn't, so nothing else in between returns a result.) Re-run
-- after any change to RLS or storage rules.

begin;

do $$ begin raise notice 'Starting isolation check (everything below is rolled back).'; end $$;

-- Test people: A and B will be approved; C stays waiting.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'iso-a@example.test', '{"full_name": "Iso A", "business_name": "Iso Kitchens A"}'),
  ('00000000-0000-4000-8000-00000000000b', 'iso-b@example.test', '{"full_name": "Iso B", "business_name": "Iso Kitchens B"}'),
  ('00000000-0000-4000-8000-00000000000c', 'iso-c@example.test', '{"full_name": "Iso C", "business_name": "Waiting Co"}');

-- As the owner (this editor session): fill the master starter from
-- biz_default, then approve A and B as new businesses.
do $$ begin perform public.refresh_starter_catalog('biz_default'); end $$;
create temp table iso (who text primary key, business text) on commit drop;
insert into iso values
  ('a', public.approve_new_business('00000000-0000-4000-8000-00000000000a')),
  ('b', public.approve_new_business('00000000-0000-4000-8000-00000000000b'));
grant select on iso to authenticated;

do $$
declare a text := (select business from iso where who = 'a');
        b text := (select business from iso where who = 'b');
begin
  -- 1. Approval
  assert (select name from public.businesses where id = a) = 'Iso Kitchens A', '1: business named from the sign-up';
  assert (select count(*) from public.surface_finishes where business_id = a)
       = (select count(*) from public.surface_finishes where business_id = 'biz_starter'), '1: starter finishes copied';
  assert (select count(*) from public.catalog_defaults where business_id = a) > 0, '1: default saved on approval';
  assert not exists (
    select 1 from public.cabinet_catalog_items c
    where c.business_id = a and c.finish_id is not null
      and not exists (select 1 from public.surface_finishes f where f.id = c.finish_id and f.business_id = a)
  ), '1: copied cabinets point at the copied finishes';
  -- One customer each, for the read checks.
  insert into public.projects (id, client_name, phone, address, locality, business_id)
    values ('iso-proj-a', 'Customer of A', '1', 'x', 'x', a), ('iso-proj-b', 'Customer of B', '2', 'x', 'x', b);
  raise notice '1. Approval: separate businesses, starter copied, default saved. OK';
end $$;

-- From here on, act as A, through RLS, as the app does.
set local role authenticated;
do $$ begin perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true); end $$;

do $$
declare a text := (select business from iso where who = 'a');
        b text := (select business from iso where who = 'b');
        t text;
        n integer;
begin
  assert public.current_business_id() = a, 'acting as A';

  -- 2. Reads
  assert (select count(*) from public.projects) = 1 and exists (select 1 from public.projects where id = 'iso-proj-a'), '2: A sees only its own customer';
  foreach t in array public.catalog_tables() || array['rate_cards', 'construction_settings', 'quotes', 'layouts'] loop
    execute format('select count(*) from public.%I where business_id <> %L', t, a) into n;
    assert n = 0, format('2: A sees another business''s rows in %s', t);
  end loop;
  assert (select count(*) from public.catalog_defaults where business_id <> a) = 0, '2: A sees only its own default';
  assert (select count(*) from public.businesses) = 1, '2: A sees only its own business';
  raise notice '2. Reads: only A''s own customers, catalogue, defaults and business. OK';

  -- 3. Writes into B
  begin
    insert into public.projects (id, client_name, phone, address, locality, business_id) values ('iso-sneak', 'x', 'x', 'x', 'x', b);
    raise exception '3: A inserted a customer into B';
  exception when insufficient_privilege then null; end;
  update public.projects set client_name = 'changed by A' where id = 'iso-proj-b';
  get diagnostics n = row_count;
  assert n = 0, '3: A updated B''s customer';
  delete from public.surface_finishes where business_id = b;
  get diagnostics n = row_count;
  assert n = 0, '3: A deleted B''s finishes';
  begin
    insert into public.catalog_defaults (business_id, table_name, item_id, row) values (b, 'handles', 'x', '{}');
    raise exception '3: A wrote into B''s default';
  exception when insufficient_privilege then null; end;
  raise notice '3. Writes into B: refused. OK';

  -- 4. Creating or joining a business; owner-only functions
  begin
    insert into public.business_users (business_id, user_id) values (b, '00000000-0000-4000-8000-00000000000a');
    raise exception '4: A joined B';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.businesses (id, name) values ('iso-new', 'x');
    raise exception '4: A created a business';
  exception when insufficient_privilege then null; end;
  begin
    perform public.approve_new_business('00000000-0000-4000-8000-00000000000c');
    raise exception '4: A approved a sign-up';
  exception when insufficient_privilege then null; end;
  begin
    perform public.refresh_starter_catalog(a);
    raise exception '4: A rebuilt the master starter';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_catalog_default(b);
    raise exception '4: A saved B''s default';
  exception when insufficient_privilege then null; end;
  raise notice '4. Creating/joining a business and owner-only functions: refused. OK';

  -- 5. Files
  insert into storage.objects (bucket_id, name) values ('quote-pdfs', a || '/iso/v1.pdf');
  foreach t in array array['quote-pdfs', 'panoramas', 'material-swatches'] loop
    begin
      insert into storage.objects (bucket_id, name) values (t, b || '/iso.bin');
      raise exception '5: A wrote into B''s folder in %', t;
    exception when insufficient_privilege then null; end;
    begin
      insert into storage.objects (bucket_id, name) values (t, 'iso-no-folder.bin');
      raise exception '5: A wrote outside any business folder in %', t;
    exception when insufficient_privilege then null; end;
  end loop;
  raise notice '5. Files: only into A''s own folder. OK';

  -- 6. Save / go back to default
  update public.surface_finishes set price_per_sq_m = 99999 where id = (select min(id) from public.surface_finishes);
  delete from public.obstacle_presets where id = (select min(id) from public.obstacle_presets);
  insert into public.obstacle_presets (id, label, type, width_mm, depth_mm, floor_to_ceiling, height_mm, elevation_mm, business_id)
    values (a || ':iso-new', 'Added after the default', 'pillar', 300, 300, true, 2700, 0, a);
  perform public.restore_my_catalog_default();
  assert not exists (select 1 from public.surface_finishes where price_per_sq_m = 99999), '6: edited price restored';
  assert (select count(*) from public.obstacle_presets where id <> a || ':iso-new')
       = (select count(*) from public.catalog_defaults where table_name = 'obstacle_presets'), '6: deleted item restored';
  assert exists (select 1 from public.obstacle_presets where id = a || ':iso-new'), '6: item added since is kept';
  -- Saving again makes the new item part of the default.
  perform public.save_my_catalog_default();
  assert exists (select 1 from public.catalog_defaults where item_id = a || ':iso-new'), '6: save includes the new item';
  raise notice '6. Save / go back to default: price restored, deleted item back, new item kept. OK';
end $$;

-- 7. A sign-up still waiting for approval.
do $$ begin perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c", "role": "authenticated"}', true); end $$;
do $$
declare t text;
        n integer;
begin
  assert public.current_business_id() is null, 'C is waiting';
  foreach t in array array['projects', 'businesses', 'catalog_defaults'] || public.catalog_tables() loop
    execute format('select count(*) from public.%I', t) into n;
    assert n = 0, format('7: a waiting account sees rows in %s', t);
  end loop;
  begin
    insert into storage.objects (bucket_id, name) values ('quote-pdfs', 'anything/x.pdf');
    raise exception '7: a waiting account wrote a file';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_my_catalog_default();
    raise exception '7: a waiting account saved a default';
  exception when raise_exception then
    if sqlerrm not like '%not in a business%' then raise; end if;
  end;
  raise notice '7. Waiting sign-up: sees nothing, writes nothing. OK';
  raise notice 'ALL ISOLATION CHECKS PASSED';
end $$;

rollback;

-- Only reached if every check above passed (an error stops the run).
select 'ALL ISOLATION CHECKS PASSED' as result;
