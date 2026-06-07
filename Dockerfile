# ECA Verify — single image for API + worker, run via ts-node (matches dev run mode).
FROM node:22-slim

WORKDIR /app

# Copy manifests first for layer-cached dependency install.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/plugin/package.json packages/plugin/package.json
COPY packages/sdk-types/package.json packages/sdk-types/package.json

RUN npm ci

# Copy the rest of the source.
COPY . .

EXPOSE 3000

# Command is overridden per service in docker-compose.yml.
CMD ["npx", "ts-node", "apps/api/src/main.ts"]
