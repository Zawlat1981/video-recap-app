import os
import json
from html import escape
from pathlib import Path
import requests
import openai


class ProviderError(RuntimeError):
    pass


def generate_burmese_recap(transcript: str, duration_seconds: int) -> str:
    """
    Configured AI provider ကို အသုံးပြု၍ မြန်မာလို ဇာတ်လမ်းအကျဉ်းချုပ် ထုတ်လုပ်ခြင်း
    """
    if not transcript.strip():
        raise ProviderError("No transcript text is available to summarize.")
    
    try:
        prompt = (
            f"အောက်ပါ ဗွီဒီယို transcript ကို အခြေခံ၍ စိတ်ဝင်စားစရာကောင်းသော မြန်မာ့ဇာတ်လမ်းအကျဉ်းချုပ် (Movie Recap) တစ်ခုကို "
            f"ခန့်မှန်းခြေ ကြာချိန် {duration_seconds} စက္ကန့်စာ အံဝင်ခွင်ကျ ဖြစ်စေရန် မြန်မာဘာသာဖြင့် ရေးသားပေးပါ။\n\n"
            f"Transcript:\n{transcript.strip()}"
        )

        messages = [
            {"role": "system", "content": "You are a professional movie recap writer who writes engaging scripts in Burmese."},
            {"role": "user", "content": prompt},
        ]
        if os.getenv("OPENAI_API_KEY"):
            response = _chat_client().chat.completions.create(
                model=_chat_model(),
                messages=messages,
                temperature=0.7,
                max_tokens=_recap_token_limit(duration_seconds),
            )
            recap_text = response.choices[0].message.content
        else:
            recap_text = _generate_ollama_recap(messages, duration_seconds)

        if not recap_text:
            raise ProviderError("The recap provider returned an empty script.")
        return recap_text.strip()
    except ProviderError:
        raise
    except requests.RequestException as error:
        raise ProviderError(
            f"Could not complete the Ollama recap request. Confirm Ollama is running and check "
            f"{Path.home() / 'AppData' / 'Local' / 'Ollama' / 'server.log'}. Original error: {error}"
        ) from error
    except Exception as error:
        raise ProviderError(f"Burmese recap generation failed: {str(error)}") from error


def _generate_ollama_recap(messages: list[dict[str, str]], duration_seconds: int) -> str:
    base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1").rstrip("/")
    if base_url.endswith("/v1"):
        base_url = base_url[:-3].rstrip("/")

    try:
        gpu_layers = int(os.getenv("OLLAMA_NUM_GPU", "0"))
    except ValueError as error:
        raise ProviderError("OLLAMA_NUM_GPU must be a non-negative integer.") from error
    if gpu_layers < 0:
        raise ProviderError("OLLAMA_NUM_GPU must be a non-negative integer.")

    response = requests.post(
        f"{base_url}/api/chat",
        json={
            "model": _chat_model(),
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.7,
                "num_ctx": 4096,
                "num_gpu": gpu_layers,
                "num_predict": _recap_token_limit(duration_seconds),
            },
        },
        timeout=(15, 1800),
    )
    try:
        body = response.json()
    except ValueError:
        body = {}
    if not response.ok:
        detail = body.get("error") if isinstance(body, dict) else None
        detail = str(detail or response.text or "No error details returned.")
        if "wsarecv" in detail.lower() or "device lost" in detail.lower():
            raise ProviderError(
                "Ollama's model runner disconnected during recap generation. This request uses "
                "CPU-only inference by default; check available memory and the Ollama server log. "
                f"Original error: {detail}"
            )
        raise ProviderError(f"Ollama recap request failed (HTTP {response.status_code}): {detail}")

    message = body.get("message") if isinstance(body, dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str) or not content.strip():
        raise ProviderError("Ollama returned an empty recap script.")
    return content


def _recap_token_limit(duration_seconds: int) -> int:
    return max(256, min(1400, duration_seconds * 3))


def _chat_client() -> openai.OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if api_key:
        return openai.OpenAI(
            base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            api_key=api_key,
            timeout=1800,
            max_retries=0,
        )
    return openai.OpenAI(
        base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
        api_key="ollama",
        timeout=1800,
        max_retries=0,
    )


