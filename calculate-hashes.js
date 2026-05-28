// دالة Hash من admin-login.js
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(32, '0');
}

// اختبار الحسابات
const testEmail = 'atc-41@hotmail.com';
const testPassword = 'M05971330m';

const emailHash = hashString(testEmail);
const passwordHash = hashString(testPassword);

console.log('=== HASH CALCULATION RESULTS ===');
console.log(`Email: ${testEmail}`);
console.log(`Email Hash: ${emailHash}`);
console.log('');
console.log(`Password: ${testPassword}`);
console.log(`Password Hash: ${passwordHash}`);
console.log('');
console.log('=== COPY THESE VALUES TO admin-login.js ===');
console.log(`emailHash: '${emailHash}',  // hash of ${testEmail}`);
console.log(`passwordHash: '${passwordHash}'  // hash of ${testPassword}`);
