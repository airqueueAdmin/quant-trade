import pandas as pd
import numpy as np

def bollinger_bands_strategy(data: pd.DataFrame, window: int = 20, num_std_dev: int = 2) -> pd.DataFrame:
    """
    볼린저 밴드(Bollinger Bands) 전략을 실행하고 매매 신호를 생성합니다.
    - 주가가 하단 밴드 아래로 떨어지면 매수.
    - 주가가 상단 밴드 위로 올라가면 매도.
    """
    signals = data.copy()

    signals['middle_band'] = signals['Close'].rolling(window=window).mean()
    signals['std_dev'] = signals['Close'].rolling(window=window).std()
    signals['upper_band'] = signals['middle_band'] + (signals['std_dev'] * num_std_dev)
    signals['lower_band'] = signals['middle_band'] - (signals['std_dev'] * num_std_dev)

    signals['signal'] = 0
    signals.loc[signals['Close'] < signals['lower_band'], 'signal'] = 1
    signals.loc[signals['Close'] > signals['upper_band'], 'signal'] = -1

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
