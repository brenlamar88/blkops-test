-- =====================================================================
-- User management — per-user menu visibility
-- Same shape as 001/002: plain SQL, one rolled-back transaction.
-- =====================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
begin;

create or replace function assert(cond boolean, label text)
returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  raise notice '  pass  %', label;
end $$;

-- A profile is created by the handle_new_user trigger on auth.users insert.
insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'menuuser@freedomhc.com');

\echo '--- menu visibility ---'

insert into user_menu_visibility (user_id, menu_key)
values ('33333333-3333-3333-3333-333333333333', '/reports');

select assert(
  (select hidden from user_menu_visibility
    where user_id='33333333-3333-3333-3333-333333333333' and menu_key='/reports'),
  'a hidden menu row defaults to hidden = true');

do $$ begin
  begin
    insert into user_menu_visibility (user_id, menu_key)
    values ('33333333-3333-3333-3333-333333333333', '/reports');
    raise exception 'FAIL: the same menu key was hidden twice for one user';
  exception when unique_violation then
    raise notice '  pass  one row per user per menu key';
  end;
end $$;

do $$ begin
  begin
    insert into user_menu_visibility (user_id, menu_key)
    values ('33333333-3333-3333-3333-333333333333', '/');
    raise exception 'FAIL: Dashboard was allowed to be hidden';
  exception when check_violation then
    raise notice '  pass  Dashboard is never hideable';
  end;
end $$;

-- Deleting the user takes their menu prefs with them.
delete from auth.users where id='33333333-3333-3333-3333-333333333333';
select assert(
  not exists (select 1 from user_menu_visibility
               where user_id='33333333-3333-3333-3333-333333333333'),
  'menu prefs cascade when the user is deleted');

rollback;
