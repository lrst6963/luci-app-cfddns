'use strict';
'require dom';
'require fs';
'require poll';
'require uci';
'require view';

return view.extend({
    render: function() {
        var css = `
        #log-container {
        margin: 1em 0;
        border-radius: 3px;
        background: #ffffff00;
        }
        #log-content {
        padding: 1em;
        font-family: monospace;
        white-space: pre-wrap;
        max-height: 60vh;
        overflow-y: auto;
        border: 1px solid #ddd;
        border-radius: 2px;
        }
        .log-controls {
            margin: 0.5em 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .log-line-count {
            color: #666;
            font-size: 0.9em;
        }
        .loading-indicator {
            text-align: center;
            padding: 1em;
            color: #666;
        }
        .log-error {
            color: #d44950;
        }
        .btn-clear-log {
            background-color: #e74c3c;
            color: white;
            border: none;
            padding: 0.3em 0.8em;
            border-radius: 3px;
            cursor: pointer;
        }
        .btn-clear-log:hover {
            background-color: #c0392b;
        }`;

        // Helper function to get log path
        var getLogPath = function() {
            var path = '/var/log/cfddns.log';
            try {
                var config = uci.get('cfddns', 'config', 'log_file');
                if (config) path = config;
            } catch (e) {
                console.warn('Failed to read log path from config:', e);
            }
            return path;
        };

        // Function to clear log file
        var clearLog = function(ev) {
            ev.preventDefault();

            if (!confirm(_('Are you sure you want to clear the log file?'))) {
                return;
            }

            var logPath = getLogPath();

            fs.write(logPath, '')
            .then(function() {
                // Force immediate refresh
                poll.stop();
                poll.start();
            })
            .catch(function(err) {
                var errorMsg = E('div', { 'class': 'log-error' },
                                 _('Error clearing log: %s').format(err.message || err));
                dom.content(logContainer.querySelector('#log-content'), errorMsg);
            });
        };

        // Create log container
        var logContainer = E('div', { 'id': 'log-container' }, [
            E('div', { 'class': 'log-controls' }, [
                E('h3', {}, _('Cloudflare DDNS Update Log')),
              E('div', { 'style': 'display: flex; align-items: center; gap: 1em;' }, [
                  E('span', { 'class': 'log-line-count' }, _('Loading...')),
                E('button', {
                    'class': 'btn-clear-log',
                    'click': L.bind(clearLog, this)
                }, _('Clear Log'))
              ])
            ]),
            E('div', { 'id': 'log-content' },
              E('div', { 'class': 'loading-indicator' }, [
                  E('img', {
                      'src': L.resource('icons/loading.gif'),
                    'alt': _('Loading…'),
                    'style': 'vertical-align: middle; margin-right: 0.5em;'
                  }),
                  _('Loading log data...')
              ])
            )
        ]);

        // Configure log polling
        poll.add(L.bind(function() {
            var logPath = getLogPath();

            return fs.read(logPath)
            .then(function(res) {
                var content = res instanceof Uint8Array ?
                new TextDecoder().decode(res) :
                (res || '');

                var lines = content.trim().split('\n');
                var lastLines = lines.slice(-100); // Show last 100 lines

                // Update line count display
                var lineCount = E('span', { 'class': 'log-line-count' },
                                  _('Showing last %d of %d lines').format(lastLines.length, lines.length));
                dom.content(logContainer.querySelector('.log-line-count'), lineCount);

                // Format log content with timestamps
                var logContent = E('div', { 'style': 'font-family: monospace;' });
                lastLines.forEach(function(line) {
                    var lineElement = E('div', { 'style': 'margin-bottom: 0.2em;' });

                    // Highlight error lines
                    if (line.toLowerCase().includes('error') ||
                        line.toLowerCase().includes('failed')) {
                        lineElement.className = 'log-error';
                        }

                        // Add timestamp if not present
                        if (!line.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)) {
                            line = new Date().toISOString().replace('T', ' ').replace(/\..+/, '') + ' ' + line;
                        }

                        dom.append(lineElement, document.createTextNode(line));
                    dom.append(logContent, lineElement);
                });

                dom.content(logContainer.querySelector('#log-content'), logContent);
            })
            .catch(function(err) {
                var errorMsg;
                if (err.toString().includes('NotFoundError')) {
                    errorMsg = E('div', { 'class': 'log-error' },
                                 _('Log file not found at: %s').format(logPath));
                } else {
                    errorMsg = E('div', { 'class': 'log-error' },
                                 _('Error reading log: %s').format(err.message || err));
                }
                dom.content(logContainer.querySelector('#log-content'), errorMsg);
                dom.content(logContainer.querySelector('.log-line-count'), '');
            });
        }, this), 5); // Update every 5 seconds

        return E([
            E('style', [ css ]),
                 E('div', { 'class': 'cbi-map' }, [
                     E('div', { 'class': 'cbi-section' }, [
                         logContainer,
                         E('div', { 'style': 'text-align: right; margin-top: 0.5em;' },
                           E('small', {}, _('Auto-refreshing every %d seconds').format(L.env.pollinterval))
                         )
                     ])
                 ])
        ]);
    },

    // Disable save/reset functionality for log viewer
    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
