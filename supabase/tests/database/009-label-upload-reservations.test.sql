begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(48);

select has_function(
  'public',
  'preflight_food_label_upload',
  array['uuid', 'uuid', 'food_label_image_kind'],
  'the upload preflight RPC exists'
);
select has_function(
  'public',
  'begin_food_label_upload',
  array['uuid', 'uuid', 'food_label_image_kind', 'uuid', 'text', 'text'],
  'the unique-path upload reservation RPC exists'
);
select has_function(
  'public',
  'mark_food_label_upload_stored',
  array['uuid', 'uuid'],
  'the storage acknowledgement RPC exists'
);
select has_function(
  'public',
  'finalize_food_label_upload',
  array['uuid', 'uuid', 'uuid', 'text', 'integer', 'integer', 'integer', 'text'],
  'the CAS upload finalization RPC exists'
);
select has_function(
  'public',
  'abandon_food_label_upload',
  array['uuid', 'uuid'],
  'the failed-upload cleanup RPC exists'
);
select has_function(
  'public',
  'pending_food_label_object_cleanup',
  array['uuid', 'integer'],
  'the durable cleanup lookup RPC exists'
);
select has_function(
  'public',
  'complete_food_label_object_cleanup',
  array['uuid', 'text'],
  'the post-deletion cleanup acknowledgement RPC exists'
);

select ok(
  to_regprocedure(
    'public.reserve_food_label_upload(uuid,uuid,public.food_label_image_kind)'
  ) is null,
  'the obsolete non-token reservation RPC is absent'
);

select ok(
  (
    select count(*) = 7
      and bool_and(procedure_entry.prosecdef)
      and bool_and(
        coalesce(array_to_string(procedure_entry.proconfig, ','), '')
          like '%search_path=""%'
      )
      and bool_and(
        procedure_entry.proowner = (
          select table_entry.relowner
          from pg_catalog.pg_class table_entry
          join pg_catalog.pg_namespace table_namespace
            on table_namespace.oid = table_entry.relnamespace
          where table_namespace.nspname = 'public'
            and table_entry.relname = 'food_label_submissions'
        )
      )
    from pg_catalog.pg_proc procedure_entry
    join pg_catalog.pg_namespace namespace_entry
      on namespace_entry.oid = procedure_entry.pronamespace
    where namespace_entry.nspname = 'public'
      and procedure_entry.proname in (
        'preflight_food_label_upload',
        'begin_food_label_upload',
        'mark_food_label_upload_stored',
        'finalize_food_label_upload',
        'abandon_food_label_upload',
        'pending_food_label_object_cleanup',
        'complete_food_label_object_cleanup'
      )
  ),
  'all upload coordination RPCs are trusted and search-path hardened'
);

select ok(
  not exists (
    select 1
    from (
      values
        ('public.preflight_food_label_upload(uuid,uuid,public.food_label_image_kind)'),
        ('public.begin_food_label_upload(uuid,uuid,public.food_label_image_kind,uuid,text,text)'),
        ('public.mark_food_label_upload_stored(uuid,uuid)'),
        ('public.finalize_food_label_upload(uuid,uuid,uuid,text,integer,integer,integer,text)'),
        ('public.abandon_food_label_upload(uuid,uuid)'),
        ('public.pending_food_label_object_cleanup(uuid,integer)'),
        ('public.complete_food_label_object_cleanup(uuid,text)')
    ) expected(signature)
    left join pg_catalog.pg_proc procedure_entry
      on procedure_entry.oid = to_regprocedure(expected.signature)
    where procedure_entry.oid is null
      or not pg_catalog.has_function_privilege(
        'service_role',
        procedure_entry.oid,
        'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'anon',
        procedure_entry.oid,
        'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'authenticated',
        procedure_entry.oid,
        'EXECUTE'
      )
  ),
  'only the service role can execute upload coordination RPCs'
);

