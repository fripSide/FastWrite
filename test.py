from openai import OpenAI
 
client = OpenAI(
    base_url="http://127.0.0.1:8045/v1",
    api_key="sk-c5d4515824394db98d2fb9e306974c2c"
)

response = client.chat.completions.create(
    model="gemini-3-flash",
    messages=[{"role": "user", "content": "Hello"}]
)

print(response.choices[0].message.content)