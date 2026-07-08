create table if not exists public.paper_trading_accounts (
    account_id text primary key,
    cash_krw numeric(18, 2) not null default 10000000,
    seed_cash_krw numeric(18, 2) not null default 10000000,
    updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.paper_trading_positions (
    account_id text not null references public.paper_trading_accounts(account_id) on delete cascade,
    ticker text not null,
    company_name text,
    krx_exchange text not null default 'auto',
    shares integer not null check (shares >= 0),
    avg_price numeric(18, 2) not null default 0,
    updated_at timestamptz not null default timezone('utc', now()),
    primary key (account_id, ticker)
);

create table if not exists public.paper_trading_trades (
    id bigint generated always as identity primary key,
    account_id text not null references public.paper_trading_accounts(account_id) on delete cascade,
    side text not null check (side in ('buy', 'sell')),
    ticker text not null,
    company_name text,
    krx_exchange text not null default 'auto',
    price numeric(18, 2) not null check (price > 0),
    shares integer not null check (shares > 0),
    amount_krw numeric(18, 2) not null check (amount_krw > 0),
    traded_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.closing_bet_notifications (
    id bigint generated always as identity primary key,
    account_id text not null references public.paper_trading_accounts(account_id) on delete cascade,
    ticker text not null,
    resolved_ticker text,
    company_name text,
    market text not null check (market in ('krx', 'us')),
    krx_exchange text not null default 'auto',
    channel text not null check (channel in ('email', 'toss_inapp')),
    destination text not null,
    toss_user_key text,
    threshold_score integer not null default 0 check (threshold_score between 0 and 100),
    active boolean not null default true,
    last_score integer,
    last_signal_date date,
    last_notified_at timestamptz,
    last_evaluated_at timestamptz,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    unique (account_id, channel, market, ticker, destination)
);

create table if not exists public.closing_bet_alert_events (
    id bigint generated always as identity primary key,
    account_id text not null references public.paper_trading_accounts(account_id) on delete cascade,
    notification_id bigint references public.closing_bet_notifications(id) on delete set null,
    delivered_channel text not null check (delivered_channel in ('email', 'toss_inapp')),
    title text not null,
    message text not null,
    ticker text not null,
    market text not null check (market in ('krx', 'us')),
    signal_date date,
    total_score integer,
    is_read boolean not null default false,
    created_at timestamptz not null default timezone('utc', now()),
    read_at timestamptz
);

create index if not exists idx_paper_trading_positions_account on public.paper_trading_positions(account_id);
create index if not exists idx_paper_trading_trades_account_time on public.paper_trading_trades(account_id, traded_at desc);
create index if not exists idx_closing_bet_notifications_account on public.closing_bet_notifications(account_id);
create index if not exists idx_closing_bet_notifications_active on public.closing_bet_notifications(active, market, updated_at desc);
create index if not exists idx_closing_bet_alert_events_account on public.closing_bet_alert_events(account_id, created_at desc);

create or replace function public.reset_paper_trading_account(
    p_account_id text,
    p_seed_cash_krw numeric default 10000000
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    insert into public.paper_trading_accounts (account_id, cash_krw, seed_cash_krw, updated_at)
    values (p_account_id, p_seed_cash_krw, p_seed_cash_krw, timezone('utc', now()))
    on conflict (account_id)
    do update set
        cash_krw = excluded.cash_krw,
        seed_cash_krw = excluded.seed_cash_krw,
        updated_at = timezone('utc', now());

    delete from public.paper_trading_positions where account_id = p_account_id;
    delete from public.paper_trading_trades where account_id = p_account_id;

    return json_build_object(
        'account_id', p_account_id,
        'cash_krw', p_seed_cash_krw,
        'seed_cash_krw', p_seed_cash_krw
    );
end;
$$;

create or replace function public.execute_paper_trade(
    p_account_id text,
    p_ticker text,
    p_company_name text,
    p_krx_exchange text,
    p_side text,
    p_price numeric,
    p_shares integer
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_cash numeric(18, 2);
    v_seed_cash numeric(18, 2);
    v_amount numeric(18, 2);
    v_existing_shares integer;
    v_existing_avg_price numeric(18, 2);
    v_new_shares integer;
    v_new_avg_price numeric(18, 2);
begin
    if p_side not in ('buy', 'sell') then
        raise exception 'invalid side';
    end if;
    if p_price <= 0 or p_shares <= 0 then
        raise exception 'price and shares must be positive';
    end if;

    insert into public.paper_trading_accounts (account_id, cash_krw, seed_cash_krw, updated_at)
    values (p_account_id, 10000000, 10000000, timezone('utc', now()))
    on conflict (account_id) do nothing;

    select cash_krw, seed_cash_krw
      into v_cash, v_seed_cash
      from public.paper_trading_accounts
     where account_id = p_account_id
     for update;

    v_amount := round(p_price * p_shares, 2);

    if p_side = 'buy' then
        if v_cash < v_amount then
            raise exception 'insufficient cash';
        end if;

        select shares, avg_price
          into v_existing_shares, v_existing_avg_price
          from public.paper_trading_positions
         where account_id = p_account_id
           and ticker = p_ticker
         for update;

        v_existing_shares := coalesce(v_existing_shares, 0);
        v_existing_avg_price := coalesce(v_existing_avg_price, 0);
        v_new_shares := v_existing_shares + p_shares;
        v_new_avg_price := round(((v_existing_avg_price * v_existing_shares) + v_amount) / v_new_shares, 2);

        insert into public.paper_trading_positions (
            account_id, ticker, company_name, krx_exchange, shares, avg_price, updated_at
        )
        values (
            p_account_id, p_ticker, p_company_name, p_krx_exchange, v_new_shares, v_new_avg_price, timezone('utc', now())
        )
        on conflict (account_id, ticker)
        do update set
            company_name = excluded.company_name,
            krx_exchange = excluded.krx_exchange,
            shares = excluded.shares,
            avg_price = excluded.avg_price,
            updated_at = timezone('utc', now());

        update public.paper_trading_accounts
           set cash_krw = round(v_cash - v_amount, 2),
               updated_at = timezone('utc', now())
         where account_id = p_account_id;
    else
        select shares, avg_price
          into v_existing_shares, v_existing_avg_price
          from public.paper_trading_positions
         where account_id = p_account_id
           and ticker = p_ticker
         for update;

        v_existing_shares := coalesce(v_existing_shares, 0);
        if v_existing_shares < p_shares then
            raise exception 'insufficient shares';
        end if;

        v_new_shares := v_existing_shares - p_shares;
        if v_new_shares = 0 then
            delete from public.paper_trading_positions
             where account_id = p_account_id
               and ticker = p_ticker;
        else
            update public.paper_trading_positions
               set shares = v_new_shares,
                   updated_at = timezone('utc', now())
             where account_id = p_account_id
               and ticker = p_ticker;
        end if;

        update public.paper_trading_accounts
           set cash_krw = round(v_cash + v_amount, 2),
               updated_at = timezone('utc', now())
         where account_id = p_account_id;
    end if;

    insert into public.paper_trading_trades (
        account_id, side, ticker, company_name, krx_exchange, price, shares, amount_krw
    )
    values (
        p_account_id, p_side, p_ticker, p_company_name, p_krx_exchange, p_price, p_shares, v_amount
    );

    return json_build_object(
        'account_id', p_account_id,
        'side', p_side,
        'ticker', p_ticker,
        'shares', p_shares,
        'price', p_price,
        'amount_krw', v_amount
    );
end;
$$;

revoke all on public.paper_trading_accounts from anon, authenticated;
revoke all on public.paper_trading_positions from anon, authenticated;
revoke all on public.paper_trading_trades from anon, authenticated;
revoke all on public.closing_bet_notifications from anon, authenticated;
revoke all on public.closing_bet_alert_events from anon, authenticated;

grant select, insert, update, delete on public.paper_trading_accounts to service_role;
grant select, insert, update, delete on public.paper_trading_positions to service_role;
grant select, insert, update, delete on public.paper_trading_trades to service_role;
grant select, insert, update, delete on public.closing_bet_notifications to service_role;
grant select, insert, update, delete on public.closing_bet_alert_events to service_role;
grant usage, select on sequence public.paper_trading_trades_id_seq to service_role;
grant usage, select on sequence public.closing_bet_notifications_id_seq to service_role;
grant usage, select on sequence public.closing_bet_alert_events_id_seq to service_role;

revoke all on function public.reset_paper_trading_account(text, numeric) from public, anon, authenticated;
revoke all on function public.execute_paper_trade(text, text, text, text, text, numeric, integer) from public, anon, authenticated;
grant execute on function public.reset_paper_trading_account(text, numeric) to service_role;
grant execute on function public.execute_paper_trade(text, text, text, text, text, numeric, integer) to service_role;

alter table public.paper_trading_accounts enable row level security;
alter table public.paper_trading_positions enable row level security;
alter table public.paper_trading_trades enable row level security;
alter table public.closing_bet_notifications enable row level security;
alter table public.closing_bet_alert_events enable row level security;

drop policy if exists paper_trading_accounts_service_role_all on public.paper_trading_accounts;
create policy paper_trading_accounts_service_role_all
on public.paper_trading_accounts
for all
to service_role
using (true)
with check (true);

drop policy if exists paper_trading_positions_service_role_all on public.paper_trading_positions;
create policy paper_trading_positions_service_role_all
on public.paper_trading_positions
for all
to service_role
using (true)
with check (true);

drop policy if exists paper_trading_trades_service_role_all on public.paper_trading_trades;
create policy paper_trading_trades_service_role_all
on public.paper_trading_trades
for all
to service_role
using (true)
with check (true);

drop policy if exists closing_bet_notifications_service_role_all on public.closing_bet_notifications;
create policy closing_bet_notifications_service_role_all
on public.closing_bet_notifications
for all
to service_role
using (true)
with check (true);

drop policy if exists closing_bet_alert_events_service_role_all on public.closing_bet_alert_events;
create policy closing_bet_alert_events_service_role_all
on public.closing_bet_alert_events
for all
to service_role
using (true)
with check (true);
