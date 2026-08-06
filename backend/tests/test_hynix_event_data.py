from datetime import date
import unittest
from unittest.mock import Mock, patch

import gemini_analyzer
import main


class HynixEventQuoteTests(unittest.TestCase):
    @patch.object(main.requests, "get")
    def test_naver_quote_is_parsed_as_realtime_krx_quote(self, requests_get: Mock) -> None:
        response = Mock()
        response.json.return_value = {
            "sosok": "0",
            "stockName": "SK하이닉스",
            "closePrice": "1,316,000",
            "compareToPreviousClosePrice": "-85,000",
            "fluctuationsRatio": "-6.07",
            "localTradedAt": "2026-07-30T09:39:21+09:00",
            "marketStatus": "OPEN",
        }
        requests_get.return_value = response

        result = main.fetch_naver_krx_quote("000660")

        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result["close"], 1316000.0)
        self.assertEqual(result["previous_close"], 1401000.0)
        self.assertEqual(result["change_pct"], -6.07)
        self.assertEqual(result["source"], "naver_finance_realtime")
        self.assertEqual(result["krx_exchange"], "kospi")


class HynixEventNewsTests(unittest.TestCase):
    def test_today_filter_uses_kst_calendar_date(self) -> None:
        articles = [
            {
                "title": "오늘 오전 기사",
                "url": "https://example.com/today",
                "published_at": "2026-07-30T00:30:00Z",
            },
            {
                "title": "UTC는 전날이지만 KST는 오늘인 기사",
                "url": "https://example.com/kst-today",
                "published_at": "2026-07-29T16:00:00Z",
            },
            {
                "title": "KST 기준 전날 기사",
                "url": "https://example.com/yesterday",
                "published_at": "2026-07-29T14:59:59Z",
            },
        ]

        result = gemini_analyzer.filter_articles_for_kst_date(
            articles,
            target_date=date(2026, 7, 30),
        )

        self.assertEqual(
            [article["title"] for article in result],
            ["오늘 오전 기사", "UTC는 전날이지만 KST는 오늘인 기사"],
        )

    def test_fallback_classification_separates_positive_and_negative_news(self) -> None:
        articles = [
            {
                "title": "SK하이닉스 사상 최대 실적, 공급 계약 확대",
                "url": "https://example.com/positive",
            },
            {
                "title": "SK하이닉스 급락, 경쟁 심화 우려",
                "url": "https://example.com/negative",
            },
            {
                "title": "SK하이닉스 정기 주주총회 개최",
                "url": "https://example.com/neutral",
            },
        ]

        result = gemini_analyzer.attach_article_sentiments(articles, classifications=[])

        self.assertEqual(
            [article["sentiment"] for article in result],
            ["positive", "negative", "neutral"],
        )


if __name__ == "__main__":
    unittest.main()
