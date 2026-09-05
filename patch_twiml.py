import re
with open('backend/app/api/webhooks.py', 'r') as f:
    text = f.read()

target = '''    # Hinglish MVP Prompt
    twiml = f'''<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" action="/webhooks/twilio/gather?case_id={case_id}&amp;amount={amount}" language="hi-IN" timeout="5">
        <Say language="hi-IN">Namaste. Chakra se call hai. Aapka {amount} rupaye ka payment bacha hai. Kya aap abhi pay karenge ya kal?</Say>
    </Gather>
</Response>'''
'''

replacement = '''    twiml = f'''<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" action="/webhooks/twilio/gather?case_id={case_id}&amp;amount={amount}" language="hi-IN" timeout="5" speechTimeout="auto">
        <Say language="hi-IN">Namaste, main Chakra se bol raha hoon. Aapke payment ke regarding baat karni thi. Aap bataiye, payment kab kar paayenge?</Say>
    </Gather>
</Response>'''
'''

text = text.replace(target, replacement)
with open('backend/app/api/webhooks.py', 'w') as f:
    f.write(text)
