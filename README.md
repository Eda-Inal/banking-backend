# Banking Backend

A NestJS-based backend for core banking workflows.

> Status: This project is actively being developed (WIP).

## Overview

This service includes:

- Authentication and authorization (JWT-based)
- Account management
- Transaction flows (`deposit`, `withdraw`, `transfer`)
- Fraud checks
- Outbox + RabbitMQ event processing
- Redis-backed idempotency and rate limiting

## Tech Stack

- Node.js + TypeScript
- NestJS
- PostgreSQL + Prisma
- Redis
- RabbitMQ
- Jest (unit and e2e tests)

## Project Structure

- `src/auth` - authentication flows and guards
- `src/accounts` - account operations
- `src/transactions` - transaction endpoints and business logic
- `src/fraud` - fraud decision layer
- `src/outbox` - event outbox worker
- `src/messaging` - RabbitMQ producer/consumer
- `src/prisma` - Prisma service
- `src/redis` - Redis service
- `prisma` - database schema and migrations

## Prerequisites

- Node.js 20+
- Docker + Docker Compose
- npm

## Environment Variables

1. Copy `.env.example` as `.env`
2. Fill in the values for your environment

Example:

```bash
cp .env.example .env
```

## Run with Docker (Infrastructure)

Start PostgreSQL, Redis, and RabbitMQ:

```bash
docker compose up -d
```

Stop services:

```bash
docker compose down
```

## Install Dependencies

```bash
npm install
```

## Database Setup

Generate Prisma client:

```bash
npm run prisma:generate
```

Run development migrations:

```bash
npm run prisma:migrate:dev
```

## Run the Application

Development:

```bash
npm run start:dev
```

Production build and run:

```bash
npm run build
npm run start:prod
```

Default app port is controlled by `PORT` in `.env` (commonly `3000`).

## Scripts

- `npm run start` - start app
- `npm run start:dev` - start in watch mode
- `npm run build` - build project
- `npm run lint` - run eslint (with fix)
- `npm run test` - unit tests
- `npm run test:e2e` - e2e tests
- `npm run test:cov` - coverage

## API Notes

Main transaction routes:

- `POST /transactions/deposit`
- `POST /transactions/withdraw`
- `POST /transactions/transfer`

Most protected routes require JWT authentication.

## License

UNLICENSED
