import pandas as pd
import numpy as np

def calculate_trade_statistics(trades: list[dict], commission: float):
    if not trades:
        return {
            'total_trades': 0,
            'win_rate': 0.0,
            'average_profit_pct': 0.0,
            'profit_factor': 0.0,
        }

    profits = []
    # 단순화를 위해 BUY-SELL 쌍을 매칭하여 수익 계산
    for i in range(0, len(trades) - 1, 2):
        if i + 1 < len(trades):
            buy = trades[i]
            sell = trades[i+1]
            if buy['Type'] == 'BUY' and sell['Type'] == 'SELL':
                profit = (sell['Price'] * (1 - commission)) / (buy['Price'] * (1 + commission)) - 1
                profits.append(profit)

    if not profits:
        return {
            'total_trades': len(trades),
            'win_rate': 0.0,
            'average_profit_pct': 0.0,
            'profit_factor': 0.0,
        }

    win_rate = len([p for p in profits if p > 0]) / len(profits)
    average_profit_pct = sum(profits) / len(profits) * 100
    gross_profit = sum(p for p in profits if p > 0)
    gross_loss = abs(sum(p for p in profits if p < 0))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else gross_profit

    return {
        'total_trades': len(trades),
        'win_rate': win_rate * 100,
        'average_profit_pct': average_profit_pct,
        'profit_factor': profit_factor,
    }

def calculate_performance_metrics(portfolio: pd.DataFrame, initial_capital: float, trades: list[dict] | None = None, commission: float = 0.001):
    if portfolio.empty:
        return {}

    portfolio = portfolio.copy()
    final_value = portfolio['total_value'].iloc[-1]
    total_return_pct = (final_value / initial_capital - 1) * 100

    portfolio['daily_return'] = portfolio['total_value'].pct_change()
    daily_returns = portfolio['daily_return'].dropna()

    sharpe_ratio = 0
    annual_volatility_pct = 0
    sortino_ratio = 0
    cagr_pct = 0

    if not daily_returns.empty and daily_returns.std() != 0:
        sharpe_ratio = (daily_returns.mean() / daily_returns.std()) * np.sqrt(252)
        annual_volatility_pct = daily_returns.std() * np.sqrt(252) * 100

    downside_returns = daily_returns[daily_returns < 0]
    if not downside_returns.empty and downside_returns.std() != 0:
        sortino_ratio = (daily_returns.mean() / downside_returns.std()) * np.sqrt(252)

    portfolio['peak'] = portfolio['total_value'].cummax()
    portfolio['drawdown'] = (portfolio['total_value'] - portfolio['peak']) / portfolio['peak']
    max_drawdown_pct = portfolio['drawdown'].min() * 100

    if len(portfolio) > 1 and initial_capital > 0 and final_value > 0:
        periods = len(portfolio) - 1
        cagr_pct = ((final_value / initial_capital) ** (252 / periods) - 1) * 100

    metrics = {
        'initial_capital': initial_capital,
        'final_total_value': final_value,
        'total_return_pct': total_return_pct,
        'cagr_pct': cagr_pct,
        'sharpe_ratio': sharpe_ratio,
        'sortino_ratio': sortino_ratio,
        'annual_volatility_pct': annual_volatility_pct,
        'max_drawdown_pct': max_drawdown_pct,
    }

    if trades:
        trade_stats = calculate_trade_statistics(trades, commission)
        metrics.update(trade_stats)

    return metrics

def backtest_buy_and_hold(data: pd.DataFrame, initial_capital: float = 100000.0, commission: float = 0.001):
    """
    Buy and Hold 전략 (벤치마크) 백테스팅
    시작일에 전량 매수하고 종료일까지 보유
    """
    data = data.copy()
    first_price = data['Open'].iloc[0]
    shares = int(initial_capital / (first_price * (1 + commission)))
    cash = initial_capital - (shares * first_price * (1 + commission))

    portfolio_history = []
    for date, row in data.iterrows():
        total_value = cash + (shares * row['Close'])
        portfolio_history.append({
            'Date': date,
            'cash': cash,
            'holdings_value': shares * row['Close'],
            'total_value': total_value
        })

    portfolio_df = pd.DataFrame(portfolio_history).set_index('Date')
    metrics = calculate_performance_metrics(portfolio_df, initial_capital)

    return portfolio_df, metrics

def backtest_strategy(
    data: pd.DataFrame,
    initial_capital: float = 100000.0,
    commission: float = 0.001,
    order_type: str = 'all_in', # 'all_in' 또는 'fixed_amount'
    fixed_amount: float = 1000.0 # 고정 금액 매수 시 1회 매수 금액
):
    """
    [고도화] 주문 방식을 선택할 수 있도록 로직을 개선합니다.
    - all_in: 현금 전액 매수 / 전량 매도
    - fixed_amount: 정해진 금액만큼 분할 매수 / 전량 매도
    """
    cash = initial_capital
    shares = 0
    trades = []
    portfolio_history = []

    for i in range(len(data) - 1):
        current_date = data.index[i]

        position_signal = data['positions'].iloc[i]
        trade_price = data['Open'].iloc[i+1]

        if position_signal == 1.0 and cash > 0: # 매수 신호
            buy_amount = 0
            if order_type == 'all_in':
                buy_amount = cash
            elif order_type == 'fixed_amount':
                buy_amount = min(cash, fixed_amount)

            available_shares = int(buy_amount / (trade_price * (1 + commission)))

            if available_shares > 0:
                cost = available_shares * trade_price * (1 + commission)
                cash -= cost
                shares += available_shares
                trades.append({'Date': data.index[i+1], 'Type': 'BUY', 'Price': trade_price, 'Shares': available_shares})

        elif position_signal == -1.0 and shares > 0: # 매도 신호 (전량 매도)
            sell_value = shares * trade_price * (1 - commission)
            cash += sell_value
            trades.append({'Date': data.index[i+1], 'Type': 'SELL', 'Price': trade_price, 'Shares': shares})
            shares = 0

        holdings_value = shares * data['Close'].iloc[i]
        total_value = cash + holdings_value
        portfolio_history.append({
            'Date': current_date,
            'cash': cash,
            'holdings_value': holdings_value,
            'total_value': total_value
        })

    last_date = data.index[-1]
    holdings_value = shares * data['Close'].iloc[-1]
    total_value = cash + holdings_value
    portfolio_history.append({
        'Date': last_date,
        'cash': cash,
        'holdings_value': holdings_value,
        'total_value': total_value
    })

    portfolio_df = pd.DataFrame(portfolio_history).set_index('Date')

    if portfolio_df.empty:
        return pd.DataFrame(), [], {}

    performance_metrics = calculate_performance_metrics(portfolio_df.copy(), initial_capital, trades, commission)
    performance_metrics['total_trades'] = len(trades)

    return portfolio_df, trades, performance_metrics
