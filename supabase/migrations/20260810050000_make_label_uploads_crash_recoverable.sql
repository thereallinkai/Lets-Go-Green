begin;

create table private.food_label_upload_preflights (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null,
  image_kind public.food_label_image_kind not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  foreign key (submission_id, user_id)
    references public.food_label_submissions (id, user_id)
    on delete cascade
);

create index food_label_upload_preflights_user_time_idx
  on private.food_label_upload_preflights (user_id, created_at desc);

create table private.food_label_upload_reservations (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null,
  image_kind public.food_label_image_kind not null,
  object_path text not null unique
    check (char_length(object_path) between 1 and 1024),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  expected_image_id uuid,
  expected_object_path text,
  status text not null
    check (
      status in (
        'reserved',
        'uploaded',
        'current',
        'superseded',
        'cleanup_pending',
        'cleaned'
      )
    ),
  is_latest boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  foreign key (submission_id, user_id)
    references public.food_label_submissions (id, user_id)
    on delete cascade
);

create unique index food_label_upload_reservations_latest_idx
  on private.food_label_upload_reservations (
    submission_id,
    image_kind
  )
  where is_latest;
create index food_label_upload_reservations_user_status_idx
  on private.food_label_upload_reservations (
    user_id,
    status,
    created_at
  );

create table private.food_label_object_cleanup (
  object_path text primary key
    check (char_length(object_path) between 1 and 1024),
  reservation_id uuid
    references private.food_label_upload_reservations(id)
    on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null,
  reason text not null
    check (
      reason in (
        'superseded',
        'cas_conflict',
        'replaced',
        'upload_failed',
        'stale_reservation',
        'legacy_orphan'
      )
    ),
  queued_at timestamptz not null default now(),
  foreign key (submission_id, user_id)
    references public.food_label_submissions (id, user_id)
    on delete cascade
);

create index food_label_object_cleanup_user_time_idx
  on private.food_label_object_cleanup (user_id, queued_at);

revoke all on private.food_label_upload_reservations
  from public, anon, authenticated, service_role;
revoke all on private.food_label_object_cleanup
  from public, anon, authenticated, service_role;
revoke all on private.food_label_upload_preflights
  from public, anon, authenticated, service_role;

-- Discover historical UUID-path objects that have no current metadata row.
-- Deletion remains a trusted-server operation and rechecks references later.
insert into private.food_label_object_cleanup (
  object_path,
  reservation_id,
  user_id,
  submission_id,
  reason
)
select
  object.name,
  null,
  submission.user_id,
  submission.id,
  'legacy_orphan'
from storage.objects object
join public.food_label_submissions submission
  on object.name like (
    submission.user_id::text || '/' || submission.id::text || '/%'
  )
where object.bucket_id = 'food-labels'
  and object.name ~ (
    '^' || submission.user_id::text || '/' || submission.id::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png)$'
  )
  and not exists (
    select 1
    from public.food_label_images image
    where image.object_path = object.name
  )
on conflict (object_path) do nothing;

create function public.preflight_food_label_upload(
  target_user_id uuid,
  target_submission_id uuid,
  target_image_kind public.food_label_image_kind
)
returns table (
  allowed boolean,
  rate_limited boolean,
  preflight_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_submission_status public.food_label_submission_status;
  new_preflight_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role'
    or target_user_id is null
    or target_submission_id is null
    or target_image_kind is null
  then
    raise exception using
      errcode = '42501',
      message = 'Label-upload preflight is restricted to the trusted server.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('food-label-upload-rate:' || target_user_id::text, 0)
  );

  delete from private.food_label_upload_preflights preflight
  where preflight.created_at < now() - interval '7 days';

  delete from private.food_label_upload_attempts attempt
  where attempt.user_id = target_user_id
    and attempt.attempted_at < now() - interval '7 days';

  select submission.status
  into current_submission_status
  from public.food_label_submissions submission
  where submission.id = target_submission_id
    and submission.user_id = target_user_id
  for update;

  if current_submission_status is null
    or current_submission_status not in ('draft', 'needs_changes')
  then
    raise exception using
      errcode = '23514',
      message = 'The label submission is not editable by this account.';
  end if;

  if (
    select count(*)
    from private.food_label_upload_attempts attempt
    where attempt.user_id = target_user_id
      and attempt.attempted_at >= now() - interval '24 hours'
  ) >= 20 then
    return query select false, true, null::uuid;
    return;
  end if;

  insert into private.food_label_upload_attempts (
    user_id,
    submission_id,
    image_kind
  )
  values (
    target_user_id,
    target_submission_id,
    target_image_kind
  );

  insert into private.food_label_upload_preflights (
    user_id,
    submission_id,
    image_kind
  )
  values (
    target_user_id,
    target_submission_id,
    target_image_kind
  )
  returning id into new_preflight_id;

  return query select true, false, new_preflight_id;
