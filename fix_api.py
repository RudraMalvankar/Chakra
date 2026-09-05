
import re
with open("frontend/src/services/api.ts", "r") as f:
    text = f.read()

text = re.sub(r"export const getVoiceRecoveryStatus.*?;", "", text, flags=re.DOTALL)
text = text.replace("};\n", "")

text += "\nexport const getVoiceRecoveryStatus = async (call_sid: string) => {\n    return fetchAPI(`/api/voice/recovery/${call_sid}`);\n};\n"

with open("frontend/src/services/api.ts", "w") as f:
    f.write(text)

