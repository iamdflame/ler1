# ROARLINE — single-container deploy (Fly.io / Railway / Render / anywhere)
FROM node:20-slim
WORKDIR /app

# Dependencies are used only by live TxLINE activation/proofs and optional
# receipt submission; npm ci keeps the container identical to the lockfile.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY server ./server
COPY web ./web
COPY scripts ./scripts
COPY fixtures ./fixtures
COPY target/idl ./target/idl

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/index.mjs"]
