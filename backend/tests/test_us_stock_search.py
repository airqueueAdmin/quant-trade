import unittest
from unittest.mock import patch

import data_provider


class _FakeSearch:
    quotes = [
        {
            "symbol": "NVDA",
            "longname": "NVIDIA Corporation",
            "exchange": "NMS",
            "exchDisp": "NASDAQ",
            "quoteType": "EQUITY",
        },
        {
            "symbol": "NVDA260101C00100000",
            "shortname": "NVDA option",
            "exchange": "OPR",
            "quoteType": "OPTION",
        },
    ]


class USStockSearchTests(unittest.TestCase):
    @patch.object(data_provider.yf, "Search", return_value=_FakeSearch(), create=True)
    def test_search_filters_non_stock_results(self, mocked_search) -> None:
        result = data_provider.search_us_stocks("nvidia", limit=10)

        self.assertEqual(result[0]["ticker"], "NVDA")
        self.assertEqual(result[0]["currency"], "USD")
        self.assertEqual(result[0]["exchange"], "NASDAQ")
        self.assertEqual(len(result), 1)
        mocked_search.assert_called_once()

    @patch.object(data_provider.yf, "Search", side_effect=RuntimeError("rate limited"), create=True)
    def test_search_uses_popular_fallback(self, _mocked_search) -> None:
        result = data_provider.search_us_stocks("apple", limit=10)

        self.assertEqual(result[0]["ticker"], "AAPL")
        self.assertEqual(result[0]["name"], "Apple Inc.")

    @patch.object(data_provider.yf, "Search", side_effect=RuntimeError("rate limited"), create=True)
    def test_search_supports_korean_popular_company_name(self, _mocked_search) -> None:
        result = data_provider.search_us_stocks("엔비디아", limit=10)

        self.assertEqual(result[0]["ticker"], "NVDA")

    @patch.object(data_provider.yf, "Search", side_effect=RuntimeError("rate limited"), create=True)
    def test_search_supports_added_technology_stocks_and_aliases(self, _mocked_search) -> None:
        expectations = {
            "브로드컴": "AVGO",
            "마이크론": "MU",
            "TSMC": "TSM",
            "팔란티어": "PLTR",
            "서비스나우": "NOW",
            "팔로알토": "PANW",
        }

        for query, ticker in expectations.items():
            with self.subTest(query=query):
                result = data_provider.search_us_stocks(query, limit=10)
                self.assertEqual(result[0]["ticker"], ticker)

    def test_popular_us_stock_tickers_are_unique(self) -> None:
        tickers = [item["ticker"] for item in data_provider.POPULAR_US_STOCKS]
        self.assertEqual(len(tickers), len(set(tickers)))


if __name__ == "__main__":
    unittest.main()
