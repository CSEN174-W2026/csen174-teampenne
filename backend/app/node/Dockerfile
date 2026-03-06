FROM python:3.11-slim

WORKDIR /app

COPY . /app

RUN pip install fastapi uvicorn requests pydantic psutil

EXPOSE 8001

CMD ["uvicorn", "node_worker:app", "--host", "0.0.0.0", "--port", "8001"]