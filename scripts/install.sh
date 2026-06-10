#!/bin/bash
# OpenCode ClawMessenger Linux 安装脚本
# 支持: Ubuntu / Debian / CentOS / RHEL / Fedora / Arch 等 systemd 发行版
# 用法: curl -fsSL https://raw.githubusercontent.com/neomei/opencode-clawmessenger/main/scripts/install.sh | bash

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
PACKAGE_NAME="@neomei/opencode-clawmessenger"
SERVICE_NAME="opencode-clawmessenger"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
NODE_MIN_VERSION=18

# 打印函数
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 检查 root 权限
check_root() {
  if [ "$EUID" -ne 0 ]; then
    error "请使用 sudo 或 root 用户运行此脚本"
    exit 1
  fi
}

# 检查 systemd
check_systemd() {
  if ! command -v systemctl &> /dev/null; then
    error "未检测到 systemd，此脚本仅支持 systemd 系统"
    exit 1
  fi
  if ! systemctl --version &> /dev/null; then
    error "systemctl 命令异常，请检查系统配置"
    exit 1
  fi
  success "systemd 已就绪"
}

# 检查 Node.js 版本
check_node() {
  if ! command -v node &> /dev/null; then
    warn "未检测到 Node.js，正在尝试安装..."
    install_node
  fi

  NODE_VERSION=$(node -v | sed 's/v//;s/\..*//')
  if [ "$NODE_VERSION" -lt "$NODE_MIN_VERSION" ]; then
    error "Node.js 版本过低: $(node -v)，需要 >= v${NODE_MIN_VERSION}"
    info "请访问 https://nodejs.org/ 升级 Node.js"
    exit 1
  fi
  success "Node.js 版本: $(node -v)"
}

# 安装 Node.js (LTS)
install_node() {
  info "正在安装 Node.js LTS..."
  if command -v apt-get &> /dev/null; then
    apt-get update -qq
    apt-get install -y -qq curl ca-certificates gnupg
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
  elif command -v yum &> /dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    yum install -y nodejs
  elif command -v dnf &> /dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    dnf install -y nodejs
  elif command -v pacman &> /dev/null; then
    pacman -Sy --noconfirm nodejs npm
  else
    error "不支持的包管理器，请手动安装 Node.js >= v${NODE_MIN_VERSION}"
    exit 1
  fi
  success "Node.js 安装完成: $(node -v)"
}

# 获取运行用户
get_service_user() {
  # 优先使用 SUDO_USER（执行 sudo 的原始用户）
  if [ -n "$SUDO_USER" ]; then
    echo "$SUDO_USER"
  else
    echo "root"
  fi
}

# 获取实际的家目录
get_home_dir() {
  local user=$1
  if [ "$user" = "root" ]; then
    echo "/root"
  else
    getent passwd "$user" | cut -d: -f6
  fi
}

# 获取全局 npm 包安装路径
get_global_prefix() {
  sudo -u "$1" npm config get prefix
}

# 安装包
install_package() {
  local user=$1
  info "正在全局安装 ${PACKAGE_NAME}..."

  # 使用目标用户安装全局包
  if sudo -u "$user" npm install -g "$PACKAGE_NAME"@latest; then
    success "npm 包安装完成"
  else
    error "npm 包安装失败"
    exit 1
  fi
}

# 查找 CLI 路径
find_cli_path() {
  local user=$1
  local prefix
  prefix=$(sudo -u "$user" npm config get prefix)
  local cli="${prefix}/bin/opencode-clawmessenger"

  if [ ! -f "$cli" ]; then
    # 尝试查找 node_modules 中的实际文件
    cli=$(sudo -u "$user" npm root -g)/@neomei/opencode-clawmessenger/bin/opencode-clawmessenger
  fi

  if [ ! -f "$cli" ]; then
    error "未找到 opencode-clawmessenger CLI: $cli"
    exit 1
  fi

  echo "$cli"
}