end;
$$;

create function public.begin_food_label_upload(
  target_user_id uuid,
  target_submission_id uuid,
  target_image_kind public.food_label_image_kind,
  target_preflight_token uuid,
  target_object_path text,
  target_sha256 text
)
returns table (
  allowed boolean,
  rate_limited boolean,
  reservation_token uuid,
  object_path text,
  existing_image_id uuid,
  existing_object_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_image_id uuid;
  current_object_path text;
  current_submission_status public.food_label_submission_status;
  new_reservation_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role'
    or target_user_id is null
    or target_submission_id is null
    or target_image_kind is null
    or target_preflight_token is null
    or target_object_path is null
    or target_sha256 !~ '^[a-f0-9]{64}$'
    or target_object_path !~ (
      '^' || target_user_id::text || '/' || target_submission_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png)$'
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Label-upload reservation is restricted to the trusted server.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'food-label-upload:' || target_user_id::text || ':' ||
        target_submission_id::text || ':' || target_image_kind::text,
      0
    )
  );

  select submission.status
  into current_submission_status
  from public.food_label_submissions submission
  where submission.id = target_submission_id
    and submission.user_id = target_user_id
  for update;

  if current_submission_status is null
    or current_submission_status not in ('draft', 'needs_changes')
  then
    raise exception using
      errcode = '23514',
      message = 'The label submission is not editable by this account.';
  end if;

  update private.food_label_upload_preflights preflight
  set used_at = now()
  where preflight.id = target_preflight_token
    and preflight.user_id = target_user_id
    and preflight.submission_id = target_submission_id
    and preflight.image_kind = target_image_kind
    and preflight.used_at is null
    and preflight.created_at >= now() - interval '30 minutes';

  if not found then
    raise exception using
      errcode = '23514',
      message = 'The label-upload preflight is invalid or expired.';
  end if;

  select image.id, image.object_path
  into current_image_id, current_object_path
  from public.food_label_images image
  where image.submission_id = target_submission_id
    and image.user_id = target_user_id
    and image.image_kind = target_image_kind
  for update;

  with superseded as (
    update private.food_label_upload_reservations reservation
    set
      is_latest = false,
      status = case
        when reservation.status = 'uploaded' then 'cleanup_pending'
        when reservation.status = 'reserved' then 'superseded'
        else reservation.status
      end,
      updated_at = now()
    where reservation.submission_id = target_submission_id
      and reservation.user_id = target_user_id
      and reservation.image_kind = target_image_kind
      and reservation.is_latest
    returning reservation.*
  )
  insert into private.food_label_object_cleanup (
    object_path,
    reservation_id,
    user_id,
    submission_id,
    reason
  )
  select
    superseded.object_path,
    superseded.id,
    superseded.user_id,
    superseded.submission_id,
    'superseded'
  from superseded
  where superseded.status = 'cleanup_pending'
  on conflict (object_path) do update
  set
    reason = excluded.reason,
    queued_at = now();

  insert into private.food_label_upload_reservations (
    user_id,
    submission_id,
    image_kind,
    object_path,
    sha256,
    expected_image_id,
    expected_object_path,
    status,
    is_latest
  )
  values (
    target_user_id,
    target_submission_id,
    target_image_kind,
    target_object_path,
    target_sha256,
    current_image_id,
    current_object_path,
    'reserved',
    true
  )
  returning id into new_reservation_id;

  return query
  select
    true,
    false,
    new_reservation_id,
    target_object_path,
    current_image_id,
    current_object_path;
