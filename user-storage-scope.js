/**
 * عزل بيانات المستخدم المحلية حسب البريد (نفس الجهاز — حسابات متعددة).
 * لا يغيّر السيرفر ولا لوحة التحكم.
 */
(function (global) {
    var LEGACY_IDB = 'mediaAppDB_INDEX2';
    var STORAGE_V2_KEY = 'gosta_storage_v2_INDEX2';
    var IDB_V2_KEY = 'gosta_idb_v2_migrated_INDEX2';
    var MIGRATED_OWNER_KEY = 'gosta_migrated_storage_owner_INDEX2';

    function normalizeEmail(e) {
        return String(e || '').trim().toLowerCase();
    }

    function getCurrentUserEmailForStorage_INDEX2() {
        try {
            var cur = localStorage.getItem('currentUserEmail_INDEX2');
            if (cur && cur.trim()) return cur.trim();
            var raw = localStorage.getItem('userAccount_INDEX2');
            if (raw) {
                var a = JSON.parse(raw);
                if (a && a.email) return String(a.email).trim();
            }
        } catch (ignore) {}
        return '';
    }

    function scopedStorageKey(baseKey, email) {
        var n = normalizeEmail(email);
        if (!n) return baseKey;
        return baseKey + '::' + n;
    }

    function idbSlugFromEmail(email) {
        var n = normalizeEmail(email);
        if (!n) return 'anon';
        try {
            return btoa(unescape(encodeURIComponent(n)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/g, '');
        } catch (e) {
            var h = 0;
            for (var i = 0; i < n.length; i++) {
                h = ((h << 5) - h + n.charCodeAt(i)) | 0;
            }
            return 'h' + (h >>> 0).toString(16);
        }
    }

    global.getCurrentUserEmailForStorage_INDEX2 = getCurrentUserEmailForStorage_INDEX2;

    global.getIndexedDBNameForUserEmail_INDEX2 = function (email) {
        var n = normalizeEmail(email);
        if (!n) return LEGACY_IDB;
        return LEGACY_IDB + '_' + idbSlugFromEmail(email);
    };

    /** إن وُجد اشتراك عام لبريد آخر يُنقل لمفتاحه المقيد ويُزال من المفتاح العام */
    function rehomeLegacyUnscopedSubscriptionIfNeeded_INDEX2(readerEmail) {
        var re = normalizeEmail(readerEmail);
        if (!re) return;
        var raw = localStorage.getItem('userSubscription_INDEX2');
        if (!raw) return;
        var o;
        try {
            o = JSON.parse(raw);
        } catch (e) {
            return;
        }
        var ue = normalizeEmail(o.userEmail || '');
        if (ue && ue !== re) {
            var sk = scopedStorageKey('userSubscription_INDEX2', o.userEmail);
            if (localStorage.getItem(sk) == null) localStorage.setItem(sk, raw);
            localStorage.removeItem('userSubscription_INDEX2');
        }
    }

    global.gostaLsGetScoped_INDEX2 = function (baseKey, emailOpt) {
        var email = emailOpt != null ? emailOpt : getCurrentUserEmailForStorage_INDEX2();
        if (baseKey === 'userSubscription_INDEX2') {
            rehomeLegacyUnscopedSubscriptionIfNeeded_INDEX2(email);
        }
        var n = normalizeEmail(email);
        if (!n) {
            return localStorage.getItem(baseKey);
        }
        var sk = scopedStorageKey(baseKey, email);
        var v = localStorage.getItem(sk);
        if (v != null) return v;
        var leg = localStorage.getItem(baseKey);
        if (leg == null) return null;
        if (baseKey === 'userSubscription_INDEX2') {
            try {
                var obj = JSON.parse(leg);
                var uem = normalizeEmail(obj.userEmail || '');
                if (uem && uem !== n) return null;
                if (!uem) {
                    obj.userEmail = email;
                    leg = JSON.stringify(obj);
                }
                localStorage.setItem(sk, leg);
                localStorage.removeItem(baseKey);
                return leg;
            } catch (e) {
                return null;
            }
        }
        if (
            baseKey === 'mediaFilesMetadata_INDEX2' ||
            baseKey === 'deletedFilesMetadata_INDEX2' ||
            baseKey === 'backup_files_INDEX2' ||
            baseKey === 'transferred_files_INDEX2' ||
            baseKey === 'freePlanTrialStart_INDEX2'
        ) {
            localStorage.setItem(sk, leg);
            localStorage.removeItem(baseKey);
            return leg;
        }
        return null;
    };

    global.gostaLsSetScoped_INDEX2 = function (baseKey, value, emailOpt) {
        var email = emailOpt != null ? emailOpt : getCurrentUserEmailForStorage_INDEX2();
        var n = normalizeEmail(email);
        if (!n) {
            localStorage.setItem(baseKey, value);
            return;
        }
        var sk = scopedStorageKey(baseKey, email);
        localStorage.setItem(sk, value);
        try {
            if (localStorage.getItem(baseKey) != null) localStorage.removeItem(baseKey);
        } catch (ignore) {}
    };

    global.gostaLsRemoveScoped_INDEX2 = function (baseKey, emailOpt) {
        var email = emailOpt != null ? emailOpt : getCurrentUserEmailForStorage_INDEX2();
        var n = normalizeEmail(email);
        if (!n) {
            localStorage.removeItem(baseKey);
            return;
        }
        localStorage.removeItem(scopedStorageKey(baseKey, email));
        localStorage.removeItem(baseKey);
    };

    /** ترحيل مفاتيح localStorage القديمة إلى مفاتيح مرتبطة بصاحب البيانات (مرة واحدة) */
    function runGostaLocalStorageV2MigrationOnce_INDEX2() {
        if (localStorage.getItem(STORAGE_V2_KEY) === '1') return;
        var owner = '';
        var rawSub = localStorage.getItem('userSubscription_INDEX2');
        if (rawSub) {
            try {
                var j = JSON.parse(rawSub);
                if (j.userEmail) owner = String(j.userEmail).trim();
            } catch (e) {}
        }
        if (!owner) {
            var accR = localStorage.getItem('userAccount_INDEX2');
            if (accR) {
                try {
                    owner = String(JSON.parse(accR).email || '').trim();
                } catch (e) {}
            }
        }
        var keys = [
            'userSubscription_INDEX2',
            'mediaFilesMetadata_INDEX2',
            'deletedFilesMetadata_INDEX2',
            'backup_files_INDEX2',
            'transferred_files_INDEX2',
            'freePlanTrialStart_INDEX2'
        ];
        if (owner) {
            var n = normalizeEmail(owner);
            keys.forEach(function (k) {
                var v = localStorage.getItem(k);
                if (v == null) return;
                var sk = scopedStorageKey(k, owner);
                if (localStorage.getItem(sk) == null) localStorage.setItem(sk, v);
                localStorage.removeItem(k);
            });
            localStorage.setItem(MIGRATED_OWNER_KEY, owner);
        }
        localStorage.setItem(STORAGE_V2_KEY, '1');
    }

    function copyIndexedDbDatabase_INDEX2(sourceName, destName, version) {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(sourceName);
            req.onerror = function () {
                resolve();
            };
            req.onsuccess = function () {
                var srcDb = req.result;
                var names = Array.from(srcDb.objectStoreNames);
                if (names.length === 0) {
                    srcDb.close();
                    resolve();
                    return;
                }
                var dreq = indexedDB.open(destName, version);
                dreq.onupgradeneeded = function (ev) {
                    var database = ev.target.result;
                    if (!database.objectStoreNames.contains('mediaFiles')) {
                        database.createObjectStore('mediaFiles', { keyPath: 'id' });
                    }
                    if (!database.objectStoreNames.contains('deletedFiles')) {
                        database.createObjectStore('deletedFiles', { keyPath: 'id' });
                    }
                    if (!database.objectStoreNames.contains('backupData')) {
                        database.createObjectStore('backupData', { keyPath: 'id' });
                    }
                };
                dreq.onerror = function () {
                    try {
                        srcDb.close();
                    } catch (e) {}
                    reject(dreq.error);
                };
                dreq.onsuccess = function () {
                    var dstDb = dreq.result;
                    var si = 0;

                    function finishOk() {
                        try {
                            srcDb.close();
                        } catch (e) {}
                        try {
                            dstDb.close();
                        } catch (e) {}
                        resolve();
                    }

                    function copyStore() {
                        if (si >= names.length) {
                            finishOk();
                            return;
                        }
                        var sn = names[si++];
                        var txR = srcDb.transaction(sn, 'readonly');
                        var os = txR.objectStore(sn);
                        var gall = os.getAll();
                        gall.onerror = function () {
                            try {
                                srcDb.close();
                                dstDb.close();
                            } catch (e) {}
                            reject(gall.error);
                        };
                        gall.onsuccess = function () {
                            var items = gall.result || [];
                            if (items.length === 0) {
                                copyStore();
                                return;
                            }
                            var txW = dstDb.transaction(sn, 'readwrite');
                            var ds = txW.objectStore(sn);
                            var ix = 0;
                            function putOne() {
                                if (ix >= items.length) {
                                    txW.oncomplete = function () {
                                        copyStore();
                                    };
                                    return;
                                }
                                var pr = ds.put(items[ix++]);
                                pr.onerror = function () {
                                    try {
                                        srcDb.close();
                                        dstDb.close();
                                    } catch (e) {}
                                    reject(pr.error);
                                };
                                pr.onsuccess = function () {
                                    putOne();
                                };
                            }
                            putOne();
                        };
                    }
                    copyStore();
                };
            };
        });
    }

    function migrateLegacyIndexedDbIfNeeded_INDEX2() {
        return new Promise(function (resolve) {
            if (localStorage.getItem(IDB_V2_KEY) === '1') {
                resolve();
                return;
            }
            var owner = localStorage.getItem(MIGRATED_OWNER_KEY) || '';
            if (!owner) {
                localStorage.setItem(IDB_V2_KEY, '1');
                resolve();
                return;
            }
            var destName = global.getIndexedDBNameForUserEmail_INDEX2(owner);
            if (destName === LEGACY_IDB) {
                localStorage.setItem(IDB_V2_KEY, '1');
                resolve();
                return;
            }
            copyIndexedDbDatabase_INDEX2(LEGACY_IDB, destName, 3)
                .then(function () {
                    try {
                        indexedDB.deleteDatabase(LEGACY_IDB);
                    } catch (e) {}
                    localStorage.setItem(IDB_V2_KEY, '1');
                    resolve();
                })
                .catch(function (e) {
                    console.warn('[GOSTA] ترحيل IndexedDB:', e);
                    localStorage.setItem(IDB_V2_KEY, '1');
                    resolve();
                });
        });
    }

    global.runGostaBootstrapStorage_INDEX2 = async function () {
        try {
            runGostaLocalStorageV2MigrationOnce_INDEX2();
            await migrateLegacyIndexedDbIfNeeded_INDEX2();
        } catch (e) {
            console.warn('[GOSTA] bootstrap storage:', e);
        }
    };

    global.activateUserStorageScope_INDEX2 = function (email) {
        var n = normalizeEmail(email);
        if (!n) return;
        rehomeLegacyUnscopedSubscriptionIfNeeded_INDEX2(email);
        if (typeof global.onGostaUserStorageScopeChanged_INDEX2 === 'function') {
            global.onGostaUserStorageScopeChanged_INDEX2(email);
        }
    };

    /** نسخ قاعدة الملفات عند تغيير البريد (نفس الجهاز) */
    global.gostaMigrateIdbEmailChange_INDEX2 = function (oldEmail, newEmail) {
        var on = normalizeEmail(oldEmail);
        var nn = normalizeEmail(newEmail);
        if (!on || !nn || on === nn) return Promise.resolve();
        var src = global.getIndexedDBNameForUserEmail_INDEX2(oldEmail);
        var dst = global.getIndexedDBNameForUserEmail_INDEX2(newEmail);
        if (src === dst || src === LEGACY_IDB) return Promise.resolve();
        return copyIndexedDbDatabase_INDEX2(src, dst, 3)
            .then(function () {
                try {
                    indexedDB.deleteDatabase(src);
                } catch (e) {}
            })
            .catch(function (e) {
                console.warn('[GOSTA] ترحيل IDB عند تغيير البريد:', e);
            });
    };
})(typeof window !== 'undefined' ? window : this);
