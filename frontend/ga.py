from __future__ import annotations

import streamlit as st


def inject_google_analytics(measurement_id: str | None, page_key: str) -> None:
    measurement_id = (measurement_id or "").strip()
    if not measurement_id:
        return

    session_key = f"ga_injected_{page_key}"
    if st.session_state.get(session_key):
        return

    st.session_state[session_key] = True
    st.html(
        f"""
        <script>
          (function() {{
            if (window.__ga_injected_{page_key}) return;
            window.__ga_injected_{page_key} = true;

            var gtagScript = document.createElement('script');
            gtagScript.async = true;
            gtagScript.src = 'https://www.googletagmanager.com/gtag/js?id={measurement_id}';
            document.head.appendChild(gtagScript);

            window.dataLayer = window.dataLayer || [];
            function gtag() {{ dataLayer.push(arguments); }}
            window.gtag = gtag;
            gtag('js', new Date());
            gtag('config', '{measurement_id}');
          }})();
        </script>
        """,
        unsafe_allow_javascript=True,
    )
