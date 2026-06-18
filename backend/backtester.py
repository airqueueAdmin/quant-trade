import pandas as pd
import numpy as np

def calculate_performance_metrics(portfolio: pd.DataFrame, initial_capital: float):
    """
    백테스팅 결과로부터 주요 성과 지표를 계산합니다.
    """
    if portfolio.empty:
        return {
            "initial_capital": initial_capital,
            "final_total_value": initial_capital,
            "total_return_pct": 0,
            "max_drawdown_pct": 0,
            "sharpe_ratio": 0,
        }

    final_total_value = portfolio['total_value'].iloc[-1]
    total_return = (final_total_value - initial_capital) / initial_capital

    portfolio['daily_return'] = portfolio['total_value'].pct_change()

    portfolio['peak'] = portfolio['total_value'].cummax()
    portfolio['drawdown'] = (portfolio['total_value'] - portfolio['peak']) / portfolio['peak']
    max_drawdown = portfolio['drawdown'].min() if not portfolio['drawdown'].empty else 0

    if portfolio['daily_return'].std() != 0 and not np.isnan(portfolio['daily_return'].std()):
        sharpe_ratio = np.sqrt(252) * (portfolio['daily_return'].mean() / portfolio['daily_return'].std())
    else:
        sharpe_ratio = 0.0

    metrics = {
        "initial_capital": initial_capital,
        "final_total_value": final_total_value,
        "total_return_pct": total_return * 100,
        "max_drawdown_pct": max_drawdown * 100,
        "sharpe_ratio": sharpe_ratio,
    }
    return metrics

def backtest_strategy(data: pd.DataFrame, initial_capital: float = 100000.0, commission: float = 0.001):
    """
    매매 신호를 기반으로 백테스팅을 수행합니다.
    """
    cash = initial_capital
    shares = 0
    trades = []
    portfolio_history = []

    for date, row in data.iterrows():
        price = row['Close']
        position_signal = row['positions']

        if position_signal == 1.0 and cash > 0:
            available_shares = int(cash / (price * (1 + commission)))
            if available_shares > 0:
                cost = available_shares * price * (1 + commission)
                cash -= cost
                shares += available_shares
                trades.append({'Date': date, 'Type': 'BUY', 'Price': price, 'Shares': available_shares})

        elif position_signal == -1.0 and shares > 0:
            sell_value = shares * price * (1 - commission)
            cash += sell_value
            trades.append({'Date': date, 'Type': 'SELL', 'Price': price, 'Shares': shares})
            shares = 0

        holdings_value = shares * price
        total_value = cash + holdings_value
        portfolio_history.append({
            'Date': date,
            'cash': cash,
            'holdings_value': holdings_value,
            'total_value': total_value
        })

    portfolio_df = pd.DataFrame(portfolio_history)
    if not portfolio_df.empty:
        portfolio_df = portfolio_df.set_index('Date')

    performance_metrics = calculate_performance_metrics(portfolio_df.copy(), initial_capital)
    performance_metrics['total_trades'] = len(trades)

    return portfolio_df, trades, performance_metrics
