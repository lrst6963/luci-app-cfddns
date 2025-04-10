# SPDX-License-Identifier: Apache-2.0
#
# Copyright (C) 2025 LRSTS <lrsts@qq.com>

include $(TOPDIR)/rules.mk

PKG_NAME:=cfddns-updater
PKG_VERSION:=1.0.1
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=LRSTS <lrsts@qq.com>

include $(INCLUDE_DIR)/package.mk

define Package/cfddns-updater
	SECTION:=net
	CATEGORY:=Network
	TITLE:=Cloudflare DDNS Automatic Updater
	DEPENDS:=+curl +jq +coreutils +ca-bundle +bash
	PKGARCH:=all
endef

define Package/cfddns-updater/description
Automatically update Cloudflare DNS records with dynamic IP address changes.
Supports both IPv4 (A) and IPv6 (AAAA) records.
endef

define Package/cfddns-updater/conffiles
/etc/config/cfddns
/etc/cfddns/
endef

# 不需要编译步骤
define Build/Prepare
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/cfddns-updater/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/cfddns-updater.sh $(1)/usr/bin/cfddns-updater

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/cfddns.init $(1)/etc/init.d/cfddns

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/cfddns.config $(1)/etc/config/cfddns
endef

$(eval $(call BuildPackage,cfddns-updater))
