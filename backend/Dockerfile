# 1. 베이스 이미지 설정
FROM python:3.11-slim

# 2. 작업 디렉토리 설정
WORKDIR /app

# 3. 의존성 파일 복사 및 설치 (코드 복사 전에 수행하여 Docker 캐시 활용)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. 백엔드 코드 전체 복사
COPY . .

# 5. 서버 실행 (Procfile의 내용을 여기에 정의)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
