import pandas as pd
import numpy as np

def rsi_strategy(data: pd.DataFrame, window: int = 14, oversold_threshold: int = 30, overbought_threshold: int = 70) -> pd.DataFrame:
    """
    RSI(Relative Strength Index) 전략을 실행하고 매매 신호를 생성합니다.
    """
    signals = data.copy()
    close_delta = signals['Close'].diff()

    up = close_delta.clip(lower=0)
    down = -1 * close_delta.clip(upper=0)

    ma_up = up.ewm(com=window - 1, adjust=True, min_periods=window).mean()
    ma_down = down.ewm(com=window - 1, adjust=True, min_periods=window).mean()

    rs = ma_up / ma_down
    signals['rsi'] = 100 - (100 / (1 + rs))

    signals['signal'] = 0
    signals.loc[signals['rsi'] < oversold_threshold, 'signal'] = 1
    signals.loc[signals['rsi'] > overbought_threshold, 'signal'] = -1

    position = 0
    positions_col = []
    for signal in signals['signal']:
        if signal == 1:
            position = 1
        elif signal == -1:
            position = 0
        positions_col.append(position)

    signals['position'] = positions_col
    signals['positions'] = signals['position'].diff()

    return signals
