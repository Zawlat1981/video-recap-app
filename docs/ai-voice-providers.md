# AI Voice Provider Notes

Checked 2026-10-07 against first-party Microsoft Learn and OpenAI API documentation. This is an integration reference, not a quality benchmark.

## Decision Summary

- **Azure Speech:** Burmese (`my-MM`) is listed for fast speech-to-text and standard neural text-to-speech. The listed voices are `my-MM-NilarNeural` (female) and `my-MM-ThihaNeural` (male). The current synchronous file transcription REST API is GA version `2025-10-15`.
- **OpenAI:** File transcription is `POST /v1/audio/transcriptions`; `gpt-transcribe` is the current documented recommended model for recorded speech. Chat Completions is `POST /v1/chat/completions`; the caller supplies a model ID. OpenAI's first-party docs reviewed here do not establish Burmese support for `gpt-transcribe`.
- For provider configuration, keep provider, model, locale, voice, and output format explicit. Do not assume one provider's request fields or limits apply to another.

## Azure Speech

### Burmese support

Microsoft's [language and voice catalog](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=stt) lists `my-MM` Burmese as supported by fast transcription. In its TTS table, the same locale has standard voices `my-MM-NilarNeural` and `my-MM-ThihaNeural`. The catalog marks these voices with a note that phonemes, custom lexicons, and visemes are unsupported. Locale/voice listing is documentation-level availability; verify it against the target Speech resource and region before relying on it.

### Speech-to-text REST

Use the current synchronous [Transcriptions - Transcribe API](https://learn.microsoft.com/en-us/rest/api/speechtotext/transcriptions/transcribe?view=rest-speechtotext-v2025-10-15), rather than the older short-audio route. Microsoft identifies `2025-10-15` as the latest generally available Speech-to-text REST version; older v3.0 / 3.2 preview versions were retired.

```http
POST https://{resource}.cognitiveservices.azure.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15
Ocp-Apim-Subscription-Key: {speech-resource-key}
Content-Type: multipart/form-data

audio=<binary file>
definition={"locales":["my-MM"]}
```

The request is multipart form data (`audio` file plus JSON-serialized `definition`); specifying `locales: ["my-MM"]` is recommended when the recording language is known. The guide also supports `Authorization: Bearer ...` in place of the key header, including Microsoft Entra ID keyless authentication. A successful response contains JSON (`combinedPhrases`, `phrases`, timing, and confidence fields). See Microsoft's [fast transcription guide](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/fast-transcription-create) and [operation reference](https://learn.microsoft.com/en-us/rest/api/speechtotext/transcriptions/transcribe?view=rest-speechtotext-v2025-10-15).

### Text-to-speech REST

For standard neural voices, the regional endpoint shape is `https://{region}.tts.speech.microsoft.com/cognitiveservices/v1`; select a region supported by the Speech resource. The [REST reference](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech) documents `POST`, SSML input, and these required synthesis headers:

```http
Authorization: Bearer {token}
Content-Type: application/ssml+xml
X-Microsoft-OutputFormat: audio-24khz-48kbitrate-mono-mp3
User-Agent: {application-name}
```

The response body is audio bytes. The output format above is a supported streaming MP3 format; a supported non-streaming WAV option is `riff-24khz-16bit-mono-pcm`. Put the voice and Burmese locale in SSML, for example `<speak version="1.0" xml:lang="my-MM"><voice name="my-MM-NilarNeural">...</voice></speak>`. Microsoft documents both `Ocp-Apim-Subscription-Key` and `Authorization: Bearer` as supported in the general authentication section, but the synthesis-specific header table marks `Authorization` required. Follow that stricter contract and use a bearer token unless direct-key auth is confirmed against the selected endpoint. The bearer token can be exchanged at `https://{resource}.cognitiveservices.azure.com/sts/v1.0/issueToken` using `Ocp-Apim-Subscription-Key`; it is valid for 10 minutes and is scoped to the host that issued it.

The [voice-list operation](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech#get-a-list-of-voices) can validate actual endpoint availability at runtime: `GET https://{resource}.cognitiveservices.azure.com/tts/cognitiveservices/voices/list`, authenticated with either supported header. Filter returned voices by `Locale == "my-MM"` and `ShortName`.

### MVP limits

- **Fast STT has a documentation conflict:** the [fast transcription guide](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/fast-transcription-create) and [quota table](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits) say S0 allows files under 500 MB and 5 hours; the generated [`2025-10-15` operation reference](https://learn.microsoft.com/en-us/rest/api/speechtotext/transcriptions/transcribe?view=rest-speechtotext-v2025-10-15) says under 250 MB and 2 hours. I could not reconcile these first-party limits. For an MVP, enforce no more than the stricter 250 MB / 2-hour bound, and set a much smaller app-level upload cap suited to local disk, memory, and request timeouts.
- Fast transcription is S0-only in the quota table; F0 is unavailable. S0's documented default is 600 requests/minute, shared with batch transcription. A local MVP should rate-limit far below this and handle `429` with bounded retry/backoff.
- Real-time TTS produces at most 10 minutes of audio per request. The quota table lists F0 at 20 transactions per 60 seconds (not adjustable) and S0 at 30 transactions/second by default. Handle `429`; Microsoft notes that voice/region capacity can also cause throttling.
- The older [short-audio STT API](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short) accepts at most 60 seconds and limited PCM WAV/Opus OGG input. It is not the recommended file route when fast transcription is available.

## OpenAI

### Speech-to-text

The official [speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text) recommends `gpt-transcribe` for recorded speech in its original language. The endpoint is `POST https://api.openai.com/v1/audio/transcriptions`, with `Authorization: Bearer {OPENAI_API_KEY}` and multipart form data containing `file` and an explicit `model` (for example `gpt-transcribe`). Supported upload formats are `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `wav`, and `webm`; maximum upload size is 25 MB. Split/compress larger files before upload. The docs show model-specific options: `gpt-transcribe` accepts language hints and contextual hints; word/segment timestamp granularities are only supported by `whisper-1`.

No default model is documented for this request; select the transcription model explicitly in provider configuration. The documented recommendation and model support can change independently of the endpoint contract.

### Chat Completions

The official [Chat Completions API reference](https://developers.openai.com/api/reference/resources/chat) documents `POST https://api.openai.com/v1/chat/completions`, with `Authorization: Bearer {OPENAI_API_KEY}`, `Content-Type: application/json`, and a JSON body containing `model` and `messages`. The API has no universal implicit model choice: supply the model ID from configuration. The reference lists model IDs including `gpt-4.1-mini`; its [model page](https://developers.openai.com/api/docs/models/gpt-4.1-mini) confirms Chat Completions support and the snapshot `gpt-4.1-mini-2025-04-14`. OpenAI recommends the Responses API for new projects, but Chat Completions remains documented and supported for compatible models.

For a portable provider adapter, treat optional generation parameters as model-dependent. Prefer `max_completion_tokens`; `max_tokens` is deprecated and incompatible with o-series models. The API reference explicitly warns that parameter support differs by model, especially reasoning models. Keep model ID configurable and only pass options supported by the selected model.

## Not Verified

- OpenAI's first-party documentation reviewed here does not explicitly confirm Burmese (`my-MM`) transcription support for `gpt-transcribe`; test representative Burmese files before selecting it for that locale.
- Azure's Burmese locale/voice entries do not promise transcription accuracy or TTS naturalness for this app's media. Validate sample audio and confirm the runtime voice list in the chosen Azure region/resource.
- Provider pricing and account-specific OpenAI rate limits were not compared. OpenAI rate limits depend on usage tier; Azure's documented quotas are resource/tier-specific.
