create table if not exists public.saved_backtests (
    id bigint generated always as identity primary key,
    account_id text not null references public.paper_trading_accounts(account_id) on delete cascade,
    save_name text not null,
    run_type text not null check (run_type in ('backtest', 'optimization')),
    strategy_key text not null check (strategy_key in ('moving_average', 'rsi', 'bollinger_bands')),
    strategy_name text not null,
    ticker text not null,
    resolved_ticker text,
    company_name text,
    market text not null check (market in ('krx', 'us')),
    krx_exchange text not null default 'auto',
    start_date date not null,
    end_date date not null,
    initial_capital numeric(18, 2) not null check (initial_capital > 0),
    order_type text not null check (order_type in ('all_in', 'fixed_amount')),
    fixed_amount numeric(18, 2),
    metric_to_optimize text,
    request_payload jsonb not null default '{}'::jsonb,
    result_payload jsonb not null default '{}'::jsonb,
    performance_summary jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_saved_backtests_account_time on public.saved_backtests(account_id, updated_at desc);
create index if not exists idx_saved_backtests_lookup on public.saved_backtests(account_id, run_type, strategy_key, created_at desc);

revoke all on public.saved_backtests from anon, authenticated;
grant select, insert, update, delete on public.saved_backtests to service_role;
grant usage, select on sequence public.saved_backtests_id_seq to service_role;

alter table public.saved_backtests enable row level security;

drop policy if exists saved_backtests_service_role_all on public.saved_backtests;
create policy saved_backtests_service_role_all
on public.saved_backtests
for all
to service_role
using (true)
with check (true);
