import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

app = Flask(__name__)
CORS(app)

api_key = os.getenv("OPENROUTER_API_KEY")

if not api_key:
    raise ValueError("OPENROUTER_API_KEY not found in .env file")

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=api_key
)

def load_data(language):
    filename = "data-francais.json" if language == "fr" else "data-english.json"

    with open(filename, "r", encoding="utf-8") as file:
        return json.load(file)

@app.route("/")
def home():
    return jsonify({
        "status": "AI assistant backend is running"
    })

@app.route("/chat", methods=["POST"])
def chat():
    try:
        data = request.get_json()

        user_message = data.get("message", "")
        language = data.get("language", "fr")

        portfolio_data = load_data(language)

        system_prompt = f"""
Tu es l'assistant IA personnel de Iakobi Iakobashvili.

Tu réponds aux visiteurs de son portfolio.

Utilise uniquement les informations suivantes pour répondre :

{json.dumps(portfolio_data, ensure_ascii=False)}

Réponds clairement, professionnellement et dans la langue demandée.

Si l'information n'est pas disponible, indique simplement que tu ne disposes pas de cette information.

Réponds uniquement en texte brut.

N'utilise jamais Markdown.

N'utilise pas **, *, #, -, ou des liens Markdown.
"""

        response = client.chat.completions.create(
            model="openrouter/auto",
            messages=[
                {
                    "role": "system",
                    "content": system_prompt
                },
                {
                    "role": "user",
                    "content": user_message
                }
            ]
        )

        return jsonify({
            "answer": response.choices[0].message.content
        })

    except Exception as e:
        print("ERREUR BACKEND :", e)
        return jsonify({
            "error": str(e),
            "answer": f"Erreur backend : {str(e)}"
        }), 500

if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5050,
        debug=False
    )