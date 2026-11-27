// ---- Edit these for your study ---------------------------------------------
const CONFIG = {
  // Bump this whenever you change the study, so every data file records which version ran.
  STUDY_VERSION: "pilot-0.1",

  // DataPipe experiment ID (12 characters, from pipe.jspsych.org).
  // Leave empty ("") while testing: data is downloaded to your computer instead.
  DATAPIPE_ID: "yX60Fm6IHF4A",

  // How many trial lists exist in lists/ (list_0.json ... list_{N-1}.json).
  // Must match "Number of conditions" in your DataPipe experiment settings.
  N_LISTS: 4,

  // Prolific completion codes (Study > "How do you want to confirm completion?").
  PROLIFIC_COMPLETION_CODE: "REPLACE_ME",
  PROLIFIC_NO_CONSENT_CODE: "REPLACE_ME_NOCONSENT",

  // Question and answer options (pairwise, 5-point, BEAT2/GENEA style).
  QUESTION: "In which video does the character gesture <b>more like a real person</b>?",
  CHOICES: [
    "Clearly left",
    "Slightly left",
    "They are equal",
    "Slightly right",
    "Clearly right",
  ],

  // "sequential" (left then right; use when clips have speech audio)
  // or "simultaneous" (both at once; only for muted clips).
  PLAYBACK: "simultaneous",
  MUTED: true,

  VIDEO_WIDTH: 480,     // px per video
  PRELOAD_BLOCK: 5,     // how many trials' videos to download at a time
  MIN_SCREEN_WIDTH: 1000,
};
