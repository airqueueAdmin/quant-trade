from __future__ import annotations

import json
import re

import streamlit as st


_SAFE_ATTRIBUTION_VALUE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


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

            try {{
              var retentionKey = 'quant.web.retention.v1';
              var retention = JSON.parse(localStorage.getItem(retentionKey) || 'null');
              var now = Date.now();
              if (!retention || !retention.first_seen_at) {{
                retention = {{ first_seen_at: now, d1_returned: false, d7_returned: false }};
                localStorage.setItem(retentionKey, JSON.stringify(retention));
              }} else {{
                var elapsedDays = (now - Number(retention.first_seen_at)) / 86400000;
                if (elapsedDays >= 1 && !retention.d1_returned) {{
                  gtag('event', 'd1_returned', {{ days_since_first_visit: Math.floor(elapsedDays) }});
                  retention.d1_returned = true;
                }}
                if (elapsedDays >= 7 && !retention.d7_returned) {{
                  gtag('event', 'd7_returned', {{ days_since_first_visit: Math.floor(elapsedDays) }});
                  retention.d7_returned = true;
                }}
                localStorage.setItem(retentionKey, JSON.stringify(retention));
              }}
            }} catch (error) {{
              // Storage restrictions must never interrupt the web app.
            }}
          }})();
        </script>
        """,
        unsafe_allow_javascript=True,
    )


def track_google_analytics_event(
    measurement_id: str | None,
    event_name: str,
    params: dict[str, str | int | float | bool | None] | None = None,
) -> None:
    measurement_id = (measurement_id or "").strip()
    if not measurement_id:
        return

    payload = json.dumps(params or {}, ensure_ascii=False, separators=(",", ":"))
    st.html(
        f"""
        <script>
          (function() {{
            var eventParams = {payload};
            if (typeof window.gtag === 'function') {{
              window.gtag('event', {json.dumps(event_name)}, eventParams);
            }} else {{
              window.dataLayer = window.dataLayer || [];
              window.dataLayer.push(['event', {json.dumps(event_name)}, eventParams]);
            }}
          }})();
        </script>
        """,
        unsafe_allow_javascript=True,
    )


def track_google_analytics_event_once(
    measurement_id: str | None,
    event_name: str,
    dedupe_key: str,
    params: dict[str, str | int | float | bool | None] | None = None,
) -> None:
    state_key = f"ga_event_{event_name}_{dedupe_key}"
    if st.session_state.get(state_key):
        return
    st.session_state[state_key] = True
    track_google_analytics_event(measurement_id, event_name, params)


def _query_param(name: str) -> str:
    try:
        value = st.query_params.get(name, "")
    except AttributeError:
        value = st.experimental_get_query_params().get(name, [""])
    if isinstance(value, list):
        value = value[0] if value else ""
    return str(value or "").strip()


def get_attribution_context() -> dict[str, str]:
    referrer = _query_param("ref") or _query_param("referrer") or _query_param("utm_source")
    if not _SAFE_ATTRIBUTION_VALUE.fullmatch(referrer):
        return {}

    context = {"referrer": referrer}
    for key in ("utm_source", "utm_medium", "utm_campaign", "utm_content"):
        value = _query_param(key)
        if _SAFE_ATTRIBUTION_VALUE.fullmatch(value):
            context[key] = value
    return context


def track_referral_link_opened(measurement_id: str | None) -> dict[str, str]:
    context = get_attribution_context()
    if not context:
        return context
    track_google_analytics_event_once(
        measurement_id,
        "referral_link_opened",
        context["referrer"],
        context,
    )
    return context


def track_referral_activation(
    measurement_id: str | None,
    activation: str,
    params: dict[str, str | int | float | bool | None] | None = None,
) -> None:
    context = get_attribution_context()
    if not context:
        return
    event_params = {**context, "activation": activation, **(params or {})}
    track_google_analytics_event_once(
        measurement_id,
        "referral_user_activated",
        "first_activation",
        event_params,
    )
