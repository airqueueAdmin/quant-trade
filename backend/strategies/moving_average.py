import pandas as pd
import numpy as np

def moving_average_cross_strategy(data: pd.DataFrame, short_window: int, long_window: int) -> pd.DataFrame:
    """
    단순 이동평균(SMA) 교차 전략을 실행하고 매매 신호를 생성합니다.
    """
    signals = data.copy()
    signals['short_mavg'] = data['Close'].rolling(window=short_window, min_periods=1, center=False).mean()
    signals['long_mavg'] = data['Close'].rolling(window=long_window, min_periods=1, center=False).mean()

    signals['signal'] = np.where(signals['short_mavg'] > signals['long_mavg'], 1.0, 0.0)
    signals.loc[signals.index[:short_window], 'signal'] = 0.0
    signals['positions'] = signals['signal'].diff()

    return signals
