from __future__ import annotations

import streamlit as st
import streamlit.components.v1 as components


def inject_google_analytics(measurement_id: str | None, page_key: str) -> None:
    measurement_id = (measurement_id or "").strip()
    if not measurement_id:
        return

    session_key = f"ga_injected_{page_key}"
    if st.session_state.get(session_key):
        return

    st.session_state[session_key] = True
    components.html(
        f"""
        <!-- Google tag (gtag.js) -->
        <script async src="https://www.googletagmanager.com/gtag/js?id={measurement_id}"></script>
        <script>
          window.dataLayer = window.dataLayer || [];
          function gtag(){{dataLayer.push(arguments);}}
          gtag('js', new Date());
          gtag('config', '{measurement_id}');
        </script>
        """,
        height=0,
        width=0,
    )
