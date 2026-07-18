-- AloqaPro employee attendance action migration
-- Supabase Dashboard > SQL Editor orqali bir marta ishga tushiring.
-- Migration idempotent: mavjud attendance ma'lumotlarini o'chirmaydi.

begin;

create extension if not exists pgcrypto;

alter table public.attendance add column if not exists extra_break_start time;
alter table public.attendance add column if not exists extra_break_end time;
alter table public.attendance add column if not exists extra_break_seconds integer not null default 0;
alter table public.attendance add column if not exists extra_break_over_seconds integer not null default 0;
alter table public.attendance add column if not exists prayer_start time;
alter table public.attendance add column if not exists prayer_end time;
alter table public.attendance add column if not exists prayer_seconds integer not null default 0;
alter table public.attendance add column if not exists current_state text not null default 'not_started';
alter table public.attendance add column if not exists active_segment_started_at timestamptz;
alter table public.attendance add column if not exists active_pause_type text;
alter table public.attendance add column if not exists active_pause_started_at timestamptz;

update public.attendance
set current_state = case
  when end_time is not null then 'ended'
  when prayer_start is not null and prayer_end is null then 'prayer'
  when extra_break_start is not null and extra_break_end is null then 'break'
  when lunch_start is not null and lunch_end is null then 'lunch'
  when start_time is not null then 'working'
  else 'not_started'
end
where current_state is null
   or current_state not in ('not_started','working','lunch','break','prayer','paused','ended')
   or (current_state = 'not_started' and start_time is not null);

update public.attendance
set
  active_pause_type = case current_state
    when 'lunch' then 'lunch'
    when 'break' then 'break'
    when 'prayer' then 'prayer'
    else null
  end,
  active_pause_started_at = case current_state
    when 'lunch' then ((work_date + lunch_start) at time zone 'Asia/Tashkent')
    when 'break' then ((work_date + extra_break_start) at time zone 'Asia/Tashkent')
    when 'prayer' then ((work_date + prayer_start) at time zone 'Asia/Tashkent')
    else null
  end,
  active_segment_started_at = case
    when current_state = 'working' then updated_at
    else null
  end
where end_time is null and start_time is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.attendance'::regclass
      and conname = 'attendance_current_state_check'
  ) then
    alter table public.attendance
      add constraint attendance_current_state_check
      check (current_state in ('not_started','working','lunch','break','prayer','paused','ended'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.attendance'::regclass
      and conname = 'attendance_active_pause_type_check'
  ) then
    alter table public.attendance
      add constraint attendance_active_pause_type_check
      check (active_pause_type is null or active_pause_type in ('lunch','break','prayer'));
  end if;
end;
$$;

create table if not exists public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  action text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  clicked_at timestamptz,
  request_id uuid not null,
  source text not null default 'rpc',
  created_at timestamptz not null default clock_timestamp(),
  unique(employee_id, request_id),
  constraint attendance_events_action_check check (
    action in (
      'work_start','work_end',
      'lunch_start','lunch_end',
      'break_start','break_end',
      'prayer_start','prayer_end'
    )
  )
);

create unique index if not exists attendance_events_daily_work_once
  on public.attendance_events(employee_id, work_date, action)
  where action in ('work_start','work_end');

create index if not exists attendance_events_employee_date_idx
  on public.attendance_events(employee_id, work_date, occurred_at, created_at);

create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select e.id
  from public.employees e
  where e.user_id = auth.uid()
    and e.active is true
  limit 1
$$;

create or replace function public.is_current_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.admins a
    where a.user_id = auth.uid()
      and a.active is true
  )
$$;

