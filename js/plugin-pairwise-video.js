/*
 * jsPsychPairwiseVideo — side-by-side video comparison for jsPsych 8.
 *
 * What it does
 *   - Shows two videos side by side (no controls: no pausing, no seeking).
 *   - A "Play" button starts playback. Playback is either
 *       "sequential"   : left video, then right video (use when clips have audio)
 *       "simultaneous" : both at once (use for muted clips)
 *   - The answer buttons stay locked until BOTH videos have played to the end.
 *   - If playback is interrupted (tab switch, leaving fullscreen), both videos
 *     are reset and the participant has to watch them again. Interruptions are logged.
 *   - Optional attention check: a message appears over the videos after a delay.
 *
 * Data saved per trial
 *   response (index), response_label, rt (ms from buttons unlocking to click),
 *   trial_duration (ms), plays, replays, interruptions, left_src, right_src,
 *   attention_target, attention_passed, plus everything passed in `meta`.
 */
var jsPsychPairwiseVideo = (function (jspsych) {
  "use strict";

  const PT = jspsych.ParameterType;

  const info = {
    name: "pairwise-video",
    version: "0.1.0",
    parameters: {
      left_src: { type: PT.VIDEO, default: undefined },
      right_src: { type: PT.VIDEO, default: undefined },
      /** Question shown above the videos. */
      question: { type: PT.HTML_STRING, default: "Which video do you prefer?" },
      /** Response options, shown left to right. */
      choices: { type: PT.STRING, array: true, default: ["Left", "Right"] },
      /** "sequential" or "simultaneous". */
      playback: { type: PT.STRING, default: "sequential" },
      /** Force-mute both videos (recommended for motion-realism studies). */
      muted: { type: PT.BOOL, default: false },
      /** Allow watching the pair again after the first full viewing. */
      allow_replay: { type: PT.BOOL, default: true },
      /** Width of each video in px (height follows aspect ratio). */
      video_width: { type: PT.INT, default: 480 },
      /** Labels shown under each video. */
      video_labels: { type: PT.STRING, array: true, default: ["Left video", "Right video"] },
      /** If set, this text is shown over the videos (attention check). */
      attention_text: { type: PT.HTML_STRING, default: null },
      /** Delay after playback start before the attention text appears. */
      attention_delay_ms: { type: PT.INT, default: 2000 },
      /** Index into `choices` that counts as passing the attention check. */
      attention_target: { type: PT.INT, default: null },
      /** Arbitrary metadata copied into the trial data (pair id, systems, ...). */
      meta: { type: PT.OBJECT, default: {} },
    },
    data: {
      response: { type: PT.INT },
      response_label: { type: PT.STRING },
      rt: { type: PT.INT },
      trial_duration: { type: PT.INT },
      plays: { type: PT.INT },
      replays: { type: PT.INT },
      interruptions: { type: PT.INT },
      left_src: { type: PT.STRING },
      right_src: { type: PT.STRING },
      attention_target: { type: PT.INT },
      attention_passed: { type: PT.BOOL },
    },
  };

  class PairwiseVideoPlugin {
    static info = info;

    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const api = this.jsPsych.pluginAPI;
      const t0 = performance.now();
      let unlockTime = null;
      let plays = 0;
      let replays = 0;
      let interruptions = 0;
      let playing = false;
      let attentionTimer = null;
      const ended = { left: false, right: false };

      const w = trial.video_width;
      const muted = trial.muted ? "muted" : "";
      display_element.innerHTML = `
        <div class="pv-wrap">
          <div class="pv-question">${trial.question}</div>
          <div class="pv-videos">
            <div class="pv-cell" id="pv-cell-left">
              <video id="pv-left" width="${w}" playsinline preload="auto" ${muted}
                     disablepictureinpicture controlslist="nodownload noplaybackrate"></video>
              <div class="pv-label">${trial.video_labels[0]}</div>
            </div>
            <div class="pv-cell" id="pv-cell-right">
              <video id="pv-right" width="${w}" playsinline preload="auto" ${muted}
                     disablepictureinpicture controlslist="nodownload noplaybackrate"></video>
              <div class="pv-label">${trial.video_labels[1]}</div>
            </div>
            <div class="pv-attention" id="pv-attention" style="display:none"></div>
          </div>
          <div class="pv-status" id="pv-status">Press <b>Play</b> to watch both videos.</div>
          <div class="pv-controls">
            <button class="jspsych-btn" id="pv-play">Play</button>
          </div>
          <div class="pv-choices" id="pv-choices">
            ${trial.choices
              .map((c, i) => `<button class="jspsych-btn pv-choice" data-i="${i}" disabled>${c}</button>`)
              .join("")}
          </div>
        </div>`;

      const vL = display_element.querySelector("#pv-left");
      const vR = display_element.querySelector("#pv-right");
      const cellL = display_element.querySelector("#pv-cell-left");
      const cellR = display_element.querySelector("#pv-cell-right");
      const playBtn = display_element.querySelector("#pv-play");
      const status = display_element.querySelector("#pv-status");
      const att = display_element.querySelector("#pv-attention");
      const choiceBtns = [...display_element.querySelectorAll(".pv-choice")];

      // Use preloaded blob URLs when available (from the preload plugin).
      vL.src = api.getVideoBuffer(trial.left_src);
      vR.src = api.getVideoBuffer(trial.right_src);
      if (trial.muted) { vL.muted = true; vR.muted = true; }

      // Block right-click menu (stops "show controls" / "loop" via context menu).
      [vL, vR].forEach((v) => v.addEventListener("contextmenu", (e) => e.preventDefault()));

      const highlight = (which) => {
        cellL.classList.toggle("pv-active", which === "left" || which === "both");
        cellR.classList.toggle("pv-active", which === "right" || which === "both");
      };

      const showAttention = () => {
        if (!trial.attention_text) return;
        clearTimeout(attentionTimer);
        attentionTimer = setTimeout(() => {
          att.innerHTML = trial.attention_text;
          att.style.display = "flex";
        }, trial.attention_delay_ms);
      };

      const unlockIfDone = () => {
        if (ended.left && ended.right) {
          playing = false;
          highlight(null);
          if (unlockTime === null) unlockTime = performance.now();
          choiceBtns.forEach((b) => (b.disabled = false));
          status.innerHTML = "Please choose an answer below.";
          if (trial.allow_replay) {
            playBtn.textContent = "Watch again";
            playBtn.disabled = false;
            playBtn.style.display = "";
          } else {
            playBtn.style.display = "none";
          }
        }
      };

      const start = () => {
        if (playing) return;
        playing = true;
        plays += 1;
        if (unlockTime !== null) replays += 1;
        playBtn.disabled = true;
        [vL, vR].forEach((v) => { v.pause(); v.currentTime = 0; });

        if (trial.playback === "simultaneous") {
          status.textContent = "Playing both videos…";
          highlight("both");
          vL.play(); vR.play();
        } else {
          status.textContent = "Playing the left video…";
          highlight("left");
          vL.play();
        }
        showAttention();
      };

      vL.addEventListener("ended", () => {
        ended.left = true;
        if (trial.playback !== "simultaneous" && playing) {
          status.textContent = "Playing the right video…";
          highlight("right");
          vR.play();
        }
        unlockIfDone();
      });
      vR.addEventListener("ended", () => { ended.right = true; unlockIfDone(); });

      // Report broken files instead of silently hanging.
      [vL, vR].forEach((v) =>
        v.addEventListener("error", () => {
          status.innerHTML = `<span style="color:#b00">A video failed to load. Please reload the page or contact the researcher.</span>`;
          console.error("Video failed to load:", v.currentSrc || v.src);
        })
      );

      // Any interruption during playback resets the viewing requirement.
      const interrupt = () => {
        if (!playing) return;
        interruptions += 1;
        playing = false;
        [vL, vR].forEach((v) => { v.pause(); v.currentTime = 0; });
        // Only reset "watched" if they hadn't finished both yet.
        if (unlockTime === null) { ended.left = false; ended.right = false; }
        highlight(null);
        clearTimeout(attentionTimer);
        playBtn.disabled = false;
        playBtn.textContent = "Play";
        status.innerHTML = "<b>Playback was interrupted.</b> Please watch the videos again from the start.";
      };
      const onVisibility = () => { if (document.hidden) interrupt(); };
      const onFullscreen = () => { if (!document.fullscreenElement) interrupt(); };
      document.addEventListener("visibilitychange", onVisibility);
      document.addEventListener("fullscreenchange", onFullscreen);
      window.addEventListener("blur", interrupt);

      playBtn.addEventListener("click", start);

      choiceBtns.forEach((b) =>
        b.addEventListener("click", () => {
          const i = Number(b.dataset.i);
          const now = performance.now();
          document.removeEventListener("visibilitychange", onVisibility);
          document.removeEventListener("fullscreenchange", onFullscreen);
          window.removeEventListener("blur", interrupt);
          clearTimeout(attentionTimer);
          [vL, vR].forEach((v) => { v.pause(); v.removeAttribute("src"); v.load(); });
          display_element.innerHTML = "";
          this.jsPsych.finishTrial({
            ...trial.meta,
            response: i,
            response_label: trial.choices[i],
            rt: Math.round(now - unlockTime),
            trial_duration: Math.round(now - t0),
            plays,
            replays,
            interruptions,
            left_src: trial.left_src,
            right_src: trial.right_src,
            attention_target: trial.attention_target,
            attention_passed: trial.attention_target === null ? null : i === trial.attention_target,
          });
        })
      );
    }
  }

  return PairwiseVideoPlugin;
})(jsPsychModule);
