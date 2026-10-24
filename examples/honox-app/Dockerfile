# 构建上下文是仓库根（要带上 packages/ 里的本仓库包）：
#   docker build -f examples/honox-app/Dockerfile -t honox-app .
#
# 两阶段：builder 里装依赖 + bun build；运行镜像只带构建产物，
# dist/index.js 已经把 npm 依赖打进去了。
FROM oven/bun:1 AS builder
WORKDIR /src

# 根 workspace：packages/honox 的 @needle/shell / @needle/logo 是 workspace:*，
# 没有根 node_modules 就解析不到。
COPY package.json bun.lock tsconfig.json ./
COPY packages ./packages
RUN bun install

COPY examples/honox-app ./examples/honox-app
WORKDIR /src/examples/honox-app
RUN bun install --frozen-lockfile && bun run build

FROM oven/bun:1
WORKDIR /app
COPY --from=builder /src/examples/honox-app/dist ./dist
COPY --from=builder /src/examples/honox-app/res ./res

ENV ENV=dev
ENV NODE_ENV=production
EXPOSE 8213
USER bun
CMD ["bun", "dist/index.js"]
