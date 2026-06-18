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
    [개선] 신호 발생일의 다음 날 시가(Open Price)로 거래하는, 더 현실적인 로직을 적용합니다.
    """
    cash = initial_capital
    shares = 0
    trades = []
    portfolio_history = []

    # 하루 전 데이터까지 순회하여 다음 날 거래를 결정합니다.
    for i in range(len(data) - 1):
        current_date = data.index[i]

        # --- 거래 실행: i일의 신호로 i+1일의 시가에 거래 ---
        position_signal = data['positions'].iloc[i]
        trade_price = data['Open'].iloc[i+1] # 다음 날 시가

        if position_signal == 1.0 and cash > 0:
            available_shares = int(cash / (trade_price * (1 + commission)))
            if available_shares > 0:
                cost = available_shares * trade_price * (1 + commission)
                cash -= cost
                shares += available_shares
                # 거래는 다음 날 발생했음을 명시
                trades.append({'Date': data.index[i+1], 'Type': 'BUY', 'Price': trade_price, 'Shares': available_shares})

        elif position_signal == -1.0 and shares > 0:
            sell_value = shares * trade_price * (1 + commission)
            cash += sell_value
            # 거래는 다음 날 발생했음을 명시
            trades.append({'Date': data.index[i+1], 'Type': 'SELL', 'Price': trade_price, 'Shares': shares})
            shares = 0

        # --- 일별 포트폴리오 가치 업데이트: i일의 종가 기준 ---
        holdings_value = shares * data['Close'].iloc[i]
        total_value = cash + holdings_value
        portfolio_history.append({
            'Date': current_date,
            'cash': cash,
            'holdings_value': holdings_value,
            'total_value': total_value
        })

    # --- 마지막 날 포트폴리오 가치 처리 ---
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

    performance_metrics = calculate_performance_metrics(portfolio_df.copy(), initial_capital)
    performance_metrics['total_trades'] = len(trades)

    return portfolio_df, trades, performance_metrics
