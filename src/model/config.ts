/** The model this page runs, and the measured size of what the browser fetches. */
export const MODEL_ID = "HuggingFaceTB/SmolLM2-360M-Instruct";
export const MODEL_NAME = "SmolLM2-360M-Instruct";
export const MODEL_URL = "https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct";
export const MODEL_PARAMS = "360 million";
export const MODEL_DTYPE = "q4f16";
/** Megabytes: weights, tokenizer and config together. */
export const MODEL_MB = 276;

/** How each hand-over is sampled. */
export const GEN = {
  max_new_tokens: 36,
  do_sample: true,
  temperature: 0.55,
  top_p: 0.9,
  repetition_penalty: 1.08,
} as const;