end;
$$;

create function public.mark_food_label_upload_stored(
  target_user_id uuid,
  target_reservation_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_record private.food_label_upload_reservations%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role'
    or target_user_id is null
    or target_reservation_token is null
  then
    raise exception using
      errcode = '42501',
      message = 'Label-upload finalization is restricted to the trusted server.';
  end if;

  select reservation.*
  into reservation_record
  from private.food_label_upload_reservations reservation
  where reservation.id = target_reservation_token
    and reservation.user_id = target_user_id;

  if reservation_record.id is null then
    raise exception using
      errcode = '23514',
      message = 'The label-upload reservation is invalid.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'food-label-upload:' || reservation_record.user_id::text || ':' ||
        reservation_record.submission_id::text || ':' ||
        reservation_record.image_kind::text,
      0
    )
  );

  select reservation.*
  into reservation_record
  from private.food_label_upload_reservations reservation
  where reservation.id = target_reservation_token
    and reservation.user_id = target_user_id
  for update;

  if reservation_record.status = 'current' then
    return true;
  end if;

  if reservation_record.is_latest
    and reservation_record.status in ('reserved', 'uploaded')
  then
    update private.food_label_upload_reservations
    set status = 'uploaded', updated_at = now()
    where id = reservation_record.id;
    return true;
  end if;

  update private.food_label_upload_reservations
  set
    is_latest = false,
    status = 'cleanup_pending',
    updated_at = now()
  where id = reservation_record.id
    and status <> 'cleaned';

  insert into private.food_label_object_cleanup (
    object_path,
    reservation_id,
    user_id,
    submission_id,
    reason
  )
  values (
    reservation_record.object_path,
    reservation_record.id,
    reservation_record.user_id,
    reservation_record.submission_id,
    'superseded'
  )
  on conflict (object_path) do update
  set queued_at = now();

  return false;
end;
$$;

