import streamlit as st


def inject_stage_banner_styles() -> None:
    st.markdown(
        """
        <style>
        .stage-banner {
            border: 1px solid rgba(27, 84, 186, 0.18);
            background: linear-gradient(135deg, rgba(232, 242, 255, 0.9), rgba(245, 249, 255, 0.96));
            border-radius: 16px;
            padding: 0.95rem 1rem;
            margin: 0.25rem 0 1rem 0;
        }
        .stage-banner__eyebrow {
            font-size: 0.8rem;
            font-weight: 700;
            color: #1b54ba;
            margin-bottom: 0.35rem;
        }
        .stage-banner__title {
            font-size: 1.02rem;
            font-weight: 700;
            color: #102a43;
            margin-bottom: 0.3rem;
            line-height: 1.45;
        }
        .stage-banner__description {
            font-size: 0.93rem;
            color: #334e68;
            line-height: 1.6;
        }
        .stage-flow {
            border: 1px solid rgba(16, 42, 67, 0.1);
            background: linear-gradient(180deg, rgba(249, 251, 253, 0.98), rgba(255, 255, 255, 0.98));
            border-radius: 18px;
            padding: 1rem 1rem 0.85rem 1rem;
            margin: 0.75rem 0 1.1rem 0;
        }
        .stage-flow__title {
            font-size: 1rem;
            font-weight: 700;
            color: #102a43;
            margin-bottom: 0.7rem;
        }
        .stage-flow__item {
            display: flex;
            gap: 0.75rem;
            align-items: flex-start;
            margin-bottom: 0.8rem;
        }
        .stage-flow__index {
            min-width: 1.8rem;
            height: 1.8rem;
            border-radius: 999px;
            background: #1b54ba;
            color: #ffffff;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 0.82rem;
            font-weight: 700;
        }
        .stage-flow__text strong {
            display: block;
            color: #102a43;
            margin-bottom: 0.12rem;
        }
        .stage-flow__text span {
            color: #486581;
            font-size: 0.93rem;
            line-height: 1.55;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_stage_banner(stage: str, title: str, description: str) -> None:
    st.markdown(
        f"""
        <div class="stage-banner">
            <div class="stage-banner__eyebrow">종가베팅 지원 단계</div>
            <div class="stage-banner__title">{stage} · {title}</div>
            <div class="stage-banner__description">{description}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_home_stage_flow(items: list[tuple[str, str]]) -> None:
    with st.container(border=True):
        st.markdown("**처음이라면 이 순서대로 보면 됩니다.**")
        for index, (title, description) in enumerate(items, start=1):
            left_col, right_col = st.columns([0.12, 0.88])
            with left_col:
                st.markdown(f"**{index}.**")
            with right_col:
                st.markdown(f"**{title}**")
                st.caption(description)
