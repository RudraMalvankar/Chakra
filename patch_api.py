import re
with open('frontend/src/services/api.ts', 'r') as f:
    text = f.read()

text = text.replace('return fetchAPI(/api/voice/recovery/\);', 'return fetchAPI(/api/voice/recovery/\);')

with open('frontend/src/services/api.ts', 'w') as f:
    f.write(text)
