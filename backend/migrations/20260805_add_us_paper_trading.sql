-- Add US-market paper trading while keeping all existing rows as Korean stocks.
alter table public.paper_trading_positions
    add column if not exists market text not null default 'krx'
    check (market in ('krx', 'us'));

alter table public.paper_trading_trades
    add column if not exists market text not null default 'krx'
    check (market in ('krx', 'us'));
alter table public.paper_trading_trades
    add column if not exists native_price numeric(18, 4);
alter table public.paper_trading_trades
    add column if not exists usdkrw_rate numeric(18, 4);

update public.paper_trading_trades
   set native_price = price,
       usdkrw_rate = 1
 where native_price is null or usdkrw_rate is null;

alter table public.paper_trading_trades
    alter column native_price set not null;
alter table public.paper_trading_trades
    alter column usdkrw_rate set not null;

alter table public.paper_trading_positions
    drop constraint if exists paper_trading_positions_pkey;
alter table public.paper_trading_positions
    add primary key (account_id, market, ticker);

drop function if exists public.execute_paper_trade(text, text, text, text, text, numeric, integer);

create or replace function public.execute_paper_trade(
    p_account_id text,
    p_ticker text,
    p_company_name text,
    p_market text,
    p_krx_exchange text,
    p_side text,
    p_price numeric,
    p_native_price numeric,
    p_usdkrw_rate numeric,
    p_shares integer
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_cash numeric(18, 2);
    v_amount numeric(18, 2);
    v_existing_shares integer;
    v_existing_avg_price numeric(18, 2);
    v_new_shares integer;
    v_new_avg_price numeric(18, 2);
begin
    if p_market not in ('krx', 'us') then
        raise exception 'invalid market';
    end if;
    if p_side not in ('buy', 'sell') then
        raise exception 'invalid side';
    end if;
    if p_price <= 0 or p_native_price <= 0 or p_usdkrw_rate <= 0 or p_shares <= 0 then
        raise exception 'price, exchange rate, and shares must be positive';
    end if;

    insert into public.paper_trading_accounts (account_id, cash_krw, seed_cash_krw, updated_at)
    values (p_account_id, 10000000, 10000000, timezone('utc', now()))
    on conflict (account_id) do nothing;

    select cash_krw
      into v_cash
      from public.paper_trading_accounts
     where account_id = p_account_id
     for update;

    v_amount := round(p_price * p_shares, 2);

    select shares, avg_price
      into v_existing_shares, v_existing_avg_price
      from public.paper_trading_positions
     where account_id = p_account_id
       and market = p_market
       and ticker = p_ticker
     for update;

    v_existing_shares := coalesce(v_existing_shares, 0);
    v_existing_avg_price := coalesce(v_existing_avg_price, 0);

    if p_side = 'buy' then
        if v_cash < v_amount then
            raise exception 'insufficient cash';
        end if;

        v_new_shares := v_existing_shares + p_shares;
        v_new_avg_price := round(((v_existing_avg_price * v_existing_shares) + v_amount) / v_new_shares, 2);

        insert into public.paper_trading_positions (
            account_id, ticker, company_name, market, krx_exchange, shares, avg_price, updated_at
        )
        values (
            p_account_id, p_ticker, p_company_name, p_market, p_krx_exchange,
            v_new_shares, v_new_avg_price, timezone('utc', now())
        )
        on conflict (account_id, market, ticker)
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
        if v_existing_shares < p_shares then
            raise exception 'insufficient shares';
        end if;

        v_new_shares := v_existing_shares - p_shares;
        if v_new_shares = 0 then
            delete from public.paper_trading_positions
             where account_id = p_account_id
               and market = p_market
               and ticker = p_ticker;
        else
            update public.paper_trading_positions
               set shares = v_new_shares,
                   updated_at = timezone('utc', now())
             where account_id = p_account_id
               and market = p_market
               and ticker = p_ticker;
        end if;

        update public.paper_trading_accounts
           set cash_krw = round(v_cash + v_amount, 2),
               updated_at = timezone('utc', now())
         where account_id = p_account_id;
    end if;

    insert into public.paper_trading_trades (
        account_id, side, ticker, company_name, market, krx_exchange,
        price, native_price, usdkrw_rate, shares, amount_krw
    )
    values (
        p_account_id, p_side, p_ticker, p_company_name, p_market, p_krx_exchange,
        p_price, p_native_price, p_usdkrw_rate, p_shares, v_amount
    );

    return json_build_object(
        'account_id', p_account_id,
        'market', p_market,
        'side', p_side,
        'ticker', p_ticker,
        'shares', p_shares,
        'price_krw', p_price,
        'native_price', p_native_price,
        'usdkrw_rate', p_usdkrw_rate,
        'amount_krw', v_amount
    );
end;
$$;

revoke all on function public.execute_paper_trade(text, text, text, text, text, text, numeric, numeric, numeric, integer)
from public, anon, authenticated;
grant execute on function public.execute_paper_trade(text, text, text, text, text, text, numeric, numeric, numeric, integer)
to service_role;