# 创建 systemd 服务文件
install_service() {
  local user=$1
  local home_dir=$2
  local cli_path=$3
  local prefix
  prefix=$(sudo -u "$user" npm config get prefix)
  local node_bin
  node_bin=$(command -v node)

  info "正在创建 systemd 服务..."
  info "  用户: $user"
  info "  家目录: $home_dir"
  info "  Node: $node_bin"
  info "  CLI: $cli_path"

  # 下载服务模板
  local service_template
  service_template=$(curl -fsSL https://raw.githubusercontent.com/neomei/opencode-clawmessenger/main/scripts/opencode-clawmessenger.service 2>/dev/null) || {
    warn "无法从 GitHub 下载服务模板，使用内置模板"
    service_template='[Unit]
Description=OpenCode ClawMessenger Bridge - 融云虾说桥接服务
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=%USER%
Group=%GROUP%
WorkingDirectory=%INSTALL_DIR%
Environment="NODE_ENV=production"
Environment="CLAW_LOG_LEVEL=info"
Environment="HOME=%HOME%"
Environment="CLAW_CONFIG_DIR=%HOME%/.config/opencode"
ExecStart=%NODE_BIN% %CLI_PATH% start
ExecReload=/bin/kill -HUP $MAINPID
ExecStop=/bin/kill -TERM $MAINPID
Restart=on-failure
RestartSec=5
StartLimitInterval=60s
StartLimitBurst=3
StandardOutput=journal
StandardError=journal
SyslogIdentifier=opencode-clawmessenger

[Install]
WantedBy=multi-user.target'
  }

  # 确定用户组
  local group
  group=$(id -gn "$user")

  # 生成服务文件
  echo "$service_template" | sed \
    -e "s|%USER%|$user|g" \
    -e "s|%GROUP%|$group|g" \
    -e "s|%HOME%|$home_dir|g" \
    -e "s|%INSTALL_DIR%|$home_dir/.config/opencode|g" \
    -e "s|%NODE_BIN%|$node_bin|g" \
    -e "s|%CLI_PATH%|$cli_path|g" \
    > "$SERVICE_FILE"

  chmod 644 "$SERVICE_FILE"
  success "systemd 服务文件已创建: $SERVICE_FILE"
}

# 确保配置目录存在
ensure_config_dir() {
  local user=$1
  local home_dir=$2
  local config_dir="${home_dir}/.config/opencode"

  mkdir -p "$config_dir"
  chown -R "$user:$(id -gn "$user")" "$config_dir"
  chmod 755 "$config_dir"
  success "配置目录: $config_dir"
}

# 重载并启动服务
start_service() {
  info "正在启动服务..."
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"

  if systemctl start "$SERVICE_NAME"; then
    success "服务已启动"
  else
    error "服务启动失败，请检查日志: journalctl -u $SERVICE_NAME -n 50"
    exit 1
  fi

  sleep 2
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    success "服务运行正常"
  else
    warn "服务状态异常，请检查: systemctl status $SERVICE_NAME"
  fi
}

# 显示安装完成信息
show_completion() {
  local user=$1
  local home_dir=$2

  echo ""
  echo "========================================"
  echo "  OpenCode ClawMessenger 安装完成"
  echo "========================================"
  echo ""
  echo "  服务名称: $SERVICE_NAME"
  echo "  运行用户: $user"
  echo "  配置文件: ${home_dir}/.config/opencode/clawmessenger.json"
  echo "  日志文件: ${home_dir}/.config/opencode/clawmessenger.log"
  echo "  PID 文件: ${home_dir}/.config/opencode/clawmessenger.pid"
  echo ""
  echo "  常用命令:"
  echo "    systemctl status $SERVICE_NAME    # 查看状态"
  echo "    systemctl start $SERVICE_NAME     # 启动服务"
  echo "    systemctl stop $SERVICE_NAME      # 停止服务"
  echo "    systemctl restart $SERVICE_NAME   # 重启服务"
  echo "    systemctl logs $SERVICE_NAME -f   # 跟踪日志"
  echo ""
  echo "  初始化配置:"
  echo "    sudo -u $user opencode-clawmessenger setup"
  echo ""
  echo "  注意: 首次使用需要先运行 setup 完成设备绑定"
  echo ""
}

# 主流程
main() {
  echo "========================================"
  echo "  OpenCode ClawMessenger 安装程序"
  echo "========================================"
  echo ""

  check_root
  check_systemd
  check_node

  local service_user
  service_user=$(get_service_user)
  local home_dir
  home_dir=$(get_home_dir "$service_user")

  info "安装用户: $service_user"
  info "家目录: $home_dir"

  install_package "$service_user"
  ensure_config_dir "$service_user" "$home_dir"

  local cli_path
  cli_path=$(find_cli_path "$service_user")

  install_service "$service_user" "$home_dir" "$cli_path"
  start_service
  show_completion "$service_user" "$home_dir"
}

# 执行
main "$@"
