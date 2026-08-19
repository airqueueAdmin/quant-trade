import unittest
from datetime import datetime
from unittest.mock import MagicMock, patch

import main


def quote(symbol: str, name: str, change_pct: float, price: float) -> dict:
    previous_close = price / (1 + (change_pct / 100))
    return {
        "symbol": symbol,
        "longName": name,
        "fullExchangeName": "NasdaqGS",
        "currency": "USD",
        "regularMarketPrice": price,
        "regularMarketPreviousClose": previous_close,
        "regularMarketChange": price - previous_close,
        "regularMarketChangePercent": change_pct,
        "regularMarketVolume": 1_000_000,
        "marketCap": 5_000_000_000,
        "regularMarketTime": 1_786_651_200,
    }


def naver_quote(
    ticker: str,
    name: str,
    change_pct: float,
    price: int,
    *,
    market_cap: int = 200_000_000_000,
    volume: int = 100_000,
    kosdaq: bool = False,
) -> dict:
    change_amount = round(price * (change_pct / (100 + change_pct)))
    return {
        "itemCode": ticker,
        "stockName": name,
        "sosok": "1" if kosdaq else "0",
        "closePriceRaw": str(price),
        "compareToPreviousClosePriceRaw": str(change_amount),
        "fluctuationsRatio": str(change_pct),
        "accumulatedTradingVolumeRaw": str(volume),
        "marketValueRaw": str(market_cap),
        "localTradedAt": "2026-08-19T09:20:00+09:00",
        "stockExchangeType": {"code": "KQ" if kosdaq else "KS"},
    }


def naver_response(*rows: dict) -> MagicMock:
    response = MagicMock()
    response.json.return_value = {"stocks": list(rows)}
    return response


class MarketMoversTests(unittest.TestCase):
    def setUp(self) -> None:
        main.MARKET_MOVERS_CACHE.clear()
        main.MARKET_MOVERS_FAILURE_CACHE.clear()

    @patch.object(main.yf, "screen")
    def test_us_snapshot_contains_sorted_gainers_and_losers(self, screen) -> None:
        screen.side_effect = [
            {"quotes": [quote("GAIN1", "Gainer One", 8.0, 54.0), quote("GAIN2", "Gainer Two", 12.0, 28.0)]},
            {"quotes": [quote("LOSE1", "Loser One", -5.0, 19.0), quote("LOSE2", "Loser Two", -9.0, 31.0)]},
        ]

        result = main.create_market_movers_snapshot("us", 2)

        self.assertEqual([item["ticker"] for item in result["gainers"]], ["GAIN2", "GAIN1"])
        self.assertEqual([item["ticker"] for item in result["losers"]], ["LOSE2", "LOSE1"])
        self.assertEqual(result["gainers"][0]["currency"], "USD")
        self.assertIn("20억달러", result["universe_note"])

    @patch.object(main, "get_krx_stock_by_ticker")
    def test_krx_mover_uses_local_company_name_and_exchange(self, get_profile) -> None:
        get_profile.return_value = {
            "name": "테스트기업",
            "ticker": "123456",
            "krx_exchange": "kosdaq",
            "display_name": "테스트기업 (123456, KOSDAQ)",
        }
        raw = quote("123456.KQ", "Test Company", 15.0, 12_000.0)
        raw["currency"] = "KRW"

        result = main.normalize_market_mover(raw, "krx")

        assert result is not None
        self.assertEqual(result["ticker"], "123456")
        self.assertEqual(result["name"], "테스트기업")
        self.assertEqual(result["krx_exchange"], "kosdaq")
        self.assertEqual(result["exchange"], "KOSDAQ")

    @patch.object(main.yf, "screen")
    @patch.object(main.requests, "get")
    def test_krx_movers_use_naver_and_keep_universe_filters(self, requests_get, screen) -> None:
        requests_get.side_effect = [
            naver_response(
                naver_quote("005930", "삼성전자", 5.0, 80_000),
                naver_quote("001770", "소형주", 29.0, 16_000, market_cap=20_000_000_000),
            ),
            naver_response(naver_quote("000660", "SK하이닉스", 8.0, 300_000, kosdaq=False)),
        ]

        result = main.fetch_market_movers("krx", "gainers", 2)

        self.assertEqual([item["ticker"] for item in result], ["000660", "005930"])
        self.assertTrue(all(item["market_cap"] >= 100_000_000_000 for item in result))
        self.assertTrue(all("/api/stocks/up/" in call.args[0] for call in requests_get.call_args_list))
        screen.assert_not_called()

    @patch.object(main, "fetch_market_movers", side_effect=RuntimeError("rate limited"))
    def test_snapshot_returns_stale_success_cache_when_refresh_fails(self, fetch_movers) -> None:
        cached = {
            "market": "us",
            "market_name": "미국",
            "as_of": "2026-08-19T09:00:00-04:00",
            "snapshot_status": "장중 잠정값",
            "intraday_estimate": True,
            "universe_note": "test",
            "is_stale": False,
            "data_source": "yahoo_finance",
            "gainers": [],
            "losers": [],
        }
        main.MARKET_MOVERS_CACHE["us:2"] = (datetime.now().timestamp() - 301, cached)

        result = main.create_market_movers_snapshot("us", 2)

        self.assertTrue(result["is_stale"])
        self.assertIn("이전 데이터", result["snapshot_status"])
        self.assertEqual(fetch_movers.call_count, 1)

    @patch.object(main, "fetch_market_movers", side_effect=RuntimeError("rate limited"))
    def test_snapshot_failure_cooldown_prevents_repeated_provider_calls(self, fetch_movers) -> None:
        with self.assertRaises(main.HTTPException):
            main.create_market_movers_snapshot("us", 3)
        with self.assertRaises(main.HTTPException):
            main.create_market_movers_snapshot("us", 3)

        self.assertEqual(fetch_movers.call_count, 1)


if __name__ == "__main__":
    unittest.main()
