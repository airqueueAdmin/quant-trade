import unittest

import main


class SectorSummaryTests(unittest.TestCase):
    def test_summary_explains_what_sector_counts_refer_to(self) -> None:
        rows = [
            {
                "name": f"섹터 {index + 1}",
                "return_21d_pct": 1.0 if index < 4 else -1.0,
                "above_20dma": index < 6,
            }
            for index in range(7)
        ]

        result = main.summarize_sector_rows("krx", rows)

        self.assertIn("분석 대상 전체 7개 섹터 중 4개는 최근 1개월 수익률이 올랐고", result)
        self.assertIn("6개는 현재 20일 이동평균선 위에 있습니다", result)
        self.assertNotIn("4/7", result)
        self.assertNotIn("6/7", result)


if __name__ == "__main__":
    unittest.main()
