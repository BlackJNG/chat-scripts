#!/usr/bin/env bash
# 一次性把本地仓库推到 GitHub，并打印 ghproxy 安装链接
# 用法： export GITHUB_TOKEN=ghp_xxx ./push.sh
set -euo pipefail
OWNER="${GH_OWNER:-BlackJNG}"
REPO="${GH_REPO:-chat-scripts}"
: "${GITHUB_TOKEN:?先 export GITHUB_TOKEN=你的PAT（需要 repo 权限）}"

api="https://api.github.com"
echo "== 检查仓库 $OWNER/$REPO"
code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: token $GITHUB_TOKEN" "$api/repos/$OWNER/$REPO")
if [ "$code" = "404" ]; then
  echo "== 创建仓库"
  curl -s -X POST -H "Authorization: token $GITHUB_TOKEN" \
    -d "{\"name\":\"$REPO\",\"private\":false,\"description\":\"陌生人聊天站托管脚本\"}" \
    "$api/user/repos" > /dev/null
else
  echo "== 仓库已存在（$code）"
fi

cd "$(dirname "$0")"
git add -A
git -c user.name="chat-bots" -c user.email="bot@local" commit -m "${MSG:-chore: 更新脚本}" || echo "没有变更"
git branch -M main
git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:$GITHUB_TOKEN@github.com/$OWNER/$REPO.git"
git push -u origin main

echo
echo "== 完成，安装链接："
for f in scripts/*.user.js; do
  echo "https://gh-proxy.org/https://raw.githubusercontent.com/$OWNER/$REPO/main/$f"
done
