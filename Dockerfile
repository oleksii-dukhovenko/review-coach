# Review Coach: the app plus every tool it shells out to.

FROM golang:bookworm AS gopls
RUN go install golang.org/x/tools/gopls@latest

FROM dart:stable AS dart

FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

COPY --from=gopls /usr/local/go /usr/local/go
COPY --from=gopls /go/bin/gopls /usr/local/bin/gopls
COPY --from=dart /usr/lib/dart /usr/lib/dart
ENV PATH="/usr/local/go/bin:/usr/lib/dart/bin:${PATH}"

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

USER node
ENV REVIEW_COACH_HOST=0.0.0.0
EXPOSE 4477
ENTRYPOINT ["/app/docker/entrypoint.sh"]
