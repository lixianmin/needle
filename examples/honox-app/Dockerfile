# 构建上下文是仓库根（要带上 packages/ 里的本仓库包）：
#   docker build -f examples/honox-app/Dockerfile \
#     --build-arg GIT_SHA=$(git describe --tags --always --dirty) -t honox-app .
#
# 两阶段：builder 里装依赖 + bun build；运行镜像只带构建产物，
# dist/index.js 已经把 npm 依赖打进去了。
FROM oven/bun:1 AS builder
WORKDIR /src

# 版本号来自宿主机上的 git：.git 被根 .dockerignore 排掉（否则上下文翻倍），
# 容器里跑不了 git describe。没传就让构建失败，不产出自称 unknown 的镜像。
ARG GIT_SHA
RUN [ -n "$GIT_SHA" ] || (echo "构建需要 --build-arg GIT_SHA=<git describe --tags --always --dirty>" && exit 1)

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

ENV ENV=pro
EXPOSE 5001
USER bun
CMD ["bun", "dist/index.js"]