select ok(
  not exists (
    select 1
    from (
      values
        ('anon', 'private.food_label_upload_attempts'),
        ('authenticated', 'private.food_label_upload_attempts'),
        ('service_role', 'private.food_label_upload_attempts'),
        ('anon', 'private.food_label_upload_preflights'),
        ('authenticated', 'private.food_label_upload_preflights'),
        ('service_role', 'private.food_label_upload_preflights'),
        ('anon', 'private.food_label_upload_reservations'),
        ('authenticated', 'private.food_label_upload_reservations'),
        ('service_role', 'private.food_label_upload_reservations'),
        ('anon', 'private.food_label_object_cleanup'),
        ('authenticated', 'private.food_label_object_cleanup'),
        ('service_role', 'private.food_label_object_cleanup')
    ) expected(role_name, table_name)
    where pg_catalog.has_table_privilege(
      expected.role_name,
      expected.table_name,
      'SELECT'
    )
      or pg_catalog.has_table_privilege(
        expected.role_name,
        expected.table_name,
        'INSERT'
      )
      or pg_catalog.has_table_privilege(
        expected.role_name,
        expected.table_name,
        'UPDATE'
      )
      or pg_catalog.has_table_privilege(
        expected.role_name,
        expected.table_name,
        'DELETE'
      )
  ),
  'upload ledgers remain inaccessible to every API role'
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'a8000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'upload-owner-a@example.test',
    '',
    null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'b8000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'upload-owner-b@example.test',
    '',
    null,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

insert into public.food_label_submissions (
  id,
  user_id,
  status,
  brand_name,
  product_name,
  label_data
)
values
  (
    'a8100000-0000-4000-8000-000000000001',
    'a8000000-0000-4000-8000-000000000001',
    'draft',
    'Upload Fixture A',
    'Upload Product A',
    '{
      "servingWeightGrams": 30,
      "calories": 120,
      "proteinGrams": 20,
      "carbohydrateGrams": 4,
      "fatGrams": 2
    }'::jsonb
  ),
  (
    'b8100000-0000-4000-8000-000000000001',
    'b8000000-0000-4000-8000-000000000001',
    'draft',
    'Upload Fixture B',
    'Upload Product B',
    '{
      "servingWeightGrams": 30,
      "calories": 120,
      "proteinGrams": 20,
      "carbohydrateGrams": 4,
      "fatGrams": 2
    }'::jsonb
  );

insert into public.food_label_images (
  submission_id,
  user_id,
  object_path,
  image_kind,
  mime_type,
  byte_size,
  pixel_width,
  pixel_height,
  sha256
)
values (
  'a8100000-0000-4000-8000-000000000001',
  'a8000000-0000-4000-8000-000000000001',
  'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000000.png',
  'nutrition',
  'image/png',
  100,
  10,
  10,
  repeat('0', 64)
);

create temporary table upload_tokens (
  slot text primary key,
  token uuid not null
);
grant select, insert, update, delete on table upload_tokens to service_role;

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
set local role service_role;

insert into pg_temp.upload_tokens (slot, token)
select 'preflight_a', preflight_token
from public.preflight_food_label_upload(
  'a8000000-0000-4000-8000-000000000001',
  'a8100000-0000-4000-8000-000000000001',
  'nutrition'
)
where allowed and not rate_limited;

select ok(
  exists (select 1 from pg_temp.upload_tokens where slot = 'preflight_a'),
  'the first upload receives a pre-processing token'
);

insert into pg_temp.upload_tokens (slot, token)
select 'reservation_a', reservation_token
from public.begin_food_label_upload(
  'a8000000-0000-4000-8000-000000000001',
  'a8100000-0000-4000-8000-000000000001',
  'nutrition',
  (select token from pg_temp.upload_tokens where slot = 'preflight_a'),
  'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000001.png',
  repeat('a', 64)
)
where allowed and not rate_limited;

select ok(
  exists (select 1 from pg_temp.upload_tokens where slot = 'reservation_a'),
  'the first upload reserves its own unique object path'
);

