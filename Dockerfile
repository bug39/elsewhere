# Stage 1: Build frontend
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production server
FROM node:20-alpine
WORKDIR /app
RUN addgroup -g 1001 -S appuser && adduser -S appuser -u 1001
COPY package*.json ./
RUN npm ci --omit=dev && chown -R appuser:appuser /app
COPY --from=builder --chown=appuser:appuser /app/dist dist/
COPY --chown=appuser:appuser server.js .
USER appuser
EXPOSE 8080
CMD ["node", "server.js"]