create function public.finalize_food_label_upload(
  target_user_id uuid,
  target_submission_id uuid,
  target_reservation_token uuid,
  target_mime_type text,
  target_byte_size integer,
  target_pixel_width integer,
  target_pixel_height integer,
  target_sha256 text
)
returns table (
  accepted boolean,
  reservation_conflict boolean,
  image_id uuid,
  image_kind public.food_label_image_kind,
  byte_size integer,
  pixel_width integer,
  pixel_height integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_record private.food_label_upload_reservations%rowtype;
  current_image_id uuid;
  current_object_path text;
  saved_image_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role'
    or target_user_id is null
    or target_submission_id is null
    or target_reservation_token is null
    or target_mime_type not in ('image/jpeg', 'image/png')
    or target_byte_size not between 1 and 8388608
    or target_pixel_width not between 1 and 20000
    or target_pixel_height not between 1 and 20000
    or target_pixel_width::bigint * target_pixel_height::bigint > 20000000
    or target_sha256 !~ '^[a-f0-9]{64}$'
  then
    raise exception using
      errcode = '42501',
      message = 'Label-upload finalization is restricted to the trusted server.';
  end if;

  select reservation.*
  into reservation_record
  from private.food_label_upload_reservations reservation
  where reservation.id = target_reservation_token
    and reservation.user_id = target_user_id
    and reservation.submission_id = target_submission_id;

  if reservation_record.id is null
    or reservation_record.sha256 <> target_sha256
  then
    raise exception using
      errcode = '23514',
      message = 'The label-upload reservation is invalid.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'food-label-upload:' || reservation_record.user_id::text || ':' ||
        reservation_record.submission_id::text || ':' ||
        reservation_record.image_kind::text,
      0
    )
  );

  select reservation.*
  into reservation_record
  from private.food_label_upload_reservations reservation
  where reservation.id = target_reservation_token
    and reservation.user_id = target_user_id
    and reservation.submission_id = target_submission_id
  for update;

  select image.id, image.object_path
  into current_image_id, current_object_path
  from public.food_label_images image
  where image.submission_id = reservation_record.submission_id
    and image.user_id = reservation_record.user_id
    and image.image_kind = reservation_record.image_kind
  for update;

  if reservation_record.status = 'current'
    and current_object_path = reservation_record.object_path
  then
    return query
    select
      true,
      false,
      current_image_id,
      reservation_record.image_kind,
      target_byte_size,
      target_pixel_width,
      target_pixel_height;
    return;
  end if;

  if not reservation_record.is_latest
    or reservation_record.status <> 'uploaded'
    or reservation_record.expected_image_id is distinct from current_image_id
    or reservation_record.expected_object_path is distinct from current_object_path
  then
    update private.food_label_upload_reservations
    set
      is_latest = false,
      status = 'cleanup_pending',
      updated_at = now()
    where id = reservation_record.id
      and status <> 'cleaned';

    insert into private.food_label_object_cleanup (
      object_path,
      reservation_id,
      user_id,
      submission_id,
      reason
    )
    values (
      reservation_record.object_path,
      reservation_record.id,
      reservation_record.user_id,
      reservation_record.submission_id,
      'cas_conflict'
    )
    on conflict (object_path) do update
    set
      reason = excluded.reason,
      queued_at = now();

    return query
    select
      false,
      true,
      null::uuid,
      reservation_record.image_kind,
      null::integer,
      null::integer,
      null::integer;
    return;
  end if;

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
    reservation_record.submission_id,
    reservation_record.user_id,
    reservation_record.object_path,
    reservation_record.image_kind,
    target_mime_type,
    target_byte_size,
    target_pixel_width,
    target_pixel_height,
    target_sha256
  )
  on conflict (submission_id, image_kind) do update
  set
    object_path = excluded.object_path,
    mime_type = excluded.mime_type,
    byte_size = excluded.byte_size,
    pixel_width = excluded.pixel_width,
    pixel_height = excluded.pixel_height,
    sha256 = excluded.sha256,
    created_at = now()
  returning id into saved_image_id;

  if current_object_path is not null
    and current_object_path <> reservation_record.object_path
  then
    insert into private.food_label_object_cleanup (
      object_path,
      reservation_id,
      user_id,
      submission_id,
      reason
    )
    select
      current_object_path,
      prior.id,
      reservation_record.user_id,
      reservation_record.submission_id,
      'replaced'
    from (values (1)) placeholder(value)
    left join private.food_label_upload_reservations prior
      on prior.object_path = current_object_path
    on conflict (object_path) do update
    set
      reason = excluded.reason,
      queued_at = now();

    update private.food_label_upload_reservations
    set
      is_latest = false,
      status = 'cleanup_pending',
      updated_at = now()
    where object_path = current_object_path
      and id <> reservation_record.id;
  end if;

  update private.food_label_upload_reservations
  set
    status = 'current',
    is_latest = true,
    finalized_at = now(),
    updated_at = now()
  where id = reservation_record.id;

  return query
  select
    true,
    false,
    saved_image_id,
    reservation_record.image_kind,
    target_byte_size,
    target_pixel_width,
    target_pixel_height;
end;
$$;

create function public.abandon_food_label_upload(
  target_user_id uuid,
  target_reservation_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_record private.food_label_upload_reservations%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role'
    or target_user_id is null
    or target_reservation_token is null
  then
    raise exception using
      errcode = '42501',
      message = 'Label-upload cleanup is restricted to the trusted server.';
  end if;

  select reservation.*
  into reservation_record
  from private.food_label_upload_reservations reservation
  where reservation.id = target_reservation_token
    and reservation.user_id = target_user_id;

  if reservation_record.id is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'food-label-upload:' || reservation_record.user_id::text || ':' ||
        reservation_record.submission_id::text || ':' ||
        reservation_record.image_kind::text,
      0
    )
  );

  select reservation.*
  into reservation_record
  from private.food_label_upload_reservations reservation
  where reservation.id = target_reservation_token
    and reservation.user_id = target_user_id
  for update;

  if reservation_record.status = 'current' then
    return false;
  end if;

  update private.food_label_upload_reservations
  set
    is_latest = false,
    status = 'cleanup_pending',
    updated_at = now()
  where id = reservation_record.id
    and status <> 'cleaned';

  insert into private.food_label_object_cleanup (
    object_path,
    reservation_id,
    user_id,
    submission_id,
    reason
  )
  values (
    reservation_record.object_path,
    reservation_record.id,
    reservation_record.user_id,
    reservation_record.submission_id,
    'upload_failed'
  )
  on conflict (object_path) do update
  set
    reason = excluded.reason,
    queued_at = now();

  return true;
