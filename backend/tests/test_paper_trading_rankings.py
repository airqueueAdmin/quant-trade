import unittest

import main


class PaperTradingRankingTests(unittest.TestCase):
    def setUp(self) -> None:
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

    def test_profile_is_stable_and_does_not_reveal_account_id(self) -> None:
        first = main.build_paper_ranking_profile("paper-secret-account")
        second = main.build_paper_ranking_profile("paper-secret-account")

        self.assertEqual(first, second)
        self.assertNotIn("secret", first["nickname"])


if __name__ == "__main__":
    unittest.main()
