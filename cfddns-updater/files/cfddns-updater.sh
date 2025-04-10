#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (C) 2025 LRSTS <lrsts@qq.com>
# Cloudflare DDNS Automatic Updater

PATH="/usr/sbin:/usr/bin:/sbin:/bin"

# 初始化配置
CONFIG_FILE="/etc/config/cfddns"
LOG_FILE=$(uci -q get cfddns.@main[0].log_file || echo "/var/log/cfddns.log")
LOCK_FILE="/var/run/cfddns.lock"
MAX_RETRY=3
RETRY_DELAY=300  # 错误重试间隔（秒）
IP_SERVICES=(
    "https://4.ipw.cn"
    # "https://api.ipify.org"
    # "https://ipv4.icanhazip.com"
)

# 创建日志目录
log_dir=$(dirname "$LOG_FILE")
[ ! -d "$log_dir" ] && mkdir -p "$log_dir"
[ ! -f "$LOG_FILE" ] && touch "$LOG_FILE"

# 日志功能
log() {
    local level=$1
    local message=$2
    local timestamp=$(date "+%Y-%m-%d %H:%M:%S")
    echo "[${timestamp}] [${level^^}] ${message}" >> "$LOG_FILE"
}

# 清理退出
cleanup() {
    rm -f "$LOCK_FILE"
    exit 0
}

