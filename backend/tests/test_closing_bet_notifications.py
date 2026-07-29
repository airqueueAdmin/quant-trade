from datetime import datetime
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

import main


KST = ZoneInfo("Asia/Seoul")


class ClosingBetNotificationWindowTests(unittest.TestCase):
    def test_krx_window_starts_at_1520_and_ends_at_1530(self) -> None:
        before = main.closing_bet_notification_window(
            "krx",
            datetime(2026, 7, 29, 15, 19, 59, tzinfo=KST),
        )
        at_start = main.closing_bet_notification_window(
            "krx",
            datetime(2026, 7, 29, 15, 20, tzinfo=KST),
        )
        before_end = main.closing_bet_notification_window(
            "krx",
            datetime(2026, 7, 29, 15, 29, 59, tzinfo=KST),
        )
        at_end = main.closing_bet_notification_window(
            "krx",
            datetime(2026, 7, 29, 15, 30, tzinfo=KST),
        )

        self.assertFalse(before["allowed"])
        self.assertEqual(before["reason"], "before_closing_bet_window")
        self.assertTrue(at_start["allowed"])
        self.assertTrue(before_end["allowed"])
        self.assertFalse(at_end["allowed"])
        self.assertEqual(at_end["reason"], "after_closing_bet_window")

    def test_weekend_is_never_allowed(self) -> None:
        result = main.closing_bet_notification_window(
            "krx",
            datetime(2026, 8, 1, 15, 25, tzinfo=KST),
        )

        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "market_weekend")

    @patch.object(main, "send_closing_bet_notification")
    @patch.object(main, "evaluate_closing_bet")
    @patch.object(main, "call_supabase")
    def test_dispatch_does_not_evaluate_or_send_outside_window(
        self,
        call_supabase,
        evaluate_closing_bet,
        send_closing_bet_notification,
    ) -> None:
        call_supabase.return_value = [{
            "id": 1,
            "account_id": "account",
            "ticker": "005930",
            "market": "krx",
            "krx_exchange": "kospi",
            "channel": "email",
            "destination": "user@example.com",
            "threshold_score": 0,
            "last_signal_date": None,
            "last_notified_at": None,
            "toss_user_key": None,
        }]

        result = main.dispatch_closing_bet_notifications(
            market="krx",
            force=True,
            now=datetime(2026, 7, 29, 15, 2, tzinfo=KST),
        )

        self.assertEqual(result["sent"], 0)
        self.assertEqual(result["skipped"][0]["reason"], "outside_closing_bet_window")
        evaluate_closing_bet.assert_not_called()
        send_closing_bet_notification.assert_not_called()

    @patch.object(main, "send_closing_bet_notification")
    @patch.object(main, "evaluate_closing_bet")
    @patch.object(main, "call_supabase")
    def test_dispatch_does_not_send_stale_signal_on_a_market_holiday(
        self,
        call_supabase,
        evaluate_closing_bet,
        send_closing_bet_notification,
    ) -> None:
        call_supabase.side_effect = [[{
            "id": 2,
            "account_id": "account",
            "ticker": "005930",
            "market": "krx",
            "krx_exchange": "kospi",
            "channel": "email",
            "destination": "user@example.com",
            "threshold_score": 0,
            "last_signal_date": None,
            "last_notified_at": None,
            "toss_user_key": None,
        }], []]
        evaluate_closing_bet.return_value = {
            "market": "krx",
            "resolved_ticker": "005930",
            "signal_date": "2026-07-28",
            "total_score": 80,
        }

        result = main.dispatch_closing_bet_notifications(
            market="krx",
            now=datetime(2026, 7, 29, 15, 25, tzinfo=KST),
        )

        self.assertEqual(result["sent"], 0)
        self.assertEqual(result["skipped"][0]["reason"], "stale_signal_date")
        send_closing_bet_notification.assert_not_called()

    @patch.object(main, "send_closing_bet_notification")
    @patch.object(main, "evaluate_closing_bet")
    @patch.object(main, "call_supabase")
    def test_dispatch_sends_current_signal_inside_window(
        self,
        call_supabase,
        evaluate_closing_bet,
        send_closing_bet_notification,
    ) -> None:
        call_supabase.side_effect = [[{
            "id": 3,
            "account_id": "account",
            "ticker": "005930",
            "market": "krx",
            "krx_exchange": "kospi",
            "channel": "email",
            "destination": "user@example.com",
            "threshold_score": 60,
            "last_signal_date": None,
            "last_notified_at": None,
            "toss_user_key": None,
        }], []]
        evaluate_closing_bet.return_value = {
            "market": "krx",
            "resolved_ticker": "005930",
            "company_name": "삼성전자",
            "signal_date": "2026-07-29",
            "total_score": 80,
            "scenario": "장중 눌림 뒤 거래대금이 다시 붙으며 종가 회복",
            "score_label": "관심 후보",
            "score_action": "관심 유지",
            "risk_flags": [],
        }

        result = main.dispatch_closing_bet_notifications(
            market="krx",
            now=datetime(2026, 7, 29, 15, 25, tzinfo=KST),
        )

        self.assertEqual(result["sent"], 1)
        self.assertEqual(result["dispatched"][0]["signal_date"], "2026-07-29")
        send_closing_bet_notification.assert_called_once()


if __name__ == "__main__":
    unittest.main()
