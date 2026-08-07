import { Link } from 'react-router-dom'

import { DAILY_ROUTINE_ITEMS, useDailyRoutine } from '../../shared/retention/dailyRoutine'
import {
  ATTENDANCE_REWARD_GOAL_DAYS,
  useAdFreeAnalysisRewards,
} from '../../shared/rewards/adFreeAnalysisRewards'

function getRoutineTitle(completedCount: number, totalCount: number) {
  if (completedCount === 0) {
    return '3분만 투자 흐름을 확인해요'
  }
  if (completedCount === totalCount) {
    return '오늘의 시장 점검을 마쳤어요'
  }
  if (completedCount === totalCount - 1) {
    return '마지막 한 단계만 남았어요'
  }
  return '좋아요, 다음 흐름을 이어볼까요?'
}

export function DailyRoutineCard() {
  const routine = useDailyRoutine()
  const rewards = useAdFreeAnalysisRewards()
  const progress = (routine.completedCount / routine.totalCount) * 100
  const attendanceProgress = Math.min(routine.streak, ATTENDANCE_REWARD_GOAL_DAYS)

  return (
    <section className="daily-routine" aria-labelledby="daily-routine-title">
      <div className="daily-routine__topline">
        <p>오늘의 투자 루틴</p>
        <span>
          {routine.streak > 0 ? <><b>{routine.streak}</b>일 연속</> : '오늘 시작'}
        </span>
      </div>

      <h1 id="daily-routine-title">{getRoutineTitle(routine.completedCount, routine.totalCount)}</h1>
      <p className="daily-routine__description">
        매일 같은 순서로 보면 시장의 변화를 더 쉽게 발견할 수 있어요.
      </p>

      <div
        className="daily-routine__progress"
        role="progressbar"
        aria-label="오늘의 투자 루틴 진행률"
        aria-valuemin={0}
        aria-valuemax={routine.totalCount}
        aria-valuenow={routine.completedCount}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <p className="daily-routine__progress-label">
        오늘 {routine.completedCount}/{routine.totalCount} 완료
      </p>

      <div className="daily-routine__tasks">
        {DAILY_ROUTINE_ITEMS.map((item, index) => {
          const completed = routine.completedPaths.includes(item.path)
          return (
            <Link
              key={item.path}
              to={item.path}
              className={completed ? 'daily-routine__task daily-routine__task--completed' : 'daily-routine__task'}
              aria-label={`${item.label}${completed ? ', 오늘 완료' : ''}`}
            >
              <span className="daily-routine__task-state" aria-hidden="true">
                {completed ? '✓' : index + 1}
              </span>
              <span className="daily-routine__task-copy">
                <strong>{item.label}</strong>
                <small>{completed ? '오늘 확인했어요' : item.description}</small>
              </span>
              <b aria-hidden="true">›</b>
            </Link>
          )
        })}
      </div>

      {routine.nextItem ? (
        <Link className="daily-routine__primary-action" to={routine.nextItem.path}>
          {routine.completedCount === 0 ? '오늘 루틴 시작하기' : `${routine.nextItem.label} 이어서 하기`}
        </Link>
      ) : (
        <Link className="daily-routine__primary-action daily-routine__primary-action--complete" to="/paper-trading">
          모의투자로 대응 연습하기
        </Link>
      )}

      <div className="daily-routine__week" aria-label="최근 7일 루틴 기록">
        {routine.recentDays.map((day) => (
          <div key={day.key} className={day.isToday ? 'daily-routine__day daily-routine__day--today' : 'daily-routine__day'}>
            <span>{day.label}</span>
            <b className={day.active ? 'daily-routine__day-dot daily-routine__day-dot--active' : 'daily-routine__day-dot'}>
              {day.active ? '✓' : ''}
            </b>
          </div>
        ))}
      </div>
      <div className="daily-routine__reward">
        <span className="daily-routine__reward-icon" aria-hidden="true">AI</span>
        <span className="daily-routine__reward-copy">
          <strong>
            {rewards.attendanceRewardGranted ? '광고 없는 AI 분석권' : '5일 출석 리워드'}
          </strong>
          <small>
            {rewards.attendanceRewardGranted
              ? rewards.balance > 0
                ? '광고가 표시될 AI 분석에서 자동으로 사용돼요'
                : '지급된 분석권을 모두 사용했어요'
              : '5일 연속 출석하면 분석권 5개를 드려요'}
          </small>
        </span>
        <b>
          {rewards.attendanceRewardGranted
            ? `${rewards.balance}개`
            : `${attendanceProgress}/${ATTENDANCE_REWARD_GOAL_DAYS}일`}
        </b>
      </div>
      <p className="daily-routine__streak-note">핵심 기능을 하루 한 번 확인하면 출석 기록이 이어져요.</p>
    </section>
  )
}