# 获取IP地址（根据配置方式）
get_ip() {
    local record_type=$1
    local ip_source=$(uci -q get cfddns.@main[0].ip_source || echo "network")
    
    if [[ "$ip_source" == "interface" ]]; then
        # 从网络接口获取IP
        local interface=$(uci -q get cfddns.@main[0].ip_interface || echo "wan")
        local ip_cmd="ip -o -${record_type:1} addr show dev $interface"
        local ip_regex='inet6?[ \t]+([0-9a-fA-F:.]+)/'
        
        if [[ $record_type == "A" ]]; then
            ip_regex='inet[ \t]+([0-9.]+)/'
        fi
        
        if ! ip=$($ip_cmd | grep -Po "$ip_regex" | head -1); then
            log ERROR "无法从接口 $interface 获取IP"
            return 1
        fi
        
        echo "$ip"
        return 0
    else
        # 从网络服务获取IP（默认方式）
        local services=("${IP_SERVICES[@]}")
        [[ "$record_type" == "AAAA" ]] && services=(
            "https://6.ipw.cn"
            # "https://api6.ipify.org"
            # "https://ipv6.icanhazip.com"
        )

        # 如果配置了自定义服务URL，则使用它
        local custom_service=$(uci -q get cfddns.@main[0].ip_service)
        [[ -n "$custom_service" ]] && services=("$custom_service")

        for service in "${services[@]}"; do
            if ip=$(curl -sSf --connect-timeout 10 "$service" 2>/dev/null | tr -d '[:space:]'); then
                if [[ "$record_type" == "A" && "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
                   [[ "$record_type" == "AAAA" && "$ip" =~ ^[0-9a-fA-F:]+$ ]]; then
                    echo "$ip"
                    return 0
                fi
            fi
            log WARN "从 ${service} 获取IP失败"
        done
        
        log ERROR "无法获取有效的${record_type}地址"
        return 1
    fi
}

# 调用Cloudflare API
cf_api() {
    local method=$1
    local url=$2
    local data=${3:-}
    local attempt=0
    
    while (( attempt < MAX_RETRY )); do
        response=$(curl -sS \
            -X "$method" \
            -H "X-Auth-Email: $CF_EMAIL" \
            -H "X-Auth-Key: $CF_API_KEY" \
            -H "Content-Type: application/json" \
            --data "$data" \
            "https://api.cloudflare.com/client/v4/$url" 2>/dev/null)
        
        if jq -e '.success == true' <<< "$response" >/dev/null; then
            echo "$response"
            return 0
        fi
        
        error_msg=$(jq -r '.errors[0].message' <<< "$response" 2>/dev/null || echo "未知错误")
        log WARN "API请求失败 (尝试 $((attempt+1))): $error_msg"
        sleep $(( (attempt + 1) * 2 ))
        ((attempt++))
    done
    
    log ERROR "API请求最终失败: $url"
    return 1
}

# 主程序
main() {
    # 检查锁文件
    exec 9>"$LOCK_FILE"
    if ! flock -n 9; then
        log WARN "已有实例运行中，跳过本次执行"
        return 2
    fi
    trap cleanup EXIT

    # 加载配置
    CF_EMAIL=$(uci -q get cfddns.@main[0].email)
    CF_API_KEY=$(uci -q get cfddns.@main[0].api_key)
    ZONE_NAME=$(uci -q get cfddns.@main[0].zone_name)
    RECORD_NAME=$(uci -q get cfddns.@main[0].record_name)
    RECORD_TYPE=$(uci -q get cfddns.@main[0].record_type)
    TTL=$(uci -q get cfddns.@main[0].ttl || echo 300)

    # 验证配置完整性
    if [[ -z "$CF_EMAIL" || -z "$CF_API_KEY" ]]; then
        log ERROR "缺少Cloudflare认证信息"
        return 1
    fi
    
    if [[ -z "$ZONE_NAME" || -z "$RECORD_NAME" ]]; then
        log ERROR "缺少域名配置"
        return 1
    fi

    # 获取IP
    if ! NEW_IP=$(get_ip "$RECORD_TYPE"); then
        return 1
    fi

    # 获取Zone ID
    if ! zone_info=$(cf_api GET "zones?name=$ZONE_NAME"); then
        return 1
    fi
    ZONE_ID=$(jq -r '.result[0].id' <<< "$zone_info")
    if [[ -z "$ZONE_ID" || "$ZONE_ID" == "null" ]]; then
        log ERROR "无法获取Zone ID"
        return 1
    fi

    # 获取DNS记录
    if ! dns_records=$(cf_api GET "zones/$ZONE_ID/dns_records?name=$RECORD_NAME&type=$RECORD_TYPE"); then
        return 1
    fi
    RECORD_ID=$(jq -r '.result[0].id' <<< "$dns_records")
    CURRENT_IP=$(jq -r '.result[0].content' <<< "$dns_records")

    # 记录不存在时创建新记录
    if [[ -z "$RECORD_ID" || "$RECORD_ID" == "null" ]]; then
        log INFO "创建新DNS记录: $RECORD_NAME => $NEW_IP"
        create_data=$(jq -n \
            --arg type "$RECORD_TYPE" \
            --arg name "$RECORD_NAME" \
            --arg content "$NEW_IP" \
            --argjson ttl $TTL \
            '{type: $type, name: $name, content: $content, ttl: $ttl, proxied: false}')
        
        if ! cf_api POST "zones/$ZONE_ID/dns_records" "$create_data" >/dev/null; then
            log ERROR "DNS记录创建失败"
            return 1
        fi
    else
        # IP比对
        if [ "$CURRENT_IP" == "$NEW_IP" ]; then
            log INFO "IP未变化 ($NEW_IP)"
            return 0
        fi

        # 更新DNS记录
        log INFO "检测到IP变化: $CURRENT_IP -> $NEW_IP"
        update_data=$(jq -n \
            --arg type "$RECORD_TYPE" \
            --arg name "$RECORD_NAME" \
            --arg content "$NEW_IP" \
            --argjson ttl $TTL \
            '{type: $type, name: $name, content: $content, ttl: $ttl}')
        
        if ! cf_api PUT "zones/$ZONE_ID/dns_records/$RECORD_ID" "$update_data" >/dev/null; then
            log ERROR "DNS记录更新失败"
            return 1
        fi
    fi

    log INFO "操作成功完成"
    return 0
}

# 执行入口
case "$1" in
    "run")
        while true; do
            # 禁用错误退出以保证循环持续
            set +e
            main
            retval=$?
            set -e

            case $retval in
                0)  # 成功
                    sleep $(( $(uci -q get cfddns.@main[0].update_interval || echo 60) * 60 ))
                    ;;
                1)  # 可恢复错误
                    log WARN "临时错误，${RETRY_DELAY}秒后重试"
                    sleep $RETRY_DELAY
                    ;;
                2)  # 跳过执行
                    sleep 60
                    ;;
            esac
        done
        ;;
    *)
        main
        ;;
esac
