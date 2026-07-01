-- AloqaPro Supabase schema
-- Supabase SQL Editor ichiga to'liq tashlab Run qiling.
-- Frontend uchun faqat publishable/anon key ishlatiladi. Service role keyni brauzerga qo'ymang.

create extension if not exists pgcrypto;

drop table if exists public.kpi_bonuses;

create table if not exists public.admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  login text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id)
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  login text,
  active boolean not null default true,
  face_registered boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id)
);

alter table public.employees drop column if exists responsible_course;

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  start_time time,
  end_time time,
  lunch_start time,
  lunch_end time,
  work_seconds integer not null default 0,
  worked_seconds integer generated always as (work_seconds) stored,
  lunch_seconds integer not null default 0,
  afk_seconds integer not null default 0,
  afk_count integer not null default 0,
  late_minutes integer not null default 0,
  status text not null default 'kelmadi',
  auto_ended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, work_date)
);

create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  title text,
  body text,
  type text,
  is_read boolean not null default false,
  sent_at timestamptz not null default now()
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  employee_name text,
  type text,
  message text not null,
  status text not null default 'new',
  admin_reply text,
  replied_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.lunch_plans (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  shift text not null,
  created_at timestamptz not null default now(),
  unique(employee_id, work_date)
);

create table if not exists public.employee_leaves (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_start_date date not null,
  return_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.face_profiles (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  descriptor jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id)
);

-- amoCRM o'chirilgan bo'lsa ham app xato bermasligi uchun view nomi mavjud turadi.
create or replace view public.amocrm_department_task_counts as
select
  null::bigint as responsible_user_id,
  null::text as department_name,
  null::integer as sort_order,
  0::integer as active_tasks,
  0::integer as overdue_tasks,
  0::integer as on_time_tasks,
  null::timestamptz as nearest_deadline
where false;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists attendance_set_updated_at on public.attendance;
create trigger attendance_set_updated_at
before update on public.attendance
for each row execute function public.set_updated_at();

drop trigger if exists settings_set_updated_at on public.settings;
create trigger settings_set_updated_at
before update on public.settings
for each row execute function public.set_updated_at();

drop trigger if exists face_profiles_set_updated_at on public.face_profiles;
create trigger face_profiles_set_updated_at
before update on public.face_profiles
for each row execute function public.set_updated_at();

drop function if exists public.admin_attendance_range(date, date, text, text);

create function public.admin_attendance_range(
  p_from date,
  p_to date,
  p_search text default '',
  p_status text default ''
)
returns table (
  employee_id uuid,
  employee_name text,
  employee_login text,
  name text,
  login text,
  work_date date,
  start_time time,
  end_time time,
  lunch_start time,
  lunch_end time,
  late_minutes integer,
  worked_seconds integer,
  work_seconds integer,
  afk_seconds integer,
  status text
)
language sql
stable
as $$
  select
    e.id as employee_id,
    e.name as employee_name,
    e.login as employee_login,
    e.name,
    e.login,
    coalesce(a.work_date, p_from) as work_date,
    a.start_time,
    a.end_time,
    a.lunch_start,
    a.lunch_end,
    coalesce(a.late_minutes, 0) as late_minutes,
    coalesce(a.work_seconds, 0) as worked_seconds,
    coalesce(a.work_seconds, 0) as work_seconds,
    coalesce(a.afk_seconds, 0) as afk_seconds,
    coalesce(a.status, 'kelmadi') as status
  from public.employees e
  left join public.attendance a
    on a.employee_id = e.id
   and a.work_date between p_from and p_to
  where e.active is not false
    and (
      coalesce(p_search, '') = ''
      or lower(coalesce(e.name, '')) like '%' || lower(p_search) || '%'
      or lower(coalesce(e.login, '')) like '%' || lower(p_search) || '%'
    )
    and (
      coalesce(p_status, '') = ''
      or p_status = 'all'
      or coalesce(a.status, 'kelmadi') = p_status
    )
  order by e.name, coalesce(a.work_date, p_from);
$$;

-- RLS: hozircha app to'liq ishlashi uchun authenticated userlarga ruxsat.
-- Productionda buni rollar bo'yicha qattiqlashtirish tavsiya qilinadi.
alter table public.admins enable row level security;
alter table public.employees enable row level security;
alter table public.attendance enable row level security;
alter table public.settings enable row level security;
alter table public.notifications enable row level security;
alter table public.feedback enable row level security;
alter table public.lunch_plans enable row level security;
alter table public.employee_leaves enable row level security;
alter table public.face_profiles enable row level security;

drop policy if exists "authenticated all admins" on public.admins;
create policy "authenticated all admins" on public.admins for all to authenticated using (true) with check (true);

drop policy if exists "authenticated all employees" on public.employees;
create policy "authenticated all employees" on public.employees for all to authenticated using (true) with check (true);

drop policy if exists "authenticated all attendance" on public.attendance;
create policy "authenticated all attendance" on public.attendance for all to authenticated using (true) with check (true);

drop policy if exists "authenticated all settings" on public.settings;
create policy "authenticated all settings" on public.settings for all to authenticated using (true) with check (true);

drop policy if exists "authenticated all notifications" on public.notifications;
create policy "authenticated all notifications" on public.notifications for all to authenticated using (true) with check (true);

drop policy if exists "authenticated all feedback" on public.feedback;
create policy "authenticated all feedback" on public.feedback for all to authenticated using (true) with check (true);

drop policy if exists "authenticated all lunch_plans" on public.lunch_plans;
create policy "authenticated all lunch_plans" on public.lunch_plans for all to authenticated using (true) with check (true);

drop policy if exists "authenticated all employee_leaves" on public.employee_leaves;
create policy "authenticated all employee_leaves" on public.employee_leaves for all to authenticated using (true) with check (true);

drop policy if exists "authenticated all face_profiles" on public.face_profiles;
create policy "authenticated all face_profiles" on public.face_profiles for all to authenticated using (true) with check (true);

insert into public.settings(key, value)
values ('face_control_enabled', '{"enabled":false}')
on conflict (key) do nothing;

-- Birinchi admin yaratish:
-- 1) Supabase Dashboard > Authentication > Users orqali admin email/parol bilan user yarating.
-- 2) O'sha user id ni pastdagi 'USER_ID_HERE' o'rniga qo'yib ishga tushiring:
--
-- insert into public.admins(user_id, name, login)
-- values ('USER_ID_HERE', 'Administrator', 'admin@example.com')
-- on conflict (user_id) do update set name = excluded.name, login = excluded.login, active = true;