reset role;

select is(
  (
    select count(*)
    from private.food_label_upload_attempts
    where user_id = 'a8000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'beginning an upload does not double-count the preflight rate-limit attempt'
);

select is(
  (
    select expected_object_path
    from private.food_label_upload_reservations
    where id = (
      select token from pg_temp.upload_tokens where slot = 'reservation_a'
    )
  ),
  'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000000.png',
  'the first reservation snapshots the still-current confirmed image'
);

set local role service_role;

select is(
  public.mark_food_label_upload_stored(
    'a8000000-0000-4000-8000-000000000001',
    (select token from pg_temp.upload_tokens where slot = 'reservation_a')
  ),
  true,
  'the first stored object is acknowledged'
);

insert into pg_temp.upload_tokens (slot, token)
select 'preflight_b', preflight_token
from public.preflight_food_label_upload(
  'a8000000-0000-4000-8000-000000000001',
  'a8100000-0000-4000-8000-000000000001',
  'nutrition'
)
where allowed and not rate_limited;

select ok(
  exists (select 1 from pg_temp.upload_tokens where slot = 'preflight_b'),
  'a concurrent replacement receives a separate preflight token'
);

insert into pg_temp.upload_tokens (slot, token)
select 'reservation_b', reservation_token
from public.begin_food_label_upload(
  'a8000000-0000-4000-8000-000000000001',
  'a8100000-0000-4000-8000-000000000001',
  'nutrition',
  (select token from pg_temp.upload_tokens where slot = 'preflight_b'),
  'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000002.png',
  repeat('b', 64)
)
where allowed and not rate_limited;

select ok(
  exists (select 1 from pg_temp.upload_tokens where slot = 'reservation_b'),
  'the concurrent replacement becomes the latest reservation'
);

reset role;

select is(
  (
    select expected_object_path
    from private.food_label_upload_reservations
    where id = (
      select token from pg_temp.upload_tokens where slot = 'reservation_b'
    )
  ),
  'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000000.png',
  'the concurrent reservation sees the same confirmed image'
);

set local role service_role;

select is(
  public.mark_food_label_upload_stored(
    'a8000000-0000-4000-8000-000000000001',
    (select token from pg_temp.upload_tokens where slot = 'reservation_b')
  ),
  true,
  'the latest concurrent object is acknowledged'
);

select ok(
  (
    select not accepted and reservation_conflict
    from public.finalize_food_label_upload(
      'a8000000-0000-4000-8000-000000000001',
      'a8100000-0000-4000-8000-000000000001',
      (select token from pg_temp.upload_tokens where slot = 'reservation_a'),
      'image/png',
      101,
      10,
      10,
      repeat('a', 64)
    )
  ),
  'the losing reservation cannot overwrite a newer upload attempt'
);

reset role;

select is(
  (
    select object_path
    from public.food_label_images
    where submission_id = 'a8100000-0000-4000-8000-000000000001'
      and image_kind = 'nutrition'
  ),
  'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000000.png',
  'a CAS loss preserves the previously confirmed image'
);

set local role service_role;

select ok(
  (
    select accepted and not reservation_conflict
    from public.finalize_food_label_upload(
      'a8000000-0000-4000-8000-000000000001',
      'a8100000-0000-4000-8000-000000000001',
      (select token from pg_temp.upload_tokens where slot = 'reservation_b'),
      'image/png',
      102,
      10,
      10,
      repeat('b', 64)
    )
  ),
  'the latest stored reservation finalizes successfully'
);

reset role;

select is(
  (
    select object_path
    from public.food_label_images
    where submission_id = 'a8100000-0000-4000-8000-000000000001'
      and image_kind = 'nutrition'
  ),
  'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000002.png',
  'only the latest object becomes current'
);

select is(
  (
    select array_agg(object_path order by object_path)
    from private.food_label_object_cleanup
    where object_path in (
      'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000000.png',
      'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000001.png'
    )
  ),
  array[
    'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000000.png',
    'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000001.png'
  ]::text[],
  'both the replaced image and losing object are durably queued'
);

set local role service_role;

select is(
  (
    select array_agg(object_path order by object_path)
    from public.pending_food_label_object_cleanup(
      'a8000000-0000-4000-8000-000000000001',
      20
    )
  ),
  array[
    'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000000.png',
    'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000001.png'
  ]::text[],
  'cleanup returns only this owner''s unreferenced objects'
);

select is(
  (
    select coalesce(array_agg(object_path), '{}'::text[])
    from public.pending_food_label_object_cleanup(
      'b8000000-0000-4000-8000-000000000001',
      20
    )
  ),
  '{}'::text[],
  'another owner cannot discover pending private object paths'
);

select is(
  public.complete_food_label_object_cleanup(
    'b8000000-0000-4000-8000-000000000001',
    'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000001.png'
  ),
  true,
  'cleanup acknowledgement is idempotent without crossing owner boundaries'
);

reset role;

select ok(
  exists (
    select 1
    from private.food_label_object_cleanup
    where object_path =
      'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000001.png'
  ),
  'another owner cannot remove this account''s cleanup ledger row'
);

set local role service_role;

select is(
  public.complete_food_label_object_cleanup(
    'a8000000-0000-4000-8000-000000000001',
    'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000001.png'
  ),
  true,
  'the owner cleanup is acknowledged after object deletion'
);

select is(
  public.complete_food_label_object_cleanup(
    'a8000000-0000-4000-8000-000000000001',
    'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000000.png'
  ),
  true,
  'the replaced confirmed image cleanup is acknowledged separately'
);

reset role;

select is(
  (
    select count(*)
    from private.food_label_object_cleanup
    where object_path in (
      'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000000.png',
      'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000001.png'
    )
  ),
  0::bigint,
  'acknowledged objects leave the durable cleanup ledger'
);

set local role service_role;

insert into pg_temp.upload_tokens (slot, token)
select 'preflight_c', preflight_token
from public.preflight_food_label_upload(
  'a8000000-0000-4000-8000-000000000001',
  'a8100000-0000-4000-8000-000000000001',
  'nutrition'
)
where allowed and not rate_limited;

select ok(
  exists (select 1 from pg_temp.upload_tokens where slot = 'preflight_c'),
  'a later replacement receives a preflight token'
);

insert into pg_temp.upload_tokens (slot, token)
select 'reservation_c', reservation_token
from public.begin_food_label_upload(
  'a8000000-0000-4000-8000-000000000001',
  'a8100000-0000-4000-8000-000000000001',
  'nutrition',
  (select token from pg_temp.upload_tokens where slot = 'preflight_c'),
  'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000003.png',
  repeat('c', 64)
)
where allowed and not rate_limited;

select ok(
  exists (select 1 from pg_temp.upload_tokens where slot = 'reservation_c'),
  'the later replacement reserves a unique object path'
);

select is(
  public.mark_food_label_upload_stored(
    'a8000000-0000-4000-8000-000000000001',
    (select token from pg_temp.upload_tokens where slot = 'reservation_c')
  ),
  true,
  'the later replacement is marked stored'
);

select ok(
  (
    select accepted and not reservation_conflict
    from public.finalize_food_label_upload(
      'a8000000-0000-4000-8000-000000000001',
      'a8100000-0000-4000-8000-000000000001',
      (select token from pg_temp.upload_tokens where slot = 'reservation_c'),
      'image/png',
      103,
      10,
      10,
      repeat('c', 64)
    )
  ),
  'a later replacement CAS-finalizes against the current image'
);

reset role;

select is(
  (
    select object_path
    from public.food_label_images
    where submission_id = 'a8100000-0000-4000-8000-000000000001'
      and image_kind = 'nutrition'
  ),
  'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000003.png',
  'the later replacement becomes the only current object'
);

select ok(
  exists (
    select 1
    from private.food_label_object_cleanup
    where object_path =
      'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000002.png'
  ),
  'the previously current object is queued after replacement'
);

set local role service_role;

select is(
  (
    select array_agg(object_path order by object_path)
    from public.pending_food_label_object_cleanup(
      'a8000000-0000-4000-8000-000000000001',
      20
    )
  ),
  array[
    'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000002.png'
  ]::text[],
  'cleanup never returns the current replacement object'
);

reset role;

insert into private.food_label_object_cleanup (
  object_path,
  reservation_id,
  user_id,
  submission_id,
  reason
)
values (
  'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000003.png',
  null,
  'a8000000-0000-4000-8000-000000000001',
  'a8100000-0000-4000-8000-000000000001',
  'legacy_orphan'
);

set local role service_role;

select is(
  (
    select array_agg(object_path order by object_path)
    from public.pending_food_label_object_cleanup(
      'a8000000-0000-4000-8000-000000000001',
      20
    )
  ),
  array[
    'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000002.png'
  ]::text[],
  'a deployment-race ledger row never exposes a now-referenced object'
);

reset role;

select ok(
  not exists (
    select 1
    from private.food_label_object_cleanup
    where object_path =
      'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000003.png'
  ),
  'a now-referenced false-positive cleanup row is removed'
);

set local role service_role;

select is(
  public.complete_food_label_object_cleanup(
    'a8000000-0000-4000-8000-000000000001',
    'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000002.png'
  ),
  true,
  'the replaced object cleanup can be acknowledged'
);

reset role;

select ok(
  not exists (
    select 1
    from private.food_label_object_cleanup
    where object_path =
      'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000002.png'
  ),
  'the replaced object no longer remains queued'
);

set local role service_role;

insert into pg_temp.upload_tokens (slot, token)
select 'preflight_d', preflight_token
from public.preflight_food_label_upload(
  'a8000000-0000-4000-8000-000000000001',
  'a8100000-0000-4000-8000-000000000001',
  'nutrition'
)
where allowed and not rate_limited;

select ok(
  exists (select 1 from pg_temp.upload_tokens where slot = 'preflight_d'),
  'a future crashed request receives a preflight token'
);

insert into pg_temp.upload_tokens (slot, token)
select 'reservation_d', reservation_token
from public.begin_food_label_upload(
  'a8000000-0000-4000-8000-000000000001',
  'a8100000-0000-4000-8000-000000000001',
  'nutrition',
  (select token from pg_temp.upload_tokens where slot = 'preflight_d'),
  'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000004.png',
  repeat('d', 64)
)
where allowed and not rate_limited;

select ok(
  exists (select 1 from pg_temp.upload_tokens where slot = 'reservation_d'),
  'the future crashed request has a durable reservation'
);

reset role;

update private.food_label_upload_reservations
set created_at = now() - interval '31 minutes'
where id = (
  select token from pg_temp.upload_tokens where slot = 'reservation_d'
);

set local role service_role;

select is(
  (
    select array_agg(object_path order by object_path)
    from public.pending_food_label_object_cleanup(
      'a8000000-0000-4000-8000-000000000001',
      20
    )
  ),
  array[
    'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000004.png'
  ]::text[],
  'a crashed reservation becomes durably discoverable after its lease expires'
);

reset role;

select is(
  (
    select status
    from private.food_label_upload_reservations
    where id = (
      select token from pg_temp.upload_tokens where slot = 'reservation_d'
    )
  ),
  'cleanup_pending',
  'the expired crash reservation remains pending until object deletion succeeds'
);

select is(
  (
    select object_path
    from public.food_label_images
    where submission_id = 'a8100000-0000-4000-8000-000000000001'
      and image_kind = 'nutrition'
  ),
  'a8000000-0000-4000-8000-000000000001/a8100000-0000-4000-8000-000000000001/a8200000-0000-4000-8000-000000000003.png',
  'crash recovery never replaces the confirmed image'
);

select * from finish();
rollback;