end;
$$;

create function public.pending_food_label_object_cleanup(
  target_user_id uuid,
  result_limit integer default 10
)
returns table (object_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role'
    or target_user_id is null
  then
    raise exception using
      errcode = '42501',
      message = 'Label-upload cleanup is restricted to the trusted server.';
  end if;

  delete from private.food_label_object_cleanup cleanup
  using public.food_label_images image
  where cleanup.user_id = target_user_id
    and image.object_path = cleanup.object_path;

  with stale as (
    update private.food_label_upload_reservations reservation
    set
      is_latest = false,
      status = 'cleanup_pending',
      updated_at = now()
    where reservation.user_id = target_user_id
      and reservation.status in ('reserved', 'uploaded', 'superseded')
      and reservation.created_at < now() - interval '30 minutes'
    returning reservation.*
  )
  insert into private.food_label_object_cleanup (
    object_path,
    reservation_id,
    user_id,
    submission_id,
    reason
  )
  select
    stale.object_path,
    stale.id,
    stale.user_id,
    stale.submission_id,
    'stale_reservation'
  from stale
  on conflict (object_path) do update
  set
    reason = excluded.reason,
    queued_at = now();

  return query
  select cleanup.object_path
  from private.food_label_object_cleanup cleanup
  where cleanup.user_id = target_user_id
    and not exists (
      select 1
      from public.food_label_images image
      where image.object_path = cleanup.object_path
    )
  order by cleanup.queued_at, cleanup.object_path
  limit least(greatest(coalesce(result_limit, 10), 1), 50);
end;
$$;

create function public.complete_food_label_object_cleanup(
  target_user_id uuid,
  target_object_path text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleanup_reservation_id uuid;
begin
  if (select auth.role()) is distinct from 'service_role'
    or target_user_id is null
    or target_object_path is null
  then
    raise exception using
      errcode = '42501',
      message = 'Label-upload cleanup is restricted to the trusted server.';
  end if;

  select cleanup.reservation_id
  into cleanup_reservation_id
  from private.food_label_object_cleanup cleanup
  where cleanup.object_path = target_object_path
    and cleanup.user_id = target_user_id
  for update;

  if not found then
    return true;
  end if;

  if exists (
    select 1
    from public.food_label_images image
    where image.object_path = target_object_path
  ) then
    return false;
  end if;

  delete from private.food_label_object_cleanup
  where object_path = target_object_path
    and user_id = target_user_id;

  update private.food_label_upload_reservations
  set status = 'cleaned', is_latest = false, updated_at = now()
  where id = cleanup_reservation_id
    and status <> 'current';

  return true;
end;
$$;

drop function public.reserve_food_label_upload(
  uuid,
  uuid,
  public.food_label_image_kind
);

revoke all on function public.preflight_food_label_upload(
  uuid,
  uuid,
  public.food_label_image_kind
) from public, anon, authenticated;
grant execute on function public.preflight_food_label_upload(
  uuid,
  uuid,
  public.food_label_image_kind
) to service_role;

revoke all on function public.begin_food_label_upload(
  uuid,
  uuid,
  public.food_label_image_kind,
  uuid,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.begin_food_label_upload(
  uuid,
  uuid,
  public.food_label_image_kind,
  uuid,
  text,
  text
) to service_role;

revoke all on function public.mark_food_label_upload_stored(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_food_label_upload_stored(uuid, uuid)
  to service_role;

revoke all on function public.finalize_food_label_upload(
  uuid,
  uuid,
  uuid,
  text,
  integer,
  integer,
  integer,
  text
) from public, anon, authenticated;
grant execute on function public.finalize_food_label_upload(
  uuid,
  uuid,
  uuid,
  text,
  integer,
  integer,
  integer,
  text
) to service_role;

revoke all on function public.abandon_food_label_upload(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.abandon_food_label_upload(uuid, uuid)
  to service_role;

revoke all on function public.pending_food_label_object_cleanup(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.pending_food_label_object_cleanup(uuid, integer)
  to service_role;

revoke all on function public.complete_food_label_object_cleanup(uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_food_label_object_cleanup(uuid, text)
  to service_role;

-- The latest migration owns the full beta.4 readiness contract. In addition
-- to existence, verify that each trusted RPC keeps its definer, owner,
-- search_path, and least-privilege boundary.
create or replace function public.application_health(
  expected_migration text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_migration constant text :=
    '20260810050000_make_label_uploads_crash_recoverable';
  trusted_owner oid := (
    select table_entry.relowner
    from pg_catalog.pg_class table_entry
    join pg_catalog.pg_namespace namespace_entry
      on namespace_entry.oid = table_entry.relnamespace
    where namespace_entry.nspname = 'public'
      and table_entry.relname = 'profiles'
  );
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using
      errcode = '42501',
      message =
        'Health details are restricted to the trusted server boundary.';
  end if;

  if to_regclass('public.foods') is null
    or to_regclass('public.food_products') is null
    or to_regclass('public.food_label_submissions') is null
    or to_regclass('public.daily_meal_checkins') is null
    or to_regclass('public.daily_meal_items') is null
    or to_regclass('public.plans') is null
    or to_regclass('private.legacy_age_only_accounts') is null
    or to_regclass('private.food_label_upload_attempts') is null
    or to_regclass('private.food_label_upload_preflights') is null
    or to_regclass('private.food_label_upload_reservations') is null
    or to_regclass('private.food_label_object_cleanup') is null
    or not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'date_of_birth'
        and data_type = 'date'
    )
    or to_regprocedure(
      'public.complete_onboarding_from_slugs(numeric,public.weight_unit,text,public.activity_level,smallint,text[],text[],text[],text,text,public.goal_type,numeric,numeric,date,date,jsonb,jsonb)'
    ) is null
    or to_regprocedure(
      'public.complete_onboarding(public.profile_gender,smallint,numeric,public.weight_unit,text,public.activity_level,smallint,text[],text[],text[],text,text,public.goal_type,numeric,numeric,date,date,jsonb,jsonb)'
    ) is null
    or to_regprocedure(
      'public.upsert_daily_checkin(date,boolean,boolean,boolean,text)'
    ) is null
    or to_regprocedure(
      'public.reserve_plan_generation(uuid,text,text,text,text)'
    ) is null
    or to_regprocedure(
      'private.food_basis_is_plan_eligible(uuid,uuid,public.measurement_basis)'
    ) is null
    or to_regprocedure('private.profile_age_on_date(date,date)') is null
    or to_regprocedure('private.is_valid_time_zone(text)') is null
    or to_regprocedure('private.enforce_profile_date_of_birth()') is null
    or to_regprocedure(
      'private.protect_auth_date_of_birth_metadata()'
    ) is null
    or to_regprocedure(
      'private.require_height_for_completed_onboarding()'
    ) is null
    or to_regprocedure(
      'private.publish_confirmed_label_identity()'
    ) is null
    or to_regprocedure(
      'private.scrub_legacy_shared_label_provenance()'
    ) is null
    or to_regprocedure(
      'private.create_confirmed_label_food_with_legacy_gtin(jsonb,uuid)'
    ) is null
    or to_regprocedure(
      'public.create_confirmed_label_food(jsonb,uuid)'
    ) is null
    or to_regprocedure(
      'public.reserve_food_label_upload(uuid,uuid,public.food_label_image_kind)'
    ) is not null
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.profiles',
      'INSERT'
    )
    or not pg_catalog.has_table_privilege(
      'authenticated',
      'public.profiles',
      'SELECT'
    )
    or not pg_catalog.has_table_privilege(
      'authenticated',
      'public.profiles',
      'UPDATE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.weight_entries',
      'INSERT'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.weight_entries',
      'UPDATE'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.weight_entries',
      'DELETE'
    )
    or not pg_catalog.has_table_privilege(
      'authenticated',
      'public.weight_entries',
      'SELECT'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'public.legal_acceptances',
      'INSERT'
    )
    or not pg_catalog.has_table_privilege(
      'authenticated',
      'public.legal_acceptances',
      'SELECT'
    )
    or exists (
      select 1
      from (
        values
          ('anon'),
          ('authenticated'),
          ('service_role')
      ) expected(role_name)
      where pg_catalog.has_function_privilege(
        expected.role_name,
        to_regprocedure(
          'public.complete_onboarding(public.profile_gender,smallint,numeric,public.weight_unit,text,public.activity_level,smallint,text[],text[],text[],text,text,public.goal_type,numeric,numeric,date,date,jsonb,jsonb)'
        ),
        'EXECUTE'
      )
    )
    or exists (
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
    )
    or exists (
      select 1
      from (
        values
          ('public.repair_verified_profile()', 'authenticated'),
          (
            'public.complete_onboarding_from_slugs(numeric,public.weight_unit,text,public.activity_level,smallint,text[],text[],text[],text,text,public.goal_type,numeric,numeric,date,date,jsonb,jsonb)',
            'authenticated'
          ),
          (
            'public.save_weight_entry(date,numeric,public.weight_unit)',
            'authenticated'
          ),
          (
            'public.update_weight_entry(uuid,numeric,public.weight_unit)',
            'authenticated'
          ),
          ('public.delete_weight_entry(uuid)', 'authenticated'),
          (
            'public.cache_external_food(public.food_source_provider,text,jsonb,jsonb,jsonb,jsonb)',
            'service_role'
          ),
          (
            'public.preflight_food_label_upload(uuid,uuid,public.food_label_image_kind)',
            'service_role'
          ),
          (
            'public.begin_food_label_upload(uuid,uuid,public.food_label_image_kind,uuid,text,text)',
            'service_role'
          ),
          (
            'public.mark_food_label_upload_stored(uuid,uuid)',
            'service_role'
          ),
          (
            'public.finalize_food_label_upload(uuid,uuid,uuid,text,integer,integer,integer,text)',
            'service_role'
          ),
          (
            'public.abandon_food_label_upload(uuid,uuid)',
            'service_role'
          ),
          (
            'public.pending_food_label_object_cleanup(uuid,integer)',
            'service_role'
          ),
          (
            'public.complete_food_label_object_cleanup(uuid,text)',
            'service_role'
          ),
          ('public.application_health(text)', 'service_role')
      ) expected(signature, allowed_role)
      left join pg_catalog.pg_proc procedure_entry
        on procedure_entry.oid = to_regprocedure(expected.signature)
      where procedure_entry.oid is null
        or not procedure_entry.prosecdef
        or coalesce(
          pg_catalog.array_to_string(procedure_entry.proconfig, ','),
          ''
        ) not like '%search_path=""%'
        or procedure_entry.proowner <> trusted_owner
        or not pg_catalog.has_function_privilege(
          expected.allowed_role,
          procedure_entry.oid,
          'EXECUTE'
        )
        or (
          expected.allowed_role <> 'anon'
          and pg_catalog.has_function_privilege(
            'anon',
            procedure_entry.oid,
            'EXECUTE'
          )
        )
        or (
          expected.allowed_role <> 'authenticated'
          and pg_catalog.has_function_privilege(
            'authenticated',
            procedure_entry.oid,
            'EXECUTE'
          )
        )
        or (
          expected.allowed_role <> 'service_role'
          and pg_catalog.has_function_privilege(
            'service_role',
            procedure_entry.oid,
            'EXECUTE'
          )
        )
    )
    or exists (
      select 1
      from (
        values
          ('private.ensure_verified_user_profile(uuid)'),
          ('private.initialize_verified_user()'),
          (
            'private.complete_onboarding_from_slugs_without_completion_guard(numeric,public.weight_unit,text,public.activity_level,smallint,text[],text[],text[],text,text,public.goal_type,numeric,numeric,date,date,jsonb,jsonb)'
          ),
          (
            'public.complete_onboarding(public.profile_gender,smallint,numeric,public.weight_unit,text,public.activity_level,smallint,text[],text[],text[],text,text,public.goal_type,numeric,numeric,date,date,jsonb,jsonb)'
          ),
          (
            'private.cache_external_food_without_category_replacement(public.food_source_provider,text,jsonb,jsonb,jsonb,jsonb)'
          )
      ) expected(signature)
      left join pg_catalog.pg_proc procedure_entry
        on procedure_entry.oid = to_regprocedure(expected.signature)
      where procedure_entry.oid is null
        or not procedure_entry.prosecdef
        or coalesce(
          pg_catalog.array_to_string(procedure_entry.proconfig, ','),
          ''
        ) not like '%search_path=""%'
        or procedure_entry.proowner <> trusted_owner
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
        or pg_catalog.has_function_privilege(
          'service_role',
          procedure_entry.oid,
          'EXECUTE'
        )
    )
    or exists (
      select 1
      from (
        values
          (
            'public',
            'profiles',
            'profiles_enforce_date_of_birth',
            'private.enforce_profile_date_of_birth()'
          ),
          (
            'public',
            'profiles',
            'require_height_before_onboarding_completion',
            'private.require_height_for_completed_onboarding()'
          ),
          (
            'public',
            'food_label_submissions',
            'publish_confirmed_label_identity',
            'private.publish_confirmed_label_identity()'
          ),
          (
            'auth',
            'users',
            'initialize_verified_user',
            'private.initialize_verified_user()'
          ),
          (
            'auth',
            'users',
            'protect_auth_date_of_birth_metadata',
            'private.protect_auth_date_of_birth_metadata()'
          )
      ) expected(
        table_schema,
        table_name,
        trigger_name,
        function_signature
      )
      where not exists (
        select 1
        from pg_catalog.pg_trigger trigger_entry
        join pg_catalog.pg_class table_entry
          on table_entry.oid = trigger_entry.tgrelid
        join pg_catalog.pg_namespace namespace_entry
          on namespace_entry.oid = table_entry.relnamespace
        where namespace_entry.nspname = expected.table_schema
          and table_entry.relname = expected.table_name
          and trigger_entry.tgname = expected.trigger_name
          and trigger_entry.tgfoid = to_regprocedure(
            expected.function_signature
          )
          and trigger_entry.tgenabled = 'O'
          and not trigger_entry.tgisinternal
      )
    )
  then
    return pg_catalog.jsonb_build_object(
      'databaseReachable', true,
      'migrationCompatible', false
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'databaseReachable', true,
    'migrationCompatible', expected_migration = current_migration
  );
end;
$$;

revoke all on function public.application_health(text)
  from public, anon, authenticated, service_role;
grant execute on function public.application_health(text) to service_role;

comment on table private.food_label_upload_reservations is
  'Durable latest-token and lifecycle ledger for private label-image upload attempts.';
comment on table private.food_label_object_cleanup is
  'Retryable storage cleanup queue; rows are removed only after object deletion and a current-reference check.';
comment on function public.begin_food_label_upload(
  uuid,
  uuid,
  public.food_label_image_kind,
  uuid,
  text,
  text
) is
  'Reserves a unique private object path and supersedes older attempts without changing the current label image.';
comment on function public.finalize_food_label_upload(
  uuid,
  uuid,
  uuid,
  text,
  integer,
  integer,
  integer,
  text
) is
  'CAS-finalizes only the latest stored upload and queues replaced or losing objects for durable cleanup.';

commit;
