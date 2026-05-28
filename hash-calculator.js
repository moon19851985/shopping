// حساب Hash للبيانات
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(32, '0');
}

// الحساب:
// Email: atc-41@hotmail.com
console.log('Email Hash: ' + hashString('atc-41@hotmail.com'));
// Password: M05971330m
console.log('Password Hash: ' + hashString('M05971330m'));
