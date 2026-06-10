#!/bin/bash
# OpenCode ClawMessenger Linux 卸载脚本
# 用法: curl -fsSL https://raw.githubusercontent.com/neomei/opencode-clawmessenger/main/scripts/uninstall.sh | bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PACKAGE_NAME="@neomei/opencode-clawmessenger"
SERVICE_NAME="opencode-clawmessenger"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

check_root() {
  if [ "$EUID" -ne 0 ]; then
    error "请使用 sudo 或 root 用户运行此脚本"
    exit 1
  fi
}

main() {
  echo "========================================"
  echo "  OpenCode ClawMessenger 卸载程序"
  echo "========================================"
  echo ""

  check_root

  # 1. 停止并禁用服务
  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    info "正在停止服务..."
    systemctl stop "$SERVICE_NAME" || true
  fi

  if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
    info "正在禁用服务..."
    systemctl disable "$SERVICE_NAME" || true
  fi

  # 2. 删除服务文件
  if [ -f "$SERVICE_FILE" ]; then
    info "删除服务文件: $SERVICE_FILE"
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload
  fi

  # 3. 卸载 npm 包
  if npm list -g "$PACKAGE_NAME" &> /dev/null || npm list -g --depth=0 "$PACKAGE_NAME" &> /dev/null; then
    info "正在卸载 npm 包: $PACKAGE_NAME"
    npm uninstall -g "$PACKAGE_NAME" || warn "npm 卸载可能未完全成功"
  else
    warn "未检测到全局安装的 $PACKAGE_NAME"
  fi

  # 4. 清理配置和日志（询问用户）
  echo ""
  read -rp "是否删除配置文件和日志? (y/N): " confirm
  if [[ "$confirm" =~ ^[Yy]$ ]]; then
    # 查找所有用户的配置
    for config_dir in /root/.config/opencode /home/*/.config/opencode; do
      if [ -d "$config_dir" ]; then
        info "删除配置目录: $config_dir"
        rm -rf "$config_dir"
      fi
    done
    success "配置和日志已清理"
  else
    info "保留配置文件和日志"
  fi

  echo ""
  success "OpenCode ClawMessenger 卸载完成"
  echo ""
}

main "$@"
