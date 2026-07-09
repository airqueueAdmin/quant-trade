from __future__ import annotations

import argparse
import json

from main import dispatch_closing_bet_notifications


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Dispatch saved closing-bet notifications using the live Toss/email send path.",
    )
    parser.add_argument("--market", choices=["krx", "us"], default=None)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--notification-id", type=int, default=None)
    parser.add_argument(
        "--force",
        action="store_true",
        help="Ignore threshold and already-notified checks. Useful for scheduled smoke tests.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = dispatch_closing_bet_notifications(
        market=args.market,
        limit=args.limit,
        notification_id=args.notification_id,
        force=args.force,
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
