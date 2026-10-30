FROM node:22-alpine

WORKDIR /app

# Copy application files
COPY package.json tsconfig.json ./
COPY src/ ./src/
COPY bin/ ./bin/
COPY skills/ ./skills/
COPY tests/ ./tests/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Default entrypoint starts the API server or CLI
CMD ["node", "src/server/api.ts"]