create or replace function public.record_attendance_action(
  p_action text,
  p_request_id uuid,
  p_clicked_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_employee_id uuid;
  v_action text := lower(trim(coalesce(p_action,'')));
  v_now timestamptz := clock_timestamp();
  v_local_ts timestamp;
  v_local_time time;
  v_work_date date;
  v_open_date date;
  v_stale_date date;
  v_stale_end timestamptz;
  v_delta integer := 0;
  v_late integer := 0;
  v_state text;
  v_att public.attendance%rowtype;
  v_stale public.attendance%rowtype;
  v_event public.attendance_events%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'REQUEST_ID_REQUIRED';
  end if;
  if v_action not in (
    'work_start','work_end',
    'lunch_start','lunch_end',
    'break_start','break_end',
    'prayer_start','prayer_end'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_ATTENDANCE_ACTION';
  end if;

  select e.id into v_employee_id
  from public.employees e
  where e.user_id = auth.uid()
    and e.active is true
  limit 1;
  if v_employee_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_EMPLOYEE_NOT_FOUND';
  end if;

  select ev.* into v_event
  from public.attendance_events ev
  where ev.employee_id = v_employee_id
    and ev.request_id = p_request_id;
  if found then
    if v_event.action <> v_action then
      raise exception using errcode = '22023', message = 'REQUEST_ID_ACTION_MISMATCH';
    end if;
    select a.* into v_att
    from public.attendance a
    where a.employee_id = v_employee_id
      and a.work_date = v_event.work_date;
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'state', coalesce(v_att.current_state,'not_started'),
      'event', to_jsonb(v_event),
      'attendance', to_jsonb(v_att)
    );
  end if;

  v_work_date := (v_now at time zone 'Asia/Tashkent')::date;

  -- Oldingi kun ochiq qolgan bo'lsa, yangi startdan oldin 18:00 da avtomatik yoping.
  if v_action = 'work_start' then
    select a.work_date into v_stale_date
    from public.attendance a
    where a.employee_id = v_employee_id
      and a.work_date < v_work_date
      and a.start_time is not null
      and a.end_time is null
    order by a.work_date desc
    limit 1;

    if v_stale_date is not null then
      perform pg_advisory_xact_lock(hashtextextended(v_employee_id::text || ':' || v_stale_date::text, 0));
      select a.* into v_stale
      from public.attendance a
      where a.employee_id = v_employee_id
        and a.work_date = v_stale_date
      for update;

      if v_stale.end_time is null then
        v_stale_end := ((v_stale_date + time '18:00:00') at time zone 'Asia/Tashkent');
        if v_stale.current_state = 'working' and v_stale.active_segment_started_at is not null then
          v_delta := least(2147483647, greatest(0, extract(epoch from (v_stale_end - v_stale.active_segment_started_at))::bigint))::integer;
          v_stale.work_seconds := least(2147483647, v_stale.work_seconds::bigint + v_delta)::integer;
        elsif v_stale.active_pause_started_at is not null then
          v_delta := least(2147483647, greatest(0, extract(epoch from (v_stale_end - v_stale.active_pause_started_at))::bigint))::integer;
          if v_stale.active_pause_type = 'lunch' then
            v_stale.lunch_seconds := least(2147483647, v_stale.lunch_seconds::bigint + v_delta)::integer;
            v_stale.lunch_end := time '18:00:00';
          elsif v_stale.active_pause_type = 'break' then
            v_stale.extra_break_seconds := least(2147483647, v_stale.extra_break_seconds::bigint + v_delta)::integer;
            v_stale.extra_break_end := time '18:00:00';
          elsif v_stale.active_pause_type = 'prayer' then
            v_stale.prayer_seconds := least(2147483647, v_stale.prayer_seconds::bigint + v_delta)::integer;
            v_stale.prayer_end := time '18:00:00';
          end if;
        end if;
        v_stale.extra_break_over_seconds := greatest(0, v_stale.extra_break_seconds - 1800);
        v_stale.status := case
          when v_stale.start_time >= time '11:00:00' then 'yarim_kun'
          when v_stale.late_minutes > 0 then 'kechikkan'
          else 'keldi'
        end;
        update public.attendance
        set work_seconds = v_stale.work_seconds,
            lunch_seconds = v_stale.lunch_seconds,
            extra_break_seconds = v_stale.extra_break_seconds,
            extra_break_over_seconds = v_stale.extra_break_over_seconds,
            prayer_seconds = v_stale.prayer_seconds,
            lunch_end = v_stale.lunch_end,
            extra_break_end = v_stale.extra_break_end,
            prayer_end = v_stale.prayer_end,
            end_time = time '18:00:00',
            status = v_stale.status,
            current_state = 'ended',
            active_segment_started_at = null,
            active_pause_type = null,
            active_pause_started_at = null,
            auto_ended = true
        where id = v_stale.id;

        insert into public.attendance_events(
          employee_id, work_date, action, occurred_at, clicked_at, request_id, source
        ) values (
          v_employee_id, v_stale_date, 'work_end', v_stale_end, null, gen_random_uuid(), 'auto_rollover'
        ) on conflict do nothing;
      end if;
    end if;
  elsif v_action = 'work_end' then
    select a.work_date into v_open_date
    from public.attendance a
    where a.employee_id = v_employee_id
      and a.start_time is not null
      and a.end_time is null
    order by a.work_date desc
    limit 1;
    if v_open_date is not null then
      v_work_date := v_open_date;
      if v_open_date < (v_now at time zone 'Asia/Tashkent')::date then
        v_now := ((v_open_date + time '18:00:00') at time zone 'Asia/Tashkent');
      end if;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_employee_id::text || ':' || v_work_date::text, 0));

  -- Bir xil request parallel yuborilgan bo'lsa lockdan keyin idempotent qaytaring.
  select ev.* into v_event
  from public.attendance_events ev
  where ev.employee_id = v_employee_id
    and ev.request_id = p_request_id;
  if found then
    if v_event.action <> v_action then
      raise exception using errcode = '22023', message = 'REQUEST_ID_ACTION_MISMATCH';
    end if;
    select a.* into v_att from public.attendance a
    where a.employee_id = v_employee_id and a.work_date = v_event.work_date;
    return jsonb_build_object('ok',true,'duplicate',true,'state',v_att.current_state,'event',to_jsonb(v_event),'attendance',to_jsonb(v_att));
  end if;

  select a.* into v_att
  from public.attendance a
  where a.employee_id = v_employee_id
    and a.work_date = v_work_date
  for update;

  v_local_ts := v_now at time zone 'Asia/Tashkent';
  v_local_time := v_local_ts::time(0);

  if v_action = 'work_start' then
    if found and v_att.start_time is not null then
      raise exception using errcode = 'P0001', message = 'WORK_ALREADY_STARTED';
    end if;
    v_late := greatest(0, extract(hour from v_local_ts)::integer * 60 + extract(minute from v_local_ts)::integer - 540);
    insert into public.attendance(
      employee_id, work_date, start_time, work_seconds, lunch_seconds,
      extra_break_seconds, extra_break_over_seconds, prayer_seconds,
      afk_seconds, afk_count, late_minutes, status, current_state,
      active_segment_started_at, active_pause_type, active_pause_started_at, auto_ended
    ) values (
      v_employee_id, v_work_date, v_local_time, 0, 0, 0, 0, 0, 0, 0, v_late,
      case when v_local_time >= time '11:00:00' then 'yarim_kun' when v_late > 0 then 'kechikkan' else 'keldi' end,
      'working', v_now, null, null, false
    )
    on conflict (employee_id, work_date) do update
      set start_time = excluded.start_time,
          late_minutes = excluded.late_minutes,
          status = excluded.status,
          current_state = 'working',
          active_segment_started_at = excluded.active_segment_started_at,
          active_pause_type = null,
          active_pause_started_at = null
      where public.attendance.start_time is null
    returning * into v_att;
    if v_att.id is null then
      raise exception using errcode = 'P0001', message = 'WORK_ALREADY_STARTED';
    end if;

  elsif v_action in ('lunch_start','break_start','prayer_start') then
    if v_att.id is null or v_att.start_time is null then
      raise exception using errcode = 'P0001', message = 'WORK_NOT_STARTED';
    end if;
    if v_att.end_time is not null or v_att.current_state = 'ended' then
      raise exception using errcode = 'P0001', message = 'WORK_ALREADY_ENDED';
    end if;
    if v_att.current_state <> 'working' then
      raise exception using errcode = 'P0001', message = 'PAUSE_ALREADY_ACTIVE';
    end if;
    if v_att.active_segment_started_at is not null then
      v_delta := least(2147483647, greatest(0, extract(epoch from (v_now - v_att.active_segment_started_at))::bigint))::integer;
    else
      v_delta := 0;
    end if;
    v_state := split_part(v_action,'_',1);
    update public.attendance
    set work_seconds = least(2147483647, work_seconds::bigint + v_delta)::integer,
        current_state = v_state,
        active_segment_started_at = null,
        active_pause_type = v_state,
        active_pause_started_at = v_now,
        lunch_start = case when v_state = 'lunch' then v_local_time else lunch_start end,
        lunch_end = case when v_state = 'lunch' then null else lunch_end end,
        extra_break_start = case when v_state = 'break' then v_local_time else extra_break_start end,
        extra_break_end = case when v_state = 'break' then null else extra_break_end end,
        prayer_start = case when v_state = 'prayer' then v_local_time else prayer_start end,
        prayer_end = case when v_state = 'prayer' then null else prayer_end end
    where id = v_att.id;

  elsif v_action in ('lunch_end','break_end','prayer_end') then
    if v_att.id is null or v_att.start_time is null then
      raise exception using errcode = 'P0001', message = 'WORK_NOT_STARTED';
    end if;
    if v_att.end_time is not null or v_att.current_state = 'ended' then
      raise exception using errcode = 'P0001', message = 'WORK_ALREADY_ENDED';
    end if;
    v_state := split_part(v_action,'_',1);
    if v_att.current_state <> v_state or v_att.active_pause_type <> v_state or v_att.active_pause_started_at is null then
      raise exception using errcode = 'P0001', message = 'PAUSE_TYPE_MISMATCH';
    end if;
    v_delta := least(2147483647, greatest(0, extract(epoch from (v_now - v_att.active_pause_started_at))::bigint))::integer;
    update public.attendance
    set lunch_seconds = case when v_state = 'lunch' then least(2147483647, lunch_seconds::bigint + v_delta)::integer else lunch_seconds end,
        extra_break_seconds = case when v_state = 'break' then least(2147483647, extra_break_seconds::bigint + v_delta)::integer else extra_break_seconds end,
        prayer_seconds = case when v_state = 'prayer' then least(2147483647, prayer_seconds::bigint + v_delta)::integer else prayer_seconds end,
        extra_break_over_seconds = case when v_state = 'break' then greatest(0, least(2147483647, extra_break_seconds::bigint + v_delta)::integer - 1800) else extra_break_over_seconds end,
        lunch_end = case when v_state = 'lunch' then v_local_time else lunch_end end,
        extra_break_end = case when v_state = 'break' then v_local_time else extra_break_end end,
        prayer_end = case when v_state = 'prayer' then v_local_time else prayer_end end,
        current_state = 'working',
        active_segment_started_at = v_now,
        active_pause_type = null,
        active_pause_started_at = null
    where id = v_att.id;
    v_state := 'working';

  elsif v_action = 'work_end' then
    if v_att.id is null or v_att.start_time is null then
      raise exception using errcode = 'P0001', message = 'WORK_NOT_STARTED';
    end if;
    if v_att.end_time is not null or v_att.current_state = 'ended' then
      raise exception using errcode = 'P0001', message = 'WORK_ALREADY_ENDED';
    end if;
    if v_att.current_state = 'working' and v_att.active_segment_started_at is not null then
      v_delta := least(2147483647, greatest(0, extract(epoch from (v_now - v_att.active_segment_started_at))::bigint))::integer;
      v_att.work_seconds := least(2147483647, v_att.work_seconds::bigint + v_delta)::integer;
    elsif v_att.active_pause_started_at is not null then
      v_delta := least(2147483647, greatest(0, extract(epoch from (v_now - v_att.active_pause_started_at))::bigint))::integer;
      if v_att.active_pause_type = 'lunch' then
        v_att.lunch_seconds := least(2147483647, v_att.lunch_seconds::bigint + v_delta)::integer;
        v_att.lunch_end := v_local_time;
      elsif v_att.active_pause_type = 'break' then
        v_att.extra_break_seconds := least(2147483647, v_att.extra_break_seconds::bigint + v_delta)::integer;
        v_att.extra_break_end := v_local_time;
      elsif v_att.active_pause_type = 'prayer' then
        v_att.prayer_seconds := least(2147483647, v_att.prayer_seconds::bigint + v_delta)::integer;
        v_att.prayer_end := v_local_time;
      end if;
    end if;
    v_att.extra_break_over_seconds := greatest(0, v_att.extra_break_seconds - 1800);
    v_att.status := case
      when v_att.start_time >= time '11:00:00' or v_local_time < time '15:00:00' then 'yarim_kun'
      when v_att.late_minutes > 0 then 'kechikkan'
      else 'keldi'
    end;
    update public.attendance
    set work_seconds = v_att.work_seconds,
        lunch_seconds = v_att.lunch_seconds,
        extra_break_seconds = v_att.extra_break_seconds,
        extra_break_over_seconds = v_att.extra_break_over_seconds,
        prayer_seconds = v_att.prayer_seconds,
        lunch_end = v_att.lunch_end,
        extra_break_end = v_att.extra_break_end,
        prayer_end = v_att.prayer_end,
        end_time = v_local_time,
        status = v_att.status,
        current_state = 'ended',
        active_segment_started_at = null,
        active_pause_type = null,
        active_pause_started_at = null
    where id = v_att.id;
    v_state := 'ended';
  end if;

  insert into public.attendance_events(
    employee_id, work_date, action, occurred_at, clicked_at, request_id, source
  ) values (
    v_employee_id, v_work_date, v_action, v_now, p_clicked_at, p_request_id, 'rpc'
  ) returning * into v_event;

  select a.* into v_att
  from public.attendance a
  where a.employee_id = v_employee_id
    and a.work_date = v_work_date;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'state', v_att.current_state,
    'event', to_jsonb(v_event),
    'attendance', to_jsonb(v_att)
  );
