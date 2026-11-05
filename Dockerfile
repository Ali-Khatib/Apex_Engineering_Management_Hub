FROM node:22-slim AS web
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
# Connected mode: the built app calls this container's own backend.
ARG VITE_API_URL=.
ENV VITE_API_URL=${VITE_API_URL}
RUN npx vite build --outDir /out --emptyOutDir

FROM python:3.12-slim
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./
# Only the two seed files live here. The design packs are not in this repository.
COPY designs /app/designs
COPY --from=web /out ./static/app
ENV DESIGNS_DIR=/app/designs
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
