-- ─── TABELA: usuarios ────────────────────────────────────────────────────────
create table if not exists usuarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text unique not null,
  senha text not null,
  uf char(2) not null default 'SP',
  is_pro boolean default false,
  created_at timestamptz default now()
);

-- ─── TABELA: assinaturas ──────────────────────────────────────────────────────
create table if not exists assinaturas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references usuarios(id) on delete cascade,
  mp_subscription_id text,
  mp_preapproval_id text,
  status text default 'pending', -- pending | authorized | paused | cancelled
  valor numeric(10,2) default 19.90,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─── TABELA: videoaulas ───────────────────────────────────────────────────────
create table if not exists videoaulas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  youtube_url text not null,
  banca text,
  disciplina text,
  ordem int default 0,
  ativo boolean default true,
  created_at timestamptz default now()
);

-- ─── TABELA: tarefas ──────────────────────────────────────────────────────────
create table if not exists tarefas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references usuarios(id) on delete cascade,
  texto text not null,
  feita boolean default false,
  created_at timestamptz default now()
);

-- ─── TABELA: quiz_resultados ──────────────────────────────────────────────────
create table if not exists quiz_resultados (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references usuarios(id) on delete cascade,
  banca text not null,
  score int not null,
  total int not null,
  created_at timestamptz default now()
);

-- ─── RLS (Row Level Security) ─────────────────────────────────────────────────
alter table usuarios enable row level security;
alter table assinaturas enable row level security;
alter table videoaulas enable row level security;
alter table tarefas enable row level security;
alter table quiz_resultados enable row level security;

-- Policies: acesso público via service role (backend faz tudo autenticado)
create policy "service_all" on usuarios for all using (true);
create policy "service_all" on assinaturas for all using (true);
create policy "videoaulas_public_read" on videoaulas for select using (ativo = true);
create policy "service_all_videoaulas" on videoaulas for all using (true);
create policy "service_all" on tarefas for all using (true);
create policy "service_all" on quiz_resultados for all using (true);
