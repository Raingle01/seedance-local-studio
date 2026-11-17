#!/bin/zsh
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 20.19 或更高版本：https://nodejs.org/"
  read -k 1 "?按任意键退出"
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci || exit 1
fi
npm start -- --open
