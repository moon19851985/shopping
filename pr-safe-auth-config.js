/**
 * إعدادات خادم التحقق (index.html، admin-dashboard، تطبيق Capacitor).
 * الترتيب: pr-safe-auth-port.js → pr-safe-auth-production.js → هذا الملف.
 *
 * التطوير: __PR_SAFE_AUTH_API_BASE__ فارغ → اكتشاف localhost / Wi‑Fi (كما سابقاً).
 * Google Play: اضبط HTTPS في pr-safe-auth-production.js ثم cap:sync.
 *
 * تجاوز للتطوير مع وجود رابط إنتاج: localStorage.setItem('PR_SAFE_AUTH_FORCE_LOCAL','1')
 * جوال على Wi‑Fi: localStorage.setItem('PR_SAFE_AUTH_OVERRIDE_HOST','192.168.x.x')
 */
(function () {
    function resolvePrSafeAuthHost() {
        try {
            var override = (
                typeof localStorage !== 'undefined' && localStorage.getItem('PR_SAFE_AUTH_OVERRIDE_HOST')
                    ? String(localStorage.getItem('PR_SAFE_AUTH_OVERRIDE_HOST'))
                    : ''
            ).trim();
            if (override) {
                return override;
            }
        } catch (e) {}

        var host = '127.0.0.1';
        var lh = '';
        if (typeof window !== 'undefined' && window.location && window.location.hostname) {
            lh = window.location.hostname;
            if (lh && lh !== 'localhost' && lh !== '127.0.0.1') {
                host = lh;
            }
        }
        try {
            if (
                typeof window.Capacitor !== 'undefined' &&
                typeof window.Capacitor.getPlatform === 'function' &&
                window.Capacitor.getPlatform() === 'android' &&
                (host === '127.0.0.1' || lh === 'localhost' || lh === '127.0.0.1' || !lh)
            ) {
                return '10.0.2.2';
            }
        } catch (e2) {}
        return host;
    }

    function fetchWithTimeout(url, opts, ms) {
        var timeoutMs = typeof ms === 'number' ? ms : 2200;
        if (typeof AbortController === 'undefined') {
            return fetch(url, opts);
        }
        var ctrl = new AbortController();
        var timer = setTimeout(function () {
            try {
                ctrl.abort();
            } catch (eAbort) {}
        }, timeoutMs);
        var merged = Object.assign({}, opts || {}, { signal: ctrl.signal });
        return fetch(url, merged).finally(function () {
            clearTimeout(timer);
        });
    }

    function buildPortsList(host, preferred) {
        var ports = [];
        ports.push(preferred);
        var isLan =
            /^192\.168\./.test(host) ||
            /^10\./.test(host) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(host);
        var maxPort = isLan ? preferred + 2 : preferred + 5;
        for (var p = preferred; p <= maxPort; p++) {
            if (ports.indexOf(p) === -1) {
                ports.push(p);
            }
        }
        return ports;
    }

    function normalizeProductionApiBase(raw) {
        var base = String(raw || '')
            .trim()
            .replace(/\/+$/, '');
        if (!base) {
            return '';
        }
        if (!/^https:\/\//i.test(base)) {
            console.error('[PR_SAFE_AUTH] عنوان الإنتاج يجب أن يبدأ بـ https://');
            return '';
        }
        return base;
    }

    function shouldForceLocalDiscovery() {
        try {
            return typeof localStorage !== 'undefined' && localStorage.getItem('PR_SAFE_AUTH_FORCE_LOCAL') === '1';
        } catch (e) {
            return false;
        }
    }

    function getConfiguredProductionApiBase() {
        if (shouldForceLocalDiscovery()) {
            return '';
        }
        return normalizeProductionApiBase(
            typeof window !== 'undefined' && window.__PR_SAFE_AUTH_API_BASE__ != null
                ? window.__PR_SAFE_AUTH_API_BASE__
                : ''
        );
    }

    var resolveDiscovery;
    window.PR_SAFE_AUTH_DISCOVERY = new Promise(function (resolve) {
        resolveDiscovery = resolve;
    });

    var productionBase = getConfiguredProductionApiBase();

    function applyOptionalAdminKey() {
        try {
            var ak =
                typeof window !== 'undefined' && window.__PR_SAFE_AUTH_ADMIN_KEY__
                    ? String(window.__PR_SAFE_AUTH_ADMIN_KEY__).trim()
                    : '';
            if (ak && window.PR_SAFE_AUTH) {
                window.PR_SAFE_AUTH.adminKey = ak;
            }
        } catch (eAdmin) {}
    }

    function finishProductionDiscovery(apiBase, ok) {
        window.PR_SAFE_AUTH = {
            apiBase: apiBase,
            adminKey: '',
            enableManualEmailFallback: true,
            productionMode: true
        };
        applyOptionalAdminKey();
        if (ok) {
            console.info('[PR_SAFE_AUTH] خادم الإنتاج:', apiBase);
        } else {
            console.warn(
                '[PR_SAFE_AUTH] تعذر التحقق من خادم الإنتاج — راجع الرابط والشهادة. العنوان المضبوط:',
                apiBase
            );
        }
        resolveDiscovery();
    }

    if (productionBase) {
        window.PR_SAFE_AUTH = {
            apiBase: productionBase,
            adminKey: '',
            enableManualEmailFallback: true,
            productionMode: true
        };
        if (typeof fetch === 'undefined') {
            finishProductionDiscovery(productionBase, false);
            return;
        }
        fetchWithTimeout(productionBase + '/api/ping', { method: 'GET', cache: 'no-store' }, 8000)
            .then(function (r) {
                if (!r.ok) {
                    return null;
                }
                return r.json().catch(function () {
                    return null;
                });
            })
            .then(function (j) {
                finishProductionDiscovery(productionBase, !!(j && j.ok));
            })
            .catch(function () {
                finishProductionDiscovery(productionBase, false);
            });
        return;
    }

    var host = resolvePrSafeAuthHost();
    var preferred =
        typeof window !== 'undefined' && window.__PR_SAFE_AUTH_PORT__
            ? window.__PR_SAFE_AUTH_PORT__
            : 3000;

    var ports = buildPortsList(host, preferred);

    window.PR_SAFE_AUTH = {
        apiBase: 'http://' + host + ':' + preferred,
        adminKey: 'dev-admin-key-change-me',
        enableManualEmailFallback: true,
        productionMode: false
    };
    applyOptionalAdminKey();

    if (typeof fetch === 'undefined') {
        resolveDiscovery();
        return;
    }

    (function discoverAuthPort() {
        var i = 0;
        /** @type {{port:number,j:Object}[]} */
        var candidates = [];

        function finishWithMonitorProbe() {
            var withPasswordReset = candidates.filter(function (c) {
                return c.j && c.j.passwordReset === true;
            });
            var pool = withPasswordReset.length ? withPasswordReset : candidates;
            pool.sort(function (a, b) {
                return a.port - b.port;
            });
            if (!pool.length) {
                console.warn(
                    '[PR_SAFE_AUTH] لم يُعثر على خادم التحقق على المنافذ المحلية. شغّل: npm run auth-server'
                );
                resolveDiscovery();
                return;
            }
            var adminKey = String((window.PR_SAFE_AUTH && window.PR_SAFE_AUTH.adminKey) || '');
            if (withPasswordReset.length && withPasswordReset.length < candidates.length) {
                console.warn(
                    '[PR_SAFE_AUTH] وُجد خادم قديم بدون «نسيت كلمة السر» — تم اختيار نسخة محدّثة على المنفذ ' +
                        withPasswordReset[0].port
                );
            }
            var probes = pool.map(function (c) {
                return fetchWithTimeout(
                    'http://' + host + ':' + c.port + '/api/admin/server-monitor',
                    {
                        method: 'GET',
                        cache: 'no-store',
                        headers: adminKey ? { 'x-admin-key': adminKey } : {}
                    },
                    1800
                )
                    .then(function (r) {
                        return { port: c.port, status: r.status };
                    })
                    .catch(function () {
                        return { port: c.port, status: 0 };
                    });
            });
            Promise.all(probes).then(function (results) {
                var hasRoute = [];
                var ri = 0;
                for (ri = 0; ri < results.length; ri++) {
                    var x = results[ri];
                    if (x.status !== 404 && x.status !== 0) {
                        hasRoute.push(x);
                    }
                }
                hasRoute.sort(function (a, b) {
                    return a.port - b.port;
                });
                var chosenPort;
                if (hasRoute.length) {
                    chosenPort = hasRoute[0].port;
                } else {
                    chosenPort = pool[0].port;
                    console.warn(
                        '[PR_SAFE_AUTH] لا يوجد على المنافذ المُفحوصة مسار «مراقبة الخادم» — غالباً نسخة قديمة من auth-server فقط.' +
                            ' أوقف node على 3000 وشغّل npm run auth-server من المجلّد المحدَّث؛ المنفذ المختار الآن للتوافق: ' +
                            chosenPort
                    );
                }
                window.PR_SAFE_AUTH.apiBase = 'http://' + host + ':' + chosenPort;
                console.info('[PR_SAFE_AUTH] خادم التحقق:', window.PR_SAFE_AUTH.apiBase);
                resolveDiscovery();
            });
        }

        function finish() {
            finishWithMonitorProbe();
        }
        function tryNext() {
            if (i >= ports.length) {
                finish();
                return;
            }
            var port = ports[i++];
            fetchWithTimeout('http://' + host + ':' + port + '/api/ping', { method: 'GET', cache: 'no-store' }, 2200)
                .then(function (r) {
                    if (!r.ok) {
                        tryNext();
                        return;
                    }
                    return r.json().catch(function () {
                        return null;
                    });
                })
                .then(function (j) {
                    if (j && j.ok) {
                        candidates.push({ port: port, j: j });
                    }
                    tryNext();
                })
                .catch(function () {
                    tryNext();
                });
        }
        tryNext();
    })();
})();
