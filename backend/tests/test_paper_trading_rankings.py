import unittest
from unittest.mock import patch

import main


class PaperTradingRankingTests(unittest.TestCase):
    def setUp(self) -> None:
        main.PAPER_RANKING_QUOTE_CACHE.clear()
        main.PAPER_RANKING_QUOTE_FAILURE_CACHE.clear()
        main.PAPER_RANKING_FX_CACHE = None
        main.PAPER_RANKING_FX_LAST_FAILURE = None
        self.accounts = [
            {
                "account_id": "paper-alpha",
                "cash_krw": 5_000_000,
                "seed_cash_krw": 10_000_000,
                "updated_at": "2026-08-03T00:00:00Z",
            },
            {
                "account_id": "paper-bravo",
                "cash_krw": 8_000_000,
                "seed_cash_krw": 10_000_000,
                "updated_at": "2026-08-02T00:00:00Z",
            },
            {
                "account_id": "paper-charlie",
                "cash_krw": 10_000_000,
                "seed_cash_krw": 10_000_000,
                "updated_at": "2026-08-01T00:00:00Z",
            },
        ]
        self.positions = [
            {
                "account_id": "paper-alpha",
                "ticker": "005930",
                "company_name": "삼성전자",
                "krx_exchange": "kospi",
                "shares": 100,
                "avg_price": 50_000,
            },
            {
                "account_id": "paper-bravo",
                "ticker": "000660",
                "company_name": "SK하이닉스",
                "krx_exchange": "kospi",
                "shares": 10,
                "avg_price": 200_000,
            },
        ]
        self.quotes = {
            ("005930", "kospi"): {"close": 60_000},
            ("000660", "kospi"): {"close": 190_000},
        }

    def test_ranks_by_total_return_and_marks_current_user(self) -> None:
        result = main.build_paper_trading_leaderboard(
            self.accounts,
            self.positions,
            self.quotes,
            "paper-bravo",
        )

        self.assertEqual([entry["rank"] for entry in result["entries"]], [1, 2, 3])
        self.assertEqual(result["entries"][0]["total_return_pct"], 10)
        self.assertEqual(result["my_entry"]["rank"], 3)
        self.assertTrue(result["my_entry"]["is_me"])
        self.assertIsInstance(result["my_entry"]["is_me"], bool)
        self.assertNotIn("paper-bravo", str(result))
        self.assertEqual(result["participant_count"], 3)

    def test_can_rank_by_assets(self) -> None:
        result = main.build_paper_trading_leaderboard(
            self.accounts,
            self.positions,
            self.quotes,
            "paper-charlie",
            sort_by="assets",
        )

        self.assertEqual(result["entries"][0]["total_assets_krw"], 11_000_000)
        self.assertEqual(result["entries"][0]["rank"], 1)

    def test_uses_average_price_when_quote_is_unavailable(self) -> None:
        result = main.build_paper_trading_leaderboard(
            self.accounts,
            self.positions,
            {},
            "paper-alpha",
        )

        mine = result["my_entry"]
        self.assertEqual(mine["total_assets_krw"], 10_000_000)
        self.assertEqual(mine["valuation_status"], "partial")

    def test_marks_recent_cached_quote_as_stale(self) -> None:
        quotes = {("005930", "kospi"): {"close": 60_000, "_ranking_stale": True}}

        result = main.build_paper_trading_leaderboard(
            [self.accounts[0]],
            [self.positions[0]],
            quotes,
            "paper-alpha",
        )

        self.assertEqual(result["my_entry"]["total_assets_krw"], 11_000_000)
        self.assertEqual(result["my_entry"]["valuation_status"], "stale")

    @patch.object(main, "create_quote_snapshot")
    def test_quote_cache_uses_stale_value_and_failure_cooldown(self, create_quote) -> None:
        create_quote.return_value = {"close": 60_000}
        fresh = main.get_paper_ranking_quote("krx", "005930", "kospi")
        self.assertEqual(fresh["close"], 60_000)

        cache_key = ("krx", "005930", "kospi")
        _, cached_quote = main.PAPER_RANKING_QUOTE_CACHE[cache_key]
        main.PAPER_RANKING_QUOTE_CACHE[cache_key] = (
            main.datetime.now().timestamp() - main.PAPER_RANKING_QUOTE_CACHE_SECONDS - 1,
            cached_quote,
        )
        create_quote.side_effect = RuntimeError("rate limited")

        stale = main.get_paper_ranking_quote("krx", "005930", "kospi")
        stale_again = main.get_paper_ranking_quote("krx", "005930", "kospi")

        self.assertTrue(stale["_ranking_stale"])
        self.assertTrue(stale_again["_ranking_stale"])
        self.assertEqual(create_quote.call_count, 2)

    @patch.object(main, "get_usdkrw_snapshot", return_value={"rate": 1400})
    def test_ranking_fx_rate_is_cached(self, get_fx) -> None:
        first = main.get_paper_ranking_usdkrw_rate()
        second = main.get_paper_ranking_usdkrw_rate()

        self.assertEqual(first, (1400, False))
        self.assertEqual(second, (1400, False))
        self.assertEqual(get_fx.call_count, 1)

    def test_profile_is_stable_and_does_not_reveal_account_id(self) -> None:
        first = main.build_paper_ranking_profile("paper-secret-account")
        second = main.build_paper_ranking_profile("paper-secret-account")

        self.assertEqual(first, second)
        self.assertNotIn("secret", first["nickname"])

    def test_us_position_uses_krw_converted_quote(self) -> None:
        positions = [{
            "account_id": "paper-alpha",
            "market": "us",
            "ticker": "NVDA",
            "company_name": "NVIDIA",
            "krx_exchange": "auto",
            "shares": 10,
            "avg_price": 130_000,
        }]
        quotes = {("us", "NVDA", "auto"): {"close": 110, "price_krw": 154_000}}

        result = main.build_paper_trading_leaderboard(
            [self.accounts[0]],
            positions,
            quotes,
            "paper-alpha",
        )

        self.assertEqual(result["my_entry"]["total_assets_krw"], 6_540_000)

    @patch.object(main, "call_supabase", return_value={"ok": True})
    @patch.object(main, "get_usdkrw_snapshot", return_value={"rate": 1400})
    @patch.object(
        main,
        "create_quote_snapshot",
        return_value={"close": 100, "company_name": "NVIDIA", "market": "us"},
    )
    def test_us_order_converts_native_price_to_krw(
        self,
        _quote,
        _fx,
        mocked_supabase,
    ) -> None:
        request = main.PaperTradingOrderRequest(
            account_id="paper-alpha",
            ticker="nvda",
            market="us",
            side="buy",
            shares=2,
        )

        result = main.execute_paper_trade(request)
        payload = mocked_supabase.call_args.kwargs["json_payload"]

        self.assertEqual(payload["p_market"], "us")
        self.assertEqual(payload["p_native_price"], 100)
        self.assertEqual(payload["p_price"], 140_000)
        self.assertEqual(result["quote"]["price_krw"], 140_000)


if __name__ == "__main__":
    unittest.main()
