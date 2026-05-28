def hashString(s):
    hash_val = 0
    for char in s:
        char_code = ord(char)
        hash_val = ((hash_val << 5) - hash_val) + char_code
        hash_val = hash_val & 0xFFFFFFFF  # 32-bit integer
    # Return absolute value as hex
    return format(abs(hash_val), '032x')

email = 'atc-41@hotmail.com'
password = 'M05971330m'

email_hash = hashString(email)
password_hash = hashString(password)

print(f'Email: {email}')
print(f'Email Hash: {email_hash}')
print()
print(f'Password: {password}')
print(f'Password Hash: {password_hash}')
print()
print('=== COPY TO admin-login.js ===')
print(f"emailHash: '{email_hash}',")
print(f"passwordHash: '{password_hash}'")