def _chat_model() -> str:
    if os.getenv("OPENAI_API_KEY"):
        return os.getenv("OPENAI_CHAT_MODEL", "gpt-4.1-mini")
    return os.getenv("OLLAMA_MODEL", "").strip() or "qwen2.5:7b-instruct-q4_K_M"


def translate_to_burmese(transcript: str) -> str:
    if not transcript.strip():
        raise ProviderError("No source dialogue is available to translate.")

    try:
        response = _chat_client().chat.completions.create(
            model=_chat_model(),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Translate the dialogue into natural spoken Burmese (Myanmar). "
                        "Preserve the original meaning, names, and dialogue order. "
                        "Do not summarize, add explanations, or include the source text. "
                        "Return only the Burmese translation."
                    ),
                },
                {"role": "user", "content": transcript.strip()},
            ],
            temperature=0.2,
        )
        translated_text = response.choices[0].message.content
        if not translated_text or not translated_text.strip():
            raise ProviderError("The translation provider returned an empty translation.")
        return translated_text.strip()
    except ProviderError:
        raise
    except Exception as error:
        raise ProviderError(f"Thai-to-Burmese translation failed: {error}") from error


def transcribe_burmese_audio(audio_path: Path) -> str:
    if not audio_path.exists():
        raise ProviderError(f"Audio file not found: {audio_path}")

    endpoint = os.getenv("AZURE_SPEECH_STT_ENDPOINT", "").rstrip("/")
    subscription_key = os.getenv("AZURE_SPEECH_KEY", "")
    if not endpoint or not subscription_key:
        raise ProviderError("Configure AZURE_SPEECH_STT_ENDPOINT and AZURE_SPEECH_KEY to transcribe Burmese audio.")

    try:
        with audio_path.open("rb") as audio_file:
            response = requests.post(
                f"{endpoint}/speechtotext/transcriptions:transcribe",
                params={"api-version": "2025-10-15"},
                headers={"Ocp-Apim-Subscription-Key": subscription_key},
                data={"definition": json.dumps({"locales": ["my-MM"]})},
                files={"audio": (audio_path.name, audio_file, "audio/mpeg")},
                timeout=(15, 600),
            )
        response.raise_for_status()
        phrases = response.json().get("combinedPhrases", [])
        transcript = "\n".join(
            phrase["text"].strip()
            for phrase in phrases
            if isinstance(phrase, dict) and isinstance(phrase.get("text"), str) and phrase["text"].strip()
        )
        if not transcript:
            raise ProviderError("Speech recognition did not return any Burmese text.")
        return transcript
    except ProviderError:
        raise
    except Exception as error:
        raise ProviderError(f"Burmese audio transcription failed: {error}") from error


def synthesize_burmese_voice(text: str, voice: str = "my-MM-NilarNeural") -> bytes:
    if not text.strip():
        raise ProviderError("Myanmar voiceover text is empty.")

    subscription_key = os.getenv("AZURE_SPEECH_KEY", "")
    region = os.getenv("AZURE_SPEECH_TTS_REGION", "")
    if not subscription_key or not region:
        raise ProviderError("Configure AZURE_SPEECH_KEY and AZURE_SPEECH_TTS_REGION to synthesize a Myanmar voice.")
    if voice not in {"my-MM-NilarNeural", "my-MM-ThihaNeural"}:
        raise ProviderError("Choose a supported Myanmar voice.")

    try:
        ssml = (
            '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
            'xml:lang="my-MM">'
            f'<voice name="{voice}">{escape(text.strip())}</voice>'
            "</speak>"
        )
        response = requests.post(
            f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
            headers={
                "Ocp-Apim-Subscription-Key": subscription_key,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
            },
            data=ssml.encode("utf-8"),
            timeout=(15, 600),
        )
        response.raise_for_status()
        if not response.content:
            raise ProviderError("Azure Speech returned an empty audio file.")
        return response.content
    except ProviderError:
        raise
    except Exception as error:
        raise ProviderError(f"Azure Myanmar voice synthesis failed: {error}") from error