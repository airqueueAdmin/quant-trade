# 1. 베이스 이미지 설정
FROM python:3.11-slim

# 2. 작업 디렉토리 설정
WORKDIR /app

# 3. 의존성 파일 복사 및 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. 프론트엔드 코드 전체 복사
COPY . .

# 5. 앱 실행 (Procfile의 내용을 여기에 정의)
# Streamlit의 기본 포트는 8501이므로 명시적으로 노출
EXPOSE 8501
CMD ["streamlit", "run", "app.py", "--server.port=8501", "--server.address=0.0.0.0"]
