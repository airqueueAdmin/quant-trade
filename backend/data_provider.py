import yfinance as yf
import pandas as pd
from functools import lru_cache

@lru_cache(maxsize=128) # 최대 128개의 결과를 메모리에 저장
def get_stock_data(ticker: str, start_date: str, end_date: str) -> pd.DataFrame:
    """
    yfinance로부터 주식 데이터를 가져옵니다.
    [성능 개선] LRU 캐시를 적용하여 반복적인 API 호출을 방지합니다.
    """
    raw_data = yf.download(
        ticker,
        start=start_date,
        end=end_date,
        auto_adjust=True
    )

    if isinstance(raw_data.columns, pd.MultiIndex):
        raw_data.columns = raw_data.columns.get_level_values(0)

    return raw_data.copy()
