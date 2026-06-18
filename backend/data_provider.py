import yfinance as yf
import pandas as pd

def get_stock_data(ticker: str, start_date: str, end_date: str) -> pd.DataFrame:
    """
    yfinance로부터 주식 데이터를 가져옵니다.
    MultiIndex 컬럼 문제를 해결하고, 항상 단순 DataFrame을 반환하도록 보장합니다.
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
