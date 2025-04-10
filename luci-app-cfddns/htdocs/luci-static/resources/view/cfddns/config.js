'use strict';
'require form';
'require poll';
'require rpc';
'require uci';
'require view';
'require fs';

const callServiceList = rpc.declare({
    object: 'service',
    method: 'list',
    params: [ 'name' ],
    expect: { '': {} }
});

function getServiceStatus() {
	return L.resolveDefault(callServiceList('cfddns'), {}).then(function (res) {
		var isRunning = false;
		try {
			isRunning = res['cfddns']['instances']['instance1']['running'];
		} catch (e) { }
		return isRunning;
	});
}

function renderStatus(isRunning) {
	var spanTemp = '<span style="color:%s"><strong>%s %s</strong></span>';
	var renderHTML;
	if (isRunning) {
		renderHTML = spanTemp.format('green', _('CFDDNS'), _('RUNNING'));
	} else {
		renderHTML = spanTemp.format('red', _('CFDDNS'), _('NOT RUNNING'));
	}

	return renderHTML;
}

return view.extend({
    load: function() {
        return Promise.all([
            uci.load('cfddns')
        ]);
    },
    render: function(data) {
        let m, s, o;
        m = new form.Map('cfddns', _('CFDDNS'),_('Automatically update your Cloudflare DNS records'));

        // ===== 状态显示区域 =====
		s = m.section(form.TypedSection);
		s.anonymous = true;
        
		s.render = function () {
			poll.add(function() {
                return L.resolveDefault(getServiceStatus()).then(function (res) {
                    var view = document.getElementById('service_status');
                    if (view) view.innerHTML = renderStatus(res);
                });
            }, 5);

			return E('div', { class: 'cbi-section', id: 'status_bar' }, [
					E('p', { id: 'service_status' }, _('Collecting data…'))
			]);
		}

        // 主配置区域
        s = m.section(form.NamedSection, 'config', 'cfddns');

        // 启用开关
        o = s.option(form.Flag, 'enabled', _('Enable Automatic Updates'));
        o.rmempty = false;

        // Cloudflare账户配置
        o = s.option(form.Value, 'email', _('Cloudflare Email'));
        o.datatype = 'string';
        o.placeholder = 'user@example.com';

        o = s.option(form.Value, 'api_key', _('API Key'));
        o.password = true;
        o.description = _('Can be found in your Cloudflare profile settings');

        // DNS记录配置
        o = s.option(form.Value, 'zone_name', _('Zone Name (Root Domain)'));
        o.datatype = 'hostname';
        o.placeholder = 'example.com';

        o = s.option(form.Value, 'record_name', _('Record Name (Subdomain)'));
        o.datatype = 'hostname';
        o.placeholder = 'sub.example.com';

        o = s.option(form.ListValue, 'record_type', _('Record Type'));
        o.value('A', _('A (IPv4)'));
        o.value('AAAA', _('AAAA (IPv6)'));
        o.default = 'A';

        o = s.option(form.ListValue, 'ip_source', _('IP Source Method'));
        o.value('network', _('Get from network (external service)'));
        o.value('interface', _('Get from local interface'));
        o.default = 'network';
        o.description = _('Choose how to obtain the IP address');

        // 网络获取IP的配置
        o = s.option(form.Value, 'ip_service', _('IP Detection Service URL'));
        o.depends('ip_source', 'network');
        o.datatype = 'string';
        o.default = 'https://api.ipify.org';
        o.placeholder = 'https://api.ipify.org';

        // 接口获取IP的配置
        o = s.option(form.Value, 'ip_interface', _('Network Interface'));
        o.depends('ip_source', 'interface');
        o.datatype = 'string';
        o.placeholder = 'wan';

        o = s.option(form.Value, 'ttl', _('TTL (Time-To-Live)(second)'));
        o.datatype = 'uinteger';
        o.default = '300';
        o.placeholder = '300';

        // 更新设置
        o = s.option(form.Value, 'update_interval', _('Update Interval (minutes)'));
        o.datatype = 'uinteger';
        o.default = '60';
        o.placeholder = '60';

        // 日志设置
        o = s.option(form.Value, 'log_file', _('Log File Path'));
        o.default = '/var/log/cfddns.log';


        return m.render();
    },
});