end;
$$;

create or replace function public.sync_attendance_snapshot(
  p_work_date date,
  p_work_seconds integer,
  p_lunch_seconds integer,
  p_extra_break_seconds integer,
  p_prayer_seconds integer,
  p_afk_seconds integer,
  p_afk_count integer,
  p_status text,
  p_auto_ended boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_employee_id uuid;
  v_att public.attendance%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select e.id into v_employee_id
  from public.employees e
  where e.user_id = auth.uid() and e.active is true
  limit 1;
  if v_employee_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_EMPLOYEE_NOT_FOUND';
  end if;
  if p_work_date is null then
    raise exception using errcode = '22023', message = 'WORK_DATE_REQUIRED';
  end if;
  if coalesce(p_work_seconds,0) < 0 or coalesce(p_lunch_seconds,0) < 0
     or coalesce(p_extra_break_seconds,0) < 0 or coalesce(p_prayer_seconds,0) < 0
     or coalesce(p_afk_seconds,0) < 0 or coalesce(p_afk_count,0) < 0 then
    raise exception using errcode = '22023', message = 'NEGATIVE_ATTENDANCE_VALUE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_employee_id::text || ':' || p_work_date::text, 0));
  select a.* into v_att
  from public.attendance a
  where a.employee_id = v_employee_id and a.work_date = p_work_date
  for update;
  if v_att.id is null or v_att.start_time is null then
    raise exception using errcode = 'P0001', message = 'WORK_NOT_STARTED';
  end if;

  update public.attendance
  set work_seconds = case when current_state = 'working' then work_seconds else greatest(work_seconds,coalesce(p_work_seconds,0)) end,
      lunch_seconds = case when current_state = 'lunch' then lunch_seconds else greatest(lunch_seconds,coalesce(p_lunch_seconds,0)) end,
      extra_break_seconds = case when current_state = 'break' then extra_break_seconds else greatest(extra_break_seconds,coalesce(p_extra_break_seconds,0)) end,
      prayer_seconds = case when current_state = 'prayer' then prayer_seconds else greatest(prayer_seconds,coalesce(p_prayer_seconds,0)) end,
      extra_break_over_seconds = greatest(0,
        (case when current_state = 'break' then extra_break_seconds else greatest(extra_break_seconds,coalesce(p_extra_break_seconds,0)) end) - 1800
      ),
      afk_seconds = greatest(afk_seconds,coalesce(p_afk_seconds,0)),
      afk_count = greatest(afk_count,coalesce(p_afk_count,0)),
      auto_ended = auto_ended or coalesce(p_auto_ended,false),
      status = case
        when start_time >= time '11:00:00' or (end_time is not null and end_time < time '15:00:00') then 'yarim_kun'
        when late_minutes > 0 then 'kechikkan'
        else 'keldi'
      end
  where id = v_att.id
  returning * into v_att;

  return to_jsonb(v_att);
end;
$$;

-- Attendance yozuvlari faqat tekshirilgan RPC orqali o'zgaradi.
alter table public.attendance enable row level security;
alter table public.attendance_events enable row level security;

drop policy if exists "authenticated all attendance" on public.attendance;
drop policy if exists "employee own attendance select" on public.attendance;
drop policy if exists "admin attendance select" on public.attendance;
create policy "employee own attendance select"
  on public.attendance for select to authenticated
  using (employee_id = public.current_employee_id());
create policy "admin attendance select"
  on public.attendance for select to authenticated
  using (public.is_current_admin());

drop policy if exists "employee own attendance events select" on public.attendance_events;
drop policy if exists "admin attendance events select" on public.attendance_events;
create policy "employee own attendance events select"
  on public.attendance_events for select to authenticated
  using (employee_id = public.current_employee_id());
create policy "admin attendance events select"
  on public.attendance_events for select to authenticated
  using (public.is_current_admin());

revoke insert, update, delete on public.attendance from authenticated;
revoke insert, update, delete on public.attendance_events from authenticated;
grant select on public.attendance, public.attendance_events to authenticated;

revoke execute on function public.current_employee_id() from public, anon;
revoke execute on function public.is_current_admin() from public, anon;
revoke execute on function public.record_attendance_action(text,uuid,timestamptz) from public, anon;
revoke execute on function public.sync_attendance_snapshot(date,integer,integer,integer,integer,integer,integer,text,boolean) from public, anon;
grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.is_current_admin() to authenticated;
grant execute on function public.record_attendance_action(text,uuid,timestamptz) to authenticated;
grant execute on function public.sync_attendance_snapshot(date,integer,integer,integer,integer,integer,integer,text,boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
