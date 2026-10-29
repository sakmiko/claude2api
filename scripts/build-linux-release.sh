#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Claude2API Linux 多架构静态二进制构建与发布脚本
# 基于官方 golang:1.24-alpine 容器环境构建，宿主机无需安装 Go 编译器
# ==============================================================================

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${PROJECT_ROOT}/dist"
VERSION="${1:-v1.0.0}"

echo "=========================================================="
echo "开始构建 Claude2API Linux 全架构二进制发布包 (${VERSION})"
echo "构建目录: ${PROJECT_ROOT}"
echo "输出目录: ${DIST_DIR}"
echo "=========================================================="

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

# 定义 Linux 主流架构矩阵
# 格式: GOARCH:GOARM:NAME:DESCRIPTION
ARCH_MATRIX=(
    "amd64::linux-amd64:x86_64 标准架构 (Ubuntu, Debian, CentOS, Alpine, Arch 等)"
    "arm64::linux-arm64:AArch64 64位架构 (树莓派4/5, 各类国产ARM服务器, 苹果M系列Linux虚拟机)"
    "arm:7:linux-armv7:ARMv7 32位架构 (树莓派2/3, 嵌入式开发板, 软路由)"
    "arm:6:linux-armv6:ARMv6 32位极轻量架构 (树莓派Zero/1)"
    "riscv64::linux-riscv64:RISC-V 64位开放架构"
    "mips64le::linux-mips64le:MIPS64 小端架构 (龙芯早期架构, 嵌入式网关)"
    "ppc64le::linux-ppc64le:PowerPC 64位小端架构"
    "s390x::linux-s390x:IBM System z 大机架构"
    "loong64::linux-loong64:LoongArch 龙芯自主指令集架构"
)

echo "-> 正在启动 Golang 容器环境执行跨架构静态编译 (CGO_ENABLED=0)..."

for entry in "${ARCH_MATRIX[@]}"; do
    IFS=":" read -r goarch goarm name desc <<< "${entry}"
    echo "----------------------------------------------------------"
    echo "正在构建: ${name} (${desc})"
    
    TARGET_DIR="${DIST_DIR}/claude2api-${VERSION}-${name}"
    mkdir -p "${TARGET_DIR}"

    docker run --rm \
        -v "${PROJECT_ROOT}:/src" \
        -w "/src" \
        -e GOOS=linux \
        -e GOARCH="${goarch}" \
        -e GOARM="${goarm}" \
        -e CGO_ENABLED=0 \
        golang:1.24-alpine \
        go build -trimpath -ldflags="-s -w -extldflags '-static'" -o "/src/dist/claude2api-${VERSION}-${name}/claude2api" ./cmd/server

    # 打包标准部署附件与配置文件
    cp "${PROJECT_ROOT}/config.example.yaml" "${TARGET_DIR}/config.example.yaml"
    cp "${PROJECT_ROOT}/LICENSE" "${TARGET_DIR}/LICENSE"
    cp "${PROJECT_ROOT}/THIRD_PARTY_NOTICES.md" "${TARGET_DIR}/THIRD_PARTY_NOTICES.md"

    # 打包为 .tar.gz 压缩文件
    (
        cd "${DIST_DIR}"
        tar -czf "claude2api-${VERSION}-${name}.tar.gz" "claude2api-${VERSION}-${name}"
        rm -rf "claude2api-${VERSION}-${name}"
    )
    echo "✓ 完成: claude2api-${VERSION}-${name}.tar.gz"
done

echo "----------------------------------------------------------"
echo "-> 正在计算发布包 SHA-256 校验和..."
(
    cd "${DIST_DIR}"
    sha256sum *.tar.gz > sha256sums.txt
    echo "=== SHA-256 校验清单 ==="
    cat sha256sums.txt
)

echo "=========================================================="
echo "所有 Linux 架构二进制发布包构建完成！"
echo "发布文件已保存在: ${DIST_DIR}"
echo "=========================================================="
