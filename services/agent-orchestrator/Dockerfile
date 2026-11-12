FROM python:3.12.9-slim

WORKDIR /app

RUN groupadd -r shuks && useradd -r -g shuks shuks

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN chown -R shuks:shuks /app
USER shuks

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
