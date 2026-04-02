FROM node:20-slim
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
# Client package.json needed for workspace resolution but we won't build it
COPY packages/client/package.json packages/client/
RUN npm ci

# Copy source
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
COPY tsconfig.json ./

EXPOSE 3001
CMD ["npx", "tsx", "packages/server/src/main.ts"]
