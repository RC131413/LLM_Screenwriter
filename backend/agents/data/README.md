# Bielik tokenizer

`bielik-tokenizer.json` is the tokenizer only, without any model weights.
It is loaded locally with `tokenizers.Tokenizer.from_file`; serving requests
does not contact Hugging Face or start another model generation.

- Source: https://huggingface.co/speakleash/Bielik-11B-v2.3-Instruct
- Revision: `73f5f7fb9a79a4409d02740155a3868c1ff0d2bc`
- File: `tokenizer.json`
- SHA-256: `12d8d9f5d3124492bdef7ba8ac3e8f8e713d39518741d049322cc0b174041170`
- License: Apache-2.0, included as `LICENSE-tokenizer.txt`.

All 32128 token strings/IDs were compared against the locally installed
`SpeakLeash/bielik-11b-v2.3-instruct:Q4_K_M` GGUF metadata; they matched.
Content tokenization is local. Chat-template overhead is conservatively
estimated and covered by an additional safety margin; it is not claimed to
reproduce every future Ollama template exactly. Recheck the allowance if the
model or template is changed. Output JSON schemas constrain decoding and are
sent separately as `format`; if serialized into messages they count normally.
