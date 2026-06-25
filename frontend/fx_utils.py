import requests
import streamlit as st
import os

BACKEND_FX_URL = "/fx/usdkrw"


@st.cache_data(ttl=900)
def get_usdkrw_rate():
    backend_url = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
    try:
        response = requests.get(f"{backend_url}{BACKEND_FX_URL}", timeout=5)
        response.raise_for_status()
        data = response.json()
        rate = float(data["rate"])
        return {
            "rate": rate,
            "as_of": data.get("as_of"),
            "source": data.get("source", "backend"),
        }
    except Exception:
        return None


def format_currency_pair(usd_amount, rate=None):
    usd_amount = float(usd_amount)
    if rate and rate > 0:
        krw_amount = usd_amount * rate
        return f"USD {usd_amount:,.2f} / KRW {krw_amount:,.0f}"
    return f"USD {usd_amount:,.2f}"


def format_krw_value(usd_amount, rate=None):
    if rate and rate > 0:
        return f"약 KRW {usd_amount * rate:,.0f}"
    return "KRW 환산 불가"
