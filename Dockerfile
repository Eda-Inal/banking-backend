# Build stage
FROM node:20-alpine AS builder

WORKDIR /app/backend

COPY package*.json ./
RUN npm ci

COPY . .
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
RUN npx prisma generate
RUN npm run build
RUN cp -r src/generated dist/ 2>/dev/null || true

# Dev stage – tüm bağımlılıklar (nest CLI dahil), volume ile kod mount edilir
FROM node:20-alpine AS dev

WORKDIR /app/backend

COPY package*.json ./
RUN npm ci

EXPOSE 3000

CMD ["sh", "-c", "npx prisma generate && npm run start:dev"]

# Production stage
FROM node:20-alpine AS production

WORKDIR /app/backend

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/backend/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main.js"]
