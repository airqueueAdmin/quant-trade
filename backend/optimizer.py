import pandas as pd
import numpy as np
from itertools import product

from backtester import backtest_strategy
from strategies.moving_average import moving_average_cross_strategy
from strategies.rsi import rsi_strategy
from strategies.bollinger_bands import bollinger_bands_strategy

# 전략 함수 매핑
STRATEGIES = {
    "moving_average": moving_average_cross_strategy,
    "rsi": rsi_strategy,
    "bollinger_bands": bollinger_bands_strategy,
}

def grid_search_optimizer(
    strategy_name: str,
    data: pd.DataFrame,
    initial_capital: float,
    param_grid: dict,
    metric_to_optimize: str = 'sharpe_ratio'
) -> dict:
    """
    주어진 전략과 파라미터 그리드에 대해 그리드 서치 최적화를 수행합니다.

    :param strategy_name: 최적화할 전략의 이름 (예: "moving_average")
    :param data: 백테스팅에 사용할 시세 데이터
    :param initial_capital: 초기 자본금
    :param param_grid: 최적화할 파라미터와 그 범위(리스트)를 담은 딕셔너리
                       예: {'short_window': [10, 20], 'long_window': [50, 60]}
    :param metric_to_optimize: 최적화 기준으로 삼을 성과 지표 (예: 'sharpe_ratio', 'total_return_pct')
    :return: 최적화 결과 (최적 파라미터, 최적 지표 값, 모든 결과 목록)
    """
    strategy_func = STRATEGIES.get(strategy_name)
    if not strategy_func:
        raise ValueError(f"알 수 없는 전략 이름: {strategy_name}")

    keys = param_grid.keys()
    values = param_grid.values()

    best_metric_value = -np.inf  # 샤프 지수나 수익률은 음수일 수 있으므로 -inf로 초기화
    best_params = {}
    all_results = []

    # 모든 파라미터 조합에 대해 반복
    for params_combination in product(*values):
        current_params = dict(zip(keys, params_combination))

        # 이동평균 전략의 경우 short_window가 long_window보다 작아야 함
        if strategy_name == "moving_average":
            if current_params.get('short_window', 0) >= current_params.get('long_window', 0):
                continue # 유효하지 않은 조합은 건너뜜

        try:
            signals = strategy_func(data.copy(), **current_params)
            _, _, metrics = backtest_strategy(signals, initial_capital)

            current_metric_value = metrics.get(metric_to_optimize, -np.inf)

            all_results.append({
                "params": current_params,
                "metrics": metrics
            })

            if current_metric_value > best_metric_value:
                best_metric_value = current_metric_value
                best_params = current_params

        except Exception as e:
            print(f"최적화 중 오류 발생 (params: {current_params}): {e}")
            # 오류 발생 시 해당 조합은 건너뛰고 다음 조합으로 진행

    return {
        "best_params": best_params,
        "best_metric_value": best_metric_value,
        "metric_optimized": metric_to_optimize,
        "all_optimization_results": all_results
    }
