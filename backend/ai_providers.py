import os
from pathlib import Path
from typing import Any
from faster_whisper import WhisperModel
from myanmartts import MyanmarTTS
import openai  # OpenAI library ကို အသုံးပြု၍ Ollama local server သို့ ချိတ်ဆက်ရန်

class ProviderError(RuntimeError):
    pass

# Lazy load Faster-Whisper model to save memory and startup time
_whisper_model = None

def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        model_name = os.getenv("WHISPER_MODEL_SIZE", "base")
        _whisper_model = WhisperModel(model_name, device="cpu", compute_type="int8")
    return _whisper_model

def generate_burmese_recap(transcript: str, duration_seconds: int) -> str:
    """
    Local Ollama (DeepSeek-R1 / Llama 3) ကို အသုံးပြု၍ မြန်မာလို ဇာတ်လမ်းအကျဉ်းချုပ် ထုတ်လုပ်ခြင်း
    """
    if not transcript.strip():
        raise ProviderError("No transcript text is available to summarize.")
    
    try:
        # Ollama local endpoint သို့ ချိတ်ဆက်ရန် OpenAI client ကို အသုံးပြုခြင်း
        client = openai.OpenAI(
            base_url="http://localhost:11434/v1",
            api_key="ollama"  # Ollama အတွက် API key မလိုပါ၊ dummy တစ်ခု ထည့်ရန်
        )
        
        prompt = (
            f"အောက်ပါ ဗွီဒီယို transcript ကို အခြေခံ၍ စိတ်ဝင်စားစရာကောင်းသော မြန်မာ့ဇာတ်လမ်းအကျဉ်းချုပ် (Movie Recap) တစ်ခုကို "
            f"ခန့်မှန်းခြေ ကြာချိန် {duration_seconds} စက္ကန့်စာ အံဝင်ခွင်ကျ ဖြစ်စေရန် မြန်မာဘာသာဖြင့် ရေးသားပေးပါ။\n\n"
            f"Transcript:\n{transcript.strip()}"
        )
        
        response = client.chat.completions.create(
            model=os.getenv("OLLAMA_MODEL", "deepseek-r1"),
            messages=[
                {"role": "system", "content": "You are a professional movie recap writer who writes engaging scripts in Burmese."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
        )
        
        recap_text = response.choices[0].message.content
        if not recap_text:
            raise ProviderError("Ollama returned an empty recap script.")
        return recap_text.strip()
        
    except Exception as error:
        raise ProviderError(f"Local Ollama recap generation failed: {str(error)}") from error

def transcribe_burmese_audio(audio_path: Path) -> str:
    """
    faster-whisper ကို အသုံးပြု၍ အသံဖိုင်ကို မြန်မာစာသားသို့ ဘာသာပြန်ခြင်း (STT)
    """
    if not audio_path.exists():
        raise ProviderError(f"Audio file not found: {audio_path}")
    
    try:
        model = get_whisper_model()
        segments, info = model.transcribe(str(audio_path), beam_size=5)
        transcript = " ".join([segment.text for segment in segments]).strip()
        
        if not transcript:
            raise ProviderError("Whisper did not recognize any Burmese speech.")
        return transcript
    except Exception as error:
        raise ProviderError(f"Local Faster-Whisper transcription failed: {str(error)}") from error

def synthesize_burmese_voice(text: str, voice: str = "default") -> bytes:
    """
    myanmar-tts ကို အသုံးပြု၍ မြန်မာစာသားကို အသံဖိုင် (MP3 bytes) သို့ ပြောင်းလဲခြင်း (TTS)
    """
    if not text.strip():
        raise ProviderError("Recap script is empty.")
    
    try:
        tts = MyanmarTTS()
        audio_output = tts.synthesize(text)
        
        if isinstance(audio_output, (str, Path)):
            with open(audio_output, "rb") as f:
                return f.read()
        elif isinstance(audio_output, bytes):
            return audio_output
        else:
            temp_path = Path("temp_voice.mp3")
            tts.save(text, str(temp_path))
            with open(temp_path, "rb") as f:
                data = f.read()
            temp_path.unlink(missing_ok=True)
            return data
            
    except Exception as error:
        raise ProviderError(f"Local Myanmar TTS failed: {str(error)}") from error