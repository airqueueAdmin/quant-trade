FROM node:22-alpine AS builder

WORKDIR /app

ARG VITE_BACKEND_URL=http://localhost:8000
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html granite.config.ts ./
COPY .env.production ./.env.production
COPY public ./public
COPY src ./src

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
