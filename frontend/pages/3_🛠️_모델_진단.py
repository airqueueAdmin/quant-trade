import streamlit as st
import requests
import os

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")

st.set_page_config(layout="wide", page_title="Gemini 모델 진단")

st.title("🛠️ Gemini 모델 진단 도구")
st.write("현재 API 키로 사용 가능한 Gemini 모델 목록을 확인합니다.")

if st.button("사용 가능한 모델 목록 조회"):
    with st.spinner("Gemini API에 사용 가능한 모델 목록을 요청하는 중입니다..."):
        try:
            response = requests.get(f"{BACKEND_URL}/list_models")
            response.raise_for_status()
            results = response.json()

            st.subheader("✅ 사용 가능한 모델 목록")
            st.write("아래 목록에 있는 모델 이름을 복사하여 사용하세요. 'generateContent'를 지원하는 모델만 표시됩니다.")

            available_models = results.get("available_models", [])
            if available_models:
                st.dataframe(available_models)
            else:
                st.warning("사용 가능한 모델을 찾을 수 없거나, API에서 오류를 반환했습니다.")
                st.json(results)

        except requests.exceptions.RequestException as e:
            st.error(f"백엔드 서버 연결에 실패했습니다: {e}")
        except Exception as e:
            st.error(f"오류가 발생했습니다: {e}")
